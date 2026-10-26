import type { ScanDone } from "../bindings/ScanDone";
import type { ScanProgress, ScanTarget } from "../lib/types";

export interface ScanHandlers {
  onProgress: (progress: ScanProgress) => void;
  onDone: (done: ScanDone) => void;
  /** La cartella non è leggibile (permesso negato). */
  onDenied: () => void;
  /** Qualsiasi altro errore (percorso inesistente, errore di I/O…). */
  onError: (message: string) => void;
}

export interface Scanner {
  /** Avvia una scansione e restituisce la funzione per annullarla. */
  start: (target: ScanTarget, handlers: ScanHandlers) => () => void;
}
