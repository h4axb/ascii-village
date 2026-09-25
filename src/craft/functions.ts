// ---------------------------------------------------------------------------
// PARAMETER TRANSLATION SYSTEM
//
// The player types any function they can imagine ("a robotic umbrella that
// creates a localized time-warp greenhouse") and the LLM translates it into
// the bounded numbers below. The model NEVER emits code — it only fills in a
// fixed set of numeric fields and picks from two closed enums, so nothing it
// returns can crash the renderer or corrupt the crop timestamp math.
//
// Everything here treats the model's output as hostile: every parser narrows
// types, clamps to range, and falls back to a neutral value. None of them
// throw — a malformed response yields a purely cosmetic item, never a failed
// craft. Same narrow -> clamp -> neutral-default pattern getPrice() uses.
// ---------------------------------------------------------------------------

export interface ItemModifiers {
  radiusTiles: number; // 0..3, integer — how far the effect reaches
  growMsModifier: number; // -0.5..+0.5 — negative grows faster
  waterRetentionMult: number; // 1..5 — stretches how long a crop tolerates thirst
  yieldBonus: number; // 0..3, integer — extra crops per harvest
}

export type TriggerKind = 'on_tick' | 'on_crop_mature' | 'on_crop_thirsty' | 'on_day_change';
export type ActionKind = 'water_area' | 'harvest_area' | 'grant_coins';

export interface ItemBehavior {
  trigger: TriggerKind;
  action: ActionKind;
}

export interface ItemFunction {
  narrative: string; // player-facing sentence describing what it does
  modifiers: ItemModifiers;
  behavior?: ItemBehavior; // most items are passive; this is opt-in
}

// Whether the player's own prompt actually asked for a gameplay effect, as
// judged by the same LLM call that writes the flavor text. Gates whether
// modifiers/behavior are read at all — see parseItemFunction below. Purely
// cosmetic inferred behavior (glowing, sleeping, wandering, particles) does
// NOT require this; it only guards mechanics that affect progression.
export interface GameplayIntent {
  requested: boolean;
  requestedEffect?: string;
  requestedTarget?: string;
}

export const NEUTRAL_MODIFIERS: ItemModifiers = {
  radiusTiles: 0,
  growMsModifier: 0,
  waterRetentionMult: 1,
  yieldBonus: 0,
};

const TRIGGERS: readonly TriggerKind[] = ['on_tick', 'on_crop_mature', 'on_crop_thirsty', 'on_day_change'];
const ACTIONS: readonly ActionKind[] = ['water_area', 'harvest_area', 'grant_coins'];

// Number() on an object/array/undefined gives NaN, which the isFinite guard
// catches — so this handles wrong types, missing fields and out-of-range in
// one step.
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseModifiers(raw: unknown): ItemModifiers {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    radiusTiles: Math.round(clampNum(o.radius_tiles, 0, 3, 0)),
    growMsModifier: clampNum(o.growMs_modifier, -0.5, 0.5, 0),
    waterRetentionMult: clampNum(o.water_retention_multiplier, 1, 5, 1),
    yieldBonus: Math.round(clampNum(o.yield_bonus, 0, 3, 0)),
  };
}

export function parseBehavior(raw: unknown): ItemBehavior | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const trigger = TRIGGERS.find((t) => t === o.trigger);
  const action = ACTIONS.find((a) => a === o.action);
  if (!trigger || !action) return undefined;
  // harvest_area on a per-second trigger would automate the farm outright, so
  // it is pinned to crop maturity regardless of what the model asked for —
  // that pace is already bounded by the crop's own grow time.
  if (action === 'harvest_area' && trigger !== 'on_crop_mature') {
    return { trigger: 'on_crop_mature', action };
  }
  return { trigger, action };
}

export function parseGameplayIntent(raw: unknown): GameplayIntent {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (o.requested !== true) return { requested: false };
  return {
    requested: true,
    requestedEffect: typeof o.requestedEffect === 'string' ? o.requestedEffect.trim().slice(0, 80) : undefined,
    requestedTarget: typeof o.requestedTarget === 'string' ? o.requestedTarget.trim().slice(0, 80) : undefined,
  };
}

export function parseItemFunction(
  raw: {
    narrative_function?: unknown;
    modifiers?: unknown;
    behavior?: unknown;
  },
  intent: GameplayIntent,
): ItemFunction {
  const narrative =
    typeof raw?.narrative_function === 'string' && raw.narrative_function.trim()
      ? raw.narrative_function.trim()
      : '';
  // The player never asked for a gameplay effect, so raw.modifiers/behavior
  // are never even read here — a model that emits a mechanical effect
  // anyway cannot leak it through, regardless of prompt wording.
  if (!intent.requested) {
    return { narrative, modifiers: { ...NEUTRAL_MODIFIERS }, behavior: undefined };
  }
  return {
    narrative,
    modifiers: parseModifiers(raw?.modifiers),
    behavior: parseBehavior(raw?.behavior),
  };
}

// True when a function does nothing mechanically — used to decide whether the
// UI should promise the player an effect at all.
export function isCosmetic(fn: ItemFunction | undefined): boolean {
  if (!fn) return true;
  const m = fn.modifiers;
  return (
    !fn.behavior &&
    m.growMsModifier === 0 &&
    m.waterRetentionMult === 1 &&
    m.yieldBonus === 0
  );
}

// ---- the prompt fragment the LLM is held to -------------------------------
// Lives here so the bounds and the instructions can never drift apart: both
// read from the same place.
export const MODIFIER_PROMPT = [
  'First decide "gameplay_intent": {"requested": true/false, "requestedEffect": ' +
    '"...", "requestedTarget": "..."}. Set requested TRUE only when the player\'s ' +
    'own prompt explicitly describes or requests a gameplay function, action, ' +
    'mechanical effect, or mechanical outcome — it does not need to contain a verb ' +
    '("fertilizer for faster crops", "boots with extra movement speed", "a lucky ' +
    'charm for more coins" all count). Do NOT infer mechanics solely from ' +
    'appearance, material, mood, personality, or theme — "sleepy", "golden", ' +
    '"bright", "magical", "lucky" do NOT by themselves imply an effect, even ' +
    'though each pulls toward one (sleepy->slow, bright->fast, lucky->reward); ' +
    'resist that pull unless the player\'s own words name the outcome itself. ' +
    'Examples that are FALSE: "sleepy crystal snail with a tiny glowing moon", ' +
    '"golden sword", "bright lamp", "magical strawberry", "lucky golden charm". ' +
    'Examples that are TRUE: "fertilizer for faster crops", "boots with extra ' +
    'movement speed", "a snail that makes nearby plants grow faster". When ' +
    'requested is false, set requestedEffect/requestedTarget to null and give ' +
    'modifiers/behavior all-neutral values anyway (0 / 1.0 / 0, behavior null) — ' +
    'they will be ignored by the game regardless of what you put there.',
  'ALSO: when gameplay_intent.requested is false, narrative_function may describe ' +
    'cosmetic animation, appearance, sound, particles, personality, or atmosphere, ' +
    'but must NOT imply any effect on crops, resources, progression, stats, player ' +
    'abilities, economy, or world state — "it occasionally curls up beneath its ' +
    'tiny moon while a faint glow shimmers" is fine; "its peaceful aura calms ' +
    'nearby crops" is NOT, even though the modifiers stay neutral, because it ' +
    'misleads the player about what the item does.',
  'Translate the item\'s intended function into game mechanics. Assign values ' +
    'to these fields ONLY, never exceeding the stated range:',
  '  radius_tiles (integer 0-3) — how many tiles away the effect reaches.',
  '  growMs_modifier (-0.5 to 0.5) — NEGATIVE makes nearby crops grow faster, ' +
    'positive slower, 0 no change.',
  '  water_retention_multiplier (1.0 to 5.0) — how much longer nearby crops ' +
    'survive without water. 1.0 is no change.',
  '  yield_bonus (integer 0-3) — extra crops harvested nearby.',
  'Optionally add "behavior": {"trigger": ..., "action": ...} for an item that ' +
    'acts on its own, choosing ONE trigger from [on_tick, on_crop_mature, ' +
    'on_crop_thirsty, on_day_change] and ONE action from [water_area, ' +
    'harvest_area, grant_coins]. Use null when the item is passive.',
  'Map the idea onto the CLOSEST available fields — a "time warp" is a strong ' +
    'negative growMs_modifier, a "shelter" is a high water_retention_multiplier, ' +
    'a "blessing" is a yield_bonus. Honour stated downsides (an item described ' +
    'as cursed or barren should get a positive growMs_modifier or a 0 yield). ' +
    'If the idea maps to nothing here, return all-neutral values (0 / 1.0 / 0) ' +
    'rather than inventing fields.',
].join('\n');
