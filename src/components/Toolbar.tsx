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
  if (results) meta = `Sola lettura · analizzato alle ${scannedAt} in ${durationSec} s`;
  else if (screen === "scanning" && scan) meta = `Scansione · ${fmtProgress(scan.p)}`;
  else if (screen === "error") meta = "Scansione non completata";

  return (
    <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-4">
      <button
        type="button"
        aria-label="Mostra o nascondi barra laterale"
        title="Barra laterale"
        onClick={toggleSidebar}
        className="grid size-8 flex-none place-items-center rounded-md text-muted-fg hover:bg-hover hover:text-fg"
      >
        <PanelLeft size={16} />
      </button>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted px-2.5">
        <Folder size={15} className="flex-none text-muted-fg" />
        <span className={`truncate font-medium ${target ? "text-fg" : "text-muted-fg"}`}>
          {target ? target.path : "Nessuna unità o cartella selezionata"}
        </span>
        <span className="ml-auto text-xs whitespace-nowrap text-muted-fg tabular-nums">{meta}</span>
      </div>
      {screen === "scanning" ? (
        <Button variant="danger" size="sm" onClick={cancelScan}>
          <X size={15} />
          Annulla
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
          {results ? "Riscansiona" : "Scansiona"}
        </Button>
      )}
    </div>
  );
}
