import * as S from './sprites';
import { GARDEN } from './farm';

// The map is a tile grid. Each tile is 4 characters wide and 2 lines tall, so
// the ground layer is (MAP_W*4) x (MAP_H*2) characters. Entities are positioned
// at tile coordinates; horizontal placement uses `ch` units and vertical
// placement uses `em` units (line-height: 1) so everything stays locked to the
// monospace character grid.
export const MAP_W = 80;
export const MAP_H = 100;
export const TILE_CH = 4; // chars per tile (x)
export const TILE_LN = 2; // lines per tile (y)
export const GROUND_W = MAP_W * TILE_CH;
export const GROUND_H = MAP_H * TILE_LN;

export type ItemType = 'flower' | 'stone' | 'apple' | 'cactus' | 'fern' | 'iceflower';
export type EntityKind = ItemType | 'appleTree' | 'emptyTree' | 'shop' | 'cat' | 'house';

// ---------------------------------------------------------------------------
// The island: a single concrete landmass surrounded by ocean, split into big
// contiguous regions (loosely modelled on Hawai'i's Big Island climate zones).
// Deterministic and pure — the map never changes at runtime.
// ---------------------------------------------------------------------------

export type Region = 'ocean' | 'beach' | 'meadow' | 'jungle' | 'desert' | 'rocky' | 'tundra';

// island body: an ellipse with a gentle, deterministic coastline wobble
const ISLAND = { cx: 40, cy: 50, rx: 36, ry: 44 };

// Signed distance-ish field from the island centre: <1 inland, ≈1 the
// waterline, >1 open ocean. Exported because the shoreline surge animates a
// threshold along this field (see genShoreFrame).
export function islandNd(tx: number, ty: number): number {
  const dx = (tx - ISLAND.cx) / ISLAND.rx;
  const dy = (ty - ISLAND.cy) / ISLAND.ry;
  const wobble =
    0.06 * Math.sin(tx * 0.45) + 0.05 * Math.cos(ty * 0.5) + 0.04 * Math.sin((tx + ty) * 0.3);
  return Math.sqrt(dx * dx + dy * dy) - wobble;
}

export function isWater(tx: number, ty: number): boolean {
  return islandNd(tx, ty) > 1;
}

// big region anchors
const VILLAGE = { x: 32, y: 30, r: 12 }; // home meadow, kept friendly
const VOLCANO = { x: 40, y: 54, r: 13 }; // central lava fields
const SUMMIT = { x: 40, y: 54, r: 4 }; // snow-capped peak on the volcano

export function regionAt(tx: number, ty: number): Region {
  const nd = islandNd(tx, ty);
  if (nd > 1) return 'ocean';
  if (nd > 0.9) return 'beach'; // coastal sand ring
  if (Math.hypot(tx - VILLAGE.x, ty - VILLAGE.y) < VILLAGE.r) return 'meadow';
  if (Math.hypot(tx - SUMMIT.x, ty - SUMMIT.y) < SUMMIT.r) return 'tundra';
  if (Math.hypot(tx - VOLCANO.x, ty - VOLCANO.y) < VOLCANO.r) return 'rocky';
  if (tx >= 46) return 'jungle'; // wet east side
  if (ty >= 52) return 'desert'; // dry south-west
  return 'meadow'; // grassland north / north-west
}

export interface Ent {
  id: string;
  kind: EntityKind;
  x: number; // tile x of sprite top-left
  y: number; // tile y of sprite top-left
  sprite: string[];
  interactable: boolean; // interactables get the [F] popup when the player is near
  fallFrom?: number; // lines to fall from, for freshly dropped apples
}

export function spriteTiles(sprite: string[]) {
  const w = Math.max(...sprite.map((l) => l.length));
  return {
    wT: Math.ceil(w / TILE_CH),
    hT: Math.ceil(sprite.length / TILE_LN),
  };
}

export const PLAYER_T = spriteTiles(S.PLAYER);

// An entity's footprint is the bottom row of tiles it covers. Used for
// interaction distance (near) and dropped-apple placement.
export function footprint(e: { x: number; y: number; sprite: string[] }) {
  const { wT, hT } = spriteTiles(e.sprite);
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
export function bbox(e: { x: number; y: number; sprite: string[] }): TileBox {
  const { wT, hT } = spriteTiles(e.sprite);
  return { x0: e.x, y0: e.y, x1: e.x + wT - 1, y1: e.y + hT - 1 };
}

// How many of an entity's BOTTOM tile-rows are solid (block the player):
//   buildings  → the whole height (you can't walk behind or into them)
//   trees      → only the trunk base (2 rows), so you still pass behind the
//                canopy but can't walk through the trunk
//   flora/NPCs → just the footprint row, as before
function solidTopRow(kind: EntityKind, y: number, hT: number): number {
  if (kind === 'house' || kind === 'shop') return y; // fully solid
  if (kind === 'appleTree' || kind === 'emptyTree') return y + Math.max(0, hT - 2); // trunk base
  return y + hT - 1; // footprint row only
}

// The solid box an entity blocks. Collision tests the player's whole box
// against this: overlap only the non-solid rows (e.g. a tree canopy) and you
// pass behind; overlap the solid box and you're stopped.
export function collisionBox(e: { x: number; y: number; sprite: string[]; kind: EntityKind }): TileBox {
  const { wT, hT } = spriteTiles(e.sprite);
  return { x0: e.x, y0: solidTopRow(e.kind, e.y, hT), x1: e.x + wT - 1, y1: e.y + hT - 1 };
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

// Permanent, hand-placed structures. The village sits in its meadow (NW);
// apple/empty trees are scattered across the green regions. All are on land.
export const STRUCT_ENTS: Ent[] = [
  { id: 'house', kind: 'house', x: 28, y: 32, sprite: S.HOUSE, interactable: true },
  { id: 'shop', kind: 'shop', x: 40, y: 30, sprite: S.SHOP, interactable: true },
  { id: 'cat', kind: 'cat', x: 35, y: 33, sprite: S.CAT, interactable: true },
  { id: 'atree1', kind: 'appleTree', x: 24, y: 26, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree2', kind: 'appleTree', x: 44, y: 26, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree3', kind: 'appleTree', x: 54, y: 42, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree4', kind: 'appleTree', x: 26, y: 44, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree5', kind: 'appleTree', x: 58, y: 60, sprite: S.APPLE_TREE, interactable: true },
  { id: 'etree1', kind: 'emptyTree', x: 22, y: 40, sprite: S.TREE2, interactable: true },
  { id: 'etree2', kind: 'emptyTree', x: 20, y: 48, sprite: S.TREE3, interactable: true },
  { id: 'etree3', kind: 'emptyTree', x: 46, y: 36, sprite: S.TREE2, interactable: true },
  { id: 'etree4', kind: 'emptyTree', x: 52, y: 34, sprite: S.TREE3, interactable: true },
  { id: 'etree5', kind: 'emptyTree', x: 58, y: 48, sprite: S.TREE2, interactable: true },
  { id: 'etree6', kind: 'emptyTree', x: 62, y: 58, sprite: S.TREE3, interactable: true },
  { id: 'etree7', kind: 'emptyTree', x: 52, y: 66, sprite: S.TREE2, interactable: true },
  { id: 'etree8', kind: 'emptyTree', x: 30, y: 22, sprite: S.TREE3, interactable: true },
  { id: 'etree9', kind: 'emptyTree', x: 42, y: 44, sprite: S.TREE2, interactable: true },
  { id: 'etree10', kind: 'emptyTree', x: 60, y: 68, sprite: S.TREE3, interactable: true },
  { id: 'etree11', kind: 'emptyTree', x: 34, y: 66, sprite: S.TREE2, interactable: true },
];

// Wild spawns regenerate deterministically per growth window: same window →
// same layout. Each land region has its own spawn pool, so what you find
// depends on where you explore. Ocean/beach never spawn flora.
type SpawnRegion = 'meadow' | 'desert' | 'jungle' | 'tundra' | 'rocky';

const REGION_POOL: Record<SpawnRegion, { kind: EntityKind; sprite: string[]; count: number }[]> = {
  meadow: [
    { kind: 'flower', sprite: S.FLOWER, count: 8 },
    { kind: 'stone', sprite: S.STONE, count: 4 },
  ],
  desert: [
    { kind: 'cactus', sprite: S.CACTUS, count: 8 },
    { kind: 'stone', sprite: S.STONE, count: 4 },
  ],
  jungle: [
    { kind: 'fern', sprite: S.FERN, count: 9 },
    { kind: 'flower', sprite: S.FLOWER, count: 3 },
  ],
  tundra: [{ kind: 'iceflower', sprite: S.ICEFLOWER, count: 6 }],
  rocky: [{ kind: 'stone', sprite: S.STONE, count: 9 }],
};

export function wildSpawns(window: number): Ent[] {
  const rnd = mulberry32((window | 0) * 7919 + 23);
  // Reserve the FULL box of every structure (so nothing sprouts over a tree
  // canopy or roof, not just its base row) plus the whole garden plot with a
  // one-tile margin (so no wild flora crowds the planting beds).
  const taken: TileBox[] = [
    ...STRUCT_ENTS.map((e) => bbox(e)),
    { x0: GARDEN.x0 - 1, y0: GARDEN.y0 - 1, x1: GARDEN.x1 + 1, y1: GARDEN.y1 + 1 },
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

// The player starts in front of their house (south side), on land.
export const PLAYER_SPAWN = { x: 29, y: 37 };

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

const SCATTER: Record<LandRegion, { chars: string[]; density: number }> = {
  beach: { chars: ['.', ':', '.', "'", ',', '.'], density: 0.42 }, // dense so the small ring reads as sand
  meadow: { chars: ['.', ':', '"', "'", ',', '.'], density: 0.06 },
  jungle: { chars: ['#', '*', '"', ':', '&', '#'], density: 0.15 },
  desert: { chars: ['.', '~', "'", '.'], density: 0.05 },
  rocky: { chars: ['^', 'o', ',', '.', '^'], density: 0.1 },
  tundra: { chars: ['*', '.', "'", '*'], density: 0.09 },
};

const emptyGrid = () => Array.from({ length: GROUND_H }, () => Array<string>(GROUND_W).fill(' '));
const joinGrid = (g: string[][]) => g.map((r) => r.join('')).join('\n');

function genLandLayers(): { region: LandRegion; text: string }[] {
  const rnd = mulberry32(1337);
  const grids: Record<LandRegion, string[][]> = {
    beach: emptyGrid(),
    meadow: emptyGrid(),
    jungle: emptyGrid(),
    desert: emptyGrid(),
    rocky: emptyGrid(),
    tundra: emptyGrid(),
  };
  const beachSc = SCATTER.beach;
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      const tx = Math.floor(x / TILE_CH);
      const ty = Math.floor(y / TILE_LN);
      const r = regionAt(tx, ty);
      if (r === 'ocean') continue;
      const sc = SCATTER[r];
      if (rnd() < sc.density) grids[r][y][x] = sc.chars[Math.floor(rnd() * sc.chars.length)];
      // sand→grass dither: just inland of the beach ring (nd 0.82–0.90), sprinkle
      // sand grains onto the grass with a probability that fades inland, so the
      // small beach blends into the meadow instead of ending on a hard line.
      if (r !== 'beach') {
        const nd = islandNd(tx, ty);
        if (nd > 0.82 && nd < 0.9) {
          const mix = (nd - 0.82) / (0.9 - 0.82); // 0 inland → 1 at the sand edge
          if (rnd() < mix * beachSc.density) {
            grids.beach[y][x] = beachSc.chars[Math.floor(rnd() * beachSc.chars.length)];
          }
        }
      }
    }
  }
  return (Object.keys(grids) as LandRegion[]).map((region) => ({ region, text: joinGrid(grids[region]) }));
}

// ===========================================================================
// WATER — two independent animated systems, both precomputed into looping
// frame sets and cycled by the App (zero per-frame runtime cost):
//   • OPEN OCEAN (genOceanFrame): a drifting Voronoi caustics MESH out in deep
//     water — the lacy "pool floor" web of foam.
//   • SHORELINE (genShoreFrame): a surge that pushes a thin foam-edged sheet
//     up the sand, holds, then recedes and dissolves, leaving wet-sand glaze.
// The two hand off at OCEAN_CFG.deepNd: caustics only seaward of it, the
// shore owns the near-shore band.  All the knobs live in these two config
// objects so the whole look is tunable from one place.
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

// -- OPEN-OCEAN caustics config --------------------------------------------
export const OCEAN_CFG = {
  phases: 24, //   frame count (higher = smoother motion)
  driftMs: 170, // ms between frames (lower = faster)
  seedSpacing: 12, // lattice pitch in chars (lower = finer/busier mesh)
  foamAmount: 0.2, // 0..1 thickness of the bright crease web
  wobble: 0.5, //   crease waviness (organic-ness of the web lines)
  deepNd: 1.04, //  caustics only where islandNd > this (rest is the shore's)
};

// -- SHORELINE surge config -------------------------------------------------
// The wave is sized to the PLAYER (~3 tiles wide, ~1.5 tall). One nd unit is
// roughly 40 tiles near the coast, so ~0.025 nd ≈ 1 tile: the reach/depth
// below give a gentle lap of a couple of tiles in and out — NOT a full
// retreat to deep water. Bump pushReach/pullDepth up together for bigger surf.
export const SHORE_CFG = {
  phases: 30, //     frame count for one push→hold→pull loop
  surgeMs: 220, //   ms between frames (loop ≈ phases*surgeMs)
  pushReach: 0.045, // climb up the sand (≈1.8 tiles → nd 0.955)
  pullDepth: 0.035, // recede into the water (≈1.4 tiles → nd 1.035), not far out
  pushFrac: 0.35, //  fraction of the loop spent pushing (fast)
  holdFrac: 0.1, //   fraction paused at max reach
  foamThickness: 0.014, // bright leading foam band (≈2-3 chars thick)
  meshDepth: 0.028, //   lacy mesh behind the foam edge (≈1 tile)
  fingerAmp: 0.011, //   depth of the rounded finger lobes (nd)
  fingerFreq: 16, //    number of finger lobes around the island
  fingerDrift: 0.5, //  how fast the lobes slide along the coast per loop
};

const DOUBLE_H = GROUND_H * 2; // y is doubled: chars are ~2x taller than wide

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

interface CausticSeed {
  bx: number; by: number; // base position (jittered lattice)
  ax: number; ay: number; // orbit radius
  k: 1 | 2; // orbit cycles per loop (integer → seamless wrap)
  ph: number; // phase offset
}

const SEED_NX = Math.round(GROUND_W / OCEAN_CFG.seedSpacing);
const SEED_NY = Math.round(DOUBLE_H / OCEAN_CFG.seedSpacing);
const SEED_SX = GROUND_W / SEED_NX;
const SEED_SY = DOUBLE_H / SEED_NY;
function makeCausticSeeds(): CausticSeed[] {
  const seeds: CausticSeed[] = [];
  for (let iy = 0; iy < SEED_NY; iy++) {
    for (let ix = 0; ix < SEED_NX; ix++) {
      const i = iy * SEED_NX + ix;
      seeds.push({
        // jitter keeps every seed within reach of its 3x3 neighborhood
        bx: (ix + 0.5) * SEED_SX + (hash2(ix, iy) - 0.5) * (OCEAN_CFG.seedSpacing * 0.8),
        by: (iy + 0.5) * SEED_SY + (hash2(iy + 31, ix) - 0.5) * (OCEAN_CFG.seedSpacing * 0.8),
        ax: 3 + hash2(i, 7) * 3,
        ay: 2 + hash2(i, 13) * 3,
        k: i % 3 === 0 ? 2 : 1,
        ph: i * 1.7,
      });
    }
  }
  return seeds;
}
const CAUSTIC_SEEDS = makeCausticSeeds();

export interface OceanFrame {
  water: string;
  dim: string;
  foam: string;
}

function genOceanFrame(phase: number): OceanFrame {
  const angle = (2 * Math.PI * phase) / OCEAN_CFG.phases;
  const band = (0.6 + OCEAN_CFG.foamAmount * 1.4) * 1.15;
  const px = CAUSTIC_SEEDS.map((s) => s.bx + Math.sin(angle * s.k + s.ph) * s.ax);
  const py = CAUSTIC_SEEDS.map((s) => s.by + Math.cos(angle * s.k + s.ph) * s.ay);

  const water = emptyGrid();
  const dim = emptyGrid();
  const foam = emptyGrid();
  for (let y = 0; y < GROUND_H; y++) {
    const Y = y * 2;
    const iy0 = Math.min(SEED_NY - 1, Math.floor(Y / SEED_SY));
    for (let x = 0; x < GROUND_W; x++) {
      const tx = Math.floor(x / TILE_CH);
      const ty = Math.floor(y / TILE_LN);
      if (!isWater(tx, ty)) continue;
      if (islandNd(tx, ty) < OCEAN_CFG.deepNd) continue; // near-shore band belongs to the shore
      const ix0 = Math.min(SEED_NX - 1, Math.floor(x / SEED_SX));
      let d1 = Infinity;
      let d2 = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          // wrap lattice indices so the pattern is continuous at map edges
          const ix = (ix0 + dx + SEED_NX) % SEED_NX;
          const iy = (iy0 + dy + SEED_NY) % SEED_NY;
          const i = iy * SEED_NX + ix;
          let ddx = Math.abs(x - px[i]);
          if (ddx > GROUND_W / 2) ddx = GROUND_W - ddx;
          let ddy = Math.abs(Y - py[i]);
          if (ddy > DOUBLE_H / 2) ddy = DOUBLE_H - ddy;
          const d = Math.hypot(ddx, ddy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      // two-frequency wobble along the crease → finer, less geometric shapes
      const edge =
        d2 - d1 +
        Math.sin(x * 0.9 + Y * 0.7 + angle) * OCEAN_CFG.wobble +
        Math.sin(x * 2.3 - Y * 1.9 + angle * 2) * OCEAN_CFG.wobble * 0.4;

      // richer tier ladder (more gradations = more "shapes")
      if (edge < band * 0.28) foam[y][x] = '#';
      else if (edge < band * 0.55) foam[y][x] = '*';
      else if (edge < band * 0.8) foam[y][x] = '%';
      else if (edge < band) dim[y][x] = '·';
      else {
        const h = hash2(x, Y);
        if (h > 0.9) water[y][x] = ':';
        else if (h < 0.05) water[y][x] = '.';
      }
    }
  }
  return { water: joinGrid(water), dim: joinGrid(dim), foam: joinGrid(foam) };
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
  glaze: string;
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeIn = (u: number) => u * u;
const ND_DEEP = 1 + SHORE_CFG.pullDepth; // fully-receded waterline
const ND_MAX = 1 - SHORE_CFG.pushReach; // fully-surged waterline (up the sand)
const ND_LO = ND_MAX - 0.02; // shore-band inner bound (a touch past max reach)
const ND_HI = OCEAN_CFG.deepNd + 0.01; // shore-band outer bound (meets the caustics)

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
  const glaze = emptyGrid();
  for (let y = 0; y < GROUND_H; y++) {
    const Y = y * 2;
    for (let x = 0; x < GROUND_W; x++) {
      const tx = Math.floor(x / TILE_CH);
      const ty = Math.floor(y / TILE_LN);
      const N = islandNd(tx, ty);
      if (N < ND_LO || N > ND_HI) continue; // only the coastal ring

      // finger lobes: modulate the local waterline by the angle around the isle
      const theta = Math.atan2(ty - ISLAND.cy, tx - ISLAND.cx);
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
        } else if (N < 1.0) {
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
  return { sheet: joinGrid(sheet), foam: joinGrid(foam), glaze: joinGrid(glaze) };
}

// land colour layers (back-to-front order doesn't matter — regions don't overlap)
export const LAND_LAYERS = genLandLayers();
// open-ocean caustics frames the app cycles through
export const OCEAN_FRAMES = Array.from({ length: OCEAN_CFG.phases }, (_, p) => genOceanFrame(p));
// shoreline surge frames (separate loop/length from the ocean)
export const SHORE_FRAMES = Array.from({ length: SHORE_CFG.phases }, (_, p) => genShoreFrame(p));
