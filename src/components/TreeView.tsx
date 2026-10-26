import { ChevronRight, File, Folder, Lock } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openMenuAt, openNodeMenu } from "../hooks";
import { TREE_ROW_H, TYPE_MAP } from "../lib/constants";
import { fmtInt, fmtPct, fmtSize } from "../lib/format";
import { sortChildren } from "../lib/tree";
import type { SortKey, TreeNode } from "../lib/types";
import { useStore } from "../store";

const HEADER_H = 34;
/** Righe disegnate oltre quelle visibili, sopra e sotto. */
const OVERSCAN_ROWS = 10;
const GRID =
  "grid grid-cols-[minmax(260px,1fr)_108px_108px_minmax(170px,230px)_96px] items-center gap-x-3 px-4";

interface Row {
  node: TreeNode;
  depth: number;
}

function flatten(
  root: TreeNode,
  expanded: Record<number, boolean>,
  key: SortKey,
  dir: 1 | -1,
): Row[] {
  const out: Row[] = [];
  const walk = (node: TreeNode, depth: number) => {
    out.push({ node, depth });
    if (node.isDir && expanded[node.id]) {
      for (const c of sortChildren(node, key, dir)) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function SortHeader({
  label,
  sortKey,
  defaultDir,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  defaultDir: 1 | -1;
  align?: "left" | "right";
}) {
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const active = sort.key === sortKey;
  const aria = active ? (sort.dir > 0 ? "ascending" : "descending") : "none";
  return (
    <div role="columnheader" aria-sort={aria} className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setSort(sortKey, defaultDir)}
        className={`p-0 font-medium ${active ? "text-fg" : "text-muted-fg"}`}
      >
        {label} {active ? (sort.dir > 0 ? "↑" : "↓") : ""}
      </button>
    </div>
  );
}

export function TreeView({ root }: { root: TreeNode }) {
  const expanded = useStore((s) => s.expanded);
  const selected = useStore((s) => s.selected);
  const sort = useStore((s) => s.sort);
  const focusRequest = useStore((s) => s.treeFocusRequest);
  const toggle = useStore((s) => s.toggle);
  const select = useStore((s) => s.select);
  const act = useStore((s) => s.act);
  // I figli vengono caricati a richiesta: la versione della cache segnala quando sono cambiati.
  const treeVersion = useStore((s) => s.treeVersion);

  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const rows = useMemo(
    () => flatten(root, expanded, sort.key, sort.dir),
    // treeVersion: la cache dei nodi è mutabile, il numero di versione la rende osservabile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, expanded, sort.key, sort.dir, treeVersion],
  );

  // Virtualizzazione: si disegnano solo le righe visibili più un po' di margine; il resto è
  // sostituito da due spaziatori della stessa altezza, così la barra di scorrimento resta fedele.
  const [scrollRow, setScrollRow] = useState(0);
  const [viewRows, setViewRows] = useState(30);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewRows(Math.ceil(el.clientHeight / TREE_ROW_H));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const start = Math.max(0, scrollRow - OVERSCAN_ROWS);
  const end = Math.min(rows.length, scrollRow + viewRows + OVERSCAN_ROWS);

  const ensureVisible = (i: number) => {
    const el = containerRef.current;
    if (!el) return;
    const top = i * TREE_ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + TREE_ROW_H > el.scrollTop + el.clientHeight - HEADER_H) {
      el.scrollTop = top + TREE_ROW_H - el.clientHeight + HEADER_H;
    }
  };

  // Su richiesta (reveal, chiusura menu) mostra la riga selezionata e riporta il focus sull'albero.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    if (!focusRequest) return;
    const i = rowsRef.current.findIndex((r) => r.node.id === useStore.getState().selected);
    const t = setTimeout(() => {
      if (i >= 0) ensureVisible(i);
      containerRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [focusRequest]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.node.id === selected);
    if (i < 0) i = 0;
    const { node } = rows[i];
    const hasKids = node.isDir && node.childCount > 0;
    const isOpen = !!expanded[node.id];

    if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      act("copy", node);
      return;
    }
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const b = containerRef.current?.getBoundingClientRect();
      if (b) {
        const y = b.top + HEADER_H + (i + 1) * TREE_ROW_H - (containerRef.current?.scrollTop ?? 0);
        openMenuAt(b.left + 120, y, node, "tree", true);
      }
      return;
    }

    let next: number | null = null;
    switch (e.key) {
      case "ArrowDown":
        next = Math.min(rows.length - 1, i + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, i - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = rows.length - 1;
        break;
      case "PageDown":
        next = Math.min(rows.length - 1, i + 10);
        break;
      case "PageUp":
        next = Math.max(0, i - 10);
        break;
      case "ArrowRight":
        if (hasKids) {
          if (!isOpen) toggle(node.id, true);
          else next = i + 1;
        }
        break;
      case "ArrowLeft":
        if (hasKids && isOpen) toggle(node.id, false);
        else if (node.parent) {
          const pi = rows.findIndex((r) => r.node === node.parent);
          if (pi >= 0) next = pi;
        }
        break;
      case "Enter":
      case " ":
        if (hasKids) toggle(node.id);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next != null) {
      select(rows[next].node.id);
      ensureVisible(next);
    }
  };

  return (
    <div
      ref={containerRef}
      role="treegrid"
      aria-label="Albero delle cartelle"
      aria-readonly="true"
      aria-rowcount={rows.length + 1}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollRow(Math.floor(e.currentTarget.scrollTop / TREE_ROW_H))}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      className="min-h-0 flex-1 overflow-auto outline-none"
    >
      <div
        role="row"
        aria-rowindex={1}
        style={{ height: HEADER_H }}
        className={`${GRID} sticky top-0 z-[1] border-b border-border bg-bg text-xs font-medium text-muted-fg`}
      >
        <SortHeader label="Nome" sortKey="name" defaultDir={1} align="left" />
        <SortHeader label="Dimensione" sortKey="size" defaultDir={-1} />
        <SortHeader label="Su disco" sortKey="disk" defaultDir={-1} />
        <div role="columnheader">% del padre</div>
        <SortHeader label="N. file" sortKey="files" defaultDir={-1} />
      </div>
      <div aria-hidden="true" style={{ height: start * TREE_ROW_H }} />
      {rows.slice(start, end).map(({ node, depth }, k) => {
        const isSel = node.id === selected;
        const hasKids = node.isDir && node.childCount > 0;
        const isOpen = !!expanded[node.id];
        const pct =
          depth === 0 ? 100 : node.parent?.size ? (node.size / node.parent.size) * 100 : 0;
        return (
          <div
            key={node.id}
            role="row"
            aria-rowindex={start + k + 2}
            aria-level={depth + 1}
            aria-expanded={hasKids ? isOpen : undefined}
            aria-selected={isSel}
            onClick={() => select(node.id)}
            onDoubleClick={() => hasKids && toggle(node.id)}
            onContextMenu={(e) => openNodeMenu(e, node, "tree")}
            style={{
              height: TREE_ROW_H,
              boxShadow: isSel
                ? focused
                  ? "inset 0 0 0 2px var(--ring)"
                  : "inset 3px 0 0 var(--primary)"
                : "none",
            }}
            className={`${GRID} tabular-nums hover:bg-hover ${isSel ? "bg-sel" : ""}`}
          >
            <div
              role="gridcell"
              className="flex min-w-0 items-center gap-1.5"
              style={{ paddingLeft: depth * 18 }}
            >
              {hasKids ? (
                <span
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(node.id);
                  }}
                  className="grid size-[18px] flex-none cursor-pointer place-items-center rounded text-muted-fg hover:bg-track hover:text-fg"
                >
                  <ChevronRight
                    size={14}
                    strokeWidth={2.2}
                    className="transition-transform duration-100"
                    style={{ transform: `rotate(${isOpen ? 90 : 0}deg)` }}
                  />
                </span>
              ) : (
                <span className="w-[18px] flex-none" />
              )}
              {node.denied ? (
                <Lock size={16} className="flex-none text-warn" />
              ) : node.agg ? (
                <File size={16} className="flex-none text-muted-fg" />
              ) : node.isDir ? (
                <Folder size={16} className="flex-none text-muted-fg" />
              ) : (
                <span className="grid size-4 flex-none place-items-center">
                  <span
                    className="size-2.5 rounded-[3px]"
                    style={{ background: TYPE_MAP[node.type ?? "other"].color }}
                  />
                </span>
              )}
              <span
                className={`truncate ${node.agg ? "text-muted-fg italic" : ""} ${depth === 0 ? "font-semibold" : node.isDir ? "font-medium" : ""}`}
              >
                {depth === 0 ? node.path : node.name}
              </span>
            </div>
            <div
              role="gridcell"
              className={`text-right whitespace-nowrap ${node.denied ? "text-warn" : ""} ${node.isDir ? "font-medium" : ""}`}
            >
              {node.denied ? "Accesso negato" : fmtSize(node.size)}
            </div>
            <div role="gridcell" className="text-right whitespace-nowrap text-muted-fg">
              {node.denied ? "—" : fmtSize(node.disk)}
            </div>
            <div role="gridcell" className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-track">
                <div
                  className="h-full rounded-[3px] bg-primary"
                  style={{ width: `${pct.toFixed(2)}%` }}
                />
              </div>
              <span className="w-[58px] flex-none text-right text-xs whitespace-nowrap text-muted-fg">
                {node.denied ? "—" : fmtPct(pct)}
              </span>
            </div>
            <div role="gridcell" className="text-right text-muted-fg">
              {node.denied ? "—" : fmtInt(node.files)}
            </div>
          </div>
        );
      })}
      <div aria-hidden="true" style={{ height: (rows.length - end) * TREE_ROW_H }} />
    </div>
  );
}
