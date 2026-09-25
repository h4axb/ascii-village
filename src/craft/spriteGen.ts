// ---------------------------------------------------------------------------
// STAGE 0 — the pre-flight screen, now expanded into the full visual planner.
// ONE cheap JSON call decides everything needed before rendering: content
// safety, size, AND the region-by-region visual composition (CraftPlan).
// There is no separate Stage 2 any more — a local, deterministic renderer
// (glyphRender.ts) turns the plan into glyphs; the LLM never picks a literal
// character or reasons about luminance/shading.
// ---------------------------------------------------------------------------

import {
  adjustSizeTier,
  CATEGORY_SIZE_DEFAULT,
  FACE_SET,
  type CraftCategory,
  type CraftPlan,
  type FaceMark,
  type RegionSpec,
  type ShapeRelation,
  type SizeClass,
  type SpatialRelation,
} from './spriteConfig';
import { MATERIALS_HINT } from './materials';
import { checkPolicy } from './policy';

// Local vision/JSON message types (kept out of the client to respect the
// craft/ <-> llm.ts import boundary — llm.ts owns the actual client).
type ContentPart =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image_url'; image_url: { url: string } };
interface VMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}
export type VisionJSON = <T>(
  messages: VMessage[],
  opts?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: { type: 'disabled' | 'enabled' | 'adaptive' };
    fallbackModel?: string;
  },
) => Promise<T>;

const TOKEN_CATEGORIES =
  'plant (flowers, trees, flora), pets (animals, creatures, companions), ' +
  'clothing (wearables, accessories), vehicle (things you ride), ' +
  'food (edible things), utensils (tools, weapons, furniture, misc objects)';

const CATEGORY_SIZE_DEFAULTS_TEXT = (
  Object.entries(CATEGORY_SIZE_DEFAULT) as [string, SizeClass][]
)
  .map(([cat, size]) => `${cat} defaults to ${size}`)
  .join(', ');

// ---------------------------------------------------------------------------
// planPrompt() — the system prompt for the expanded Stage 0 call. Confirmed
// live against ~20 diverse prompts (Phase A prototype, scripts/craft-plan-
// prototype.mjs) before this was ported into production, including the
// adversarial "magical strawberry" case (a physical body + separate small
// accent regions for a trait with no physical shape).
// ---------------------------------------------------------------------------

export function planPrompt(): string {
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

    'Then decide "width" and "height" as an ASPECT-RATIO HINT ONLY — any two positive numbers describing ' +
      'the object\'s proportions (e.g. 3 and 1 for a long thin snake, 1 and 1 for something roughly as ' +
      'wide as tall). These are NOT literal cell counts — code picks the actual canvas size afterward, ' +
      'using your numbers only as a shape hint, so do not worry about hitting an exact number. Character ' +
      'CELLS are taller than wide (about 1.667x) — a round or wide subject (ball, coin, wheel) needs a ' +
      'bigger width number than height to read as round, not equal width/height.',

    'SILHOUETTE FIRST. Before anything else, identify the 3-6 largest recognizable masses of the object — ' +
      'write these as a short "parts" list (short phrases, e.g. ["hull", "mast", "sail"]). These masses, ' +
      'built from a handful of base regions, must make the object recognizable by SHAPE ALONE, with no ' +
      'texture, colour, or small decoration to lean on. Base shapes must create a recognizable silhouette ' +
      'before details are added — do not compensate for a weak silhouette with texture or decorative ' +
      'regions; those cannot fix a composition whose outline doesn\'t already read as the object.',

    'Now plan the VISUAL COMPOSITION as a list of "regions" and, optionally, a "face". You are choosing ' +
      'WHERE things go and WHAT they represent geometrically — you never choose a character, a colour ' +
      'shading value, or reason about brightness; that is rendered automatically from your plan. Build the ' +
      'base/major masses from your "parts" list FIRST (role "body"/"attachment"), then, only once that base ' +
      'silhouette alone would be recognizable, add "detail"/"accent" regions for anything the player ' +
      'explicitly asked for, or — if the request left room to invent — 1-2 small inferred details. Do not ' +
      'add details to compensate for a base shape that isn\'t working; fix the base shapes instead.',

    'Each region has:\n' +
      '- "id": a short unique lowercase identifier ("body", "flame_core") used only to reference this ' +
      'region from "relations" below — never shown to the player.\n' +
      '- "primitive": one of 12 genuinely mathematical shapes: "rectangle" (solid/blocky forms), ' +
      '"rounded_rectangle" (a rectangle with softened corners), "circle" (perfectly round — set BOTH ' +
      '"width" AND "height" to the SAME number, the diameter — never omit or null "height"), "ellipse" ' +
      '(an oval, width and height may differ), "triangle" ' +
      '(one pointed apex, wide base — use "rotation" to change which way it points), "trapezoid" ' +
      '(four-sided, wider at one end than the other), "diamond" (a rotated-square rhombus), "semicircle" ' +
      '(half a circle, flat edge down by default — use "rotation" to change facing), "arc" (a curved RING ' +
      'SEGMENT, NOT a full ring — a smile, a crescent rim, a halo arc), "line" (a thin stroke — a stem, a ' +
      'crack, a whisker), "point" (a tiny isolated mark — a single sparkle, a bead, an eye dot), "blob" ' +
      '(an ORGANIC/irregular rounded form — berries, clouds, rocks — should NOT look like a precise ' +
      'geometric oval). Use the SAME 12 shapes for base masses and for small details — there is no ' +
      'separate "detail" vocabulary.\n' +
      '- "bounds": {"cx","cy","width","height","rotation"} — "cx"/"cy" are the shape\'s CENTRE (not its ' +
      'top-left corner), as a fraction 0..1 of the eventual canvas; "width"/"height" are also fractions ' +
      '0..1 of the eventual canvas. "rotation" is OPTIONAL, in degrees (0 = unrotated), and works for ' +
      'every primitive except circle/point.\n' +
      '- A few primitives take EXTRA fields alongside "bounds": "rounded_rectangle" may add "cornerRadius" ' +
      '(0-0.5, default ~0.2); "trapezoid" may add "topWidth" and "bottomWidth" (each 0-1, fraction of its ' +
      'own width — omit either to default to 1, a plain rectangle); "arc" needs "startAngle" and ' +
      '"endAngle" (degrees, 0 = east/right, counter-clockwise — e.g. 0 to 180 for a top half-ring). Every ' +
      'other primitive needs no extra fields.\n' +
      '- "material": EITHER one of these named presets — ' + MATERIALS_HINT + ' — OR, for anything that ' +
      'isn\'t a real physical material (magic, moonlight, jelly, holographic, ghostly, a candy colour, ' +
      'an aura, anything abstract), a literal "#rrggbb" hex that reads as the right colour instead. The ' +
      'named presets are surface/colour shortcuts, not a category system — most concepts will NOT match ' +
      'one, and that is expected; pick a hex.\n' +
      '- "role": "body" or "attachment" for major anatomy/structure, "detail" or "accent" for small marks ' +
      '(seeds, sparkles, tiny features) that should NOT compete with major anatomy for space — these are ' +
      'tracked against a SEPARATE, more generous budget.\n' +
      '- "importance": 1-5, where 5 is a defining, unmistakable feature and 1 is a minor flourish that ' +
      'could be dropped without losing the concept.',

    'Regions are painted in the ORDER you list them — a later region painted over an earlier one\'s cells ' +
      'wins. Paint base/major shapes first, details and highlights last. Worked example, "wooden torch": ' +
      'first a "rectangle" wood handle (id "handle", role body) around cx=0.5, cy=0.75, width=0.2, ' +
      'height=0.4, then a "blob" fire (id "flame", role attachment) painted OVER the top of the handle ' +
      'around cx=0.5, cy=0.35, width=0.35, height=0.35, then a smaller brighter "blob" fire core (id ' +
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

    'Use "line"/"point"/"arc" regions for DETAILS a filled shape cannot express — this matters most for ' +
      'abstract or non-physical traits, and only once the base silhouette already reads. A request like ' +
      '"magical strawberry" needs a recognizable berry body (blob) and leaf crown (a few small triangular ' +
      '"triangle" shapes or an "arc") as its BASE, PLUS — as a detail added after that base is solid — ' +
      'several small separate "point" regions (role accent, small width/height like 0.03-0.06) scattered ' +
      'near — not on top of — the berry to read as magical sparkle, since "magical" has no physical shape ' +
      'or material of its own.',

    'Give the whole thing a "name" (short, cute).',

    'Optionally, "face": a short list of {"x","y","glyph"} placing literal cute dot-face glyphs on top of ' +
      `everything else, glyph one of: ${FACE_SET.join(' ')} — use this for a creature/pet\'s expression, ` +
      'omit entirely for non-creature items.',

    'Reply with JSON only, this exact shape:\n' +
      '{"fit": true|false, "tokenHint": "plant|pets|clothing|vehicle|food|utensils|none", ' +
      '"sensitive": true|false, "sizeAdjust": "smaller"|"default"|"bigger", ' +
      '"width": number, "height": number, "name": string, "parts": [string, ...], ' +
      '"regions": [{"id": string, "primitive": string, "bounds": {"cx":n,"cy":n,"width":n,"height":n,' +
      '"rotation":n}, "cornerRadius":n, "topWidth":n, "bottomWidth":n, "startAngle":n, "endAngle":n, ' +
      '"material": string, "role": string, "importance": 1-5}, ...] (rotation and the extra fields after ' +
      'bounds are optional and primitive-specific — omit any that do not apply), ' +
      '"relations": [{"subject":id,"relation":"attached_to"|"extends_from"|"centered_on","object":id}, ...] ' +
      '(optional, omit if nothing needs to connect), ' +
      '"face": [{"x":n,"y":n,"glyph":string}, ...] (optional, omit if not a creature)}',
  ].join('\n\n');
}

function isFaceMark(v: unknown): v is FaceMark {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<FaceMark>;
  return typeof f.x === 'number' && typeof f.y === 'number' && typeof f.glyph === 'string' && FACE_SET.includes(f.glyph);
}

function coerceRegions(v: unknown): RegionSpec[] {
  if (!Array.isArray(v)) return [];
  const out: RegionSpec[] = [];
  const seenIds = new Map<string, number>();
  for (let i = 0; i < v.length; i++) {
    const r = v[i];
    if (!r || typeof r !== 'object') continue;
    const region = r as Record<string, unknown>;
    const bounds = region.bounds as Record<string, unknown> | undefined;
    if (!bounds) continue;
    // id: default to a positional fallback when missing/empty, then
    // de-duplicate repeated ids by suffixing — relation lookups need every
    // id to be unambiguous, without requiring the model to guarantee
    // uniqueness itself (same fail-open posture as the rest of this
    // coercion function).
    const baseId = typeof region.id === 'string' && region.id.trim() ? region.id.trim() : `region_${i}`;
    const seenCount = seenIds.get(baseId) ?? 0;
    const id = seenCount > 0 ? `${baseId}_${seenCount + 1}` : baseId;
    seenIds.set(baseId, seenCount + 1);
    // permissive coercion here — validateRegionPlan (spriteValidate.ts) does
    // the real structural rejection; this just avoids throwing on obviously
    // present-but-loosely-typed model output (e.g. a stringified number).
    const width = Number(bounds.width);
    // circle: CODE keeps width/height equal, never the model — confirmed
    // live necessary, not just a nice-to-have: the model reliably omits or
    // nulls "height" for circle (told to "set width only"), which coerced
    // to 0 and failed validation every time. Force-mirroring here also
    // makes true circularity an actual guarantee, not just a hope — before
    // this, a circle with a model-supplied height!=width would silently
    // render as an ellipse (toLocal scales u/v independently by width and
    // height, so nothing upstream of this was actually enforcing it).
    const height = region.primitive === 'circle' ? width : Number(bounds.height);
    const spec: RegionSpec = {
      id,
      primitive: region.primitive as RegionSpec['primitive'],
      bounds: {
        cx: Number(bounds.cx), cy: Number(bounds.cy),
        width, height,
        ...(bounds.rotation !== undefined ? { rotation: Number(bounds.rotation) } : {}),
      },
      material: String(region.material ?? 'stone'),
      role: (region.role as RegionSpec['role']) ?? 'detail',
      importance: (Number(region.importance) || 3) as RegionSpec['importance'],
    };
    // primitive-specific optional params — only carried through when present
    // and numeric, otherwise left absent so the renderer's own defaults
    // apply (see PrimitiveParams / inPrimitive's ?? fallbacks).
    if (region.cornerRadius !== undefined) spec.cornerRadius = Number(region.cornerRadius);
    if (region.topWidth !== undefined) spec.topWidth = Number(region.topWidth);
    if (region.bottomWidth !== undefined) spec.bottomWidth = Number(region.bottomWidth);
    if (region.startAngle !== undefined) spec.startAngle = Number(region.startAngle);
    if (region.endAngle !== undefined) spec.endAngle = Number(region.endAngle);
    out.push(spec);
  }
  return out;
}

const VALID_RELATIONS: ReadonlySet<SpatialRelation> = new Set(['attached_to', 'extends_from', 'centered_on']);

// Structural coercion only — valid verb, non-empty distinct subject/object.
// Referential integrity (do these ids still exist after budget trimming?)
// is checked later in validateRegionPlan (spriteValidate.ts), not here.
function coerceRelations(v: unknown): ShapeRelation[] {
  if (!Array.isArray(v)) return [];
  const out: ShapeRelation[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const rel = r as Record<string, unknown>;
    const subject = typeof rel.subject === 'string' ? rel.subject.trim() : '';
    const object = typeof rel.object === 'string' ? rel.object.trim() : '';
    const relation = rel.relation as SpatialRelation;
    if (!subject || !object || subject === object) continue;
    if (!VALID_RELATIONS.has(relation)) continue;
    out.push({ subject, relation, object });
  }
  return out;
}

export async function planCraft(
  prompt: string,
  category: string,
  chat: VisionJSON,
  opts: { model?: string; fallbackModel?: string } = {},
): Promise<CraftPlan> {
  const base = CATEGORY_SIZE_DEFAULT[category as CraftCategory] ?? 'medium';
  const empty: CraftPlan = {
    fit: true, sensitive: false, sizeAdjust: 'default', sizeClass: base,
    name: '', width: 0, height: 0, parts: [], regions: [],
  };
  try {
    const r = await chat<Record<string, unknown>>(
      [
        { role: 'system', content: planPrompt() },
        { role: 'user', content: `Token category: ${category}. Request: "${prompt}".` },
      ],
      // 1000 -> 1500 (Stage 2): confirmed live-necessary, not precautionary —
      // the richer per-region schema (bounds gained rotation, some
      // primitives gained cornerRadius/topWidth/bottomWidth/startAngle/
      // endAngle) pushes a genuinely detail-heavy plan (e.g. "acoustic
      // guitar" with 6 individually-authored string regions) over the old
      // budget, truncating mid-JSON and surviving neither attempt of the
      // retry (both truncate the same way) — same failure shape and same
      // fix as the original 700->1000 raise during Phase A. 1300 alone
      // still occasionally clipped the trailing "relations" array on the
      // same worst-case prompt; 1500 gave it comfortable headroom live.
      { model: opts.model, temperature: 0.7, maxTokens: 1500, thinking: { type: 'disabled' }, fallbackModel: opts.fallbackModel },
    );
    const adj = r?.sizeAdjust;
    const sizeClass = adjustSizeTier(base, adj === 'smaller' || adj === 'bigger' ? adj : 'default');
    return {
      fit: r?.fit !== false,
      tokenHint: typeof r?.tokenHint === 'string' && r.tokenHint !== 'none' ? r.tokenHint : undefined,
      sensitive: r?.sensitive === true,
      sizeAdjust: (adj === 'smaller' || adj === 'bigger' ? adj : 'default') as CraftPlan['sizeAdjust'],
      sizeClass,
      name: typeof r?.name === 'string' ? r.name.trim().slice(0, 24) : '',
      width: Number(r?.width) || 0,
      height: Number(r?.height) || 0,
      parts: Array.isArray(r?.parts) ? (r.parts as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 8) : [],
      regions: coerceRegions(r?.regions),
      relations: coerceRelations(r?.relations),
      face: Array.isArray(r?.face) ? (r.face as unknown[]).filter(isFaceMark) : undefined,
    };
  } catch {
    return empty; // fail-open on parse/network failure: caller sees regions:[] and routes into the retry/failure path, never crafts silently
  }
}

// ---------------------------------------------------------------------------
// A small, narrow retry-guidance mapper for a failed plan — the failure
// surface here (validateRegionPlan's errors) is small: canvas-size
// mismatches can't happen any more (Stage 2's normalized bounds have
// nothing to be "out of band"), so only genuinely broken region data or an
// empty plan reach this.
// ---------------------------------------------------------------------------
export function planRetryGuidance(error: string): string {
  if (/no regions/.test(error)) return ' You must include at least one region.';
  if (/structurally invalid region/.test(error))
    return ' Every region needs a valid "primitive" (rectangle|rounded_rectangle|circle|ellipse|triangle|' +
      'trapezoid|diamond|semicircle|arc|line|point|blob), a valid "role" (body|attachment|detail|accent), ' +
      'an integer "importance" 1-5, a valid "material" (a named preset or a #rrggbb hex), numeric ' +
      '"bounds" with cx/cy/width/height all in 0..1, and — for trapezoid/arc — their required extra fields.';
  if (/no regions survived/.test(error)) return ' Provide more than one region so the plan is not empty after trimming.';
  return '';
}

// ---------------------------------------------------------------------------
// Failure suggestions — when a craft fails for a benign reason, Mitchy offers
// three alternatives close to the player's idea. Each option is forced onto a
// DIFFERENT repair strategy (reduce / rearrange / refocus) so they're three
// distinct creative directions of equal quality — not one real fix plus two
// downgraded echoes of it, which is what a naive "give 3 alternatives" prompt
// produces. The caller shuffles the result so no option reads as "first".
//
// Every option has to actually be CRAFTABLE, because clicking one runs the
// full pipeline again (CraftModal's onPickAlt → startCraft) — an option that
// fails a second time is worse than no option at all. Two things enforce
// that: the prompt spells out what this generator can actually draw, and the
// returned options are filtered through the same local content policy the
// craft path uses, so a suggestion can never lead to a refusal. Five are
// requested and three kept, leaving headroom for that filter.
// ---------------------------------------------------------------------------

export interface CraftSuggestions {
  intro: string; // Mitchy's one-liner naming what was too much
  options: string[]; // exactly 3 short alternative craft prompts
}

export async function suggestAlternatives(
  prompt: string,
  category: string,
  failReason: string,
  chat: VisionJSON,
  opts: { model?: string; fallbackModel?: string } = {},
): Promise<CraftSuggestions | null> {
  try {
    const r = await chat<{ intro?: unknown; options?: unknown }>(
      [
        {
          role: 'system',
          content:
            'You are Mitchy, a cozy, witty shopkeeper CAT in Asciia Bay, a cozy ASCII island-village game. A craft attempt ' +
            'just failed and you propose alternatives the player can pick instead. Ground your ' +
            'intro in the TECHNICAL REASON given (e.g. "too tall" means the motif did not fit the ' +
            'sprite size): one playful lowercase line naming what was too much, under 18 words, no ' +
            'emoji. Then exactly 5 options, each 3-8 words, each staying CLOSE to the player\'s idea. ' +
            'The first 3 MUST each use a different repair strategy: ' +
            '(A) REDUCE — keep the subject, shrink the overloaded element (e.g. one hat instead of three); ' +
            '(B) REARRANGE — keep ALL the elements, change the composition so it fits (e.g. hats lined up beside, not stacked); ' +
            '(C) REFOCUS — keep the theme, shift the subject or perspective (e.g. the stack of hats itself as the item). ' +
            'The last 2 are spares in the same spirit. ' +
            'Each must be independently appealing — if any reads like a plain downgrade of another, ' +
            'rewrite it before answering. Do not number or rank them.\n\n' +
            'CRAFTABLE is a hard requirement — each option is drawn as a SMALL ASCII sprite on a ' +
            'character grid, so every one must be: a SINGLE concrete physical object (not a scene, ' +
            'not two things, not a stack); compact in silhouette, roughly as wide as it is tall; ' +
            'recognisable from its outline alone; and family-friendly. Never suggest text, letters, ' +
            'numbers, logos, an abstract concept, an emotion, a place, an action, or anything gory, ' +
            'sexual or weapon-like — none of those can be drawn or would be allowed. ' +
            'Reply with JSON only: {"intro": "...", "options": ["...", "...", "...", "...", "..."]}.',
        },
        {
          role: 'user',
          // A hint, not a constraint — the universal token crafts anything, so
          // this only says what the player seemed to be reaching for.
          content: `The player seemed to want something in the "${category}" vein. They asked for: "${prompt}". Technical failure reason: ${failReason}.`,
        },
      ],
      { model: opts.model, temperature: 0.8, maxTokens: 260, thinking: { type: 'disabled' }, fallbackModel: opts.fallbackModel },
    );
    const intro = typeof r?.intro === 'string' ? r.intro.trim() : '';
    const options = (Array.isArray(r?.options) ? r.options : [])
      .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      .map((o) => o.trim())
      .filter((o) => checkPolicy(o).allowed)
      .filter((o) => o.length <= 60)
      .slice(0, 3);
    if (!intro || options.length < 1) return null;
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { intro, options };
  } catch {
    return null;
  }
}
