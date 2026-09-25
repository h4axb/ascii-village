import * as S from './sprites';
import { GARDEN } from './farm';
import worldOverridesData from './data/worldOverrides.json';

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

export type ItemType = 'flower' | 'stone' | 'date' | 'cactus' | 'fern' | 'iceflower';
export type EntityKind =
  | ItemType
  | 'palm'
  | 'shop'
  | 'cat'
  | 'house'
  // An invisible interaction zone pinned over part of another sprite — the
  // clothesline garments, the chair and the front door are all painted INTO
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
const MAIN_ISLAND: IslandDef = { cx: 40, cy: 50, rx: 36, ry: 44 };

// New islands, smallest to largest, placed with a comfortable ocean gap (15+
// tiles) from the main island and from each other and from the map edges.
// Purely decorative landmasses for now — see the file-header note above.
const OTHER_ISLANDS: IslandDef[] = [
  { cx: 105, cy: 22, rx: 15, ry: 13 }, // NE — medium
  { cx: 112, cy: 60, rx: 9, ry: 8 }, // E — small
  { cx: 100, cy: 95, rx: 8, ry: 8 }, // SE — small
  { cx: 50, cy: 122, rx: 13, ry: 11 }, // S — medium
];

const ISLANDS: IslandDef[] = [MAIN_ISLAND, ...OTHER_ISLANDS];

// Signed distance-ish field from ONE island's centre: <1 inland, ≈1 the
// waterline, >1 open ocean. Same wobble on every island so they all read as
// the same hand.
function islandNdFor(isl: IslandDef, tx: number, ty: number): number {
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
    const nd = islandNdFor(ISLANDS[i], tx, ty);
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

// big region anchors — all on the MAIN island only
const VILLAGE = { x: 32, y: 30, r: 12 }; // home meadow, kept friendly
const VOLCANO = { x: 40, y: 54, r: 13 }; // central lava fields
const SUMMIT = { x: 40, y: 54, r: 4 }; // snow-capped peak on the volcano

export function regionAt(tx: number, ty: number): Region {
  const { nd, idx } = nearestIsland(tx, ty);
  if (nd > 1) return 'ocean';
  if (nd > 0.8) return 'beach'; // coastal sand ring, every island — widened further for a clearly readable band
  if (idx !== 0) return 'meadow'; // other islands: flat grass, no sub-biomes yet
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

export function visualTerrainAt(tx: number, ty: number): VisualTerrain {
  const nd = islandNd(tx, ty);
  if (nd < COAST.grassEdgeStart) return 'land';
  if (nd < COAST.landEdge) return 'grassEdge';
  if (nd < COAST.earthRimEnd) return 'earthRim';
  if (nd < COAST.sandEnd) return 'sand';
  if (nd < COAST.outerSandEnd) return 'outerSand';
  if (nd < COAST.shallowWaterEnd) return 'shallowWater';
  return 'ocean';
}

// Real background colours (a solid fill, not a glyph `color:`) — see
// CoastBackgroundLayer in App.tsx, which paints these into a per-tile canvas
// underneath every other ground/ocean layer.
export const VISUAL_TERRAIN_BG: Record<VisualTerrain, string> = {
  land: '#596649',
  grassEdge: '#596649', // same base as land; Stage 2 distinguishes it through dense glyphs
  earthRim: '#46513B', // dark desaturated olive-green (a shade of LAND #596649), not brown soil
  sand: '#E6D39B',
  outerSand: '#EEDCA9',
  shallowWater: '#8FC4C1',
  ocean: '#67A5AE',
};

function hexToRgbTuple(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// SAME stop colours as VISUAL_TERRAIN_BG above (nothing here changes a
// single hex) at the SAME COAST boundaries. Each band stays FLAT (its own
// solid colour, no blend) through its own calm middle — "where the colour
// is strongest, it stays" — and only blends smoothly within a NARROW window
// right at the seam between two bands. A full-width blend (tried first)
// diluted every band's own colour everywhere and, painted at full strength,
// buried the glyph sign layers that are supposed to carry the actual
// transition detail (see EDGE_BANDS in genLandLayers) — this keeps the
// background mostly the plain per-band fill, with just a soft seam, so the
// signs read on top of it instead of under a dominant wash.
// NOTE: earthRim is deliberately ABSENT from this list. It used to sit here
// as its own stop (grassEdge -> earthRim -> sand), which painted a real
// dark-green background band under the coastal edge no matter how much
// glyph texture sat on top of it. Per the terrain-glyph rework, the dark
// edge's colour now comes ONLY from the dense foreground glyph band (see
// EDGE_BANDS.rim / DARK_EDGE_HEAVY/LIGHT below) — the background just
// blends straight from grassEdge's green to sand's cream across the same
// nd span the rim used to occupy, so glyphs are the only thing that reads
// as dark there. VISUAL_TERRAIN_BG.earthRim / visualTerrainAt() keep
// classifying that ring as 'earthRim' (still useful elsewhere as a named
// nd range) — only its OWN background stop is gone.
const GRADIENT_STOPS: { nd: number; rgb: [number, number, number] }[] = [
  { nd: 0, rgb: hexToRgbTuple(VISUAL_TERRAIN_BG.land) },
  { nd: COAST.grassEdgeStart, rgb: hexToRgbTuple(VISUAL_TERRAIN_BG.grassEdge) },
  { nd: COAST.earthRimEnd, rgb: hexToRgbTuple(VISUAL_TERRAIN_BG.sand) },
  { nd: COAST.sandEnd, rgb: hexToRgbTuple(VISUAL_TERRAIN_BG.outerSand) },
  { nd: COAST.outerSandEnd, rgb: hexToRgbTuple(VISUAL_TERRAIN_BG.shallowWater) },
  { nd: COAST.shallowWaterEnd, rgb: hexToRgbTuple(VISUAL_TERRAIN_BG.ocean) },
  { nd: 2, rgb: hexToRgbTuple(VISUAL_TERRAIN_BG.ocean) },
];
// How much of a band's own nd-span, on EACH side, blends toward its
// neighbour — the rest of the band stays flat. Narrowed further (was 0.35):
// the background is meant to be the calm, mostly-flat fallback surface that
// only guarantees there's no empty cell showing through — the now-denser
// EDGE_BANDS glyph layers are what should actually carry the transition
// detail, not this canvas. 0.22 means the middle 56% of every band is pure,
// untouched colour.
const SEAM_BLEND_FRAC = 0.22;

// Accepts FRACTIONAL tile coordinates (not floored) — islandNd/nearestIsland
// underneath are plain arithmetic with no integer requirement, so calling
// this per CHARACTER (not per tile) gives a genuinely smooth field, not the
// same tile-rounded value repeated across every character inside one tile.
export function visualTerrainColorAt(fx: number, fy: number): [number, number, number] {
  const nd = islandNd(fx, fy);
  let i = 0;
  while (i < GRADIENT_STOPS.length - 2 && nd > GRADIENT_STOPS[i + 1].nd) i++;
  const a = GRADIENT_STOPS[i];
  const b = GRADIENT_STOPS[i + 1];
  const span = b.nd - a.nd;
  const mid = a.nd + span / 2;
  const seamHalf = span * SEAM_BLEND_FRAC;
  // Flat a.rgb until we're within seamHalf of the midpoint approaching b,
  // flat b.rgb once past it — only the narrow window around `mid` blends.
  let t: number;
  if (nd <= mid - seamHalf) t = 0;
  else if (nd >= mid + seamHalf) t = 1;
  else {
    const u = (nd - (mid - seamHalf)) / (seamHalf * 2); // 0..1 across the seam only
    t = u * u * (3 - 2 * u); // smoothstep, not linear — eases in/out of the seam
  }
  return [
    Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
    Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
    Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
  ];
}

export interface Ent {
  id: string;
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

// Crops a raw col/row rectangle straight out of the house's OWN sprite grid,
// for use as a blocker's collision shape instead of a plain filled
// rectangle (hotspotSprite) — entityBlocksTile tests per-cell glyph
// presence (tileHasGlyph), so a blank cell in this crop is genuinely
// walkable, not just decorative. This makes the collision "sign sensitive":
// it blocks exactly where the house is actually drawn in that rectangle,
// not a bigger blank box than what's really solid there. rawColEnd/
// rawRowEnd are inclusive, in the SOURCE's own raw units (house_simplified_
// regions.json's own col/row numbering) — columns get doubled here the same
// way the full house sprite already is.
function houseSlice(rawColStart: number, rawColEnd: number, rawRowStart: number, rawRowEnd: number): string[] {
  const dc0 = rawColStart * 2;
  const dc1 = rawColEnd * 2 + 1;
  return S.HOUSE.slice(rawRowStart, rawRowEnd + 1).map((row) => row.slice(dc0, dc1 + 1));
}

// The player's sprite (48x28 chars post-doubling, see sprites.ts — the
// straw-hat-still (1).svg reference) is far too big to draw at native size, hence
// the fractional scale below (tune to taste — see PLAYER_SPAWN just after,
// which stays valid across any reasonable scale here). Full detail still
// shows in the HUD avatar and chat portrait, which render the same sprite
// at their own larger font-size.
export const PLAYER_SCALE = 0.15;
export const PLAYER_T = spriteTiles(S.PLAYER, PLAYER_SCALE);

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
  // a drop instead of in open meadow. Listed FIRST for the same reason the
  // garden bed is: devLayout's hit() walks this array backwards and returns the
  // last match, so anything standing on the bluff still wins the grab over the
  // landscape under it.
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
  // The fenced garden plot. Listed near the top so it hit-tests underneath the
  // things that stand on top of it — devLayout's hit() walks this array
  // backwards and returns the last match, so an entity placed inside the plot
  // still wins the grab. Its position is farm.ts's GARDEN_HOME: drag it, then paste the
  // dumped x/y back into that constant (not into this entry, which reads it).
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
  // The two "flanking stone foundation blocks" wooden_floor_and_stairs's own
  // description names (grouped with the deck+stairs into one region, cols
  // 0-40 rows 42-51 — the house's OWN solid mask carves that whole band as
  // walkable uniformly, same as the old house did for its deck). As their own
  // whole-body-blocking entities so they stop the player entirely rather than
  // just their feet, same reasoning and pattern as the old house's skirting
  // blocks. Found by colour, not eyeballed: per-column mean lightness/
  // saturation across rows 42-51 shows a clear brighter, more saturated flank
  // on both sides (cols 0-14 and 28-40) against a darker, more muted middle
  // (cols 15-27) — the actual stair treads, shaded under the porch roof.
  //
  // Left is TRIMMED to 6 cols (0-5), not the full 14 — the chair sits right
  // above this flank (cols 6-13, rows 34-43), and the original 11-col trim
  // still ate into cols 6-10, leaving no floor to stand on in front of the
  // LEFT half of the chair. Stopping at col 5 opens the chair's entire own
  // column span (6-13) as walkable floor, symmetric about its centre — the
  // right half (11-13) was already open, this just matches the left half to
  // it. This also widens the walkable stair gap between the two blocks
  // (was tuned to leave exactly one column at the 11-col width — see the old
  // comment in git history — now comfortably wider), so the player's 2-tile
  // width fits through with room to spare, not just barely.
  //
  // sprite is a real CROP of the house's own glyphs (houseSlice), not a
  // blank filled rectangle — entityBlocksTile tests per-cell glyph presence,
  // so this blocks exactly where the porch texture actually has something
  // drawn in that rectangle ("sign sensitive"), rather than a bigger solid
  // box than what's really there.
  ...(
    [
      { id: 'house-block-left', col: 0, w: 6 },
      { id: 'house-block-right', col: 28, w: 13 },
    ] as const
  ).map(({ id, col, w }) => ({
    id,
    kind: 'blocker' as const,
    x: 27.85 + col * 0.18,
    y: 32 + 42 * 0.18,
    sprite: houseSlice(col, col + w - 1, 42, 51),
    interactable: false,
    scale: HOUSE_SCALE,
  })),
  // Invisible hit-boxes over the parts of that one picture you can interact
  // with: the rocking chair and the four garments on the line. Positions are
  // the master-grid cells each one occupies — taken directly from
  // house_simplified_regions.json (the same file that marked the source
  // image's regions), run through the anchor formula above, not eyeballed.
  // They never block movement (blocked() skips 'hotspot').
  //
  // Column padding is intentionally asymmetric: the four garments sit only
  // 1-2 master columns apart (cols 7-12 / 14-18 / 21-25 / 28-31), tighter than
  // the old house's clothesline, so padding columns risks two hotspots
  // overlapping and fighting over the same click. Padded ROWS instead (top
  // and bottom, all four garments already share rows 25-29/26-29, so a row
  // pad extends into the house body above and the porch below — harmless,
  // nothing else claims that space) and left the chair's columns padded too,
  // since it has no horizontal neighbour to collide with.
  ...(
    [
      { id: 'house-cloth-shorts', col: 7, row: 24, w: 6, h: 7 },
      { id: 'house-cloth-shirt-purple', col: 14, row: 25, w: 5, h: 6 },
      { id: 'house-cloth-shirt-yellow', col: 21, row: 25, w: 5, h: 6 },
      { id: 'house-cloth-shirt-green', col: 28, row: 25, w: 4, h: 6 },
      { id: 'house-chair', col: 5, row: 33, w: 10, h: 12 },
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
    y: 30,
    sprite: S.SHOP,
    interactable: true,
    palette: S.ARCH_PALETTE,
    colors: S.SHOP_COLORS,
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
    sprite: S.CAT,
    interactable: true,
    // no colours grid: the cat is a single light beige (.ent.cat in styles.css).
    // The old grid targeted the previous face and pointed at glyphs that no
    // longer exist in this sprite.
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
  // (both placed via the dev world editor, see worldOverrides.json) now
  // stand in for that whole corner of the map.
];

// Dev world-editor overrides (src/devWorldAssets.ts's "E" panel), written
// live to disk by a Vite dev-only middleware (vite.config.ts) every time
// something is placed/removed/undone/redone there — see postWorldOverrides
// in devWorldAssets.ts for why entries carry their own sprite/colors/
// palette data inline rather than a code reference: this file can't import
// anything from the dev-tool side (devBakedAssets.ts, the manifest) without
// pulling the whole editor into the production bundle. Starts empty
// (`{"removedIds":[],"added":[]}`) and is the ONLY thing this module writes
// to — STRUCT_ENTS_BASE above stays hand-authored/untouched by the tool.
const worldOverrides = worldOverridesData as unknown as { removedIds: string[]; added: Ent[] };

// Every id STRUCT_ENTS_BASE actually has, BEFORE removal is applied — needed
// by devWorldAssets.ts's own localStorage staleness check (loadRemovedStructIds):
// checking a saved "removed" id against the POST-removal STRUCT_ENTS is
// self-defeating (a removed id is, by definition, never present there), which
// silently discarded every real deletion on reload and re-posted an empty
// removedIds back to disk — the bug where deleting cliff/bridge/etc. in the
// editor "came back" on refresh. See STRUCT_ENTS's own comment below.
export const STRUCT_ENTS_BASE_IDS: string[] = STRUCT_ENTS_BASE.map((e) => e.id);
// The disk file's OWN removedIds, straight from JSON — the authoritative
// record of what's actually been deleted, independent of this browser's
// localStorage copy. Also used by devWorldAssets.ts to reseed correctly.
export const PERSISTED_REMOVED_IDS: string[] = worldOverrides.removedIds;
// The disk file's OWN `added` list, straight from JSON. devWorldAssets.ts's
// `drafts` state deliberately EXCLUDES anything already merged into
// STRUCT_ENTS (loadDrafts's own staleness dedup — a draft that's already a
// real entity would otherwise render twice), which means `drafts` alone is
// NOT a complete picture of what should stay in `added` on disk. Without
// this export, postWorldOverrides had no way to know that, so a placed
// entity's very next disk write (triggered by ANY drafts/removedStructIds
// change in ANY browser tab — even just mounting the panel) would overwrite
// `added` with `drafts` alone and silently drop every already-persisted
// placement. See postWorldOverrides's own comment for the merge that fixes it.
export const PERSISTED_ADDED: Ent[] = worldOverrides.added;

// The array every other module actually imports as `STRUCT_ENTS` — same
// name/shape as before this override system existed, so collision, spawn
// logic, and every render path keep working unchanged; only the VALUE it's
// computed from is now base-minus-removed-plus-added instead of a bare
// literal.
export const STRUCT_ENTS: Ent[] = (() => {
  const removed = new Set(worldOverrides.removedIds);
  const kept = STRUCT_ENTS_BASE.filter((e) => !removed.has(e.id));
  // `removed` applies to `added` too, not just the hand-authored base: once a
  // placed entity has been committed to disk, a later delete (toggleStructRemoved
  // in devWorldAssets.ts) marks its id removed the SAME way a hand-authored
  // entity's delete does — the two are indistinguishable by the time either
  // lives here. Without this filter a deleted placed entity kept reappearing
  // forever (never actually stripped from `added`), which is what made two
  // ponds show up: the "deleted" one stayed on disk, then a newly-placed one
  // stacked on top of it.
  const addedKept = worldOverrides.added.filter((e) => !removed.has(e.id));
  return [...kept, ...addedKept];
})();

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
    ...STRUCT_ENTS.map((e) => bbox(e)),
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
export const PLAYER_SPAWN = { x: 23, y: 32 };

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
// Ground rendering. Each land region is its own character layer (so it can be
// coloured independently in CSS), and the ocean is a set of phase-shifted wave
// frames the app cycles through for a gentle animation.
// ---------------------------------------------------------------------------

type LandRegion = Exclude<Region, 'ocean'>;

// GRASS DENSITY. The five land regions are the green ground cover; `beach` is
// sand and is deliberately left alone. The land figures are a TENTH of what
// they were (meadow .06, jungle .15, desert .05, rocky .10, tundra .09) — the
// island now reads as bare ground with occasional tufts rather than a carpet.
const GRASS_THIN = 0.1;
const SCATTER: Record<LandRegion, { chars: string[]; density: number }> = {
  // more sign variety → a richer, less repetitive sand texture (all ASCII, so
  // guaranteed single-width). The darker grain is a second layer (SAND_GRAIN).
  beach: { chars: ['.', ':', ',', "'", '`', ';', '.', ':', ',', '.', "'", '.'], density: 0.85 }, // dense so the small ring reads as solid sand, not a scatter
  meadow: { chars: ['.', ':', '"', "'", ',', '.'], density: 0.06 * GRASS_THIN },
  jungle: { chars: ['#', '*', '"', ':', '&', '#'], density: 0.15 * GRASS_THIN },
  desert: { chars: ['.', '~', "'", '.'], density: 0.05 * GRASS_THIN },
  rocky: { chars: ['^', 'o', ',', '.', '^'], density: 0.1 * GRASS_THIN },
  tundra: { chars: ['*', '.', "'", '*'], density: 0.09 * GRASS_THIN },
};

// Tiles the grass must stay off: every entity's full sprite box AND its solid
// collision box, plus a one-tile margin, plus the whole garden plot. Without
// this, tufts sprout through sprites and — worse — inside collision boxes,
// which paints walkable-looking grass on ground you can't actually stand on.
const GRASS_CLEAR_MARGIN = 1;
function grassKeepOut(window: number): Uint8Array {
  const mask = new Uint8Array(MAP_W * MAP_H);
  const block = (b: TileBox) => {
    for (let ty = b.y0 - GRASS_CLEAR_MARGIN; ty <= b.y1 + GRASS_CLEAR_MARGIN; ty++) {
      for (let tx = b.x0 - GRASS_CLEAR_MARGIN; tx <= b.x1 + GRASS_CLEAR_MARGIN; tx++) {
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) mask[ty * MAP_W + tx] = 1;
      }
    }
  };
  // the hand-placed structures, and the wild flora for THIS growth window
  for (const e of [...STRUCT_ENTS, ...wildSpawns(window)]) {
    block(bbox(e));
    block(collisionBox(e));
  }
  block({ x0: GARDEN.x0, y0: GARDEN.y0, x1: GARDEN.x1, y1: GARDEN.y1 });
  return mask;
}

// A sparser second pass over the middle of the beach: brighter marks in a
// LIGHTER tone (region-sandgrain), so the calm mid-beach still reads as a
// two-tone gradient rather than one flat colour. Deliberately calmer than
// Stage 1/before — the inner/outer sand EDGES now get their own dense bands
// (EDGE_BANDS.sandInner/sandOuter below), so this only needs to texture the
// quiet middle, not carry the whole transition.
const SAND_GRAIN = { chars: [':', ';', '"', '*', 'o', ',', ':'], density: 0.24 };

// A sparse layer of lighter-toned "signs" scattered across the TRUE
// interior (nd <= 0.85, comfortably clear of the coastline bands below) —
// the same density-ramp-flavoured glyph vocabulary used elsewhere in this
// game (house/cliff/bridge/pond), but kept to plain ASCII since this ground
// layer, unlike those baked sprites, is a huge <pre> of raw text with no
// per-cell width fix applied — an ambiguous-width glyph here would shear
// whole rows. Interior decoration, not part of the coastline transition —
// see visualTerrainAt/COAST for that.
const ISLAND_SIGNS = { chars: ['%', '&', '@', '+', '=', 'x', 'o', '#'], density: 0.035 };

// Small oblique "grass blade" signs scattered across the TRUE interior
// (nd < 0.7, well clear of every coastline band below), in two density
// tiers that form natural patches rather than one uniform scatter — see
// grassPatchIsDense just below. A slash is the only mark in either
// vocabulary that actually reads as slanted, so this stays plain ASCII
// (same ambiguous-width-glyph caution as ISLAND_SIGNS above) rather than
// reaching for a geometric glyph that has no oblique equivalent anyway.
const GRASS_SIGN_CHARS = ['/', '\\', "'"];
const GRASS_SIGN_SPARSE = 0.012;
const GRASS_SIGN_DENSE = 0.075;

// Font probe for every ambiguous-East-Asian-width geometric/block glyph used
// on this file's raw-text ground layers (ISLAND_SIGNS' own comment above
// explains why: no per-cell width fix here, unlike sprites.ts, so a
// double-width glyph would shear whole rows). Originally just for the
// ocean's geometric vocabulary (OCEAN_BASE_G/OCEAN_CAUSTIC_TIERS, further
// down this file); the terrain-glyph rework's new coastline bands right
// below need the same probe, so it moved up here to cover both. MEASURE,
// don't assume — see the reference/CJK-font reasoning in the comment that
// used to sit directly above this before the move.
function geometricGlyphsFit(): boolean {
  if (typeof document === 'undefined' || !document.body) return false; // node/tests
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font:inherit';
  document.body.appendChild(probe);
  const widthOf = (s: string) => {
    probe.textContent = s.repeat(20);
    return probe.getBoundingClientRect().width;
  };
  const ascii = widthOf('.');
  // the widest offenders across both vocabularies
  const wide = Math.max(widthOf('▪'), widthOf('∘'), widthOf('◆'), widthOf('●'), widthOf('◇'));
  document.body.removeChild(probe);
  return ascii > 0 && Math.abs(wide - ascii) / ascii < 0.05;
}
const GEOMETRIC_OK = geometricGlyphsFit();

// Terrain-glyph rework: reused for the new dense coastline glyph layers
// below (the light-green band, its sand overlay, and the boosted dark
// edge) — same measure-don't-assume caution as GEOMETRIC_OK's own comment
// just above: every one of these is gated behind that same font probe,
// with a plain-ASCII fallback of equivalent visual weight.
const DARK_EDGE_HEAVY = GEOMETRIC_OK ? ['▓', '▒', '▦', '▩', '◆', '◼', '▪'] : ['#', '%', '&', '@', '#', '%'];
const DARK_EDGE_LIGHT = GEOMETRIC_OK ? ['▒', '◈', '▲', '◢', '◣'] : [':', ';', '+', '=', '*'];
const LIGHT_GREEN_CHARS = GEOMETRIC_OK ? ['♦', '◇', '✦', '∘', "'"] : ['%', '#', "'", '`', '+'];
const SAND_OVERLAY_CHARS = GEOMETRIC_OK ? ['◈', '◇', '▫', '∘', "'"] : [':', ';', "'", ',', '.'];

// Low-frequency (tile-scale), spatially-coherent noise used to make each
// coastline glyph band organically expand/contract around the island
// instead of holding one fixed width everywhere — nearby tiles share a
// similar multiplier, so the variation reads as gently bulging/thinning
// coastline rather than per-pixel static. Each band passes its OWN seed so
// their widths don't all swell/shrink in lockstep (e.g. the sand overlay
// must not just be a smaller copy of the light-green band's own contour).
// Range 0.55..1.45: wide enough to read as organic, never collapses a band
// to zero width. vnoise is declared later in this file as a plain function
// declaration, so it's hoisted and safe to call here.
function bandWidthMul(tx: number, ty: number, seed: number): number {
  return 0.55 + 0.9 * vnoise(tx * 0.045, ty * 0.045, seed);
}

// Which broad interior patches get the DENSE grass-sign treatment — see
// GRASS_SIGN_SPARSE/DENSE above. Same coherent-noise idiom as
// bandWidthMul, own seed, much lower frequency so patches span several
// tiles rather than flickering tile-to-tile.
function grassPatchIsDense(tx: number, ty: number): boolean {
  return vnoise(tx * 0.05, ty * 0.05, 4242) > 0.55;
}

// ---------------------------------------------------------------------------
// STAGE 2 COASTLINE TRANSITIONS — narrow, DENSE, irregular glyph bands laid
// over the Stage 1 VisualTerrain background colours (visualTerrainAt/COAST)
// to disguise their hard seams, replacing the old wide/fuzzy inland
// sand-grass dither and SHORE_GLOW above (both removed — they spread the
// transition needlessly far inland instead of concentrating it right on the
// actual background-colour boundaries).
//
// Each band is a triangular density curve peaking exactly on one
// VisualTerrain boundary and fading out over a SMALL nd distance on either
// side — narrow and dense, not wide and sparse. Adjacent bands' ranges
// deliberately OVERLAP (e.g. the grass edge fades out inside the earth rim's
// own range, and vice versa) so their glyphs visually interleave across the
// boundary instead of stopping cleanly at it — see genLandLayers' own
// per-band comments for the geometry.
// ---------------------------------------------------------------------------

// Character-scale deterministic jitter, added to the (tile-level) nd used for
// transition-density decisions only — islandNd() is computed per TILE
// (4 chars x 2 lines all share one value), which would otherwise make a
// density-based boundary read as a blocky rectangle. This is small relative
// to the coastline itself (well under one tile) — texture, not a second
// island shape.
function edgeJitter(x: number, y: number): number {
  return (hash2(x * 0.5, y * 0.5) - 0.5) * 0.02;
}

// Triangular density curve, FLAT at `peak` across the inner `coreFrac` of
// the band before it starts falling off to 0 at ±halfWidth — every
// coastline band uses this now, so each one stays near-solid across a real
// stretch of its own range (not just a single peak value) before easing
// into its neighbour.
function edgeDensityCore(nd: number, center: number, halfWidth: number, coreFrac: number): number {
  const d = Math.abs(nd - center);
  const core = halfWidth * coreFrac;
  if (d <= core) return 1;
  return Math.max(0, 1 - (d - core) / (halfWidth - core));
}

// STAGE 2.8 — glyphs, not the background, carry the transition. Widened
// halfWidth on every band (more overlap with neighbours = more cross-
// boundary colour bleed, glyphs from adjacent bands genuinely interleaving
// instead of handing off cleanly) and added coreFrac to every band (not
// just the rim) so each one stays near-solid across a real stretch of its
// own range instead of only peaking at one nd value — the coast reads as
// the glyphs constructing a dense, dithered gradient, the way the
// reference does, with CoastBackgroundLayer demoted to "guarantee no
// empty cells show through" rather than the primary transition surface.
const EDGE_BANDS = {
  // Light-green inner coastline (terrain-glyph rework's Layer B): peaks
  // right on COAST.landEdge (1.0), essentially solid across its own core.
  // This is what makes the coastal ring read as "light green" — the
  // background underneath stays the plain land colour; LIGHT_GREEN_CHARS
  // is a visibly LIGHTER tone than the base land fleck (see
  // .region-edgegrass in styles.css). Width perturbed per-tile by
  // bandWidthMul (its own seed) so the ~4-6px depth the spec asks for
  // expands/contracts organically instead of holding one fixed width.
  grass: {
    center: 0.99,
    halfWidth: 0.05,
    peak: 1.0,
    coreFrac: 0.5,
    chars: LIGHT_GREEN_CHARS,
    widthSeed: 71,
  },
  // Sand-over-light-green overlap (Layer C): dense sand/yellow glyphs
  // stacked on the COAST-FACING portion of the light-green band above —
  // center sits inside grass's own range (still land-side of landEdge),
  // narrower, and driven by a DIFFERENT noise seed so its own width isn't
  // just a smaller copy of the light-green contour. Rendered as its own
  // <pre> layer painted AFTER 'grass' in genLandLayers' output (DOM order
  // = paint order here — see App.tsx's landLayers.map), so both colours
  // genuinely show through each other rather than one replacing the other.
  sandOverlay: {
    center: 0.995,
    halfWidth: 0.022,
    peak: 0.85,
    coreFrac: 0.35,
    chars: SAND_OVERLAY_CHARS,
    widthSeed: 133,
  },
  // Dark coastal edge (Layer D): NO dedicated background band any more
  // (see GRADIENT_STOPS above) — this glyph band is now the ONLY thing
  // that makes the edge read as dark green. Extremely dense (high
  // coreFrac) mixed high-pixel-coverage marks: DARK_EDGE_HEAVY near peak
  // density, DARK_EDGE_LIGHT toward the band's own soft edges, same
  // two-tier idea as before but with real pixel-coverage weight now
  // (▓▒▦▩◆◼▪ vs plain #%&:;). Width perturbed per-tile, own seed, so the
  // edge is never a perfectly consistent outline around the island.
  rim: {
    center: 1.005,
    halfWidth: 0.038,
    peak: 1.0,
    coreFrac: 0.62,
    charsHeavy: DARK_EDGE_HEAVY,
    charsLight: DARK_EDGE_LIGHT,
    widthSeed: 207,
  },
  // Inner sand edge: dense right where sand begins (just past the rim),
  // fading into the calm beach middle. Wider + a real flat core now, not
  // just a soft peak. Denser/heavier-coverage marks than before (section 7
  // of the terrain-glyph rework: the actual beach should feel richly
  // textured, not sparse) while keeping the soft sand BACKGROUND gradient
  // untouched underneath.
  sandInner: {
    center: 1.035,
    halfWidth: 0.04,
    peak: 0.97,
    coreFrac: 0.45,
    chars: [':', ';', "'", '`', ',', '.', ...(GEOMETRIC_OK ? ['▪', '◈'] : [])],
  },
  // Outer sand edge: dense again approaching the water, symmetric to the
  // inner edge around the calm middle of the beach. Same density/coverage
  // bump as sandInner above.
  sandOuter: {
    center: 1.105,
    halfWidth: 0.045,
    peak: 0.97,
    coreFrac: 0.45,
    chars: [':', ';', "'", '`', ',', '.', ...(GEOMETRIC_OK ? ['▪', '◈'] : [])],
  },
  // Sand/water seam: the biggest colour jump of any boundary (cream ->
  // turquoise), so it gets the narrowest, densest band of all — split into a
  // warm half and a cool half below (SEAM_WARM_CHARS/SEAM_COOL_CHARS) that
  // share one density roll so they interleave instead of both drawing solid.
  // Kept narrower than the land-side bands (this seam should stay concentrated,
  // not spread into open water) but still given a small flat core so the
  // exact seam itself reads solid rather than a single-point peak.
  seam: { center: 1.145, halfWidth: 0.022, peak: 1.0, coreFrac: 0.3 },
};
const SEAM_WARM_CHARS = ['.', ':', "'", '`', ','];
const SEAM_COOL_CHARS = ['~', ':', '.', "'"];

const emptyGrid = () => Array.from({ length: GROUND_H }, () => Array<string>(GROUND_W).fill(' '));
// Trailing spaces on a <pre> line render as nothing, so they are dead weight.
// The island is an ellipse in a rectangle, so every layer has a wide empty
// margin on the right; trimming it cuts the ground markup by well over half.
// Leading spaces MUST stay: they are what holds every glyph on its column.
const joinGrid = (g: string[][]) => g.map((r) => r.join('').replace(/ +$/, '')).join('\n');

// Takes the growth window so the grass can be kept clear of the wild flora,
// which is re-rolled each window. The sand/coastline layers do not depend on
// it (their `clear` check only ever matters on the land side, and nothing
// coastal-band-shaped is placed inside a structure's footprint there either).
export function genLandLayers(window: number): { region: string; text: string }[] {
  const rnd = mulberry32(1337);
  const keepOut = grassKeepOut(window);
  const grids: Record<LandRegion, string[][]> = {
    beach: emptyGrid(),
    meadow: emptyGrid(),
    jungle: emptyGrid(),
    desert: emptyGrid(),
    rocky: emptyGrid(),
    tundra: emptyGrid(),
  };
  const sandGrain = emptyGrid(); // calm mid-beach two-tone texture
  const islandSigns = emptyGrid(); // lighter sign glyphs over the true interior
  const grassSigns = emptyGrid(); // oblique interior "grass blade" signs, nd < 0.7
  const edgeGrass = emptyGrid(); // light-green inner coastline (Layer B)
  const edgeSandOverlay = emptyGrid(); // sand/yellow stacked over the light-green (Layer C)
  const edgeRim = emptyGrid();
  const edgeSandInner = emptyGrid();
  const edgeSandOuter = emptyGrid();
  const seamWarm = emptyGrid();
  const seamCool = emptyGrid();

  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      const tx = Math.floor(x / TILE_CH);
      const ty = Math.floor(y / TILE_LN);
      const r = regionAt(tx, ty);
      const nd = islandNd(tx, ty);

      // ---- base region fill + calm mid-beach grain (land tiles only) ----
      if (r !== 'ocean') {
        const sc = SCATTER[r];
        // Grass keeps off objects and their collider ranges; sand does not —
        // the beach ring has to stay continuous or the shoreline breaks up.
        const clear = r === 'beach' || !keepOut[ty * MAP_W + tx];
        if (clear && rnd() < sc.density) {
          grids[r][y][x] = sc.chars[Math.floor(rnd() * sc.chars.length)];
        }
        // calmer now — the dense inner/outer sand edges below carry the
        // transition, this only textures the quiet middle. Bumped slightly
        // (terrain-glyph rework section 7: the beach should feel richly
        // textured) while the soft sand background gradient underneath
        // stays exactly as it was.
        if (r === 'beach' && rnd() < SAND_GRAIN.density * 0.65) {
          sandGrain[y][x] = SAND_GRAIN.chars[Math.floor(rnd() * SAND_GRAIN.chars.length)];
        }
        // interior "signs", well clear of every coastline band
        if (r !== 'beach' && nd <= 0.85 && clear && rnd() < ISLAND_SIGNS.density) {
          islandSigns[y][x] = ISLAND_SIGNS.chars[Math.floor(rnd() * ISLAND_SIGNS.chars.length)];
        }
        // oblique grass-blade signs, comfortably inside the true interior
        // (nd < 0.7, narrower than ISLAND_SIGNS' own nd <= 0.85) — two
        // density tiers forming natural patches, not a uniform scatter, per
        // grassPatchIsDense's own low-frequency noise above.
        if (r !== 'beach' && nd < 0.7 && clear) {
          const p = grassPatchIsDense(tx, ty) ? GRASS_SIGN_DENSE : GRASS_SIGN_SPARSE;
          if (rnd() < p) {
            grassSigns[y][x] = GRASS_SIGN_CHARS[Math.floor(rnd() * GRASS_SIGN_CHARS.length)];
          }
        }
      }

      // ---- coastline transition bands ----
      // Only the thin ring near shore needs testing — skip everything well
      // clear of it on either side (deep interior, open ocean).
      if (nd < 0.9 || nd > COAST.shallowWaterEnd + 0.05) continue;
      // Water-side tiles have no keepOut entry (never blocked); land-side
      // tiles still respect it so a dense edge glyph never paints over a
      // structure or its collider.
      const clearEdge = r === 'ocean' || !keepOut[ty * MAP_W + tx];
      if (!clearEdge) continue;
      const ndJ = nd + edgeJitter(x, y);

      {
        const b = EDGE_BANDS.grass;
        const w = b.halfWidth * bandWidthMul(tx, ty, b.widthSeed);
        if (rnd() < edgeDensityCore(ndJ, b.center, w, b.coreFrac) * b.peak) {
          edgeGrass[y][x] = b.chars[Math.floor(rnd() * b.chars.length)];
        }
      }
      {
        const b = EDGE_BANDS.sandOverlay;
        const w = b.halfWidth * bandWidthMul(tx, ty, b.widthSeed);
        if (rnd() < edgeDensityCore(ndJ, b.center, w, b.coreFrac) * b.peak) {
          edgeSandOverlay[y][x] = b.chars[Math.floor(rnd() * b.chars.length)];
        }
      }
      {
        const b = EDGE_BANDS.rim;
        const w = b.halfWidth * bandWidthMul(tx, ty, b.widthSeed);
        const d = edgeDensityCore(ndJ, b.center, w, b.coreFrac) * b.peak;
        if (rnd() < d) {
          // heavier marks near peak density, lighter marks toward the band's
          // own edges — see EDGE_BANDS.rim's own comment
          const heavy = d > 0.6;
          const set = heavy ? b.charsHeavy : b.charsLight;
          edgeRim[y][x] = set[Math.floor(rnd() * set.length)];
        }
      }
      {
        const b = EDGE_BANDS.sandInner;
        if (rnd() < edgeDensityCore(ndJ, b.center, b.halfWidth, b.coreFrac) * b.peak) {
          edgeSandInner[y][x] = b.chars[Math.floor(rnd() * b.chars.length)];
        }
      }
      {
        const b = EDGE_BANDS.sandOuter;
        if (rnd() < edgeDensityCore(ndJ, b.center, b.halfWidth, b.coreFrac) * b.peak) {
          edgeSandOuter[y][x] = b.chars[Math.floor(rnd() * b.chars.length)];
        }
      }
      {
        const b = EDGE_BANDS.seam;
        const roll = rnd();
        if (roll < edgeDensityCore(ndJ, b.center, b.halfWidth, b.coreFrac) * b.peak) {
          if (ndJ < b.center) seamWarm[y][x] = SEAM_WARM_CHARS[Math.floor(rnd() * SEAM_WARM_CHARS.length)];
          else seamCool[y][x] = SEAM_COOL_CHARS[Math.floor(rnd() * SEAM_COOL_CHARS.length)];
        }
      }
    }
  }
  const layers = (Object.keys(grids) as LandRegion[]).map((region) => ({
    region: region as string,
    text: joinGrid(grids[region]),
  }));
  layers.push({ region: 'sandgrain', text: joinGrid(sandGrain) });
  layers.push({ region: 'islandsigns', text: joinGrid(islandSigns) });
  layers.push({ region: 'grasssigns', text: joinGrid(grassSigns) });
  // Paint order matters here (DOM order = stacking order, see App.tsx's
  // landLayers.map): edgesandoverlay AFTER edgegrass, so the sand/yellow
  // glyphs genuinely sit on top of — not instead of — the light-green ones
  // wherever both roll a mark on the same cell.
  layers.push({ region: 'edgegrass', text: joinGrid(edgeGrass) });
  layers.push({ region: 'edgesandoverlay', text: joinGrid(edgeSandOverlay) });
  layers.push({ region: 'edgerim', text: joinGrid(edgeRim) });
  layers.push({ region: 'edgesandinner', text: joinGrid(edgeSandInner) });
  layers.push({ region: 'edgesandouter', text: joinGrid(edgeSandOuter) });
  layers.push({ region: 'seamwarm', text: joinGrid(seamWarm) });
  layers.push({ region: 'seamcool', text: joinGrid(seamCool) });
  return layers;
}

// ===========================================================================
// WATER — two independent systems:
//   • OPEN OCEAN (genOceanBase + oceanCaustics): a dense base lattice with
//     caustic light drifting across it. The base is generated once; the
//     caustics are built PER FRAME, because their drift never wraps.
//   • SHORELINE (genShoreFrame): a precomputed surge loop. Only its white foam
//     crest is still drawn — see ShoreLayer in App.tsx.
// All the knobs live in the two config objects below.
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

// ---------------------------------------------------------------------------
// GLYPH VOCABULARIES — the reference's geometric marks, with a safety net.
// (geometricGlyphsFit()/GEOMETRIC_OK themselves now live earlier in this
// file, right before ISLAND_SIGNS/DARK_EDGE_HEAVY — the terrain-glyph
// rework's new coastline bands needed the probe result too, and a
// module-top-level const can't be read before its own declaration, so the
// probe moved up to cover both use sites. Nothing about the probe itself
// changed — see its own comment up there for the East-Asian-width caution.)
// The fallback is PURE 7-bit ASCII — no `·` either. It is Latin-1 rather than
// geometric so the probe does not test it, but a font that renders the
// geometric set double-width is exactly the kind that may do the same to it,
// and the fallback's whole job is to be beyond doubt.
//
// STAGE 3: dropped the solid squares (▪/▫) from the base lattice — small
// dots/rings only, so the persistent micro-texture stays visually quiet.
// The caustic vocabulary is now TIERED (OCEAN_CAUSTIC_TIERS below) instead
// of one shared set: tiny marks for the common low tiers, the bold
// circles/diamonds reserved for the rare highlight-cluster tier only — that
// tiering is what breaks the old "everything is an O/◇/●" look.
const OCEAN_BASE_G = GEOMETRIC_OK ? ['·', '∘'] : ['.', ':', ',', ';'];
const OCEAN_CAUSTIC_TIERS: string[][] = GEOMETRIC_OK
  ? [
      ['·', '∘'], //      tier 0 — micro, calmest
      ['·', '∘', "'"], //  tier 1
      ['∘', "'", '`'], //  tier 2 — soft field
      ['○', '◇', '∘'], //  tier 3 — highlight clusters only
    ]
  : [
      ['.', ':'],
      ['.', ':', "'"],
      [':', "'", '`'],
      ['o', '*', 'O'],
    ];
if (typeof console !== 'undefined' && typeof document !== 'undefined') {
  console.info(
    `[ocean] ${GEOMETRIC_OK ? 'geometric glyphs fit this font — using the reference set' : 'geometric glyphs are double-width in this font — using the ASCII fallback'}`,
  );
}

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

function fract(n: number): number {
  return n - Math.floor(n);
}
function hash2(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}

// ---------------------------------------------------------------------------
// OPEN OCEAN — caustics mesh (adapted from the AsciiWater `causticsFrame`).
// Seed points drift on loop-safe orbits; where the nearest and second-nearest
// seed distances are close, the water "creases" into a bright foam line.
// Three layers so each depth gets its own colour without per-char spans:
//   water:  : .       sparse specks in the open water
//   dim:    · ,       the soft outer glow of a crease
//   foam:   # * %     the bright crease web itself (drawn on top)
// Seeds sit on a jittered lattice, looked up via a 3x3-bucket neighbourhood
// (the naive every-seed scan would be ~100x slower on this field). The pitch
// is derived FROM the domain so the lattice tiles the wrap exactly (a pitch
// that doesn't divide the domain leaves edge seeds whose wrap distance
// degenerates into solid foam blobs). Glyphs are ASCII + '·' — grid-safe.
// ---------------------------------------------------------------------------

// Smoothed value noise. Same function the reference sketch uses, so the same
// coordinates give the same field.
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7 + seed * 13.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const tl = h(xi, yi);
  const tr = h(xi + 1, yi);
  const bl = h(xi, yi + 1);
  const br = h(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}

// Which character cells are open water. Precomputed once: the caustic pass runs
// every frame and must not pay for islandNd on 64,000 cells each time.
const OCEAN_MASK = (() => {
  const m = new Uint8Array(GROUND_W * GROUND_H);
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      const tx = Math.floor(x / TILE_CH);
      const ty = Math.floor(y / TILE_LN);
      if (isWater(tx, ty) && islandNd(tx, ty) > OCEAN_CFG.deepNd) m[y * GROUND_W + x] = 1;
    }
  }
  return m;
})();

// ---- the static base lattice (LEVEL 1 — micro texture) --------------------
// The base field has no drift term, so it is the same picture every frame —
// generate it once and never touch it again (Stage 3's "almost static"
// requirement for the calmest texture level falls out of this for free, no
// change needed). Two tones, split by a slow noise. STAGE 3: the glyph pick
// used to be `(x+y) % len` — a fixed period, which is exactly what reads as
// "obvious repeating rows" at this density. Switched to a second, unrelated
// noise field instead, so neighbouring cells/rows don't fall into a visible
// pattern.
function genOceanBase(): { base: string; lit: string } {
  const base = emptyGrid();
  const lit = emptyGrid();
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      if (!OCEAN_MASK[y * GROUND_W + x]) continue;
      const n = vnoise(x * OCEAN_CFG.cellX * 3.2, y * OCEAN_CFG.cellY * 3.2, 5);
      const gi = vnoise(x * 0.37, y * 0.41, 71);
      const g = OCEAN_BASE_G[Math.floor(gi * OCEAN_BASE_G.length) % OCEAN_BASE_G.length];
      if (n > 0.55) lit[y][x] = g;
      else base[y][x] = g;
    }
  }
  return { base: joinGrid(base), lit: joinGrid(lit) };
}
export const OCEAN_BASE = genOceanBase();

// ---- shallow-water ring hugging every coastline ---------------------------
// STAGE 3: now derived from COAST (Stage 1's single source of truth for the
// VISUAL coastline) instead of a standalone constant — the beach now extends
// past the old nd=1 waterline, so shallow water has to start OUTSIDE the new
// sand, not underneath it. Fades in over the outer band near the ocean, solid
// (well, "solid" at Stage 3's reduced density — see below) the rest of the
// way in toward COAST.outerSandEnd, where the dense seamWarm/seamCool bands
// (world.ts's EDGE_BANDS.seam) already own the actual sand/water switch.
// Density lowered from 0.85 -- Stage 3 wants shallow water visibly calmer
// than the coastline seam, not matching its density. Static, like the base
// lattice above — it never drifts, only the caustics sparkling on top of it do.
function genOceanShallow(): string {
  const rnd = mulberry32(4242);
  const grid = emptyGrid();
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      if (!OCEAN_MASK[y * GROUND_W + x]) continue;
      const tx = Math.floor(x / TILE_CH);
      const ty = Math.floor(y / TILE_LN);
      const nd = islandNd(tx, ty);
      // starts OUTSIDE the (now-wider) beach — the sand/seam bands own
      // everything inland of COAST.outerSandEnd, this never draws under them
      if (nd > COAST.shallowWaterEnd || nd < COAST.outerSandEnd) continue;
      const mix = Math.min(1, (COAST.shallowWaterEnd - nd) / 0.04); // 0 at outer edge → 1 further in
      if (rnd() < mix * 0.5) {
        const gi = vnoise(x * 0.37, y * 0.41, 71);
        grid[y][x] = OCEAN_BASE_G[Math.floor(gi * OCEAN_BASE_G.length) % OCEAN_BASE_G.length];
      }
    }
  }
  return joinGrid(grid);
}
export const OCEAN_SHALLOW = genOceanShallow();

// ---- the drifting caustics ------------------------------------------------
// Built per frame rather than precomputed, because the drift NEVER WRAPS: the
// offset grows forever, which is what makes the surface always move forward.
// A precomputed loop would have to jump back to its first frame, and this noise
// has no period to hide that seam in. The base lattice above is excluded
// entirely, and OCEAN_MASK skips land — but on a big map, "open water" is
// most of the grid, so those two alone don't bound the cost to anything close
// to a frame budget (measured ~100ms for the full 520x290 map post-islands,
// against a 90ms redraw interval — i.e. it couldn't even keep up with itself,
// let alone leave room for the movement loop in the same frame, which is what
// actually read as the camera "moving in small chunks" while walking). The
// real bound is VIEWPORT: whatever's off-screen can't be seen shimmering, so
// `bounds` (from the caller's current camera rect, with a margin — see
// OceanLayer in App.tsx) restricts the expensive inner loop to roughly what's
// visible, regardless of total map/ocean size. Cells outside bounds are still
// cleared every frame (a plain fill, not the noise math) so nothing stale is
// left behind if the camera moved since the last frame.
//
// Returns one string per caustic tone (dark -> bright), so the ocean is four
// <pre> elements rather than tens of thousands of coloured spans.
// Reused across frames. Allocating four 200x320 grids every 110ms was pure GC
// churn for a layer that redraws forever; these are cleared row by row instead.
const CAUSTIC_GRIDS = [emptyGrid(), emptyGrid(), emptyGrid(), emptyGrid()];

export interface CausticBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function oceanCaustics(t: number, bounds?: CausticBounds): string[] {
  const { cellX, cellY, driftX, driftY, threshold, band, cuts } = OCEAN_CFG;
  const dx = t * driftX;
  const dy = t * driftY;
  const tones = CAUSTIC_GRIDS;
  const nCuts = cuts.length;
  const yLo = bounds ? Math.max(0, Math.floor(bounds.y0)) : 0;
  const yHi = bounds ? Math.min(GROUND_H, Math.ceil(bounds.y1)) : GROUND_H;
  const xLo = bounds ? Math.max(0, Math.floor(bounds.x0)) : 0;
  const xHi = bounds ? Math.min(GROUND_W, Math.ceil(bounds.x1)) : GROUND_W;
  // Cheap: a native fill, not the noise math below — clears every row (not
  // just the visible band) so panning away from a shimmering patch doesn't
  // leave it frozen on screen the next time it scrolls back into view stale.
  for (let y = 0; y < GROUND_H; y++) {
    for (let k = 0; k < tones.length; k++) tones[k][y].fill(' ');
  }
  for (let y = yLo; y < yHi; y++) {
    const ny = y * cellY;
    for (let x = xLo; x < xHi; x++) {
      if (!OCEAN_MASK[y * GROUND_W + x]) continue;
      const nx = x * cellX;
      // Two overlapping fields. The reference samples B as
      //   vnoise(nx*1.7 + driftX*0.6, ny*1.7 + driftY*1.3, 23)
      // — offsets NOT scaled by B's own 1.7 frequency, and asymmetric between
      // the axes. That sends B across the screen at a steep ~65° while A runs
      // at 45°, so the two layers pull in different directions: the composite
      // never settles into one clean diagonal, and the sea does not move as a
      // single mass.
      //
      // Here B's offset IS scaled by its frequency (1.7), so B travels the same
      // DIRECTION as A. The remaining 0.85 leaves it slightly slower, and that
      // speed difference alone is enough to keep the light morphing rather than
      // sliding as rigid wallpaper. Revert to `dx * 0.6, dy * 1.3` for the
      // reference's exact behaviour.
      const cA = vnoise(nx + dx, ny + dy, 11);
      const cB = vnoise(nx * 1.7 + dx * 1.445, ny * 1.7 + dy * 1.445, 23);
      const v = cA * 0.65 + cB * 0.55;
      // STAGE 3 — SOFT TEXTURE FIELDS: a very-low-frequency noise (its own
      // drift, much slower than the main flow, so fields evolve gently
      // rather than sliding with the rest of the water) nudges the local
      // threshold up/down by a small amount — broad irregular patches of
      // the water read as slightly denser/quieter than their surroundings,
      // instead of one uniform density everywhere.
      const field = vnoise(nx * 0.22 + dx * 0.15, ny * 0.22 + dy * 0.15, 501);
      const localThreshold = threshold + (field - 0.5) * 0.08;
      if (v <= localThreshold) continue; // open water — the base lattice shows
      const u = (v - localThreshold) / band;
      // Hard cutoffs, not a ramp: a cell belongs to exactly one tone with no
      // blend between them, which is what gives the water solid regions and
      // crisp boundaries.
      let tier = nCuts;
      for (let k = 0; k < nCuts; k++) {
        if (u < cuts[k]) {
          tier = k;
          break;
        }
      }
      // STAGE 3 — HIGHLIGHT CLUSTERS: the brightest tier (bold circles/
      // diamonds, per OCEAN_CAUSTIC_TIERS) is reserved for a SMALL number of
      // irregular, slow-drifting patches (another very-low-frequency field,
      // its own even-slower drift for "slightly more noticeable shimmer"
      // than the soft fields above) — everywhere else, what would have been
      // the brightest tier is downgraded one step. This is what confines the
      // old "every O/◇/● is everywhere" look to a few localized shimmer
      // patches instead of the whole sea.
      if (tier === nCuts) {
        const cluster = vnoise(nx * 0.09 + dx * 0.3, ny * 0.09 + dy * 0.3, 777);
        if (cluster < 0.76) tier = nCuts - 1;
      }
      // glyph texture — reference: vnoise(nx*4 + driftX, ny*4 + driftY, 31),
      // the offset again left unscaled, so the texture crawls under the regions
      const set = OCEAN_CAUSTIC_TIERS[tier] ?? OCEAN_CAUSTIC_TIERS[OCEAN_CAUSTIC_TIERS.length - 1];
      const gi = Math.floor(vnoise(nx * 4 + dx, ny * 4 + dy, 31) * set.length);
      tones[tier][y][x] = set[gi % set.length];
    }
  }
  return tones.map(joinGrid);
}

// ---------------------------------------------------------------------------
// SHORELINE — the push / hold / pull surge. A "waterline" sweeps along the
// islandNd field: fast smooth push up the sand (ease-out), a brief hold at
// max reach, then a slower dissolving retreat (ease-in). Rounded finger lobes
// modulate the line per-angle so the leading edge reaches unevenly and the
// lobes slowly slide along the coast. Emits three sparse layers:
//   sheet:  _ . -     the thin glowing apron + light mesh
//   foam:   @ O o % * the thick bright leading crest + churn
//   glaze:  , : .     dark wet-sand mirror left behind by the retreat
// Only the thin coastal ring has non-blank cells, so this is cheap.
// ---------------------------------------------------------------------------

export interface ShoreFrame {
  sheet: string;
  foam: string;
  foam2: string;
  glaze: string;
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeIn = (u: number) => u * u;
// STAGE 3: recentred from the literal nd=1 (the old gameplay waterline) onto
// COAST.outerSandEnd — Stage 1/2's beach now visually extends well past
// nd=1, so the animated surge has to sweep around the NEW outer sand edge
// (where the dense seamWarm/seamCool bands already mark the actual
// sand/water switch), not the old, now-inland, boundary.
const SHORELINE_ND = COAST.outerSandEnd;
const ND_DEEP = SHORELINE_ND + SHORE_CFG.pullDepth; // fully-receded waterline
const ND_MAX = SHORELINE_ND - SHORE_CFG.pushReach; // fully-surged waterline (up the sand)
const ND_LO = ND_MAX - 0.02; // shore-band inner bound (a touch past max reach)
// Outer bound. It has to clear the FULL width of both foam bands measured from
// the most-receded waterline, or the trailing band would be cut off flat every
// time the wave pulled back.
const ND_HI =
  Math.max(OCEAN_CFG.deepNd, ND_DEEP + SHORE_CFG.foamThickness + SHORE_CFG.foam2Thickness) + 0.01;

// Is this tile ANYWHERE within the shoreline foam's animation range? The surge
// loop sweeps a tile between "dry sand" and "foam-covered" over time (see
// genShoreFrame below) — a tile that reads as plain beach at this instant can
// still have foam wash over it a few seconds later. [ND_MAX, ND_HI] is the
// FULL possible range across one whole surge cycle, not just the current
// phase, so a placement check against this is safe regardless of tide timing.
export function isFoamZone(tx: number, ty: number): boolean {
  const nd = islandNd(tx, ty);
  return nd >= ND_MAX && nd <= ND_HI;
}

// reach ∈ [0,1] over one loop: 0=receded(deep), 1=surged(max up the sand)
function shoreReach(p: number): number {
  const pushEnd = SHORE_CFG.pushFrac;
  const holdEnd = pushEnd + SHORE_CFG.holdFrac;
  if (p < pushEnd) return easeOut(p / pushEnd); // fast silky push
  if (p < holdEnd) return 1; // the pause at max reach
  return 1 - easeIn((p - holdEnd) / (1 - holdEnd)); // slower gravity pull
}

function genShoreFrame(phase: number): ShoreFrame {
  const p = phase / SHORE_CFG.phases;
  const reach = shoreReach(p);
  const wl = ND_DEEP - reach * (ND_DEEP - ND_MAX); // base waterline for this frame
  const receding = p >= SHORE_CFG.pushFrac + SHORE_CFG.holdFrac;

  const sheet = emptyGrid();
  const foam = emptyGrid();
  const foam2 = emptyGrid();
  const glaze = emptyGrid();
  for (let y = 0; y < GROUND_H; y++) {
    const Y = y * 2;
    for (let x = 0; x < GROUND_W; x++) {
      const tx = Math.floor(x / TILE_CH);
      const ty = Math.floor(y / TILE_LN);
      const { nd: N, isl } = nearestIsland(tx, ty);
      if (N < ND_LO || N > ND_HI) continue; // only the coastal ring

      // finger lobes: modulate the local waterline by the angle around
      // whichever island this tile's coastline actually belongs to
      const theta = Math.atan2(ty - isl.cy, tx - isl.cx);
      const finger =
        Math.sin(theta * SHORE_CFG.fingerFreq + p * 2 * Math.PI * SHORE_CFG.fingerDrift) *
        SHORE_CFG.fingerAmp;
      const wlL = wl + finger;
      // fine char-scale texture so the bands aren't clean contours (kept small
      // relative to the now-thin foam band so the edge doesn't dissolve)
      const grain = (hash2(x, Y) - 0.5) * 0.008;
      const dA = N - wlL + grain; // >0 seaward of the line (covered), <0 exposed

      if (dA >= 0) {
        // under the water sheet
        if (dA < SHORE_CFG.foamThickness) {
          // thick bright leading crest
          const f = hash2(x * 1.3, Y * 1.3);
          foam[y][x] = f > 0.6 ? '@' : f > 0.3 ? 'O' : 'o';
        } else if (dA < SHORE_CFG.foamThickness + SHORE_CFG.foam2Thickness) {
          // The second white band, trailing the crest. Same waterline, same
          // loop — only the glyphs are lighter and it thins out toward its far
          // edge, so the surf fades into the water instead of ending on a line.
          const u2 = (dA - SHORE_CFG.foamThickness) / SHORE_CFG.foam2Thickness; // 0 at the crest → 1 at the back
          const f = hash2(x * 0.9, Y * 0.9 + 3);
          if (f > u2 * 0.85) foam2[y][x] = f > 0.72 ? 'o' : f > 0.45 ? '~' : '-';
        } else if (N < SHORELINE_ND) {
          // thin glowing apron gliding over the sand
          sheet[y][x] = hash2(x, Y + 9) > 0.5 ? '_' : '.';
        } else if (dA < SHORE_CFG.meshDepth) {
          // lacy churning mesh over the near water
          const m = hash2(x * 0.7, Y * 0.7 + phase);
          if (m > 0.72) foam[y][x] = m > 0.9 ? '%' : '*';
          else sheet[y][x] = m < 0.28 ? '-' : '~';
        }
        // deeper than meshDepth on the water side → blank (ocean caustics shows)
      } else {
        // exposed sand this instant — wet glaze only while receding, within
        // the stretch the sheet actually reached (down to ND_MAX)
        if (receding && N >= ND_MAX) {
          const g = hash2(x, Y + 5);
          glaze[y][x] = g > 0.82 ? ':' : g > 0.5 ? ',' : g < 0.08 ? '.' : ' ';
        }
      }
    }
  }
  return {
    sheet: joinGrid(sheet),
    foam: joinGrid(foam),
    foam2: joinGrid(foam2),
    glaze: joinGrid(glaze),
  };
}

// Land colour layers. NOT a const any more: the grass is masked against the
// wild flora, which is re-rolled every growth window, so App re-derives these
// when the window turns over (see the LAND_LAYERS memo in App.tsx).
// the open ocean is built per frame by oceanCaustics(t) — there is no frame
// list, because the drift never wraps back to a first frame
// shoreline surge frames (separate loop/length from the ocean)
export const SHORE_FRAMES = Array.from({ length: SHORE_CFG.phases }, (_, p) => genShoreFrame(p));
