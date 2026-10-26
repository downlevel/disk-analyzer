import type { ScanDone } from "../bindings/ScanDone";
import type { ScanProgress, ScanTarget } from "../lib/types";

export interface ScanHandlers {
  onProgress: (progress: ScanProgress) => void;
  onDone: (done: ScanDone) => void;
  /** The folder is not readable (permission denied). */
  onDenied: () => void;
  /** Any other error (nonexistent path, I/O error…). */
  onError: (message: string) => void;
}

export interface Scanner {
  /** Starts a scan and returns the function to cancel it. */
  start: (target: ScanTarget, handlers: ScanHandlers) => () => void;
}
