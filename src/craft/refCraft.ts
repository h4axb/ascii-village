// ---------------------------------------------------------------------------
// CRAFTING FROM REFERENCES — the crafted item is built from marked pixel-art
// references (src/data/refs/<id>/, made with the Glyph Generator,
// tools/glyph-ref/) instead of being drawn from shapes.
//
//   1. MATCH   the player's words -> a recipe, step by step: a BODY (a boat),
//              colours per part ("red sails"), swapped PARTS (a striped sail
//              from the library), DECORATIONS in the body's decoration areas
//              (a gem at the bow). Pure keyword work: no LLM call.
//   2. ASK     only when the words go beyond what the matcher can place — a
//              detail with no reference ("a skull on the sail"), a name, an
//              invented function — or no body matched: ONE small call returns
//              the whole recipe, the shapes of unknown details (drawn inside
//              the body's detail areas), and the name / description /
//              function at once (it replaces the planner + describer calls).
//   3. BUILD   compose the pixels (src/glyph/refs.ts) and bake them into
//              glyphs (src/glyph/bake.ts) at the size band's sign count.
//
// No matching body (and the model finds none either): craftItem falls back to
// the shape planner, as before.
// ---------------------------------------------------------------------------
import { bake, DEFAULTS, type GlyphShape, type Img, type RGB } from '../glyph/bake';
import { buildAtlas } from '../glyph/atlas';
import { compose, type DetailRegion, type Recipe, type RefDoc } from '../glyph/refs';
import { bakedToSprite } from '../glyph/sprite';
import { MATERIALS } from './materials';
import { PALETTE } from './vocab';
import { parseGameplayIntent, parseItemFunction, MODIFIER_PROMPT, NEUTRAL_MODIFIERS, type ItemFunction } from './functions';
import type { Category } from '../llm';
import { LINK } from '../link';
import { newFeedbackId, playerId, sendFeedback, SESSION } from '../feedback/client';

// Which links craft from the library (the quest test links /1 and /2 keep the
// shape planner, so the study's conditions stay as they were). A dev can turn
// it on anywhere: localStorage['craft-refs'] = 'on'.
const REF_CRAFT_LINKS = new Set(['0', '3']);
export const REF_CRAFT_ON = REF_CRAFT_LINKS.has(LINK) || (() => {
  try {
    return localStorage.getItem('craft-refs') === 'on';
  } catch {
    return false;
  }
})();

// ---- the library --------------------------------------------------------------------
const DOCS = import.meta.glob<RefDoc>('../data/refs/*/ref.json', { eager: true, import: 'default' });
const ARTS = import.meta.glob<string>('../data/refs/*/art.png', { eager: true, query: '?url', import: 'default' });

export const REFS: RefDoc[] = Object.values(DOCS).filter((d) => d && d.version === 1);
const artUrlOf = (id: string) => Object.entries(ARTS).find(([p]) => p.includes(`/refs/${id}/art.png`))?.[1];
export const hasRefBodies = () => REFS.some((r) => r.role === 'body');

const imgCache = new Map<string, Promise<Img>>();
function loadArt(id: string): Promise<Img> {
  let p = imgCache.get(id);
  if (!p) {
    p = new Promise<Img>((resolve, reject) => {
      const url = artUrlOf(id);
      if (!url) return reject(new Error(`no art for ${id}`));
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width;
        cv.height = im.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(im, 0, 0);
        resolve({ w: im.width, h: im.height, data: ctx.getImageData(0, 0, im.width, im.height).data });
      };
      im.onerror = () => reject(new Error(`art of ${id} failed to load`));
      im.src = url;
    });
    imgCache.set(id, p);
  }
  return p;
}

let atlas: GlyphShape[] | null = null;
const getAtlas = () => (atlas ??= buildAtlas(DEFAULTS.ramp + DEFAULTS.edgeGlyphs));

// ---- 1. the matcher ----------------------------------------------------------------------
// extra nouns for a category, so "ship" finds the boats
const SYNONYMS: Record<string, string[]> = {
  boat: ['boat', 'ship', 'sloop', 'sailboat', 'raft', 'canoe', 'yacht', 'vessel', 'galleon', 'dinghy'],
  cart: ['cart', 'wagon', 'car', 'carriage', 'buggy'],
  'watering-can': ['watering', 'can', 'sprinkler'],
  pet: ['pet', 'cat', 'dog', 'puppy', 'kitten', 'bunny', 'critter', 'creature'],
  plant: ['plant', 'flower', 'pot', 'potted'],
  hat: ['hat', 'cap', 'helmet', 'crown'],
};
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
const sing = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const STOP = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'on', 'in', 'for', 'to', 'my', 'some', 'little', 'big', 'small', 'tiny', 'very']);

function colourOf(word: string): RGB | null {
  const p = PALETTE[word];
  if (p) return [parseInt(p.slice(1, 3), 16), parseInt(p.slice(3, 5), 16), parseInt(p.slice(5, 7), 16)];
  const m = (MATERIALS as Record<string, RGB>)[word === 'wooden' ? 'wood' : word === 'golden' ? 'gold' : word === 'metallic' || word === 'iron' || word === 'steel' ? 'metal' : word === 'stony' ? 'stone' : word];
  return m ?? null;
}

// the biggest primary part of a reference (by marked pixels): what "a red
// boat" recolours
function mainPart(r: RefDoc): string | null {
  const count = new Map<number, number>();
  for (let i = 0; i + 1 < r.mask.length; i += 2) if (r.mask[i]) count.set(r.mask[i], (count.get(r.mask[i]) ?? 0) + r.mask[i + 1]);
  let best = 0, bn = -1;
  r.parts.forEach((p, i) => {
    const n = count.get(i + 1) ?? 0;
    if (p.zone !== 'fixed' && (p.zone === 'primary' ? n * 2 : n) > bn) {
      bn = p.zone === 'primary' ? n * 2 : n;
      best = i;
    }
  });
  return r.parts[best]?.name ?? null;
}

export interface RefMatch {
  body: RefDoc | null;
  score: number;
  colours: Record<string, RGB>;
  swaps: { part: string; ref: RefDoc }[];
  decorations: { ref: RefDoc; area: string }[];
  leftover: string[]; // words the matcher could not place (a detail? a function?)
  needsModel: boolean;
}

const FUNCTION_WORDS = /\b(that|which|can|could|lets?|makes?|named|called|faster|fast|float|floats|fly|flies|shoots?|glows?|heals?)\b/;

export function matchRefs(prompt: string): RefMatch {
  const ws = words(prompt).map(sing);
  const has = (w: string) => ws.includes(sing(w));
  const used = new Set<string>();
  // body
  let body: RefDoc | null = null, score = 0;
  for (const r of REFS.filter((x) => x.role === 'body')) {
    let s = 0;
    const nouns = [...(SYNONYMS[r.category] ?? []), ...r.category.split('-')];
    if (nouns.some(has)) s += 3;
    for (const t of r.tags) if (has(t)) s += 2;
    for (const t of words(r.title)) if (!STOP.has(t) && has(t)) s += 2;
    if (s > score) {
      score = s;
      body = r;
    }
  }
  const res: RefMatch = { body: score >= 3 ? body : null, score, colours: {}, swaps: [], decorations: [], leftover: [], needsModel: false };
  if (!res.body) {
    res.needsModel = true;
    return res;
  }
  const b = res.body;
  for (const n of [...(SYNONYMS[b.category] ?? []), ...b.category.split('-'), ...b.tags, ...words(b.title)]) used.add(sing(n));
  const partNames = b.parts.map((p) => p.name);
  // colours: "<colour> <part>", "<part> in/of <colour>", "<colour> <body noun>" (all primary parts)
  ws.forEach((w, i) => {
    const c = colourOf(w);
    if (!c) return;
    used.add(w);
    const next = ws[i + 1], next2 = ws[i + 2];
    const part = [next, next2].find((x) => x && partNames.includes(x));
    if (part) {
      res.colours[part] = c;
      used.add(part);
      return;
    }
    const prev = ws[i - 1] === 'of' || ws[i - 1] === 'in' ? ws[i - 2] : undefined;
    if (prev && partNames.includes(prev)) {
      res.colours[prev] = c;
      return;
    }
    // the whole object ("a red boat"): its main part, the biggest primary one
    const main = mainPart(b);
    if (main && !res.colours[main]) res.colours[main] = c;
  });
  // swapped parts: a library part for one of the body's parts, named by its tags
  for (const r of REFS.filter((x) => x.role === 'part' && x.partType && partNames.includes(x.partType) && (x.category === b.category || !x.category))) {
    const hits = [...r.tags, ...words(r.title)].filter((t) => !STOP.has(t) && t !== r.partType && has(t));
    if (hits.length && has(r.partType!)) {
      if (res.swaps.some((s) => s.part === r.partType)) continue;
      res.swaps.push({ part: r.partType!, ref: r });
      for (const h of hits) used.add(sing(h));
      used.add(r.partType!);
    }
  }
  // decorations: a decoration ref named in the words, into an area that takes it
  const decoAreas = b.areas.filter((a) => a.type === 'decoration');
  for (const r of REFS.filter((x) => x.role === 'decoration')) {
    const hits = [...r.tags, ...words(r.title)].filter((t) => !STOP.has(t) && has(t));
    if (!hits.length || !decoAreas.length) continue;
    const free = decoAreas.filter((a) => !res.decorations.some((d) => d.area === a.name));
    const area = free.find((a) => a.accepts.some((t) => r.tags.includes(t) || hits.includes(t))) ?? free[0];
    if (!area) continue;
    res.decorations.push({ ref: r, area: area.name });
    for (const h of hits) used.add(sing(h));
  }
  for (const p of partNames) if (has(p)) used.add(p);
  res.leftover = ws.filter((w) => !STOP.has(w) && !used.has(w) && !colourOf(w));
  res.needsModel = res.leftover.length > 0 || FUNCTION_WORDS.test(prompt.toLowerCase());
  return res;
}

// ---- 2. the one model call -----------------------------------------------------------------
export interface RefChoice {
  body: string | null;
  colours: Record<string, string>; // part -> colour word, material or #hex
  swaps: Record<string, string>; // part -> part ref id
  decorations: { ref: string; area: string }[];
  details: { area: string; regions: { primitive: string; cx: number; cy: number; width: number; height: number; rotation?: number; material: string }[] }[];
  mirror?: boolean;
  name?: string;
  description?: string;
  tags?: string[];
  fn?: ItemFunction;
}

export function refPrompt(): string {
  return (
    'You are the crafting bench of Asciia Bay, a cozy glyph-art island game. Items are built from a LIBRARY of marked ' +
    'reference pictures: pick a BODY, then optionally recolour its parts, swap parts for library parts of the same ' +
    'name, add library decorations into the body\'s decoration areas, and draw details that have NO library picture ' +
    'as simple shapes inside the body\'s detail areas. Reply with JSON only:\n' +
    '{"body": body id or null if nothing in the library fits, "colours": {"<part>": colour word | material | "#rrggbb"}, ' +
    '"swaps": {"<part>": part id}, "decorations": [{"ref": decoration id, "area": area name}], ' +
    '"details": [{"area": detail area name, "regions": [{"primitive": rectangle|rounded_rectangle|circle|ellipse|triangle|' +
    'trapezoid|diamond|semicircle|arc|line|point|blob, "cx": 0-1, "cy": 0-1, "width": 0-1, "height": 0-1, "rotation": degrees, ' +
    '"material": material or "#rrggbb"}]}], "mirror": false, "name": a short charming item name, ' +
    '"description": one or two cozy sentences under 30 words, "tags": 2-5 short traits, ' +
    '"narrative_function": one short sentence on what it does for the player, "gameplay_intent": {...}, "modifiers": {...}}\n' +
    'Rules: only use ids, part names and area names from the library. Detail regions are in 0-1 of their area; ' +
    'keep a detail to 1-6 regions. If the player asks for something the library cannot express at all, body = null. ' +
    'Answer any other wish (a name, what it does) through name / narrative_function / gameplay_intent / modifiers.\n\n' +
    MODIFIER_PROMPT
  );
}

export function refCatalogue(guess: RefMatch): string {
  const bodies = REFS.filter((r) => r.role === 'body').map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    tags: r.tags,
    parts: r.parts.map((p) => p.name),
    areas: r.areas.map((a) => ({ name: a.name, type: a.type, ...(a.accepts.length ? { accepts: a.accepts } : {}), ...(a.part ? { part: a.part } : {}) })),
  }));
  const parts = REFS.filter((r) => r.role === 'part').map((r) => ({ id: r.id, replaces: r.partType, category: r.category, title: r.title, tags: r.tags }));
  const decorations = REFS.filter((r) => r.role === 'decoration').map((r) => ({ id: r.id, title: r.title, tags: r.tags }));
  const g = guess.body
    ? { body: guess.body.id, swaps: Object.fromEntries(guess.swaps.map((s) => [s.part, s.ref.id])), decorations: guess.decorations.map((d) => ({ ref: d.ref.id, area: d.area })), unplaced_words: guess.leftover }
    : null;
  return JSON.stringify({ bodies, parts, decorations, matcher_guess: g });
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
export function parseRefChoice(raw: Record<string, unknown> | null | undefined): RefChoice | null {
  if (!raw) return null;
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const intent = parseGameplayIntent(raw.gameplay_intent);
  return {
    body: str(raw.body) || null,
    colours: Object.fromEntries(Object.entries(obj(raw.colours)).map(([k, v]) => [k, str(v)]).filter(([, v]) => v)),
    swaps: Object.fromEntries(Object.entries(obj(raw.swaps)).map(([k, v]) => [k, str(v)]).filter(([, v]) => v)),
    decorations: arr(raw.decorations).map((d) => ({ ref: str(obj(d).ref), area: str(obj(d).area) })).filter((d) => d.ref && d.area),
    details: arr(raw.details)
      .map((d) => ({
        area: str(obj(d).area),
        regions: arr(obj(d).regions)
          .slice(0, 8)
          .map((r) => {
            const o = obj(r);
            return { primitive: str(o.primitive) || 'circle', cx: num(o.cx, 0.5), cy: num(o.cy, 0.5), width: num(o.width, 0.4), height: num(o.height, 0.4), rotation: num(o.rotation, 0), material: str(o.material) || 'stone' };
          }),
      }))
      .filter((d) => d.area && d.regions.length),
    mirror: raw.mirror === true,
    name: str(raw.name) || undefined,
    description: str(raw.description) || undefined,
    tags: arr(raw.tags).map(str).filter(Boolean).slice(0, 5),
    fn: parseItemFunction(raw, intent),
  };
}

function rgbOf(spec: string): RGB | null {
  const s = spec.toLowerCase().trim();
  if (/^#[0-9a-f]{6}$/.test(s)) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  return colourOf(s) ?? colourOf(s.split(/\s+/)[0]) ?? null;
}

// the model's choice, checked against the library, merged over the matcher's
export function choiceToMatch(c: RefChoice, guess: RefMatch): (RefMatch & { details: RefChoice['details']; mirror: boolean }) | null {
  const body = REFS.find((r) => r.role === 'body' && r.id === c.body) ?? (c.body === null ? null : guess.body);
  if (!body) return null;
  const parts = body.parts.map((p) => p.name);
  const colours: Record<string, RGB> = body === guess.body ? { ...guess.colours } : {};
  for (const [p, v] of Object.entries(c.colours)) {
    const rgb = rgbOf(v);
    if (rgb && parts.includes(p)) colours[p] = rgb;
  }
  const swaps = Object.entries(c.swaps)
    .map(([part, id]) => ({ part, ref: REFS.find((r) => r.id === id && r.role === 'part') }))
    .filter((s): s is { part: string; ref: RefDoc } => !!s.ref && parts.includes(s.part));
  const decorations = c.decorations
    .map((d) => ({ ref: REFS.find((r) => r.id === d.ref && r.role === 'decoration'), area: d.area }))
    .filter((d): d is { ref: RefDoc; area: string } => !!d.ref && body.areas.some((a) => a.name === d.area && a.type === 'decoration'));
  const details = c.details.filter((d) => body.areas.some((a) => a.name === d.area && a.type === 'detail'));
  return { body, score: guess.score, colours, swaps, decorations, leftover: [], needsModel: false, details, mirror: !!c.mirror };
}

// ---- 3. build -----------------------------------------------------------------------------------
const SIGNS = { small: 320, medium: 520, large: 800 } as const;
const SCREEN_W = { small: 9, medium: 13, large: 18 } as const; // on-screen width in ch

export interface RefSprite {
  lines: string[];
  colors: string[];
  palette: Record<string, string>;
  scale: number;
  signs: number;
  body: RefDoc;
}

export async function buildFromMatch(m: RefMatch & { details?: RefChoice['details']; mirror?: boolean }, size?: 'small' | 'medium' | 'large'): Promise<RefSprite> {
  const body = m.body!;
  const recipe: Recipe = {
    body: { ref: body, img: await loadArt(body.id) },
    colours: m.colours,
    swaps: await Promise.all(m.swaps.map(async (s) => ({ part: s.part, ref: s.ref, img: await loadArt(s.ref.id) }))),
    decorations: await Promise.all(m.decorations.map(async (d) => ({ ref: d.ref, img: await loadArt(d.ref.id), area: d.area }))),
    details: (m.details ?? []).map((d) => ({
      area: d.area,
      regions: d.regions.map((r): DetailRegion => ({ ...r, rgb: rgbOf(r.material) ?? MATERIALS.stone })),
    })),
    mirror: m.mirror,
  };
  const layer = compose(recipe);
  const band = size ?? body.sizeBand ?? 'small';
  // references carry real transparency: gaps are meant (no hole filling)
  const b = bake(layer.img, { ...DEFAULTS, bg: 'alpha', fillHoles: false, signs: SIGNS[band] }, getAtlas());
  const g = bakedToSprite(b);
  const w = Math.max(1, ...g.sprite.map((l) => l.length));
  return { lines: g.sprite, colors: g.colors, palette: g.palette, scale: SCREEN_W[band] / w, signs: b.signs, body };
}

// what a crafted item gets when no model wrote its text
export function refDescription(m: RefMatch): { description: string; tags: string[]; fn: ItemFunction } {
  const b = m.body!;
  const extras = [...m.swaps.map((s) => s.ref.title.toLowerCase()), ...m.decorations.map((d) => d.ref.title.toLowerCase())];
  return {
    description: `${b.description || `A hand-crafted ${b.title.toLowerCase()}.`}${extras.length ? ` This one has a ${extras.join(' and a ')}.` : ''}`.trim(),
    tags: [...new Set([...b.tags, ...m.swaps.flatMap((s) => s.ref.tags), ...m.decorations.flatMap((d) => d.ref.tags)])].slice(0, 5),
    fn: { narrative: '', modifiers: { ...NEUTRAL_MODIFIERS } },
  };
}

export const gameCategoryOf = (r: RefDoc): Category => r.gameCategory as Category;

// What the library could not build: a planner fallback (no body) or words the
// matcher could not place. Sent as a feedback record (no vote), so the
// dashboard can list the most-asked missing references.
export function logRefCraft(prompt: string, via: 'match' | 'model' | 'planner', body: string | null, miss: string[]) {
  if (via !== 'planner' && !miss.length) return;
  void sendFeedback({
    v: 1,
    id: newFeedbackId(),
    at: Date.now(),
    player: playerId(),
    session: SESSION,
    link: `/${LINK}`,
    prompt: prompt.slice(0, 120),
    name: '',
    kind: '',
    adjusted: false,
    vote: null,
    reasons: [],
    positive: [],
    tags: [],
    clarify: null,
    comment: '',
    applied: {},
    answers: null,
    scope: null,
    sprite: { lines: [] },
    ref: { via, body: body ?? '', miss: miss.slice(0, 12) },
  });
}
