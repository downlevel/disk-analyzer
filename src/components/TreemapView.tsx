import { ArrowUp, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openNodeMenu } from "../hooks";
import { TYPES, TYPE_MAP } from "../lib/constants";
import { fmtInt, fmtPct, fmtSize } from "../lib/format";
import { squarify } from "../lib/squarify";
import type { TmRect } from "../lib/squarify";
import { nodeType } from "../lib/tree";
import type { TreeNode } from "../lib/types";
import { treeCache, useStore } from "../store";

interface Hover {
  node: TreeNode;
  x: number;
  y: number;
}

const kidsOf = (n: TreeNode) =>
  n.children
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size)
    .map((c) => ({ data: c, value: c.size }));

const canEnter = (n: TreeNode) => n.isDir && !n.denied && n.childCount > 0;

export function TreemapView({ root }: { root: TreeNode }) {
  // Children are loaded on demand: the cache version signals when they have changed.
  const treeVersion = useStore((s) => s.treeVersion);
  const tmRootId = useStore((s) => s.tmRoot);
  const selected = useStore((s) => s.selected);
  const setTmRoot = useStore((s) => s.setTmRoot);
  const select = useStore((s) => s.select);

  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 440 });
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w && h) setSize((c) => (c.w === w && c.h === h ? c : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tm = (tmRootId != null ? treeCache.get(tmRootId) : undefined) ?? root;

  const chain = useMemo(() => {
    const out: TreeNode[] = [];
    for (let p: TreeNode | null = tm; p; p = p.parent) {
      out.unshift(p);
      if (p === root) break;
    }
    return out;
  }, [tm, root]);

  const { groups, leaves } = useMemo(() => {
    const groups: TmRect<TreeNode>[] = [];
    const leaves: TmRect<TreeNode>[] = [];
    for (const r of squarify(kidsOf(tm), 0, 0, size.w, size.h)) {
      if (canEnter(r.data) && r.data.childrenLoaded && r.w > 96 && r.h > 60) {
        groups.push(r);
        leaves.push(...squarify(kidsOf(r.data), r.x + 3, r.y + 22, r.w - 6, r.h - 25));
      } else {
        leaves.push(r);
      }
    }
    return { groups, leaves };
    // treeVersion: the children of `tm` and of its groups arrive on demand from the core.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tm, size, treeVersion]);

  const goTo = (id: number) => {
    void setTmRoot(id);
    setHover(null);
  };
  const move = (node: TreeNode) => (e: React.MouseEvent) =>
    setHover({ node, x: e.clientX, y: e.clientY });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          aria-label="Up one level"
          title="Up one level"
          disabled={tm === root}
          onClick={() => tm.parent && goTo(tm.parent.id)}
          className={`grid size-[30px] flex-none place-items-center rounded-md border border-border bg-bg hover:bg-hover ${tm === root ? "opacity-45" : ""}`}
        >
          <ArrowUp size={15} />
        </button>
        <nav
          aria-label="Treemap path"
          className="flex min-w-0 items-center gap-0.5 overflow-hidden"
        >
          {chain.map((n, i) => {
            const last = i === chain.length - 1;
            return (
              <div key={n.id} className="flex min-w-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-current={last ? "page" : undefined}
                  onClick={() => goTo(n.id)}
                  className={`rounded px-1.5 py-1 whitespace-nowrap hover:bg-hover hover:text-fg ${last ? "font-semibold text-fg" : "text-muted-fg"}`}
                >
                  {i === 0 ? n.path : n.name}
                </button>
                {!last && <ChevronRight size={14} className="flex-none text-muted-fg" />}
              </div>
            );
          })}
        </nav>
        <span className="ml-auto text-xs whitespace-nowrap text-muted-fg tabular-nums">
          {`${fmtInt(tm.childCount)} ${tm.childCount === 1 ? "item" : "items"} · ${fmtSize(tm.size)}`}
        </span>
      </div>

      <div
        ref={boxRef}
        role="img"
        aria-label={`Treemap of ${tm.path}, ${fmtSize(tm.size)}. Use the Tree view for keyboard navigation.`}
        onMouseLeave={() => setHover(null)}
        className="relative min-h-[220px] flex-1 overflow-hidden rounded-lg bg-muted select-none"
      >
        {groups.map((r) => (
          <div
            key={r.data.id}
            onClick={() => goTo(r.data.id)}
            onContextMenu={(e) => {
              setHover(null);
              openNodeMenu(e, r.data, "map");
            }}
            onMouseMove={move(r.data)}
            style={{
              left: r.x + 1,
              top: r.y + 1,
              width: r.w - 2,
              height: r.h - 2,
              borderColor: hover?.node === r.data ? "var(--ring)" : "var(--border)",
            }}
            className="absolute cursor-pointer overflow-hidden rounded-[5px] border bg-card"
          >
            <div className="flex h-5 items-center gap-1.5 overflow-hidden px-[7px] text-[11.5px] whitespace-nowrap">
              <span className="truncate font-semibold">{r.data.name}</span>
              <span className="text-muted-fg tabular-nums">{fmtSize(r.data.size)}</span>
            </div>
          </div>
        ))}
        {leaves.map((r) => {
          const n = r.data;
          const w = Math.max(0, r.w - 2);
          const h = Math.max(0, r.h - 2);
          return (
            <div
              key={n.id}
              onClick={() => (canEnter(n) ? goTo(n.id) : select(n.id))}
              onContextMenu={(e) => {
                setHover(null);
                openNodeMenu(e, n, "map");
              }}
              onMouseMove={move(n)}
              style={{
                left: r.x + 1,
                top: r.y + 1,
                width: w,
                height: h,
                background: TYPE_MAP[nodeType(n)].color,
                boxShadow: selected === n.id ? "inset 0 0 0 2px var(--t-ink)" : "none",
                filter: hover?.node === n ? "brightness(1.1)" : "none",
              }}
              className="absolute flex cursor-pointer flex-col gap-px overflow-hidden rounded-[3px] px-1.5 py-1 text-[var(--t-ink)]"
            >
              {w > 58 && h > 34 && (
                <>
                  <span className="truncate text-[11.5px] font-semibold whitespace-nowrap">
                    {n.agg ? `${n.parent?.name} · files` : n.name}
                  </span>
                  <span className="text-[11px] whitespace-nowrap tabular-nums">
                    {fmtSize(n.size)}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div
        role="group"
        aria-label="Legend"
        className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-xs"
      >
        {TYPES.map((t) => {
          const s = tm.byType[t.key] ?? 0;
          return (
            <div key={t.key} className={`flex items-center gap-1.5 ${s ? "" : "opacity-50"}`}>
              <span className="size-2.5 rounded-[3px]" style={{ background: t.color }} />
              <span className="font-medium">{t.label}</span>
              <span className="text-muted-fg tabular-nums">{s ? fmtSize(s) : "—"}</span>
            </div>
          );
        })}
      </div>

      {hover && <Tooltip hover={hover} total={tm.size} />}
    </div>
  );
}

function Tooltip({ hover, total }: { hover: Hover; total: number }) {
  const { node, x, y } = hover;
  const type = TYPE_MAP[nodeType(node)];
  return (
    <div
      role="tooltip"
      style={{
        left: Math.min(x + 14, window.innerWidth - 296),
        top: Math.min(y + 16, window.innerHeight - 170),
      }}
      className="pointer-events-none fixed z-30 flex w-[280px] flex-col gap-1.5 rounded-lg border border-border bg-popover px-3 py-2.5 shadow-pop tabular-nums"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2.5 flex-none rounded-[3px]" style={{ background: type.color }} />
        <span className="truncate font-semibold">
          {node.agg ? `${node.name} in ${node.parent?.name}` : node.name}
        </span>
      </div>
      <div className="font-mono text-[11px] break-all text-muted-fg">{node.path}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <span className="text-muted-fg">Size</span>
        <span className="text-right font-medium">{fmtSize(node.size)}</span>
        <span className="text-muted-fg">Of view</span>
        <span className="text-right">{fmtPct(total ? (node.size / total) * 100 : 0)}</span>
        <span className="text-muted-fg">Type</span>
        <span className="text-right">
          {node.isDir ? `${type.label} (predominant)` : `${type.label} · ${node.ext}`}
        </span>
        <span className="text-muted-fg">Files</span>
        <span className="text-right">{fmtInt(node.files)}</span>
      </div>
    </div>
  );
}
