import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanTarget } from "../lib/types";
import type { ScanHandlers } from "./types";

type Listener = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  unlisten: vi.fn(),
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: Listener) => {
    mocks.listeners.set(name, cb);
    return mocks.unlisten;
  },
}));

import { EVENT_DONE, EVENT_FAILED, EVENT_PROGRESS, tauriScanner } from "./tauriScanner";

const target: ScanTarget = { path: "C:\\Dati" };

function handlers(): ScanHandlers {
  return { onProgress: vi.fn(), onDone: vi.fn(), onDenied: vi.fn(), onError: vi.fn() };
}

/** Avvia una scansione e restituisce l'id assegnato, letto dalla chiamata a `start_scan`. */
async function startScan(h: ScanHandlers) {
  const cancel = tauriScanner.start(target, h);
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("start_scan", expect.anything()),
  );
  const args = mocks.invoke.mock.calls.find(([cmd]) => cmd === "start_scan")?.[1] as {
    scanId: number;
    path: string;
  };
  return { cancel, scanId: args.scanId, path: args.path };
}

const emit = (event: string, payload: unknown) => mocks.listeners.get(event)?.({ payload });

beforeEach(() => {
  mocks.listeners.clear();
  mocks.unlisten.mockClear();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
});

describe("tauriScanner", () => {
  it("avvia la scansione sul percorso richiesto dopo aver ascoltato gli eventi", async () => {
    const { path } = await startScan(handlers());
    expect(path).toBe("C:\\Dati");
    expect([...mocks.listeners.keys()].sort()).toEqual(
      [EVENT_DONE, EVENT_FAILED, EVENT_PROGRESS].sort(),
    );
  });

  it("converte l'avanzamento e ignora gli eventi di altre scansioni", async () => {
    const h = handlers();
    const { scanId } = await startScan(h);

    emit(EVENT_PROGRESS, {
      scanId: scanId + 1,
      files: 1,
      dirs: 1,
      bytes: 1,
      currentPath: "altro",
      elapsedMs: 1,
      fraction: null,
    });
    expect(h.onProgress).not.toHaveBeenCalled();

    emit(EVENT_PROGRESS, {
      scanId,
      files: 10,
      dirs: 2,
      bytes: 2048,
      currentPath: "C:\\Dati\\a",
      elapsedMs: 300,
      fraction: 0.25,
    });
    expect(h.onProgress).toHaveBeenCalledWith({
      p: 0.25,
      cur: "C:\\Dati\\a",
      files: 10,
      dirs: 2,
      bytes: 2048,
      elapsedMs: 300,
    });
  });

  it("riporta p nullo quando l'avanzamento non è stimabile", async () => {
    const h = handlers();
    const { scanId } = await startScan(h);
    emit(EVENT_PROGRESS, {
      scanId,
      files: 0,
      dirs: 0,
      bytes: 0,
      currentPath: "x",
      elapsedMs: 0,
      fraction: null,
    });
    expect(h.onProgress).toHaveBeenCalledWith(expect.objectContaining({ p: null }));
  });

  it("al completamento passa l'esito intero e smette di ascoltare", async () => {
    const h = handlers();
    const { scanId } = await startScan(h);
    const done = { scanId, files: 3, dirs: 1, bytes: 9, denied: 0, elapsedMs: 1500, root: {} };
    emit(EVENT_DONE, done);
    expect(h.onDone).toHaveBeenCalledWith(done);
    expect(mocks.unlisten).toHaveBeenCalledTimes(3);
  });

  it("distingue accesso negato, annullamento ed errori generici", async () => {
    const base = { path: "C:\\Dati", message: "msg", files: 0, bytes: 0 };

    const denied = handlers();
    let scan = await startScan(denied);
    emit(EVENT_FAILED, { ...base, scanId: scan.scanId, kind: "denied" });
    expect(denied.onDenied).toHaveBeenCalledOnce();

    mocks.invoke.mockClear();
    const cancelled = handlers();
    scan = await startScan(cancelled);
    emit(EVENT_FAILED, { ...base, scanId: scan.scanId, kind: "cancelled" });
    expect(cancelled.onDenied).not.toHaveBeenCalled();
    expect(cancelled.onError).not.toHaveBeenCalled();

    mocks.invoke.mockClear();
    const broken = handlers();
    scan = await startScan(broken);
    emit(EVENT_FAILED, {
      ...base,
      scanId: scan.scanId,
      kind: "notFound",
      message: "Percorso non trovato",
    });
    expect(broken.onError).toHaveBeenCalledWith("Percorso non trovato");
  });

  it("annullando chiede l'annullamento al core e smette di ascoltare", async () => {
    const h = handlers();
    const { cancel, scanId } = await startScan(h);
    cancel();
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_scan", { scanId });
    expect(mocks.unlisten).toHaveBeenCalledTimes(3);

    mocks.invoke.mockClear();
    cancel();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("riporta l'errore se il comando di avvio fallisce", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("boom"));
    const h = handlers();
    tauriScanner.start(target, h);
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledWith("boom"));
    expect(mocks.unlisten).toHaveBeenCalledTimes(3);
  });
});
