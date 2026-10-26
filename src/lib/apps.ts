import type { AppSize } from "../bindings/AppSize";
import type { InstalledApp } from "../bindings/InstalledApp";

export type AppSortKey = "name" | "publisher" | "size" | "disk";
export type AppSizes = Record<string, AppSize>;

/** Come va letta la dimensione mostrata per un'app. */
export type SizeInfo =
  | { kind: "measured"; size: number; disk: number; files: number }
  | { kind: "estimated"; size: number }
  | { kind: "missing" | "denied" | "failed" | "none" };

export function sizeInfo(app: InstalledApp, sizes: AppSizes): SizeInfo {
  const measured = sizes[app.id];
  if (measured?.status === "measured") {
    return { kind: "measured", size: measured.size, disk: measured.disk, files: measured.files };
  }
  // Qui `measured` può avere solo gli stati di errore: il caso "measured" è già stato gestito.
  if (measured) return { kind: measured.status };
  if (app.estimatedSize != null) return { kind: "estimated", size: app.estimatedSize };
  return { kind: "none" };
}

/** Dimensione usata per ordinare: misurata, altrimenti stimata, altrimenti -1. */
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
 * Ordina le app. Per dimensione si usa `basis` (non le misure correnti): durante la misura le righe
 * non saltano a ogni risultato, e l'ordine si aggiorna quando `basis` viene ricalcolata.
 */
export function sortApps(
  apps: InstalledApp[],
  key: AppSortKey,
  dir: 1 | -1,
  basis: Record<string, number>,
  sizes: AppSizes,
): InstalledApp[] {
  const byName = (a: InstalledApp, b: InstalledApp) => a.name.localeCompare(b.name, "it");
  const disk = (a: InstalledApp) => {
    const info = sizeInfo(a, sizes);
    return info.kind === "measured" ? info.disk : -1;
  };
  return apps.slice().sort((a, b) => {
    switch (key) {
      case "name":
        return dir * byName(a, b);
      case "publisher":
        return dir * (a.publisher ?? "").localeCompare(b.publisher ?? "", "it") || byName(a, b);
      case "size":
        return dir * ((basis[a.id] ?? -1) - (basis[b.id] ?? -1)) || byName(a, b);
      case "disk":
        return dir * (disk(a) - disk(b)) || byName(a, b);
    }
  });
}

export interface AppTotals {
  /** App di cui è stata misurata la cartella. */
  measuredApps: number;
  /** Dimensione delle cartelle misurate; le cartelle condivise contano una volta sola. */
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
