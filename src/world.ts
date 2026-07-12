import * as S from './sprites';

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

function islandNd(tx: number, ty: number): number {
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

// An entity's footprint is the bottom row of tiles it covers. Only footprints
// collide, so the player can walk "behind" tall sprites.
export function footprint(e: { x: number; y: number; sprite: string[] }) {
  const { wT, hT } = spriteTiles(e.sprite);
  return { row: e.y + hT - 1, x0: e.x, x1: e.x + wT - 1 };
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
  const taken = STRUCT_ENTS.map((e) => footprint(e));
  const out: Ent[] = [];
  for (const region of Object.keys(REGION_POOL) as SpawnRegion[]) {
    for (const { kind, sprite, count } of REGION_POOL[region]) {
      const { wT, hT } = spriteTiles(sprite);
      for (let i = 0; i < count; i++) {
        // rejection sampling: keep rolling spots until one lands in the right
        // region (which is never ocean) and doesn't clash with anything placed
        for (let attempt = 0; attempt < 60; attempt++) {
          const x = Math.floor(rnd() * (MAP_W - wT));
          const y = Math.floor(rnd() * (MAP_H - hT));
          if (regionAt(x + Math.floor(wT / 2), y + Math.floor(hT / 2)) !== region) continue;
          const f = footprint({ x, y, sprite });
          const clash = taken.some((t) => t.row === f.row && f.x0 <= t.x1 && f.x1 >= t.x0);
          if (clash) continue;
          taken.push(f);
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
  beach: { chars: ['.', ':', '.', "'", ' '], density: 0.1 },
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
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      const r = regionAt(Math.floor(x / TILE_CH), Math.floor(y / TILE_LN));
      if (r === 'ocean') continue;
      const sc = SCATTER[r];
      if (rnd() < sc.density) grids[r][y][x] = sc.chars[Math.floor(rnd() * sc.chars.length)];
    }
  }
  return (Object.keys(grids) as LandRegion[]).map((region) => ({ region, text: joinGrid(grids[region]) }));
}

function genOceanFrame(phase: number): string {
  const g = emptyGrid();
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      if (!isWater(Math.floor(x / TILE_CH), Math.floor(y / TILE_LN))) continue;
      const w = Math.sin(x * 0.5 + y * 0.35 + phase * 1.4);
      g[y][x] = w > 0.55 ? ' ' : '~';
    }
  }
  return joinGrid(g);
}

// land colour layers (back-to-front order doesn't matter — regions don't overlap)
export const LAND_LAYERS = genLandLayers();
// wave animation frames the app cycles through
export const OCEAN_FRAMES = [0, 1, 2, 3].map(genOceanFrame);
