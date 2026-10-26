import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSize } from "./bindings/AppSize";
import type { AppsMeasureDone } from "./bindings/AppsMeasureDone";
import type { InstalledApp } from "./bindings/InstalledApp";
import type { Node } from "./bindings/Node";
import type { ScanDone } from "./bindings/ScanDone";
import type { AppSizeHandlers } from "./services/appSizes";
import type { ScanHandlers } from "./services/types";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancelScan: vi.fn(),
  api: {
    listDrives: vi.fn(),
    getChildren: vi.fn(),
    getTopFiles: vi.fn(),
    getTypeStats: vi.fn(),
    getAncestors: vi.fn(),
    getDenied: vi.fn(),
    openInExplorer: vi.fn(),
    listInstalledApps: vi.fn(),
    measureAppSizes: vi.fn(),
    cancelAppSizes: vi.fn(),
  },
  pickFolder: vi.fn(),
  listenAppSizes: vi.fn(),
}));

vi.mock("./services/tauriScanner", () => ({ tauriScanner: { start: mocks.start } }));
vi.mock("./services/api", () => ({ api: mocks.api, pickFolder: mocks.pickFolder }));
vi.mock("./services/appSizes", () => ({ listenAppSizes: mocks.listenAppSizes }));

import { treeCache, useStore } from "./store";

const noTypes = { video: 0, img: 0, doc: 0, code: 0, arch: 0, other: 0 };

function node(partial: Partial<Node> & { id: number }): Node {
  return {
    parentId: null,
    name: `n${partial.id}`,
    path: `C:\\n${partial.id}`,
    kind: "dir",
    size: 0,
    disk: 0,
    files: 0,
    dirs: 0,
    fileType: null,
    ext: null,
    modified: null,
    childCount: 0,
    byType: noTypes,
    ...partial,
  };
}

/**
 * C:\ (0)
 * ├─ grande (1, 100 B) ── interno (3, 80 B) ── foglia (5, 80 B, file)
 * ├─ piccola (2, 10 B)
 * └─ vuota (4, 0 B)
 */
const TREE: Record<number, Node[]> = {
  0: [
    node({ id: 1, parentId: 0, name: "grande", size: 100, childCount: 1 }),
    node({ id: 2, parentId: 0, name: "piccola", size: 10, childCount: 1 }),
    node({ id: 4, parentId: 0, name: "vuota" }),
  ],
  1: [node({ id: 3, parentId: 1, name: "interno", size: 80, childCount: 1 })],
  2: [node({ id: 6, parentId: 2, name: "x.txt", kind: "file", size: 10 })],
  3: [node({ id: 5, parentId: 3, name: "foglia.bin", kind: "file", size: 80 })],
};

const done = (scanId: number, extra: Partial<ScanDone> = {}): ScanDone => ({
  scanId,
  files: 2,
  dirs: 4,
  bytes: 110,
  denied: 0,
  elapsedMs: 1500,
  root: node({ id: 0, name: "C:\\", path: "C:\\", size: 110, childCount: 3 }),
  ...extra,
});

let handlers: ScanHandlers;
let appHandlers: AppSizeHandlers;
const state = () => useStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(useStore.getInitialState(), true);
  treeCache.clear();

  mocks.start.mockImplementation((_target: unknown, h: ScanHandlers) => {
    handlers = h;
    return mocks.cancelScan;
  });
  mocks.api.getChildren.mockImplementation(async (_scanId: number, ids: number[]) =>
    ids.map((parentId) => ({ parentId, children: TREE[parentId] ?? [] })),
  );
  mocks.listenAppSizes.mockImplementation(async (h: AppSizeHandlers) => {
    appHandlers = h;
    return () => {};
  });
  mocks.api.measureAppSizes.mockResolvedValue(undefined);
  mocks.api.cancelAppSizes.mockResolvedValue(true);
  mocks.api.listDrives.mockResolvedValue([]);
  mocks.api.getTopFiles.mockResolvedValue([]);
  mocks.api.getTypeStats.mockResolvedValue({ types: [], exts: [], totalSize: 0, totalFiles: 0 });
  mocks.api.openInExplorer.mockResolvedValue(undefined);
});

/** Avvia una scansione e ne simula il completamento. */
async function scanToResults(scanId = 1) {
  state().startScan({ path: "C:\\Dati" });
  handlers.onDone(done(scanId));
  await vi.waitFor(() => expect(state().screen).toBe("results"));
}

function installed(id: string, partial: Partial<InstalledApp> = {}): InstalledApp {
  return {
    id,
    name: id,
    version: null,
    publisher: null,
    installLocation: `C:\\Program Files\\${id}`,
    locationDerived: false,
    sharedLocation: false,
    estimatedSize: null,
    installDate: null,
    scope: "machine",
    ...partial,
  };
}

const appSize = (id: string, size: number): AppSize => ({
  id,
  status: "measured",
  path: `C:\\Program Files\\${id}`,
  size,
  disk: size,
  files: 1,
});

const measureDone = (partial: Partial<AppsMeasureDone> = {}): AppsMeasureDone => ({
  measured: 2,
  total: 2,
  cancelled: false,
  ...partial,
});

describe("app installate", () => {
  const APPS = [
    installed("git", { estimatedSize: 300 }),
    installed("nvm", { estimatedSize: 20 }),
    installed("senza-cartella", { installLocation: null, estimatedSize: 50 }),
  ];

  beforeEach(() => {
    mocks.api.listInstalledApps.mockResolvedValue(APPS);
  });

  it("aprendo la sezione carica l'elenco e avvia la misura delle cartelle", async () => {
    state().setSection("apps");
    expect(state().section).toBe("apps");
    await vi.waitFor(() => expect(mocks.api.measureAppSizes).toHaveBeenCalledWith([]));

    expect(state().apps).toEqual(APPS);
    expect(state().appsMeasuring).toBe(true);
    // Si misurano solo le app che dichiarano la cartella.
    expect(state().appsProgress).toEqual({ done: 0, total: 2 });
    // Ordine iniziale: per dimensione stimata.
    expect(state().appSortBasis).toEqual({ git: 300, nvm: 20, "senza-cartella": 50 });
  });

  it("non ricarica l'elenco ogni volta che si riapre la sezione", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().apps).not.toBeNull());
    state().setSection("disk");
    state().setSection("apps");
    await flush();
    expect(mocks.api.listInstalledApps).toHaveBeenCalledTimes(1);
  });

  it("registra i risultati man mano, avanza il progresso e a fine misura riordina", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    const orderBefore = { ...state().appSortBasis };

    appHandlers.onSize(appSize("nvm", 9000));
    expect(state().appSizes.nvm.size).toBe(9000);
    expect(state().appsProgress.done).toBe(1);
    // Durante la misura l'ordine non cambia: le righe non saltano.
    expect(state().appSortBasis).toEqual(orderBefore);

    appHandlers.onSize(appSize("git", 100));
    appHandlers.onDone(measureDone());
    expect(state().appsMeasuring).toBe(false);
    expect(state().appSortBasis).toMatchObject({ nvm: 9000, git: 100, "senza-cartella": 50 });
  });

  it("l'annullamento di una misura superata da una nuova non ferma quella nuova", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    appHandlers.onDone(measureDone({ cancelled: true, measured: 1 }));
    expect(state().appsMeasuring).toBe(true);
    // Un annullamento senza app da misurare (avvio fallito) invece chiude.
    appHandlers.onDone(measureDone({ cancelled: true, measured: 0, total: 0 }));
    expect(state().appsMeasuring).toBe(false);
  });

  it("annullando ferma la misura e riordina con quanto misurato", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    appHandlers.onSize(appSize("nvm", 9000));
    state().cancelAppSizes();
    expect(mocks.api.cancelAppSizes).toHaveBeenCalled();
    expect(state().appsMeasuring).toBe(false);
    expect(state().appSortBasis.nvm).toBe(9000);
  });

  it("cambiando ordinamento la base si ricalcola sulle misure correnti", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    appHandlers.onSize(appSize("nvm", 9000));
    state().setAppSort("size", -1); // stessa colonna: inverte la direzione
    expect(state().appSort).toEqual({ key: "size", dir: 1 });
    expect(state().appSortBasis.nvm).toBe(9000);
    state().setAppSort("name", 1);
    expect(state().appSort).toEqual({ key: "name", dir: 1 });
  });

  it("un errore nella lettura delle app non lascia la sezione in caricamento", async () => {
    mocks.api.listInstalledApps.mockRejectedValue(new Error("boom"));
    state().setSection("apps");
    await vi.waitFor(() => expect(state().toast).toContain("Elenco app"));
    expect(state().appsLoading).toBe(false);
    expect(state().apps).toEqual([]);
    expect(mocks.api.measureAppSizes).not.toHaveBeenCalled();
  });

  it("un errore nell'avvio della misura la chiude e permette di riprovare", async () => {
    mocks.api.measureAppSizes.mockRejectedValueOnce(new Error("boom"));
    state().setSection("apps");
    await vi.waitFor(() => expect(state().toast).toContain("Misura delle app"));
    expect(state().appsMeasuring).toBe(false);
    await state().measureApps();
    expect(state().appsMeasuring).toBe(true);
    // Dopo l'errore ci si registra di nuovo agli eventi.
    expect(mocks.listenAppSizes).toHaveBeenCalled();
  });

  it("senza app con cartella nota non si avvia nessuna misura", async () => {
    mocks.api.listInstalledApps.mockResolvedValue([installed("x", { installLocation: null })]);
    state().setSection("apps");
    await vi.waitFor(() => expect(state().apps).toHaveLength(1));
    await flush();
    expect(mocks.api.measureAppSizes).not.toHaveBeenCalled();
    expect(state().appsMeasuring).toBe(false);
  });

  it("analizzare un'app avvia la scansione della sua cartella e torna ai dischi", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().apps).not.toBeNull());
    state().analyzeApp(APPS[0]);
    expect(mocks.start).toHaveBeenCalledWith({ path: "C:\\Program Files\\git" }, expect.anything());
    expect(state().section).toBe("disk");
    expect(state().screen).toBe("scanning");

    mocks.start.mockClear();
    state().analyzeApp(APPS[2]); // nessuna cartella: non fa nulla
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("apre la cartella in Esplora risorse e ne copia il percorso", async () => {
    mocks.api.openInExplorer.mockResolvedValue(undefined);
    state().openAppFolder(APPS[0]);
    expect(mocks.api.openInExplorer).toHaveBeenCalledWith("C:\\Program Files\\git");

    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    state().copyAppPath(APPS[1]);
    expect(writeText).toHaveBeenCalledWith("C:\\Program Files\\nvm");
    vi.unstubAllGlobals();

    mocks.api.openInExplorer.mockClear();
    state().openAppFolder(APPS[2]);
    expect(mocks.api.openInExplorer).not.toHaveBeenCalled();
  });
});

describe("elenco delle unità", () => {
  it("lo spazio libero viene riletto a ogni scansione, all'inizio e alla fine", async () => {
    mocks.api.listDrives.mockResolvedValueOnce([
      { key: "C", letter: "C:", name: "OSDisk", kind: "NTFS", path: "C:\\", total: 100, used: 90 },
    ]);
    await state().loadDrives();
    expect(state().drives[0].used).toBe(90);
    mocks.api.listDrives.mockClear();

    // Nel frattempo l'utente ha cancellato dei file: lo spazio occupato scende a 60.
    mocks.api.listDrives.mockResolvedValue([
      { key: "C", letter: "C:", name: "OSDisk", kind: "NTFS", path: "C:\\", total: 100, used: 60 },
    ]);
    state().startScan({ path: "C:\\Dati" });
    expect(mocks.api.listDrives).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(state().drives[0].used).toBe(60));

    handlers.onDone(done(1));
    await vi.waitFor(() => expect(state().screen).toBe("results"));
    expect(mocks.api.listDrives).toHaveBeenCalledTimes(2);
  });

  it("un errore nella lettura delle unità non blocca l'app", async () => {
    mocks.api.listDrives.mockRejectedValue(new Error("boom"));
    await state().loadDrives();
    expect(state().toast).toContain("Elenco unità");
    expect(state().drives).toEqual([]);
  });
});

describe("scansione", () => {
  it("passa allo stato di scansione e aggiorna l'avanzamento", () => {
    state().startScan({ path: "C:\\Dati" });
    expect(state().screen).toBe("scanning");
    expect(mocks.start).toHaveBeenCalledWith({ path: "C:\\Dati" }, expect.anything());

    handlers.onProgress({ p: 0.5, cur: "C:\\Dati\\a", files: 3, dirs: 1, bytes: 9, elapsedMs: 10 });
    expect(state().scan).toMatchObject({ p: 0.5, files: 3 });
  });

  it("annullando ferma lo scanner e mostra la schermata di annullamento", () => {
    state().startScan({ path: "C:\\Dati" });
    mocks.cancelScan.mockClear(); // l'avvio può annullare una scansione rimasta da un test precedente
    handlers.onProgress({ p: null, cur: "x", files: 7, dirs: 1, bytes: 99, elapsedMs: 10 });
    state().cancelScan();
    expect(mocks.cancelScan).toHaveBeenCalledOnce();
    expect(state().screen).toBe("error");
    expect(state().error).toEqual({ kind: "cancelled", path: "C:\\Dati", files: 7, bytes: 99 });
  });

  it("avviare una nuova scansione annulla quella in corso", () => {
    state().startScan({ path: "C:\\Prima" });
    mocks.cancelScan.mockClear();
    state().startScan({ path: "C:\\Seconda" });
    expect(mocks.cancelScan).toHaveBeenCalledOnce();
    expect(state().target).toEqual({ path: "C:\\Seconda" });
  });

  it("accesso negato e altri errori", () => {
    state().startScan({ path: "C:\\Protetta" });
    handlers.onDenied();
    expect(state().screen).toBe("error");
    expect(state().error).toEqual({ kind: "denied", path: "C:\\Protetta" });

    state().startScan({ path: "C:\\Dati" });
    handlers.onError("boom");
    expect(state().screen).toBe("empty");
    expect(state().toast).toContain("boom");
  });

  it("al completamento carica la radice, espande le due cartelle più grandi e mostra i risultati", async () => {
    await scanToResults(7);
    const s = state();
    expect(s.scanId).toBe(7);
    expect(s.summary).toEqual({ files: 2, dirs: 4, bytes: 110, denied: 0 });
    expect(s.durationSec).toBe(2);
    expect(s.root?.name).toBe("C:\\");
    expect(s.selected).toBe(0);

    // Espansi: radice, "grande" (la più grande) e "interno" (la più grande dentro "grande").
    expect(s.expanded).toEqual({ 0: true, 1: true, 3: true });
    expect(mocks.api.getChildren).toHaveBeenCalledWith(7, [0]);
    expect(mocks.api.getChildren).toHaveBeenCalledWith(7, [1]);
    expect(mocks.api.getChildren).toHaveBeenCalledWith(7, [3]);
    expect(treeCache.get(0)?.children.map((c) => c.name)).toEqual(["grande", "piccola", "vuota"]);
    expect(treeCache.get(3)?.children[0].parent).toBe(treeCache.get(3));
  });

  it("memorizza le cartelle scansionate tra le recenti, ma non le unità intere", async () => {
    await scanToResults();
    expect(state().recents).toEqual(["C:\\Dati"]);

    state().startScan({ path: "C:\\", driveKey: "C" });
    handlers.onDone(done(2));
    await vi.waitFor(() => expect(state().scanId).toBe(2));
    await vi.waitFor(() => expect(state().screen).toBe("results"));
    expect(state().recents).toEqual(["C:\\Dati"]);
  });

  it("scarta i risultati di una scansione superata da una più recente", async () => {
    state().startScan({ path: "C:\\Prima" });
    const first = handlers;
    first.onDone(done(1));
    // La seconda scansione parte mentre la prima sta ancora caricando i dati.
    state().startScan({ path: "C:\\Seconda" });
    await flush();
    await flush();
    expect(state().screen).toBe("scanning");
    expect(state().root).toBeNull();
  });
});

describe("caricamento a richiesta", () => {
  it("espandendo una cartella ne carica i figli una sola volta", async () => {
    await scanToResults();
    mocks.api.getChildren.mockClear();

    state().toggle(2, true);
    await vi.waitFor(() => expect(treeCache.get(2)?.childrenLoaded).toBe(true));
    expect(mocks.api.getChildren).toHaveBeenCalledTimes(1);
    expect(state().expanded[2]).toBe(true);

    state().toggle(2, false);
    state().toggle(2, true);
    await flush();
    expect(mocks.api.getChildren).toHaveBeenCalledTimes(1);
    expect(state().expanded[2]).toBe(true);
  });

  it("la versione dell'albero cresce a ogni caricamento", async () => {
    await scanToResults();
    const before = state().treeVersion;
    state().toggle(2, true);
    await vi.waitFor(() => expect(state().treeVersion).toBeGreaterThan(before));
  });

  it("la treemap carica i figli della cartella e delle sue sottocartelle principali", async () => {
    await scanToResults();
    mocks.api.getChildren.mockClear();
    await state().setTmRoot(1);

    expect(state().tmRoot).toBe(1);
    // "interno" (3) era già caricata durante l'espansione iniziale: nessuna richiesta superflua.
    expect(mocks.api.getChildren).not.toHaveBeenCalled();

    await state().setTmRoot(2);
    expect(state().tmRoot).toBe(2);
    expect(treeCache.get(2)?.childrenLoaded).toBe(true);
  });

  it("rivela un nodo caricando le cartelle lungo il percorso", async () => {
    await scanToResults();
    mocks.api.getAncestors.mockResolvedValue([0, 2, 6]);
    const target = treeCache.upsert(TREE[2][0]);
    const request = state().treeFocusRequest;

    await state().reveal(target);
    expect(mocks.api.getAncestors).toHaveBeenCalledWith(1, 6);
    expect(treeCache.get(2)?.childrenLoaded).toBe(true);
    expect(state().expanded[0]).toBe(true);
    expect(state().expanded[2]).toBe(true);
    expect(state().selected).toBe(6);
    expect(state().tab).toBe("tree");
    expect(state().treeFocusRequest).toBe(request + 1);
  });
});

describe("viste Top file e Tipi", () => {
  it("carica i file più grandi, con il filtro per tipo", async () => {
    await scanToResults();
    mocks.api.getTopFiles.mockResolvedValue([
      node({ id: 5, parentId: 3, kind: "file", name: "foglia.bin", size: 80 }),
    ]);

    state().setTab("top");
    await vi.waitFor(() => expect(state().topFiles).toHaveLength(1));
    expect(mocks.api.getTopFiles).toHaveBeenLastCalledWith(1, null, 40);

    state().setTypeFilter("video");
    await vi.waitFor(() => expect(mocks.api.getTopFiles).toHaveBeenCalledTimes(2));
    expect(mocks.api.getTopFiles).toHaveBeenLastCalledWith(1, "video", 40);
  });

  it("da una riga della vista Tipi apre i Top file filtrati", async () => {
    await scanToResults();
    state().showTopFiles("doc");
    expect(state().tab).toBe("top");
    expect(state().typeFilter).toBe("doc");
    await vi.waitFor(() => expect(mocks.api.getTopFiles).toHaveBeenCalledWith(1, "doc", 40));
  });

  it("carica le statistiche per tipo una sola volta", async () => {
    await scanToResults();
    state().setTab("types");
    await vi.waitFor(() => expect(state().typeStats).not.toBeNull());
    state().setTab("tree");
    state().setTab("types");
    await flush();
    expect(mocks.api.getTypeStats).toHaveBeenCalledTimes(1);
  });
});

describe("azioni sui nodi", () => {
  it("apre in Esplora risorse", async () => {
    await scanToResults();
    const n = treeCache.get(1)!;
    state().act("open", n);
    expect(mocks.api.openInExplorer).toHaveBeenCalledWith(n.path);
    await vi.waitFor(() => expect(state().toast).toContain("Esplora risorse"));
  });

  it("riporta l'errore se Esplora risorse non si apre", async () => {
    await scanToResults();
    mocks.api.openInExplorer.mockRejectedValue("Percorso non trovato");
    state().act("open", treeCache.get(1)!);
    await vi.waitFor(() => expect(state().toast).toContain("Percorso non trovato"));
  });

  it("copia il percorso", async () => {
    await scanToResults();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    state().act("copy", treeCache.get(1)!);
    expect(writeText).toHaveBeenCalledWith("C:\\n1");
    vi.unstubAllGlobals();
  });

  it("la cartella scelta con la finestra di sistema viene scansionata", async () => {
    mocks.pickFolder.mockResolvedValue("D:\\Foto");
    await state().browseFolder();
    expect(mocks.start).toHaveBeenCalledWith({ path: "D:\\Foto" }, expect.anything());

    mocks.start.mockClear();
    mocks.pickFolder.mockResolvedValue(null);
    await state().browseFolder();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rivela la prima cartella non accessibile", async () => {
    await scanToResults();
    mocks.api.getDenied.mockResolvedValue([node({ id: 4, parentId: 0, kind: "denied" })]);
    mocks.api.getAncestors.mockResolvedValue([0, 4]);
    await state().revealDenied();
    expect(state().selected).toBe(4);
  });
});
