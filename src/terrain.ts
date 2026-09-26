// ---------------------------------------------------------------------------
// TERRAIN FIELD — the look of the ground and water, computed once.
//
// Everything visual about the island surface lives here: a smooth colour
// field (the "paint" underneath), plus one glyph + glyph colour per character
// cell (the "texture" on top). TerrainCanvas.tsx draws it: the colour field
// as one small canvas the browser stretches smoothly (so transitions stay soft
// at any zoom), the glyphs into canvas tiles.
//
// Style target (reference art): colour carries the transitions, glyphs only
// add low-contrast texture. Coast from inland out:
//   grass (soft light/dark patches) → darker grass → round dark bush clumps
//   (lit from the top-left, dropping a shadow) → warm sand → pale wet sand →
//   light teal shallows → blue → deep blue, with stones on the beach.
//
// VISUAL ONLY. Gameplay (collision, isWater, regions, spawns) keeps using
// world.ts's islandNd/nearestIsland untouched. The visual coast adds noise on
// top of that field (lumpy bays + bushes), so the beach can look irregular
// without moving where the player can walk.
// ---------------------------------------------------------------------------

import {
  GROUND_W,
  GROUND_H,
  TILE_CH,
  TILE_LN,
  MAP_W,
  MAP_H,
  nearestIsland,
  STRUCT_ENTS,
  bbox,
  collisionBox,
  OCEAN_CFG,
} from './world';

// ---- tiny math helpers ----------------------------------------------------

function fract(n: number): number {
  return n - Math.floor(n);
}
function hash2(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (a: number, b: number) => fract(Math.sin(a * 127.1 + b * 311.7 + seed * 13.7) * 43758.5453);
  // quintic fade (C2-smooth): the cubic one leaves faint straight creases
  // along the lattice lines once contrast is stretched, which read as seams
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const tl = h(xi, yi);
  const tr = h(xi + 1, yi);
  const bl = h(xi, yi + 1);
  const br = h(xi + 1, yi + 1);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}
// Each octave is rotated and offset, so no lattice axis lines up between them
// (axis-aligned value noise shows up as straight lines in big soft patches).
const R1C = Math.cos(0.61), R1S = Math.sin(0.61);
const R2C = Math.cos(1.37), R2S = Math.sin(1.37);
function fbm(x: number, y: number, seed: number): number {
  const a = vnoise(x * R1C - y * R1S + 3.7, x * R1S + y * R1C - 1.3, seed);
  const b = vnoise((x * R2C - y * R2S) * 2.03 + 11.1, (x * R2S + y * R2C) * 2.03 + 5.9, seed + 1);
  const c = vnoise(x * 4.1 - 7.3, y * 4.1 + 2.2, seed + 2);
  return a * 0.57 + b * 0.29 + c * 0.14;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---- palette (all tunables in one place) ----------------------------------
// Sampled from the reference close-up: dark olive ground, yellow-olive glyph
// texture on the foliage, cream sand, teal-to-blue water with pale dot glyphs.

export const TERRAIN_PALETTE = {
  grass: hex('#56643c'),
  grassLight: hex('#617043'),
  grassDark: hex('#4c5935'),
  rimGrass: hex('#46542f'), // ground darkening toward the bushes
  bushDark: hex('#2f3c24'),
  bushMid: hex('#44542f'),
  bushLight: hex('#5d6b39'),
  foliageGlyph: hex('#b2a24f'), // the yellow-olive x o * ¤ texture on bushes
  foliageGlyphDark: hex('#76803f'),
  sandInner: hex('#e2c28b'),
  sand: hex('#e8c994'),
  sandOuter: hex('#efd8a8'),
  wetSand: hex('#e9e0c0'),
  shallow1: hex('#a7d2cb'),
  shallow2: hex('#80bcc4'),
  water: hex('#5e9cb5'),
  deep: hex('#4886a4'),
  deepest: hex('#3b7494'),
  waterGlyph: hex('#dcefee'),
  stone: hex('#8e8f80'),
  stoneLight: hex('#b3b3a2'),
};
const P = TERRAIN_PALETTE;

// Colour stops along the VISUAL coast distance (ndv): <1 land, >1 sea. Each
// neighbouring pair blends across its full span; the per-cell dither in
// terrainField() then breaks every step into a mosaic instead of a line.
const STOPS: { nd: number; c: RGB }[] = [
  { nd: 0, c: P.grass },
  { nd: 0.93, c: P.grass },
  { nd: 0.99, c: P.rimGrass },
  { nd: 1.012, c: P.sandInner },
  { nd: 1.03, c: P.sand },
  { nd: 1.05, c: P.sandOuter },
  { nd: 1.064, c: P.wetSand },
  { nd: 1.08, c: P.shallow1 },
  { nd: 1.15, c: P.shallow2 },
  { nd: 1.3, c: P.water },
  { nd: 1.55, c: P.deep },
  { nd: 2.2, c: P.deepest },
];
export const WATERLINE_ND = 1.07; // where the visible water starts (foam rides here)
export const SAND_START_ND = 1.01;

// Tile units are near-square on screen (4 chars x 8.4px = 33.6px wide, 2 lines
// x 14px = 28px tall); multiplying y by this makes round things round.
const ISO_Y = (TILE_LN * 14) / (TILE_CH * 8.4);

// ---- visual coast distance --------------------------------------------------

// Gameplay nd + two scales of noise: broad bays/headlands and small bumps.
// Kept to roughly ±1 tile so the look never drifts far from where the player
// can actually walk.
export function visualNd(fx: number, fy: number): number {
  const nd = nearestIsland(fx, fy).nd;
  if (nd < 0.75 || nd > 1.6) return nd; // noise only matters near the coast
  const bays = fbm(fx * 0.11, fy * 0.11, 17) - 0.5;
  const bumps = vnoise(fx * 0.55, fy * 0.55, 29) - 0.5;
  return nd + bays * 0.07 + bumps * 0.022;
}

// ---- bush clumps (jittered grid of round, shaded blobs) --------------------

const BUSH_S = 1.05; // grid spacing, iso tile units
const BUSH_GW = Math.ceil(MAP_W / BUSH_S) + 2;
const BUSH_GH = Math.ceil((MAP_H * ISO_Y) / BUSH_S) + 2;
// Per grid cell: x, y (iso units), radius, tone jitter; radius 0 = no bush.
let BUSHES: Float32Array | null = null;

// Tiles covered by a structure (sprite box + collider + 1-tile margin): no
// bushes or ground glyphs are drawn under the house, bridge, cliff, etc.
let STRUCT_MASK: Uint8Array | null = null;
function structMask(): Uint8Array {
  if (STRUCT_MASK) return STRUCT_MASK;
  const m = new Uint8Array(MAP_W * MAP_H);
  for (const e of STRUCT_ENTS) {
    if (e.kind === 'hotspot' || e.kind === 'blocker') continue;
    for (const b of [bbox(e), collisionBox(e)]) {
      for (let ty = b.y0 - 1; ty <= b.y1 + 1; ty++) {
        for (let tx = b.x0 - 1; tx <= b.x1 + 1; tx++) {
          if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) m[ty * MAP_W + tx] = 1;
        }
      }
    }
  }
  return (STRUCT_MASK = m);
}
const masked = (fx: number, fy: number) => {
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  return tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && structMask()[ty * MAP_W + tx] === 1;
};

function bushes(): Float32Array {
  if (BUSHES) return BUSHES;
  const b = new Float32Array(BUSH_GW * BUSH_GH * 4);
  for (let j = 0; j < BUSH_GH; j++) {
    for (let i = 0; i < BUSH_GW; i++) {
      const k = (j * BUSH_GW + i) * 4;
      const px = (i + 0.15 + hash2(i, j) * 0.7) * BUSH_S;
      const py = (j + 0.15 + hash2(i + 71, j + 13) * 0.7) * BUSH_S;
      const fx = px;
      const fy = py / ISO_Y;
      const ndv = visualNd(fx, fy);
      const roll = hash2(i + 5, j + 91);
      // the rim: a near-continuous hedge right on the coast; a few strays inland
      const onRim = ndv > 0.95 && ndv < 1.012 && roll < 0.96;
      // a patchy second row behind the hedge, so its depth varies along the coast
      const back = ndv > 0.89 && ndv <= 0.95 && roll < 0.7 * smooth(0.4, 0.65, vnoise(fx * 0.18, fy * 0.18, 61));
      const stray = !back && ndv > 0.86 && ndv <= 0.95 && roll < 0.08;
      if ((onRim || back || stray) && !masked(fx, fy)) {
        b[k] = px;
        b[k + 1] = py;
        b[k + 2] = BUSH_S * (0.56 + 0.5 * hash2(i + 33, j + 7) ** 1.5) * (stray ? 0.85 : 1);
        b[k + 3] = hash2(i + 9, j + 57);
      }
    }
  }
  return (BUSHES = b);
}

// Highest bush covering (ix, iy) in iso units → writes into `hit`, returns
// height (0 = no bush). Overlapping bushes stack: the taller one wins.
const hit = { nx: 0, ny: 0, h: 0, tone: 0 };
function bushAt(ix: number, iy: number): number {
  const b = bushes();
  const gi = Math.floor(ix / BUSH_S);
  const gj = Math.floor(iy / BUSH_S);
  let best = 0;
  for (let dj = -1; dj <= 1; dj++) {
    const j = gj + dj;
    if (j < 0 || j >= BUSH_GH) continue;
    for (let di = -1; di <= 1; di++) {
      const i = gi + di;
      if (i < 0 || i >= BUSH_GW) continue;
      const k = (j * BUSH_GW + i) * 4;
      const r = b[k + 2];
      if (r === 0) continue;
      const dx = (ix - b[k]) / r;
      const dy = (iy - b[k + 1]) / r;
      const d2 = dx * dx + dy * dy;
      // wobbly rim, so clumps read as foliage rather than perfect discs
      const lump = 1 + (vnoise(ix * 2.4, iy * 2.4, 7) - 0.5) * 0.7;
      if (d2 >= lump) continue;
      const h = Math.sqrt((lump - d2) / lump) * (0.9 + 0.2 * b[k + 3]);
      if (h > best) {
        best = h;
        hit.nx = dx;
        hit.ny = dy;
        hit.h = h;
        hit.tone = b[k + 3];
      }
    }
  }
  return best;
}

// Light from the top-left, slightly in front.
const LX = -0.5;
const LY = -0.62;
const LZ = 0.6;

// ---- per-cell evaluation -----------------------------------------------------

export const KIND_GRASS = 0;
export const KIND_BUSH = 1;
export const KIND_SAND = 2;
export const KIND_WATER = 3;

const out = { r: 0, g: 0, b: 0, kind: 0, ndv: 0, lit: 0 };

// `jit` nudges the coast distance per cell (a few thousandths of an nd), so
// every colour boundary breaks into a ragged, dithered mosaic edge.
function sample(fx: number, fy: number, jit: number) {
  const ndv = visualNd(fx, fy);
  out.ndv = ndv;
  out.lit = 0;
  const n = ndv + jit;
  let i = 0;
  while (i < STOPS.length - 2 && n > STOPS[i + 1].nd) i++;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const t = smooth(a.nd, b.nd, n);
  out.r = a.c[0] + (b.c[0] - a.c[0]) * t;
  out.g = a.c[1] + (b.c[1] - a.c[1]) * t;
  out.b = a.c[2] + (b.c[2] - a.c[2]) * t;

  if (n < 0.99) {
    // broad light/dark ground patches, fading out toward the rim
    const p = fbm(fx * 0.075, fy * 0.075, 41);
    const w = (1 - smooth(0.9, 0.975, n)) * 0.85;
    const tt = smooth(0.3, 0.72, p);
    out.r += (P.grassDark[0] + (P.grassLight[0] - P.grassDark[0]) * tt - out.r) * w;
    out.g += (P.grassDark[1] + (P.grassLight[1] - P.grassDark[1]) * tt - out.g) * w;
    out.b += (P.grassDark[2] + (P.grassLight[2] - P.grassDark[2]) * tt - out.b) * w;
  } else if (n > 1.2) {
    // depth patches in open water
    const d = (fbm(fx * 0.05, fy * 0.05, 77) - 0.5) * 0.22;
    out.r *= 1 + d;
    out.g *= 1 + d;
    out.b *= 1 + d;
  }
  out.kind = n < SAND_START_ND ? KIND_GRASS : n < WATERLINE_ND ? KIND_SAND : KIND_WATER;

  // bush clumps: lumpy at cell scale, shaded as little domes
  if (ndv > 0.82 && ndv < 1.06) {
    const h = bushAt(fx, fy * ISO_Y);
    if (h > 0) {
      const lam = clamp01(hit.nx * LX + hit.ny * LY + h * LZ);
      const t1 = clamp01(lam * 1.3);
      const t2 = clamp01((lam - 0.7) * 3);
      const tone = 0.93 + 0.14 * hit.tone;
      out.r = (P.bushDark[0] + (P.bushMid[0] - P.bushDark[0]) * t1 + (P.bushLight[0] - P.bushMid[0]) * t2) * tone;
      out.g = (P.bushDark[1] + (P.bushMid[1] - P.bushDark[1]) * t1 + (P.bushLight[1] - P.bushMid[1]) * t2) * tone;
      out.b = (P.bushDark[2] + (P.bushMid[2] - P.bushDark[2]) * t1 + (P.bushLight[2] - P.bushMid[2]) * t2) * tone;
      out.kind = KIND_BUSH;
      out.lit = lam;
    } else if (bushAt(fx - 0.3, (fy - 0.45) * ISO_Y) > 0) {
      // cast shadow toward the bottom-right
      out.r *= 0.8;
      out.g *= 0.8;
      out.b *= 0.82;
    }
  }
}

// ---- glyph vocabulary ------------------------------------------------------

export const GLYPHS = [
  '', // 0 = no glyph
  '"', "'", ',', '`', 'v', '.', // 1-6 sparse grass
  'x', 'o', '*', '¤', '@', '%', '8', '&', '+', // 7-15 foliage
  ':', '∘', // 16-17 sand
  'O', '0', // 18-19 stones
  '·', '•', '~', // 20-22 water
];
const G_GRASS = [1, 2, 3, 4, 5, 6];
const G_FOLIAGE = [7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 8, 9];
const G_SAND = [7, 8, 17, 16, 20];
const G_STONE = [8, 18, 19, 11];
const G_WATER = [20, 20, 20, 17, 20];
const G_SHALLOW = [20, 17, 20, 20, 17];

// ---- the field ---------------------------------------------------------------

export interface TerrainField {
  /** Background colour, RGBA, one pixel per character cell (drawn as blocks). */
  bg: Uint8ClampedArray;
  bgW: number;
  bgH: number;
  /** Per character cell (GROUND_W x GROUND_H): */
  ndv: Float32Array;
  kind: Uint8Array;
  glyph: Uint8Array;
  color: Uint32Array; // 0xRRGGBB
}

const pack = (r: number, g: number, b: number) =>
  (Math.max(0, Math.min(255, Math.round(r))) << 16) |
  (Math.max(0, Math.min(255, Math.round(g))) << 8) |
  Math.max(0, Math.min(255, Math.round(b)));

let FIELD: TerrainField | null = null;

export function terrainField(): TerrainField {
  if (FIELD) return FIELD;
  const n = GROUND_W * GROUND_H;
  const bg = new Uint8ClampedArray(n * 4);
  const ndv = new Float32Array(n);
  const kind = new Uint8Array(n);
  const glyph = new Uint8Array(n);
  const color = new Uint32Array(n);
  for (let y = 0; y < GROUND_H; y++) {
    const fy = (y + 0.5) / TILE_LN;
    for (let x = 0; x < GROUND_W; x++) {
      const fx = (x + 0.5) / TILE_CH;
      const idx = y * GROUND_W + x;
      const h = hash2(x * 0.731, y * 1.37);
      const h2 = hash2(x * 1.913 + 7, y * 0.577 + 3);
      const h3 = hash2(x * 0.377 + 19, y * 2.11 + 41);
      sample(fx, fy, (h3 - 0.5) * 0.012);
      ndv[idx] = out.ndv;
      kind[idx] = out.kind;

      // mosaic: each cell its own block, slightly varied like a painted tile
      const v = (h3 - 0.5) * 10;
      const k4 = idx * 4;
      bg[k4] = out.r + v;
      bg[k4 + 1] = out.g + v;
      bg[k4 + 2] = out.b + v * 0.8;
      bg[k4 + 3] = 255;

      // glyph + its colour, mixed from the cell colour toward a texture tone
      let g = 0;
      let tr = 0, tg = 0, tb = 0, m = 0; // texture tone and mix amount
      const land = out.kind !== KIND_WATER;
      if (land && masked(fx, fy)) {
        g = 0;
      } else if (out.kind === KIND_BUSH) {
        if (h < 0.93) {
          g = G_FOLIAGE[Math.floor(h2 * G_FOLIAGE.length)];
          const lit = clamp01(out.lit * 1.2);
          tr = P.foliageGlyphDark[0] + (P.foliageGlyph[0] - P.foliageGlyphDark[0]) * lit;
          tg = P.foliageGlyphDark[1] + (P.foliageGlyph[1] - P.foliageGlyphDark[1]) * lit;
          tb = P.foliageGlyphDark[2] + (P.foliageGlyph[2] - P.foliageGlyphDark[2]) * lit;
          m = 0.55 + 0.35 * lit;
        }
      } else if (out.kind === KIND_GRASS) {
        // dense yellow-olive texture near the coast, calm in the interior
        const rim = smooth(0.84, 0.98, out.ndv);
        const cluster = vnoise(fx * 0.32, fy * 0.32, 91);
        const p = 0.03 + 0.12 * smooth(0.6, 0.88, cluster) + 0.62 * rim;
        if (h < p) {
          if (rim > 0.25) {
            g = G_FOLIAGE[Math.floor(h2 * G_FOLIAGE.length)];
            tr = P.foliageGlyphDark[0];
            tg = P.foliageGlyphDark[1];
            tb = P.foliageGlyphDark[2];
            m = 0.4 + 0.35 * rim * h2;
          } else {
            g = G_GRASS[Math.floor(h2 * G_GRASS.length)];
            tr = P.grassLight[0] * 1.2;
            tg = P.grassLight[1] * 1.2;
            tb = P.grassLight[2] * 1.15;
            m = 0.5;
          }
        }
      } else if (out.kind === KIND_SAND) {
        const stones = vnoise(fx * 0.8, fy * 0.8, 313);
        if (stones > 0.9 && out.ndv < 1.045 && h < 0.4) {
          g = G_STONE[Math.floor(h2 * G_STONE.length)];
          const st = h2 > 0.5 ? P.stoneLight : P.stone;
          tr = st[0];
          tg = st[1];
          tb = st[2];
          m = 1;
        } else if (h < 0.7) {
          g = G_SAND[Math.floor(h2 * G_SAND.length)];
          tr = 255;
          tg = 246;
          tb = 222;
          m = 0.45;
        }
      } else {
        // the water's regular grid of small pale dots, brighter in the shallows
        const shallow = out.ndv < 1.25;
        // (x/y parity keeps it a regular grid, like woven dots)
        if (h < 0.82 && ((x + y) & 1) === 0) {
          g = (shallow ? G_SHALLOW : G_WATER)[Math.floor(h2 * 5)];
          const bright = vnoise(fx * 0.18, fy * 0.18, 5);
          tr = P.waterGlyph[0];
          tg = P.waterGlyph[1];
          tb = P.waterGlyph[2];
          m = (shallow ? 0.34 : 0.2) + 0.2 * smooth(0.5, 0.8, bright);
        }
      }
      glyph[idx] = g;
      color[idx] = g
        ? pack(out.r + (tr - out.r) * m, out.g + (tg - out.g) * m, out.b + (tb - out.b) * m)
        : 0;
    }
  }
  FIELD = { bg, bgW: GROUND_W, bgH: GROUND_H, ndv, kind, glyph, color };
  return FIELD;
}

// ---- animated water: caustics + shore foam ----------------------------------

// no ' or ` — stacked on consecutive lines they read as vertical bars
// small round marks only: ○/◇ fall back to odd shapes in some fonts, and
// ~ on consecutive cells joins into horizontal stripes
export const CAUSTIC_GLYPHS = [['·'], ['·', '∘'], ['∘', '·'], ['o', '∘']];
export const CAUSTIC_ALPHA = [0.16, 0.26, 0.4, 0.7];

// Same drifting two-field noise as the previous DOM ocean (world.ts
// OCEAN_CFG), restricted to cells inside [x0,x1)×[y0,y1).
export function forEachCaustic(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cb: (x: number, y: number, tier: number, glyph: string) => void,
) {
  const f = terrainField();
  const { cellX, cellY, driftX, driftY, threshold, band, cuts } = OCEAN_CFG;
  const dx = t * driftX;
  const dy = t * driftY;
  for (let y = Math.max(0, y0); y < Math.min(GROUND_H, y1); y++) {
    const ny = y * cellY;
    for (let x = Math.max(0, x0); x < Math.min(GROUND_W, x1); x++) {
      const ndv = f.ndv[y * GROUND_W + x];
      if (ndv < 1.12) continue; // keep the shallows calm, foam lives there
      const nx = x * cellX;
      const v = vnoise(nx + dx, ny + dy, 11) * 0.65 + vnoise(nx * 1.7 + dx * 1.445, ny * 1.7 + dy * 1.445, 23) * 0.55;
      const field = vnoise(nx * 0.22 + dx * 0.15, ny * 0.22 + dy * 0.15, 501);
      const th = threshold + 0.35 + (field - 0.5) * 0.08; // sparser than before: texture, not a carpet
      if (v <= th) continue;
      const u = (v - th) / band;
      let tier = cuts.length;
      for (let k = 0; k < cuts.length; k++) {
        if (u < cuts[k]) {
          tier = k;
          break;
        }
      }
      if (tier === cuts.length && vnoise(nx * 0.09 + dx * 0.3, ny * 0.09 + dy * 0.3, 777) < 0.76) tier--;
      // fade in across the shallows so the light doesn't start on a line
      if (ndv < 1.2 && hash2(x, y) > (ndv - 1.12) / 0.08) continue;
      const set = CAUSTIC_GLYPHS[tier];
      cb(x, y, tier, set[Math.floor(vnoise(nx * 4 + dx, ny * 4 + dy, 31) * set.length) % set.length]);
    }
  }
}

// The coastal ring the foam can ever touch, precomputed so a frame only walks
// these cells instead of the whole map.
let RING: Int32Array | null = null;
function ring(): Int32Array {
  if (RING) return RING;
  const f = terrainField();
  const idx: number[] = [];
  for (let i = 0; i < f.ndv.length; i++) if (f.ndv[i] > 1.03 && f.ndv[i] < 1.14) idx.push(i);
  return (RING = Int32Array.from(idx));
}

export const SHORE_PHASES = 36;
const PUSH = 0.022; // how far up the sand a wave climbs (nd)
const PULL = 0.016; // how far it recedes
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeIn = (u: number) => u * u;
function reachAt(p: number): number {
  if (p < 0.22) return easeOut(p / 0.22);
  if (p < 0.32) return 1;
  return 1 - easeIn((p - 0.32) / 0.68);
}

// Foam for loop position `phase` (0..SHORE_PHASES-1): a bright crest on the
// moving waterline, a fading wash behind it, and a darker wet sheen left on
// the sand while the wave pulls back. `alpha` is the glyph opacity; `wet` > 0
// asks for a darkening wash instead of a glyph.
export function forEachFoam(
  phase: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cb: (x: number, y: number, glyph: string, alpha: number, wet: number) => void,
) {
  const f = terrainField();
  const r = ring();
  const p = phase / SHORE_PHASES;
  const reach = reachAt(p);
  const receding = p >= 0.32;
  const wl = WATERLINE_ND + PULL - reach * (PUSH + PULL);
  for (let n = 0; n < r.length; n++) {
    const i = r[n];
    const y = (i / GROUND_W) | 0;
    if (y < y0 || y >= y1) continue;
    const x = i - y * GROUND_W;
    if (x < x0 || x >= x1) continue;
    const fx = x / TILE_CH;
    const fy = y / TILE_LN;
    const finger = (vnoise(fx * 0.3 + p * 1.2, fy * 0.3, 55) - 0.5) * 0.014;
    const d = f.ndv[i] - (wl + finger) + (hash2(x, y) - 0.5) * 0.004;
    if (d >= 0) {
      if (d < 0.007) {
        // the crest: a soft line of small bubbles, not bold letters
        const h = hash2(x * 1.3, y * 2.6);
        if (h > 0.3) cb(x, y, h > 0.78 ? 'o' : h > 0.5 ? '∘' : '·', 0.5, 0);
      } else if (d < 0.032) {
        const u = (d - 0.007) / 0.025;
        const h = hash2(x * 0.9, y * 1.8 + 3);
        if (h > 0.25 + u * 0.7) cb(x, y, h > 0.75 ? '∘' : '·', 0.45 * (1 - u) + 0.08, 0);
      }
    } else if (receding && f.ndv[i] >= WATERLINE_ND - PUSH) {
      // sand the wave covered at its peak and is now leaving
      cb(x, y, '', 0, 0.1 * (1 - (p - 0.32) / 0.68));
    }
  }
}
