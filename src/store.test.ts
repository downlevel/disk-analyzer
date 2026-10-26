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
 * ├─ big (1, 100 B) ── inner (3, 80 B) ── leaf (5, 80 B, file)
 * ├─ small (2, 10 B)
 * └─ empty (4, 0 B)
 */
const TREE: Record<number, Node[]> = {
  0: [
    node({ id: 1, parentId: 0, name: "big", size: 100, childCount: 1 }),
    node({ id: 2, parentId: 0, name: "small", size: 10, childCount: 1 }),
    node({ id: 4, parentId: 0, name: "empty" }),
  ],
  1: [node({ id: 3, parentId: 1, name: "inner", size: 80, childCount: 1 })],
  2: [node({ id: 6, parentId: 2, name: "x.txt", kind: "file", size: 10 })],
  3: [node({ id: 5, parentId: 3, name: "leaf.bin", kind: "file", size: 80 })],
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

/** Starts a scan and simulates its completion. */
async function scanToResults(scanId = 1) {
  state().startScan({ path: "C:\\Data" });
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

describe("installed apps", () => {
  const APPS = [
    installed("git", { estimatedSize: 300 }),
    installed("nvm", { estimatedSize: 20 }),
    installed("no-folder", { installLocation: null, estimatedSize: 50 }),
  ];

  beforeEach(() => {
    mocks.api.listInstalledApps.mockResolvedValue(APPS);
  });

  it("opening the section loads the list and starts measuring the folders", async () => {
    state().setSection("apps");
    expect(state().section).toBe("apps");
    await vi.waitFor(() => expect(mocks.api.measureAppSizes).toHaveBeenCalledWith([]));

    expect(state().apps).toEqual(APPS);
    expect(state().appsMeasuring).toBe(true);
    // Only apps that declare a folder are measured.
    expect(state().appsProgress).toEqual({ done: 0, total: 2 });
    // Initial order: by estimated size.
    expect(state().appSortBasis).toEqual({ git: 300, nvm: 20, "no-folder": 50 });
  });

  it("does not reload the list every time the section is reopened", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().apps).not.toBeNull());
    state().setSection("disk");
    state().setSection("apps");
    await flush();
    expect(mocks.api.listInstalledApps).toHaveBeenCalledTimes(1);
  });

  it("records results as they arrive, advances progress and re-sorts when measuring ends", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    const orderBefore = { ...state().appSortBasis };

    appHandlers.onSize(appSize("nvm", 9000));
    expect(state().appSizes.nvm.size).toBe(9000);
    expect(state().appsProgress.done).toBe(1);
    // While measuring, the order does not change: rows don't jump around.
    expect(state().appSortBasis).toEqual(orderBefore);

    appHandlers.onSize(appSize("git", 100));
    appHandlers.onDone(measureDone());
    expect(state().appsMeasuring).toBe(false);
    expect(state().appSortBasis).toMatchObject({ nvm: 9000, git: 100, "no-folder": 50 });
  });

  it("cancelling a measurement superseded by a new one does not stop the new one", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    appHandlers.onDone(measureDone({ cancelled: true, measured: 1 }));
    expect(state().appsMeasuring).toBe(true);
    // A cancellation with no apps to measure (failed start) closes instead.
    appHandlers.onDone(measureDone({ cancelled: true, measured: 0, total: 0 }));
    expect(state().appsMeasuring).toBe(false);
  });

  it("cancelling stops the measurement and re-sorts with what was measured", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    appHandlers.onSize(appSize("nvm", 9000));
    state().cancelAppSizes();
    expect(mocks.api.cancelAppSizes).toHaveBeenCalled();
    expect(state().appsMeasuring).toBe(false);
    expect(state().appSortBasis.nvm).toBe(9000);
  });

  it("changing the sort recomputes the basis from the current measurements", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().appsMeasuring).toBe(true));
    appHandlers.onSize(appSize("nvm", 9000));
    state().setAppSort("size", -1); // same column: reverses the direction
    expect(state().appSort).toEqual({ key: "size", dir: 1 });
    expect(state().appSortBasis.nvm).toBe(9000);
    state().setAppSort("name", 1);
    expect(state().appSort).toEqual({ key: "name", dir: 1 });
  });

  it("an error reading the apps does not leave the section loading", async () => {
    mocks.api.listInstalledApps.mockRejectedValue(new Error("boom"));
    state().setSection("apps");
    await vi.waitFor(() => expect(state().toast).toContain("Listing apps"));
    expect(state().appsLoading).toBe(false);
    expect(state().apps).toEqual([]);
    expect(mocks.api.measureAppSizes).not.toHaveBeenCalled();
  });

  it("an error starting the measurement closes it and allows retrying", async () => {
    mocks.api.measureAppSizes.mockRejectedValueOnce(new Error("boom"));
    state().setSection("apps");
    await vi.waitFor(() => expect(state().toast).toContain("Measuring apps"));
    expect(state().appsMeasuring).toBe(false);
    await state().measureApps();
    expect(state().appsMeasuring).toBe(true);
    // After the error, the events are registered again.
    expect(mocks.listenAppSizes).toHaveBeenCalled();
  });

  it("with no app that has a known folder, no measurement starts", async () => {
    mocks.api.listInstalledApps.mockResolvedValue([installed("x", { installLocation: null })]);
    state().setSection("apps");
    await vi.waitFor(() => expect(state().apps).toHaveLength(1));
    await flush();
    expect(mocks.api.measureAppSizes).not.toHaveBeenCalled();
    expect(state().appsMeasuring).toBe(false);
  });

  it("analyzing an app scans its folder and goes back to the disks", async () => {
    state().setSection("apps");
    await vi.waitFor(() => expect(state().apps).not.toBeNull());
    state().analyzeApp(APPS[0]);
    expect(mocks.start).toHaveBeenCalledWith({ path: "C:\\Program Files\\git" }, expect.anything());
    expect(state().section).toBe("disk");
    expect(state().screen).toBe("scanning");

    mocks.start.mockClear();
    state().analyzeApp(APPS[2]); // no folder: does nothing
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("opens the folder in File Explorer and copies its path", async () => {
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

describe("drive list", () => {
  it("free space is re-read on every scan, at the start and at the end", async () => {
    mocks.api.listDrives.mockResolvedValueOnce([
      { key: "C", letter: "C:", name: "OSDisk", kind: "NTFS", path: "C:\\", total: 100, used: 90 },
    ]);
    await state().loadDrives();
    expect(state().drives[0].used).toBe(90);
    mocks.api.listDrives.mockClear();

    // Meanwhile the user deleted some files: used space drops to 60.
    mocks.api.listDrives.mockResolvedValue([
      { key: "C", letter: "C:", name: "OSDisk", kind: "NTFS", path: "C:\\", total: 100, used: 60 },
    ]);
    state().startScan({ path: "C:\\Data" });
    expect(mocks.api.listDrives).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(state().drives[0].used).toBe(60));

    handlers.onDone(done(1));
    await vi.waitFor(() => expect(state().screen).toBe("results"));
    expect(mocks.api.listDrives).toHaveBeenCalledTimes(2);
  });

  it("an error reading the drives does not block the app", async () => {
    mocks.api.listDrives.mockRejectedValue(new Error("boom"));
    await state().loadDrives();
    expect(state().toast).toContain("Listing drives");
    expect(state().drives).toEqual([]);
  });
});

describe("scan", () => {
  it("switches to the scanning state and updates progress", () => {
    state().startScan({ path: "C:\\Data" });
    expect(state().screen).toBe("scanning");
    expect(mocks.start).toHaveBeenCalledWith({ path: "C:\\Data" }, expect.anything());

    handlers.onProgress({ p: 0.5, cur: "C:\\Data\\a", files: 3, dirs: 1, bytes: 9, elapsedMs: 10 });
    expect(state().scan).toMatchObject({ p: 0.5, files: 3 });
  });

  it("cancelling stops the scanner and shows the cancellation screen", () => {
    state().startScan({ path: "C:\\Data" });
    mocks.cancelScan.mockClear(); // starting can cancel a scan left over from a previous test
    handlers.onProgress({ p: null, cur: "x", files: 7, dirs: 1, bytes: 99, elapsedMs: 10 });
    state().cancelScan();
    expect(mocks.cancelScan).toHaveBeenCalledOnce();
    expect(state().screen).toBe("error");
    expect(state().error).toEqual({ kind: "cancelled", path: "C:\\Data", files: 7, bytes: 99 });
  });

  it("starting a new scan cancels the one in progress", () => {
    state().startScan({ path: "C:\\First" });
    mocks.cancelScan.mockClear();
    state().startScan({ path: "C:\\Second" });
    expect(mocks.cancelScan).toHaveBeenCalledOnce();
    expect(state().target).toEqual({ path: "C:\\Second" });
  });

  it("access denied and other errors", () => {
    state().startScan({ path: "C:\\Protected" });
    handlers.onDenied();
    expect(state().screen).toBe("error");
    expect(state().error).toEqual({ kind: "denied", path: "C:\\Protected" });

    state().startScan({ path: "C:\\Data" });
    handlers.onError("boom");
    expect(state().screen).toBe("empty");
    expect(state().toast).toContain("boom");
  });

  it("on completion loads the root, expands the two largest folders and shows the results", async () => {
    await scanToResults(7);
    const s = state();
    expect(s.scanId).toBe(7);
    expect(s.summary).toEqual({ files: 2, dirs: 4, bytes: 110, denied: 0 });
    expect(s.durationSec).toBe(2);
    expect(s.root?.name).toBe("C:\\");
    expect(s.selected).toBe(0);

    // Expanded: root, "big" (the largest) and "inner" (the largest inside "big").
    expect(s.expanded).toEqual({ 0: true, 1: true, 3: true });
    expect(mocks.api.getChildren).toHaveBeenCalledWith(7, [0]);
    expect(mocks.api.getChildren).toHaveBeenCalledWith(7, [1]);
    expect(mocks.api.getChildren).toHaveBeenCalledWith(7, [3]);
    expect(treeCache.get(0)?.children.map((c) => c.name)).toEqual(["big", "small", "empty"]);
    expect(treeCache.get(3)?.children[0].parent).toBe(treeCache.get(3));
  });

  it("remembers scanned folders among the recents, but not whole drives", async () => {
    await scanToResults();
    expect(state().recents).toEqual(["C:\\Data"]);

    state().startScan({ path: "C:\\", driveKey: "C" });
    handlers.onDone(done(2));
    await vi.waitFor(() => expect(state().scanId).toBe(2));
    await vi.waitFor(() => expect(state().screen).toBe("results"));
    expect(state().recents).toEqual(["C:\\Data"]);
  });

  it("discards the results of a scan superseded by a more recent one", async () => {
    state().startScan({ path: "C:\\First" });
    const first = handlers;
    first.onDone(done(1));
    // The second scan starts while the first is still loading data.
    state().startScan({ path: "C:\\Second" });
    await flush();
    await flush();
    expect(state().screen).toBe("scanning");
    expect(state().root).toBeNull();
  });
});

describe("on-demand loading", () => {
  it("expanding a folder loads its children only once", async () => {
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

  it("the tree version grows with every load", async () => {
    await scanToResults();
    const before = state().treeVersion;
    state().toggle(2, true);
    await vi.waitFor(() => expect(state().treeVersion).toBeGreaterThan(before));
  });

  it("the treemap loads the children of the folder and of its main subfolders", async () => {
    await scanToResults();
    mocks.api.getChildren.mockClear();
    await state().setTmRoot(1);

    expect(state().tmRoot).toBe(1);
    // "inner" (3) was already loaded during the initial expansion: no superfluous request.
    expect(mocks.api.getChildren).not.toHaveBeenCalled();

    await state().setTmRoot(2);
    expect(state().tmRoot).toBe(2);
    expect(treeCache.get(2)?.childrenLoaded).toBe(true);
  });

  it("reveals a node by loading the folders along the path", async () => {
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

describe("Top files and Types views", () => {
  it("loads the largest files, with the type filter", async () => {
    await scanToResults();
    mocks.api.getTopFiles.mockResolvedValue([
      node({ id: 5, parentId: 3, kind: "file", name: "leaf.bin", size: 80 }),
    ]);

    state().setTab("top");
    await vi.waitFor(() => expect(state().topFiles).toHaveLength(1));
    expect(mocks.api.getTopFiles).toHaveBeenLastCalledWith(1, null, 40);

    state().setTypeFilter("video");
    await vi.waitFor(() => expect(mocks.api.getTopFiles).toHaveBeenCalledTimes(2));
    expect(mocks.api.getTopFiles).toHaveBeenLastCalledWith(1, "video", 40);
  });

  it("from a Types view row, opens the filtered Top files", async () => {
    await scanToResults();
    state().showTopFiles("doc");
    expect(state().tab).toBe("top");
    expect(state().typeFilter).toBe("doc");
    await vi.waitFor(() => expect(mocks.api.getTopFiles).toHaveBeenCalledWith(1, "doc", 40));
  });

  it("loads the per-type statistics only once", async () => {
    await scanToResults();
    state().setTab("types");
    await vi.waitFor(() => expect(state().typeStats).not.toBeNull());
    state().setTab("tree");
    state().setTab("types");
    await flush();
    expect(mocks.api.getTypeStats).toHaveBeenCalledTimes(1);
  });
});

describe("node actions", () => {
  it("opens in File Explorer", async () => {
    await scanToResults();
    const n = treeCache.get(1)!;
    state().act("open", n);
    expect(mocks.api.openInExplorer).toHaveBeenCalledWith(n.path);
    await vi.waitFor(() => expect(state().toast).toContain("File Explorer"));
  });

  it("reports the error if File Explorer fails to open", async () => {
    await scanToResults();
    mocks.api.openInExplorer.mockRejectedValue("Path not found");
    state().act("open", treeCache.get(1)!);
    await vi.waitFor(() => expect(state().toast).toContain("Path not found"));
  });

  it("copies the path", async () => {
    await scanToResults();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    state().act("copy", treeCache.get(1)!);
    expect(writeText).toHaveBeenCalledWith("C:\\n1");
    vi.unstubAllGlobals();
  });

  it("the folder chosen with the system dialog gets scanned", async () => {
    mocks.pickFolder.mockResolvedValue("D:\\Photos");
    await state().browseFolder();
    expect(mocks.start).toHaveBeenCalledWith({ path: "D:\\Photos" }, expect.anything());

    mocks.start.mockClear();
    mocks.pickFolder.mockResolvedValue(null);
    await state().browseFolder();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("reveals the first inaccessible folder", async () => {
    await scanToResults();
    mocks.api.getDenied.mockResolvedValue([node({ id: 4, parentId: 0, kind: "denied" })]);
    mocks.api.getAncestors.mockResolvedValue([0, 4]);
    await state().revealDenied();
    expect(state().selected).toBe(4);
  });
});
