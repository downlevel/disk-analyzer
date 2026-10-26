// Chiamate ai comandi Tauri (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import type { ChildrenOf } from "../bindings/ChildrenOf";
import type { Drive } from "../bindings/Drive";
import type { InstalledApp } from "../bindings/InstalledApp";
import type { FileType } from "../bindings/FileType";
import type { Node } from "../bindings/Node";
import type { TypeStats } from "../bindings/TypeStats";

export const api = {
  listDrives: () => invoke<Drive[]>("list_drives"),

  /** Figli di più nodi in un'unica chiamata, ciascuno dal più grande. */
  getChildren: (scanId: number, ids: number[]) =>
    invoke<ChildrenOf[]>("get_children", { scanId, ids }),

  getTopFiles: (scanId: number, fileType: FileType | null, limit: number) =>
    invoke<Node[]>("get_top_files", { scanId, fileType, limit }),

  getTypeStats: (scanId: number, extLimit: number) =>
    invoke<TypeStats>("get_type_stats", { scanId, extLimit }),

  /** Catena di antenati dalla radice al nodo (incluso). */
  getAncestors: (scanId: number, id: number) => invoke<number[]>("get_ancestors", { scanId, id }),

  getDenied: (scanId: number, limit: number) => invoke<Node[]>("get_denied", { scanId, limit }),

  openInExplorer: (path: string) => invoke<void>("open_in_explorer", { path }),

  /** App desktop installate, dal registro di Windows. */
  listInstalledApps: () => invoke<InstalledApp[]>("list_installed_apps"),

  /** Avvia la misura delle cartelle delle app (tutte se `ids` è vuoto); i risultati arrivano come eventi. */
  measureAppSizes: (ids: string[]) => invoke<void>("measure_app_sizes", { ids }),

  cancelAppSizes: () => invoke<boolean>("cancel_app_sizes"),
};

/** Finestra di sistema per scegliere una cartella; `null` se l'utente annulla. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
