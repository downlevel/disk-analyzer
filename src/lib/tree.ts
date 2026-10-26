import type { FileType, SortKey, TreeNode } from "./types";

/** Tipo prevalente (per dimensione) di una cartella. */
export function dominantType(n: TreeNode): FileType {
  let best: FileType = "other";
  let max = -1;
  for (const [k, v] of Object.entries(n.byType) as [FileType, number][]) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

export function nodeType(n: TreeNode): FileType {
  return n.isDir ? dominantType(n) : (n.type ?? "other");
}

export function sortChildren(n: TreeNode, key: SortKey, dir: 1 | -1): TreeNode[] {
  return n.children.slice().sort((a, b) => {
    if (!!a.agg !== !!b.agg) return a.agg ? 1 : -1;
    if (key === "name") return dir * a.name.localeCompare(b.name, "it");
    return dir * (a[key] - b[key]) || a.name.localeCompare(b.name, "it");
  });
}

/** Cartella che contiene un nodo, ricavata dal percorso. */
export function dirnameOf(path: string): string {
  const i = path.lastIndexOf("\\");
  if (i < 0) return path;
  return i <= 2 ? path.slice(0, i + 1) : path.slice(0, i);
}
