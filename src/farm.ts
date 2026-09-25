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
// garden's home corner puts it at y23-30, a one-tile gap (y31) between them.
//
// The plot is described as ONE CORNER plus offsets, not four absolute edges,
// because the whole thing is movable: the dev layout tool drags it as a single
// structure (see the 'gardenbed' entry in STRUCT_ENTS) and everything below —
// fence ring, gate, planting beds — has to travel with it. Read the live plot
// through gardenAt(); GARDEN/DOOR_TILES/SLOTS are just the home-corner values,
// kept for the many places where the garden never moves at runtime.
export const GARDEN_HOME = { x: 28, y: 23 } as const;

// NOT a free parameter: the size traces the baked bed picture (GARDEN_BED,
// from garden-fence.svg). At GARDEN_BED_SCALE the art measures 10.91 x 7.99
// tiles and its own fence ring lands exactly on this rectangle's edges — left
// posts on the first column, right posts on the last, far rail on the first
// row, near rail on the last. Change one without re-deriving the other and the
// collider stops matching the fence you can see.
export const GARDEN_SIZE = { w: 11, h: 8 } as const;

// The gate: a single opening in the NEAR (bottom) rail, centred — that is
// where the reference art draws it, between posts at doubled sprite columns
// 118-127 and 186-195, which land three tiles wide at this offset from the
// plot's left edge. The far rail has no opening at all, so this is the only
// way in.
const GATE_OFF = { c0: 4, c1: 6 } as const;

// Six planting spots, three in each side bed, as offsets from the plot corner.
// The gate corridor is deliberately left clear from the opening all the way to
// the far rail, so a plant is never standing in the doorway and plant/gate
// hit-areas never overlap. Interior soil is inset one tile all round; these sit
// centred in the left bed and the right bed.
const BED_OFF = [
  { x: 2, y: 2 }, { x: 8, y: 2 },
  { x: 2, y: 4 }, { x: 8, y: 4 },
  { x: 2, y: 6 }, { x: 8, y: 6 },
] as const;

// One gate now, not the old top/bottom pair. Kept as a named id rather than a
// bare boolean so the hover/click plumbing in interact.ts (which addresses
// things by ref) needs no special case.
export type DoorId = 'gate';
export type Doors = { gate: boolean }; // true = open

export interface GardenPlot {
  rect: { x0: number; y0: number; x1: number; y1: number };
  door: { c0: number; c1: number };
  slots: { x: number; y: number }[];
}

// The whole plot resolved against a corner. Everything that needs to know where
// the garden IS goes through here, so a dragged bed moves its fence, its gate
// and its beds together or not at all.
export function gardenAt(x: number, y: number): GardenPlot {
  return {
    rect: { x0: x, y0: y, x1: x + GARDEN_SIZE.w - 1, y1: y + GARDEN_SIZE.h - 1 },
    door: { c0: x + GATE_OFF.c0, c1: x + GATE_OFF.c1 },
    slots: BED_OFF.map((b) => ({ x: x + b.x, y: y + b.y })),
  };
}

export const GARDEN_PLOT: GardenPlot = gardenAt(GARDEN_HOME.x, GARDEN_HOME.y);
export const GARDEN = GARDEN_PLOT.rect;
export const DOOR_TILES = GARDEN_PLOT.door;
export const SLOTS = GARDEN_PLOT.slots;

export const TILE_CH = 4;
export const TILE_LN = 2;

// ---- collision ------------------------------------------------------------
// Is tile (tx,ty) a solid fence cell given the current door state?
function solidFence(tx: number, ty: number, doors: Doors, plot: GardenPlot): boolean {
  const { x0, y0, x1, y1 } = plot.rect;
  const onTop = ty === y0 && tx >= x0 && tx <= x1;
  const onBottom = ty === y1 && tx >= x0 && tx <= x1;
  const onLeft = tx === x0 && ty >= y0 && ty <= y1;
  const onRight = tx === x1 && ty >= y0 && ty <= y1;
  if (!(onTop || onBottom || onLeft || onRight)) return false;
  // Only the near rail has an opening, and only while the gate is swung open —
  // the far rail is solid pickets end to end in the art, so it never yields.
  const inDoorCols = tx >= plot.door.c0 && tx <= plot.door.c1;
  if (onBottom && inDoorCols && doors.gate) return false;
  return true;
}

// Would a player whose top-left is (nx,ny), sized (pw,ph) tiles, overlap a
// solid fence cell? Used to block movement through the fence.
export function gardenBlocks(
  nx: number, ny: number, pw: number, ph: number, doors: Doors,
  plot: GardenPlot = GARDEN_PLOT,
): boolean {
  for (let ty = ny; ty < ny + ph; ty++) {
    for (let tx = nx; tx < nx + pw; tx++) {
      if (solidFence(tx, ty, doors, plot)) return true;
    }
  }
  return false;
}

// ---- interaction targets --------------------------------------------------
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

// ---- placed-item effects --------------------------------------------------
// A crafted item placed near the beds can bend a slot's timings (see
// craft/functions.ts). The three functions below take the already-aggregated,
// already-clamped bundle for THIS slot and stay pure — App.tsx owns computing
// it from placedItems. Defaulting to NO_EFFECT keeps every plain call valid.
export interface SlotEffect {
  growMult: number; // multiplies growMs — below 1 matures sooner
  toleranceMult: number; // multiplies toleranceMs — above 1 survives thirst longer
  yieldBonus: number; // extra crops at harvest
}

export const NO_EFFECT: SlotEffect = { growMult: 1, toleranceMult: 1, yieldBonus: 0 };

export function cropStatus(c: PlantedCrop, wt: number, fx: SlotEffect = NO_EFFECT): CropStatus {
  const dueAt = c.lastWateredAt + c.care.waterEveryMs;
  const failAt = dueAt + c.care.toleranceMs * fx.toleranceMult;
  const growMs = c.care.growMs * fx.growMult;
  const matureAt = c.plantedAt + growMs;
  return {
    thirsty: wt > dueAt,
    msToDue: dueAt - wt,
    msToFail: failAt - wt,
    msToMature: matureAt - wt,
    progress: Math.max(0, Math.min(1, (wt - c.plantedAt) / growMs)),
  };
}

// Pure stage transition, evaluated on the clock tick.
export function advanceStage(c: PlantedCrop, wt: number, fx: SlotEffect = NO_EFFECT): CropStage {
  if (c.stage !== 'growing') return c.stage;
  const dueAt = c.lastWateredAt + c.care.waterEveryMs;
  const failAt = dueAt + c.care.toleranceMs * fx.toleranceMult;
  const matureAt = c.plantedAt + c.care.growMs * fx.growMult;
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
export function slotSprite(c: PlantedCrop, wt: number, fx: SlotEffect = NO_EFFECT): string[] {
  if (c.stage === 'failed') return WILTED;
  if (c.stage === 'ready') return c.sprite;
  const { progress } = cropStatus(c, wt, fx);
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
export const PLANTABLE_BASE: ItemType[] = ['flower', 'cactus', 'fern', 'date', 'iceflower'];

// Is an entity/spawn inside the garden footprint? Used to keep wild spawns out.
export function inGarden(x: number, y: number, plot: GardenPlot = GARDEN_PLOT): boolean {
  const { x0, y0, x1, y1 } = plot.rect;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// Just the fence RING (rails and side posts), not the interior. Placement uses
// this rather than inGarden so crafted items can sit among the beds — an
// item's effect radius is measured to the crop slots, so it has to be able to
// get near them (see placement.ts).
export function isGardenFence(x: number, y: number, plot: GardenPlot = GARDEN_PLOT): boolean {
  if (!inGarden(x, y, plot)) return false;
  const { x0, y0, x1, y1 } = plot.rect;
  return x === x0 || x === x1 || y === y0 || y === y1;
}

// A planting bed itself — kept clear so an item never sits on top of a crop.
export function isCropSlot(x: number, y: number, plot: GardenPlot = GARDEN_PLOT): boolean {
  return plot.slots.some((s) => s.x === x && s.y === y);
}
