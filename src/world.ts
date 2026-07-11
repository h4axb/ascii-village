import * as S from './sprites';

// The map is a 28x16 tile grid. Each tile is 4 characters wide and 2 lines
// tall, so the ground layer is a 112x32 character field. Entities are
// positioned at tile coordinates; horizontal placement uses `ch` units and
// vertical placement uses `em` units (line-height: 1) so everything stays
// locked to the monospace character grid.
export const MAP_W = 80;
export const MAP_H = 80;
export const TILE_CH = 4; // chars per tile (x)
export const TILE_LN = 2; // lines per tile (y)
export const GROUND_W = MAP_W * TILE_CH; // 112
export const GROUND_H = MAP_H * TILE_LN; // 32

export type ItemType = 'flower' | 'stone' | 'apple' | 'cactus' | 'fern' | 'iceflower';
export type EntityKind = ItemType | 'appleTree' | 'emptyTree' | 'shop' | 'cat' | 'house';

// ---------------------------------------------------------------------------
// Biomes: temperature/moisture value-noise maps derive a biome per tile.
// Deterministic and pure — the biome map never changes at runtime.
// ---------------------------------------------------------------------------

export type Biome = 'meadow' | 'desert' | 'jungle' | 'tundra' | 'rocky';

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const gx = Math.floor(x / scale);
  const gy = Math.floor(y / scale);
  const fx = x / scale - gx;
  const fy = y / scale - gy;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash2(gx, gy, seed);
  const b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed);
  const d = hash2(gx + 1, gy + 1, seed);
  const u = s(fx);
  const v = s(fy);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// the village and its surroundings are always friendly meadow
const VILLAGE = { x: 24, y: 6, r: 15 };

export function biomeAt(tx: number, ty: number): Biome {
  if (Math.hypot(tx - VILLAGE.x, ty - VILLAGE.y) < VILLAGE.r) return 'meadow';
  const temp = valueNoise(tx, ty, 26, 911);
  const moist = valueNoise(tx, ty, 26, 353);
  if (temp > 0.6 && moist < 0.5) return 'desert';
  if (temp < 0.4) return 'tundra';
  if (moist > 0.62) return 'jungle';
  if (moist < 0.34) return 'rocky';
  return 'meadow';
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

// An entity's footprint is the bottom row of tiles it covers. Only
// footprints collide, so the player can walk "behind" tall sprites.
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

// Permanent, hand-placed world structures. These never regenerate.
export const STRUCT_ENTS: Ent[] = [
  { id: 'shop', kind: 'shop', x: 30, y: 2, sprite: S.SHOP, interactable: true },
  { id: 'house', kind: 'house', x: 12, y: 2, sprite: S.HOUSE, interactable: true },
  { id: 'cat', kind: 'cat', x: 27, y: 4, sprite: S.CAT, interactable: true },
  { id: 'atree', kind: 'appleTree', x: 3, y: 1, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree2', kind: 'appleTree', x: 46, y: 20, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree3', kind: 'appleTree', x: 6, y: 40, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree4', kind: 'appleTree', x: 64, y: 8, sprite: S.APPLE_TREE, interactable: true },
  { id: 'atree5', kind: 'appleTree', x: 58, y: 62, sprite: S.APPLE_TREE, interactable: true },
  { id: 'etree1', kind: 'emptyTree', x: 10, y: 9, sprite: S.TREE2, interactable: true },
  { id: 'etree2', kind: 'emptyTree', x: 23, y: 8, sprite: S.TREE3, interactable: true },
  { id: 'etree3', kind: 'emptyTree', x: 42, y: 6, sprite: S.TREE2, interactable: true },
  { id: 'etree4', kind: 'emptyTree', x: 8, y: 22, sprite: S.TREE3, interactable: true },
  { id: 'etree5', kind: 'emptyTree', x: 30, y: 44, sprite: S.TREE2, interactable: true },
  { id: 'etree6', kind: 'emptyTree', x: 48, y: 50, sprite: S.TREE3, interactable: true },
  { id: 'etree7', kind: 'emptyTree', x: 16, y: 56, sprite: S.TREE2, interactable: true },
  { id: 'etree8', kind: 'emptyTree', x: 70, y: 28, sprite: S.TREE3, interactable: true },
  { id: 'etree9', kind: 'emptyTree', x: 58, y: 44, sprite: S.TREE2, interactable: true },
  { id: 'etree10', kind: 'emptyTree', x: 36, y: 70, sprite: S.TREE3, interactable: true },
  { id: 'etree11', kind: 'emptyTree', x: 72, y: 66, sprite: S.TREE2, interactable: true },
];

// Wild spawns regenerate deterministically per growth window: same window →
// same layout. Ids embed the window number so saved "removed" exceptions
// self-invalidate when the window changes. Each biome has its own spawn
// pool, so what you find depends on where you explore.
const BIOME_POOL: Record<Biome, { kind: EntityKind; sprite: string[]; count: number }[]> = {
  meadow: [
    { kind: 'flower', sprite: S.FLOWER, count: 8 },
    { kind: 'stone', sprite: S.STONE, count: 5 },
  ],
  desert: [
    { kind: 'cactus', sprite: S.CACTUS, count: 7 },
    { kind: 'stone', sprite: S.STONE, count: 4 },
  ],
  jungle: [
    { kind: 'fern', sprite: S.FERN, count: 8 },
    { kind: 'flower', sprite: S.FLOWER, count: 3 },
  ],
  tundra: [
    { kind: 'iceflower', sprite: S.ICEFLOWER, count: 7 },
    { kind: 'stone', sprite: S.STONE, count: 3 },
  ],
  rocky: [{ kind: 'stone', sprite: S.STONE, count: 9 }],
};

export function wildSpawns(window: number): Ent[] {
  const rnd = mulberry32((window | 0) * 7919 + 23);
  const taken = STRUCT_ENTS.map((e) => footprint(e));
  const out: Ent[] = [];
  for (const biome of Object.keys(BIOME_POOL) as Biome[]) {
    for (const { kind, sprite, count } of BIOME_POOL[biome]) {
      const { wT, hT } = spriteTiles(sprite);
      for (let i = 0; i < count; i++) {
        // rejection sampling: keep rolling spots until one lands in the
        // right biome and doesn't clash with anything already placed
        for (let attempt = 0; attempt < 60; attempt++) {
          const x = Math.floor(rnd() * (MAP_W - wT));
          const y = Math.floor(rnd() * (MAP_H - hT));
          if (biomeAt(x + Math.floor(wT / 2), y + Math.floor(hT / 2)) !== biome) continue;
          const f = footprint({ x, y, sprite });
          const clash = taken.some((t) => t.row === f.row && f.x0 <= t.x1 && f.x1 >= t.x0);
          if (clash) continue;
          taken.push(f);
          out.push({
            id: `${kind}-${biome}-${window}-${i}`,
            kind,
            x,
            y,
            sprite,
            interactable: true,
          });
          break;
        }
      }
    }
  }
  return out;
}

// The player starts in front of their house.
export const PLAYER_SPAWN = { x: 13, y: 5 };

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// each biome scatters its own texture characters onto the ground
const BIOME_SCATTER: Record<Biome, { chars: string[]; density: number }> = {
  meadow: { chars: ['.', ':', '"', '.', "'", '.'], density: 0.045 },
  desert: { chars: ['.', '~', "'", '.', '~'], density: 0.03 },
  jungle: { chars: ['"', '#', '*', '"', ':', '"'], density: 0.09 },
  tundra: { chars: ['*', '.', "'", '.', '*'], density: 0.035 },
  rocky: { chars: ['^', '.', ',', 'o', '^'], density: 0.055 },
};

function genGround(): string {
  const rnd = mulberry32(1337);
  const g: string[][] = Array.from({ length: GROUND_H }, () =>
    Array<string>(GROUND_W).fill(' '),
  );
  // per-biome texture scatter
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      const { chars, density } = BIOME_SCATTER[biomeAt(Math.floor(x / TILE_CH), Math.floor(y / TILE_LN))];
      if (rnd() < density) g[y][x] = chars[Math.floor(rnd() * chars.length)];
    }
  }
  // two winding paths, spaced across the map's height
  for (const base of [Math.round(GROUND_H * 0.3), Math.round(GROUND_H * 0.72)]) {
    for (let x = 0; x < GROUND_W; x++) {
      const cy = base + Math.round(Math.sin(x / 13) * 2.2);
      if (rnd() < 0.92) g[cy][x] = '~';
      if (rnd() < 0.7) g[cy + 1][x] = '~';
    }
  }
  // bush clusters, scattered proportionally to the map area
  const centers: number[][] = [];
  const nClusters = Math.round((GROUND_W * GROUND_H) / 1400);
  for (let i = 0; i < nClusters; i++) {
    centers.push([Math.floor(rnd() * GROUND_W), Math.floor(rnd() * GROUND_H)]);
  }
  for (const [cx, cy] of centers) {
    // bushes only grow where it's green
    const b = biomeAt(Math.floor(cx / TILE_CH), Math.floor(cy / TILE_LN));
    if (b !== 'meadow' && b !== 'jungle') continue;
    const n = 5 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const x = cx + Math.floor(rnd() * 7) - 3;
      const y = cy + Math.floor(rnd() * 3) - 1;
      if (x >= 0 && x < GROUND_W && y >= 0 && y < GROUND_H) g[y][x] = '#';
    }
  }
  return g.map((r) => r.join('')).join('\n');
}

export const GROUND_TEXT = genGround();
