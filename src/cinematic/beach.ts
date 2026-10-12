// ---------------------------------------------------------------------------
// THE VIEW THROUGH THE DOOR: the right half of door-view.svg (a glyph drawing
// baked by the Glyph Generator: one <text> per 20px cell, in groups - the sky
// behind the clouds, the clouds, the sea, the sand), sampled into the doorway
// by scene.ts.
//
// The SVG animates itself with CSS, and that animation is played here:
//   .sNN / .dNN  the sea and sand wash toward foam and back (fill keyframes:
//                color-mix(color-mix(var(--c) a%, t1) b%, t2), a 4.2 s loop)
//   .oNN         glints on the sea fade in and out (opacity keyframes)
//   #partN       the clouds drift sideways (translateX keyframes); each cloud
//                carries a <path> of background cells that hides the sky
//                behind it and moves with it
// Replace the SVG to change the view.
// ---------------------------------------------------------------------------
import svg from './door-view.svg?raw';
import type { RGB } from './glyphCanvas';

const CROP = { c0: 15, c1: 29 }; // the columns shown: the picture's right half
const DRIFT_SPEED = 10; // the clouds' drift, × the SVG's own (minutes long: still, in a short shot)

const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const rgb = (h: string): RGB => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

interface Cell {
  ch: string;
  c: RGB;
}
const PITCH = 20;
const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
const COLS = Math.round(+vb[1] / PITCH), ROWS = Math.round(+vb[2] / PITCH);
const BG = rgb((/<rect [^>]*fill="#([0-9a-fA-F]{6})"/.exec(svg) ?? ['', '16100d'])[1]);

// ---- the animations ---------------------------------------------------------
interface WashStop {
  p: number; // 0..1 of the loop
  a: number; // the inner mix: var(--c) a% with t1
  t1: RGB;
  b: number; // the outer mix: that b% with t2
  t2: RGB;
}
interface FadeStop {
  p: number;
  o: number; // opacity
}
const wash = new Map<string, WashStop[]>();
const fade = new Map<string, FadeStop[]>();
for (const m of svg.matchAll(/@keyframes ([\w-]+)\{(.*)\}\s*$/gm)) {
  const [, name, body] = m;
  const ws = [...body.matchAll(/([\d.]+)%\{fill:color-mix\(in srgb,color-mix\(in srgb,var\(--c\) ([\d.]+)%,#(\w{6}) [\d.]+%\) ([\d.]+)%,#(\w{6}) [\d.]+%\)\}/g)];
  if (ws.length) wash.set(name, ws.map((s) => ({ p: +s[1] / 100, a: +s[2] / 100, t1: rgb(s[3]), b: +s[4] / 100, t2: rgb(s[5]) })));
  const fs = [...body.matchAll(/([\d.]+)%\{opacity:([\d.]+)/g)];
  if (fs.length) fade.set(name, fs.map((s) => ({ p: +s[1] / 100, o: +s[2] })));
}
// class -> its keyframes and loop length (ms)
const classAnim = new Map<string, { name: string; ms: number }>();
for (const m of svg.matchAll(/\.([\w-]+)\{animation:([\w-]+) ([\d.]+)s/g)) classAnim.set(m[1], { name: m[2], ms: +m[3] * 1000 });
// the stop pair around phase p, and how far between them
function between<S extends { p: number }>(stops: S[], p: number): [S, S, number] {
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].p <= p) i++;
  const a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)];
  return [a, b, b.p > a.p ? (p - a.p) / (b.p - a.p) : 0];
}

// ---- the layers -------------------------------------------------------------
interface AnimCell extends Cell {
  base?: RGB; // var(--c)
  anim?: { name: string; ms: number };
}
interface Layer {
  cells: (AnimCell | null)[];
  hole: Uint8Array; // 1: a background cell (a cloud's backing), hides what's behind
  drift?: { dx: number; ms: number; delay: number }; // px, ms, ms
}
const layers: Layer[] = [];
for (const g of svg.matchAll(/<g id="([\w-]+)"[^>]*>([\s\S]*?)<\/g>/g)) {
  const [, id, body] = g;
  const L: Layer = { cells: new Array(COLS * ROWS).fill(null), hole: new Uint8Array(COLS * ROWS) };
  for (const p of body.matchAll(/<path d="([^"]*)"/g))
    for (const q of p[1].matchAll(/M([\d.]+) ([\d.]+)h/g)) {
      const c = Math.round(+q[1] / PITCH), r = Math.round(+q[2] / PITCH);
      if (c < COLS && r < ROWS) L.hole[r * COLS + c] = 1;
    }
  for (const t of body.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)) {
    const at = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(t[1])?.[1];
    const c = Math.floor(+at('x')! / PITCH), r = Math.floor(+at('y')! / PITCH);
    if (c >= COLS || r >= ROWS) continue;
    const base = /--c:#(\w{6})/.exec(at('style') ?? '')?.[1];
    const cls = at('class');
    L.cells[r * COLS + c] = { ch: unescape(t[2]), c: rgb(at('fill')!.slice(1)), base: base ? rgb(base) : undefined, anim: cls ? classAnim.get(cls) : undefined };
    L.hole[r * COLS + c] = 0;
  }
  const d = new RegExp(`#${id}\\{animation:([\\w-]+) ([\\d.]+)s \\S+ (-?[\\d.]+)s`).exec(svg);
  const dx = d && new RegExp(`@keyframes ${d[1]}\\{.*to\\{transform:translateX\\((-?[\\d.]+)px\\)`).exec(svg);
  if (d && dx) L.drift = { dx: +dx[1], ms: +d[2] * 1000, delay: +d[3] * 1000 };
  layers.push(L);
}
layers.reverse(); // the topmost first

// a drifting layer's offset at time t, whole cells (ease-in-out, back and forth)
function driftCells(d: NonNullable<Layer['drift']>, t: number): number {
  const ph = (t * DRIFT_SPEED - d.delay) / d.ms;
  let f = ph - Math.floor(ph);
  if (Math.floor(ph) % 2) f = 1 - f;
  return Math.round((d.dx * (0.5 - 0.5 * Math.cos(Math.PI * f))) / PITCH);
}

function animated(v: AnimCell, t: number): Cell {
  if (!v.anim) return v;
  const p = (t % v.anim.ms) / v.anim.ms;
  const ws = wash.get(v.anim.name);
  if (ws && v.base) {
    const [a, b, k] = between(ws, p);
    const inner = mix(mix(v.base, a.t1, 1 - a.a), mix(v.base, b.t1, 1 - b.a), k);
    return { ch: v.ch, c: mix(mix(inner, a.t2, 1 - a.b), mix(inner, b.t2, 1 - b.b), k) };
  }
  const fs = fade.get(v.anim.name);
  if (fs) {
    const [a, b, k] = between(fs, p);
    return { ch: v.ch, c: mix(BG, v.c, a.o + (b.o - a.o) * k) };
  }
  return v;
}

// the view at (u, v) in 0..1 of the doorway, at time t (ms); null = nothing drawn there
export function beachAt(u: number, v: number, t: number): Cell | null {
  const c = CROP.c0 + Math.min(CROP.c1 - CROP.c0, Math.floor(u * (CROP.c1 - CROP.c0 + 1)));
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor(v * ROWS)));
  for (const L of layers) {
    const cc = L.drift ? c - driftCells(L.drift, t) : c;
    if (cc < 0 || cc >= COLS) continue;
    const i = r * COLS + cc;
    const cell = L.cells[i];
    if (cell) return animated(cell, t);
    if (L.hole[i]) return null;
  }
  return null;
}
