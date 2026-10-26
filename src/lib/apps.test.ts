import { describe, expect, it } from "vitest";
import type { AppSize } from "../bindings/AppSize";
import type { InstalledApp } from "../bindings/InstalledApp";
import { bestSize, bestSizes, filterApps, sizeInfo, sortApps, totals } from "./apps";

function app(id: string, partial: Partial<InstalledApp> = {}): InstalledApp {
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

function measured(
  id: string,
  size: number,
  disk = size,
  path = `C:\\Program Files\\${id}`,
): AppSize {
  return { id, status: "measured", path, size, disk, files: 10 };
}

describe("sizeInfo / bestSize", () => {
  it("prefers the measured size over the estimated one", () => {
    const a = app("a", { estimatedSize: 100 });
    expect(sizeInfo(a, { a: measured("a", 500, 600) })).toEqual({
      kind: "measured",
      size: 500,
      disk: 600,
      files: 10,
    });
    expect(bestSize(a, { a: measured("a", 500) })).toBe(500);
  });

  it("falls back to the registry estimate, then to no data", () => {
    expect(sizeInfo(app("a", { estimatedSize: 100 }), {})).toEqual({
      kind: "estimated",
      size: 100,
    });
    expect(sizeInfo(app("a"), {})).toEqual({ kind: "none" });
    expect(bestSize(app("a"), {})).toBe(-1);
  });

  it("reports the measurement error statuses, even if there is an estimate", () => {
    const a = app("a", { estimatedSize: 100 });
    for (const status of ["missing", "denied", "failed"] as const) {
      expect(sizeInfo(a, { a: { ...measured("a", 0), status } })).toEqual({ kind: status });
      expect(bestSize(a, { a: { ...measured("a", 0), status } })).toBe(-1);
    }
  });

  it("bestSizes covers all apps", () => {
    const apps = [app("a", { estimatedSize: 5 }), app("b")];
    expect(bestSizes(apps, { b: measured("b", 9) })).toEqual({ a: 5, b: 9 });
  });
});

describe("filterApps", () => {
  const apps = [
    app("Git", { publisher: "The Git Development Community" }),
    app("7-Zip", { publisher: "Igor Pavlov" }),
    app("Node.js", { publisher: null }),
  ];

  it("searches the name and the publisher, case-insensitively", () => {
    expect(filterApps(apps, "git").map((a) => a.id)).toEqual(["Git"]);
    expect(filterApps(apps, "PAVLOV").map((a) => a.id)).toEqual(["7-Zip"]);
    expect(filterApps(apps, "  node ").map((a) => a.id)).toEqual(["Node.js"]);
  });

  it("an empty search returns everything", () => {
    expect(filterApps(apps, "  ")).toBe(apps);
    expect(filterApps(apps, "zzz")).toEqual([]);
  });
});

describe("sortApps", () => {
  const apps = [
    app("b", { name: "Beta", publisher: "Zeta" }),
    app("a", { name: "Alfa", publisher: "Eta" }),
    app("c", { name: "Gamma", publisher: null }),
  ];
  const ids = (list: InstalledApp[]) => list.map((a) => a.id);

  it("sorts by name and by publisher", () => {
    expect(ids(sortApps(apps, "name", 1, {}, {}))).toEqual(["a", "b", "c"]);
    expect(ids(sortApps(apps, "name", -1, {}, {}))).toEqual(["c", "b", "a"]);
    // No publisher comes first; on a tie the name decides.
    expect(ids(sortApps(apps, "publisher", 1, {}, {}))).toEqual(["c", "a", "b"]);
  });

  it("by size uses the given basis, not the current measurements", () => {
    const basis = { a: 10, b: 30, c: 20 };
    const live = { a: measured("a", 999), b: measured("b", 1) }; // measurements that arrived later
    expect(ids(sortApps(apps, "size", -1, basis, live))).toEqual(["b", "c", "a"]);
    expect(ids(sortApps(apps, "size", 1, basis, live))).toEqual(["a", "c", "b"]);
  });

  it("by disk space uses the measurements, with unmeasured apps last", () => {
    const sizes = { a: measured("a", 1, 50), b: measured("b", 1, 80) };
    expect(ids(sortApps(apps, "disk", -1, {}, sizes))).toEqual(["b", "a", "c"]);
  });

  it("does not modify the original list", () => {
    const copy = [...apps];
    sortApps(apps, "name", -1, {}, {});
    expect(apps).toEqual(copy);
  });
});

describe("totals", () => {
  it("sums the measured folders, counting shared ones only once", () => {
    const apps = [app("word"), app("excel"), app("git"), app("unknown")];
    const office = "C:\\Program Files\\Microsoft Office";
    const sizes = {
      word: measured("word", 100, 120, office),
      excel: measured("excel", 100, 120, office.toUpperCase()),
      git: measured("git", 50, 60),
      unknown: { ...measured("unknown", 0), status: "missing" as const },
    };
    expect(totals(apps, sizes)).toEqual({ measuredApps: 3, size: 150, disk: 180 });
  });

  it("with no measurements the totals are zero", () => {
    expect(totals([app("a")], {})).toEqual({ measuredApps: 0, size: 0, disk: 0 });
  });
});
