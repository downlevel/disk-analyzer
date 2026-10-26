import { describe, expect, it } from "vitest";
import { fmtDuration, fmtInt, fmtPct, fmtSize } from "./format";

describe("fmtSize", () => {
  it("usa i byte sotto 1 KB", () => {
    expect(fmtSize(0)).toBe("0 B");
    expect(fmtSize(1023)).toBe("1023 B");
  });

  it("sceglie l'unità e usa la virgola decimale", () => {
    expect(fmtSize(1024)).toBe("1,0 KB");
    expect(fmtSize(1536)).toBe("1,5 KB");
    expect(fmtSize(5 * 1024 ** 2)).toBe("5,0 MB");
    expect(fmtSize(2.5 * 1024 ** 3)).toBe("2,5 GB");
  });

  it("non va oltre i TB", () => {
    expect(fmtSize(2048 * 1024 ** 4)).toBe("2048,0 TB");
  });
});

describe("fmtInt / fmtPct / fmtDuration", () => {
  it("separa le migliaia all'italiana (dai 5 cifre in su)", () => {
    expect(fmtInt(1234567)).toBe("1.234.567");
    expect(fmtInt(12345)).toBe("12.345");
    expect(fmtInt(1234)).toBe("1234");
  });

  it("formatta le percentuali con un decimale", () => {
    expect(fmtPct(12.34)).toBe("12,3 %");
  });

  it("formatta la durata come m:ss", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(65_000)).toBe("1:05");
  });
});
