// ---------------------------------------------------------------------------
// GROUND PAINT — dirt, meadow, stone ground and stepping stones, painted onto
// the island with the world editor's Ground tab.
//
//   src/data/ground.json
//     cells    one material + strength per character cell (run-length
//              encoded, base64): what the area brushes paint
//     stones   the stepping stones the path brush stamps: x, y (cells),
//              size, rotation, seed
//
// This module only holds the data and the brush maths. terrain.ts reads it
// (groundAt / slabAt) and draws each material with its own colours (theme
// swatches ground.*), glyphs and ragged, dithered edges; only the land is
// painted, never sand or water. A stroke repaints just the cells under it
// (onGroundEdit → terrain.ts updateTerrainRegion → TerrainCanvas).
// ---------------------------------------------------------------------------
import groundData from './data/ground.json';
import { GROUND_W, GROUND_H, TILE_CH, TILE_LN } from './world';

export const MAT_NONE = 0;
export const MAT_DIRT = 1;
export const MAT_MEADOW = 2;
export const MAT_STONE = 3;
export type Material = typeof MAT_DIRT | typeof MAT_MEADOW | typeof MAT_STONE;

// what a cell measures on screen (8.4 x 14 px, see App.tsx) — brushes and
// stones are round on screen, not in cells
const CH_PX = 8.4;
const LN_PX = 14;
const TILE_PX = 30; // one brush-size unit, about one map tile

export interface Stone {
  x: number; // centre, cells
  y: number;
  r: number; // size, brush units
  rot: number; // radians
  seed: number;
}
export interface GroundDoc {
  version: 1;
  w: number;
  h: number;
  cells: string;
  stones: Stone[];
}

const N = GROUND_W * GROUND_H;
const mat = new Uint8Array(N);
const wgt = new Uint8Array(N);
let stones: Stone[] = [];
let slab: Uint8Array | null = null; // 0 · 1 stone · 2 stone rim (from `stones`)

// ---- (de)serialising --------------------------------------------------------
// runs of [count u16 LE, material u8, strength u8]
function encodeCells(): string {
  const out: number[] = [];
  let i = 0;
  while (i < N) {
    const m = mat[i];
    const w = m ? wgt[i] : 0;
    let n = 1;
    while (i + n < N && n < 65535 && mat[i + n] === m && (m ? wgt[i + n] : 0) === w) n++;
    out.push(n & 255, n >> 8, m, w);
    i += n;
  }
  let s = '';
  for (let k = 0; k < out.length; k += 8192) s += String.fromCharCode(...out.slice(k, k + 8192));
  return btoa(s);
}
function decodeCells(b64: string) {
  mat.fill(0);
  wgt.fill(0);
  if (!b64) return;
  const s = atob(b64);
  let i = 0;
  for (let k = 0; k + 3 < s.length && i < N; k += 4) {
    const n = s.charCodeAt(k) | (s.charCodeAt(k + 1) << 8);
    const m = s.charCodeAt(k + 2);
    const w = s.charCodeAt(k + 3);
    mat.fill(m, i, Math.min(N, i + n));
    wgt.fill(w, i, Math.min(N, i + n));
    i += n;
  }
}

let saved = JSON.stringify(groundData);
function load(d: GroundDoc) {
  if (d.w === GROUND_W && d.h === GROUND_H) decodeCells(d.cells);
  stones = (d.stones ?? []).map((s) => ({ ...s }));
  slab = null;
}
load(groundData as GroundDoc);

export function groundDoc(): GroundDoc {
  return { version: 1, w: GROUND_W, h: GROUND_H, cells: encodeCells(), stones: stones.map((s) => ({ ...s })) };
}
export const groundDirty = () => JSON.stringify(groundDoc()) !== saved;
export function markGroundSaved() {
  saved = JSON.stringify(groundDoc());
}
export function revertGround() {
  load(JSON.parse(saved) as GroundDoc);
  history.length = 0;
  future.length = 0;
  emit(0, 0, GROUND_W - 1, GROUND_H - 1);
}

// ---- reading (terrain.ts) ---------------------------------------------------
export const groundMat = (i: number) => mat[i];
export const groundWgt = (i: number) => wgt[i];
export function slabAt(i: number): number {
  return slabMask()[i];
}
// Is map tile (tx, ty) bare painted ground (dirt, stone ground or a stepping
// stone) at its centre? Wild flora doesn't grow there; meadow is fine.
export function groundBare(tx: number, ty: number): boolean {
  const x = Math.min(GROUND_W - 1, Math.max(0, Math.round((tx + 0.5) * TILE_CH)));
  const y = Math.min(GROUND_H - 1, Math.max(0, Math.round((ty + 0.5) * TILE_LN)));
  const i = y * GROUND_W + x;
  if (slabMask()[i]) return true;
  return (mat[i] === MAT_DIRT || mat[i] === MAT_STONE) && wgt[i] >= 128;
}
export const groundHasPaint = () => stones.length > 0 || mat.some((m) => m !== 0);

// ---- stepping stones ----------------------------------------------------------
function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
// an irregular, flat-ish rounded stone: per-angle radius wobble from its seed
function stoneShape(s: Stone) {
  const rx = s.r * 16; // px
  const ry = s.r * 11;
  const c = Math.cos(s.rot);
  const sn = Math.sin(s.rot);
  const wob = [0, 1, 2, 3, 4].map((k) => hash(s.seed * 7 + k) - 0.5);
  const radius = (a: number) =>
    1 + 0.16 * wob[0] * Math.cos(a * 2 + wob[1] * 6) + 0.1 * wob[2] * Math.cos(a * 3 + wob[3] * 6) + 0.05 * wob[4] * Math.cos(a * 5);
  const reach = Math.max(rx, ry) * 1.25;
  return {
    x0: Math.floor(s.x - reach / CH_PX) - 1,
    x1: Math.ceil(s.x + reach / CH_PX) + 1,
    y0: Math.floor(s.y - reach / LN_PX) - 1,
    y1: Math.ceil(s.y + reach / LN_PX) + 1,
    // 0 outside, 1 inside, 2 on the rim
    test(x: number, y: number) {
      const px = (x + 0.5 - s.x) * CH_PX;
      const py = (y + 0.5 - s.y) * LN_PX;
      const u = (px * c + py * sn) / rx;
      const v = (-px * sn + py * c) / ry;
      const d = Math.hypot(u, v);
      const r = radius(Math.atan2(v, u));
      if (d > r) return 0;
      return d > r - 0.28 / Math.max(0.6, s.r) ? 2 : 1;
    },
  };
}
function slabMask(): Uint8Array {
  if (slab) return slab;
  slab = new Uint8Array(N);
  for (const s of stones) {
    const sh = stoneShape(s);
    for (let y = Math.max(0, sh.y0); y <= Math.min(GROUND_H - 1, sh.y1); y++)
      for (let x = Math.max(0, sh.x0); x <= Math.min(GROUND_W - 1, sh.x1); x++) {
        const t = sh.test(x, y);
        const i = y * GROUND_W + x;
        if (t === 1 || (t === 2 && slab[i] === 0)) slab[i] = t;
      }
  }
  return slab;
}

// ---- the brush ----------------------------------------------------------------
export type BrushTool = Material | 'path' | 'erase';
export interface Brush {
  tool: BrushTool;
  size: number; // radius, about map tiles
  softness: number; // 0 hard … 1 all falloff
  strength: number; // 0 … 1
}
export const brush: Brush = { tool: MAT_DIRT, size: 3, softness: 0.6, strength: 1 };

type Rect = [number, number, number, number];
const listeners = new Set<(x0: number, y0: number, x1: number, y1: number) => void>();
export function onGroundEdit(fn: (x0: number, y0: number, x1: number, y1: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(x0: number, y0: number, x1: number, y1: number) {
  for (const fn of [...listeners]) fn(Math.max(0, x0), Math.max(0, y0), Math.min(GROUND_W - 1, x1), Math.min(GROUND_H - 1, y1));
}

// undo: one snapshot per stroke
interface Snap {
  mat: Uint8Array;
  wgt: Uint8Array;
  stones: Stone[];
}
const history: Snap[] = [];
const future: Snap[] = [];
const snap = (): Snap => ({ mat: mat.slice(), wgt: wgt.slice(), stones: stones.map((s) => ({ ...s })) });
function restore(s: Snap) {
  mat.set(s.mat);
  wgt.set(s.wgt);
  stones = s.stones;
  slab = null;
  emit(0, 0, GROUND_W - 1, GROUND_H - 1);
}
export const canUndoGround = () => history.length > 0;
export const canRedoGround = () => future.length > 0;
export function undoGround() {
  const s = history.pop();
  if (!s) return;
  future.push(snap());
  restore(s);
}
export function redoGround() {
  const s = future.pop();
  if (!s) return;
  history.push(snap());
  restore(s);
}

let last: { x: number; y: number } | null = null;
let lastStone: { x: number; y: number } | null = null;
let strokeSeed = 1;

export function beginStroke(x: number, y: number) {
  history.push(snap());
  if (history.length > 40) history.shift();
  future.length = 0;
  last = null;
  lastStone = null;
  strokeSeed = Math.floor(Math.random() * 1e6);
  strokeTo(x, y);
}
export function endStroke() {
  last = null;
  lastStone = null;
}

// Paint from the previous point to (x, y) (cells, fractional), in dabs a
// third of the brush apart so a fast drag leaves no gaps
export function strokeTo(x: number, y: number) {
  const from = last ?? { x, y };
  const rPx = brush.size * TILE_PX;
  const dist = Math.hypot((x - from.x) * CH_PX, (y - from.y) * LN_PX);
  const steps = Math.max(1, Math.ceil(dist / Math.max(4, rPx / 3)));
  let rect: Rect | null = null;
  for (let k = last ? 1 : 0; k <= steps; k++) {
    const t = k / steps;
    const r = dab(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
    if (r) rect = rect ? [Math.min(rect[0], r[0]), Math.min(rect[1], r[1]), Math.max(rect[2], r[2]), Math.max(rect[3], r[3])] : r;
  }
  last = { x, y };
  if (rect) emit(...rect);
}

function dab(cx: number, cy: number): Rect | null {
  const rPx = brush.size * TILE_PX;
  const rx = rPx / CH_PX;
  const ry = rPx / LN_PX;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(GROUND_W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(GROUND_H - 1, Math.ceil(cy + ry));
  if (brush.tool === 'path') return stamp(cx, cy);
  const core = 1 - brush.softness;
  let touchedStones = false;
  if (brush.tool === 'erase') {
    // the eraser also lifts stepping stones whose centre it covers
    const before = stones.length;
    stones = stones.filter((s) => Math.hypot((s.x - cx) * CH_PX, (s.y - cy) * LN_PX) > rPx);
    if (stones.length !== before) {
      slab = null;
      touchedStones = true;
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x + 0.5 - cx) * CH_PX, (y + 0.5 - cy) * LN_PX) / rPx;
      if (d > 1) continue;
      const f = d <= core ? 1 : 1 - (d - core) / Math.max(0.001, 1 - core);
      const amt = Math.round(255 * brush.strength * f * f * (3 - 2 * f));
      if (!amt) continue;
      const i = y * GROUND_W + x;
      if (brush.tool === 'erase') {
        const w = Math.max(0, wgt[i] - amt);
        wgt[i] = w;
        if (!w) mat[i] = 0;
      } else if (mat[i] === brush.tool) {
        wgt[i] = Math.max(wgt[i], amt);
      } else if (amt >= wgt[i]) {
        mat[i] = brush.tool;
        wgt[i] = amt;
      }
    }
  }
  if (touchedStones) return [x0 - 12, y0 - 8, x1 + 12, y1 + 8];
  return [x0, y0, x1, y1];
}

// the path brush: a stone every so often along the stroke, sizes and angles
// varied, nudged off the line, with grass showing between them
function stamp(cx: number, cy: number): Rect | null {
  const size = brush.size * 0.9;
  const gap = size * 16 * 2.1; // px between stone centres
  if (lastStone && Math.hypot((cx - lastStone.x) * CH_PX, (cy - lastStone.y) * LN_PX) < gap) return null;
  const k = stones.length + strokeSeed;
  const off = (hash(k * 3.1) - 0.5) * size * 12;
  const s: Stone = {
    x: cx + off / CH_PX,
    y: cy + (hash(k * 5.7) - 0.5) * (size * 8) / LN_PX,
    r: size * (0.8 + 0.4 * hash(k * 1.3)),
    rot: hash(k * 9.2) * Math.PI,
    seed: Math.floor(hash(k * 4.4) * 1e5),
  };
  stones.push(s);
  lastStone = { x: cx, y: cy };
  slab = null;
  const sh = stoneShape(s);
  return [sh.x0, sh.y0, sh.x1, sh.y1];
}

// the editor's brush preview: radius on screen, in cells
export const brushRadiusCells = () => ({ rx: (brush.size * TILE_PX) / CH_PX, ry: (brush.size * TILE_PX) / LN_PX });
