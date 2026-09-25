// ---------------------------------------------------------------------------
// Sprite generation config: size classes, allowed character sets, the
// CraftPlan/RegionSpec schema, and shared types. Pure data — imported by the
// planner (spriteGen.ts), the renderer (glyphRender.ts), and the validator
// (spriteValidate.ts).
// ---------------------------------------------------------------------------

export type SizeClass = 'small' | 'medium' | 'large';

// Build ceiling — the widest a generated sprite may be. Anchored to the world:
// the SHOP (22×8) is the widest hand-made sprite, so nothing generated may
// exceed it. (An earlier version allowed 30 and a 12-wide FLOOR — designed in
// a vacuum, which made a "medium" duck at 16-25 wide render BIGGER than the
// 17-wide house.)
export const MAX_SPRITE_WIDTH = 22;

// Disjoint size bands (no overlaps). Widths in characters, heights in lines.
// ANCHORED TO THE HAND-MADE WORLD so real-life proportion falls out naturally
// (on-screen char width = authored sprite width × its world.ts Ent scale, not
// the authored width alone — measured directly from the live baked assets,
// see docs/ArtStyleGuide.md §1 "Unified size tiers" for the full table):
//   PLAYER ~7×4, CAT (shopkeeper, scale 1) ~10×4, DATE_FRUIT (scale 1) ~7×7,
//   PALM (scale 1) ~31×23, SHOP (scale 1) ~29×17, HOUSE (scale 0.35) ~21×15.
//   duck < player < cow < tree/house — by construction.
export const SIZE_BANDS: Record<SizeClass, { minW: number; maxW: number; maxH: number }> = {
  small: { minW: 5, maxW: 8, maxH: 4 }, // below-human scale: most pets, items, food, tools (the cat is 7×3)
  medium: { minW: 9, maxW: 14, maxH: 6 }, // human-ish scale: people, big animals (pony/cow), furniture
  large: { minW: 15, maxW: 22, maxH: 9 }, // above-human: trees, vehicles, buildings (house 17×8, shop 22×8)
};

// SIZE_BANDS above governs the ON-SCREEN footprint (the LLM plans and
// validation checks against these bounds directly). The RENDERED glyph grid
// is bigger than that footprint by this factor — more cells for the local
// texture/edge work in glyphRender.ts to have something to work with — and
// the item's displayed CSS scale is shrunk by the same factor afterward
// (see spritePipeline.ts's GeneratedSprite.resolutionScale and llm.ts's
// `item.scale = sprite.resolutionScale`), so the two are decoupled: a
// higher-detail render never makes the item look physically bigger in the
// world. Analogous to GARDEN_BED_SCALE elsewhere in this codebase.
export const RESOLUTION_MULTIPLIER = 2;

// How to pick a size class from the object's REAL-LIFE scale, with the world's
// own sprites as concrete anchors. Text for the prompt (used by the planner).
// Default size tier per craft category — a strong prior so the planner isn't
// reasoning about real-world scale from nothing every time. The model can
// still override it (a size adjective like "giant" or "tiny" in the player's
// own prompt should win, and SIZE_GUIDELINE below still applies), but most
// requests won't say one, and a per-category default removes a whole axis of
// misclassification risk. Ties into the same small/medium/large tier table
// documented in docs/ArtStyleGuide.md §1 "Unified size tiers".
//
// Local literal union, deliberately NOT importing `Category`/`CATEGORIES`
// from '../llm' — llm.ts imports from this module's barrel (./craft), so
// importing back from llm.ts here would be circular. Keep this list in sync
// with CATEGORIES in llm.ts by hand if it ever changes (six category names,
// rarely touched).
export type CraftCategory = 'plant' | 'pets' | 'clothing' | 'vehicle' | 'food' | 'utensils';
export const CATEGORY_SIZE_DEFAULT: Record<CraftCategory, SizeClass> = {
  plant: 'small',
  pets: 'small',
  food: 'small',
  utensils: 'small',
  clothing: 'small',
  vehicle: 'medium',
};

// Ordered small→large so a relative nudge can move one step either way and
// clamp at the ends. See adjustSizeTier below — asking the planner for a
// RELATIVE nudge off the category default, instead of an absolute
// small/medium/large pick from scratch, sidesteps its own strong real-world
// size priors (e.g. "a car" reads as a big real-world object to the model
// even when told directly "a car -> medium", and it kept picking "large"
// anyway when asked to classify from scratch — confirmed live against
// google/gemini-2.5-flash-lite). A relative "bigger/smaller/default than
// this category's usual" judgment is a much easier, more constrained task
// than absolute classification, and was reliable where the absolute prompt
// wasn't.
const SIZE_TIER_ORDER: SizeClass[] = ['small', 'medium', 'large'];
export function adjustSizeTier(base: SizeClass, dir: 'smaller' | 'default' | 'bigger'): SizeClass {
  if (dir === 'default') return base;
  const i = SIZE_TIER_ORDER.indexOf(base) + (dir === 'bigger' ? 1 : -1);
  return SIZE_TIER_ORDER[Math.max(0, Math.min(SIZE_TIER_ORDER.length - 1, i))];
}

export const SIZE_GUIDELINE =
  'Judge the item\'s REAL-LIFE size relative to a person. For scale: the player (a human) is drawn ' +
  '7 characters wide and 4 lines tall; the shopkeeper cat is 10x4; the whole house is about 21x15. ' +
  'Clearly smaller than a person (most pets - ducks, cats, dogs - plus items, fruits, tools, small flora) -> small; ' +
  'person-sized (people, large animals like a pony or cow, furniture, and most vehicles you\'d ride - a ' +
  'car, a wagon, a small boat) -> medium; ' +
  'clearly larger than a person (trees, buildings, and vehicles bigger than a car - a bus, a ship) -> ' +
  'large. When unsure, choose smaller.';

// FACE SET — the cute dot-face glyphs (kaomoji), restricted to a hand-picked
// list of codepoints we can vouch for: `·` (U+00B7 middle dot, Latin-1),
// `ω` (U+03C9 Greek small omega), `°` (U+00B0 degree sign, Latin-1), plus
// ASCII `_`. These are common codepoints present (and single-width) in
// essentially every monospace font a mainstream OS ships. checkAlignment in
// spriteValidate.ts enforces this STATICALLY by codepoint — no font
// measurement — so this list IS the complete set of non-ASCII glyphs a face
// override may use. Add a glyph only after hand-verifying it renders
// single-width broadly. (Dropped: `˘` U+02D8 and `ᵔ` U+1D54 — obscure blocks
// with no reliable monospace guarantee.)
export const FACE_SET = ['·', 'ω', '°', '_'];

// BODY / STRUCTURE SET — plain-ASCII glyphs (plus space). Deliberately
// includes the letters o, O and v; no other letters and no digits.
const BODY_SET = "@#*oO.,'\"`~-_=+|/\\()<>^v;:!%& ".split('');

// glyphify.py's RAMP_DEFAULT family (†·¤‡¬§Ø etc.) — this project's OTHER
// hand-baked assets (house, cliffs) already use exactly this glyph family
// live, so merging it into ALLOWED_CHARS is consolidation, not new risk. The
// local renderer (glyphRender.ts) is the only thing that emits these; kept
// here (not a separate allowed-set) so ALLOWED_CHARS stays one source of
// truth for every validity check in this module.
const RAMP_DEFAULT_LOCAL = ' ·:¬=+†‡*¤§%&¥Ø@';
const RAMP_SET = [...RAMP_DEFAULT_LOCAL].filter((c) => c !== ' ' && c !== '·'); // '·' already in FACE_SET

// The full allowed character set (body + faces + ramp + space).
export const ALLOWED_CHARS = new Set<string>([...BODY_SET, ...FACE_SET, ...RAMP_SET]);

// ---------------------------------------------------------------------------
// CraftPlan / RegionSpec — the LLM's output shape. The LLM decides WHERE
// visual features go and WHAT they represent geometrically; it never picks a
// literal glyph or reasons about luminance/density. See glyphRender.ts for
// the deterministic renderer that turns this into glyphs.
// ---------------------------------------------------------------------------

export type MaterialName =
  | 'wood' | 'metal' | 'gold' | 'cloth' | 'leaf' | 'stone'
  | 'glass' | 'water' | 'fire' | 'bone' | 'leather' | 'skin';

// Filled/volume shapes -> SURFACE glyph mode (luminance ramp + banded
// shading). Sparse/mark shapes -> FEATURE glyph mode (geometry-matched flat
// glyph, no ramp). See glyphRender.ts's renderRegions for the actual split.
// 12 genuinely mathematical/parametric primitives (Stage 2) — every one is a
// real inequality test in glyphRender.ts's shared local-space frame
// (toLocal), not a renamed bounding box. Same vocabulary for base AND
// detail regions.
export type ShapePrimitive =
  | 'rectangle' | 'rounded_rectangle' | 'circle' | 'ellipse' | 'triangle'
  | 'trapezoid' | 'diamond' | 'semicircle' | 'arc' | 'line' | 'point' | 'blob';
export const SURFACE_PRIMITIVES: ReadonlySet<ShapePrimitive> = new Set([
  'rectangle', 'rounded_rectangle', 'circle', 'ellipse', 'triangle',
  'trapezoid', 'diamond', 'semicircle', 'blob',
]);
export const FEATURE_PRIMITIVES: ReadonlySet<ShapePrimitive> = new Set(['line', 'point', 'arc']);

// A budget/compression hint, NOT a rendering-mode switch (mode is decided by
// primitive, above). body/attachment compete for the "major" region cap;
// detail/accent compete for a separate "detail" cap, so small accents (e.g.
// magical sparkles) never get starved out by major anatomy — see
// spriteValidate.ts's validateRegionPlan.
export type RegionRole = 'body' | 'attachment' | 'detail' | 'accent';

// Renderer-facing bounds: concrete integer-ish cells, top-left origin —
// glyphRender.ts's grid/CellPaint machinery works in this space, unchanged
// since before Stage 2. Never produced directly by the LLM any more (see
// NormBounds) — only by spriteValidate.ts's resolveRegions.
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Plan-facing bounds: normalized 0..1, CENTRE-based (not top-left — centres
// compose more naturally under rotation, and under CSG/repeat in later
// stages). Resolution/canvas-size independent by construction: the LLM
// never sees or reasons about a concrete cell canvas at all, only fractions
// of "the eventual canvas, whatever size code picks."
export interface NormBounds {
  cx: number;
  cy: number;
  width: number; // 0..1, fraction of the eventual canvas width
  height: number; // 0..1, fraction of the eventual canvas height
  rotation?: number; // degrees, default 0 — meaningful for every primitive except circle/point
}

// Extra fields only some primitives need — shared between RegionSpec
// (plan-level) and RasterRegion (renderer-level) since these values never
// change shape across the normalize -> raster conversion, only bounds do.
export interface PrimitiveParams {
  cornerRadius?: number; // rounded_rectangle only: 0..0.5, fraction of min(width,height)/2
  topWidth?: number; // trapezoid only: 0..1, fraction of width
  bottomWidth?: number; // trapezoid only: 0..1, fraction of width
  startAngle?: number; // arc only: degrees, 0 = east, counter-clockwise
  endAngle?: number; // arc only: degrees, 0 = east, counter-clockwise
}

export interface RegionSpec extends PrimitiveParams {
  id: string; // stable short id ("body", "flame_core") — relations reference this, never shown to the player
  primitive: ShapePrimitive;
  bounds: NormBounds; // normalized 0..1, centre-based — see NormBounds
  material: MaterialName | string; // named preset OR literal #rrggbb
  role: RegionRole;
  importance: 1 | 2 | 3 | 4 | 5; // 5 = defining feature, 1 = minor accent
}

// The renderer-facing counterpart of RegionSpec, produced by
// spriteValidate.ts's resolveRegions once a concrete canvas size is known.
// Same shape glyphRender.ts always worked with, plus rotation carried
// through unchanged from the plan.
export interface RasterRegion extends PrimitiveParams {
  id: string;
  primitive: ShapePrimitive;
  bounds: RegionBounds; // concrete cells, top-left origin
  rotation?: number; // degrees, default 0 — carried through from NormBounds.rotation
  material: MaterialName | string;
  role: RegionRole;
  importance: 1 | 2 | 3 | 4 | 5;
}

// Deliberately only the 3 verbs applyRelationAdjustments (spriteValidate.ts)
// actually acts on — no descriptive-only verbs the model could emit for
// free with no effect. Extend this (and applyRelationAdjustments) together
// if a real need for e.g. "inside"/"above" shows up later.
export type SpatialRelation = 'attached_to' | 'extends_from' | 'centered_on';

export interface ShapeRelation {
  subject: string; // region id
  relation: SpatialRelation;
  object: string; // region id
}

export interface FaceMark {
  x: number;
  y: number;
  glyph: string; // must be a member of FACE_SET
}

export interface CraftPlan {
  fit: boolean;
  tokenHint?: string;
  sensitive: boolean;
  sizeAdjust: 'smaller' | 'default' | 'bigger';
  sizeClass: SizeClass; // derived via adjustSizeTier, same convention as before
  name: string;
  // ASPECT-RATIO HINT only (Stage 2) — any two positive numbers, e.g. 3/1
  // for a long thin snake. NOT a literal cell-count target any more:
  // spriteValidate.ts's resolveCanvasSize picks the actual cell canvas from
  // sizeClass + RESOLUTION_MULTIPLIER, using this ratio as a hint.
  width: number;
  height: number;
  parts: string[];
  regions: RegionSpec[]; // paint order = array order, later overwrites earlier
  relations?: ShapeRelation[]; // optional attached_to/extends_from/centered_on links between region ids
  face?: FaceMark[];
}

// The final assembled record: CraftPlan's descriptive fields + the rendered
// glyph output. What the log records and what llm.ts builds an item from.
export interface GeneratedSprite {
  name: string;
  sizeClass: SizeClass;
  parts: string[];
  lines: string[];
  palette?: Record<string, string>;
  colors?: string[];
  // CSS scale to display the item at, compensating for RESOLUTION_MULTIPLIER
  // so a higher-detail render occupies the same on-screen footprint as the
  // sizeClass band implies. 1/RESOLUTION_MULTIPLIER when rendered at the
  // boosted resolution; absent/1 for a sprite rendered at nominal size.
  resolutionScale?: number;
}

// One failed generation attempt on the way to a failure.
export interface CraftAttempt {
  level: 0 | 1;
  error: string;
}

// One structured log record per generation (see llm.ts craftLog).
export interface CraftLog {
  prompt: string;
  category: string;
  sizeClass: SizeClass;
  parts: string[];
  retried: boolean;
  // 0 = first plan, 1 = retried plan, 2 = both attempts failed — no sprite
  // was produced (the player sees an error message; there is deliberately no
  // template stand-in).
  fallbackLevel: 0 | 1 | 2;
  durationMs: number;
  // Present only when a plan needed budget trimming, a relation nudge fired
  // (or was skipped for exceeding its cap), or attempts failed on the way
  // here — each entry says why, so a log line is self-explanatory without a
  // debugging session.
  warnings?: string[];
  attempts?: CraftAttempt[];
}
