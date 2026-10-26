import { Folder, PanelLeft, RefreshCw, X } from "lucide-react";
import { useSidebarCollapsed } from "../hooks";
import { fmtProgress } from "../lib/format";
import { useStore } from "../store";
import { Button } from "./Button";

export function Toolbar() {
  const [, toggleSidebar] = useSidebarCollapsed();
  const screen = useStore((s) => s.screen);
  const target = useStore((s) => s.target);
  const scan = useStore((s) => s.scan);
  const scannedAt = useStore((s) => s.scannedAt);
  const durationSec = useStore((s) => s.durationSec);
  const startScan = useStore((s) => s.startScan);
  const cancelScan = useStore((s) => s.cancelScan);

  const results = screen === "results";
  let meta = "";
  if (results) meta = `Read-only · scanned at ${scannedAt} in ${durationSec} s`;
  else if (screen === "scanning" && scan) meta = `Scanning · ${fmtProgress(scan.p)}`;
  else if (screen === "error") meta = "Scan not completed";

  return (
    <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-4">
      <button
        type="button"
        aria-label="Show or hide sidebar"
        title="Sidebar"
        onClick={toggleSidebar}
        className="grid size-8 flex-none place-items-center rounded-md text-muted-fg hover:bg-hover hover:text-fg"
      >
        <PanelLeft size={16} />
      </button>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted px-2.5">
        <Folder size={15} className="flex-none text-muted-fg" />
        <span className={`truncate font-medium ${target ? "text-fg" : "text-muted-fg"}`}>
          {target ? target.path : "No drive or folder selected"}
        </span>
        <span className="ml-auto text-xs whitespace-nowrap text-muted-fg tabular-nums">{meta}</span>
      </div>
      {screen === "scanning" ? (
        <Button variant="danger" size="sm" onClick={cancelScan}>
          <X size={15} />
          Cancel
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          title="F5"
          disabled={!target}
          onClick={() => target && startScan(target)}
        >
          <RefreshCw size={15} />
          {results ? "Rescan" : "Scan"}
        </Button>
      )}
    </div>
  );
}
