export type { FileType } from "../bindings/FileType";
import type { FileType } from "../bindings/FileType";

/** Elemento dell'albero lato interfaccia. I figli vengono caricati a richiesta dal core Rust. */
export interface TreeNode {
  id: number;
  name: string;
  path: string;
  parent: TreeNode | null;
  parentId: number | null;
  /** Cartella (anche non accessibile). */
  isDir: boolean;
  /** Cartella non accessibile (permesso negato). */
  denied?: boolean;
  /** Nodo sintetico "File (N)" che raggruppa i file di una cartella. */
  agg?: boolean;
  children: TreeNode[];
  /** Numero di figli esistenti (anche se non ancora caricati). */
  childCount: number;
  childrenLoaded: boolean;
  /** Dimensione logica in byte. */
  size: number;
  /** Dimensione su disco in byte. */
  disk: number;
  files: number;
  dirs: number;
  /** Tipo di file (solo file e nodi aggregati). */
  type?: FileType;
  ext?: string;
  modified?: string;
  /** Byte per tipo di file. */
  byType: Partial<Record<FileType, number>>;
}

export interface ScanTarget {
  path: string;
  driveKey?: string;
}

export interface ScanProgress {
  /** 0..1, oppure `null` se non stimabile (scansione di una cartella). */
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
