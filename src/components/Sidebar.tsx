import { FolderOpen, HardDrive, Package } from "lucide-react";
import type { Drive } from "../bindings/Drive";
import { openPickerFrom, useSidebarCollapsed } from "../hooks";
import { fmtSize } from "../lib/format";
import { useStore } from "../store";

const driveTarget = (d: Drive) => ({ path: d.path, driveKey: d.key });

export function Sidebar() {
  const [collapsed] = useSidebarCollapsed();
  const target = useStore((s) => s.target);
  const screen = useStore((s) => s.screen);
  const allDrives = useStore((s) => s.drives);
  const startScan = useStore((s) => s.startScan);
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);

  const drives = allDrives.map((d) => {
    const pct = d.total ? (d.used / d.total) * 100 : 0;
    return {
      d,
      pct,
      active: section === "disk" && !!target && target.driveKey === d.key && screen !== "empty",
      barColor: pct > 90 ? "var(--danger)" : "var(--primary)",
      label: `${d.name} (${d.letter}): ${Math.round(pct)}% usato`,
    };
  });

  if (collapsed) {
    return (
      <aside
        aria-label="Unità e cartelle"
        className="flex w-16 flex-none flex-col items-center gap-2 border-r border-border bg-sidebar px-2 py-3.5"
      >
        {drives.map(({ d, pct, active, barColor, label }) => (
          <button
            key={d.key}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => startScan(driveTarget(d))}
            className={`flex h-12 w-12 flex-col items-center justify-center gap-[5px] rounded-lg border hover:border-ring ${active ? "border-primary bg-primary-soft" : "border-border bg-card"}`}
          >
            <span className="text-[13px] font-semibold">{d.letter}</span>
            <div className="h-1 w-7 overflow-hidden rounded-sm bg-track">
              <div
                className="h-full"
                style={{ width: `${pct.toFixed(1)}%`, background: barColor }}
              />
            </div>
          </button>
        ))}
        <div className="my-1 h-px w-8 bg-border" />
        <button
          type="button"
          aria-label="Scegli cartella…"
          title="Scegli cartella…"
          aria-haspopup="menu"
          onClick={openPickerFrom}
          className="grid h-11 w-12 place-items-center rounded-lg border border-border bg-bg hover:bg-hover"
        >
          <FolderOpen size={18} />
        </button>
        <button
          type="button"
          aria-label="App installate"
          title="App installate"
          aria-pressed={section === "apps"}
          onClick={() => setSection("apps")}
          className={`grid h-11 w-12 place-items-center rounded-lg border hover:border-ring ${section === "apps" ? "border-primary bg-primary-soft" : "border-border bg-bg"}`}
        >
          <Package size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Unità e cartelle"
      className="flex w-64 flex-none flex-col gap-2 overflow-auto border-r border-border bg-sidebar px-3 py-3.5"
    >
      <div className="px-1 pb-0.5 text-[11px] font-semibold tracking-[0.05em] text-muted-fg uppercase">
        Unità
      </div>
      {drives.map(({ d, pct, active, barColor, label }) => (
        <button
          key={d.key}
          type="button"
          aria-pressed={active}
          onClick={() => startScan(driveTarget(d))}
          className={`flex w-full flex-col gap-2 rounded-lg border px-3 py-2.5 text-left hover:border-ring ${active ? "border-primary bg-primary-soft" : "border-border bg-card"}`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid size-[30px] flex-none place-items-center rounded-md bg-muted text-muted-fg">
              <HardDrive size={16} />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{`${d.name} (${d.letter})`}</span>
              <span className="text-[11.5px] text-muted-fg">{d.kind}</span>
            </div>
          </div>
          <div
            role="meter"
            aria-label={label}
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-[3px] bg-track"
          >
            <div
              className="h-full rounded-[3px]"
              style={{ width: `${pct.toFixed(1)}%`, background: barColor }}
            />
          </div>
          <div className="flex justify-between gap-2 text-[11.5px] text-muted-fg tabular-nums">
            <span>{`${fmtSize(d.total - d.used)} liberi di ${fmtSize(d.total)}`}</span>
            <span>{Math.round(pct)} %</span>
          </div>
        </button>
      ))}
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        aria-haspopup="menu"
        onClick={openPickerFrom}
        className="flex h-[34px] items-center justify-center gap-2 rounded-md border border-border bg-bg font-medium hover:bg-hover"
      >
        <FolderOpen size={16} />
        Scegli cartella…
      </button>
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        aria-pressed={section === "apps"}
        onClick={() => setSection("apps")}
        className={`flex h-[34px] items-center justify-center gap-2 rounded-md border font-medium hover:border-ring ${section === "apps" ? "border-primary bg-primary-soft" : "border-border bg-bg"}`}
      >
        <Package size={16} />
        App installate
      </button>
    </aside>
  );
}
