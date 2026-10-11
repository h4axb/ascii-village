// ---------------------------------------------------------------------------
// THE VIEW THROUGH THE DOOR: beach-scene.svg (a glyph drawing: one <text> per
// square cell, glyph + colour - sky, clouds, the sea, the shore and sand),
// sampled into the doorway by scene.ts. Replace the SVG to change the view.
//
// Its water moves, calmly: the sea drifts a little from side to side, row by
// row, and the tide pulls in and out at the shore - the water's edge creeps
// up the sand with a line of foam and slides back, leaving the sand wet.
// ---------------------------------------------------------------------------
import svg from './beach-scene.svg?raw';
import type { RGB } from './glyphCanvas';

const TIDE = { rows: 3, ms: 6500 }; // how far up the sand the water comes (rows), one breath in and out
const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

interface Cell {
  ch: string;
  c: RGB;
}
const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
const PITCH = 20;
const COLS = Math.round(+vb[1] / PITCH), ROWS = Math.round(+vb[2] / PITCH);
const grid: (Cell | null)[] = new Array(COLS * ROWS).fill(null);
for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" fill="#([0-9a-fA-F]{6})">([^<]*)<\/text>/g)) {
  const c = Math.floor(+m[1] / PITCH), r = Math.floor(+m[2] / PITCH);
  const h = m[3];
  if (c < COLS && r < ROWS) grid[r * COLS + c] = { ch: unescape(m[4]), c: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] };
}
const at = (c: number, r: number) => grid[Math.max(0, Math.min(ROWS - 1, r)) * COLS + Math.max(0, Math.min(COLS - 1, c))];

// the drawn area (the picture's empty margins left out)
let c0 = COLS, c1 = 0, r0 = ROWS, r1 = 0;
grid.forEach((v, i) => {
  if (!v) return;
  const c = i % COLS, r = (i / COLS) | 0;
  // a column or row with only a few stray glyphs is margin
  c0 = Math.min(c0, c);
  c1 = Math.max(c1, c);
  r0 = Math.min(r0, r);
  r1 = Math.max(r1, r);
});
const colFill = (c: number) => grid.filter((v, i) => v && i % COLS === c).length;
while (c1 > c0 && colFill(c1) < ROWS * 0.4) c1--;
while (c0 < c1 && colFill(c0) < ROWS * 0.4) c0++;

// water and sand, by colour
const isWater = (v: Cell | null) => !!v && v.c[2] > v.c[0] + 25;
const isSand = (v: Cell | null) => !!v && v.c[0] > v.c[2] + 25;
// the sea: the rows below the clouds that are mostly water; the shore, per
// column: the first sand row below the sea
const rowWater = (r: number) => {
  let n = 0;
  for (let c = c0; c <= c1; c++) if (isWater(at(c, r))) n++;
  return n / (c1 - c0 + 1);
};
let seaBottom = r1;
while (seaBottom > r0 && rowWater(seaBottom) < 0.6) seaBottom--;
let seaTop = seaBottom;
while (seaTop > r0 && rowWater(seaTop - 1) >= 0.6) seaTop--;
const shore: number[] = [];
for (let c = 0; c < COLS; c++) {
  let r = seaBottom + 1;
  while (r < r1 && !isSand(at(c, r))) r++;
  shore[c] = r;
}
// a sea cell for the tide to bring up the sand, and the foam at its edge
const FOAM: RGB = [236, 246, 244];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// the view at (u, v) in 0..1 of the doorway, at time t (ms); null = nothing drawn there
export function beachAt(u: number, v: number, t: number): Cell | null {
  const c = Math.floor(c0 + u * (c1 - c0 + 1));
  const r = Math.floor(r0 + v * (r1 - r0 + 1));
  const s = t / 1000;
  // the tide: in and out, a little ahead along one side of the beach
  const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / TIDE.ms + (c - c0) * 0.12);
  const reach = shore[c] + (TIDE.rows + 1) * k - 1.2; // where the water ends, rows (fractional)
  if (r >= shore[c] - 1 && r < shore[c] + TIDE.rows + 1) {
    if (r < reach) {
      // the sea, brought up the sand: the edge is foam
      const sea = at(c + Math.round(Math.sin(s * 0.7 + r) * 1.2), seaBottom - Math.abs((r - seaBottom) % 3) - 1) ?? at(c, seaBottom);
      if (!sea) return at(c, r);
      const edge = reach - r < 1;
      if (edge) return { ch: hash(c, Math.floor(s * 2)) > 0.5 ? '~' : '-', c: mix(sea.c, FOAM, 0.75) };
      return { ch: sea.ch, c: mix(sea.c, FOAM, 0.12) };
    }
    // sand the water has just left: wet, darker, for a moment
    const wet = clamp01((shore[c] + (TIDE.rows + 1) - r) / (TIDE.rows + 1)) * (1 - k);
    const sand = at(c, r);
    if (sand && isSand(sand) && wet > 0) return { ch: sand.ch, c: mix(sand.c, [sand.c[0] * 0.62, sand.c[1] * 0.6, sand.c[2] * 0.62], wet) };
    return sand;
  }
  // the sea: each row drifts a little from side to side, calmly
  if (r >= seaTop && r <= seaBottom) {
    const dx = Math.round(Math.sin(s * 0.6 + r * 0.55) * 1.4);
    const v2 = at(c + dx, r);
    if (v2 && isWater(v2)) {
      // a glint now and then
      if (hash(c + Math.floor(s * 1.5), r) > 0.97) return { ch: '°', c: mix(v2.c, FOAM, 0.5) };
      return v2;
    }
  }
  return at(c, r);
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
