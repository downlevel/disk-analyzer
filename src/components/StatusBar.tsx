import { TriangleAlert } from "lucide-react";
import { fmtInt, fmtProgress, fmtSize } from "../lib/format";
import { useStore } from "../store";

export function StatusBar() {
  const screen = useStore((s) => s.screen);
  const target = useStore((s) => s.target);
  const scan = useStore((s) => s.scan);
  const error = useStore((s) => s.error);
  const summary = useStore((s) => s.summary);
  const durationSec = useStore((s) => s.durationSec);
  const drives = useStore((s) => s.drives);
  const revealDenied = useStore((s) => s.revealDenied);
  const section = useStore((s) => s.section);
  const apps = useStore((s) => s.apps);
  const appsMeasuring = useStore((s) => s.appsMeasuring);

  const onDisk = section === "disk";
  const done = onDisk && screen === "results" ? summary : null;
  const denied = done?.denied ?? 0;
  const drive =
    onDisk && target
      ? drives.find((d) => target.path.toUpperCase().startsWith(d.letter.toUpperCase()))
      : null;

  let dot = "var(--muted-fg)";
  let state = "Pronto";
  let items: string[] = [];
  if (!onDisk) {
    dot = appsMeasuring ? "var(--primary)" : "var(--ok)";
    state = appsMeasuring ? "Misura delle app in corso" : "App installate";
    items = apps ? [`${fmtInt(apps.length)} app`] : [];
  } else if (done) {
    dot = "var(--ok)";
    state = `Scansione completata in ${durationSec} s`;
    items = [fmtSize(done.bytes), `${fmtInt(done.files)} file`, `${fmtInt(done.dirs)} cartelle`];
  } else if (screen === "scanning" && scan) {
    dot = "var(--primary)";
    state = `Scansione in corso · ${fmtProgress(scan.p)}`;
    items = [`${fmtInt(scan.files)} file`, `${fmtInt(scan.dirs)} cartelle`, fmtSize(scan.bytes)];
  } else if (screen === "error" && error) {
    const isDenied = error.kind === "denied";
    dot = isDenied ? "var(--danger)" : "var(--warn)";
    state = isDenied ? "Accesso negato" : "Scansione annullata";
  }

  return (
    <footer className="flex h-[26px] flex-none items-center gap-4 overflow-hidden border-t border-border bg-sidebar px-3 text-xs whitespace-nowrap text-muted-fg tabular-nums">
      <span role="status" className="flex items-center gap-1.5 text-fg">
        <span className="size-[7px] rounded-full" style={{ background: dot }} />
        {state}
      </span>
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
      <span className="flex-1" />
      {denied > 0 && (
        <button
          type="button"
          onClick={() => void revealDenied()}
          className="flex h-5 items-center gap-[5px] rounded px-1.5 text-xs text-warn hover:bg-warn-soft"
        >
          <TriangleAlert size={13} />
          {denied === 1 ? "1 cartella non accessibile" : `${denied} cartelle non accessibili`}
        </button>
      )}
      <span>
        {drive
          ? `${drive.letter} · ${fmtSize(drive.total - drive.used)} liberi di ${fmtSize(drive.total)}`
          : "Sola lettura"}
      </span>
    </footer>
  );
}
