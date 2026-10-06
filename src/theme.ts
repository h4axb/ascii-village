// ---------------------------------------------------------------------------
// THE ENVIRONMENT THEME — every colour of the world's nature in one place.
//
//   src/data/theme.json   named presets; `active` is the one the game uses
//     swatches            named colours ("grass.base", "water.deep", …)
//     grade               a colour grade over all of them: saturation,
//                         brightness, contrast, warmth, a tint
//
// The terrain (terrain.ts), the canvas sparkles and foam (TerrainCanvas.tsx),
// the map's sea (GameMap.tsx) and the palm, flower and grass-tuft sprites
// (sprites.ts) all read their colours from here, graded. The house, the
// shop, Mitchy, the pond and the player keep their own colours: the grade
// never touches them.
//
// The world editor's Theme tab (src/editor/ThemeTab.tsx) edits a working
// copy live; preview() swaps it in and every consumer repaints. Saving
// writes theme.json through the dev server (vite.config.ts).
// ---------------------------------------------------------------------------
import themeData from './data/theme.json';

export interface Grade {
  saturation: number; // 1 = as is, 0 = grey
  brightness: number; // 1 = as is
  contrast: number; // 1 = as is
  warmth: number; // -1 cool … 0 … +1 warm
  tint: string; // a colour every swatch is pulled toward…
  tintAmount: number; // …by this much (0 – 1)
}
export interface ThemePreset {
  grade: Grade;
  swatches: Record<string, string>;
}
export interface ThemeDoc {
  active: string;
  presets: Record<string, ThemePreset>;
}

// The editor's list: every swatch, grouped and labelled, in display order
export const SWATCH_GROUPS: { title: string; swatches: [string, string][] }[] = [
  {
    title: 'Grass',
    swatches: [
      ['grass.base', 'ground'],
      ['grass.light', 'light patches'],
      ['grass.dark', 'dark patches'],
      ['grass.rim', 'toward the coast'],
      ['grass.glyph', 'grass glyphs'],
    ],
  },
  {
    title: 'Bushes',
    swatches: [
      ['bush.dark', 'shadow'],
      ['bush.mid', 'body'],
      ['bush.light', 'lit'],
      ['bush.glyph', 'glyphs'],
      ['bush.glyphDark', 'glyphs, dark'],
      ['bush.fringeGlyph', 'glyphs at the sand'],
    ],
  },
  {
    title: 'Sand',
    swatches: [
      ['sand.base', 'sand'],
      ['sand.outer', 'outer sand'],
      ['sand.wet', 'wet sand'],
      ['sand.glyph', 'grain'],
      ['sand.wetGrain', 'wet grain'],
    ],
  },
  {
    title: 'Water',
    swatches: [
      ['water.shallow', 'shallows'],
      ['water.shallow2', 'shallows, deeper'],
      ['water.base', 'water'],
      ['water.deep', 'deep'],
      ['water.deepest', 'deepest'],
      ['water.glyph', 'glyphs'],
      ['water.sparkle', 'sparkles'],
      ['water.foam', 'foam'],
      ['water.mapBackdrop', 'map edge'],
    ],
  },
  {
    title: 'Rocks',
    swatches: [
      ['rock.base', 'rock'],
      ['rock.dark', 'rock, dark'],
      ['rock.glyph', 'rock glyphs'],
      ['stone.base', 'beach stones'],
      ['stone.light', 'beach stones, lit'],
    ],
  },
  {
    title: 'Palm',
    swatches: [
      ['palm.frondLit', 'fronds, lit'],
      ['palm.frond', 'fronds'],
      ['palm.curtain', 'dead fronds'],
      ['palm.curtainLit', 'dead fronds, lit'],
      ['palm.trunkLit', 'trunk, lit'],
      ['palm.trunk', 'trunk'],
      ['palm.trunkShade', 'trunk, shade'],
      ['palm.date', 'dates'],
      ['palm.dateLit', 'dates, lit'],
      ['palm.stem', 'date stems'],
    ],
  },
  {
    title: 'Flowers & tufts',
    swatches: [
      ['flower.petal', 'flower petals'],
      ['flower.centre', 'flower centre'],
      ['flower.whitePetal', 'white flower petals'],
      ['flower.purplePetal', 'purple flower petals'],
      ['flower.orangePetal', 'orange flower petals'],
      ['grassTuft.tip', 'grass tuft tips'],
      ['grassTuft.base', 'grass tuft base'],
    ],
  },
];

export const NEUTRAL_GRADE: Grade = {
  saturation: 1,
  brightness: 1,
  contrast: 1,
  warmth: 0,
  tint: '#c8a878',
  tintAmount: 0,
};

const SAVED = themeData as ThemeDoc;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// The working copy: what the game shows right now (the editor changes it)
let doc: ThemeDoc = clone(SAVED);
let cur: ThemePreset = presetOf(doc, doc.active);
let rev = 0;
const cache = new Map<string, string>();
const listeners = new Set<() => void>();

function presetOf(d: ThemeDoc, name: string): ThemePreset {
  const p = d.presets[name] ?? d.presets[Object.keys(d.presets)[0]];
  return { grade: { ...NEUTRAL_GRADE, ...p.grade }, swatches: { ...SAVED.presets[SAVED.active]?.swatches, ...p.swatches } };
}

// ---- colour maths ---------------------------------------------------------
type RGB = [number, number, number];
export const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// One swatch through the grade. A neutral grade returns it unchanged.
export function applyGrade(hex: string, g: Grade): string {
  let [r, gg, b] = hexToRgb(hex).map((v) => v / 255) as RGB;
  // brightness, then contrast around mid-grey
  r *= g.brightness;
  gg *= g.brightness;
  b *= g.brightness;
  r = (r - 0.5) * g.contrast + 0.5;
  gg = (gg - 0.5) * g.contrast + 0.5;
  b = (b - 0.5) * g.contrast + 0.5;
  // saturation: toward / away from the colour's own luminance
  const l = 0.299 * r + 0.587 * gg + 0.114 * b;
  r = l + (r - l) * g.saturation;
  gg = l + (gg - l) * g.saturation;
  b = l + (b - l) * g.saturation;
  // warmth: red / yellow up, blue down (and the other way round)
  r += g.warmth * 0.06;
  gg += g.warmth * 0.02;
  b -= g.warmth * 0.07;
  // tint
  if (g.tintAmount > 0) {
    const [tr, tg, tb] = hexToRgb(g.tint).map((v) => v / 255);
    r += (tr - r) * g.tintAmount;
    gg += (tg - gg) * g.tintAmount;
    b += (tb - b) * g.tintAmount;
  }
  return toHex([r * 255, gg * 255, b * 255]);
}

// A swatch, graded, as '#rrggbb'
export function themeColor(name: string): string {
  let c = cache.get(name);
  if (c === undefined) {
    c = applyGrade(cur.swatches[name] ?? '#ff00ff', cur.grade);
    cache.set(name, c);
  }
  return c;
}
export const themeRgb = (name: string): RGB => hexToRgb(themeColor(name));

// A colour between two swatches (0 = a, 1 = b), graded
export function themeMix(a: string, b: string, t: number): string {
  const x = hexToRgb(themeColor(a));
  const y = hexToRgb(themeColor(b));
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

// ---- live changes ---------------------------------------------------------
// Consumers that bake colours (the terrain field, the sprite palettes)
// subscribe and rebuild; React reads themeRevision() (useThemeRevision).
export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const themeRevision = () => rev;

// Throttled: a colour picker or slider fires on every pixel of a drag, and
// rebuilding the terrain takes a few hundred ms. Listeners run at most every
// EMIT_MS while dragging, and always once more after the last change.
const EMIT_MS = 200;
let lastEmit = 0;
let timer: number | null = null;
function emit() {
  timer = null;
  lastEmit = performance.now();
  for (const fn of [...listeners]) fn();
}
// The editor's own controls follow every change at once
const editListeners = new Set<() => void>();
export function onThemeEdit(fn: () => void): () => void {
  editListeners.add(fn);
  return () => editListeners.delete(fn);
}
function changed() {
  cache.clear();
  rev += 1;
  for (const fn of [...editListeners]) fn();
  if (timer !== null) return;
  const wait = Math.max(0, EMIT_MS - (performance.now() - lastEmit));
  timer = window.setTimeout(() => requestAnimationFrame(emit), wait);
}

// ---- the editor's API -----------------------------------------------------
export const themeDoc = (): ThemeDoc => doc;
export const currentPreset = (): ThemePreset => cur;
export const activePresetName = (): string => doc.active;

export function setSwatch(name: string, hex: string) {
  cur.swatches[name] = hex;
  doc.presets[doc.active] = cur;
  changed();
}
export function setGrade(patch: Partial<Grade>) {
  cur.grade = { ...cur.grade, ...patch };
  doc.presets[doc.active] = cur;
  changed();
}
export function selectPreset(name: string) {
  if (!doc.presets[name]) return;
  doc.active = name;
  cur = presetOf(doc, name);
  doc.presets[name] = cur;
  changed();
}
// A new preset starting from the current one
export function addPreset(name: string) {
  doc.presets[name] = clone(cur);
  selectPreset(name);
}
export function deletePreset(name: string) {
  if (Object.keys(doc.presets).length <= 1) return;
  delete doc.presets[name];
  if (doc.active === name) selectPreset(Object.keys(doc.presets)[0]);
  else changed();
}
// Throw away unsaved theme edits
export function revertTheme() {
  doc = clone(SAVED);
  cur = presetOf(doc, doc.active);
  changed();
}
export const themeDirty = () => JSON.stringify(doc) !== JSON.stringify(SAVED);
// What Save writes; afterwards it is the new saved state
export function themeForSave(): ThemeDoc {
  return clone(doc);
}
export function markThemeSaved() {
  const d = clone(doc);
  SAVED.active = d.active;
  SAVED.presets = d.presets;
}
