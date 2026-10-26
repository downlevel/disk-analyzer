import { Copy, ExternalLink, Link2, Package, RefreshCw, ScanSearch, X } from "lucide-react";
import { useMemo } from "react";
import type { InstalledApp } from "../bindings/InstalledApp";
import { filterApps, sizeInfo, sortApps, totals } from "../lib/apps";
import type { AppSortKey, AppSizes } from "../lib/apps";
import { fmtInt, fmtSize } from "../lib/format";
import { useStore } from "../store";
import { Button } from "./Button";

const CELL = "px-3 align-middle";

function SortHeader({
  label,
  sortKey,
  defaultDir,
  align = "left",
  width,
}: {
  label: string;
  sortKey: AppSortKey;
  defaultDir: 1 | -1;
  align?: "left" | "right";
  width: string;
}) {
  const sort = useStore((s) => s.appSort);
  const setSort = useStore((s) => s.setAppSort);
  const active = sort.key === sortKey;
  const aria = active ? (sort.dir > 0 ? "ascending" : "descending") : "none";
  return (
    <th
      scope="col"
      aria-sort={aria}
      style={{ width }}
      className={`${CELL} font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => setSort(sortKey, defaultDir)}
        className={`p-0 font-medium ${active ? "text-fg" : "text-muted-fg"}`}
      >
        {label} {active ? (sort.dir > 0 ? "↑" : "↓") : ""}
      </button>
    </th>
  );
}

function SizeCell({
  app,
  sizes,
  measuring,
}: {
  app: InstalledApp;
  sizes: AppSizes;
  measuring: boolean;
}) {
  const info = sizeInfo(app, sizes);
  switch (info.kind) {
    case "measured":
      return (
        <span title={`${fmtInt(info.files)} ${info.files === 1 ? "file" : "files"}`} className="font-medium">
          {fmtSize(info.size)}
        </span>
      );
    case "estimated":
      // Without a known folder there is nothing to measure: show the size the app declares.
      return measuring && app.installLocation ? (
        <span className="text-muted-fg">Measuring…</span>
      ) : (
        <span
          title="Size declared by the app in the Windows registry, not measured"
          className="text-muted-fg"
        >
          {`~${fmtSize(info.size)}`}
        </span>
      );
    case "missing":
      return <span className="text-warn">Folder not found</span>;
    case "denied":
      return <span className="text-warn">Access denied</span>;
    case "failed":
      return <span className="text-warn">Error</span>;
    case "none":
      return measuring && app.installLocation ? (
        <span className="text-muted-fg">Measuring…</span>
      ) : (
        <span
          title={
            app.installLocation
              ? "Size not available"
              : "The app does not say where it is installed"
          }
          className="text-muted-fg"
        >
          —
        </span>
      );
  }
}

function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-muted-fg hover:bg-hover hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Row({
  app,
  sizes,
  measuring,
}: {
  app: InstalledApp;
  sizes: AppSizes;
  measuring: boolean;
}) {
  const analyzeApp = useStore((s) => s.analyzeApp);
  const openAppFolder = useStore((s) => s.openAppFolder);
  const copyAppPath = useStore((s) => s.copyAppPath);
  const info = sizeInfo(app, sizes);
  const hasPath = !!app.installLocation;
  const canAct = hasPath && info.kind !== "missing";

  return (
    <tr className="h-12 border-t border-border tabular-nums hover:bg-hover">
      <td className={`${CELL} max-w-0`}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{app.name}</span>
          {app.sharedLocation && (
            <span
              title="The folder is shared with other apps: the size includes them too"
              className="flex-none text-muted-fg"
            >
              <Link2 size={13} aria-label="Folder shared with other apps" />
            </span>
          )}
        </div>
        <div
          title={
            app.installLocation
              ? app.locationDerived
                ? `${app.installLocation} (derived from the icon or the uninstaller)`
                : app.installLocation
              : "The app does not say where it is installed"
          }
          className="truncate font-mono text-[11.5px] text-muted-fg"
        >
          {app.installLocation ?? "Unknown location"}
        </div>
      </td>
      <td className={`${CELL} max-w-0 truncate text-muted-fg`} title={app.publisher ?? undefined}>
        {app.publisher ?? "—"}
      </td>
      <td className={`${CELL} max-w-0 truncate text-muted-fg`} title={app.version ?? undefined}>
        {app.version ?? "—"}
      </td>
      <td className={`${CELL} text-muted-fg`}>{app.installDate ?? "—"}</td>
      <td className={`${CELL} text-right`}>
        <SizeCell app={app} sizes={sizes} measuring={measuring} />
      </td>
      <td className={`${CELL} text-right text-muted-fg`}>
        {info.kind === "measured" ? fmtSize(info.disk) : "—"}
      </td>
      <td className={`${CELL} text-right`}>
        <div className="flex justify-end gap-0.5">
          <ActionButton
            label={`Analyze the folder of ${app.name}`}
            disabled={!canAct}
            onClick={() => analyzeApp(app)}
          >
            <ScanSearch size={15} />
          </ActionButton>
          <ActionButton
            label={`Open the folder of ${app.name} in File Explorer`}
            disabled={!canAct}
            onClick={() => openAppFolder(app)}
          >
            <ExternalLink size={15} />
          </ActionButton>
          <ActionButton
            label={`Copy the path of ${app.name}`}
            disabled={!hasPath}
            onClick={() => copyAppPath(app)}
          >
            <Copy size={15} />
          </ActionButton>
        </div>
      </td>
    </tr>
  );
}

export function AppsView() {
  const apps = useStore((s) => s.apps);
  const loading = useStore((s) => s.appsLoading);
  const sizes = useStore((s) => s.appSizes);
  const measuring = useStore((s) => s.appsMeasuring);
  const progress = useStore((s) => s.appsProgress);
  const query = useStore((s) => s.appQuery);
  const sort = useStore((s) => s.appSort);
  const basis = useStore((s) => s.appSortBasis);
  const setQuery = useStore((s) => s.setAppQuery);
  const measureApps = useStore((s) => s.measureApps);
  const cancelAppSizes = useStore((s) => s.cancelAppSizes);

  const rows = useMemo(
    () => sortApps(filterApps(apps ?? [], query), sort.key, sort.dir, basis, sizes),
    [apps, query, sort, basis, sizes],
  );
  const sum = useMemo(() => totals(apps ?? [], sizes), [apps, sizes]);
  const pct = progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0;

  return (
    <section aria-label="Installed apps" className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-4">
        <Package size={16} className="flex-none text-muted-fg" aria-hidden="true" />
        <h2 className="m-0 text-[15px] font-semibold">Installed apps</h2>
        <div className="ml-2 flex h-8 min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-md border border-border bg-muted px-2.5">
          <input
            type="search"
            aria-label="Search apps by name or publisher"
            placeholder="Search by name or publisher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-fg"
          />
        </div>
        <div className="flex-1" />
        {measuring ? (
          <Button variant="danger" size="sm" onClick={cancelAppSizes}>
            <X size={15} />
            Cancel measuring
          </Button>
        ) : (
          <Button size="sm" disabled={loading || !apps?.length} onClick={() => void measureApps()}>
            <RefreshCw size={15} />
            Measure again
          </Button>
        )}
      </div>

      <div className="flex h-9 flex-none items-center gap-3 border-b border-border px-4 text-xs text-muted-fg tabular-nums">
        {measuring ? (
          <>
            <span>{`Measuring folders: ${fmtInt(progress.done)} of ${fmtInt(progress.total)}`}</span>
            <div
              role="progressbar"
              aria-label="App measuring progress"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-40 overflow-hidden rounded-[3px] bg-track"
            >
              <div className="h-full rounded-[3px] bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <span>
            {apps
              ? `${fmtInt(rows.length)}${rows.length === apps.length ? "" : ` of ${fmtInt(apps.length)}`} ${apps.length === 1 ? "app" : "apps"} · ${fmtSize(sum.size)} measured in ${fmtInt(sum.measuredApps)} ${sum.measuredApps === 1 ? "folder" : "folders"}`
              : ""}
          </span>
        )}
        <span className="ml-auto truncate">
          Desktop apps from the Windows registry; Microsoft Store apps are not included. Sizes
          marked with ~ are the ones declared by the app.
        </span>
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label="Installed apps list"
        className="min-h-0 flex-1 overflow-auto"
      >
        {loading || apps === null ? (
          <p className="m-0 p-8 text-center text-muted-fg">Reading installed apps…</p>
        ) : rows.length === 0 ? (
          <p className="m-0 p-8 text-center text-muted-fg">
            {apps.length === 0
              ? "No apps found."
              : `No apps match "${query.trim()}".`}
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-[13px]">
            <thead className="sticky top-0 z-[1] bg-bg text-xs">
              <tr className="h-[34px] border-b border-border">
                <SortHeader label="Name and location" sortKey="name" defaultDir={1} width="34%" />
                <SortHeader label="Publisher" sortKey="publisher" defaultDir={1} width="16%" />
                <th
                  scope="col"
                  style={{ width: "9%" }}
                  className={`${CELL} text-left font-medium text-muted-fg`}
                >
                  Version
                </th>
                <th
                  scope="col"
                  style={{ width: "10%" }}
                  className={`${CELL} text-left font-medium text-muted-fg`}
                >
                  Installed
                </th>
                <SortHeader
                  label="Size"
                  sortKey="size"
                  defaultDir={-1}
                  align="right"
                  width="11%"
                />
                <SortHeader
                  label="On disk"
                  sortKey="disk"
                  defaultDir={-1}
                  align="right"
                  width="9%"
                />
                <th scope="col" style={{ width: "11%" }} className={CELL}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <Row key={app.id} app={app} sizes={sizes} measuring={measuring} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
