// ---------------------------------------------------------------------------
// Farming: garden geometry, fence rendering, per-plant care rules, and crop
// lifecycle. All pure — App.tsx owns the React state and wiring.
//
// Timescale: "fast minutes" mode. Crops mature in a few minutes and need
// watering every 1-3 min, scaled per plant by its care profile. Everything is
// in worldTime ms, so a future timeScale bump accelerates the whole farm.
// ---------------------------------------------------------------------------

import type { ItemType } from './world';
import type { Category, ShopItem } from './llm';

// ---- garden geometry (tile coordinates) -----------------------------------
// A fenced plot NORTH (above) of the house. The house sits at y32-35, so the
// garden occupies y23-30 with a one-tile gap (y31) between them. The doors sit
// on the LEFT of each rail (a walking corridor), and the planting beds fill the
// RIGHT — so a plant is never in the doorway and plant/door interactions never
// overlap.
export const GARDEN = { x0: 28, y0: 23, x1: 39, y1: 30 } as const;

// door opening = three tiles wide, on the left side of each rail (the corridor).
// The player enters here; the beds are kept clear of these columns.
export const DOOR_TILES = { c0: 29, c1: 31 } as const;

export type DoorId = 'top' | 'bottom';
export type Doors = { top: boolean; bottom: boolean }; // true = open

// six planting spots on the RIGHT side, well clear of the door columns (29-31)
// and both rails (y23, y30). Each is watered/inspected individually.
export const SLOTS: { x: number; y: number }[] = [
  { x: 33, y: 25 }, { x: 35, y: 25 }, { x: 37, y: 25 },
  { x: 33, y: 27 }, { x: 35, y: 27 }, { x: 37, y: 27 },
];

export const TILE_CH = 4;
export const TILE_LN = 2;

// ---- fence rendering ------------------------------------------------------
// Returns the fence+soil overlay as an array of strings sized to the garden's
// character box. Interior is a sparse soil texture; door gaps open/close.
export function gardenFence(doors: Doors): string[] {
  const wT = GARDEN.x1 - GARDEN.x0 + 1;
  const hT = GARDEN.y1 - GARDEN.y0 + 1;
  const W = wT * TILE_CH;
  const H = hT * TILE_LN;
  const dc0 = (DOOR_TILES.c0 - GARDEN.x0) * TILE_CH;
  const dc1 = (DOOR_TILES.c1 - GARDEN.x0) * TILE_CH + (TILE_CH - 1);

  const rail = (open: boolean) => {
    let s = '';
    for (let c = 0; c < W; c++) {
      const inDoor = c >= dc0 && c <= dc1;
      if (inDoor && open) s += ' ';
      else s += c % 4 === 0 ? '+' : '=';
    }
    return s;
  };

  const rows: string[] = [];
  for (let r = 0; r < H; r++) {
    if (r === 0) rows.push(rail(doors.top));
    else if (r === H - 1) rows.push(rail(doors.bottom));
    else {
      let s = '';
      for (let c = 0; c < W; c++) {
        if (c === 0 || c === W - 1) s += '|';
        else s += (c + r) % 6 === 0 ? '.' : ' ';
      }
      rows.push(s);
    }
  }
  return rows;
}

// ---- collision ------------------------------------------------------------
// Is tile (tx,ty) a solid fence cell given the current door states?
function solidFence(tx: number, ty: number, doors: Doors): boolean {
  const { x0, y0, x1, y1 } = GARDEN;
  const onTop = ty === y0 && tx >= x0 && tx <= x1;
  const onBottom = ty === y1 && tx >= x0 && tx <= x1;
  const onLeft = tx === x0 && ty >= y0 && ty <= y1;
  const onRight = tx === x1 && ty >= y0 && ty <= y1;
  if (!(onTop || onBottom || onLeft || onRight)) return false;
  const inDoorCols = tx >= DOOR_TILES.c0 && tx <= DOOR_TILES.c1;
  if (onTop && inDoorCols && doors.top) return false;
  if (onBottom && inDoorCols && doors.bottom) return false;
  return true;
}

// Would a player whose top-left is (nx,ny), sized (pw,ph) tiles, overlap a
// solid fence cell? Used to block movement through the fence.
export function gardenBlocks(
  nx: number, ny: number, pw: number, ph: number, doors: Doors,
): boolean {
  for (let ty = ny; ty < ny + ph; ty++) {
    for (let tx = nx; tx < nx + pw; tx++) {
      if (solidFence(tx, ty, doors)) return true;
    }
  }
  return false;
}

// ---- interaction targets --------------------------------------------------
// The bed is no longer a single target — each planted crop is interacted with
// individually (see nearestCropSlot). gardenTarget now only handles the doors.
export type GardenTarget = { kind: 'door'; door: DoorId; x: number; y: number };

// Chebyshev distance from the player box to a tile box.
function boxDist(px: number, py: number, pw: number, ph: number, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = b.x0 > px + pw - 1 ? b.x0 - (px + pw - 1) : px > b.x1 ? px - b.x1 : 0;
  const dy = b.y0 > py + ph - 1 ? b.y0 - (py + ph - 1) : py > b.y1 ? py - b.y1 : 0;
  return Math.max(dx, dy);
}

// Chebyshev distance from the player box to a single tile.
export function tileDist(px: number, py: number, pw: number, ph: number, tx: number, ty: number): number {
  return boxDist(px, py, pw, ph, { x0: tx, y0: ty, x1: tx, y1: ty });
}

// The slot index of the planted crop the player is standing next to (or -1).
// `occupied` is the set of slot indices that currently hold a crop.
export function nearestCropSlot(px: number, py: number, pw: number, ph: number, occupied: number[]): number {
  let best = -1;
  let bestD = 2;
  for (const i of occupied) {
    const s = SLOTS[i];
    const d = tileDist(px, py, pw, ph, s.x, s.y);
    if (d <= 1 && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

// Nearest door the player can interact with (open/close), or null.
export function gardenTarget(px: number, py: number, pw: number, ph: number): GardenTarget | null {
  const topBox = { x0: DOOR_TILES.c0, y0: GARDEN.y0, x1: DOOR_TILES.c1, y1: GARDEN.y0 };
  const botBox = { x0: DOOR_TILES.c0, y0: GARDEN.y1, x1: DOOR_TILES.c1, y1: GARDEN.y1 };
  const dTop = boxDist(px, py, pw, ph, topBox);
  const dBot = boxDist(px, py, pw, ph, botBox);

  const cands: { t: GardenTarget; d: number }[] = [];
  if (dTop <= 1) cands.push({ t: { kind: 'door', door: 'top', x: DOOR_TILES.c0, y: GARDEN.y0 }, d: dTop });
  if (dBot <= 1) cands.push({ t: { kind: 'door', door: 'bottom', x: DOOR_TILES.c0, y: GARDEN.y1 }, d: dBot });
  if (cands.length === 0) return null;
  cands.sort((a, b) => a.d - b.d);
  return cands[0].t;
}

// ---- plant care -----------------------------------------------------------
const MIN = 60_000;

export type Thirst = 'low' | 'medium' | 'high';

export interface PlantCare {
  thirst: Thirst;
  waterEveryMs: number; // how often it must be watered
  growMs: number; // time to mature once planted (and kept alive)
  toleranceMs: number; // grace after a watering is due before it wilts
  hint: string; // the "key to grow" shown to the player
}

const LOW_WORDS = ['cactus', 'succulent', 'aloe', 'agave', 'desert', 'thorn', 'sage', 'stone', 'sand', 'dry', 'rock', 'bonsai'];
const HIGH_WORDS = ['fern', 'moss', 'lily', 'lotus', 'rice', 'reed', 'tropical', 'jungle', 'swamp', 'water', 'berry', 'mango', 'vine', 'melon', 'mint', 'dew'];

// small deterministic 0..1 from a string, for per-plant variance
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// Context-fit care rules: a cactus tolerates neglect, a fern is thirsty.
// Deterministic per plant so the same plant always behaves the same.
export function careFor(name: string, category: Category | 'plant'): PlantCare {
  const p = name.toLowerCase();
  let thirst: Thirst = 'medium';
  if (LOW_WORDS.some((w) => p.includes(w))) thirst = 'low';
  else if (HIGH_WORDS.some((w) => p.includes(w))) thirst = 'high';
  else if (category === 'food') thirst = 'high'; // fruits/veg drink a lot

  const v = hash01(name); // 0..1 variance
  const scale = 0.8 + v * 0.4; // 0.8..1.2

  let waterEveryMs: number, growMs: number, toleranceMs: number;
  if (thirst === 'low') {
    waterEveryMs = 3 * MIN * scale;
    growMs = 8 * MIN * scale;
    toleranceMs = 4 * MIN;
  } else if (thirst === 'high') {
    waterEveryMs = 1 * MIN * scale;
    growMs = 3.5 * MIN * scale;
    toleranceMs = 1 * MIN;
  } else {
    waterEveryMs = 2 * MIN * scale;
    growMs = 6 * MIN * scale;
    toleranceMs = 2.5 * MIN;
  }

  const wm = Math.round(waterEveryMs / MIN);
  const gm = Math.round(growMs / MIN);
  const hint =
    thirst === 'low'
      ? `Hardy and drought-loving. Water about every ${wm} min — it forgives a late soak. Matures in ~${gm} min.`
      : thirst === 'high'
        ? `Thirsty! Water about every ${wm} min or it wilts fast. Rewards you quickly — matures in ~${gm} min.`
        : `Keep the soil damp: water about every ${wm} min. Matures in ~${gm} min. Don't let it dry out for too long.`;

  return { thirst, waterEveryMs, growMs, toleranceMs, hint };
}

// ---- crops ----------------------------------------------------------------
export type CropStage = 'growing' | 'ready' | 'failed';

// What a harvested crop yields back to the player.
export type Harvest =
  | { kind: 'base'; it: ItemType }
  | { kind: 'owned'; item: ShopItem };

export interface PlantedCrop {
  id: string;
  slot: number;
  name: string;
  sprite: string[];
  care: PlantCare;
  harvest: Harvest;
  plantedAt: number; // worldTime ms
  lastWateredAt: number;
  stage: CropStage;
}

export interface CropStatus {
  thirsty: boolean;
  msToDue: number; // until watering is due (negative = overdue)
  msToFail: number; // until it wilts if not watered
  msToMature: number;
  progress: number; // 0..1 growth
}

export function cropStatus(c: PlantedCrop, wt: number): CropStatus {
  const dueAt = c.lastWateredAt + c.care.waterEveryMs;
  const failAt = dueAt + c.care.toleranceMs;
  const matureAt = c.plantedAt + c.care.growMs;
  return {
    thirsty: wt > dueAt,
    msToDue: dueAt - wt,
    msToFail: failAt - wt,
    msToMature: matureAt - wt,
    progress: Math.max(0, Math.min(1, (wt - c.plantedAt) / c.care.growMs)),
  };
}

// Pure stage transition, evaluated on the clock tick.
export function advanceStage(c: PlantedCrop, wt: number): CropStage {
  if (c.stage !== 'growing') return c.stage;
  const dueAt = c.lastWateredAt + c.care.waterEveryMs;
  const failAt = dueAt + c.care.toleranceMs;
  const matureAt = c.plantedAt + c.care.growMs;
  if (wt > failAt) return 'failed';
  if (wt >= matureAt) return 'ready';
  return 'growing';
}

// ---- slot sprites ---------------------------------------------------------
export const EMPTY_SLOT = ['   ', '.:.'];
const SPROUT_1 = ['   ', ' , '];
const SPROUT_2 = [' v ', ' | '];
const SPROUT_3 = ['\\|/', ' | '];
const WILTED = ['x_x', '/|\\'];

// The little sprite shown in a bed slot for the crop's current state.
export function slotSprite(c: PlantedCrop, wt: number): string[] {
  if (c.stage === 'failed') return WILTED;
  if (c.stage === 'ready') return c.sprite;
  const { progress } = cropStatus(c, wt);
  if (progress < 0.34) return SPROUT_1;
  if (progress < 0.7) return SPROUT_2;
  return SPROUT_3;
}

// Build a freshly planted crop, deriving its care profile from its name.
export function createCrop(
  slot: number,
  name: string,
  sprite: string[],
  category: Category | 'plant',
  harvest: Harvest,
  wt: number,
): PlantedCrop {
  return {
    id: `crop-${wt}-${slot}-${Math.floor(Math.random() * 1e6)}`,
    slot,
    name,
    sprite,
    care: careFor(name, category),
    harvest,
    plantedAt: wt,
    lastWateredAt: wt,
    stage: 'growing',
  };
}

// Base world items that make sense to plant (stone is excluded).
export const PLANTABLE_BASE: ItemType[] = ['flower', 'cactus', 'fern', 'apple', 'iceflower'];

// Is an entity/spawn inside the garden footprint? Used to keep wild spawns out.
export function inGarden(x: number, y: number): boolean {
  return x >= GARDEN.x0 && x <= GARDEN.x1 && y >= GARDEN.y0 && y <= GARDEN.y1;
}
