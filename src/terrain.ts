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
  silhouetteMask,
  OCEAN_CFG,
} from './world';
import { RAMP_DEFAULT } from './craft/materials';

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
  bushMid: hex('#55663a'),
  bushLight: hex('#5d6b39'),
  foliageGlyph: hex('#c4b058'), // the yellow-olive x o * ¤ texture on bushes
  foliageGlyphDark: hex('#8a8f44'),
  fringeGlyph: hex('#dcc26c'), // yellow toward the sand edge of the rim
  sandGlyph: hex('#c49a52'), // warm grain on the sand
  sand: hex('#eac48c'),
  sandOuter: hex('#efd8a8'),
  wetSand: hex('#e9e0c0'),
  shallow1: hex('#a7d2cb'),
  shallow2: hex('#80bcc4'),
  water: hex('#5e9cb5'),
  deep: hex('#4886a4'),
  deepest: hex('#3b7494'),
  waterGlyph: hex('#dcefee'),
  rock: hex('#8d9896'),
  rockDark: hex('#6d7c7e'),
  rockGlyph: hex('#dfe4dc'),
  grassGlyph: hex('#a6ba68'), // light-green grass texture
  stone: hex('#8e8f80'),
  stoneLight: hex('#b3b3a2'),
};
const P = TERRAIN_PALETTE;

// Colour stops along the VISUAL coast distance (ndv): <1 land, >1 sea. Each
// neighbouring pair blends across its full span; the per-cell dither in
// terrainField() then breaks every step into a mosaic instead of a line.
// Two separate ramps. Land NEVER blends into sand: halfway between dark
// green and cream, an RGB mix is a muddy khaki-brown. At the shoreline each
// cell is either land-coloured or sand-coloured (see SAND_START_ND and the
// ragged per-cell edge in sample()) — the mosaic edge IS the transition.
const LAND_STOPS: { nd: number; c: RGB }[] = [
  { nd: 0, c: P.grass },
  { nd: 0.93, c: P.grass },
  { nd: 0.99, c: P.rimGrass },
  { nd: 2, c: P.rimGrass },
];
const SEA_STOPS: { nd: number; c: RGB }[] = [
  { nd: 0, c: P.sand },
  { nd: 1.04, c: P.sand },
  { nd: 1.062, c: P.sandOuter },
  { nd: 1.076, c: P.wetSand },
  { nd: 1.092, c: P.shallow1 },
  { nd: 1.15, c: P.shallow2 },
  { nd: 1.3, c: P.water },
  { nd: 1.55, c: P.deep },
  { nd: 2.2, c: P.deepest },
];
function stopsAt(stops: { nd: number; c: RGB }[], n: number) {
  let i = 0;
  while (i < stops.length - 2 && n > stops[i + 1].nd) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const t = smooth(a.nd, b.nd, n);
  out.r = a.c[0] + (b.c[0] - a.c[0]) * t;
  out.g = a.c[1] + (b.c[1] - a.c[1]) * t;
  out.b = a.c[2] + (b.c[2] - a.c[2]) * t;
}
export const WATERLINE_ND = 1.082; // where the visible water starts (foam rides here)
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
// bush clumps are rooted under the house, bridge, cliff, palms, etc.
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

// Character cells no ground glyph is drawn on: each structure's glyph
// silhouette plus one cell (world.ts silhouetteMask), not its whole box.
let GLYPH_MASK: Uint8Array | null = null;
function glyphMask(): Uint8Array {
  return (GLYPH_MASK ??= silhouetteMask(
    STRUCT_ENTS.filter((e) => e.kind !== 'hotspot' && e.kind !== 'blocker'),
    1,
  ));
}

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

// ---- per-cell evaluation -----------------------------------------------------

export const KIND_GRASS = 0;
export const KIND_BUSH = 1;
export const KIND_SAND = 2;
export const KIND_WATER = 3;
export const KIND_ROCK = 4; // stones in the water

const out = { r: 0, g: 0, b: 0, kind: 0, ndv: 0, lit: 0, patch: 0 };

// `jit` nudges the coast distance per cell (a few thousandths of an nd), so
// every colour boundary breaks into a ragged, dithered mosaic edge.
function sample(fx: number, fy: number, jit: number) {
  const ndv = visualNd(fx, fy);
  out.ndv = ndv;
  out.lit = 0;
  out.patch = 0;
  const n = ndv + jit;
  // ragged, cell-scale shoreline: a little noise on where sand starts
  const edge = SAND_START_ND + (vnoise(fx * 1.3, fy * 1.3, 83) - 0.5) * 0.016;
  const onLand = n < edge;
  stopsAt(onLand ? LAND_STOPS : SEA_STOPS, n);

  if (n < 0.99) {
    // broad light/dark ground patches, fading out toward the rim
    const p = fbm(fx * 0.075, fy * 0.075, 41);
    const w = (1 - smooth(0.9, 0.975, n)) * 0.85;
    const tt = smooth(0.3, 0.72, p);
    out.patch = tt * (1 - smooth(0.9, 0.975, n));
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
  out.kind = onLand ? KIND_GRASS : n < WATERLINE_ND ? KIND_SAND : KIND_WATER;

  // bush clumps: lumpy at cell scale, FLAT dark green — the texture comes
  // from the glyphs on top (see terrainField), not from shading; lit domes
  // read as round balls once zoomed out and the glyphs get tiny
  if (ndv > 0.82 && ndv < 1.06) {
    if (bushAt(fx, fy * ISO_Y) > 0) {
      const tone = 0.94 + 0.12 * hit.tone;
      const t = 0.8;
      out.r = (P.bushDark[0] + (P.bushMid[0] - P.bushDark[0]) * t) * tone;
      out.g = (P.bushDark[1] + (P.bushMid[1] - P.bushDark[1]) * t) * tone;
      out.b = (P.bushDark[2] + (P.bushMid[2] - P.bushDark[2]) * t) * tone;
      out.kind = KIND_BUSH;
    }
  }

  // rocks in the shallows: small ragged grey clusters
  // (few and close to shore; blended into the water so they read as
  // stones lying in it, not slabs on top)
  if (out.kind === KIND_WATER && ndv > 1.09 && ndv < 1.3) {
    const rock = fbm(fx * 0.5, fy * 0.5, 505) + (vnoise(fx * 2.2, fy * 2.2, 17) - 0.5) * 0.14;
    if (rock > 0.765) {
      const d = clamp01((rock - 0.765) / 0.06); // 0 at the rim of a rock, 1 inside
      const w = 0.5 + 0.35 * d;
      const rr = P.rockDark[0] + (P.rock[0] - P.rockDark[0]) * d;
      const rg = P.rockDark[1] + (P.rock[1] - P.rockDark[1]) * d;
      const rb = P.rockDark[2] + (P.rock[2] - P.rockDark[2]) * d;
      out.r += (rr - out.r) * w;
      out.g += (rg - out.g) * w;
      out.b += (rb - out.b) * w;
      out.kind = KIND_ROCK;
    }
  }
}

// ---- glyph vocabulary ------------------------------------------------------

// The SAME density ramp the hand-made assets and crafted items are built from
// (craft/materials.ts RAMP_DEFAULT, from glyphify.py), light → heavy, so the
// ground reads as one art style with the house, player and items on top.
const RAMP = [...RAMP_DEFAULT.slice(1)]; // drop the leading space
export const GLYPHS = ['', ...RAMP, '∘', 'o', 'O', '"', "'", ',', 'v', '0', '8', 'x'];
const G_RING = RAMP.length + 1; // ∘
const G_O = RAMP.length + 2; // o
const G_BIG_O = RAMP.length + 3; // O
const G_TUFT = [RAMP.length + 4, RAMP.length + 7, RAMP.length + 4, RAMP.length + 7, 9, 5]; // " v " v * +
const G_EIGHT = RAMP.length + 9; // 8
const G_X = RAMP.length + 10; // x
// Leafy marks: mostly round shapes (like the reference foliage and the
// house art's o 0 @ & % runs), a few heavier ramp marks for weight.
const G_LEAF = [G_O, 15, G_EIGHT, 12, 11, G_O, 9, 10, G_X, 13, RAMP.length + 8];
const G_ROCK = [RAMP.length + 2, RAMP.length + 3, RAMP.length + 8, RAMP.length - 1, 12]; // o O 0 Ø &

// ---- the field ---------------------------------------------------------------

export interface TerrainField {
  /** Background colour, RGBA, one pixel per SQUARE block (bgW x bgH, drawn stretched over the ground). */
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

// a character cell's height / width (14px line / 8.4px char, see App.tsx)
const CELL_ASPECT = 14 / 8.4;

export function terrainField(): TerrainField {
  if (FIELD) return FIELD;
  const n = GROUND_W * GROUND_H;
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

      // glyph + its colour. Like the hand-made assets, every surface cell
      // carries a glyph from the density ramp, drawn as a LIGHTER tone of
      // its own cell colour: light marks on calm ground, heavy marks where
      // the surface is lit or busy (foliage).
      let g = 0;
      let k = 0; // + lightens toward white, − darkens
      let tr = -1, tg = 0, tb = 0, m = 0; // optional tint toward a colour instead
      const land = out.kind !== KIND_WATER;
      // fine surface texture shared by every surface (0..1)
      const tex = vnoise(fx * 1.7, fy * 1.7, 201) * 0.6 + h * 0.4;
      if (land && glyphMask()[idx]) {
        g = 0;
      } else if (out.kind === KIND_BUSH) {
        // foliage texture: every cell a heavy mark, randomly brighter or
        // darker yellow-olive, yellowing toward the sand edge
        const lit = h2 * h2;
        const fringe = smooth(0.975, 1.01, out.ndv);
        // mostly heavy ramp marks, some round o / ¤ for the leafy mix
        g = G_LEAF[Math.floor((0.55 * tex + 0.45 * h2) * G_LEAF.length) % G_LEAF.length];
        const fr = P.foliageGlyphDark[0] + (P.foliageGlyph[0] - P.foliageGlyphDark[0]) * lit;
        const fg = P.foliageGlyphDark[1] + (P.foliageGlyph[1] - P.foliageGlyphDark[1]) * lit;
        const fb = P.foliageGlyphDark[2] + (P.foliageGlyph[2] - P.foliageGlyphDark[2]) * lit;
        tr = fr + (P.fringeGlyph[0] - fr) * fringe;
        tg = fg + (P.fringeGlyph[1] - fg) * fringe;
        tb = fb + (P.fringeGlyph[2] - fb) * fringe;
        m = 0.8 + 0.18 * Math.max(lit, fringe);
      } else if (out.kind === KIND_GRASS) {
        // The rim band: glyphs thicken toward the coast (the fade starts
        // well inland: bushes cover the last stretch before the shore).
        const rim = smooth(0.74, 0.97, out.ndv);
        // Light-green grass tufts gather in the DARKER ground patches (light
        // marks need a darker ground to show), so zoomed out the island shows
        // grass texture without being covered in signs.
        const tuftCluster = smooth(0.35, 0.72, vnoise(fx * 0.3, fy * 0.3, 91));
        const inland = 1 - smooth(0.8, 0.9, out.ndv);
        const tuftP = 0.7 * (1 - smooth(0.25, 0.6, out.patch)) * tuftCluster * inland;
        if (h < 0.012 + 0.8 * rim * rim) {
          g = G_LEAF[Math.floor(h2 * G_LEAF.length)];
          const fringe = smooth(0.965, 1.005, out.ndv);
          tr = P.foliageGlyph[0] + (P.fringeGlyph[0] - P.foliageGlyph[0]) * fringe;
          tg = P.foliageGlyph[1] + (P.fringeGlyph[1] - P.foliageGlyph[1]) * fringe;
          tb = P.foliageGlyph[2] + (P.fringeGlyph[2] - P.foliageGlyph[2]) * fringe;
          m = rim > 0.2 ? 0.4 + 0.5 * rim : 0.25;
        } else if (h2 < tuftP) {
          g = G_TUFT[Math.floor(h * 97) % G_TUFT.length];
          tr = P.grassGlyph[0];
          tg = P.grassGlyph[1];
          tb = P.grassGlyph[2];
          m = 0.62 + 0.3 * tex;
        }
      } else if (out.kind === KIND_ROCK) {
        if (h < 0.9) {
          g = G_ROCK[Math.floor(h2 * G_ROCK.length)];
          tr = P.rockGlyph[0];
          tg = P.rockGlyph[1];
          tb = P.rockGlyph[2];
          m = 0.45 + 0.35 * tex;
        }
      } else if (out.kind === KIND_SAND) {
        const stones = vnoise(fx * 0.8, fy * 0.8, 313);
        if (stones > 0.9 && out.ndv < 1.045 && h < 0.4) {
          g = h2 > 0.5 ? G_O : G_BIG_O;
          const st = h2 > 0.5 ? P.stoneLight : P.stone;
          tr = st[0];
          tg = st[1];
          tb = st[2];
          m = 1;
        } else if (h < 0.8) {
          // warm glyph grain over the whole band, yellow-olive right next to
          // the rim so sand and foliage knit together like the reference
          const nearRim = 1 - smooth(1.015, 1.045, out.ndv);
          g = h2 < 0.35 ? G_O : h2 < 0.55 ? G_RING : h2 < 0.7 ? G_X : h2 < 0.85 ? 2 : 1;
          tr = P.sandGlyph[0] + (P.fringeGlyph[0] - P.sandGlyph[0]) * nearRim;
          tg = P.sandGlyph[1] + (P.fringeGlyph[1] - P.sandGlyph[1]) * nearRim;
          tb = P.sandGlyph[2] + (P.fringeGlyph[2] - P.sandGlyph[2]) * nearRim;
          m = 0.32 + 0.25 * tex + 0.25 * nearRim;
        }
      } else {
        // water: a dot on EVERY cell (the reference's fine lattice), rings
        // and a few x marks mixed in, brighter in the shallows and patches
        const shallow = out.ndv < 1.25;
        const bright = vnoise(fx * 0.18, fy * 0.18, 5);
        g = h2 < 0.62 ? 1 : h2 < 0.82 ? G_RING : shallow && h2 < 0.9 ? G_X : 2;
        tr = P.waterGlyph[0];
        tg = P.waterGlyph[1];
        tb = P.waterGlyph[2];
        m = (shallow ? 0.3 : 0.2) + 0.22 * smooth(0.5, 0.8, bright);
      }
      if (tr < 0 && g) {
        tr = k >= 0 ? 255 : 0;
        tg = tr;
        tb = tr;
        m = Math.abs(k);
      }
      glyph[idx] = g;
      color[idx] = g
        ? pack(out.r + (tr - out.r) * m, out.g + (tg - out.g) * m, out.b + (tb - out.b) * m)
        : 0;
    }
  }
  // Mosaic: its own grid of SQUARE blocks. A character cell is 5/3 as tall
  // as it is wide (8.4 x 14 px), so one block per cell drew tall
  // rectangles; with 5/3 as many rows each block is one cell wide and one
  // cell-width tall. Same colour field, sampled at the block centres, each
  // block slightly varied like a painted tile.
  const bgW = GROUND_W;
  const bgH = Math.round(GROUND_H * CELL_ASPECT);
  const bg = new Uint8ClampedArray(bgW * bgH * 4);
  for (let by = 0; by < bgH; by++) {
    const fy = ((by + 0.5) / bgH) * (GROUND_H / TILE_LN);
    for (let bx = 0; bx < bgW; bx++) {
      const fx = (bx + 0.5) / TILE_CH;
      const h3 = hash2(bx * 0.377 + 19, by * 1.27 + 41);
      sample(fx, fy, (h3 - 0.5) * 0.012);
      const v = (h3 - 0.5) * 10;
      const k4 = (by * bgW + bx) * 4;
      bg[k4] = out.r + v;
      bg[k4 + 1] = out.g + v;
      bg[k4 + 2] = out.b + v * 0.8;
      bg[k4 + 3] = 255;
    }
  }
  FIELD = { bg, bgW, bgH, ndv, kind, glyph, color };
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
      if (f.kind[y * GROUND_W + x] === KIND_ROCK) continue;
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
