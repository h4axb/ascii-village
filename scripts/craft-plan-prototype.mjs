// ---------------------------------------------------------------------------
// PHASE A PROTOTYPE — crafting sprite generator overhaul (see the plan at
// C:\Users\hanah\.claude\plans\greedy-orbiting-dream.md for full context).
//
// This is a THROWAWAY harness, not part of the app. It exists to answer one
// question before any production code changes: can a cheap model
// (MODELS.fast-equivalent, i.e. VITE_LLM_MODEL) produce genuinely sensible
// SPATIAL/SEMANTIC region decompositions — not just syntactically valid
// JSON — for open-ended crafting prompts? Nothing here is wired into the
// app; it only prints raw CraftPlan JSON for human review.
//
// Run:  node --env-file=.env scripts/craft-plan-prototype.mjs
// Run one prompt only:  node --env-file=.env scripts/craft-plan-prototype.mjs "magical strawberry"
// ---------------------------------------------------------------------------

import { chatJSON, MODELS, mapLimit } from './lib/requesty.mjs';

// ---- mirrors src/craft/spriteConfig.ts's existing constants exactly ----
// (kept duplicated here on purpose — this is throwaway prototype code in
// scripts/, which cannot import a .ts file directly; Phase B ports the
// confirmed-good version of this prompt into spriteGen.ts for real.)

const CraftCategorySizeDefault = {
  plant: 'small', pets: 'small', food: 'small', utensils: 'small',
  clothing: 'small', vehicle: 'medium',
};
const SIZE_BANDS = {
  small: { minW: 5, maxW: 8, maxH: 4 },
  medium: { minW: 9, maxW: 14, maxH: 6 },
  large: { minW: 15, maxW: 22, maxH: 9 },
};
const SIZE_TIER_ORDER = ['small', 'medium', 'large'];
function adjustSizeTier(base, dir) {
  if (dir === 'default') return base;
  const i = SIZE_TIER_ORDER.indexOf(base) + (dir === 'bigger' ? 1 : -1);
  return SIZE_TIER_ORDER[Math.max(0, Math.min(SIZE_TIER_ORDER.length - 1, i))];
}

const TOKEN_CATEGORIES =
  'plant (flowers, trees, flora), pets (animals, creatures, companions), ' +
  'clothing (wearables, accessories), vehicle (things you ride), ' +
  'food (edible things), utensils (tools, weapons, furniture, misc objects)';
const CATEGORY_SIZE_DEFAULTS_TEXT = Object.entries(CraftCategorySizeDefault)
  .map(([cat, size]) => `${cat} defaults to ${size}`)
  .join(', ');

// MATERIALS — exact RGB values from craft_glyph.py, presets ONLY (see the
// plan's §5 guardrail: never grow this into a semantic taxonomy).
const MATERIALS = {
  wood: [150, 96, 52], metal: [176, 180, 188], gold: [212, 168, 74],
  cloth: [196, 64, 64], leaf: [86, 150, 64], stone: [150, 146, 138],
  glass: [140, 200, 210], water: [70, 130, 200], fire: [230, 120, 40],
  bone: [222, 210, 180], leather: [120, 78, 46], skin: [240, 196, 160],
};
const MATERIALS_HINT = 'wood (warm brown), metal (cool gray-blue), gold, cloth (red-ish fabric default), ' +
  'leaf (green), stone (grey), glass (pale cyan, translucent-reading), water (blue), fire (orange), ' +
  'bone (pale cream), leather (dark brown), skin (warm tan)';

const FACE_SET = ['·', 'ω', '°', '_'];

// ---------------------------------------------------------------------------
// planPrompt() — the system prompt for the expanded Stage 0 call.
// ---------------------------------------------------------------------------
function planPrompt() {
  return [
    'You plan crafted items for Asciia Bay, a cozy, family-friendly ASCII island-village game. ' +
      `The token categories are: ${TOKEN_CATEGORIES}.`,

    'First, screen the request: (1) "fit" — does it belong to the GIVEN token category? Be LENIENT: a ' +
      'hybrid like "a dog with a witch hat" fits pets because the core subject is a pet; only mark ' +
      'fit=false when the core subject clearly belongs elsewhere. (2) "tokenHint" — when fit is false, ' +
      'the category it WOULD belong to (or "none"). (3) "sensitive" — true only for violent, gory, ' +
      'sexual, hateful, or otherwise family-unfriendly content.',

    '(4) "sizeAdjust" — every category already has a default drawn size ' +
      `(${CATEGORY_SIZE_DEFAULTS_TEXT}). Judge ONLY relative to what\'s typical for the request\'s OWN ` +
      'category: "default" for a typical example (this covers most requests, even ones that sound big ' +
      'in real life, like a plain "a car" for vehicle); "smaller" only when the request\'s own words name ' +
      'something distinctly smaller than typical (a "tiny"/"miniature" adjective, or a toy/mouse-scale ' +
      'subject); "bigger" only when distinctly larger than typical ("giant"/"huge", or an unusually large ' +
      'example like a bus among vehicles).',

    'Then decide "width" and "height" (in character cells) for the canvas you will place regions on — ' +
      'these MUST fall inside whichever size band your own sizeAdjust choice resolves to, given below. ' +
      `Bands: small ${SIZE_BANDS.small.minW}-${SIZE_BANDS.small.maxW} wide (max ${SIZE_BANDS.small.maxH} tall), ` +
      `medium ${SIZE_BANDS.medium.minW}-${SIZE_BANDS.medium.maxW} wide (max ${SIZE_BANDS.medium.maxH} tall), ` +
      `large ${SIZE_BANDS.large.minW}-${SIZE_BANDS.large.maxW} wide (max ${SIZE_BANDS.large.maxH} tall). ` +
      'Character CELLS are taller than wide (about 1.667x) — a round or wide subject (ball, coin, wheel) ' +
      'needs MORE columns than rows to read as round, not equal width/height.',

    'Now plan the VISUAL COMPOSITION as a list of "regions" and, optionally, a "face". You are choosing ' +
      'WHERE things go and WHAT they represent geometrically — you never choose a character, a colour ' +
      'shading value, or reason about brightness; that is rendered automatically from your plan.',

    'Each region has:\n' +
      '- "id": a short unique lowercase identifier ("body", "flame_core") used only to reference this ' +
      'region from "relations" below — never shown to the player.\n' +
      '- "primitive": one of "rect" (a filled box — solid/blocky forms), "ellipse" (a filled clean oval — ' +
      'round/smooth forms), "blob" (a filled ORGANIC/irregular rounded form — berries, clouds, rocks, ' +
      'things that should NOT look like a precise geometric oval), "line" (a thin stroke — a stem, a crack, ' +
      'a whisker, a blade edge), "point" (a tiny isolated mark — a single sparkle, a bead, an eye dot), ' +
      '"arc" (a curved outline — a smile, a crescent, a ring/halo rim).\n' +
      '- "bounds": {"x","y","width","height"} in whole character cells, top-left origin, within your ' +
      'chosen canvas (x+width <= your width, y+height <= your height).\n' +
      '- "material": EITHER one of these named presets — ' + MATERIALS_HINT + ' — OR, for anything that ' +
      'isn\'t a real physical material (magic, moonlight, jelly, holographic, ghostly, a candy colour, ' +
      'an aura, anything abstract), a literal "#rrggbb" hex that reads as the right colour instead. The ' +
      'named presets are surface/colour shortcuts, not a category system — most concepts will NOT match ' +
      'one, and that is expected; pick a hex.\n' +
      '- "role": "body" or "attachment" for major anatomy/structure, "detail" or "accent" for small marks ' +
      '(seeds, sparkles, tiny features) that should NOT compete with major anatomy for space.\n' +
      '- "importance": 1-5, where 5 is a defining, unmistakable feature and 1 is a minor flourish that ' +
      'could be dropped without losing the concept.',

    'Regions are painted in the ORDER you list them — a later region painted over an earlier one\'s cells ' +
      'wins. Paint base/major shapes first, details and highlights last. Worked example, "wooden torch": ' +
      'first a "rect" wood handle (id "handle", role body), then a "blob" fire (id "flame", role ' +
      'attachment) painted OVER the top of the handle, then a smaller brighter "blob" fire core (id ' +
      '"flame_core", role detail) painted over the middle of the flame.',

    'Optionally, "relations": a list of {"subject":id,"relation":"attached_to"|"extends_from"|' +
      '"centered_on","object":id} linking two region ids by EXACTLY one of these three verbs: ' +
      '"attached_to" (subject is fixed onto object, e.g. a flame head attached_to a torch handle), ' +
      '"extends_from" (subject grows/extends out of object, e.g. a stem extends_from a flower base), ' +
      '"centered_on" (subject should be centered over object, e.g. a face centered_on a head). Add a ' +
      'relation whenever one part should be attached to, extending from, or centered on another — this ' +
      'keeps them touching even after your composition is rescaled to fit its size band. Omit ' +
      '"relations" entirely for a simple item where nothing needs to connect. Do not invent other ' +
      'relation verbs — only these three are understood. Worked example, the torch above: ' +
      '{"subject":"flame","relation":"attached_to","object":"handle"}.',

    'Use "line"/"point"/"arc" regions for anything a filled shape cannot express — this matters most for ' +
      'abstract or non-physical traits. A request like "magical strawberry" needs a recognizable berry ' +
      'body (blob) and leaf crown (a few small triangular rects or an arc), PLUS several small separate ' +
      '"point" regions (role accent, low width/height like 1x1) scattered near — not on top of — the ' +
      'berry to read as magical sparkle, since "magical" has no physical shape or material of its own.',

    'Give the whole thing a "name" (short, cute) and a "parts" list (short phrases, the same anatomy-first ' +
      'reasoning as before — write this BEFORE the regions array, so you reason about anatomy before ' +
      'committing to geometry).',

    'Optionally, "face": a short list of {"x","y","glyph"} placing literal cute dot-face glyphs on top of ' +
      `everything else, glyph one of: ${FACE_SET.join(' ')} — use this for a creature/pet\'s expression, ` +
      'omit entirely for non-creature items.',

    'Reply with JSON only, this exact shape:\n' +
      '{"fit": true|false, "tokenHint": "plant|pets|clothing|vehicle|food|utensils|none", ' +
      '"sensitive": true|false, "sizeAdjust": "smaller"|"default"|"bigger", ' +
      '"width": number, "height": number, "name": string, "parts": [string, ...], ' +
      '"regions": [{"id": string, "primitive": string, "bounds": {"x":n,"y":n,"width":n,"height":n}, ' +
      '"material": string, "role": string, "importance": 1-5}, ...], ' +
      '"relations": [{"subject":id,"relation":"attached_to"|"extends_from"|"centered_on","object":id}, ...] ' +
      '(optional, omit if nothing needs to connect), ' +
      '"face": [{"x":n,"y":n,"glyph":string}, ...] (optional, omit if not a creature)}',
  ].join('\n\n');
}

async function planCraft(prompt, category) {
  const base = CraftCategorySizeDefault[category] ?? 'medium';
  const messages = [
    { role: 'system', content: planPrompt() },
    { role: 'user', content: `Token category: ${category}. Request: "${prompt}".` },
  ];
  const r = await chatJSON(messages, { model: MODELS.sprites, temperature: 0.7, maxTokens: 700 });
  return { raw: r, sizeClass: adjustSizeTier(base, r?.sizeAdjust === 'smaller' || r?.sizeAdjust === 'bigger' ? r.sizeAdjust : 'default') };
}

// ---------------------------------------------------------------------------
// Test prompts — spanning the hard cases from the plan, "magical strawberry"
// first since it's the key acceptance test.
// ---------------------------------------------------------------------------
const TEST_PROMPTS = [
  ['magical strawberry', 'food'],
  ['sad cloud', 'utensils'],
  ['flying banana', 'food'],
  ['tiny moon cat', 'pets'],
  ['crystal flower', 'plant'],
  ['haunted teapot', 'utensils'],
  ['robot butterfly', 'pets'],
  ['mushroom house', 'utensils'],
  ['three-headed fish', 'pets'],
  ['flaming sword', 'utensils'],
  ['wooden torch', 'utensils'],
  ['glass potion of water', 'utensils'],
  ['golden sword', 'utensils'],
  ['giant stone golem', 'pets'],
  ['friendly round pet creature', 'pets'],
  ['ghost', 'pets'],
  ['jelly cube', 'food'],
  ['holographic disc', 'utensils'],
  ['pearl necklace', 'clothing'],
  ['lava rock', 'utensils'],
];

function regionSummary(regions) {
  if (!Array.isArray(regions)) return '(not an array!)';
  return regions
    .map((r) => `${r?.id ?? '?'} ${r?.role ?? '?'}/${r?.primitive ?? '?'} mat=${r?.material ?? '?'} imp=${r?.importance ?? '?'} ` +
      `@(${r?.bounds?.x},${r?.bounds?.y} ${r?.bounds?.width}x${r?.bounds?.height})`)
    .join('\n    ');
}

function relationSummary(relations) {
  if (!Array.isArray(relations) || relations.length === 0) return '(none)';
  return relations.map((r) => `${r?.subject} ${r?.relation} ${r?.object}`).join(', ');
}

async function main() {
  const only = process.argv[2];
  const prompts = only ? TEST_PROMPTS.filter(([p]) => p === only) : TEST_PROMPTS;
  if (only && prompts.length === 0) {
    // allow an ad-hoc prompt not in the list, defaulting category to 'utensils'
    prompts.push([only, 'utensils']);
  }

  console.log(`Model: ${MODELS.sprites}\n`);

  const results = await mapLimit(prompts, 4, async ([prompt, category]) => {
    try {
      const { raw, sizeClass } = await planCraft(prompt, category);
      return { prompt, category, ok: true, raw, sizeClass };
    } catch (e) {
      return { prompt, category, ok: false, error: e.message };
    }
  });

  for (const r of results) {
    console.log('='.repeat(78));
    console.log(`PROMPT: "${r.prompt}"  (category: ${r.category})`);
    if (!r.ok) {
      console.log(`  FAILED: ${r.error}`);
      continue;
    }
    const p = r.raw;
    console.log(`  fit=${p.fit} tokenHint=${p.tokenHint ?? '-'} sensitive=${p.sensitive} sizeAdjust=${p.sizeAdjust} -> sizeClass=${r.sizeClass}`);
    console.log(`  name="${p.name}" canvas=${p.width}x${p.height}`);
    console.log(`  parts: ${Array.isArray(p.parts) ? p.parts.join(' | ') : '(missing)'}`);
    console.log(`  regions (${Array.isArray(p.regions) ? p.regions.length : 0}):`);
    console.log('    ' + regionSummary(p.regions));
    console.log(`  relations: ${relationSummary(p.relations)}`);
    if (p.face) console.log(`  face: ${JSON.stringify(p.face)}`);
    console.log();
  }

  console.log('='.repeat(78));
  console.log(`Done: ${results.filter((r) => r.ok).length}/${results.length} succeeded.`);
}

main();
