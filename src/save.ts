// One save blob for everything — time anchor, player, world exceptions.
// World state and player state live in the same versioned object so they can
// never desync. Derived state (wild spawns, shop stock, weather) is NOT
// saved; it regenerates from worldTime seeds.

import type { ItemType } from './world';
import type { OwnedItem } from './llm';
import type { PlantedCrop, Doors } from './farm';
import type { PlacedItem } from './placement';
import type { Outfit } from './outfit';

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
  // step 5 (farming): planted crops + garden door states
  plantedCrops: PlantedCrop[];
  doors?: Doors;
  // player-placed decorations/furniture, anywhere on the map (see placement.ts)
  placed?: PlacedItem[];
  // Daily allowances, both keyed by daySeedOf(wt). Same self-invalidating
  // idiom as removedIds/shaken: a stale `day` reads as a fresh zero rather
  // than needing a reset pass anywhere.
  tokenBuys?: { day: number; n: number }; // craft tokens bought today (cap 3)
  coinGrants?: { day: number; total: number }; // coins granted by items today
  // Player outfit colour override, set via the laundry-line interaction —
  // see interact.ts/outfit.ts.
  outfit?: Outfit;
  // What's currently hanging on each clothesline hotspot (keyed by hotspot
  // id) — the other half of the wardrobe swap. Absent = still baked default.
  lineColors?: Record<string, string>;
  // Player's chosen display name, set during Intro Part B's name-entry
  // panel. Absent on pre-Part-B saves; falls back to a default elsewhere.
  playerName?: string;
  // Whether the unified onboarding intro (laptop/MYLL prologue -> wake up
  // on the island -> meet Mitchy) has already played. Absent means "not
  // yet" for a brand-new save, but existing saves written before the intro
  // existed are treated as already-done (see App.tsx) so returning players
  // are never forced through it retroactively. Was `introPartBDone` before
  // "Part A"/"Part B" were unified into one continuous intro controller —
  // see migrate()'s introPartBDoneToIntroDone().
  introDone?: boolean;
  // Mitchy's live world position once Intro Part B has moved him off his
  // STRUCT_ENTS static spot (he ends the cinematic waiting by MITCHY EXIT,
  // not his original x:35,y:33). Absent = still at the static position —
  // see world.ts's STRUCT_ENTS 'cat' entry / App.tsx's `ents` override.
  mitchyPos?: { x: number; y: number };
}

const KEY = 'ascii-village-save';

// The apple tree became a date palm, and the item id 'apple' became 'date'.
// Saves written before that swap still hold 'apple' counts, and the item ids
// are localStorage keys — without this, anyone with a save would silently lose
// their fruit (and end up with an undefined count in its place).
type Counts = Record<ItemType, number>;

function appleToDate(r: Counts | undefined): Counts | undefined {
  if (!r || !('apple' in r)) return r;
  const { apple, ...rest } = r as Counts & { apple?: number };
  return { ...rest, date: (rest.date ?? 0) + (apple ?? 0) } as Counts;
}

// The garden used to have two doorways ({top, bottom}); the bed art it now
// traces (see GARDEN_BED) draws a single centre gate, so Doors became {gate}.
// Saves written before that carry the old pair. The old BOTTOM door sat in the
// same rail the gate does, so it carries over; the top one is gone with the
// doorway it opened.
function doorsToGate(d: Doors | undefined): Doors | undefined {
  if (!d) return d;
  const legacy = d as Partial<Doors> & { top?: boolean; bottom?: boolean };
  if ('gate' in legacy && legacy.gate !== undefined) return { gate: legacy.gate };
  return { gate: legacy.bottom ?? false };
}

// Intro Part A/Part B were two separately-built systems that got unified
// into one continuous 18-stage intro controller (see App.tsx/IntroA.tsx).
// Saves written while the field was still called `introPartBDone` carry
// that name instead of `introDone` — migrate the value across once, then
// drop the old field so new saves only ever contain `introDone`.
function introPartBDoneToIntroDone(s: SaveState): SaveState {
  const legacy = s as SaveState & { introPartBDone?: boolean };
  if (legacy.introDone === undefined && legacy.introPartBDone !== undefined) {
    s.introDone = legacy.introPartBDone;
  }
  delete legacy.introPartBDone;
  return s;
}

function migrate(s: SaveState): SaveState {
  s.doors = doorsToGate(s.doors);
  s.inv = appleToDate(s.inv) as Counts;
  if (Array.isArray(s.storages)) s.storages = s.storages.map((st) => appleToDate(st) as Counts);
  // planted crops record which base item they yield
  if (Array.isArray(s.plantedCrops)) {
    for (const c of s.plantedCrops) {
      const h = c.harvest as { kind: string; it?: string };
      if (h && h.kind === 'base' && h.it === 'apple') h.it = 'date';
    }
  }
  s = introPartBDoneToIntroDone(s);
  return s;
}

// Shared by loadSave() (localStorage) and the start screen's Upload Save
// import (a file's text) — the same JSON needs the same version-check +
// migration either way.
export function parseSave(raw: string): SaveState | null {
  try {
    const s = JSON.parse(raw);
    // future schema changes: bump version, add a migration here
    if (!s || s.version !== 1) return null;
    return migrate(s as SaveState);
  } catch {
    return null;
  }
}

export function loadSave(): SaveState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseSave(raw);
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

// Start Screen -> New Game: deletes ONLY the gameplay save, by its exact
// key — never localStorage.clear(), which would also wipe unrelated
// developer/editor persistence (Scene Markings, devWorldAssets overrides,
// dev layout state, etc.) that happens to live in the same origin's
// localStorage.
export function deleteSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage blocked — nothing to delete
  }
}

// Safari's ITP wipes script-writable storage (localStorage included) after 7
// days of Safari use with no interaction on the site — for a fully
// client-side game (no backend) this download is the recovery path: the
// player can re-import it via the start screen's Upload Save if their
// browser ever clears the real save.
export function downloadSaveFile(s: SaveState) {
  const blob = new Blob([JSON.stringify(s)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ascii-village-save.json';
  a.click();
  URL.revokeObjectURL(url);
}
