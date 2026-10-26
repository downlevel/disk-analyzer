import type { AppSize } from "../bindings/AppSize";
import type { InstalledApp } from "../bindings/InstalledApp";

export type AppSortKey = "name" | "publisher" | "size" | "disk";
export type AppSizes = Record<string, AppSize>;

/** How the size shown for an app should be read. */
export type SizeInfo =
  | { kind: "measured"; size: number; disk: number; files: number }
  | { kind: "estimated"; size: number }
  | { kind: "missing" | "denied" | "failed" | "none" };

export function sizeInfo(app: InstalledApp, sizes: AppSizes): SizeInfo {
  const measured = sizes[app.id];
  if (measured?.status === "measured") {
    return { kind: "measured", size: measured.size, disk: measured.disk, files: measured.files };
  }
  // Here `measured` can only have the error statuses: the "measured" case is already handled.
  if (measured) return { kind: measured.status };
  if (app.estimatedSize != null) return { kind: "estimated", size: app.estimatedSize };
  return { kind: "none" };
}

/** Size used for sorting: measured, otherwise estimated, otherwise -1. */
export function bestSize(app: InstalledApp, sizes: AppSizes): number {
  const info = sizeInfo(app, sizes);
  return info.kind === "measured" || info.kind === "estimated" ? info.size : -1;
}

export function bestSizes(apps: InstalledApp[], sizes: AppSizes): Record<string, number> {
  return Object.fromEntries(apps.map((a) => [a.id, bestSize(a, sizes)]));
}

export function filterApps(apps: InstalledApp[], query: string): InstalledApp[] {
  const q = query.trim().toLowerCase();
  if (!q) return apps;
  return apps.filter(
    (a) => a.name.toLowerCase().includes(q) || (a.publisher ?? "").toLowerCase().includes(q),
  );
}

/**
 * Sorts apps. By size it uses `basis` (not the current measurements): while measuring, rows
 * don't jump on every result, and the order updates when `basis` is recomputed.
 */
export function sortApps(
  apps: InstalledApp[],
  key: AppSortKey,
  dir: 1 | -1,
  basis: Record<string, number>,
  sizes: AppSizes,
): InstalledApp[] {
  const byName = (a: InstalledApp, b: InstalledApp) => a.name.localeCompare(b.name, "en");
  const disk = (a: InstalledApp) => {
    const info = sizeInfo(a, sizes);
    return info.kind === "measured" ? info.disk : -1;
  };
  return apps.slice().sort((a, b) => {
    switch (key) {
      case "name":
        return dir * byName(a, b);
      case "publisher":
        return dir * (a.publisher ?? "").localeCompare(b.publisher ?? "", "en") || byName(a, b);
      case "size":
        return dir * ((basis[a.id] ?? -1) - (basis[b.id] ?? -1)) || byName(a, b);
      case "disk":
        return dir * (disk(a) - disk(b)) || byName(a, b);
    }
  });
}

export interface AppTotals {
  /** Apps whose folder has been measured. */
  measuredApps: number;
  /** Size of the measured folders; shared folders count only once. */
  size: number;
  disk: number;
}

export function totals(apps: InstalledApp[], sizes: AppSizes): AppTotals {
  const seen = new Set<string>();
  const t: AppTotals = { measuredApps: 0, size: 0, disk: 0 };
  for (const app of apps) {
    const s = sizes[app.id];
    if (s?.status !== "measured") continue;
    t.measuredApps++;
    const key = s.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    t.size += s.size;
    t.disk += s.disk;
  }
  return t;
}
