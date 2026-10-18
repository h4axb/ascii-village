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
import { compose, decodeMask, type DetailRegion, type Recipe, type RefDoc } from '../glyph/refs';
import { bakedToSprite } from '../glyph/sprite';
import { MATERIALS } from './materials';
import { applySurprise } from './surpriseLib';
import { PALETTE } from './vocab';
import { colourPhrases, fitToGame, gameColourHint, isColourWord, type ColourPhrase } from './colours';
import { parseGameplayIntent, parseItemFunction, MODIFIER_PROMPT, NEUTRAL_MODIFIERS, type ItemFunction } from './functions';
import type { Category } from '../llm';
import { LINK } from '../link';
import { kindOf, promptParts } from './lexicon';
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
  boat: [
    'boat', 'ship', 'sloop', 'sailboat', 'raft', 'canoe', 'yacht', 'vessel', 'galleon', 'dinghy',
    'boot', 'schiff', 'segelschiff', 'piratenschiff', 'floss', 'bateau', 'navire', 'barco', 'barca', 'nave', 'schip', 'barque',
    // the small boats (shapeShip picks one of the little wooden boats for these)
    'rowboat', 'kayak', 'kanu', 'ruderboot', 'radeau', 'balsa', 'zattera', 'vlot',
  ],
  cart: ['cart', 'wagon', 'car', 'carriage', 'buggy'],
  'watering-can': ['watering', 'can', 'sprinkler'],
  pet: ['pet', 'cat', 'dog', 'puppy', 'kitten', 'bunny', 'critter', 'creature'],
  plant: ['plant', 'flower', 'pot', 'potted'],
  hat: ['hat', 'cap', 'helmet', 'crown'],
};
// lowercase, accents folded ("schäferhund" = "schaferhund", ß = ss)
const fold = (s: string) =>
  s.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, ' ');
const words = (s: string) => fold(s).split(/\s+/).filter(Boolean);
const sing = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const STOP = new Set([
  'a', 'an', 'the', 'with', 'and', 'of', 'on', 'in', 'for', 'to', 'my', 'some', 'little', 'big', 'small', 'tiny', 'very',
  // the same little words in German, French, Spanish, Italian, Dutch
  'ein', 'eine', 'einen', 'einem', 'der', 'die', 'das', 'den', 'dem', 'mit', 'und', 'mein', 'meine', 'kleiner', 'kleine', 'grosser', 'grosse',
  'un', 'une', 'le', 'la', 'les', 'avec', 'et', 'mon', 'ma', 'el', 'los', 'las', 'uno', 'una', 'con', 'y', 'mi', 'il', 'lo', 'gli', 'e',
  'een', 'het', 'met', 'en', 'de', 'des', 'du', 'einer', 'auf', 'am', 'im', 'vorne', 'sur', 'sobre', 'sul', 'op',
]);

export function colourOf(word: string): RGB | null {
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
  petals?: { part: string; rgb: RGB }[]; // a flower's petals recoloured (watering cans)
  blank?: { part: string; fill?: string }[]; // parts taken out first (a ship's skull, its shark)
  detailArea?: string; // where the asked-for details go (a ship's sail motif, its bow)
  // a known style's own features (a viking ship's dragon prow and shields,
  // SHIP_STYLES), drawn with whatever details the model adds
  styleDetails?: RefChoice['details'];
  // the surprise (surpriseLib.ts): a decoration added to the picture,
  // placed from the item's silhouette; `seed` keeps it stable per prompt
  surprise?: { seed: string; only?: string };
}

const FUNCTION_WORDS = /\b(that|which|can|could|lets?|makes?|named|called|faster|fast|float|floats|fly|flies|shoots?|glows?|heals?)\b/;

// ---- a body asked for by name (RefDoc.names, any language) -------------------------
// Each library body can carry the words a player would use for it (the dogs:
// their breed's names; your own assets: what you typed in the Glyph
// Generator's names field). A name in the prompt (the longest one, so "german
// shepherd" beats "shepherd") picks that body, before any category scoring.
// A dog word without a breed picks a dog at random; no dog word, no dog (a
// cat stays a cat).
const DOG_WORDS = ['dog', 'dogs', 'puppy', 'pup', 'doggo', 'doggy', 'hund', 'hundchen', 'welpe', 'chien', 'chiot', 'perro', 'perrito', 'cachorro', 'cane', 'cucciolo', 'hond', 'hondje', 'pies', 'kopek'];
const isDogRef = (r: RefDoc) => r.id.startsWith('pet-dog-');
export function namedOf(prompt: string): { ref: RefDoc; phrase: string } | null {
  const p = ` ${fold(prompt).replace(/\s+/g, ' ')} `;
  // a name only counts as the main object the prompt asks for: "a dragon
  // boat" or "a ship with a dragon head" stay ships (craft/lexicon.ts)
  const main = promptParts(prompt).main;
  const mainF = main && kindOf(main) === 'object' ? fold(main).trim() : null;
  let best: { ref: RefDoc; phrase: string } | null = null;
  for (const r of REFS.filter((x) => x.role === 'body' && x.names?.length))
    for (const t of r.names!) {
      const f = fold(t).replace(/\s+/g, ' ').trim();
      // (a bare colour is no name: "golden" for the golden retriever)
      if (f.length < 3 || DOG_WORDS.includes(f) || (!f.includes(' ') && isColourWord(f))) continue;
      // a name that only describes another object doesn't count: right
      // before it ("dragon boat") or in its details ("a ship with a dragon
      // head"); a name after its own adjectives ("un lapin rose") does
      // (French, Spanish, Italian put adjectives after the noun: "un lapin
      // rose" is a pink bunny, no compound)
      if (mainF && mainF !== f && !f.endsWith(` ${mainF}`)) {
        if (` ${mainF} `.includes(` ${f} `)) continue; // inside the object's own name ("dragon boat")
        if (!ADJ_AFTER.test(p) && !isColourWord(mainF) && (p.includes(` ${f} ${mainF} `) || p.includes(` ${f} ${mainF}s `))) continue;
        const at = p.indexOf(` ${mainF} `);
        const nameAt = Math.max(p.indexOf(` ${f} `), p.indexOf(` ${f}s `), p.indexOf(` ${f}es `));
        if (at >= 0 && nameAt > at && DETAIL_SPLIT.test(p.slice(at, nameAt + 1))) continue;
      }
      if (p.includes(` ${f} `) || p.includes(` ${f}s `) || p.includes(` ${f}es `)) if (!best || f.length > best.phrase.length) best = { ref: r, phrase: f };
    }
  if (best) return best;
  if (words(prompt).some((w) => DOG_WORDS.includes(w))) {
    // a look asked for ("a white dog", "a fluffy dog"): one of the dogs with it
    const ws = words(prompt);
    const all = REFS.filter(isDogRef);
    const looks = all.filter((r) => r.tags.slice(-2).some((t) => words(t).some((w) => ws.includes(w))));
    const dogs = looks.length ? looks : all;
    if (dogs.length) return { ref: dogs[Math.floor(Math.random() * dogs.length)], phrase: '' };
  }
  return null;
}
export const dogOf = namedOf;

// the colour phrases of a prompt ("baby blue", "hellblau"; craft/colours.ts)
// (a name's own words aren't one: "golden" retriever)
export function colourPhrasesOf(prompt: string): ColourPhrase[] {
  const ws = words(prompt).map(sing);
  const name = words(namedOf(prompt)?.phrase ?? '');
  return colourPhrases(ws).filter((p) => !ws.slice(p.start, p.end).every((w) => name.includes(w)));
}

// the words that start a detail phrase ("with a hat", "mit Hut")
const DETAIL_SPLIT = /\s(with|and|on|of|having|that|which|who|mit|und|avec|et|con|met|en)\s/;
// a prompt in a language whose adjectives follow the noun
const ADJ_AFTER = /^ (un|une|le|la|les|el|los|las|il|lo|uno|una|mon|ma|mi) /;
const MODAL_WORDS = new Set(['can', 'could', 'kann']);
const VERB_BEFORE = new Set(['that', 'which', 'who', 'it', 'i', 'you', 'he', 'she', 'they', 'we', 'er', 'sie', 'es', 'der', 'die', 'das']);
// `force`: match the words against this body (a ship chosen by its rules)
export function matchRefs(prompt: string, force?: RefDoc): RefMatch {
  // "can" after a pronoun or "that / which / who" is a verb ("a cat that
  // can fly"), never the watering can
  const ws = words(prompt)
    .filter((w, i, all) => !(MODAL_WORDS.has(w) && VERB_BEFORE.has(all[i - 1] ?? '')))
    .map(sing);
  const has = (w: string) => ws.includes(sing(w));
  const used = new Set<string>();
  // body: one asked for by name first (a dog breed, your dragon), else the
  // best scoring body
  const dog = force ? null : namedOf(prompt);
  let body: RefDoc | null = force ?? dog?.ref ?? null, score = force ? 10 : dog ? 10 : 0;
  if (dog) {
    for (const w of words(dog.phrase)) used.add(sing(w));
    if (isDogRef(dog.ref)) for (const w of DOG_WORDS) used.add(w);
  }
  // (pets only come by their own names above: "pet", "kitten" or "creature"
  // alone would otherwise pick whichever animal scores first)
  for (const r of dog || force ? [] : REFS.filter((x) => x.role === 'body' && x.category !== 'pet')) {
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
  for (const n of [...(SYNONYMS[b.category] ?? []), ...b.category.split('-'), ...b.tags, ...(b.names ?? []), ...words(b.title)]) for (const w of words(n)) used.add(sing(w));
  const partNames = b.parts.map((p) => p.name);
  // colours: "<colour> <part>", "<part> in/of <colour>", "<colour> <body noun>"
  // (the whole object). A colour phrase ("baby blue") counts by its base
  // colour here; the exact one comes from the model (llm.ts craftColours).
  const nameWords = dog ? words(dog.phrase) : [];
  for (const ph of colourPhrases(ws)) {
    const pw = ws.slice(ph.start, ph.end);
    // a name's own words aren't colours ("golden" retriever)
    if (pw.every((w) => nameWords.includes(w))) continue;
    for (const w of pw) used.add(w);
    const c = ph.base ? colourOf(ph.base) : null;
    if (!c) continue; // ("sunset": only the model can mix it)
    const next = ws[ph.end], next2 = ws[ph.end + 1];
    const part = [next, next2].find((x) => x && partNames.includes(x));
    if (part) {
      res.colours[part] = c;
      used.add(part);
      continue;
    }
    const prev = ws[ph.start - 1] === 'of' || ws[ph.start - 1] === 'in' ? ws[ph.start - 2] : undefined;
    if (prev && partNames.includes(prev)) {
      res.colours[prev] = c;
      continue;
    }
    // the whole object ("a red boat"): its main part, the biggest primary
    // one; a body asked for by name all its primary and secondary parts
    // (fixed parts and trim keep theirs)
    if (b.names?.length) {
      for (const p of b.parts) if ((p.zone === 'primary' || p.zone === 'secondary') && !res.colours[p.name]) res.colours[p.name] = c;
    } else {
      const main = mainPart(b);
      if (main && !res.colours[main]) res.colours[main] = c;
    }
  }
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
  res.leftover = ws.filter((w) => !STOP.has(w) && !used.has(w) && !colourOf(w) && !isColourWord(w));
  res.needsModel = res.leftover.length > 0 || FUNCTION_WORDS.test(prompt.toLowerCase());
  return res;
}

// ---- what a prompt leaves open (the /1 pre-preference questions) ----------------------
// Local, no model call: whether a size or a colour is named, and which asked-
// for details no reference can draw (they'd be drawn freely). A detail is
// the run of unplaceable words as written in the prompt ("pirate skull").
const SIZE_WORDS = new Set(['tiny', 'small', 'little', 'mini', 'big', 'large', 'huge', 'giant', 'medium', 'smol', 'massive']);
// words that ask for nothing to draw
const FILLER = new Set([
  'it', 'its', 'please', 'make', 'me', 'i', 'want', 'need', 'give', 'would', 'like', 'really', 'so', 'just', 'one', 'that',
  'which', 'is', 'be', 'top', 'side', 'front', 'body', 'lid', 'cute', 'pretty', 'nice', 'cool', 'lovely', 'beautiful',
  'cozy', 'happy', 'cheerful', 'new', 'old', 'shiny', 'matte', 'glossy', 'painted', 'item', 'thing', 'tool', 'water',
  'plant', 'plants', 'garden', 'watering', 'can', 'cans', 'sprinkler', 'craft', 'some',
]);
export interface PromptUnknowns {
  refBody: boolean; // a library body fits (its details can be checked)
  can: boolean; // it's a watering can
  sizeNamed: boolean;
  colourNamed: boolean;
  details: string[]; // asked-for details no reference can draw, as phrases from the prompt
}
export function unknownsOf(prompt: string): PromptUnknowns {
  const raw = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const m = matchRefs(prompt);
  const can = isWateringCan(m);
  const shaped = can ? shapeWateringCan(m, prompt) : isShip(m) ? shapeShip(m, prompt) : m;
  const loose = new Set(shaped.leftover.filter((w) => !FILLER.has(w) && !FUNCTION_WORDS.test(w)));
  // runs of unplaceable words, in the prompt's own order and spelling
  const details: string[] = [];
  let run: string[] = [];
  for (const w of raw) {
    if (loose.has(sing(w)) || (run.length && loose.has(w))) run.push(w);
    else {
      if (run.length) details.push(run.join(' '));
      run = [];
    }
  }
  if (run.length) details.push(run.join(' '));
  return {
    refBody: !!m.body,
    can,
    sizeNamed: raw.some((w) => SIZE_WORDS.has(w)),
    // a colour phrase, or a material ("wooden")
    colourNamed: colourPhrasesOf(prompt).length > 0 || raw.some((w) => !!colourOf(w) && !isColourWord(w)),
    details: [...new Set(details)],
  };
}
// the prompt without the given detail phrases (the player left them out)
export function withoutDetails(prompt: string, details: string[]): string {
  let p = ` ${prompt} `;
  for (const d of details) p = p.replace(new RegExp(`\\s(?:an?|the|some)?\\s*${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ');
  return p.replace(/\s+/g, ' ').trim();
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
    'Answer any other wish (a name, what it does) through name / narrative_function / gameplay_intent / modifiers.\n' +
    'A word for a STYLE, culture or theme with no library picture (viking, steampunk, royal, candy, spooky, ...) is ' +
    'never ignored: show its 2-4 most characteristic VISIBLE features — pick the body whose parts suit them, recolour ' +
    'parts in the style\'s typical colours, and draw each feature as details in the detail area where it belongs ' +
    '(use several areas when the body has them; e.g. a royal ship: a gold crown at the bow, purple sail, gold trim on the hull).\n' +
    gameColourHint() +
    '\n\n' +
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
  // an exact colour (the model's, or a picked one) in the game's soft palette
  if (/^#[0-9a-f]{6}$/.test(s)) return fitToGame([parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]);
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

// ---- watering cans ---------------------------------------------------------------------------
// Three references, three variants (re-bakes of one count as the same):
// the classic garden can, the golden can and the can with the flower on top.
// Plain wishes alternate between classic and golden for shape diversity;
// the flower can comes from "flower"/"blooming" (a surprise is a decoration
// from surpriseLib.ts, on any variant).
export type CanVariant = 'classic' | 'golden' | 'flower';
const variantOf = (r: RefDoc): CanVariant => (r.id.includes('flower') ? 'flower' : r.id.includes('golden') ? 'golden' : 'classic');
const CAN_FIXED = new Set(['flower', 'rose']); // keep their own colours when the can is recoloured
let lastPlain: CanVariant = Math.random() < 0.5 ? 'classic' : 'golden';

export const isWateringCan = (m: RefMatch) => m.body?.category === 'watering-can';

// the can the words (or the surprise) ask for, recoloured as a whole: a
// named colour goes on every part but the flower (recolour keeps each glyph's
// shading, so the contrast stays), and the flower then takes the colour that
// fits the can best
export function shapeWateringCan(m: RefMatch, prompt: string, opts: { surprise?: boolean; colour?: RGB | null } = {}): RefMatch {
  if (!isWateringCan(m)) return m;
  const ws = words(prompt).map(sing);
  const has = (...xs: string[]) => xs.some((x) => ws.includes(x));
  let v: CanVariant;
  if (has('flower', 'blooming', 'bloom', 'blossom')) v = 'flower';
  else if (has('gold', 'golden', 'brass', 'ornate', 'long', 'fancy')) v = 'golden';
  else if (has('classic', 'garden', 'simple', 'plain', 'old')) v = 'classic';
  else v = lastPlain = lastPlain === 'classic' ? 'golden' : 'classic';
  const pool = REFS.filter((r) => r.role === 'body' && r.category === 'watering-can' && variantOf(r) === v);
  const body = pool[Math.floor(Math.random() * pool.length)] ?? m.body!;
  // the colour asked for: the clarify answer, else one the words named
  const named = opts.colour ?? Object.values(m.colours)[0] ?? null;
  const colours: Record<string, RGB> = {};
  let petals: { part: string; rgb: RGB }[] = [];
  if (named) {
    for (const p of body.parts) if (p.zone !== 'fixed' && !CAN_FIXED.has(p.name)) colours[p.name] = named;
    // the flower's petals (not its leaves) in the colour that fits the can
    if (body.parts.some((p) => p.name === 'flower')) petals = [{ part: 'flower', rgb: accentFor(named) }];
  }
  // the matcher placed "flower" as part of the body: not a leftover
  const leftover = m.leftover.filter((w) => !['flower', 'blooming', 'bloom', 'blossom', 'gold', 'golden', 'classic', 'fancy', 'ornate', 'long'].includes(w));
  // ("can" itself is no wish for a function)
  const fnWish = FUNCTION_WORDS.test(prompt.toLowerCase().replace(/\bwatering\s+cans?\b/g, ''));
  return { ...m, body, colours, petals, leftover, needsModel: leftover.length > 0 || fnWish };
}

// ---- ships: a small modular system (src/data/refs/boat-*-ship, -galleon) ----------------
//   a motif asked on a sail ............ the pirate ship: its skull taken out
//                                         (unless a skull is asked), the motif
//                                         drawn where it was (sail_motif)
//   a bow / figurehead decoration ...... the shark ship: the shark taken out
//                                         (unless a shark is asked), the new one
//                                         drawn where it was (bow_head)
//   the surprise ........................ any ship plus a decoration (surpriseLib.ts)
//   asked by name (pirate, shark, turtle, galleon) that one; a plain ship one
//   of the pirate ship, galleon and shark ship. Small boats (raft, canoe…)
//   keep the little wooden boats.
const SHIP_IDS = { pirate: 'boat-pirate-ship', shark: 'boat-shark-ship', galleon: 'boat-galleon', turtle: 'boat-turtle-ship' } as const;
const SMALL_BOAT = ['raft', 'canoe', 'dinghy', 'rowboat', 'sailboat', 'kayak', 'floss', 'kanu', 'ruderboot', 'radeau', 'balsa', 'zattera', 'vlot'];
const SAIL_WORDS = ['sail', 'sails', 'segel', 'voile', 'voiles', 'vela', 'velas', 'zeil', 'flag', 'flagge', 'banner', 'mainsail'];
const BOW_WORDS = ['bow', 'figurehead', 'front', 'prow', 'bug', 'galionsfigur', 'proue', 'proa', 'prua', 'boeg', 'head', 'kopf'];
const NAMED_SHIP: [keyof typeof SHIP_IDS, string[]][] = [
  ['turtle', ['turtle', 'schildkrote', 'schildkroete', 'tortue', 'tortuga', 'tartaruga', 'schildpad']],
  ['shark', ['shark', 'hai', 'haifisch', 'requin', 'tiburon', 'squalo', 'haai']],
  ['pirate', ['pirate', 'pirat', 'piraten', 'piratenschiff', 'pirata', 'piraat', 'skull', 'totenkopf', 'jolly', 'roger', 'crane']],
  ['galleon', ['galleon', 'galeone', 'galion', 'galeon', 'galjoen']],
];
export const isShip = (m: RefMatch) => m.body?.category === 'boat';

// ---- ship styles: a style with no picture of its own, built from the ships
// we have by its characteristic features (what makes it read as that style):
// the body whose parts suit it, its typical colours, and its features drawn
// into the body's detail areas. Areas are in 0..1 of the area; the shark
// ship's bow is on the left. The model can add more on top (refPrompt).
type Region = RefChoice['details'][number]['regions'][number];
const reg = (primitive: string, cx: number, cy: number, width: number, height: number, material: string, rotation = 0): Region => ({ primitive, cx, cy, width, height, material, rotation });
const SHIP_STYLES: { words: string[]; ship: keyof typeof SHIP_IDS; blank: string; colours: Record<string, RGB>; details: RefChoice['details'] }[] = [
  {
    // a longship: a carved dragon head on the bow, round shields along the
    // hull, a red sail
    words: ['viking', 'vikings', 'wikinger', 'vikinger', 'drakkar', 'longship', 'langschiff', 'drachenboot', 'dragonship', 'norse', 'nordic'],
    ship: 'shark',
    blank: 'figurehead',
    colours: { sail: [186, 72, 58], hull: [120, 80, 50] },
    details: [
      {
        area: 'bow_head',
        regions: [
          reg('rounded_rectangle', 0.68, 0.66, 0.22, 0.7, '#6e4628', -24), // the neck, rising from the hull
          reg('ellipse', 0.42, 0.26, 0.6, 0.38, '#6e4628'), // the head
          reg('triangle', 0.12, 0.32, 0.22, 0.3, '#6e4628', -90), // the snout, pointing forward
          reg('triangle', 0.62, 0.08, 0.18, 0.24, '#e0b85a', 20), // a gilded horn
          reg('point', 0.4, 0.2, 0.1, 0.12, '#f2d16b'), // the eye
          reg('line', 0.18, 0.4, 0.26, 0.06, '#c0453a'), // the red mouth
        ],
      },
      {
        area: 'hull_detail',
        // round shields: a dark rim, red and blue faces, a gold boss
        regions: [0.13, 0.38, 0.63, 0.88].flatMap((cx, i) => [
          reg('circle', cx, 0.5, 0.24, 0.52, '#3a2618'),
          reg('circle', cx, 0.5, 0.17, 0.37, i % 2 ? '#3f6fa8' : '#c0453a'),
          reg('point', cx, 0.5, 0.06, 0.13, '#e0b85a'),
        ]),
      },
    ],
  },
];
const styleOf = (ws: string[]) => SHIP_STYLES.find((st) => st.words.some((w) => ws.includes(w)));

export function shapeShip(m: RefMatch, prompt: string, opts: { surprise?: boolean; colour?: RGB | null } = {}): RefMatch {
  if (!isShip(m)) return m;
  const ws = words(prompt);
  const has = (list: string[]) => list.some((w) => ws.includes(w) || ws.includes(sing(w)));
  // a small boat: one of the little wooden boats
  if (has(SMALL_BOAT)) {
    const small = REFS.filter((r) => r.role === 'body' && r.category === 'boat' && !Object.values(SHIP_IDS).includes(r.id as never));
    const pickSmall = small[Math.floor(Math.random() * small.length)];
    return pickSmall ? matchRefs(prompt, pickSmall) : m;
  }
  const ref = (k: keyof typeof SHIP_IDS) => REFS.find((r) => r.id === SHIP_IDS[k]) ?? null;
  // a known style (a viking ship): its own recipe; the style's words are
  // then no detail, anything else asked still goes to the model
  const style = styleOf(ws);
  const styleBody = style ? ref(style.ship) : null;
  if (style && styleBody) {
    const out = matchRefs(prompt, styleBody);
    out.leftover = out.leftover.filter((w) => !style.words.includes(w) && !SAIL_WORDS.includes(w) && !BOW_WORDS.includes(w) && w !== 'ship' && w !== 'boat');
    out.colours = { ...out.colours, ...Object.fromEntries(Object.entries(style.colours).map(([k, v]) => [k, fitToGame(v)])) };
    if (opts.colour) out.colours.sail = opts.colour;
    out.blank = [{ part: style.blank }];
    out.detailArea = style.details[0].area;
    out.styleDetails = style.details;
    out.needsModel = out.leftover.length > 0 || FUNCTION_WORDS.test(prompt.toLowerCase());
    return out;
  }
  const named = NAMED_SHIP.find(([, list]) => has(list))?.[0];
  // what's asked beyond the ship itself, matched on the pirate ship (the
  // most parts) to see the leftover words
  const probe = matchRefs(prompt, ref('pirate') ?? m.body!);
  const extra = probe.leftover.filter((w) => !SAIL_WORDS.includes(w) && !BOW_WORDS.includes(w) && !NAMED_SHIP.some(([, l]) => l.includes(w)));
  const onSail = has(SAIL_WORDS);
  const onBow = has(BOW_WORDS);
  let pick: keyof typeof SHIP_IDS;
  if (onBow && (extra.length || named === 'shark')) pick = 'shark';
  else if (onSail || (extra.length && named !== 'turtle' && named !== 'galleon' && named !== 'shark')) pick = 'pirate';
  else if (named) pick = named;
  else pick = (['pirate', 'galleon', 'shark'] as const)[Math.floor(Math.random() * 3)];
  const body = ref(pick);
  if (!body) return m;
  const out = matchRefs(prompt, body);
  // the place words aren't details ("head" stays: "a dragon head")
  for (const w of [...SAIL_WORDS, ...BOW_WORDS].filter((x) => x !== 'head' && x !== 'kopf')) out.leftover = out.leftover.filter((x) => x !== w);
  if (!out.leftover.some((w) => w !== 'head' && w !== 'kopf')) out.leftover = out.leftover.filter((w) => w !== 'head' && w !== 'kopf');
  // the named ship's own words aren't details
  out.leftover = out.leftover.filter((w) => !NAMED_SHIP.some(([, l]) => l.includes(w)));
  if (opts.colour) {
    const main = mainPart(body);
    if (main) out.colours[main] = opts.colour;
  }
  // a new motif on the sail: the skull goes (painted over in the sail's colour)
  if (pick === 'pirate' && extra.length && !has(['skull', 'totenkopf', 'jolly', 'crane'])) {
    out.blank = [{ part: 'motif', fill: 'sail' }];
    out.detailArea = 'sail_motif';
  }
  // a new bow decoration: the shark goes
  if (pick === 'shark' && extra.length && !has(['shark', 'hai', 'haifisch', 'requin', 'tiburon', 'squalo', 'haai'])) {
    out.blank = [{ part: 'figurehead' }];
    out.detailArea = 'bow_head';
  }
  const fnWish = FUNCTION_WORDS.test(prompt.toLowerCase());
  out.needsModel = out.leftover.length > 0 || fnWish;
  return out;
}

// ---- one colour for the whole thing (the clarify answer) ------------------------------
// a body asked for by name: all its primary and secondary parts; a watering
// can or ship is recoloured by its own shaping above; anything else its
// main part
export function wholeColour(m: RefMatch, rgb: RGB): RefMatch {
  const b = m.body;
  if (!b || isWateringCan(m) || isShip(m)) return m;
  const colours = { ...m.colours };
  if (b.names?.length) for (const p of b.parts) if (p.zone === 'primary' || p.zone === 'secondary') colours[p.name] = rgb;
  const main = mainPart(b);
  if (!b.names?.length && main) colours[main] = rgb;
  return { ...m, colours };
}

// ---- exact colours from the model (llm.ts craftColours) ---------------------------------
// The player's colour words ("baby blue", "hellblau", "the colour of the sea")
// go to the model with the body's parts; it answers a hex colour per part
// that should change, as many as needed.
const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
// each part's main colour now: the average of its opaque pixels
export async function partSwatches(body: RefDoc): Promise<{ name: string; zone: string; hex: string }[]> {
  const img = await loadArt(body.id);
  const mask = decodeMask(body.mask, img.w * img.h);
  const sum = body.parts.map(() => [0, 0, 0, 0]);
  mask.forEach((v, i) => {
    if (!v || img.data[i * 4 + 3] < 128 || !sum[v - 1]) return;
    for (let k = 0; k < 3; k++) sum[v - 1][k] += img.data[i * 4 + k];
    sum[v - 1][3]++;
  });
  return body.parts.map((p, i) => ({ name: p.name, zone: p.zone, hex: sum[i][3] ? hex([sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]]) : '#888888' }));
}
export function colourPrompt(): string {
  return `You colour a game item made from a marked picture. You get its parts (name, zone, current colour) and the player's words.
Reply with JSON only: {"<part name>": "#rrggbb", ...} for exactly the parts that should change colour, as many as the words need.
- Match the player's colour words precisely: "baby blue" is a soft light blue (#9fd3f5), not plain blue; "dunkelrot" a dark red; "the colour of the sea" a sea blue-green; "rainbow" gives the parts different rainbow colours.
- A colour said for the whole thing ("a baby blue dragon") goes on every primary and secondary part; a colour said with a part ("red wings") only on that part.
- Never change parts in zone "fixed" (eyes, faces, outlines). Keep "trim" parts unless the words name them.
- Use only the part names given.
${gameColourHint()}`;
}
export function parseColours(raw: Record<string, unknown> | null | undefined, body: RefDoc): Record<string, RGB> | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.colours && typeof raw.colours === 'object' ? (raw.colours as Record<string, unknown>) : raw;
  const out: Record<string, RGB> = {};
  for (const [k, v] of Object.entries(src)) {
    const part = body.parts.find((p) => p.name === k);
    const mt = typeof v === 'string' ? v.trim().match(/^#?([0-9a-f]{6})$/i) : null;
    if (!part || part.zone === 'fixed' || !mt) continue;
    const n = parseInt(mt[1], 16);
    out[part.name] = fitToGame([n >> 16, (n >> 8) & 255, n & 255]);
  }
  return Object.keys(out).length ? out : null;
}
// the model's colours on the match: they replace the matcher's (taken from
// the same words); a watering can's flower keeps its own place (its petals)
export function applyColours(m: RefMatch, exact: Record<string, RGB>): RefMatch {
  const colours: Record<string, RGB> = {};
  for (const [k, v] of Object.entries(exact)) if (!(isWateringCan(m) && CAN_FIXED.has(k))) colours[k] = v;
  let petals = m.petals;
  if (isWateringCan(m) && m.body!.parts.some((p) => p.name === 'flower')) {
    const first = Object.values(colours)[0];
    petals = exact.flower ? [{ part: 'flower', rgb: exact.flower }] : first ? [{ part: 'flower', rgb: accentFor(first) }] : m.petals;
  }
  return { ...m, colours, petals };
}

// a flower colour that sits well on a can of colour `rgb`: of a few
// blossom colours, the one whose hue is farthest from the can's (a grey or
// white can keeps the pink)
const BLOSSOMS: { hue: number; rgb: RGB }[] = [
  { hue: 330, rgb: [255, 133, 198] }, // pink, the reference's own
  { hue: 48, rgb: [255, 214, 74] }, // buttercup yellow
  { hue: 275, rgb: [190, 140, 255] }, // violet
  { hue: 20, rgb: [255, 150, 90] }, // peach
];
export function accentFor(rgb: RGB): RGB {
  const [r, g, b] = rgb;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 30) return BLOSSOMS[0].rgb;
  const d = mx - mn;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const dist = (a: number) => Math.min(Math.abs(a - h), 360 - Math.abs(a - h));
  return BLOSSOMS.reduce((best, c) => (dist(c.hue) > dist(best.hue) ? c : best)).rgb;
}

// ---- 3. build -----------------------------------------------------------------------------------
const SIGNS = { small: 320, medium: 520, large: 800 } as const;
const SCREEN_W = { small: 9, medium: 13, large: 18 } as const; // on-screen width in ch
// watering cans are drawn finer: 600-800 glyphs, the middle by default
const CAN_SIGNS = { small: 600, medium: 700, large: 800 } as const;
const CAN_SCREEN_W = { small: 11, medium: 13, large: 15 } as const;
// a pet follows the player at about half the player's width
const PET_SCREEN_W = { small: 3, medium: 4, large: 5.5 } as const;
// categories built from the library on every link (not only REF_CRAFT_ON)
// (and any body asked for by its name)
export const isAlwaysRef = (m: RefMatch) => m.body?.category === 'watering-can' || m.body?.category === 'pet' || m.body?.category === 'boat' || !!m.body?.names?.length;

export interface RefSprite {
  surpriseName?: string; // the surprise decoration that was added ("a little fish")
  lines: string[];
  colors: string[];
  palette: Record<string, string>;
  scale: number;
  signs: number;
  body: RefDoc;
}

// `detail` (the /2 link's detail preference, craft/prefs.ts): the same
// picture baked with fewer (-1) or more (+1) glyphs, the same size on screen
const DETAIL_SIGNS = { [-1]: 0.45, 0: 1, 1: 2 } as const;
export async function buildFromMatch(m: RefMatch & { details?: RefChoice['details']; mirror?: boolean }, size?: 'small' | 'medium' | 'large', detail: -1 | 0 | 1 = 0): Promise<RefSprite> {
  const body = m.body!;
  const recipe: Recipe = {
    body: { ref: body, img: await loadArt(body.id) },
    colours: m.colours,
    swaps: await Promise.all(m.swaps.map(async (s) => ({ part: s.part, ref: s.ref, img: await loadArt(s.ref.id) }))),
    decorations: await Promise.all(m.decorations.map(async (d) => ({ ref: d.ref, img: await loadArt(d.ref.id), area: d.area }))),
    details: [...(m.styleDetails ?? []), ...(m.details ?? [])].map((d) => ({
      area: d.area,
      regions: d.regions.map((r): DetailRegion => ({ ...r, rgb: rgbOf(r.material) ?? MATERIALS.stone })),
      // an emptied part's place: drawn freely there
      free: !!m.blank?.some((b) => !b.fill) && d.area === m.detailArea,
    })),
    mirror: m.mirror,
    petals: m.petals,
    blank: m.blank,
  };
  // the surprise: one extra of this item's category (craft/surpriseLib.ts),
  // placed from its marks (a dog's head, a ship's sail, a can's lid)
  let surpriseName: string | undefined;
  if (m.surprise) {
    const fit = body.category === 'boat' ? 'ships' : body.category === 'watering-can' ? 'watering' : body.category === 'pet' || body.gameCategory === 'pets' ? 'pets' : null;
    const seed = m.surprise.seed;
    recipe.after = (l, areaOf) => {
      surpriseName = applySurprise(fit, l, areaOf, seed, m.surprise?.only) ?? undefined;
    };
  }
  const layer = compose(recipe);
  // watering cans, pets (the dogs), ships and named bodies are drawn finer:
  // 600-800 glyphs
  const can = body.category === 'watering-can' || body.category === 'pet' || body.category === 'boat' || !!body.names?.length;
  const band = size ?? (can ? 'medium' : body.sizeBand ?? 'small');
  // references carry real transparency: gaps are meant (no hole filling)
  // on screen by its game category: a pet follows at about half the
  // player's width, a vehicle has the ships' size, the rest the cans'
  const screenW =
    body.category === 'pet' || body.gameCategory === 'pets' ? PET_SCREEN_W : body.category === 'boat' || body.gameCategory === 'vehicle' ? SCREEN_W : can ? CAN_SCREEN_W : SCREEN_W;
  const g = bakeImage(layer.img, Math.round((can ? CAN_SIGNS : SIGNS)[band] * DETAIL_SIGNS[detail]), screenW[band]);
  return { ...g, body, surpriseName };
}

// A picture (a reference's composed layer, or the AI's drawing on /4,
// svgDraw.ts) baked into the game's glyphs: `signs` glyphs, `screenW` ch
// wide on screen. Real transparency: gaps are meant (no hole filling).
export function bakeImage(img: Img, signs: number, screenW: number): Omit<RefSprite, 'body' | 'surpriseName'> {
  const b = bake(img, { ...DEFAULTS, bg: 'alpha', fillHoles: false, signs }, getAtlas());
  const g = bakedToSprite(b);
  const w = Math.max(1, ...g.sprite.map((l) => l.length));
  return { lines: g.sprite, colors: g.colors, palette: g.palette, scale: screenW / w, signs: b.signs };
}
// the glyph counts and on-screen widths by category and size, for a drawn
// picture (the same bands as the library's bodies)
export function drawnBands(category: Category, size: 'small' | 'medium' | 'large' = 'medium') {
  const screenW = category === 'pets' ? PET_SCREEN_W : category === 'vehicle' ? SCREEN_W : CAN_SCREEN_W;
  return { signs: CAN_SIGNS[size], screenW: screenW[size] };
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

// ---- the words the library knows (craft/lexicon.ts) ---------------------------------------
// every body's title words, part names, tags and names, the size / filler
// words and the ship words (named ships, styles, sail / bow words, dog words)
export function libraryWords(): { known: Set<string>; filler: Set<string>; sizes: Set<string> } {
  const known = new Set<string>();
  const addAll = (s: string | undefined) => words(s ?? '').forEach((w) => known.add(w));
  for (const r of REFS) {
    addAll(r.title);
    r.parts.forEach((p) => addAll(p.name.replace(/[_-]/g, ' ')));
    (r.tags ?? []).forEach(addAll);
    (r.names ?? []).forEach(addAll);
  }
  [...SIZE_WORDS, ...SAIL_WORDS, ...BOW_WORDS, ...SMALL_BOAT, ...DOG_WORDS, ...NAMED_SHIP.flatMap(([, l]) => l), ...SHIP_STYLES.flatMap((s) => s.words)].forEach((w) => known.add(w));
  for (const [k, l] of Object.entries(SYNONYMS)) [k, ...l].forEach(addAll);
  return { known, filler: new Set([...FILLER, ...STOP]), sizes: SIZE_WORDS };
}
