import type { KeyboardEvent } from "react";
import { openMenuAt, openNodeMenu } from "../hooks";
import { TOP_ROW_H, TYPES, TYPE_MAP } from "../lib/constants";
import { fmtInt, fmtSize } from "../lib/format";
import { dirnameOf } from "../lib/tree";
import type { TreeNode } from "../lib/types";
import { useStore } from "../store";
import type { TypeFilter } from "../store";

const GRID =
  "grid grid-cols-[40px_minmax(240px,1.6fr)_110px_96px_minmax(120px,1fr)_104px] items-center gap-x-3 px-4";

const CHIPS = [{ key: "all", label: "All", color: "" }, ...TYPES];

export function TopFilesView() {
  const typeFilter = useStore((s) => s.typeFilter);
  const selected = useStore((s) => s.selected);
  const topFiles = useStore((s) => s.topFiles);
  const setTypeFilter = useStore((s) => s.setTypeFilter);
  const select = useStore((s) => s.select);

  // The list comes from the core (already sorted and limited) when the view opens or the filter changes.
  const list = topFiles ?? [];
  const loading = topFiles === null;
  const max = list.length ? list[0].size : 1;
  const total = list.reduce((a, b) => a + b.size, 0);

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, f: TreeNode) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const s =
        e.key === "ArrowDown"
          ? e.currentTarget.nextElementSibling
          : e.currentTarget.previousElementSibling;
      if (s instanceof HTMLElement && s.getAttribute("role") === "row" && s.tabIndex === 0)
        s.focus();
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const b = e.currentTarget.getBoundingClientRect();
      openMenuAt(b.left + 120, b.bottom, f, "top", true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(f.id);
    }
  };

  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
        {CHIPS.map((c) => {
          const active = typeFilter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTypeFilter(c.key as TypeFilter)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium hover:border-ring ${active ? "border-primary bg-primary-soft text-fg" : "border-border bg-bg text-muted-fg"}`}
            >
              {c.color && <span className="size-2 rounded-sm" style={{ background: c.color }} />}
              {c.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-muted-fg tabular-nums">
          {loading
            ? "Loading…"
            : list.length
              ? `${fmtInt(list.length)} ${list.length === 1 ? "file" : "files"} · ${fmtSize(total)}`
              : "No files of this type"}
        </span>
      </div>
      <div role="grid" aria-label="Largest files" className="min-h-0 flex-1 overflow-auto">
        <div
          role="row"
          className={`${GRID} sticky top-0 z-[1] h-[34px] border-b border-border bg-bg text-xs font-medium text-muted-fg`}
        >
          <div role="columnheader" className="text-right">
            #
          </div>
          <div role="columnheader">Name</div>
          <div role="columnheader">Type</div>
          <div role="columnheader" className="text-right">
            Size ↓
          </div>
          <div role="columnheader">
            <span className="sr-only">Proportion</span>
          </div>
          <div role="columnheader" className="text-right">
            Modified
          </div>
        </div>
        {list.map((f, i) => {
          const sel = selected === f.id;
          const type = TYPE_MAP[f.type ?? "other"];
          return (
            <div
              key={f.id}
              role="row"
              tabIndex={0}
              aria-selected={sel}
              onClick={() => select(f.id)}
              onContextMenu={(e) => openNodeMenu(e, f, "top")}
              onKeyDown={(e) => onRowKey(e, f)}
              style={{
                height: TOP_ROW_H,
                boxShadow: sel ? "inset 3px 0 0 var(--primary)" : "none",
              }}
              className={`${GRID} -outline-offset-2 tabular-nums hover:bg-hover ${sel ? "bg-sel" : ""}`}
            >
              <div role="gridcell" className="text-right text-xs text-muted-fg">
                {i + 1}
              </div>
              <div role="gridcell" className="flex min-w-0 items-center gap-2.5">
                <span
                  className="size-2.5 flex-none rounded-[3px]"
                  style={{ background: type.color }}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="truncate font-mono text-[11.5px] text-muted-fg">
                    {dirnameOf(f.path)}
                  </span>
                </div>
              </div>
              <div role="gridcell" className="text-muted-fg">
                {type.label}
              </div>
              <div role="gridcell" className="text-right font-medium">
                {fmtSize(f.size)}
              </div>
              <div role="gridcell">
                <div className="h-1.5 overflow-hidden rounded-[3px] bg-track">
                  <div
                    className="h-full rounded-[3px]"
                    style={{
                      width: `${((f.size / max) * 100).toFixed(1)}%`,
                      background: type.color,
                    }}
                  />
                </div>
              </div>
              <div role="gridcell" className="text-right text-muted-fg">
                {f.modified}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
