import type { FileType, TabId } from "./types";

export interface TypeInfo {
  key: FileType;
  label: string;
  color: string;
}

export const TYPES: TypeInfo[] = [
  { key: "video", label: "Video", color: "var(--t-video)" },
  { key: "img", label: "Immagini", color: "var(--t-img)" },
  { key: "doc", label: "Documenti", color: "var(--t-doc)" },
  { key: "code", label: "Codice", color: "var(--t-code)" },
  { key: "arch", label: "Archivi", color: "var(--t-arch)" },
  { key: "other", label: "Altro", color: "var(--t-other)" },
];

export const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.key, t])) as Record<
  FileType,
  TypeInfo
>;

export const TABS: { id: TabId; label: string }[] = [
  { id: "tree", label: "Albero" },
  { id: "map", label: "Treemap" },
  { id: "top", label: "Top file" },
  { id: "types", label: "Tipi" },
];

export const TAB_HINTS: Record<TabId, string> = {
  tree: "↑ ↓ per spostarti · ← → per comprimere/espandere · Maiusc+F10 per le azioni",
  map: "Clic su una cartella per entrare · clic destro per le azioni",
  top: "I 40 file più grandi della scansione",
  types: "Clic su un tipo per filtrare i Top file",
};

export const TREE_ROW_H = 32;
export const TOP_ROW_H = 46;
export const TOP_FILES_LIMIT = 40;
