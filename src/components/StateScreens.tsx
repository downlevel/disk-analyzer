import { CircleX, HardDrive, Lock } from "lucide-react";
import { openPickerFrom } from "../hooks";
import { fmtDuration, fmtInt, fmtProgress, fmtSize } from "../lib/format";
import { useStore } from "../store";
import { Button } from "./Button";

export function EmptyState() {
  const startScan = useStore((s) => s.startScan);
  const drives = useStore((s) => s.drives);
  // Propone l'unità di sistema (di solito C:), altrimenti la prima disponibile.
  const main = drives.find((d) => d.key === "C") ?? drives[0];
  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="flex max-w-[440px] flex-col items-center gap-3.5 text-center">
        <div className="grid size-14 place-items-center rounded-[14px] border border-border bg-muted text-muted-fg">
          <HardDrive size={26} strokeWidth={1.8} />
        </div>
        <h1 className="m-0 text-[18px] font-semibold text-balance">
          Scegli un'unità o una cartella per iniziare
        </h1>
        <p className="m-0 text-pretty text-muted-fg">
          Disk Analyzer legge il contenuto in sola lettura e mostra cosa occupa spazio. Nessun file
          viene modificato o eliminato.
        </p>
        <div className="mt-1.5 flex gap-2">
          {main && (
            <Button
              variant="primary"
              onClick={() => startScan({ path: main.path, driveKey: main.key })}
            >
              {`Scansiona ${main.letter}`}
            </Button>
          )}
          <Button onClick={openPickerFrom}>Scegli cartella…</Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11.5px] text-muted-fg">{label}</span>
      <span className="text-[15px] font-semibold">{value}</span>
    </div>
  );
}

export function ScanningView() {
  const target = useStore((s) => s.target);
  const scan = useStore((s) => s.scan);
  const cancelScan = useStore((s) => s.cancelScan);
  if (!target || !scan) return null;

  // Per le singole cartelle la dimensione totale non è nota: niente percentuale né stima.
  const known = scan.p != null;
  const elapsedS = scan.elapsedMs / 1000;
  let eta = "Stima non disponibile per le cartelle";
  if (scan.p != null) {
    eta =
      scan.p > 0.06
        ? `circa ${Math.ceil((elapsedS / scan.p) * (1 - scan.p))} s rimanenti`
        : "Stima del tempo…";
  }

  return (
    <div className="grid flex-1 place-items-center p-8">
      <div
        role="region"
        aria-label="Scansione in corso"
        className="flex w-full max-w-[560px] flex-col gap-[18px] rounded-xl border border-border bg-card p-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-base font-semibold">{`Scansione di ${target.path} in corso…`}</h1>
          <p className="m-0 text-[12.5px] text-muted-fg">
            Sola lettura — nessun file viene modificato.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label="Avanzamento scansione"
            aria-valuenow={known ? Math.floor((scan.p ?? 0) * 100) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded bg-track"
          >
            <div
              className={`h-full rounded bg-primary ${known ? "transition-[width] duration-100 ease-linear" : "animate-pulse"}`}
              style={{ width: known ? `${((scan.p ?? 0) * 100).toFixed(1)}%` : "100%" }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-fg tabular-nums">
            <span className="font-semibold text-fg">{fmtProgress(scan.p)}</span>
            <span>{eta}</span>
          </div>
        </div>
        <div
          aria-live="off"
          className="truncate rounded-md bg-muted px-2.5 py-2 font-mono text-xs text-muted-fg"
        >
          {scan.cur}
        </div>
        <div className="grid grid-cols-4 gap-3 tabular-nums">
          <Stat label="File" value={fmtInt(scan.files)} />
          <Stat label="Cartelle" value={fmtInt(scan.dirs)} />
          <Stat label="Analizzati" value={fmtSize(scan.bytes)} />
          <Stat label="Tempo" value={fmtDuration(scan.elapsedMs)} />
        </div>
        <div className="flex justify-end">
          <Button variant="danger" size="sm" onClick={cancelScan}>
            Annulla scansione
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ErrorView() {
  const error = useStore((s) => s.error);
  const target = useStore((s) => s.target);
  const startScan = useStore((s) => s.startScan);
  const reset = useStore((s) => s.reset);
  if (!error) return null;
  const retry = () => target && startScan(target);

  if (error.kind === "denied") {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div role="alert" className="flex max-w-[480px] flex-col items-center gap-3 text-center">
          <div className="grid size-[52px] place-items-center rounded-full bg-danger-soft text-danger">
            <Lock size={24} />
          </div>
          <h1 className="m-0 text-[18px] font-semibold">Cartella non accessibile</h1>
          <div className="max-w-full truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
            {error.path}
          </div>
          <p className="m-0 text-pretty text-muted-fg">
            Windows ha negato l'accesso in lettura. Avvia Disk Analyzer come amministratore oppure
            scegli un'altra cartella.
          </p>
          <div className="mt-1.5 flex gap-2">
            <Button variant="primary" onClick={retry}>
              Riprova
            </Button>
            <Button onClick={openPickerFrom}>Scegli un'altra cartella…</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid flex-1 place-items-center p-8">
      <div role="status" className="flex max-w-[460px] flex-col items-center gap-3 text-center">
        <div className="grid size-[52px] place-items-center rounded-full bg-warn-soft text-warn">
          <CircleX size={24} />
        </div>
        <h1 className="m-0 text-[18px] font-semibold">Scansione annullata</h1>
        <p className="m-0 text-pretty text-muted-fg">
          Interrotta dopo{" "}
          <span className="font-medium text-fg tabular-nums">{fmtInt(error.files)}</span> file (
          <span className="font-medium text-fg tabular-nums">{fmtSize(error.bytes)}</span>) in{" "}
          {error.path}. I risultati parziali non vengono mostrati perché incompleti.
        </p>
        <div className="mt-1.5 flex gap-2">
          <Button variant="primary" onClick={retry}>
            Riavvia scansione
          </Button>
          <Button onClick={reset}>Chiudi</Button>
        </div>
      </div>
    </div>
  );
}
