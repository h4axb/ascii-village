// ---------------------------------------------------------------------------
// THE DOOR, as glyphs: door-glyphs.svg is a glyph rendering of the door (one
// <text> per square cell: glyph + colour). Replace the SVG to change the
// door - this reads whatever grid it holds.
//
// Each cell gets a part, from the drawing itself:
//   leaf    the planks between the frame's grooves (the part that swings)
//   ground  the rows below the leaf (the base, vines, the flower)
//   frame   the rest (the arch around the leaf)
// Per row, the frame's band runs from the silhouette's edge to the first dark
// groove cell; the leaf is what lies between the grooves (or, where a row
// has none, the silhouette inset by its usual band width).
// ---------------------------------------------------------------------------
import svg from './door-glyphs.svg?raw';

export type Part = 'frame' | 'leaf' | 'ground';
export interface DoorCell {
  c: number;
  r: number;
  ch: string;
  rgb: [number, number, number];
  part: Part;
}
export interface Door {
  cols: number;
  rows: number;
  cells: DoorCell[];
  at: (DoorCell | null)[]; // r * cols + c
  leaf: Uint8Array; // r * cols + c: 1 inside the closed leaf's area
  leafTop: number; // rows / columns the leaf spans
  leafBottom: number;
  hinge: number; // the leaf's left column (it swings on this side)
  leafRight: number;
}

const lum = (k: [number, number, number]) => 0.299 * k[0] + 0.587 * k[1] + 0.114 * k[2];
const unescape = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

function parse(src: string): Door {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(src);
  const raw: { x: number; y: number; rgb: [number, number, number]; ch: string }[] = [];
  for (const m of src.matchAll(/<text x="([\d.]+)" y="([\d.]+)" fill="#([0-9a-fA-F]{6})">([^<]*)<\/text>/g)) {
    const h = m[3];
    raw.push({ x: +m[1], y: +m[2], rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], ch: unescape(m[4]) });
  }
  // the cell pitch: the smallest step between distinct x positions
  const xs = [...new Set(raw.map((k) => k.x))].sort((a, b) => a - b);
  let pitch = Infinity;
  for (let i = 1; i < xs.length; i++) pitch = Math.min(pitch, xs[i] - xs[i - 1]);
  if (!isFinite(pitch)) pitch = 20;
  const cols = vb ? Math.round(+vb[1] / pitch) : Math.round(xs[xs.length - 1] / pitch) + 1;
  const rows = vb ? Math.round(+vb[2] / pitch) : 1 + Math.round(Math.max(...raw.map((k) => k.y)) / pitch);
  const at: (DoorCell | null)[] = new Array(cols * rows).fill(null);
  const cells: DoorCell[] = [];
  for (const k of raw) {
    const c = Math.floor(k.x / pitch), r = Math.floor(k.y / pitch);
    if (c < 0 || r < 0 || c >= cols || r >= rows || !k.ch.trim()) continue;
    const cell: DoorCell = { c, r, ch: k.ch, rgb: k.rgb, part: 'frame' };
    at[r * cols + c] = cell;
    cells.push(cell);
  }

  // per row: the silhouette, and the grooves inside it
  const dark = (cell: DoorCell | null) => !cell || lum(cell.rgb) < 70;
  const span: ({ l: number; r: number } | null)[] = [];
  for (let r = 0; r < rows; r++) {
    let l = -1, rr = -1;
    for (let c = 0; c < cols; c++)
      if (at[r * cols + c]) {
        if (l < 0) l = c;
        rr = c;
      }
    span.push(l < 0 ? null : { l, r: rr });
  }
  // the ground: the rows at the bottom wider than the door's body (or sparse:
  // stray vines)
  const widths = span.map((s) => (s ? s.r - s.l : 0));
  const filled = (r: number) => at.slice(r * cols, (r + 1) * cols).filter(Boolean).length;
  const body = [...widths].sort((a, b) => a - b)[Math.floor(rows * 0.6)];
  let groundTop = rows;
  while (groundTop > 0 && (widths[groundTop - 1] > body || filled(groundTop - 1) < widths[groundTop - 1] * 0.5)) groundTop--;
  // the crown: the leaf starts below the top groove (the first row with a run
  // of dark cells)
  let crown = 0;
  for (let r = 0; r < groundTop && !crown; r++) {
    const s = span[r];
    if (!s) continue;
    let run = 0;
    for (let c = s.l; c <= s.r; c++) {
      run = dark(at[r * cols + c]) ? run + 1 : 0;
      if (run >= 3) {
        crown = r + 1;
        break;
      }
    }
  }

  const leaf = new Uint8Array(cols * rows);
  let leafTop = rows, leafBottom = -1, hinge = cols, leafRight = -1;
  const edges: { r: number; l: number; rr: number }[] = [];
  for (let r = crown; r < groundTop; r++) {
    const s = span[r];
    if (!s || s.r - s.l < 6) continue;
    // the groove: the first dark cell from each side, within a few cells of the edge
    let a = -1, b = -1;
    for (let c = s.l + 1; c <= s.l + 3; c++) if (dark(at[r * cols + c])) {
      a = c;
      break;
    }
    for (let c = s.r - 1; c >= s.r - 3; c--) if (dark(at[r * cols + c])) {
      b = c;
      while (c - 1 > s.l && dark(at[r * cols + c - 1]) && c - 1 >= s.r - 3) b = --c;
      break;
    }
    const l = a > 0 ? a + 1 : s.l + 2;
    const rr = b > 0 ? b - 1 : s.r - 3;
    if (rr - l >= 3) edges.push({ r, l, rr });
  }
  // the leaf's usual left and right edges (rows that stray past them are
  // reading the groove as planks)
  const mode = (v: number[]) => {
    const n = new Map<number, number>();
    v.forEach((x) => n.set(x, (n.get(x) ?? 0) + 1));
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  };
  const L = mode(edges.map((e) => e.l)), R = mode(edges.map((e) => e.rr));
  for (const e of edges) {
    const l = Math.max(L, e.l), rr = Math.min(R, e.rr);
    for (let c = l; c <= rr; c++) leaf[e.r * cols + c] = 1;
    leafTop = Math.min(leafTop, e.r);
    leafBottom = Math.max(leafBottom, e.r);
    hinge = Math.min(hinge, l);
    leafRight = Math.max(leafRight, rr);
  }
  for (const cell of cells) cell.part = cell.r >= groundTop ? 'ground' : leaf[cell.r * cols + cell.c] ? 'leaf' : 'frame';
  return { cols, rows, cells, at, leaf, leafTop, leafBottom, hinge, leafRight };
}

export const DOOR: Door = parse(svg);
