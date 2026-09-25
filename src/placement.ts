// Free-form world placement of an owned item — a decoration/furniture object
// dropped anywhere on land via the mouse-driven ghost cursor (see App.tsx's
// placement-mode state). Mirrors farm.ts's role (pure logic, no React), but
// deliberately does NOT reuse farm.ts's fixed-SLOTS/auto-assign shape: this is
// arbitrary (x,y) + rotation + real collision, unlike crop planting.

import {
  type Ent,
  MAP_W,
  MAP_H,
  isWater,
  isFoamZone,
  spriteTiles,
  collisionBox,
  tileBoxesOverlap,
} from './world';
import { isGardenFence, isCropSlot, GARDEN_PLOT } from './farm';
import type { GardenPlot } from './farm';
import type { ShopItem, OwnedItem, Category } from './llm';
import type { TextureModifier } from './craft';
import type { ItemFunction } from './craft/functions';

export interface PlacedItem {
  id: string; // placement-instance id, e.g. `placed-${Date.now()}-${n}`
  name: string;
  category: Category;
  sprite: string[];
  desc: string;
  funcDesc: string;
  price: number;
  kind: 'item'; // tokens are excluded at the UI gate, never reach here
  tool?: 'water';
  color?: string;
  palette?: Record<string, string>;
  colors?: string[];
  scale?: number;
  tags?: string[]; // crafted items only — see ShopItem.tags
  textureModifier?: TextureModifier; // crafted items only — see ShopItem.textureModifier
  fn?: ItemFunction; // crafted items only — the effect this applies once placed
  equip: ShopItem['equip']; // preserved so pickup fully restores the original item
  x: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
}

export function ownedToPlaced(o: OwnedItem, x: number, y: number, rotation: 0 | 1 | 2 | 3, id: string): PlacedItem {
  const { ownedId: _drop, kind: _kind, ...rest } = o;
  return { ...rest, kind: 'item', id, x, y, rotation };
}

export function placedToOwned(p: PlacedItem, ownedId: string): OwnedItem {
  const { x: _x, y: _y, rotation: _r, ...rest } = p;
  return { ...rest, ownedId };
}

// Ent-shaped view for the shared collision/z-order machinery (blocked(),
// z-index via footprint()). interactable:false — placed items are picked up
// via their own click handler (PlacedItemView), not the hover/click confirm
// flow in interact.ts, so they never fight it for the same click.
export function placedToEnt(p: PlacedItem): Ent {
  return {
    id: p.id,
    kind: 'placed',
    x: p.x,
    y: p.y,
    sprite: p.sprite,
    interactable: false,
    palette: p.palette,
    colors: p.colors,
    scale: p.scale,
    rotation: p.rotation,
  };
}

// Would a candidate (rotation-aware) footprint be a legal spot? Stricter than
// movement collision: ANY bbox overlap with another entity (not just a solid
// glyph) is rejected, so placed decor never visually clips into a tree/
// building/other placed item, and the shoreline is off limits outright.
//
// The garden is a partial exception: its FENCE and its six planting beds are
// blocked, but the interior walkway is open, so a crafted item's effect can
// actually reach the crops it is meant to affect (see craft/functions.ts —
// radii are small, and outside the fence the nearest crop is already 3 tiles
// away).
export function placementFits(
  candidate: { x: number; y: number; sprite: string[]; scale?: number; rotation: 0 | 1 | 2 | 3 },
  ents: Ent[],
  excludeId?: string,
  // Defaults to the garden's home corner; App.tsx passes the live plot so the
  // exception below follows a bed the dev layout tool has dragged.
  plot: GardenPlot = GARDEN_PLOT,
): boolean {
  const { wT, hT } = spriteTiles(candidate.sprite, candidate.scale, candidate.rotation);
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + wT > MAP_W || candidate.y + hT > MAP_H) return false;
  for (let ty = candidate.y; ty < candidate.y + hT; ty++) {
    for (let tx = candidate.x; tx < candidate.x + wT; tx++) {
      if (isWater(tx, ty) || isFoamZone(tx, ty)) return false;
      if (isGardenFence(tx, ty, plot) || isCropSlot(tx, ty, plot)) return false;
    }
  }
  const cbox = collisionBox(candidate);
  for (const e of ents) {
    if (e.id === excludeId) continue;
    if (tileBoxesOverlap(cbox, collisionBox(e))) return false;
  }
  return true;
}
