// One save blob for everything — time anchor, player, world exceptions.
// World state and player state live in the same versioned object so they can
// never desync. Derived state (wild spawns, shop stock, weather) is NOT
// saved; it regenerates from worldTime seeds.

import type { ItemType } from './world';
import type { OwnedItem } from './llm';

export interface SaveState {
  version: 1;
  // time config
  anchor: number;
  anchorReal: number;
  timeScale: number;
  // player
  player: { x: number; y: number };
  inv: Record<ItemType, number>;
  money: number;
  storages: Record<ItemType, number>[];
  bag: OwnedItem[];
  equippedId: string | null;
  // world exceptions (window-scoped ids self-invalidate when windows change)
  removedIds: string[];
  shaken: string[];
  // step 5 (farming) extends this same object
  plantedCrops: unknown[];
}

const KEY = 'ascii-village-save';

export function loadSave(): SaveState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // future schema changes: bump version, add a migration here
    if (!s || s.version !== 1) return null;
    return s as SaveState;
  } catch {
    return null;
  }
}

export function writeSave(s: SaveState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full/blocked — the game keeps running, just without autosave
  }
}
