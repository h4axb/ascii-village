// Persisted record of every successful craft, for the workshop's History
// drawer. Its own localStorage key (separate from the game save) so it can be
// read/appended without threading through the big SaveState blob.

import type { TextureModifier } from './craft';
import { parseItemFunction, type ItemFunction } from './craft/functions';

// Re-clamping an already-stored record, not gating fresh LLM output — the
// stored fn already reflects whatever intent gate applied at craft time, so
// this just needs to preserve it rather than deciding it again.
const ALREADY_GATED = { requested: true } as const;

export interface CraftRecord {
  id: string;
  name: string;
  prompt: string; // what the player actually typed — the drawer shows this, not the name
  category: string;
  sprite: string[];
  color?: string;
  palette?: Record<string, string>; // per-region colour (paint-by-number), when present
  colors?: string[]; //               grid same shape as sprite, cells = palette keys
  textureModifier?: TextureModifier; // visual finish effect — see ColoredSprite's `texture` prop
  punchline: string; // the item's funcDesc, shown in quotes
  fn?: ItemFunction; // the translated function — re-clamped on load, see below
  at: number; // Date.now()
}

const KEY = 'asciia-craft-history';
const CAP = 60; // keep the last N; the drawer isn't an archive

export function loadHistory(): CraftRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // localStorage is user-editable, so any stored `fn` goes back through the
    // same clamp the model's output does — a hand-edited record can't smuggle
    // an out-of-range modifier into the game.
    return (arr as CraftRecord[]).map((r) =>
      r?.fn
        ? {
            ...r,
            fn: parseItemFunction({
              narrative_function: r.fn.narrative,
              modifiers: {
                radius_tiles: r.fn.modifiers?.radiusTiles,
                growMs_modifier: r.fn.modifiers?.growMsModifier,
                water_retention_multiplier: r.fn.modifiers?.waterRetentionMult,
                yield_bonus: r.fn.modifiers?.yieldBonus,
              },
              behavior: r.fn.behavior,
            }, ALREADY_GATED),
          }
        : r,
    );
  } catch {
    return [];
  }
}

// Prepend the newest, cap the length, persist, and return the new list.
export function appendHistory(rec: CraftRecord): CraftRecord[] {
  const next = [rec, ...loadHistory()].slice(0, CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full/blocked — history just won't persist this run
  }
  return next;
}

// midnight-relative day label for the sticky group headers
function dayLabel(at: number, now = Date.now()): string {
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface HistoryGroup {
  label: string;
  items: CraftRecord[];
}

// Newest-first, split into day groups in encounter order (records are already
// stored newest-first, so groups come out Today → Yesterday → older).
export function groupByDay(records: CraftRecord[], now = Date.now()): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const r of records) {
    const label = dayLabel(r.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(r);
    else groups.push({ label, items: [r] });
  }
  return groups;
}

export function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
