export const fmtInt = (n: number): string => Math.round(n).toLocaleString("it-IT");

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${units[i]}`;
}

export const fmtPct = (p: number): string =>
  `${p.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Percentuale di avanzamento, o "in corso" se non stimabile. */
export const fmtProgress = (p: number | null): string =>
  p == null ? "in corso" : `${Math.floor(p * 100)} %`;

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
