import * as S from './sprites';
import { GARDEN } from './farm';
import worldDocData from './data/world.json';
import mainIslandData from './data/mainIsland.json';
import shopIslandData from './data/shopIsland.json';
import { assetOf, ASSET_OF_KIND } from './assets';
import { signArt, type SignSettings } from './wayfinder';

// The map is a tile grid. Each tile is 4 characters wide and 2 lines tall, so
// the ground layer is (MAP_W*4) x (MAP_H*2) characters. Entities are positioned
// at tile coordinates; horizontal placement uses `ch` units and vertical
// placement uses `em` units (line-height: 1) so everything stays locked to the
// monospace character grid.
export const MAP_W = 130;
export const MAP_H = 145;
export const TILE_CH = 4; // chars per tile (x)
export const TILE_LN = 2; // lines per tile (y)
export const GROUND_W = MAP_W * TILE_CH;
export const GROUND_H = MAP_H * TILE_LN;

// seed: dropped now and then by a flower (plant it, water it once); bloom:
// what a seed grows into, the crop worth one crafting token
export type ItemType = 'flower' | 'stone' | 'date' | 'cactus' | 'fern' | 'iceflower' | 'seed' | 'bloom' | 'strawberry' | 'pumpkin';
export type EntityKind =
  | ItemType
  | 'palm'
  | 'shop'
  | 'cat'
  | 'house'
  // An invisible interaction zone pinned over part of another sprite — the
  // clothesline garments and the front door are all painted INTO
  // the house's own picture, so they need a hit-box of their own to be
  // hoverable and clickable. Never drawn (styles.css hides it), never solid.
  | 'hotspot'
  // An invisible wall. Same "not drawn" treatment, opposite job: it blocks
  // the player's WHOLE body, for spots a host sprite's own (feet-only)
  // collider can't express — see the house's deck-edge blocks.
  | 'blocker'
  | 'pond'
  | 'bridge'
  | 'grasshalm'
  | 'flowerplus'
  // The fenced garden plot. It lives in STRUCT_ENTS purely so the dev layout
  // tool can hit-test and drag it like any other structure; App.tsx skips it in
  // the generic entity map and draws it itself, because the picture it shows
  // depends on whether the gate is open. Its collider is farm.ts's fence ring,
  // not a glyph mask, so the entity itself never blocks.
  | 'gardenbed'
  // The bluff below the cottage. Terrain rather than a building: its grass
  // crown is ground you stand ON (feet-only collision, like the house's deck)
  // and only the rock face beneath it blocks — see CLIFF_SOLID in sprites.ts.
  | 'cliff'
  // A new asset placed with the world editor that hasn't been given a kind
  // of its own (see src/assets.ts): drawn in its own colours, no behaviour.
  | 'decor'
  // A big rock placed with the world editor (the stone sheet): drawn like
  // decor but with an opaque backing per cell, so it reads as solid stone
  // instead of glyphs floating over the grass.
  | 'boulder'
  // a fence piece or the wooden sign board (src/fence.ts): drawn solid,
  // blocks where it's drawn
  | 'fence'
  // a fence gate: F opens and closes it (open, only its posts block)
  | 'gate'
  | 'placed'; // a player-placed decoration/furniture entity (see placement.ts)

// ---------------------------------------------------------------------------
// THE ISLANDS — the MAIN island (concrete landmass, split into big contiguous
// climate-zone regions, loosely modelled on Hawai'i's Big Island) plus a
// handful of smaller, currently-undeveloped islands scattered across the rest
// of the map. Deterministic and pure — the map never changes at runtime.
//
// The smaller islands are SHAPE + SAND ONLY for now: no sub-biomes, no
// structures, no wildlife — see regionAt below, which only gives the main
// island (index 0 of ISLANDS) its jungle/desert/rocky/tundra carve-outs.
// They're also not reachable yet (isWater blocks all movement between
// islands; see App.tsx's tryMove) — that's future work, along with whatever
// eventually ferries the player between them.
// ---------------------------------------------------------------------------

export type Region = 'ocean' | 'beach' | 'meadow' | 'jungle' | 'desert' | 'rocky' | 'tundra';

interface IslandDef {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

// Main island body, unchanged from the single-island version of this file: an
// ellipse with a gentle, deterministic coastline wobble. Every hand-placed
// structure, the village/volcano/summit anchors, and PLAYER_SPAWN all assume
// THIS shape at THESE coordinates, so it is never moved or resized — new
// islands only ever get ADDED around it, in map space opened up to their
// south/east (see MAP_W/MAP_H above; the main island's own margin to the
// original west/north edges is untouched).
// Its SHAPE (and the shop island's) comes from src/data/mainIsland.json /
// shopIsland.json, baked from the reference map (scripts/bake-island.py): one
// class per ground cell (ch x line) — water, grass, sand, cliff face, stones
// in the water. Their coast field (below) is the signed distance to that
// land, so walking, boats, the drawn coast and the sea routes all follow the
// picture. Their ellipse is only their bounds (the sea routes' ring).
type IslandGrid = { x0: number; y0: number; cols: number; rows: number; grid: string[] };

// A baked island: its grid (cells), its bounds, and its coast field — the
// signed distance (tiles) from its land, inland negative, scaled so the bands
// the terrain draws (sand rim, foam, shallows) hug the shore:
// nd = 1 + distance / BAKED_ND_SCALE. Exact Euclidean distance over the cell
// grid (Felzenszwalb's separable transform, cells 1/4 tile wide and 1/2 tile
// tall), on a grid padded with open sea so it runs out smoothly.
const BAKED_ND_SCALE = 14;
const BAKED_PAD = { x: 32, y: 16 }; // cells of sea round a baked grid
interface Baked {
  g: IslandGrid;
  W: number; // the padded field's size, cells
  H: number;
  field: Float32Array | null;
}
const bakedOf = (g: IslandGrid): Baked => ({ g, W: g.cols + 2 * BAKED_PAD.x, H: g.rows + 2 * BAKED_PAD.y, field: null });
const boundsOf = (g: IslandGrid): IslandDef => ({
  cx: (g.x0 + g.cols / 2) / TILE_CH,
  cy: (g.y0 + g.rows / 2) / TILE_LN,
  rx: g.cols / TILE_CH / 2,
  ry: g.rows / TILE_LN / 2,
});
// by island index: 0 the main island, 1 the shop island; the rest are ellipses
const BAKED: Baked[] = [bakedOf(mainIslandData as IslandGrid), bakedOf(shopIslandData as IslandGrid)];

// A baked island's class at a ground cell (world ch, lines): '.' water,
// 'g' grass, 's' sand, 'c' cliff face, 'r' a stone in the water; null off
// every baked grid
export function islandClass(cx: number, cy: number): string | null {
  for (let i = 0; i < BAKED.length; i++) {
    const g = BAKED[i].g;
    const c = Math.floor(cx) - g.x0 - ISLAND_OFF[i].dx * TILE_CH;
    const r = Math.floor(cy) - g.y0 - ISLAND_OFF[i].dy * TILE_LN;
    if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) continue;
    const k = g.grid[r][c] ?? '.';
    // grids may overlap at their sea margins: land wins
    if (k !== '.') return k;
    let landElsewhere: string | null = null;
    for (let j = i + 1; j < BAKED.length && !landElsewhere; j++) {
      const h = BAKED[j].g;
      const c2 = Math.floor(cx) - h.x0 - ISLAND_OFF[j].dx * TILE_CH;
      const r2 = Math.floor(cy) - h.y0 - ISLAND_OFF[j].dy * TILE_LN;
      if (r2 >= 0 && r2 < h.rows && c2 >= 0 && c2 < h.cols && h.grid[r2][c2] !== '.') landElsewhere = h.grid[r2][c2];
    }
    return landElsewhere ?? '.';
  }
  return null;
}
// A tile with cliff face across its middle: the player can't stand there
export function isCliffTile(tx: number, ty: number): boolean {
  let n = 0;
  for (let dy = 0; dy < TILE_LN; dy++)
    for (let dx = 0; dx < TILE_CH; dx++) if (islandClass(tx * TILE_CH + dx, ty * TILE_LN + dy) === 'c') n++;
  return n * 2 >= TILE_CH * TILE_LN;
}

function edt1d(f: Float64Array, n: number, w: number): Float64Array {
  // squared distance along one axis, samples w apart (lower envelope of parabolas)
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const cross = (q: number, p: number) => (f[q] + (q * w) ** 2 - (f[p] + (p * w) ** 2)) / (2 * w * (q - p));
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let sx = cross(q, v[k]);
    while (sx <= z[k]) sx = cross(q, v[--k]);
    k++;
    v[k] = q;
    z[k] = sx;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q * w) k++;
    d[q] = (q * w - v[k] * w) ** 2 + f[v[k]];
  }
  return d;
}
// distance (tiles) from every cell to the nearest cell where `inside` holds
function edt2d(inside: Uint8Array, W: number, H: number): Float64Array {
  const BIG = 1e12;
  const out = new Float64Array(W * H);
  const col = new Float64Array(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = inside[y * W + x] ? 0 : BIG;
    const d = edt1d(col, H, 1 / TILE_LN);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  const row = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) row[x] = out[y * W + x];
    const d = edt1d(row, W, 1 / TILE_CH);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}
function bakedField(b: Baked): Float32Array {
  if (b.field) return b.field;
  const { g, W, H } = b;
  const land = new Uint8Array(W * H);
  const sea = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const r = y - BAKED_PAD.y, c = x - BAKED_PAD.x;
      const ch = r >= 0 && r < g.rows && c >= 0 && c < g.cols ? g.grid[r][c] : '.';
      // (a stone in the water, 'r', is water for the coast: boats pass it)
      const isLand = ch !== '.' && ch !== 'r' && ch !== undefined;
      land[y * W + x] = isLand ? 1 : 0;
      sea[y * W + x] = isLand ? 0 : 1;
    }
  const toLand = edt2d(land, W, H);
  const toSea = edt2d(sea, W, H);
  const f = new Float32Array(W * H);
  for (let i = 0; i < f.length; i++) f[i] = 1 + (land[i] ? -toSea[i] : toLand[i]) / BAKED_ND_SCALE;
  return (b.field = f);
}
// a baked island's nd at a tile point (bilinear over the cell field; past
// the padded grid, the distance keeps growing with the bounds' distance)
function bakedNd(i: number, tx: number, ty: number): number {
  const b = BAKED[i];
  const f = bakedField(b);
  const { g, W, H } = b;
  const gx = (tx - ISLAND_OFF[i].dx) * TILE_CH - g.x0 + BAKED_PAD.x - 0.5;
  const gy = (ty - ISLAND_OFF[i].dy) * TILE_LN - g.y0 + BAKED_PAD.y - 0.5;
  const cx = Math.max(0, Math.min(W - 1.001, gx));
  const cy = Math.max(0, Math.min(H - 1.001, gy));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const ax = cx - x0, ay = cy - y0;
  const k = y0 * W + x0;
  const v = f[k] * (1 - ax) * (1 - ay) + f[k + 1] * ax * (1 - ay) + f[k + W] * (1 - ax) * ay + f[k + W + 1] * ax * ay;
  const out = Math.hypot((gx - cx) / TILE_CH, (gy - cy) / TILE_LN);
  return v + out / BAKED_ND_SCALE;
}

// New islands, smallest to largest, placed with a comfortable ocean gap (15+
// tiles) from the main island and from each other and from the map edges.
// Purely decorative landmasses for now — see the file-header note above.
const OTHER_BASE: IslandDef[] = [
  { cx: 112, cy: 60, rx: 9, ry: 8 }, // E — small
  { cx: 100, cy: 95, rx: 8, ry: 8 }, // SE — small
  { cx: 50, cy: 122, rx: 13, ry: 11 }, // S — medium
];

const BASE_ISLANDS: IslandDef[] = [...BAKED.map((b) => boundsOf(b.g)), ...OTHER_BASE];

// Where each island has been moved to (the world editor's Islands tab, saved
// in world.json's `islands`): whole tiles from where it was made. ISLANDS are
// the islands where they stand now; the main island's baked map moves along.
export type IslandOffsets = Record<string, { dx: number; dy: number }>;
const ISLAND_OFF: { dx: number; dy: number }[] = BASE_ISLANDS.map(() => ({ dx: 0, dy: 0 }));
const ISLANDS: IslandDef[] = BASE_ISLANDS.map((b) => ({ ...b }));
export const ISLAND_COUNT = BASE_ISLANDS.length;
export function setIslandOffsets(off: IslandOffsets | undefined) {
  BASE_ISLANDS.forEach((b, i) => {
    const o = off?.[i] ?? { dx: 0, dy: 0 };
    ISLAND_OFF[i] = { dx: o.dx, dy: o.dy };
    ISLANDS[i] = { ...b, cx: b.cx + o.dx, cy: b.cy + o.dy };
  });
}
// an island's bounds (tiles, where it stands for these offsets)
export function islandBounds(i: number, off?: IslandOffsets): IslandDef {
  const b = BASE_ISLANDS[i];
  const o = off ? (off[i] ?? { dx: 0, dy: 0 }) : ISLAND_OFF[i];
  return { ...b, cx: b.cx + o.dx, cy: b.cy + o.dy };
}
setIslandOffsets((worldDocData as { islands?: IslandOffsets }).islands);

// Signed distance-ish field from ONE island's centre: <1 inland, ≈1 the
// waterline, >1 open ocean. Same wobble on every island so they all read as
// the same hand.
function islandNdFor(i: number, tx: number, ty: number): number {
  if (i < BAKED.length) return bakedNd(i, tx, ty);
  const isl = ISLANDS[i];
  const dx = (tx - isl.cx) / isl.rx;
  const dy = (ty - isl.cy) / isl.ry;
  const wobble =
    0.06 * Math.sin(tx * 0.45) + 0.05 * Math.cos(ty * 0.5) + 0.04 * Math.sin((tx + ty) * 0.3);
  return Math.sqrt(dx * dx + dy * dy) - wobble;
}

// A tile is land if it's inland of ANY island, so every per-tile query needs
// whichever island is CLOSEST, not just the main one — both its nd (for
// water/beach thresholds) and the island itself (for region carve-outs and,
// in genShoreFrame, the per-angle finger lobes around that island's own
// centre rather than always the main island's).
export function nearestIsland(tx: number, ty: number): { nd: number; isl: IslandDef; idx: number } {
  let bestIdx = 0;
  let bestNd = Infinity;
  for (let i = 0; i < ISLANDS.length; i++) {
    const nd = islandNdFor(i, tx, ty);
    if (nd < bestNd) {
      bestNd = nd;
      bestIdx = i;
    }
  }
  return { nd: bestNd, isl: ISLANDS[bestIdx], idx: bestIdx };
}

// Exported because the shoreline surge animates a threshold along this field
// (see genShoreFrame) — now the NEAREST island's field, so it wraps every
// landmass on the map, not just the main one.
export function islandNd(tx: number, ty: number): number {
  return nearestIsland(tx, ty).nd;
}

export function isWater(tx: number, ty: number): boolean {
  return islandNd(tx, ty) > 1;
}

// Water that also LOOKS like water: past the drawn sand band (the beach is
// drawn wider than it plays, see VISUAL TERRAIN below). Boats keep to this,
// so a boat never sits on the sand.
export function isOpenWater(tx: number, ty: number): boolean {
  return islandNd(tx, ty) > OPEN_WATER_ND;
}
const OPEN_WATER_ND = 1.13; // = COAST.outerSandEnd

// big region anchors — all on the MAIN island only
const VILLAGE = { x: 32, y: 30, r: 12 }; // home meadow, kept friendly
const VOLCANO = { x: 40, y: 54, r: 13 }; // central lava fields
const SUMMIT = { x: 40, y: 54, r: 4 }; // snow-capped peak on the volcano

export function regionAt(tx: number, ty: number): Region {
  const { nd, idx } = nearestIsland(tx, ty);
  if (nd > 1) return 'ocean';
  if (nd > 0.8) return 'beach'; // coastal sand ring, every island — widened further for a clearly readable band
  if (idx !== 0) return 'meadow'; // other islands: flat grass, no sub-biomes yet
  // the main island's region anchors move with it
  tx -= ISLAND_OFF[0].dx;
  ty -= ISLAND_OFF[0].dy;
  if (Math.hypot(tx - VILLAGE.x, ty - VILLAGE.y) < VILLAGE.r) return 'meadow';
  if (Math.hypot(tx - SUMMIT.x, ty - SUMMIT.y) < SUMMIT.r) return 'tundra';
  if (Math.hypot(tx - VOLCANO.x, ty - VOLCANO.y) < VOLCANO.r) return 'rocky';
  if (tx >= 46) return 'jungle'; // wet east side
  if (ty >= 52) return 'desert'; // dry south-west
  return 'meadow'; // grassland north / north-west
}

// ---------------------------------------------------------------------------
// VISUAL TERRAIN — a SEPARATE classification from Region/regionAt above.
// Region answers "what biome/gameplay area is this" (spawning, sub-biome
// carve-outs, etc.) and is untouched by any of this. VisualTerrain answers
// only "what should this tile's background look like" for the coastline
// render — a finer-grained band sequence than Region's single 'beach'/
// 'ocean' split, and one that's allowed to extend the visual sand/shallow
// bands into tiles Region and isWater() still consider water. Don't fold the
// two together: nd 1.06, say, is visually 'sand' but still gameplay water
// (isWater() stays true, movement/collision are untouched) — the beach is
// allowed to look wider than it plays.
//
// Two independent axes, not a replacement:
//   REGION / BIOME    = what kind of gameplay/environment area am I in?
//   VISUAL TERRAIN    = which coastline/background surface am I drawing?
// e.g. a tile can be Region 'jungle' + VisualTerrain 'land', or Region
// 'meadow' + VisualTerrain 'grassEdge' — later work may still want different
// interior glyphs per biome while sharing this same coastline architecture.
export type VisualTerrain =
  | 'land'
  | 'grassEdge'
  | 'earthRim'
  | 'sand'
  | 'outerSand'
  | 'shallowWater'
  | 'ocean';

// ONE authoritative definition of the visual coastline's band boundaries, in
// nd units (see islandNd/nearestIsland above). Stage 1: these just decide
// which flat background colour a tile gets (see VISUAL_TERRAIN_BG below).
// Stage 2 is expected to layer dense ASCII/glyph texture over these bands to
// soften the currently-hard seams between them.
const COAST = {
  grassEdgeStart: 0.96,
  landEdge: 1.0,
  earthRimEnd: 1.02,
  sandEnd: 1.09,
  outerSandEnd: 1.13,
  shallowWaterEnd: 1.2,
};

// The visual coastline itself (colours, bushes, foam) is drawn by terrain.ts;
// COAST above stays as the shared nd reference for the gameplay-side foam
// range (isFoamZone).

export interface Ent {
  id: string;
  startOnly?: true; // a start-screen-only object (WorldAdded.startOnly)
  kind: EntityKind;
  x: number; // tile x of sprite top-left
  y: number; // tile y of sprite top-left
  sprite: string[];
  interactable: boolean; // interactables get the [F] popup when the player is near
  fallFrom?: number; // lines to fall from, for freshly dropped fruit
  // optional per-region colour ("paint by number"): palette (key→hex) + a grid
  // the same shape as sprite, each cell a palette key or '.' (= the base colour
  // from the .ent.<kind> CSS). Lets a specific glyph be tinted, e.g. an eye.
  palette?: Record<string, string>;
  colors?: string[];
  // palette keys whose glyphs sway left and right (an animated pond's water)
  sway?: string;
  // palette keys drawn without a backing (a pond's outer grass, see assets.ts)
  blend?: string;
  // Optional CSS render scale. The generated palm keeps its full character grid
  // — every glyph and tone of the reference — and is simply DRAWN smaller, which
  // is the only way to shrink it without changing its shape. spriteTiles() and
  // the renderer both read this so the footprint matches what you see.
  scale?: number;
  // Optional collision override, same shape/crop as `sprite`: a tile blocks
  // only where THIS grid has a glyph, not wherever `sprite` does. Absent =
  // fall back to `sprite` (every entity except the palm today) — see
  // entityBlocksTile just below.
  solidMask?: string[];
  // 90°-clockwise steps (0-3), used by player-placed items only. Undefined
  // behaves exactly like 0 everywhere — every existing entity is unaffected.
  rotation?: 0 | 1 | 2 | 3;
  // The registry slug it draws (src/assets.ts) — set on everything the world
  // editor knows about, so a collider painted for an asset reaches every copy.
  asset?: string;
}

// Tile footprint of a sprite. `scale` is the CSS scale it is DRAWN at (see
// Ent.scale): a sprite rendered at 0.6 covers 0.6x the cells, and every
// placement, collision and z-order test has to agree with what's on screen —
// so the scale belongs here, at the single place tile size is derived.
export function spriteTiles(sprite: string[], scale = 1, rotation: 0 | 1 | 2 | 3 = 0) {
  const w = Math.max(...sprite.map((l) => l.length)) * scale;
  const wT = Math.ceil(w / TILE_CH);
  const hT = Math.ceil((sprite.length * scale) / TILE_LN);
  // 90°/270°: the tile footprint's width and height swap.
  return rotation % 2 === 1 ? { wT: hT, hT: wT } : { wT, hT };
}

// An all-blank solidMask, same shape/crop as `sprite`: entityBlocksTile never
// finds a glyph on it, so the entity never blocks movement no matter what its
// own sprite draws — for pure ground dressing (grass, flowers) that should
// read as decoration underfoot, not an obstacle, the same idea as the palm's
// solidMask but with nothing solid at all instead of just the crown carved out.
function noCollide(sprite: string[]): string[] {
  return sprite.map((l) => ' '.repeat(l.length));
}

// A solid rectangle of glyphs sized in MASTER grid cells (w is undoubled —
// doubled here like every other baked sprite). Used for 'hotspot' entities:
// the glyphs are what give the element a real layout box to hover and click,
// and CSS hides them (see .ent.hotspot in styles.css).
function hotspotSprite(wCols: number, hRows: number): string[] {
  return Array.from({ length: hRows }, () => '#'.repeat(wCols * 2));
}

// The player's sprite (48x28 chars post-doubling, see sprites.ts — the
// straw-hat-still (1).svg reference) is far too big to draw at native size, hence
// the fractional scale below (tune to taste — see PLAYER_SPAWN just after,
// which stays valid across any reasonable scale here). Full detail still
// shows in the HUD avatar and chat portrait, which render the same sprite
// at their own larger font-size.
export const PLAYER_SCALE = 0.15;
export const PLAYER_T = spriteTiles(S.PLAYER, PLAYER_SCALE);
// Scaled so he stays the same 4.2 lines tall as his earlier 28-row sprite at
// the player's scale, whatever the resolution of his art (the original has 47
// rows, the player 22). Both follow his current look (applyMitchyLook).
export const mitchyScaleFor = (rows: number) => (PLAYER_SCALE * 28) / rows;
export let MITCHY_SCALE = mitchyScaleFor(S.MITCHY.length);
export let MITCHY_T = spriteTiles(S.MITCHY, MITCHY_SCALE);

// An entity's footprint is the bottom row of tiles it covers. Used for
// interaction distance (near) and dropped-fruit placement.
export function footprint(e: {
  x: number;
  y: number;
  sprite: string[];
  scale?: number;
  rotation?: 0 | 1 | 2 | 3;
}) {
  const { wT, hT } = spriteTiles(e.sprite, e.scale, e.rotation);
  return { row: e.y + hT - 1, x0: e.x, x1: e.x + wT - 1 };
}

// A tile-space axis-aligned box, inclusive on all edges.
export interface TileBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function tileBoxesOverlap(a: TileBox, b: TileBox): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

// The full bounding box of every tile a sprite covers (used to keep spawns from
// visually overlapping anything, not just clashing at the base row).
export function bbox(e: {
  x: number;
  y: number;
  sprite: string[];
  scale?: number;
  rotation?: 0 | 1 | 2 | 3;
}): TileBox {
  const { wT, hT } = spriteTiles(e.sprite, e.scale, e.rotation);
  return { x0: e.x, y0: e.y, x1: e.x + wT - 1, y1: e.y + hT - 1 };
}

// The solid box an entity blocks — its FULL tile bounding box, every entity,
// uniformly. This used to vary per kind (buildings solid throughout, trees
// only at the trunk base so you could pass behind the canopy, everything else
// just its footprint row) with a hand-picked inset narrowing the palm further
// to its trunk column. Both were APPROXIMATIONS standing in for "block where
// the art actually is" before entityBlocksTile below could answer that
// directly from the real glyph data. Now that it can, the per-kind height and
// inset guesses are gone (including the palm's canopy exception, by choice —
// its frond/date glyphs are dense enough to mostly be solid now): this
// rectangle is only ever a broad-phase reject (cheap to test with
// tileBoxesOverlap), and entityBlocksTile is what decides whether any given
// tile inside it truly blocks, from whatever's actually drawn there.
// NOTE the floor/ceil: `x0 + wT - 1` is only right when x is a whole tile.
// The house sits at x 27.85 (its anchor is derived from a glyph-grid cell, not
// snapped to the tile grid), so its art really spans tiles 27..35 — but the
// naive box reads 27.85..34.85, and since the caller compares against INTEGER
// player tiles, tile 35 fell outside it and tile 27 was only half-covered.
// That left an uncollidable sliver down each edge of the cottage that the
// player could stand inside. Rounding outward covers every tile the art
// actually touches; entityBlocksTile still narrows to the real glyphs within
// it, so this widens the broad phase only, and stays a no-op for the
// whole-tile entities that make up the rest of the world.
export function collisionBox(e: {
  x: number;
  y: number;
  sprite: string[];
  scale?: number;
  rotation?: 0 | 1 | 2 | 3;
}): TileBox {
  const { wT, hT } = spriteTiles(e.sprite, e.scale, e.rotation);
  return {
    x0: Math.floor(e.x),
    y0: Math.floor(e.y),
    x1: Math.ceil(e.x + wT) - 1,
    y1: Math.ceil(e.y + hT) - 1,
  };
}

// Does tile (tx,ty) — in TILE-local coordinates, relative to the entity's own
// (x,y) — actually contain a drawn (non-space) glyph? A tile is TILE_CH chars
// wide and TILE_LN lines tall at scale 1; at a smaller render scale the same
// tile covers proportionally MORE of the underlying character grid (the art
// is drawn smaller, so more of it fits per tile), which is why this divides
// by scale rather than multiplying.
function tileHasGlyph(sprite: string[], scale: number, tx: number, ty: number): boolean {
  // Clamped at 0: tx/ty are tile-LOCAL and go negative for the tile straddling
  // a fractionally-placed entity's left/top edge (see collisionBox). Without
  // the clamp those read off the front of the string, and `undefined !== ' '`
  // would report a glyph where there is none — blocking a whole column of
  // empty space beside the sprite.
  const x0 = Math.max(0, Math.floor((tx * TILE_CH) / scale));
  const x1 = Math.ceil(((tx + 1) * TILE_CH) / scale);
  const y0 = Math.max(0, Math.floor((ty * TILE_LN) / scale));
  const y1 = Math.ceil(((ty + 1) * TILE_LN) / scale);
  for (let y = y0; y < y1 && y < sprite.length; y++) {
    const line = sprite[y];
    for (let x = x0; x < x1 && x < line.length; x++) {
      if (line[x] !== ' ') return true;
    }
  }
  return false;
}

// The precise version of collisionBox: true only if the entity's SOLID box
// covers (tx,ty) AND that specific tile has an actual glyph on it — not just
// blank space inside the bounding rectangle. Blocking-movement code should
// use this instead of testing collisionBox() directly, so the collider hugs
// the drawn asset rather than its rectangular crop. Uses `solidMask` over
// `sprite` when the entity has one — e.g. the palm, whose crown leaves are
// visible but shouldn't block: see solidMask on Ent above.
export function entityBlocksTile(
  e: {
    x: number;
    y: number;
    sprite: string[];
    scale?: number;
    solidMask?: string[];
    rotation?: 0 | 1 | 2 | 3;
  },
  tx: number,
  ty: number,
): boolean {
  const box = collisionBox(e);
  if (tx < box.x0 || tx > box.x1 || ty < box.y0 || ty > box.y1) return false;
  // At 90°/270° the glyph grid itself would need to be rotated to test
  // per-cell accurately — not worth it for decor-scale objects, so this
  // falls back to box-solid: always CONSERVATIVE (blocks slightly more than
  // the visible glyphs), never lets the player clip through drawn art.
  if ((e.rotation ?? 0) % 2 === 1) return true;
  return tileHasGlyph(e.solidMask ?? e.sprite, e.scale ?? 1, tx - e.x, ty - e.y);
}

// Chebyshev distance between the player's footprint and an entity's.
export function near(
  e: { x: number; y: number; sprite: string[] },
  p: { x: number; y: number },
): number {
  const f = footprint(e);
  const prow = p.y + PLAYER_T.hT - 1;
  const px0 = p.x;
  const px1 = p.x + PLAYER_T.wT - 1;
  const dc = f.x0 > px1 ? f.x0 - px1 : px0 > f.x1 ? px0 - f.x1 : 0;
  return Math.max(dc, Math.abs(f.row - prow));
}

// ═══ LAYOUT — hand-placed structures. Relocate anything by editing its x/y. ═══
//   Coordinates are TILES: x ∈ [0, MAP_W), y ∈ [0, MAP_H). (0,0) is the
//   top-left; the village sits in the NW meadow. Change a number, reload, moved.
//   (These are all on the MAIN island — see ISLANDS below for the others,
//   which have no structures placed on them yet.)
//   On startup (dev) validateLayout() below warns in the console if a piece
//   overlaps another building, lands on water, or runs off the map — so editing
//   these numbers stays safe. Trees relocate the same way; they're just scatter.
// How much smaller the palm is DRAWN than its character grid. The grid is the
// reference's own (48-column bake), so shape and stipple are untouched — this
// only shrinks how much of the map it occupies. 1 = full size.
export const PALM_SCALE = 1;

// The cottage HOUSE sprite (82x52 chars, doubled from house_simplified.svg's
// full 41x52 glyph grid — this replaces the earlier house_taller.svg-derived
// house). 0.36 -> 82*0.36/4 = 7.38 by 52*0.36/2 = 9.36 tiles, chosen to match
// the OLD house's footprint (7.35 x 9.45) as closely as this new art's own
// aspect allows, so nothing else placed relative to the house this session
// (the cliff underneath it, most of all) needed re-deriving. Every 'hotspot'
// pinned over that picture MUST share this exact scale, or the hit-boxes
// drift off the thing they're supposed to cover.
export const HOUSE_SCALE = 0.36;
// The shop's art is 120 columns wide: at 0.25 it is 30 characters, about as
// wide as the house, so the two buildings read at the same scale.
export const SHOP_SCALE = 0.4;

// 11 x 8 tiles is 44 x 16 character cells on screen. At scale 1, that's the
// most art that could be shown here at one glyph per cell — the ceiling on
// resolution, not a preference. The previous bake traced garden-fence.svg
// cell-for-cell to 314x115 and shrank it to 0.139, i.e. every glyph drawn at
// a seventh of a character: illegible AND the single most expensive thing on
// the map (~30,000 spans, ~78ms of paint/frame — 10fps with it, 56fps with
// it hidden). Re-baked by downsampling to the plot's own 44x16 grid at scale
// 1 fixed both, but then couldn't resolve fine detail (the garden2_glyph.svg
// bed's decorative border lattice) any better than one glyph per ~2.9 source
// cells.
//
// GARDEN_BED_SCALE 0.5, not 1: the garden bed's sprite is now baked at
// DOUBLE that grid (88x32, ~1.4 source cells per glyph — see gardenBed.json's
// own "note") and drawn at half size, so the ON-SCREEN footprint is
// identical (88*0.5=44, 32*0.5=16) while showing roughly 2x the source
// detail. Cost: ~2,536 spans (checked against gardenBed.json directly) —
// still a small fraction of the ~30,000 that caused the original lag, so
// this has real headroom left if more detail is ever wanted again.
export const GARDEN_BED_SCALE = 0.5;

// The cliff is drawn at FULL SIZE — one sprite cell per character cell — so
// 74x19 chars is 74/4 = 18.5 by 19/2 = 9.5 tiles. That footprint is sized
// against the cottage (7.35 tiles across): the bluff runs about two and a half
// house-widths, wide enough to read as landscape the building stands on rather
// than a prop beside it. The grass crown is the top 6 rows, a 3-tile walkable
// ledge between the foot of the stairs and the drop.
//
// Scale 1 is the point, not an accident. This asset used to be a cell-for-cell
// trace of cliff.svg (214x55) shrunk to 0.35, which put every glyph at roughly
// a third of a character — far too small to read as a glyph at all — while
// still costing ~11,000 spans to lay out and paint every frame. Re-baked by
// downsampling the reference to the grid it is actually drawn on (see
// cliff.json's `generated.note`), it is 8x fewer cells AND each one is a
// legible character, the way the palm reads. Anything pinned over this art
// must share this scale, same rule as HOUSE_SCALE.
export const CLIFF_SCALE = 1;

// GRASS_HALM's 26x7 drawing grid is mostly blank space (two sparse blade
// clusters) — at native size that blank margin would make it a huge,
// mostly-empty tile footprint. 0.3 -> 2x2 tiles, small enough to read as a
// single ground-level tuft.
export const GRASS_SCALE = 0.2;

// FLOWER_PLUS's 6x3 drawing grid halved to read as a smaller ground accent
// next to the grass tuft rather than matching its native character size.
export const FLOWER_PLUS_SCALE = 0.5;

// Scattered asymmetrically (random angle/radius, not a grid or ring) near
// the original grasshalm1/flowerplus1 spot — see scripts/place-decor.mjs
// (temp, deleted after use) for how these were found clear of every
// structure, the garden, and each other.
// Four of these (grasshalm4/5/6, flowerplus4) used to sit at y 46-49 between
// x 30 and x 40, which the cliff now occupies — they'd have hung on the bare
// rock face, and flowerplus4 (collectable) would have been unreachable behind
// its collider besides. Moved clear of the bluff, checked against the game's
// own rules rather than by eye: each new spot's box overlaps no other entity,
// no water, no beach, and none of the cliff's solid cells, and the player can
// still stand next to it. grasshalm1 and flowerplus6/7 stayed put — they land
// on the walkable grass crown, which is where ground dressing belongs.
const GRASS_SPOTS = [
  { id: 'grasshalm1', x: 38, y: 42 },
  { id: 'grasshalm2', x: 44, y: 40 },
  { id: 'grasshalm3', x: 46, y: 39 },
  { id: 'grasshalm4', x: 36, y: 52 },
  { id: 'grasshalm5', x: 28, y: 52 },
  { id: 'grasshalm6', x: 42, y: 45 },
  { id: 'grasshalm7', x: 44, y: 41 },
  { id: 'grasshalm8', x: 44, y: 42 },
];
// Hand-placed, not collision-checked against each other (unlike wildSpawns'
// rejection sampling below) -- a few of these were originally authored only
// 1.4-2.2 tiles apart, close enough for their sprite boxes to visually
// overlap. Respaced so every pair is at least ~3-4 tiles apart while
// staying in roughly the same spots/cluster they were meant to sit in.
const FLOWER_SPOTS = [
  { id: 'flowerplus1', x: 41, y: 42 },
  { id: 'flowerplus2', x: 34, y: 37 },
  { id: 'flowerplus3', x: 42, y: 47 },
  { id: 'flowerplus4', x: 33, y: 54 },
  { id: 'flowerplus5', x: 45, y: 45 }, // was (42,43) -- ~1.4 tiles from flowerplus1
  { id: 'flowerplus6', x: 26, y: 43 },
  { id: 'flowerplus7', x: 31, y: 44 }, // was (28,42) -- ~2.2 tiles from flowerplus6
  { id: 'flowerplus8', x: 37, y: 39 }, // was (40,40) -- ~2.2 tiles from flowerplus1
];

// Palm positions. Found by searching for spots whose full 8x12 box is on land
// and clear of every structure and the garden — see scripts/place-palms.mjs.
const PALM_SPOTS = [
  { id: 'palm1', x: 15, y: 21 },
  { id: 'palm2', x: 55, y: 22 },
  { id: 'palm3', x: 61, y: 42 },
  { id: 'palm4', x: 8, y: 50 },
  { id: 'palm5', x: 30, y: 66 }, // moved off (33,71): the new statue now sits there
];

const STRUCT_ENTS_BASE: Ent[] = [
  // THE CLIFF, directly below the cottage — the house now stands at the top of
  // a drop instead of in open meadow. Listed FIRST, under everything that
  // stands on it.
  //
  // Position: the art is 18.7 tiles wide against the cottage's 7.35, and x 22
  // centres it (22 + 18.7/2 = 31.4) on the house's own centre (31.5). y 42 puts
  // the grass crown's top edge at the foot of the front stairs (which end at
  // y 41.3), so the two surfaces meet with no gap of plain meadow between them
  // — the sparse tufts along the crown's first few rows blend it into the
  // ground either side rather than ending on a hard line.
  //
  // Collision removed on purpose (per user request) — the rock face below
  // the grass crown no longer blocks; the player can walk straight through/
  // over the whole cliff now. Visual art (sprite/colors/palette) is
  // unchanged, only solidMask. Same noCollide() pattern already used for
  // the garden bed just below. It is not `interactable` — pure landscape,
  // nothing to click.
  {
    id: 'cliff',
    kind: 'cliff',
    x: 22,
    y: 42,
    sprite: S.CLIFF,
    colors: S.CLIFF_COLORS,
    palette: S.CLIFF_PALETTE,
    scale: CLIFF_SCALE,
    interactable: false,
    solidMask: noCollide(S.CLIFF),
  },
  // The fenced garden plot. Listed near the top, under the things that stand on
  // it. Its position is farm.ts's GARDEN_HOME, which a move saved by the world
  // editor (src/data/world.json) overrides.
  // Never solid on its own — the fence collider is farm.ts's gardenBlocks, so
  // this carries a blank mask to stop the glyphs blocking a second time.
  {
    id: 'garden-bed',
    kind: 'gardenbed',
    x: GARDEN.x0,
    y: GARDEN.y0,
    sprite: S.GARDEN_BED,
    colors: S.GARDEN_BED_COLORS,
    palette: S.GARDEN_BED_PALETTE,
    scale: GARDEN_BED_SCALE,
    interactable: false,
    solidMask: noCollide(S.GARDEN_BED),
  },
  // ── main elements — the ones you'll relocate most ──
  // buildings carry a value-tier colour grid (roof / wall / lit) so they read
  // as mass instead of wireframe — see the ARCHITECTURE note in sprites.ts
  // ONE sprite for the whole cottage — roof, walls, windows, clothesline,
  // porch chair, deck and stairs, all baked together from
  // house_simplified.svg's own 41x52 glyph grid (see sprites.ts). Its x/y
  // anchor that grid's (0,0): master cell (col,row) sits at world
  // (27.85 + col*0.18, 32 + row*0.18) — 0.18 = HOUSE_SCALE/2, same derivation
  // as the old house_taller.svg anchor formula, just this art's own
  // coefficient — which is what every hotspot below is positioned against.
  // Collision is feet-only (S.HOUSE_SOLID is blank over the deck+stairs, solid
  // above it), same treatment as the old house's deck — see blocked() in
  // App.tsx.
  //
  // Not interactable itself — clicking the building anywhere would open
  // whatever it resolved to for every pixel of roof and wall, which is why
  // each thing you can actually do lives in its own hotspot below instead.
  {
    id: 'house',
    kind: 'house',
    x: 27.85,
    y: 32,
    sprite: S.HOUSE,
    interactable: false,
    palette: S.HOUSE_PALETTE,
    colors: S.HOUSE_COLORS,
    scale: HOUSE_SCALE,
    solidMask: S.HOUSE_SOLID,
  },
  // The stone blocks flanking the stairs block through the house's own
  // collider (world.json's colliders.house), so the editor can paint them.
  // An invisible hit-box over the house picture's front door (the master-grid
  // cells from house_simplified_regions.json, run through the anchor formula
  // above). It never blocks movement (blocked() skips 'hotspot').
  ...(
    [
      // front_door region (house_simplified_regions.json): cols[23,30] rows[30,40]
      { id: 'house-door', col: 23, row: 30, w: 8, h: 11 },
    ] as const
  ).map(({ id, col, row, w, h }) => ({
    id,
    kind: 'hotspot' as const,
    x: 27.85 + col * 0.18,
    y: 32 + row * 0.18,
    sprite: hotspotSprite(w, h),
    interactable: true,
    scale: HOUSE_SCALE,
    solidMask: noCollide(hotspotSprite(w, h)),
  })),
  {
    id: 'shop',
    kind: 'shop',
    x: 40,
    // its base row stays on row 38, where the old hand-typed shop stood
    y: 31,
    sprite: S.SHOP,
    interactable: true,
    palette: S.SHOP_PALETTE,
    colors: S.SHOP_COLORS,
    scale: SHOP_SCALE,
    solidMask: S.SHOP_SOLID,
  },
  // Tufts of grass scattered near where the fern used to be — pure scenery
  // (no [F] prompt). Hand-transcribed from a glyph-art reference, not
  // generated — see GRASS_HALM in sprites.ts.
  ...GRASS_SPOTS.map((p) => ({
    ...p,
    kind: 'grasshalm' as const,
    sprite: S.GRASS_HALM,
    interactable: false,
    palette: S.GRASS_HALM_PALETTE,
    colors: S.GRASS_HALM_COLORS,
    scale: GRASS_SCALE,
    solidMask: noCollide(S.GRASS_HALM),
  })),
  // Tiny pixel-art flowers scattered among the grass — collectable: [F]
  // picks one, adding to the SAME 'flower' inventory/sell slot as any other
  // wildflower (see COLLECT_AS in App.tsx). Hand-transcribed from a
  // pixel-art reference — see FLOWER_PLUS in sprites.ts. Picked ones
  // reappear at the next growth-window rollover, same as every other
  // collectable — see the `removed` pruning in App.tsx's growth-window
  // effect (their plain `flowerplusN` ids never match a window-tagged id,
  // so they fall out of the `removed` set — and back onto the map — the
  // very first time the window turns over after being picked).
  ...FLOWER_SPOTS.map((p) => ({
    ...p,
    kind: 'flowerplus' as const,
    sprite: S.FLOWER_PLUS,
    interactable: true,
    palette: S.FLOWER_PLUS_PALETTE,
    colors: S.FLOWER_PLUS_COLORS,
    scale: FLOWER_PLUS_SCALE,
    solidMask: noCollide(S.FLOWER_PLUS),
  })),
  {
    id: 'cat',
    kind: 'cat',
    x: 35,
    y: 33,
    sprite: S.MITCHY,
    colors: S.MITCHY_COLORS,
    palette: S.MITCHY_PALETTE,
    // sized against the player's scale (see MITCHY_SCALE), so the two stay
    // in proportion whatever the resolution of his reference art
    scale: MITCHY_SCALE,
    interactable: true,
  },
  // ── trees (decorative scatter) ──
  // Date palms — shake one and it drops dates. These are 8x12 TILES, well
  // past the apple tree's 3x4 footprint, so they could not stay where the
  // apple trees stood: palm1 would have covered the house and palm2 the shop.
  // Positions below are re-placed clear of every structure, the garden and the
  // water. Per request, the crown's leaves don't block movement — only the
  // trunk and the hanging date bundles do — via S.PALM_SOLID (see
  // entityBlocksTile and toSolidMask in scripts/lib/palm.mjs).
  ...PALM_SPOTS.map((p) => ({
    ...p,
    kind: 'palm' as const,
    sprite: S.PALM,
    interactable: true,
    palette: S.PALM_PALETTE,
    colors: S.PALM_COLORS,
    scale: PALM_SCALE,
    solidMask: S.PALM_SOLID,
  })),
  // The leftover emptyTree scatter (etree1-11, TREE2/TREE3 sprites) was
  // removed — the date palms above are the only trees on the island now.
  // The Olmec statue (olmec1), the procedural waterfall garden and the old
  // arch bridge were removed too — the pond and the SVG-transcribed bridge
  // (both placed via the world editor, see src/data/world.json) now
  // stand in for that whole corner of the map.
];

// ═══ THE WORLD EDITOR'S FILE — src/data/world.json ═══
// Everything the in-game world editor (src/editor/, dev only, press E)
// changes is saved to this ONE file, and applied here once, at load:
//
//   STRUCT_ENTS = STRUCT_ENTS_BASE, with `moved` positions/scales applied,
//                 minus `removed`, plus `added` (resolved by asset slug
//                 through src/assets.ts), with `colliders` painted per asset.
//
// The game build reads exactly what was committed; nothing here depends on
// the editor, which never ships.
export interface WorldPose {
  x: number;
  y: number;
  scale?: number;
  rotation?: 0 | 1 | 2 | 3;
  look?: ColorLook;
}
// An object's colours, set in the world editor's inspector: saturation and
// brightness in % (100 = as drawn), tint a turn of the hue in degrees.
export interface ColorLook {
  sat?: number;
  bright?: number;
  tint?: number;
}
// only what differs from the drawing; nothing left = no look at all
export function cleanLook(l?: ColorLook): ColorLook | undefined {
  if (!l) return undefined;
  const out: ColorLook = {};
  if (l.sat !== undefined && Math.round(l.sat) !== 100) out.sat = Math.round(l.sat);
  if (l.bright !== undefined && Math.round(l.bright) !== 100) out.bright = Math.round(l.bright);
  if (l.tint !== undefined && Math.round(l.tint) !== 0) out.tint = Math.round(l.tint);
  return Object.keys(out).length ? out : undefined;
}
// a palette with the look applied (one per palette and look)
const lookCache = new WeakMap<Record<string, string>, Map<string, Record<string, string>>>();
export function lookPalette(pal: Record<string, string>, look: ColorLook): Record<string, string> {
  let m = lookCache.get(pal);
  if (!m) lookCache.set(pal, (m = new Map()));
  const key = JSON.stringify(look);
  let out = m.get(key);
  if (out) return out;
  const sat = (look.sat ?? 100) / 100;
  const bright = (look.bright ?? 100) / 100;
  const tint = look.tint ?? 0;
  out = {};
  for (const [k, hex] of Object.entries(pal)) {
    const v = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!v) {
      out[k] = hex;
      continue;
    }
    const n = parseInt(v[1], 16);
    let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    // to HSL, turn the hue, scale the saturation, back
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    h = (((h + tint) % 360) + 360) % 360;
    s = Math.min(1, s * sat);
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m0 = l - c / 2;
    [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const to = (u: number) => Math.round(Math.min(1, Math.max(0, (u + m0) * bright)) * 255).toString(16).padStart(2, '0');
    out[k] = `#${to(r)}${to(g)}${to(b)}`;
  }
  m.set(key, out);
  return out;
}
export interface WorldAdded extends WorldPose {
  id: string;
  asset: string;
  kind?: EntityKind; // default: the asset's kind
  interactable?: boolean; // default: the asset's
  // drawn on the start screen only, never in the game (the editor's Start
  // screen tab places these)
  startOnly?: true;
  // a sign made of parts (an asset with `layers`, the wayfinder): which way
  // each board points and how it's tilted, and the whole sign flipped
  sign?: SignSettings;
}
// The start screen's layout (the editor's Start screen tab): the live view of
// the island behind the title, the player standing in it, and the title +
// buttons column.
export interface StartScreenDoc {
  view: { x: number; y: number }; // the tile the camera centres on
  zoom?: number; // 1 = the game's view; >1 closer, <1 wider
  player: { x: number; y: number; scale?: number }; // where the player stands (tiles) and its size (1 = as in the game)
  // the subtitle + buttons: its left edge and vertical centre, as fractions
  // of the screen, and a size multiplier
  ui?: { x: number; y: number; scale?: number };
  // the title image (public/start-title.png, uploaded in the editor): its
  // centre as fractions of the screen, its width as a fraction of the
  // screen's width, a turn in degrees, its height / width, and a version
  // that changes with every upload (so browsers fetch the new picture)
  title?: { x: number; y: number; width?: number; rotation?: number; aspect?: number; v?: string };
  // the subtitle under the title: its centre as fractions of the screen, its
  // font size in px on a 1920-wide screen (it scales with the window), and
  // its words
  subtitle?: { x: number; y: number; size?: number; text?: string };
}
export interface StartScreen {
  view: { x: number; y: number };
  zoom: number;
  player: { x: number; y: number; scale: number };
  ui: { x: number; y: number; scale: number };
  title: { x: number; y: number; width: number; rotation: number; aspect: number; v: string };
  subtitle: { x: number; y: number; size: number; text: string };
}
export const START_SCREEN_DEFAULT: StartScreen = {
  view: { x: 68, y: 58 },
  zoom: 1,
  player: { x: 72, y: 61, scale: 1 },
  ui: { x: 0.09, y: 0.62, scale: 1 },
  title: { x: 0.22, y: 0.235, width: 0.27, rotation: 0, aspect: 0.507, v: '' },
  subtitle: { x: 0.2, y: 0.43, size: 13, text: 'a tiny monochrome bay' },
};
// where the title image is served from (public/), with its upload version
export const START_TITLE_FILE = 'start-title.png';
export const startTitleUrl = (t: StartScreen['title']) => `/${START_TITLE_FILE}${t.v ? `?v=${t.v}` : ''}`;
export function startScreenOf(doc: WorldDoc): StartScreen {
  const s = doc.startScreen;
  const d = START_SCREEN_DEFAULT;
  return {
    view: s?.view ?? d.view,
    zoom: s?.zoom ?? d.zoom,
    player: { x: s?.player?.x ?? d.player.x, y: s?.player?.y ?? d.player.y, scale: s?.player?.scale ?? d.player.scale },
    ui: { x: s?.ui?.x ?? d.ui.x, y: s?.ui?.y ?? d.ui.y, scale: s?.ui?.scale ?? d.ui.scale },
    title: { ...d.title, ...s?.title },
    subtitle: { ...d.subtitle, ...s?.subtitle },
  };
}
// The game's design view (world ch x lines), fitted to any screen with a
// COVER rule - see Game's dims in App.tsx. The start screen uses the same.
export const VIEW_W = 112;
export const VIEW_H = 40;
// how much of the world (ch x lines) a w x h px screen shows, at a zoom
export function coverView(w: number, h: number, charW: number, lineH: number, zoom = 1) {
  const scale = Math.max(w / (VIEW_W * charW), h / (VIEW_H * lineH));
  return { scale, viewW: w / scale / charW / zoom, viewH: h / scale / lineH / zoom };
}
// Follow a focus point, clamped to the map edges. When the viewport is LARGER
// than the map on an axis (possible on very wide/short screens), there's
// nothing to scroll — centre the map on that axis instead of letting the
// clamp go negative and shove it against one side.
export const clampCam = (focus: number, view: number, ground: number) =>
  view >= ground ? (ground - view) / 2 : Math.min(Math.max(focus - view / 2, 0), ground - view);
// The start screen's frame on the map (world ch / lines), as a screen of the
// given size shows it - the editor passes this browser window's size, which
// is what the start screen fills - with the view, the subtitle + buttons
// column and the title image in it. The column is laid out for a 1920-wide
// screen (START_UI_PX at scale 1) and scales with the screen's width, like
// the title. Shared by the editor's Start screen tab (drawing and dragging)
// and the start screen itself.
export const START_REF = { w: 1920, h: 1080 };
export const START_UI_PX = { w: 300, h: 197 };
// the subtitle's letters: a monospace glyph (0.6em) plus its letter spacing
// (0.23em, START_SUB_SPACING), and its line height
export const START_SUB_SPACING = 0.23;
export const startSubtitleBox = (ss: StartScreen, screenW: number) => {
  const px = ss.subtitle.size * (screenW / START_REF.w);
  return { px, w: ss.subtitle.text.length * px * (0.6 + START_SUB_SPACING), h: px * 1.3 };
};
export function startScreenSize(): { w: number; h: number } {
  return typeof window === 'undefined' ? START_REF : { w: window.innerWidth, h: window.innerHeight };
}
// the column's scale on a screen this wide
export const startUiScale = (ss: StartScreen, screenW: number) => ss.ui.scale * (screenW / START_REF.w);
export function startFrame(ss: StartScreen, scr: { w: number; h: number } = startScreenSize()) {
  // the field's cell (14px font, a 0.6em glyph): only its aspect matters here
  const { viewW, viewH } = coverView(scr.w, scr.h, 8.4, 14, ss.zoom);
  const x = clampCam(ss.view.x * TILE_CH, viewW, GROUND_W);
  const y = clampCam(ss.view.y * TILE_LN, viewH, GROUND_H);
  // screen px -> ch / lines
  const kx = viewW / scr.w;
  const ky = viewH / scr.h;
  const k = startUiScale(ss, scr.w);
  const uw = START_UI_PX.w * k * kx;
  const uh = START_UI_PX.h * k * ky;
  // the title: its width is a share of the screen's, its height follows the
  // picture
  const twPx = ss.title.width * scr.w;
  return {
    x,
    y,
    w: viewW,
    h: viewH,
    ui: { x: x + ss.ui.x * viewW, y: y + ss.ui.y * viewH - uh / 2, w: uw, h: uh },
    title: { cx: x + ss.title.x * viewW, cy: y + ss.title.y * viewH, w: twPx * kx, h: twPx * ss.title.aspect * ky },
    sub: (() => {
      const b = startSubtitleBox(ss, scr.w);
      return { cx: x + ss.subtitle.x * viewW, cy: y + ss.subtitle.y * viewH, w: b.w * kx, h: b.h * ky, px: b.px * kx };
    })(),
  };
}
// The player on the start screen: mid-step in the walk-down cycle (as if
// about to step into the game), sized like the game's walking player; its box
// on the map (ch x lines) from its tile's top-left
export const START_PLAYER_FRAME = S.WALK_DOWN_FRAMES[1];
export const START_PLAYER_K = (PLAYER_SCALE * S.PLAYER.length) / (START_PLAYER_FRAME.sprite.length - S.WALK_DOWN_PAD_TOP);
// the editor's size slider on top of that
export const startPlayerK = (ss: StartScreen) => START_PLAYER_K * ss.player.scale;
export const startPlayerBox = (ss: StartScreen) => ({
  w: startPlayerK(ss) * Math.max(...START_PLAYER_FRAME.sprite.map((l) => l.length)),
  h: startPlayerK(ss) * START_PLAYER_FRAME.sprite.length,
});
// A collider box drawn in the world editor's Colliders tab, in tiles (any
// quarter): it blocks every tile it overlaps where the player's feet would
// land, like the painted map tiles. With an owner its x/y are from that
// object's x/y, so it moves with it (a box over the house door).
export interface ColliderBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  owner?: string;
}
// the boxes where they stand on the map (an owner's live position)
export function placedBoxes(doc: WorldDoc, ents: readonly { id: string; x: number; y: number }[]): ColliderBox[] {
  const out: ColliderBox[] = [];
  for (const b of doc.colliderBoxes ?? []) {
    if (!b.owner) {
      out.push(b);
      continue;
    }
    const o = ents.find((e) => e.id === b.owner);
    if (o) out.push({ ...b, x: o.x + b.x, y: o.y + b.y });
  }
  return out;
}
// does the box cover any part of tile (tx, ty)? (an edge on the tile's
// border doesn't count)
export function boxBlocksTile(b: ColliderBox, tx: number, ty: number): boolean {
  return b.x < tx + 1 && b.x + b.w > tx && b.y < ty + 1 && b.y + b.h > ty;
}

export interface WorldDoc {
  version: 2;
  moved: Record<string, WorldPose>; // built-in (STRUCT_ENTS_BASE) objects, by id
  removed: string[]; // built-in ids
  added: WorldAdded[];
  colliders: Record<string, string[]>; // asset slug -> solid mask, the sprite's shape
  // Single map tiles that block on their own ("x,y"), painted anywhere in the
  // editor's Colliders tab — an invisible wall, independent of any object.
  // Like the buildings, they stop the player's feet.
  blockedTiles?: string[];
  // Collider boxes drawn in the editor's Colliders tab (see ColliderBox).
  colliderBoxes?: ColliderBox[];
  // Mitchy's look: the slug of an asset of kind 'cat' (src/data/assets/),
  // chosen in the editor's Assets tab. Absent = his original art ('mitchy').
  mitchyLook?: string;
  startScreen?: StartScreenDoc;
  // islands moved in the editor's Islands tab (by index, whole tiles)
  islands?: IslandOffsets;
}

export const WORLD_DOC: WorldDoc = worldDocData as unknown as WorldDoc;

// ---- Mitchy's look ----
// One Mitchy, many possible looks: the world's cat entity, his portraits
// (chat panels, map, menus) and his map marker all draw the chosen art.
export interface MitchyLook {
  slug: string; // 'mitchy' = the original
  art: S.MitchyArt;
  scale: number;
}
export function mitchyLookOf(slug: string | undefined): MitchyLook {
  const def = slug && slug !== 'mitchy' ? assetOf(slug) : undefined;
  if (def && def.kind === 'cat' && def.colors && def.palette) {
    const art = { sprite: def.sprite, colors: def.colors, palette: def.palette, headRows: def.headRows ?? Math.ceil(def.sprite.length * 0.6) };
    return { slug: def.slug, art, scale: mitchyScaleFor(def.sprite.length) };
  }
  return { slug: 'mitchy', art: S.MITCHY_ORIGINAL, scale: mitchyScaleFor(S.MITCHY_ORIGINAL.sprite.length) };
}
// Make `slug` his look everywhere (the game at load; the editor live)
export function applyMitchyLook(slug: string | undefined): void {
  const look = mitchyLookOf(slug);
  MITCHY_SCALE = look.scale;
  MITCHY_T = spriteTiles(look.art.sprite, look.scale);
  S.setMitchyArt(look.art);
}
applyMitchyLook(WORLD_DOC.mitchyLook);

// The built-in objects, with the registry slug each one draws.
export const BASE_ENTS: readonly Ent[] = STRUCT_ENTS_BASE.map((e) =>
  ASSET_OF_KIND[e.kind] ? { ...e, asset: ASSET_OF_KIND[e.kind] } : e,
);
const BASE_HOUSE = BASE_ENTS.find((e) => e.id === 'house');

// A painted collider applies while it still has the art's row count; each row
// is fitted to its sprite row (padded with blanks or cut), because some baked
// masks (house.json, cliff.json) are a little narrower than their art. A
// redrawn sprite of a different height falls back to its default collider
// rather than blocking the wrong cells.
export function fitMask(mask: string[], sprite: string[]): string[] {
  return sprite.map((row, i) => (mask[i] ?? '').padEnd(row.length, ' ').slice(0, row.length));
}
function colliderFor(doc: WorldDoc, asset: string | undefined, sprite: string[]): string[] | undefined {
  const m = asset ? doc.colliders[asset] : undefined;
  if (!m || m.length !== sprite.length) return undefined;
  return fitMask(m, sprite);
}

// which: 'world' = what the game has (no start-screen-only objects), 'start'
// = only those, 'all' = both (the editor, while it's open)
export function buildStructEnts(doc: WorldDoc, which: 'world' | 'start' | 'all' = 'world'): Ent[] {
  const removed = new Set(doc.removed);
  const house = doc.moved.house;
  const out: Ent[] = [];
  for (const base of which === 'start' ? [] : BASE_ENTS) {
    if (removed.has(base.id)) continue;
    let e: Ent = base;
    if (base.id === 'cat') {
      // his chosen look (keeps any moved pose; the scale follows the art)
      const look = mitchyLookOf(doc.mitchyLook);
      e = { ...e, asset: look.slug, sprite: look.art.sprite, colors: look.art.colors, palette: look.art.palette, scale: look.scale };
    }
    const own = doc.moved[base.id];
    if (own) {
      e = { ...e, ...own, ...(base.id === 'cat' ? { scale: e.scale } : {}) };
    } else if (house && BASE_HOUSE && base.id.startsWith('house-')) {
      // The house's clickable hotspots and stair blockers are pinned to its
      // picture: they follow its move and scale.
      const k = (house.scale ?? BASE_HOUSE.scale ?? 1) / (BASE_HOUSE.scale ?? 1);
      e = {
        ...e,
        x: house.x + (base.x - BASE_HOUSE.x) * k,
        y: house.y + (base.y - BASE_HOUSE.y) * k,
        scale: (base.scale ?? 1) * k,
      };
    }
    if (own?.look && e.palette) e = { ...e, palette: lookPalette(e.palette, own.look) };
    const painted = colliderFor(doc, e.asset, e.sprite);
    out.push(painted ? { ...e, solidMask: painted } : e);
  }
  for (const a of doc.added) {
    if (which === 'world' ? a.startOnly : which === 'start' && !a.startOnly) continue;
    const def = assetOf(a.asset);
    // a sign of parts: drawn for this placement's settings
    const art = def?.layers && a.sign ? signArt(def.layers, a.sign) : null;
    if (!def) {
      if (import.meta.env.DEV) console.warn(`[world] "${a.id}" uses unknown asset "${a.asset}" — skipped`);
      continue;
    }
    out.push({
      id: a.id,
      kind: a.kind ?? def.kind,
      asset: def.slug,
      x: a.x,
      y: a.y,
      sprite: art ? art.sprite : def.sprite,
      colors: art ? art.colors : def.colors,
      palette: a.look && def.palette ? lookPalette(def.palette, a.look) : def.palette,
      sway: def.sway,
      blend: def.blend,
      scale: a.scale ?? def.scale,
      rotation: a.rotation,
      interactable: a.interactable ?? def.interactable,
      solidMask: colliderFor(doc, def.slug, def.sprite) ?? def.solid,
      ...(a.startOnly ? { startOnly: true as const } : {}),
    });
  }
  return out;
}

// The array every other module imports: the world as saved.
export const STRUCT_ENTS: Ent[] = buildStructEnts(WORLD_DOC);
// The objects only the start screen draws.
export const START_ONLY_ENTS: Ent[] = buildStructEnts(WORLD_DOC, 'start');

// The structures as they stand RIGHT NOW: STRUCT_ENTS, except while the world
// editor is changing them. Read by what's derived from the layout rather than
// drawn from it — the ground glyphs kept clear around each object, the
// terrain's bushes, where wild flora may sprout — so an edit shows the ground
// the way the saved file will. Only the editor ever sets it.
let liveStruct: Ent[] = STRUCT_ENTS;
export function liveStructEnts(): Ent[] {
  return liveStruct;
}
export function setLiveStructEnts(ents: Ent[]): void {
  liveStruct = ents;
}

// Dev-only sanity check for the hand-placed layout above: warns (never throws)
// if a piece runs off the map, sits on water, or if two solid buildings
// overlap. Keeps "just edit the numbers" relocation safe — mistakes show up in
// the console the moment you reload. Stripped from production builds.
function validateLayout(ents: Ent[]): void {
  for (const e of ents) {
    const { wT, hT } = spriteTiles(e.sprite, e.scale);
    if (e.x < 0 || e.y < 0 || e.x + wT > MAP_W || e.y + hT > MAP_H) {
      console.warn(`[layout] "${e.id}" runs off the map at (${e.x},${e.y}) — size ${wT}x${hT} tiles`);
    }
    let onWater = false;
    for (let ty = e.y; ty < e.y + hT && !onWater; ty++) {
      for (let tx = e.x; tx < e.x + wT; tx++) {
        if (isWater(tx, ty)) {
          onWater = true;
          break;
        }
      }
    }
    if (onWater) console.warn(`[layout] "${e.id}" overlaps water at (${e.x},${e.y})`);
    // a hand-written colours grid must line up with its art cell-for-cell —
    // a row that's short silently drops the tint off the end of that line
    if (e.colors) {
      for (let i = 0; i < e.sprite.length; i++) {
        const cw = e.colors[i]?.length ?? -1;
        if (cw !== e.sprite[i].length) {
          console.warn(
            `[layout] "${e.id}" colours row ${i} is ${cw} chars, art is ${e.sprite[i].length}`,
          );
        }
      }
    }
  }
  // building-vs-building overlap (uses the same collision boxes the player does)
  const solids = ents.filter((e) => e.kind === 'house' || e.kind === 'shop');
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (tileBoxesOverlap(collisionBox(solids[i]), collisionBox(solids[j]))) {
        console.warn(`[layout] "${solids[i].id}" overlaps "${solids[j].id}"`);
      }
    }
  }
}

if (import.meta.env.DEV) validateLayout(STRUCT_ENTS);

// Wild spawns regenerate deterministically per growth window: same window →
// same layout. Each land region has its own spawn pool, so what you find
// depends on where you explore. Ocean/beach never spawn flora.
type SpawnRegion = 'meadow' | 'desert' | 'jungle' | 'tundra' | 'rocky';

// Wild flora/stone scatter was cleared island-wide — the date palms (in
// STRUCT_ENTS, a separate hand-placed system) are the only flora left.
const REGION_POOL: Record<SpawnRegion, { kind: EntityKind; sprite: string[]; count: number }[]> = {
  meadow: [],
  desert: [],
  jungle: [],
  tundra: [],
  rocky: [],
};

// `garden` is passed in rather than read from the GARDEN constant so a bed the
// dev layout tool has dragged still keeps wild flora out of where it actually
// IS. Defaults to its home corner, which is all the game itself ever needs.
export function wildSpawns(window: number, garden: TileBox = GARDEN): Ent[] {
  const rnd = mulberry32((window | 0) * 7919 + 23);
  // Reserve the FULL box of every structure (so nothing sprouts over a tree
  // canopy or roof, not just its base row) plus the whole garden plot with a
  // one-tile margin (so no wild flora crowds the planting beds).
  const taken: TileBox[] = [
    ...liveStruct.map((e) => bbox(e)),
    { x0: garden.x0 - 1, y0: garden.y0 - 1, x1: garden.x1 + 1, y1: garden.y1 + 1 },
  ];
  const out: Ent[] = [];
  for (const region of Object.keys(REGION_POOL) as SpawnRegion[]) {
    for (const { kind, sprite, count } of REGION_POOL[region]) {
      const { wT, hT } = spriteTiles(sprite);
      for (let i = 0; i < count; i++) {
        // rejection sampling: keep rolling spots until one lands in the right
        // region (never ocean) and its whole box is clear of everything placed
        for (let attempt = 0; attempt < 80; attempt++) {
          const x = Math.floor(rnd() * (MAP_W - wT));
          const y = Math.floor(rnd() * (MAP_H - hT));
          if (regionAt(x + Math.floor(wT / 2), y + Math.floor(hT / 2)) !== region) continue;
          const b = bbox({ x, y, sprite });
          if (taken.some((t) => tileBoxesOverlap(t, b))) continue;
          taken.push(b);
          out.push({ id: `${kind}-${region}-${window}-${i}`, kind, x, y, sprite, interactable: true });
          break;
        }
      }
    }
  }
  return out;
}

// The player starts beside their house, on land. (23,32) sits well clear of
// the house's box (28-33,32-39) and everything else in STRUCT_ENTS, with
// enough margin to absorb PLAYER_SCALE changes without landing on the house.
export const PLAYER_SPAWN = { x: 31, y: 25 };

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Ground rendering itself lives in terrain.ts / TerrainCanvas.tsx; this keeps
// the gameplay-side mask of where ground glyphs must not be drawn.
// ---------------------------------------------------------------------------

// Character cells covered by these entities' glyph silhouettes, one byte
// per cell of the GROUND_W x GROUND_H ground grid: every sprite row from its
// first to its last glyph (so nothing shines through the gaps inside a
// canopy or trunk) plus `margin` cells around it. Replaces the entity's
// whole rectangular tile box, which left a bare square around every palm.
export function silhouetteMask(
  ents: Iterable<Pick<Ent, 'x' | 'y' | 'sprite' | 'scale' | 'rotation'>>,
  margin = 1,
  mask = new Uint8Array(GROUND_W * GROUND_H),
): Uint8Array {
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    const ax = Math.max(0, x0);
    const bx = Math.min(GROUND_W - 1, x1);
    if (bx < ax) return;
    for (let y = Math.max(0, y0); y <= Math.min(GROUND_H - 1, y1); y++) {
      mask.fill(1, y * GROUND_W + ax, y * GROUND_W + bx + 1);
    }
  };
  const m = margin;
  for (const e of ents) {
    if (e.rotation) {
      // rotated sprites no longer map row-for-row: use their box
      const b = bbox(e);
      fill(b.x0 * TILE_CH - m, b.y0 * TILE_LN - m, (b.x1 + 1) * TILE_CH - 1 + m, (b.y1 + 1) * TILE_LN - 1 + m);
      continue;
    }
    // a sprite drawn at scale k covers cols*k x rows*k cells from its tile's
    // top-left (App.tsx pivots the shrink so this corner stays put)
    const k = e.scale ?? 1;
    const ox = e.x * TILE_CH;
    const oy = e.y * TILE_LN;
    e.sprite.forEach((line, r) => {
      const first = line.search(/\S/);
      if (first < 0) return;
      const last = line.trimEnd().length - 1;
      fill(
        Math.floor(ox + first * k) - m,
        Math.floor(oy + r * k) - m,
        Math.ceil(ox + (last + 1) * k) - 1 + m,
        Math.ceil(oy + (r + 1) * k) - 1 + m,
      );
    });
  }
  return mask;
}

// Cells the ground glyphs must stay off: the structures' and this growth
// window's wild flora's silhouettes (1-cell margin), plus the garden plot.
export function grassKeepOut(window: number): Uint8Array {
  const mask = silhouetteMask([...liveStruct, ...wildSpawns(window)], 1);
  const g = GARDEN;
  for (let y = g.y0 * TILE_LN; y < (g.y1 + 1) * TILE_LN; y++) {
    mask.fill(1, y * GROUND_W + g.x0 * TILE_CH, y * GROUND_W + (g.x1 + 1) * TILE_CH);
  }
  return mask;
}

// ===========================================================================
// WATER — the drawing now lives in terrain.ts / TerrainCanvas.tsx. What stays
// here is shared config: OCEAN_CFG (the caustic drift, read by terrain.ts)
// and the shoreline constants behind isFoamZone (gameplay placement rules).
// ===========================================================================

// ---------------------------------------------------------------------------
// UNITS used by the water knobs below — three different ones, don't mix them:
//
//   nd    the islandNd() field: >1 ocean, =1 the waterline, <1 inland. This is
//         the unit for every shore distance (reach/depth/thickness), because
//         it follows the wobbly coastline automatically all the way around.
//         Near the coast the field changes ~0.025 nd per TILE, so:
//             0.025 nd ≈ 1 tile ≈ 4 chars across (x) / 2 lines down (y)
//         e.g. pushReach 0.045 ≈ 1.8 tiles ≈ 7 chars of climb up the sand.
//         (For scale: the player sprite is 7 chars x 3 lines.)
//
//   chars the raw character grid — the ground layer is GROUND_W x GROUND_H
//         chars (MAP_W*TILE_CH by MAP_H*TILE_LN). Only seedSpacing is in
//         chars. Because a char cell is ~2x taller than wide, the caustics
//         maths doubles y (DOUBLE_H) so its cells come out round, not squashed.
//
//   frames/ms  phases = how many frames the loop precomputes (higher =
//         smoother), *Ms = the interval between them (lower = faster).
//         One full loop lasts phases * intervalMs.
//
// Rendering note: entities/layers are positioned with `ch` horizontally and
// `em` vertically (line-height: 1), so 1 char = 1ch wide and 1 line = 1em
// tall — that is what keeps every layer locked to the same monospace grid.
// ---------------------------------------------------------------------------

// -- OPEN-OCEAN drift config -----------------------------------------------
// The water is a dense base lattice with caustic light drifting across it. The
// motion is SCROLLING NOISE: the sample offset advances forever and is never
// fed through a sine, so the surface always moves forward and never rewinds.
// (Sway that oscillates is right for a tree; on water it reads as a rewind.)
// THE REFERENCE SKETCH, REPLICATED, with three deliberate changes, each noted
// at the line that makes it: OCEAN_ZOOM magnifies the whole picture, the drift
// is raked over to a much shallower diagonal at half the speed (OCEAN_RAKE /
// DRIFT_Y), and field B's offset is scaled so both noise layers share one
// heading. The palette is ours; everything else — the band cutoffs, the noise
// frequencies' relationship, the glyphs — is the reference's verbatim.
//
// ===========================================================================
// THE FOUR KNOBS. All four are in units you can SEE, and none of them disturbs
// the others — change one and the rest hold. That matters because a character
// cell is not square (8.4px wide, 14px tall), so raw noise numbers do not mean
// what they look like: equal frequency per axis gives regions 1.67x TALLER
// than wide, and equal drift per axis gives motion 1.67x faster vertically.
// Every conversion below exists to cancel that out.
// ===========================================================================
const CELL_W = 8.4; // px, one character cell (must match dims in App.tsx)
const CELL_H = 14;
const ASPECT = CELL_H / CELL_W; // 1.667 — the correction factor everywhere below

// How magnified the whole picture is. 1 = the reference exactly.
const OCEAN_ZOOM = 2.5;
// Region shape, WIDTH : HEIGHT in screen pixels. 1 = round; above 1 = drawn out
// horizontally into broad flat bands. This is area-PRESERVING: stretching wider
// also flattens, so the regions keep the size OCEAN_ZOOM gave them and only
// change proportion.
const OCEAN_STRETCH = 2;
// Drift direction, HORIZONTAL : VERTICAL in screen pixels. 1 = a true 45°;
// above 1 rakes over toward a long shallow sweep.
const OCEAN_RAKE = 2;
// Drift speed, in screen PIXELS PER SECOND — total, along the diagonal.
// STAGE 3: halved from 50 — smooth (same OCEAN_MS frame rate), just slower
// travel per frame, so the open ocean reads as calm rather than reduced to
// a lower, jerkier fps.
const OCEAN_SPEED = 25;
const OCEAN_MS = 90; // reference: setInterval(..., 90)

// --- resolve the knobs into the noise-space numbers the sampler wants ---
// Stretch: sqrt so the two axes move apart symmetrically and the area is kept.
const _cellBase = 0.055 / OCEAN_ZOOM; // reference frequency, magnified
const _stretch = Math.sqrt(OCEAN_STRETCH * ASPECT);
const CELL_X = _cellBase / _stretch; // lower frequency across -> wider regions
const CELL_Y = _cellBase * _stretch; // higher frequency down  -> flatter regions

// Speed: split the total into screen components, then convert each back into
// noise units using ITS OWN cell size. Going via pixels is what makes the drift
// immune to OCEAN_STRETCH — change the region shape and the flow keeps its
// heading and speed.
const _framesPerSec = 1000 / OCEAN_MS;
const _vPxPerSec = OCEAN_SPEED / Math.hypot(OCEAN_RAKE, 1);
const _hPxPerSec = _vPxPerSec * OCEAN_RAKE;
const DRIFT_X = (_hPxPerSec / _framesPerSec) * (CELL_X / CELL_W);
const DRIFT_Y = (_vPxPerSec / _framesPerSec) * (CELL_Y / CELL_H);

export const OCEAN_CFG = {
  driftMs: OCEAN_MS,
  // Noise units per character — the wave's SCALE and SHAPE. Reference: nx and
  // ny both x*0.055, equal on both axes, which (given a tall character cell)
  // is what made its regions vertically elongated. These come from OCEAN_ZOOM
  // and OCEAN_STRETCH above; cellX is now the LOWER of the two, so regions run
  // wide and flat instead of tall.
  cellX: CELL_X,
  cellY: CELL_Y,
  // Drift is one-way and both offsets GROW. Sampling noise(p + offset) with the
  // offset growing makes a feature's apparent position decrease, so the water
  // travels UP and slightly LEFT. Never a sine, so it can never rewind — and
  // because the noise field is unbounded, water leaves the screen and
  // previously-unseen water arrives behind it, forever. There is no loop and
  // therefore no seam: that is why the caustics are built per frame rather than
  // precomputed into a cycle.
  //
  // Reference: scrollX = t*0.007, scrollY = t*0.010 — an oblique bottom-to-top
  // scroll, mostly upward with a leftward lean. In SCREEN terms that lean is
  // weak: because a cell is 8.4px wide but 14px tall, those numbers come out
  // 2.38x faster VERTICALLY than horizontally, so it reads as "up, tilted"
  // rather than as a real diagonal.
  //
  // Both values here come from OCEAN_RAKE and DRIFT_Y above — see the note
  // there. The flow is raked well past 45° now, so it sweeps across the water
  // much more than it climbs.
  driftX: DRIFT_X,
  driftY: DRIFT_Y,
  threshold: 0.1, // reference: causticVal > 0.46
  band: 0.54, //     reference: t2 = (causticVal - 0.46) / 0.54
  // SHARP, NON-UNIFORM band edges, as fractions of `band`. Deliberately not
  // four equal quarters: hard cutoffs make the water read as solid
  // high-contrast regions instead of a soft gradient, and the top tier — pure
  // white — gets only the last tenth, so the brightest highlight stays a small
  // accent rather than a fifth of the sea.
  cuts: [0.42, 0.7, 0.9],
  deepNd: 1.0, //    water beyond this nd gets the ocean (the shore keeps foam)
};

// -- SHORELINE surge config -------------------------------------------------
// The wave is sized to the PLAYER (~3 tiles wide, ~1.5 tall). One nd unit is
// roughly 40 tiles near the coast, so ~0.025 nd ≈ 1 tile: the reach/depth
// below give a gentle lap of a couple of tiles in and out — NOT a full
// retreat to deep water. Bump pushReach/pullDepth up together for bigger surf.
export const SHORE_CFG = {
  phases: 30, //     frame count for one push→hold→pull loop
  surgeMs: 220, //   ms between frames (loop ≈ phases*surgeMs)
  // STAGE 3 — GENTLER BREATHING: scaled to ~65% of the already-reduced
  // push/pull below (which itself was already "~60% of the original"), and
  // the foam bands thinned to match, so the shore laps quietly rather than
  // washing. Raise these together for bigger surf.
  pushReach: 0.0065, // climb up the sand
  pullDepth: 0.0135, // recede into the water
  pushFrac: 0.2, //  fraction of the loop spent pushing (fast)
  holdFrac: 0.1, //   fraction paused at max reach
  foamThickness: 0.008, // bright leading foam CREST, thinner than before
  // A second band riding just behind the crest, on the same waterline and
  // the same loop — so the foam reads as a band of surf with depth to it
  // rather than a single bright line. Sparser glyphs than the crest.
  foam2Thickness: 0.024, // trailing wash, thinner than before
  meshDepth: 0.018, //   lacy mesh behind the foam edge, thinner than before
  fingerAmp: 0.007, //   depth of the rounded finger lobes (nd), scaled with the
  //                     surge above so the edge stays proportionate
  fingerFreq: 16, //    number of finger lobes around the island
  fingerDrift: 0.1, //  how fast the lobes slide along the coast per loop
};

// STAGE 3: recentred from the literal nd=1 (the old gameplay waterline) onto
// COAST.outerSandEnd. The drawn foam now lives in terrain.ts; this range
// only backs isFoamZone below (placement rules), so it keeps its old bounds.
const SHORELINE_ND = COAST.outerSandEnd;
const ND_DEEP = SHORELINE_ND + SHORE_CFG.pullDepth; // fully-receded waterline
const ND_MAX = SHORELINE_ND - SHORE_CFG.pushReach; // fully-surged waterline (up the sand)
// Outer bound. It has to clear the FULL width of both foam bands measured from
// the most-receded waterline, or the trailing band would be cut off flat every
// time the wave pulled back.
const ND_HI =
  Math.max(OCEAN_CFG.deepNd, ND_DEEP + SHORE_CFG.foamThickness + SHORE_CFG.foam2Thickness) + 0.01;

// Is this tile ANYWHERE within the shoreline foam's animation range? The surge
// loop sweeps a tile between "dry sand" and "foam-covered" over time — a tile that reads as plain beach at this instant can
// still have foam wash over it a few seconds later. [ND_MAX, ND_HI] is the
// FULL possible range across one whole surge cycle, not just the current
// phase, so a placement check against this is safe regardless of tide timing.
export function isFoamZone(tx: number, ty: number): boolean {
  const nd = islandNd(tx, ty);
  return nd >= ND_MAX && nd <= ND_HI;
}
