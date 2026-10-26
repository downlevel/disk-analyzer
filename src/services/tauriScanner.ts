// Scanner: comandi ed eventi Tauri verso il core Rust (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ScanDone } from "../bindings/ScanDone";
import type { ScanFailed } from "../bindings/ScanFailed";
import type { ScanProgress } from "../bindings/ScanProgress";
import type { Scanner } from "./types";

// Devono coincidere con le costanti in src-tauri/src/model.rs.
export const EVENT_PROGRESS = "scan:progress";
export const EVENT_DONE = "scan:done";
export const EVENT_FAILED = "scan:failed";

// L'identificativo lo assegna il frontend, così gli eventi si possono ascoltare prima di avviare
// la scansione senza rischiare di perderne.
let nextScanId = 1;

export const tauriScanner: Scanner = {
  start(target, handlers) {
    const scanId = nextScanId++;
    let stopped = false;
    const unlisteners: UnlistenFn[] = [];

    const stop = () => {
      stopped = true;
      for (const unlisten of unlisteners.splice(0)) unlisten();
    };

    const setup = async () => {
      const unlistenAll = await Promise.all([
        listen<ScanProgress>(EVENT_PROGRESS, ({ payload }) => {
          if (payload.scanId !== scanId) return;
          handlers.onProgress({
            p: payload.fraction,
            cur: payload.currentPath,
            files: payload.files,
            dirs: payload.dirs,
            bytes: payload.bytes,
            elapsedMs: payload.elapsedMs,
          });
        }),
        listen<ScanDone>(EVENT_DONE, ({ payload }) => {
          if (payload.scanId !== scanId) return;
          stop();
          handlers.onDone(payload);
        }),
        listen<ScanFailed>(EVENT_FAILED, ({ payload }) => {
          if (payload.scanId !== scanId) return;
          stop();
          if (payload.kind === "denied") handlers.onDenied();
          else if (payload.kind !== "cancelled") handlers.onError(payload.message);
        }),
      ]);

      // Annullata mentre ci si registrava agli eventi.
      if (stopped) {
        for (const unlisten of unlistenAll) unlisten();
        return;
      }
      unlisteners.push(...unlistenAll);
      await invoke("start_scan", { scanId, path: target.path });
    };

    setup().catch((err: unknown) => {
      if (stopped) return;
      stop();
      handlers.onError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      const wasRunning = !stopped;
      stop();
      if (wasRunning) void invoke("cancel_scan", { scanId }).catch(() => {});
    };
  },
};
