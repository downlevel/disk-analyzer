import { describe, expect, it } from "vitest";
import { squarify } from "./squarify";

const items = [60, 30, 20, 10, 5, 5].map((value, i) => ({ value, data: `n${i}` }));

describe("squarify", () => {
  it("restituisce un rettangolo per elemento, dentro l'area disponibile", () => {
    const rects = squarify(items, 10, 20, 400, 300);
    expect(rects).toHaveLength(items.length);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(r.y).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(410 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(320 + 1e-9);
    }
  });

  it("riempie l'intera area e assegna a ciascuno una superficie proporzionale", () => {
    const rects = squarify(items, 0, 0, 400, 300);
    const total = items.reduce((a, b) => a + b.value, 0);
    const area = rects.reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBeCloseTo(400 * 300, 3);
    for (const r of rects) {
      const value = items.find((i) => i.data === r.data)!.value;
      expect(r.w * r.h).toBeCloseTo((value / total) * 400 * 300, 3);
    }
  });

  it("non sovrappone i rettangoli", () => {
    const rects = squarify(items, 0, 0, 400, 300);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapW > 1e-6 && overlapH > 1e-6).toBe(false);
      }
    }
  });

  it("gestisce input vuoto e aree nulle", () => {
    expect(squarify([], 0, 0, 100, 100)).toEqual([]);
    expect(squarify(items, 0, 0, 0, 100)).toEqual([]);
    expect(squarify([{ value: 0, data: "x" }], 0, 0, 100, 100)).toEqual([]);
  });
});
