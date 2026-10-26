import type { FileType, TabId } from "./types";

export interface TypeInfo {
  key: FileType;
  label: string;
  color: string;
}

export const TYPES: TypeInfo[] = [
  { key: "video", label: "Video", color: "var(--t-video)" },
  { key: "img", label: "Images", color: "var(--t-img)" },
  { key: "doc", label: "Documents", color: "var(--t-doc)" },
  { key: "code", label: "Code", color: "var(--t-code)" },
  { key: "arch", label: "Archives", color: "var(--t-arch)" },
  { key: "other", label: "Other", color: "var(--t-other)" },
];

export const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.key, t])) as Record<
  FileType,
  TypeInfo
>;

export const TABS: { id: TabId; label: string }[] = [
  { id: "tree", label: "Tree" },
  { id: "map", label: "Treemap" },
  { id: "top", label: "Top files" },
  { id: "types", label: "Types" },
];

export const TAB_HINTS: Record<TabId, string> = {
  tree: "↑ ↓ to move · ← → to collapse/expand · Shift+F10 for actions",
  map: "Click a folder to enter it · right-click for actions",
  top: "The 40 largest files in the scan",
  types: "Click a type to filter Top files",
};

export const TREE_ROW_H = 32;
export const TOP_ROW_H = 46;
export const TOP_FILES_LIMIT = 40;
