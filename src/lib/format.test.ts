import { describe, expect, it } from "vitest";
import { fmtDuration, fmtInt, fmtPct, fmtSize } from "./format";

describe("fmtSize", () => {
  it("uses bytes below 1 KB", () => {
    expect(fmtSize(0)).toBe("0 B");
    expect(fmtSize(1023)).toBe("1023 B");
  });

  it("picks the unit and uses the decimal point", () => {
    expect(fmtSize(1024)).toBe("1.0 KB");
    expect(fmtSize(1536)).toBe("1.5 KB");
    expect(fmtSize(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(fmtSize(2.5 * 1024 ** 3)).toBe("2.5 GB");
  });

  it("does not go beyond TB", () => {
    expect(fmtSize(2048 * 1024 ** 4)).toBe("2,048.0 TB");
  });
});

describe("fmtInt / fmtPct / fmtDuration", () => {
  it("separates thousands with commas", () => {
    expect(fmtInt(1234567)).toBe("1,234,567");
    expect(fmtInt(12345)).toBe("12,345");
    expect(fmtInt(1234)).toBe("1,234");
  });

  it("formats percentages with one decimal", () => {
    expect(fmtPct(12.34)).toBe("12.3%");
  });

  it("formats the duration as m:ss", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(65_000)).toBe("1:05");
  });
});
