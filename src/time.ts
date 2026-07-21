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

// clock display, formatted for the player's locale
export function formatWorldTime(wt: number): string {
  return new Date(wt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// day/night cycle — drives a brightness tint on the world layer
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

// HUD clock icon: night runs 18:00-06:00, daylight the rest. Coarser than
// dayPhaseOf on purpose — the icon is only ever a sun or a moon.
export function isNightOf(wt: number): boolean {
  const h = new Date(wt).getHours();
  return h >= 18 || h < 6;
}

export function dayPhaseOf(wt: number): DayPhase {
  const h = new Date(wt).getHours();
  if (h >= 6 && h < 8) return 'dawn';
  if (h >= 8 && h < 18) return 'day';
  if (h >= 18 && h < 21) return 'dusk';
  return 'night';
}
