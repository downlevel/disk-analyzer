// Calls to the Tauri commands (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import type { ChildrenOf } from "../bindings/ChildrenOf";
import type { Drive } from "../bindings/Drive";
import type { InstalledApp } from "../bindings/InstalledApp";
import type { FileType } from "../bindings/FileType";
import type { Node } from "../bindings/Node";
import type { TypeStats } from "../bindings/TypeStats";

export const api = {
  listDrives: () => invoke<Drive[]>("list_drives"),

  /** Children of several nodes in a single call, each from the largest. */
  getChildren: (scanId: number, ids: number[]) =>
    invoke<ChildrenOf[]>("get_children", { scanId, ids }),

  getTopFiles: (scanId: number, fileType: FileType | null, limit: number) =>
    invoke<Node[]>("get_top_files", { scanId, fileType, limit }),

  getTypeStats: (scanId: number, extLimit: number) =>
    invoke<TypeStats>("get_type_stats", { scanId, extLimit }),

  /** Chain of ancestors from the root to the node (inclusive). */
  getAncestors: (scanId: number, id: number) => invoke<number[]>("get_ancestors", { scanId, id }),

  getDenied: (scanId: number, limit: number) => invoke<Node[]>("get_denied", { scanId, limit }),

  openInExplorer: (path: string) => invoke<void>("open_in_explorer", { path }),

  /** Installed desktop apps, from the Windows registry. */
  listInstalledApps: () => invoke<InstalledApp[]>("list_installed_apps"),

  /** Starts measuring the apps' folders (all if `ids` is empty); results arrive as events. */
  measureAppSizes: (ids: string[]) => invoke<void>("measure_app_sizes", { ids }),

  cancelAppSizes: () => invoke<boolean>("cancel_app_sizes"),
};

/** System dialog to choose a folder; `null` if the user cancels. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
