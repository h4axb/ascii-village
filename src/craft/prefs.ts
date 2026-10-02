// ---------------------------------------------------------------------------
// Crafting preferences (crafting panel 2, the /2 link): what the player told
// Mitchy about future crafts after rating one, and how each answer reaches
// the generator. See docs/CraftFeedback.md.
//
//   detail          glyph DENSITY — the same shapes drawn with 1× / 2× / 3×
//                   as many glyphs (the render resolution), same size in the
//                   world. Done in code: always applies.
//   color           Pastel / Vivid — the finished palette's saturation and
//                   lightness, adjusted in code. Always applies.
//   interpretation  how much of the prompt's detail is taken over: Exact
//                   (every feature named) / Essentials (the main subject and
//                   its defining features). A planner instruction.
//   surprise        Controlled (a concrete reading, nothing added) /
//                   Surprise me (an abstract reading, plus details of the
//                   planner's own on top). A planner instruction + its
//                   temperature.
//
// The last two steer the language model, so they shape a craft but can't be
// guaranteed for any single one.
//
// Where an answer is remembered (the scope question): for the same KIND of
// thing (the main element of the craft — see KINDS), for all crafts, or for
// this session only. Per setting, the most specific wins: session, then the
// craft's kind, then all.
// ---------------------------------------------------------------------------

export type PrefKey = 'detail' | 'color' | 'interpretation' | 'surprise';
export type PrefValue = -1 | 0 | 1;
export type Prefs = Partial<Record<PrefKey, PrefValue>>;
export const PREF_KEYS: PrefKey[] = ['detail', 'color', 'interpretation', 'surprise'];

// The kind of thing a craft is, decided by the planner from its MAIN element
// ("a dog with a witch hat" is a creature). Same six values as the game's
// item categories, so a craft's kind is also its category.
export type Kind = 'plant' | 'pets' | 'clothing' | 'vehicle' | 'food' | 'utensils';
export const KINDS: Kind[] = ['plant', 'pets', 'clothing', 'vehicle', 'food', 'utensils'];
export const KIND_LABEL: Record<Kind, { one: string; many: string }> = {
  plant: { one: 'Plant', many: 'Plants' },
  pets: { one: 'Creature', many: 'Creatures' },
  clothing: { one: 'Wearable', many: 'Wearables' },
  vehicle: { one: 'Vehicle', many: 'Vehicles' },
  food: { one: 'Food', many: 'Food' },
  utensils: { one: 'Object', many: 'Objects' },
};
export function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as string[]).includes(v);
}

export type Scope = 'kind' | 'all' | 'session';

// The answers, as the player sees them.
export const PREF_INFO: Record<PrefKey, { title: string; labels: Record<PrefValue, string> }> = {
  detail: { title: 'Detail', labels: { [-1]: 'Fewer glyphs', 0: 'Normal detail', 1: 'Dense glyphs' } },
  color: { title: 'Colour', labels: { [-1]: 'Pastel colours', 0: 'Normal colours', 1: 'Vivid colours' } },
  interpretation: { title: 'Interpretation', labels: { [-1]: 'Essentials only', 0: 'Normal reading', 1: 'Every detail' } },
  surprise: { title: 'Surprise', labels: { [-1]: 'Controlled', 0: 'Normal freedom', 1: 'Surprise me' } },
};

// ---- storage ----
const KEY = 'asciia-craft-prefs';
interface Stored {
  all: Prefs;
  byKind: Partial<Record<Kind, Prefs>>;
}
let session: Prefs = {};

function clean(p: unknown): Prefs {
  const out: Prefs = {};
  if (!p || typeof p !== 'object') return out;
  for (const k of PREF_KEYS) {
    const v = (p as Record<string, unknown>)[k];
    if (v === -1 || v === 0 || v === 1) out[k] = v;
  }
  return out;
}

export function loadPrefs(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    const byKind: Stored['byKind'] = {};
    for (const k of KINDS) {
      const p = clean(raw?.byKind?.[k]);
      if (Object.keys(p).length) byKind[k] = p;
    }
    return { all: clean(raw?.all), byKind };
  } catch {
    return { all: {}, byKind: {} };
  }
}

function store(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked: preferences still work for this session
  }
}

export function sessionPrefs(): Prefs {
  return { ...session };
}

// Save the answered questions (unanswered ones are left as they were).
export function savePrefs(answers: Prefs, scope: Scope, kind: Kind | null): void {
  const a = clean(answers);
  if (!Object.keys(a).length) return;
  if (scope === 'session') {
    session = { ...session, ...a };
    return;
  }
  const s = loadPrefs();
  if (scope === 'all' || !kind) s.all = { ...s.all, ...a };
  else s.byKind[kind] = { ...s.byKind[kind], ...a };
  store(s);
}

// Settings: change or clear one answer in one place.
export function setPref(scope: Scope, kind: Kind | null, key: PrefKey, value: PrefValue | null): void {
  if (scope === 'session') {
    if (value === null) delete session[key];
    else session[key] = value;
    session = { ...session };
    return;
  }
  const s = loadPrefs();
  const target = scope === 'all' || !kind ? s.all : (s.byKind[kind] ??= {});
  if (value === null) delete target[key];
  else target[key] = value;
  if (scope === 'kind' && kind && !Object.keys(target).length) delete s.byKind[kind];
  store(s);
}

export function resetPrefs(): void {
  session = {};
  store({ all: {}, byKind: {} });
}

export function hasKindPrefs(): boolean {
  return Object.keys(loadPrefs().byKind).length > 0;
}

// The preferences in force for a craft of `kind` (unknown kind: all + session).
export function resolvePrefs(kind: Kind | null): Prefs {
  const s = loadPrefs();
  return { ...s.all, ...(kind ? s.byKind[kind] : {}), ...session };
}

// The non-default ones, as short labels ("made with: …").
export function appliedLabels(p: Prefs): string[] {
  return PREF_KEYS.filter((k) => !!p[k]).map((k) => PREF_INFO[k].labels[p[k] as PrefValue]);
}

// ---- how each reaches the generator ----

// detail → the render resolution (glyph cells per on-screen cell, see
// spriteConfig.ts's RESOLUTION_MULTIPLIER, 2 by default)
export function densityOf(p: Prefs): number {
  return p.detail === -1 ? 1 : p.detail === 1 ? 3 : 2;
}

// surprise → the planner's temperature (0.7 is its usual value)
export function temperatureOf(p: Prefs): number {
  return p.surprise === -1 ? 0.4 : p.surprise === 1 ? 0.95 : 0.7;
}

// interpretation + surprise → extra instructions for the planner
export function planPrefsText(p: Prefs): string {
  const out: string[] = [];
  if (p.interpretation === 1)
    out.push(
      'Represent EVERY feature the player named, even small ones — each gets its own region (use small ' +
        'detail/accent regions for small features) rather than being merged away or dropped.',
    );
  if (p.interpretation === -1)
    out.push(
      'Keep only the essentials: the main subject and at most its 1-2 most defining features. Leave out ' +
        'minor details the player mentioned, so the main shape reads clearly.',
    );
  if (p.surprise === -1)
    out.push(
      'Read the request literally and concretely. Do NOT add any element, detail or decoration the player ' +
        'did not ask for (ignore the usual allowance for 1-2 inferred details).',
    );
  if (p.surprise === 1)
    out.push(
      'Read the request in an abstract, imaginative way rather than the most literal one, and add 1-3 ' +
        'fitting details of your own on top of what the player asked for — keep the main subject recognizable.',
    );
  return out.length ? `PLAYER PREFERENCES for this craft (follow these):\n- ${out.join('\n- ')}` : '';
}

// color → the finished palette, in place of the original hex values
export function applyColorPref(palette: Record<string, string>, color: PrefValue | undefined): Record<string, string> {
  if (!color) return palette;
  const out: Record<string, string> = {};
  for (const [k, hex] of Object.entries(palette)) out[k] = adjustHex(hex, color);
  return out;
}

// A general palette shift (the mood presets, craft/moods.ts): `light` and
// `sat` pull lightness / saturation toward a target (-1 darker or duller,
// +1 lighter or stronger), `hue` rotates by degrees.
export interface PaletteShift {
  light?: number;
  sat?: number;
  hue?: number;
  // pull every colour's hue toward this one (degrees) by `pull` (0..1)
  towardHue?: number;
  pull?: number;
}
export function transformPalette(palette: Record<string, string>, shift: PaletteShift): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, hex] of Object.entries(palette)) out[k] = shiftHex(hex, shift);
  return out;
}

function shiftHex(hex: string, { light = 0, sat = 0, hue = 0, towardHue, pull = 0 }: PaletteShift): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const [h, s, l] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  let h1 = h + hue / 360;
  if (towardHue !== undefined && pull) {
    const d = ((((towardHue / 360 - h1) % 1) + 1.5) % 1) - 0.5; // shortest way round the colour wheel
    h1 += d * pull;
  }
  const h2 = ((h1 % 1) + 1) % 1;
  const s2 = sat >= 0 ? s + (1 - s) * sat * 0.6 : s * (1 + sat * 0.7);
  const l2 = light >= 0 ? l + (0.92 - l) * light * 0.55 : l * (1 + light * 0.5);
  const [r, g, b] = hslToRgb(h2, Math.max(0, Math.min(1, s2)), Math.max(0, Math.min(1, l2)));
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function adjustHex(hex: string, dir: -1 | 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const [h, s, l] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  // pastel: less saturated, lifted toward light; vivid: more saturated,
  // lightness pulled toward the middle where colour is strongest
  const s2 = dir < 0 ? s * 0.5 : Math.min(1, s * 1.45 + 0.08);
  const l2 = dir < 0 ? l + (0.86 - l) * 0.45 : l + (0.5 - l) * 0.25;
  const [r, g, b] = hslToRgb(h, s2, Math.max(0, Math.min(1, l2)));
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
