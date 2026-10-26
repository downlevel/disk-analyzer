import type { TypeStat } from "../bindings/TypeStat";
import { TYPES, TYPE_MAP } from "../lib/constants";
import { fmtInt, fmtPct, fmtSize } from "../lib/format";
import type { FileType } from "../lib/types";
import { useStore } from "../store";

const TYPE_GRID =
  "grid grid-cols-[minmax(150px,1fr)_minmax(160px,2fr)_96px_64px_96px] items-center gap-x-4 px-4";
const EXT_GRID =
  "grid grid-cols-[96px_120px_minmax(140px,1fr)_96px_88px_96px] items-center gap-x-4 px-4";

export function TypesView() {
  const showTopFiles = useStore((s) => s.showTopFiles);
  const stats = useStore((s) => s.typeStats);

  if (!stats) {
    return <div className="grid flex-1 place-items-center text-muted-fg">Loading…</div>;
  }

  // Statistics computed by the core over all files in the scan.
  const perType = (pick: (t: TypeStat) => number) =>
    Object.fromEntries(stats.types.map((t) => [t.fileType, pick(t)])) as Partial<
      Record<FileType, number>
    >;
  const root = {
    size: stats.totalSize,
    files: stats.totalFiles,
    byType: perType((t) => t.size),
    typeFiles: perType((t) => t.files),
  };
  const exts = stats.exts.map((e) => ({
    ext: e.ext,
    type: e.fileType,
    size: e.size,
    files: e.files,
  }));

  const total = root.size || 1;
  const sorted = TYPES.slice().sort(
    (a, b) => (root.byType[b.key] ?? 0) - (root.byType[a.key] ?? 0),
  );
  const maxType = Math.max(...TYPES.map((t) => root.byType[t.key] ?? 0));
  const topExts = exts.slice(0, 12);
  const maxExt = topExts.length ? topExts[0].size : 1;

  return (
    // Scrollable area: it must be keyboard-reachable (tabIndex) and named for screen readers.
    <div
      tabIndex={0}
      role="region"
      aria-label="Space breakdown by type and by extension"
      className="min-h-0 flex-1 overflow-auto px-6 pt-5 pb-7"
    >
      <div className="flex max-w-[1080px] flex-col gap-7">
        <section className="flex flex-col gap-3.5">
          <div className="flex items-baseline gap-2.5">
            <h2 className="m-0 text-[15px] font-semibold">Breakdown by type</h2>
            <span className="text-muted-fg tabular-nums">
              {`${fmtSize(root.size)} in ${fmtInt(root.files)} ${root.files === 1 ? "file" : "files"}`}
            </span>
          </div>
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded">
            {sorted
              .filter((t) => root.byType[t.key])
              .map((t) => (
                <div
                  key={t.key}
                  title={`${t.label} · ${fmtSize(root.byType[t.key] ?? 0)}`}
                  style={{
                    width: `${(((root.byType[t.key] ?? 0) / total) * 100).toFixed(2)}%`,
                    background: t.color,
                  }}
                />
              ))}
          </div>
          <div
            role="table"
            aria-label="Space by file type"
            className="flex flex-col overflow-hidden rounded-lg border border-border"
          >
            <div
              role="row"
              className={`${TYPE_GRID} h-[34px] bg-muted text-xs font-medium text-muted-fg`}
            >
              <div role="columnheader">Type</div>
              <div role="columnheader">Share</div>
              <div role="columnheader" className="text-right">
                Size
              </div>
              <div role="columnheader" className="text-right">
                %
              </div>
              <div role="columnheader" className="text-right">
                Files
              </div>
            </div>
            {sorted.map((t) => {
              const s = root.byType[t.key] ?? 0;
              return (
                <div
                  key={t.key}
                  role="row"
                  onClick={() => showTopFiles(t.key)}
                  className={`${TYPE_GRID} h-[42px] cursor-pointer border-t border-border tabular-nums hover:bg-hover`}
                >
                  <div role="cell" className="flex items-center gap-2.5">
                    <span className="size-3 rounded-[3px]" style={{ background: t.color }} />
                    <span className="font-medium">{t.label}</span>
                    <span className="truncate text-xs text-muted-fg">
                      {exts
                        .filter((e) => e.type === t.key)
                        .slice(0, 3)
                        .map((e) => e.ext)
                        .join("  ")}
                    </span>
                  </div>
                  <div role="cell">
                    <div className="h-2 overflow-hidden rounded bg-track">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${(maxType ? (s / maxType) * 100 : 0).toFixed(1)}%`,
                          background: t.color,
                        }}
                      />
                    </div>
                  </div>
                  <div role="cell" className="text-right font-medium">
                    {s ? fmtSize(s) : "—"}
                  </div>
                  <div role="cell" className="text-right text-muted-fg">
                    {fmtPct((s / total) * 100)}
                  </div>
                  <div role="cell" className="text-right text-muted-fg">
                    {fmtInt(root.typeFiles[t.key] ?? 0)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3.5">
          <h2 className="m-0 text-[15px] font-semibold">Top extensions</h2>
          <div
            role="table"
            aria-label="Top extensions"
            className="flex flex-col overflow-hidden rounded-lg border border-border"
          >
            <div
              role="row"
              className={`${EXT_GRID} h-[34px] bg-muted text-xs font-medium text-muted-fg`}
            >
              <div role="columnheader">Extension</div>
              <div role="columnheader">Type</div>
              <div role="columnheader">
                <span className="sr-only">Proportion</span>
              </div>
              <div role="columnheader" className="text-right">
                Size
              </div>
              <div role="columnheader" className="text-right">
                Files
              </div>
              <div role="columnheader" className="text-right">
                Average
              </div>
            </div>
            {topExts.map((e) => {
              const type = TYPE_MAP[e.type];
              return (
                <div
                  key={e.ext}
                  role="row"
                  className={`${EXT_GRID} h-9 border-t border-border tabular-nums`}
                >
                  <div role="cell" className="font-mono text-[12.5px] font-medium">
                    {e.ext}
                  </div>
                  <div role="cell" className="flex items-center gap-2 text-muted-fg">
                    <span className="size-2 rounded-sm" style={{ background: type.color }} />
                    {type.label}
                  </div>
                  <div role="cell">
                    <div className="h-1.5 overflow-hidden rounded-[3px] bg-track">
                      <div
                        className="h-full rounded-[3px]"
                        style={{
                          width: `${((e.size / maxExt) * 100).toFixed(1)}%`,
                          background: type.color,
                        }}
                      />
                    </div>
                  </div>
                  <div role="cell" className="text-right font-medium">
                    {fmtSize(e.size)}
                  </div>
                  <div role="cell" className="text-right text-muted-fg">
                    {fmtInt(e.files)}
                  </div>
                  <div role="cell" className="text-right text-muted-fg">
                    {fmtSize(e.size / Math.max(1, e.files))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
