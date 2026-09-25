// The single clock everything in the game derives from. No game system reads
// Date.now() directly (frame/animation timing via performance.now() is the
// one deliberate exception — it must stay real even at timeScale > 1).
//
//   worldTime = anchor + (Date.now() - anchorReal) * timeScale
//
// timeScale 1 = real time (current mode). Switching to accelerated time
// later is a config change, not a rewrite.

export interface TimeConfig {
  anchor: number; // worldTime (ms) at the moment anchorReal was taken
  anchorReal: number; // Date.now() when anchored
  timeScale: number;
}

export function defaultTimeConfig(): TimeConfig {
  const now = Date.now();
  return { anchor: now, anchorReal: now, timeScale: 1 };
}

export function worldTime(cfg: TimeConfig, realNow = Date.now()): number {
  return cfg.anchor + (realNow - cfg.anchorReal) * cfg.timeScale;
}

// ---- pure derivations ----

export const HOUR_MS = 3600_000;

// shop restock window
export const hourSeedOf = (wt: number) => Math.floor(wt / HOUR_MS);

// wild flora/stones re-roll their spawns when this window changes
export const GROWTH_TICK_MS = 6 * HOUR_MS;
export const growthWindowOf = (wt: number) => Math.floor(wt / GROWTH_TICK_MS);

// Daily allowances (craft tokens, granted coins) reset when this changes.
// UTC-aligned rather than local-midnight, unlike isNightOf's display clock —
// a counter only needs a stable boundary, not one that matches the HUD.
export const DAY_MS = 24 * HOUR_MS;
export const daySeedOf = (wt: number) => Math.floor(wt / DAY_MS);

// clock display, formatted for the player's locale
export function formatWorldTime(wt: number): string {
  return new Date(wt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// The day/night PALETTE that used to live here is gone: the world no longer
// shifts colour with the clock, so every layer is a fixed colour in
// styles.css. The clock itself stays — shop restock and the palms regrowing
// their dates both key off it.

// HUD clock icon: night runs 18:00-06:00, daylight the rest.
export function isNightOf(wt: number): boolean {
  const h = new Date(wt).getHours();
  return h >= 18 || h < 6;
}
