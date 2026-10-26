// Eventi della misura delle app installate (src-tauri/src/commands.rs).
import { listen } from "@tauri-apps/api/event";
import type { AppSize } from "../bindings/AppSize";
import type { AppsMeasureDone } from "../bindings/AppsMeasureDone";

// Devono coincidere con le costanti in src-tauri/src/model.rs.
export const EVENT_APP_SIZE = "apps:size";
export const EVENT_APPS_DONE = "apps:done";

export interface AppSizeHandlers {
  onSize: (size: AppSize) => void;
  onDone: (done: AppsMeasureDone) => void;
}

/** Si mette in ascolto degli eventi; restituisce la funzione per smettere. */
export async function listenAppSizes(handlers: AppSizeHandlers): Promise<() => void> {
  const unlisteners = await Promise.all([
    listen<AppSize>(EVENT_APP_SIZE, ({ payload }) => handlers.onSize(payload)),
    listen<AppsMeasureDone>(EVENT_APPS_DONE, ({ payload }) => handlers.onDone(payload)),
  ]);
  return () => unlisteners.forEach((unlisten) => unlisten());
}
