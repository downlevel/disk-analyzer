export type { FileType } from "../bindings/FileType";
import type { FileType } from "../bindings/FileType";

/** Tree item on the UI side. Children are loaded on demand from the Rust core. */
export interface TreeNode {
  id: number;
  name: string;
  path: string;
  parent: TreeNode | null;
  parentId: number | null;
  /** Folder (even if inaccessible). */
  isDir: boolean;
  /** Inaccessible folder (permission denied). */
  denied?: boolean;
  /** Synthetic "File (N)" node that groups a folder's files. */
  agg?: boolean;
  children: TreeNode[];
  /** Number of existing children (even if not loaded yet). */
  childCount: number;
  childrenLoaded: boolean;
  /** Logical size in bytes. */
  size: number;
  /** Size on disk in bytes. */
  disk: number;
  files: number;
  dirs: number;
  /** File type (files and aggregate nodes only). */
  type?: FileType;
  ext?: string;
  modified?: string;
  /** Bytes per file type. */
  byType: Partial<Record<FileType, number>>;
}

export interface ScanTarget {
  path: string;
  driveKey?: string;
}

export interface ScanProgress {
  /** 0..1, or `null` if it can't be estimated (scanning a folder). */
  p: number | null;
  cur: string;
  files: number;
  dirs: number;
  bytes: number;
  elapsedMs: number;
}

export type Screen = "empty" | "scanning" | "results" | "error";
export type TabId = "tree" | "map" | "top" | "types";
export type SortKey = "name" | "size" | "disk" | "files";
export type MenuSource = "tree" | "map" | "top";

export type ScanError =
  | { kind: "denied"; path: string }
  | { kind: "cancelled"; path: string; files: number; bytes: number };
