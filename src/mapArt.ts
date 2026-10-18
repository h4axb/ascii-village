// ---------------------------------------------------------------------------
// The "M" map as an illustrated island map: a cream parchment frame, a
// turquoise sea with little wave strokes and foam around the coasts, soft
// green islands with dark outlines and sandy beaches, trees, rocks, little
// buildings and a compass rose. Everything is drawn from the real world: the
// terrain cells (terrain.ts terrainField) give the land, beaches, paths and
// rocks; the entities give the house, the shop, the garden, the pond, palms,
// bushes and boulders, each where it really is.
//
// The terrain is a grid of character cells, so its edges are steps: each
// layer is drawn as a smooth mask (the cells scaled up, blurred, then cut at
// a threshold), which rounds them like a hand-drawn coast. A lower threshold
// grows the shape, which gives the outline and the foam ring for free.
//
// GameMap.tsx draws the player and Mitchy on top (HTML, with bobbing arrows)
// through `mapPoint`.
// ---------------------------------------------------------------------------
import { GROUND_W, GROUND_H, TILE_CH, TILE_LN } from './world';
import type { Ent } from './world';
import { terrainField, KIND_WATER, KIND_ROCK, KIND_SAND, KIND_BUSH, KIND_DIRT, KIND_MEADOW, KIND_STONEGROUND, KIND_SLAB } from './terrain';
import { WORLD_ASPECT } from './font';

const C = {
  paper: '#f6ecd6',
  paperEdge: '#e7d6b2',
  ornament: '#d9c39a',
  sea: '#3fbccb',
  seaDeep: '#36aebf',
  shallow: '#6fd3dc',
  foam: '#e9fbf9',
  wave: 'rgba(233, 251, 249, 0.75)',
  ink: '#2f3a2b',
  sand: '#f1d9a0',
  sandEdge: '#d9bb7a',
  grass: '#9fd36a',
  grassDark: '#7cb951',
  meadow: '#b6e07d',
  path: '#ead19c',
  pathEdge: '#c9a86a',
  rock: '#9aa3a8',
  rockLight: '#c4cbcf',
  rockDark: '#6f787d',
  tree: '#7fc04f',
  treeLight: '#a6d96c',
  treeDark: '#4f8f3a',
  trunk: '#8a5a33',
  roofBlue: '#3f86c4',
  roofRed: '#d0574a',
  wall: '#f3e6cc',
  wood: '#a8713f',
  soil: '#9b6a3e',
  pond: '#59c9d6',
  gold: '#f2b53c',
};

// The part of the world the map shows: the land with some sea around it
export interface MapView {
  x0: number; // first cell column shown
  y0: number;
  cols: number;
  rows: number;
  // the drawing: cell -> canvas px
  ox: number;
  oy: number;
  sx: number; // px per cell column
  sy: number; // px per cell row
  w: number;
  h: number;
}

const FRAME = 0.045; // parchment border, of the shorter side

// the land's bounding box in cells, with a margin of sea
function landBox() {
  const f = terrainField();
  let x0 = GROUND_W, y0 = GROUND_H, x1 = 0, y1 = 0;
  for (let y = 0; y < GROUND_H; y++)
    for (let x = 0; x < GROUND_W; x++) {
      const k = f.kind[y * GROUND_W + x];
      if (k === KIND_WATER || k === KIND_ROCK) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < x0) return { x0: 0, y0: 0, x1: GROUND_W - 1, y1: GROUND_H - 1 };
  const mx = Math.round((x1 - x0) * 0.05), my = Math.round((y1 - y0) * 0.05);
  return { x0: Math.max(0, x0 - mx), y0: Math.max(0, y0 - my), x1: Math.min(GROUND_W - 1, x1 + mx), y1: Math.min(GROUND_H - 1, y1 + my) };
}

// fit the land (cells are WORLD_ASPECT times taller than wide) into w x h
export function mapView(w: number, h: number): MapView {
  const b = landBox();
  const cols = b.x1 - b.x0 + 1, rows = b.y1 - b.y0 + 1;
  const frame = Math.round(Math.min(w, h) * FRAME);
  const iw = w - 2 * frame, ih = h - 2 * frame;
  const s = Math.min(iw / cols, ih / (rows * WORLD_ASPECT));
  const dw = cols * s, dh = rows * s * WORLD_ASPECT;
  return { x0: b.x0, y0: b.y0, cols, rows, ox: frame + (iw - dw) / 2, oy: frame + (ih - dh) / 2, sx: s, sy: s * WORLD_ASPECT, w, h };
}

// a point in tile units (entities, characters) on the canvas
export const mapPoint = (v: MapView, tx: number, ty: number) => ({
  x: v.ox + (tx * TILE_CH - v.x0) * v.sx,
  y: v.oy + (ty * TILE_LN - v.y0) * v.sy,
});

// a deterministic random, so the map looks the same every time it opens
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function paintMapArt(canvas: HTMLCanvasElement, w: number, h: number, ents: Ent[]): MapView {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const v = mapView(w, h);
  const f = terrainField();
  const kindAt = (x: number, y: number) => f.kind[y * GROUND_W + x];

  // ---- the paper and the sea ----
  const frame = Math.round(Math.min(w, h) * FRAME);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, w, h);
  const sea = { x: frame, y: frame, w: w - 2 * frame, h: h - 2 * frame };
  const g = ctx.createLinearGradient(0, sea.y, 0, sea.y + sea.h);
  g.addColorStop(0, C.sea);
  g.addColorStop(1, C.seaDeep);
  ctx.save();
  roundRect(ctx, sea.x, sea.y, sea.w, sea.h, frame * 0.6);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();

  // ---- smooth masks of the terrain ----
  // one pixel per cell, drawn over the shown area at canvas size, blurred
  const mask = (pred: (k: number) => boolean, blur: number) => {
    const small = document.createElement('canvas');
    small.width = v.cols;
    small.height = v.rows;
    const sctx = small.getContext('2d')!;
    const img = sctx.createImageData(v.cols, v.rows);
    for (let y = 0; y < v.rows; y++)
      for (let x = 0; x < v.cols; x++) if (pred(kindAt(v.x0 + x, v.y0 + y))) img.data[(y * v.cols + x) * 4 + 3] = 255;
    sctx.putImageData(img, 0, 0);
    const big = document.createElement('canvas');
    big.width = w;
    big.height = h;
    const bctx = big.getContext('2d')!;
    bctx.filter = `blur(${blur}px)`;
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(small, v.ox, v.oy, v.cols * v.sx, v.rows * v.sy);
    const a = bctx.getImageData(0, 0, w, h).data;
    small.width = small.height = big.width = big.height = 0;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = a[i * 4 + 3];
    return out;
  };
  // fill where the mask is at least `thr` (0-255), optionally shifted
  const fillMask = (m: Uint8Array, thr: number, color: string, alpha = 1, dx = 0, dy = 0) => {
    const [r, gg, b] = hexRgb(color);
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x - dx, sy = y - dy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        if (m[sy * w + sx] < thr) continue;
        const i = (y * w + x) * 4;
        d[i] = r;
        d[i + 1] = gg;
        d[i + 2] = b;
        d[i + 3] = Math.round(alpha * 255);
      }
    const layer = document.createElement('canvas');
    layer.width = w;
    layer.height = h;
    layer.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(layer, 0, 0);
    layer.width = layer.height = 0;
  };

  const blur = Math.max(2, v.sx * 1.6);
  const isLand = (k: number) => k !== KIND_WATER && k !== KIND_ROCK;
  const land = mask(isLand, blur);
  const landWide = mask(isLand, blur * 4);
  const green = mask((k) => isLand(k) && k !== KIND_SAND, blur);
  const paths = mask((k) => k === KIND_DIRT || k === KIND_STONEGROUND || k === KIND_SLAB, blur * 0.6);
  const meadow = mask((k) => k === KIND_MEADOW, blur * 1.4);
  const rocks = mask((k) => k === KIND_ROCK, blur * 0.7);
  const woods = mask((k) => k === KIND_BUSH, blur * 1.2);

  // shallows, foam, a soft shadow, the ink outline, then the ground
  fillMask(landWide, 26, C.shallow, 0.55);
  fillMask(land, 18, C.foam, 0.9);
  fillMask(land, 110, C.seaDeep, 0.45, 0, Math.max(2, Math.round(v.sy * 0.9)));
  fillMask(land, 78, C.ink);
  fillMask(land, 128, C.sand);
  fillMask(green, 110, C.sandEdge);
  fillMask(green, 128, C.grass);
  fillMask(meadow, 140, C.meadow);
  fillMask(paths, 100, C.pathEdge);
  fillMask(paths, 132, C.path);
  fillMask(rocks, 70, C.foam, 0.8);
  fillMask(rocks, 100, C.ink);
  fillMask(rocks, 128, C.rock);
  // the woods: one canopy with an ink edge (round tree tops go on it below)
  fillMask(woods, 70, C.ink);
  fillMask(woods, 96, C.treeDark);

  // little wave strokes on the open sea
  const rand = rng(7);
  ctx.strokeStyle = C.wave;
  ctx.lineWidth = Math.max(1.2, w / 700);
  ctx.lineCap = 'round';
  const waveW = Math.max(8, w / 70);
  for (let n = 0; n < 160; n++) {
    const x = sea.x + rand() * sea.w, y = sea.y + rand() * sea.h;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h || landWide[yi * w + xi] > 8) continue;
    ctx.beginPath();
    ctx.moveTo(x - waveW / 2, y);
    ctx.quadraticCurveTo(x - waveW / 4, y - waveW / 3, x, y);
    ctx.quadraticCurveTo(x + waveW / 4, y - waveW / 3, x + waveW / 2, y);
    ctx.stroke();
  }

  // ---- trees on the bush cells (the jungle), a few per clump ----
  const unit = v.sx * TILE_CH; // one tile's width in px
  const treeR = Math.max(5, unit * 1.25);
  const trees: { x: number; y: number; r: number }[] = [];
  const step = Math.max(2, Math.round((treeR * 1.5) / v.sx));
  const tr = rng(11);
  for (let y = v.y0; y < v.y0 + v.rows; y += Math.max(1, Math.round(step / WORLD_ASPECT)))
    for (let x = v.x0; x < v.x0 + v.cols; x += step) {
      if (kindAt(x, y) !== KIND_BUSH) continue;
      const mi = Math.round(v.oy + (y - v.y0 + 0.5) * v.sy) * w + Math.round(v.ox + (x - v.x0 + 0.5) * v.sx);
      if ((woods[mi] ?? 0) < 120) continue; // only well inside the canopy
      const px = v.ox + (x - v.x0 + 0.5) * v.sx + (tr() - 0.5) * treeR;
      const py = v.oy + (y - v.y0 + 0.5) * v.sy + (tr() - 0.5) * treeR * 0.6;
      trees.push({ x: px, y: py, r: treeR * (0.8 + tr() * 0.4) });
    }

  // ---- the entities, back to front ----
  type Item = { y: number; draw: () => void };
  const items: Item[] = trees.map((t) => ({ y: t.y, draw: () => roundTree(ctx, t.x, t.y, t.r) }));
  for (const e of ents) {
    const cols = Math.max(0, ...e.sprite.map((l) => l.length));
    const k = e.scale ?? 1;
    const p = mapPoint(v, e.x, e.y);
    const bw = cols * k * v.sx, bh = e.sprite.length * k * v.sy;
    const cx = p.x + bw / 2, cy = p.y + bh / 2, bottom = p.y + bh;
    if (cx < -bw || cy < -bh || cx > w + bw || cy > h + bh) continue;
    const at = (d: () => void, y = bottom) => items.push({ y, draw: d });
    switch (e.kind) {
      case 'house': at(() => building(ctx, cx, bottom, bw * 0.7, bh * 0.75, C.roofBlue)); break;
      case 'shop': at(() => building(ctx, cx, bottom, bw * 0.75, bh * 0.75, C.roofRed, true)); break;
      case 'gardenbed': at(() => garden(ctx, p.x, p.y, bw, bh), p.y); break;
      case 'pond': at(() => pond(ctx, cx, cy, bw * 0.48, bh * 0.42), p.y); break;
      case 'bridge': at(() => bridge(ctx, p.x, p.y, bw, bh), p.y + bh * 0.5); break;
      case 'palm': at(() => palm(ctx, cx, bottom, Math.max(treeR * 1.6, bh * 0.9))); break;
      case 'decor': at(() => roundTree(ctx, cx, bottom - bh * 0.35, Math.max(treeR, Math.min(bw, bh) * 0.45))); break;
      case 'boulder': case 'cliff': at(() => rocksIn(ctx, p.x, p.y, bw, bh, unit)); break;
      case 'bench': at(() => bench(ctx, cx, bottom, Math.max(unit, bw * 0.8))); break;
      case 'fence': case 'gate': at(() => fence(ctx, p.x, p.y, bw, bh)); break;
      case 'flower': case 'flowerplus': case 'iceflower': at(() => flower(ctx, cx, cy, Math.max(1.6, unit * 0.22), e.id)); break;
      case 'grasshalm': case 'fern': case 'cactus': at(() => tuft(ctx, cx, bottom, Math.max(3, unit * 0.45))); break;
      case 'stone': at(() => pebble(ctx, cx, cy, Math.max(2, unit * 0.3))); break;
      default: break; // hotspots, blockers, Mitchy (drawn by GameMap), items
    }
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
  ctx.restore();

  // ---- the frame: an ink line, corner flourishes, the compass ----
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = Math.max(1.5, w / 600);
  roundRect(ctx, sea.x, sea.y, sea.w, sea.h, frame * 0.6);
  ctx.stroke();
  ctx.strokeStyle = C.paperEdge;
  ctx.lineWidth = frame * 0.18;
  roundRect(ctx, frame * 0.25, frame * 0.25, w - frame * 0.5, h - frame * 0.5, frame * 0.5);
  ctx.stroke();
  for (const [x, y, sx, sy] of [[frame * 0.55, frame * 0.55, 1, 1], [w - frame * 0.55, frame * 0.55, -1, 1], [frame * 0.55, h - frame * 0.55, 1, -1], [w - frame * 0.55, h - frame * 0.55, -1, -1]] as const)
    flourish(ctx, x, y, sx, sy, frame * 1.6);
  compass(ctx, sea.x + sea.w - frame * 2.2, sea.y + sea.h - frame * 2.4, frame * 1.5);
  return v;
}

// ---------------------------------------------------------------- the pieces
function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number) {
  ctx.fillStyle = 'rgba(47, 58, 43, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
}

function outline(ctx: CanvasRenderingContext2D, r: number) {
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function roundTree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  shadow(ctx, x + r * 0.2, y + r * 0.85, r * 0.8);
  ctx.fillStyle = C.trunk;
  ctx.fillRect(x - r * 0.12, y + r * 0.3, r * 0.24, r * 0.55);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = C.tree;
  ctx.fill();
  outline(ctx, r);
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = C.treeLight;
  ctx.fill();
}

function palm(ctx: CanvasRenderingContext2D, x: number, base: number, hgt: number) {
  shadow(ctx, x + hgt * 0.1, base, hgt * 0.3);
  const top = base - hgt;
  ctx.strokeStyle = C.trunk;
  ctx.lineWidth = Math.max(1.5, hgt * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.quadraticCurveTo(x + hgt * 0.15, base - hgt * 0.5, x + hgt * 0.05, top);
  ctx.stroke();
  const fx = x + hgt * 0.05;
  for (const a of [-2.6, -2.0, -1.2, -0.4, 0.3]) {
    ctx.beginPath();
    ctx.ellipse(fx + Math.cos(a) * hgt * 0.22, top + Math.sin(a) * hgt * 0.12, hgt * 0.26, hgt * 0.09, a, 0, Math.PI * 2);
    ctx.fillStyle = C.tree;
    ctx.fill();
    outline(ctx, hgt * 0.3);
  }
}

function building(ctx: CanvasRenderingContext2D, x: number, base: number, bw: number, bh: number, roof: string, awning = false) {
  shadow(ctx, x + bw * 0.08, base, bw * 0.6);
  const wallH = bh * 0.5, wallW = bw * 0.82;
  ctx.beginPath();
  ctx.rect(x - wallW / 2, base - wallH, wallW, wallH);
  ctx.fillStyle = C.wall;
  ctx.fill();
  outline(ctx, bw * 0.12);
  // door and windows
  ctx.fillStyle = C.wood;
  ctx.fillRect(x - bw * 0.07, base - wallH * 0.55, bw * 0.14, wallH * 0.55);
  ctx.fillStyle = '#7fc6e0';
  for (const s of [-1, 1]) ctx.fillRect(x + s * wallW * 0.28 - bw * 0.06, base - wallH * 0.7, bw * 0.12, wallH * 0.28);
  // roof
  ctx.beginPath();
  ctx.moveTo(x - bw / 2, base - wallH);
  ctx.lineTo(x - bw * 0.36, base - bh);
  ctx.lineTo(x + bw * 0.36, base - bh);
  ctx.lineTo(x + bw / 2, base - wallH);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  outline(ctx, bw * 0.12);
  if (awning) {
    const aw = wallW * 0.9, ay = base - wallH * 0.95;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#fff4e0' : roof;
      ctx.fillRect(x - aw / 2 + (i * aw) / 6, ay, aw / 6, wallH * 0.18);
    }
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = Math.max(1, bw * 0.02);
    ctx.strokeRect(x - aw / 2, ay, aw, wallH * 0.18);
  }
}

function garden(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  roundRect(ctx, x + w * 0.05, y + h * 0.1, w * 0.9, h * 0.8, Math.min(w, h) * 0.08);
  ctx.fillStyle = C.soil;
  ctx.fill();
  outline(ctx, Math.min(w, h) * 0.12);
  const rows = 3, cols = Math.max(3, Math.round(w / h * 3));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const px = x + w * (0.15 + (0.7 * (c + 0.5)) / cols), py = y + h * (0.22 + (0.56 * (r + 0.5)) / rows);
      ctx.fillStyle = '#6fb84a';
      ctx.beginPath();
      ctx.ellipse(px - 1.5, py, Math.max(1.4, w * 0.018), Math.max(1, h * 0.04), -0.6, 0, Math.PI * 2);
      ctx.ellipse(px + 1.5, py, Math.max(1.4, w * 0.018), Math.max(1, h * 0.04), 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
}

function pond(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = C.pond;
  ctx.fill();
  outline(ctx, Math.min(rx, ry) * 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1, rx * 0.06);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.2, y - ry * 0.2, rx * 0.4, ry * 0.25, 0, Math.PI * 1.1, Math.PI * 1.7);
  ctx.stroke();
}

function bridge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const horiz = w >= h;
  ctx.fillStyle = C.wood;
  ctx.beginPath();
  ctx.rect(x, y + (horiz ? h * 0.2 : 0), w, horiz ? h * 0.6 : h);
  ctx.fill();
  outline(ctx, Math.min(w, h) * 0.15);
  ctx.strokeStyle = 'rgba(47,58,43,0.45)';
  ctx.lineWidth = 1;
  const n = Math.max(3, Math.round((horiz ? w : h) / Math.max(3, Math.min(w, h) * 0.35)));
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    if (horiz) {
      ctx.moveTo(x + (i * w) / n, y + h * 0.2);
      ctx.lineTo(x + (i * w) / n, y + h * 0.8);
    } else {
      ctx.moveTo(x, y + (i * h) / n);
      ctx.lineTo(x + w, y + (i * h) / n);
    }
    ctx.stroke();
  }
}

function rocksIn(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, unit: number) {
  const n = Math.max(1, Math.min(6, Math.round((w * h) / (unit * unit * 3))));
  const r = rng(Math.round(x * 13 + y * 7));
  for (let i = 0; i < n; i++) {
    const rr = Math.max(3, Math.min(w, h) * (n === 1 ? 0.42 : 0.3) * (0.8 + r() * 0.4));
    const px = x + rr + r() * Math.max(0, w - 2 * rr), py = y + h - rr * 0.8 - r() * Math.max(0, h - 2 * rr) * 0.6;
    rock(ctx, px, py, rr);
  }
}

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.5);
  ctx.quadraticCurveTo(x - r * 1.05, y - r * 0.4, x - r * 0.3, y - r * 0.8);
  ctx.quadraticCurveTo(x + r * 0.5, y - r * 1.05, x + r * 0.95, y - r * 0.1);
  ctx.quadraticCurveTo(x + r * 1.1, y + r * 0.5, x + r * 0.6, y + r * 0.6);
  ctx.closePath();
  ctx.fillStyle = C.rock;
  ctx.fill();
  outline(ctx, r);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.25, y - r * 0.35, r * 0.35, r * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = C.rockLight;
  ctx.fill();
}

function pebble(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = C.rock;
  ctx.fill();
  outline(ctx, r * 0.6);
}

function bench(ctx: CanvasRenderingContext2D, x: number, base: number, w: number) {
  ctx.fillStyle = C.wood;
  ctx.beginPath();
  ctx.rect(x - w / 2, base - w * 0.35, w, w * 0.18);
  ctx.fill();
  outline(ctx, w * 0.3);
  ctx.fillRect(x - w * 0.4, base - w * 0.2, w * 0.08, w * 0.2);
  ctx.fillRect(x + w * 0.32, base - w * 0.2, w * 0.08, w * 0.2);
}

function fence(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const horiz = w >= h;
  ctx.strokeStyle = C.wood;
  ctx.lineWidth = Math.max(1.2, Math.min(w, h) * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (horiz) {
    ctx.moveTo(x, y + h * 0.75);
    ctx.lineTo(x + w, y + h * 0.75);
  } else {
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
  }
  ctx.stroke();
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, id: string) {
  const cols = ['#f3a1c4', '#f7d36b', '#ffffff', '#c7a3f0'];
  let hsh = 0;
  for (const ch of id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  ctx.fillStyle = cols[hsh % cols.length];
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function tuft(ctx: CanvasRenderingContext2D, x: number, base: number, s: number) {
  ctx.strokeStyle = C.grassDark;
  ctx.lineWidth = Math.max(1, s * 0.18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const dx of [-0.35, 0, 0.35]) {
    ctx.moveTo(x + dx * s, base);
    ctx.lineTo(x + dx * s * 1.4, base - s * (dx === 0 ? 1 : 0.75));
  }
  ctx.stroke();
}

// a scroll in a corner of the paper, pointing inwards (sx, sy: direction)
function flourish(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.strokeStyle = C.ornament;
  ctx.lineWidth = Math.max(1.2, s * 0.07);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, s * 0.7);
  ctx.quadraticCurveTo(0, 0, s * 0.7, 0);
  ctx.moveTo(s * 0.18, s * 0.45);
  ctx.bezierCurveTo(s * 0.18, s * 0.18, s * 0.45, s * 0.18, s * 0.45, s * 0.36);
  ctx.bezierCurveTo(s * 0.45, s * 0.5, s * 0.3, s * 0.5, s * 0.3, s * 0.4);
  ctx.stroke();
  ctx.restore();
}

function compass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const star = (len: number, wid: number, fill: string) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const l = i % 2 ? wid : len;
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  star(r, r * 0.28, C.gold);
  ctx.fillStyle = '#fbe3a3';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.28 * Math.SQRT1_2, y - r * 0.28 * Math.SQRT1_2);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.font = `bold ${Math.round(r * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', x + r * 0.42, y - r * 0.55);
}
