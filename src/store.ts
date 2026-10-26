import { create } from "zustand";
import type { Drive } from "./bindings/Drive";
import type { ScanDone } from "./bindings/ScanDone";
import type { TypeStats } from "./bindings/TypeStats";
import type { AppSize } from "./bindings/AppSize";
import type { InstalledApp } from "./bindings/InstalledApp";
import { bestSizes } from "./lib/apps";
import type { AppSizes, AppSortKey } from "./lib/apps";
import { TOP_FILES_LIMIT } from "./lib/constants";
import { TreeCache } from "./lib/treeCache";
import type {
  FileType,
  MenuSource,
  ScanError,
  ScanProgress,
  ScanTarget,
  Screen,
  SortKey,
  TabId,
  TreeNode,
} from "./lib/types";
import { api, pickFolder } from "./services/api";
import { listenAppSizes } from "./services/appSizes";
import { tauriScanner } from "./services/tauriScanner";

/** Nodi dell'albero ricevuti dal core. Modificata in place: le viste si aggiornano con `treeVersion`. */
export const treeCache = new TreeCache();

const EXT_LIMIT = 12;
/** Cartelle della treemap di cui si caricano anche i figli (quelle abbastanza grandi da avere un gruppo). */
const TREEMAP_GROUPS = 40;
/** Massimo di nodi per chiamata a `get_children` (limite del core). */
const CHILDREN_BATCH = 200;
const RECENTS_KEY = "disk-analyzer.recents";
const RECENTS_MAX = 8;

export interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
  from: MenuSource;
  keyboard: boolean;
}

export interface ScanSummary {
  files: number;
  dirs: number;
  bytes: number;
  denied: number;
}

export type TypeFilter = "all" | FileType;

/** Sezione dell'app: analisi dei dischi oppure elenco delle app installate. */
export type Section = "disk" | "apps";

interface State {
  section: Section;
  drives: Drive[];

  apps: InstalledApp[] | null;
  appsLoading: boolean;
  appSizes: AppSizes;
  appsMeasuring: boolean;
  appsProgress: { done: number; total: number };
  appQuery: string;
  appSort: { key: AppSortKey; dir: 1 | -1 };
  /** Dimensione usata per ordinare: si ricalcola a fine misura, così le righe non saltano. */
  appSortBasis: Record<string, number>;

  screen: Screen;
  target: ScanTarget | null;
  error: ScanError | null;
  scan: ScanProgress | null;

  scanId: number | null;
  root: TreeNode | null;
  summary: ScanSummary | null;
  scannedAt: string;
  durationSec: number;
  /** Incrementato a ogni modifica della cache: le viste che la leggono lo usano come dipendenza. */
  treeVersion: number;

  tab: TabId;
  sort: { key: SortKey; dir: 1 | -1 };
  expanded: Record<number, boolean>;
  selected: number | null;
  tmRoot: number | null;
  typeFilter: TypeFilter;
  topFiles: TreeNode[] | null;
  typeStats: TypeStats | null;

  recents: string[];
  sidebarManual: boolean | null;
  menu: MenuState | null;
  picker: { x: number; y: number } | null;
  toast: string | null;
  /** Incrementato per chiedere all'albero di prendere il focus e mostrare la riga selezionata. */
  treeFocusRequest: number;
}

interface Actions {
  setSection: (section: Section) => void;
  loadApps: () => Promise<void>;
  measureApps: () => Promise<void>;
  cancelAppSizes: () => void;
  setAppQuery: (query: string) => void;
  setAppSort: (key: AppSortKey, defaultDir: 1 | -1) => void;
  analyzeApp: (app: InstalledApp) => void;
  openAppFolder: (app: InstalledApp) => void;
  copyAppPath: (app: InstalledApp) => void;
  loadDrives: () => Promise<void>;
  startScan: (target: ScanTarget) => void;
  cancelScan: () => void;
  reset: () => void;
  setTab: (tab: TabId) => void;
  setSort: (key: SortKey, defaultDir: 1 | -1) => void;
  toggle: (id: number, force?: boolean) => void;
  select: (id: number) => void;
  setTmRoot: (id: number) => Promise<void>;
  setTypeFilter: (filter: TypeFilter) => void;
  showTopFiles: (filter: TypeFilter) => void;
  setSidebarManual: (collapsed: boolean) => void;
  openMenu: (menu: MenuState) => void;
  openPicker: (pos: { x: number; y: number }) => void;
  closeMenus: () => void;
  browseFolder: () => Promise<void>;
  act: (kind: "open" | "copy" | "map" | "tree", node: TreeNode) => void;
  reveal: (node: TreeNode) => Promise<void>;
  revealDenied: () => Promise<void>;
  showToast: (text: string) => void;
}

let cancelActiveScan: (() => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Cambia a ogni nuova scansione: scarta i risultati delle richieste ormai superate. */
let epoch = 0;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const isDriveRoot = (path: string) => /^[A-Za-z]:\\?$/.test(path);

function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === "string").slice(0, RECENTS_MAX)
      : [];
  } catch {
    return [];
  }
}

function saveRecents(recents: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // L'archiviazione può non essere disponibile: le cartelle recenti restano solo in memoria.
  }
}

export const useStore = create<State & Actions>((set, get) => {
  const bump = () => set((s) => ({ treeVersion: s.treeVersion + 1 }));
  const fail = (what: string) => (err: unknown) => get().showToast(`${what}: ${messageOf(err)}`);

  /** Carica dal core i figli dei nodi indicati, se non li abbiamo già. */
  async function ensureChildren(ids: number[]) {
    const scanId = get().scanId;
    if (scanId == null) return;
    const need = ids.filter((id) => {
      const n = treeCache.get(id);
      return n && !n.childrenLoaded && n.childCount > 0;
    });
    for (let i = 0; i < need.length; i += CHILDREN_BATCH) {
      const results = await api.getChildren(scanId, need.slice(i, i + CHILDREN_BATCH));
      if (get().scanId !== scanId) return; // nel frattempo è iniziata un'altra scansione
      for (const r of results) treeCache.setChildren(r.parentId, r.children);
    }
    if (need.length) bump();
  }

  /** Carica i figli della cartella e, dei suoi figli, le cartelle più grandi (le raffigura la treemap). */
  async function loadTreemapData(id: number) {
    await ensureChildren([id]);
    const node = treeCache.get(id);
    if (!node) return;
    const groups = node.children
      .filter((c) => c.isDir && !c.denied && c.childCount > 0)
      .sort((a, b) => b.size - a.size)
      .slice(0, TREEMAP_GROUPS)
      .map((c) => c.id);
    await ensureChildren(groups);
  }

  async function loadTopFiles() {
    const { scanId, typeFilter } = get();
    if (scanId == null) return;
    const nodes = await api.getTopFiles(
      scanId,
      typeFilter === "all" ? null : typeFilter,
      TOP_FILES_LIMIT,
    );
    const now = get();
    if (now.scanId !== scanId || now.typeFilter !== typeFilter) return;
    set((s) => ({
      topFiles: nodes.map((n) => treeCache.upsert(n)),
      treeVersion: s.treeVersion + 1,
    }));
  }

  async function loadTypeStats() {
    const { scanId, typeStats } = get();
    if (scanId == null || typeStats) return;
    const stats = await api.getTypeStats(scanId, EXT_LIMIT);
    if (get().scanId === scanId) set({ typeStats: stats });
  }

  /** Dati necessari alla vista indicata, caricati al primo accesso. */
  async function loadTabData(tab: TabId) {
    if (tab === "map") {
      const id = get().tmRoot;
      if (id != null) await loadTreemapData(id);
      bump();
    } else if (tab === "top") {
      await loadTopFiles();
    } else if (tab === "types") {
      await loadTypeStats();
    }
  }

  /** Espande la radice e le due cartelle più grandi lungo il percorso principale. */
  async function expandInitial(root: TreeNode): Promise<Record<number, boolean>> {
    const expanded: Record<number, boolean> = { [root.id]: true };
    await ensureChildren([root.id]);
    let node = root;
    for (let i = 0; i < 2; i++) {
      const next = node.children
        .filter((c) => c.isDir && !c.denied && c.childCount > 0)
        .sort((a, b) => b.size - a.size)[0];
      if (!next) break;
      expanded[next.id] = true;
      await ensureChildren([next.id]);
      node = next;
    }
    return expanded;
  }

  async function finishScan(target: ScanTarget, done: ScanDone, myEpoch: number) {
    try {
      treeCache.clear();
      const root = treeCache.upsert(done.root);
      set({ scanId: done.scanId });
      const expanded = await expandInitial(root);
      if (epoch !== myEpoch) return;

      const recents = isDriveRoot(target.path)
        ? get().recents
        : [target.path, ...get().recents.filter((p) => p !== target.path)].slice(0, RECENTS_MAX);
      saveRecents(recents);

      set((s) => ({
        screen: "results",
        scan: null,
        error: null,
        root,
        summary: { files: done.files, dirs: done.dirs, bytes: done.bytes, denied: done.denied },
        expanded,
        selected: root.id,
        tmRoot: root.id,
        typeFilter: "all",
        topFiles: null,
        typeStats: null,
        recents,
        scannedAt: new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
        durationSec: Math.max(1, Math.round(done.elapsedMs / 1000)),
        treeVersion: s.treeVersion + 1,
      }));
      void get().loadDrives();
      void loadTabData(get().tab).catch(fail("Caricamento dati"));
    } catch (err) {
      if (epoch !== myEpoch) return;
      set({ screen: "empty", scan: null, scanId: null });
      get().showToast(`Scansione non riuscita: ${messageOf(err)}`);
    }
  }

  // Eventi della misura delle app: ci si registra una sola volta, alla prima misura.
  let appListeners: Promise<unknown> | null = null;
  const ensureAppListeners = () =>
    (appListeners ??= listenAppSizes({
      onSize: (size: AppSize) =>
        set((s) => ({
          appSizes: { ...s.appSizes, [size.id]: size },
          appsProgress: { ...s.appsProgress, done: s.appsProgress.done + 1 },
        })),
      onDone: (done) => {
        // L'annullamento di una misura superata da una nuova non deve fermare quella nuova.
        if (done.cancelled && done.total > 0) return;
        set((s) => ({
          appsMeasuring: false,
          appSortBasis: bestSizes(s.apps ?? [], s.appSizes),
        }));
      },
    }));

  return {
    section: "disk",
    drives: [],

    apps: null,
    appsLoading: false,
    appSizes: {},
    appsMeasuring: false,
    appsProgress: { done: 0, total: 0 },
    appQuery: "",
    appSort: { key: "size", dir: -1 },
    appSortBasis: {},

    screen: "empty",
    target: null,
    error: null,
    scan: null,

    scanId: null,
    root: null,
    summary: null,
    scannedAt: "",
    durationSec: 0,
    treeVersion: 0,

    tab: "tree",
    sort: { key: "size", dir: -1 },
    expanded: {},
    selected: null,
    tmRoot: null,
    typeFilter: "all",
    topFiles: null,
    typeStats: null,

    recents: loadRecents(),
    sidebarManual: null,
    menu: null,
    picker: null,
    toast: null,
    treeFocusRequest: 0,

    loadDrives: async () => {
      try {
        set({ drives: await api.listDrives() });
      } catch (err) {
        fail("Elenco unità")(err);
      }
    },

    setSection: (section) => {
      set({ section });
      if (section === "apps" && get().apps === null && !get().appsLoading) {
        void get().loadApps();
      }
    },

    loadApps: async () => {
      set({ appsLoading: true });
      try {
        const apps = await api.listInstalledApps();
        set({ apps, appsLoading: false, appSizes: {}, appSortBasis: bestSizes(apps, {}) });
      } catch (err) {
        set({ apps: [], appsLoading: false });
        fail("Elenco app")(err);
        return;
      }
      void get().measureApps();
    },

    measureApps: async () => {
      const total = (get().apps ?? []).filter((a) => a.installLocation).length;
      if (!total) {
        set({ appsMeasuring: false });
        return;
      }
      set({ appsMeasuring: true, appsProgress: { done: 0, total } });
      try {
        await ensureAppListeners();
        await api.measureAppSizes([]);
      } catch (err) {
        appListeners = null;
        set({ appsMeasuring: false });
        fail("Misura delle app")(err);
      }
    },

    cancelAppSizes: () => {
      void api.cancelAppSizes().catch(() => {});
      set((s) => ({
        appsMeasuring: false,
        appSortBasis: bestSizes(s.apps ?? [], s.appSizes),
      }));
    },

    setAppQuery: (appQuery) => set({ appQuery }),

    setAppSort: (key, defaultDir) =>
      set((s) => ({
        appSort:
          s.appSort.key === key ? { key, dir: -s.appSort.dir as 1 | -1 } : { key, dir: defaultDir },
        appSortBasis: bestSizes(s.apps ?? [], s.appSizes),
      })),

    analyzeApp: (app) => {
      if (app.installLocation) get().startScan({ path: app.installLocation });
    },

    openAppFolder: (app) => {
      if (!app.installLocation) return;
      api.openInExplorer(app.installLocation).catch(fail("Apertura in Esplora risorse"));
    },

    copyAppPath: (app) => {
      if (!app.installLocation) return;
      navigator.clipboard?.writeText(app.installLocation).catch(() => {});
      get().showToast(`Percorso copiato: ${app.installLocation}`);
    },

    startScan: (target) => {
      cancelActiveScan?.();
      const myEpoch = ++epoch;
      set({
        section: "disk",
        screen: "scanning",
        target,
        error: null,
        menu: null,
        picker: null,
        scanId: null,
        root: null,
        scan: { p: null, cur: target.path, files: 0, dirs: 0, bytes: 0, elapsedMs: 0 },
      });
      // Lo spazio libero cambia fuori dall'app (file cancellati, download…): lo si rilegge
      // a ogni scansione, all'inizio e alla fine, e quando la finestra torna in primo piano.
      void get().loadDrives();
      cancelActiveScan = tauriScanner.start(target, {
        onProgress: (scan) => set({ scan }),
        onDenied: () => {
          cancelActiveScan = null;
          set({ screen: "error", scan: null, error: { kind: "denied", path: target.path } });
        },
        onError: (message) => {
          cancelActiveScan = null;
          set({ screen: "empty", scan: null });
          get().showToast(`Scansione non riuscita: ${message}`);
        },
        onDone: (done) => {
          cancelActiveScan = null;
          void finishScan(target, done, myEpoch);
        },
      });
    },

    cancelScan: () => {
      const { scan, target } = get();
      cancelActiveScan?.();
      cancelActiveScan = null;
      epoch++;
      set({
        screen: "error",
        scan: null,
        error: {
          kind: "cancelled",
          path: target?.path ?? "",
          files: scan?.files ?? 0,
          bytes: scan?.bytes ?? 0,
        },
      });
    },

    reset: () => set({ screen: "empty", target: null, error: null }),

    setTab: (tab) => {
      set({ tab });
      void loadTabData(tab).catch(fail("Caricamento dati"));
    },

    setSort: (key, defaultDir) =>
      set((s) => ({
        sort: s.sort.key === key ? { key, dir: -s.sort.dir as 1 | -1 } : { key, dir: defaultDir },
      })),

    toggle: (id, force) => {
      const open = force ?? !get().expanded[id];
      set((s) => ({ expanded: { ...s.expanded, [id]: open } }));
      if (open) void ensureChildren([id]).catch(fail("Caricamento cartella"));
    },

    select: (id) => set({ selected: id }),

    setTmRoot: async (id) => {
      try {
        await loadTreemapData(id);
      } catch (err) {
        fail("Caricamento cartella")(err);
        return;
      }
      set((s) => ({ tmRoot: id, treeVersion: s.treeVersion + 1 }));
    },

    setTypeFilter: (typeFilter) => {
      set({ typeFilter });
      void loadTopFiles().catch(fail("Caricamento file"));
    },

    showTopFiles: (typeFilter) => {
      set({ tab: "top", typeFilter });
      void loadTopFiles().catch(fail("Caricamento file"));
    },

    setSidebarManual: (collapsed) => set({ sidebarManual: collapsed }),

    openMenu: (menu) => set({ menu, picker: null, selected: menu.node.id }),
    openPicker: (picker) => set({ picker, menu: null }),
    closeMenus: () => {
      const from = get().menu?.from;
      set({ menu: null, picker: null });
      if (from === "tree") set((s) => ({ treeFocusRequest: s.treeFocusRequest + 1 }));
    },

    browseFolder: async () => {
      get().closeMenus();
      try {
        const path = await pickFolder();
        if (path) get().startScan({ path });
      } catch (err) {
        fail("Selezione cartella")(err);
      }
    },

    act: (kind, node) => {
      const from = get().menu?.from;
      set({ menu: null });
      if (kind === "open") {
        api
          .openInExplorer(node.path)
          .then(() => get().showToast(`Aperto in Esplora risorse: ${node.path}`))
          .catch(fail("Apertura in Esplora risorse"));
      } else if (kind === "copy") {
        navigator.clipboard?.writeText(node.path).catch(() => {});
        get().showToast(`Percorso copiato: ${node.path}`);
      } else if (kind === "map") {
        set({ tab: "map" });
        void get().setTmRoot(node.id);
      } else {
        void get().reveal(node).catch(fail("Caricamento cartella"));
      }
      if (from === "tree" && kind !== "map" && kind !== "tree") {
        set((s) => ({ treeFocusRequest: s.treeFocusRequest + 1 }));
      }
    },

    reveal: async (node) => {
      const scanId = get().scanId;
      if (scanId == null) return;
      const chain = await api.getAncestors(scanId, node.id);
      const parents = chain.slice(0, -1);
      await ensureChildren(parents);
      if (get().scanId !== scanId) return;
      const expanded = { ...get().expanded };
      for (const id of parents) expanded[id] = true;
      set((s) => ({
        tab: "tree",
        expanded,
        selected: node.id,
        treeFocusRequest: s.treeFocusRequest + 1,
      }));
    },

    revealDenied: async () => {
      const scanId = get().scanId;
      if (scanId == null) return;
      try {
        const [first] = await api.getDenied(scanId, 1);
        if (first) await get().reveal(treeCache.upsert(first));
      } catch (err) {
        fail("Caricamento cartelle")(err);
      }
    },

    showToast: (text) => {
      clearTimeout(toastTimer);
      set({ toast: text });
      toastTimer = setTimeout(() => set({ toast: null }), 2600);
    },
  };
});
