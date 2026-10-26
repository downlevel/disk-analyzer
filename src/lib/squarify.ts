export interface TmInput<T> {
  value: number;
  data: T;
}

export interface TmRect<T> {
  data: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "Squarified" treemap layout (Bruls et al.). Items must be passed in descending order. */
export function squarify<T>(
  items: TmInput<T>[],
  x: number,
  y: number,
  w: number,
  h: number,
): TmRect<T>[] {
  const out: TmRect<T>[] = [];
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total || w <= 0 || h <= 0) return out;

  const scale = (w * h) / total;
  const nodes = items.map((i) => ({ data: i.data, area: i.value * scale }));
  let row: typeof nodes = [];

  const worst = (r: typeof nodes, len: number): number => {
    let sum = 0;
    let max = 0;
    let min = Infinity;
    for (const q of r) {
      sum += q.area;
      max = Math.max(max, q.area);
      min = Math.min(min, q.area);
    }
    return Math.max((len * len * max) / (sum * sum), (sum * sum) / (len * len * min));
  };

  const layRow = () => {
    const sum = row.reduce((a, b) => a + b.area, 0);
    if (w >= h) {
      const rw = sum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.area / rw;
        out.push({ data: r.data, x, y: cy, w: rw, h: rh });
        cy += rh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = sum / w;
      let cx = x;
      for (const r of row) {
        const rw = r.area / rh;
        out.push({ data: r.data, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };

  let i = 0;
  while (i < nodes.length) {
    const len = Math.min(w, h);
    const n = nodes[i];
    if (!row.length || worst([...row, n], len) <= worst(row, len)) {
      row.push(n);
      i++;
    } else {
      layRow();
    }
  }
  if (row.length) layRow();
  return out;
}
