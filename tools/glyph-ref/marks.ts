// The markings a reference carries for the crafting generator: which cells are
// which part (and what material zone that part is), named anchor points, and
// decoration slots. Stored relative to the OBJECT (0..1 of its box), not to
// the glyph grid, so one set of marks fits every sign count it is baked at.
import type { Baked } from './bake';

export type Zone = 'primary' | 'secondary' | 'trim' | 'fixed';
export const ZONES: Zone[] = ['primary', 'secondary', 'trim', 'fixed'];

export interface Part {
  name: string;
  zone: Zone;
  color: string; // only for painting in the tool
}
export interface Anchor {
  name: string;
  x: number; // 0..1 of the object box
  y: number;
}
export interface Slot {
  name: string;
  x: number; // top-left, 0..1 of the object box
  y: number;
  w: number;
  h: number;
  accepts: string[]; // decoration tags it takes
}
export interface Marks {
  parts: Part[];
  partMap: number[]; // MARK_RES x MARK_RES over the object box: 0 = none, i + 1 = parts[i]
  anchors: Anchor[];
  slots: Slot[];
  tags: string[];
  category: string; // vehicle, tool, pet, hold, decoration, prop, …
  sizeBand: 'small' | 'medium' | 'large';
}
export const MARK_RES = 96;

export const PART_COLORS = ['#ff5f5f', '#5fa8ff', '#5fdc7a', '#ffc94d', '#c77dff', '#4de1d2', '#ff8fd0', '#b0b0b0'];

export const emptyMarks = (): Marks => ({
  parts: [],
  partMap: new Array(MARK_RES * MARK_RES).fill(0),
  anchors: [],
  slots: [],
  tags: [],
  category: '',
  sizeBand: 'small',
});

// the part (index) of every baked cell: the most painted part in its area
export function partsOfCells(b: Baked, m: Marks): (number | null)[] {
  return b.cells.map((c, i) => {
    if (!c) return null;
    const r = (i / b.cols) | 0, col = i % b.cols;
    const x0 = Math.floor((col / b.cols) * MARK_RES), x1 = Math.max(x0 + 1, Math.floor(((col + 1) / b.cols) * MARK_RES));
    const y0 = Math.floor((r / b.rows) * MARK_RES), y1 = Math.max(y0 + 1, Math.floor(((r + 1) / b.rows) * MARK_RES));
    const count = new Map<number, number>();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = m.partMap[y * MARK_RES + x];
      if (p) count.set(p, (count.get(p) ?? 0) + 1);
    }
    let best = 0, bn = 0;
    for (const [p, n] of count) if (n > bn) { bn = n; best = p; }
    return best ? best - 1 : null;
  });
}

// paint a disc of radius `rad` (0..1 units) with part `p` (0 = erase)
export function paintPart(m: Marks, x: number, y: number, rad: number, p: number): Marks {
  const map = m.partMap.slice();
  const R = rad * MARK_RES;
  const cx = x * MARK_RES, cy = y * MARK_RES;
  for (let yy = Math.floor(cy - R); yy <= Math.ceil(cy + R); yy++)
    for (let xx = Math.floor(cx - R); xx <= Math.ceil(cx + R); xx++) {
      if (xx < 0 || yy < 0 || xx >= MARK_RES || yy >= MARK_RES) continue;
      if ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= R * R) map[yy * MARK_RES + xx] = p;
    }
  return { ...m, partMap: map };
}

// zones from auto-clustered cells -> painted parts
export function marksFromZones(b: Baked, zones: (number | null)[], k: number, base: Marks): Marks {
  const map = new Array(MARK_RES * MARK_RES).fill(0);
  for (let y = 0; y < MARK_RES; y++)
    for (let x = 0; x < MARK_RES; x++) {
      const c = Math.min(b.cols - 1, Math.floor((x / MARK_RES) * b.cols));
      const r = Math.min(b.rows - 1, Math.floor((y / MARK_RES) * b.rows));
      const z = zones[r * b.cols + c];
      map[y * MARK_RES + x] = z == null ? 0 : z + 1;
    }
  const parts: Part[] = Array.from({ length: k }, (_, i) => ({
    name: `zone${i + 1}`,
    zone: i === 0 ? 'secondary' : i === k - 1 ? 'trim' : 'primary',
    color: PART_COLORS[i % PART_COLORS.length],
  }));
  return { ...base, parts, partMap: map };
}
