// ---------------------------------------------------------------------------
// Validation. Two stages now: validateRegionPlan (the LLM's CraftPlan,
// BEFORE rendering) and validateSpriteCandidate (the rendered output, AFTER
// — a last line of defense, should be near-unreachable by construction since
// the renderer only ever emits ALLOWED_CHARS members and a plan-shaped
// canvas).
// ---------------------------------------------------------------------------

import {
  ALLOWED_CHARS,
  FEATURE_PRIMITIVES,
  MAX_SPRITE_WIDTH,
  RESOLUTION_MULTIPLIER,
  SIZE_BANDS,
  SURFACE_PRIMITIVES,
  type CraftPlan,
  type GeneratedSprite,
  type RasterRegion,
  type RegionBounds,
  type RegionSpec,
  type ShapePrimitive,
  type ShapeRelation,
  type SizeClass,
} from './spriteConfig';
import { resolveMaterial } from './glyphRender';

export interface SpriteCheck {
  ok: boolean;
  error?: string;
}
const fail = (error: string): SpriteCheck => ({ ok: false, error });

// Trim fully-blank leading/trailing ROWS only (not columns — see below).
// Necessary now in a way it wasn't for the old LLM-drawn-lines path:
// rendered regions (especially ellipse/blob shapes, or a plan whose bounds
// got rounded during normalization) routinely don't touch row 0 / the last
// row exactly — that's normal geometry, not the model "forgetting to crop
// padding" the way it was for hand-drawn ASCII. Cropping here — rather than
// failing validation's first/last-row-empty check and burning the one retry
// on a perfectly good plan — is the right fix; confirmed necessary against
// live output (Phase B end-to-end pass: this exact failure hit ~5/6 prompts
// before this crop was added).
//
// Deliberately NOT also cropping blank columns: an earlier version of this
// function did, and it introduced a NEW live regression — cropping columns
// can shrink the canvas below its size band's minimum WIDTH (which
// normalizePlan already deliberately chose to satisfy), turning a
// perfectly good plan into a fresh "too narrow" failure. There is no
// equivalent "first/last column must have ink" check to satisfy (unlike
// rows), so column-cropping was solving a problem that didn't exist.
export function cropBlankEdges(lines: string[], colors: string[]): { lines: string[]; colors: string[] } {
  if (lines.length === 0) return { lines, colors };
  const isBlankRow = (l: string) => l.trim() === '';
  let top = 0;
  let bottom = lines.length - 1;
  while (top < lines.length && isBlankRow(lines[top])) top++;
  while (bottom >= top && isBlankRow(lines[bottom])) bottom--;
  if (top > bottom) return { lines: [], colors: [] }; // fully blank
  return { lines: lines.slice(top, bottom + 1), colors: colors.slice(top, bottom + 1) };
}

// Pad every line to the max width so the sprite is a clean rectangle.
export function padLines(lines: string[]): string[] {
  const w = Math.max(0, ...lines.map((l) => l.length));
  return lines.map((l) => l.padEnd(w, ' '));
}

// Normalise the optional colour grid to the sprite's FINAL dimensions and drop
// anything that doesn't line up, so bad colour data degrades to a mono sprite
// instead of failing the craft. Mutates g in place. Never throws.
export function sanitizeColors(g: GeneratedSprite): void {
  const drop = () => {
    delete g.colors;
    delete g.palette;
  };
  const palette = g.palette;
  const colors = g.colors;
  if (!palette || !colors || Object.keys(palette).length === 0) return drop();

  const h = g.lines.length;
  const w = Math.max(0, ...g.lines.map((l) => l.length));
  const used = new Set<string>();
  const grid: string[] = [];
  for (let y = 0; y < h; y++) {
    const spriteRow = g.lines[y];
    const colorRow = colors[y] ?? '';
    let row = '';
    for (let x = 0; x < w; x++) {
      const key = colorRow[x];
      if (spriteRow[x] && spriteRow[x] !== ' ' && key && palette[key]) {
        row += key;
        used.add(key);
      } else {
        row += '.';
      }
    }
    grid.push(row);
  }
  if (used.size === 0) return drop();

  g.colors = grid;
  g.palette = Object.fromEntries(Object.entries(palette).filter(([k]) => used.has(k)));
}

// `resolutionMultiplier` scales the SIZE_BANDS/MAX_SPRITE_WIDTH bounds used
// for the width/height checks only — the sprite was rendered at a bigger
// glyph grid than its on-screen footprint on purpose (see spriteConfig.ts's
// RESOLUTION_MULTIPLIER), so its raw cell dimensions are EXPECTED to exceed
// the nominal band by that factor. The ink-ratio and alignment checks below
// are already scale-invariant (percentage/per-glyph), so they need no
// adjustment.
export function validateSpriteCandidate(g: GeneratedSprite, resolutionMultiplier = 1): SpriteCheck {
  const lines = g.lines;
  if (!lines || lines.length === 0) return fail('empty');
  if (lines[0].trim() === '') return fail('first line is empty');
  if (lines[lines.length - 1].trim() === '') return fail('last line is empty');

  const width = Math.max(0, ...lines.map((l) => l.length));
  const band = SIZE_BANDS[g.sizeClass];
  const minW = SIZE_BANDS.small.minW * resolutionMultiplier;
  const bandMinW = band.minW * resolutionMultiplier;
  const maxW = Math.min(band.maxW, MAX_SPRITE_WIDTH) * resolutionMultiplier;
  const maxH = band.maxH * resolutionMultiplier;
  if (width < minW) return fail(`too narrow (${width} < ${minW})`);
  if (width < bandMinW) return fail(`width ${width} below ${g.sizeClass} minimum ${bandMinW}`);
  if (width > maxW) return fail(`width ${width} over ${g.sizeClass} maximum ${maxW}`);
  if (lines.length > maxH) return fail(`too tall (${lines.length} > ${maxH})`);

  for (const line of lines) {
    for (const ch of line) {
      if (!ALLOWED_CHARS.has(ch)) return fail(`illegal character "${ch}"`);
    }
  }

  const ink = lines.reduce((n, l) => n + [...l].filter((c) => c !== ' ').length, 0);
  const cells = Math.max(1, width * lines.length);
  if (ink / cells < 0.25) return fail(`too sparse (${Math.round((ink / cells) * 100)}% < 25%)`);

  return checkAlignment(lines);
}

// ---------------------------------------------------------------------------
// ALIGNMENT CHECK — static Unicode-codepoint classification, NOT pixel
// measurement (font-dependent, varies per machine). Kept as defense-in-depth
// over the rendered output — should be unreachable by construction since the
// renderer only ever emits ALLOWED_CHARS members, but free to keep running.
// ---------------------------------------------------------------------------

const WIDE_BLOCKS: { lo: number; hi: number; label: string }[] = [
  { lo: 0x3000, hi: 0x303f, label: 'CJK Symbols and Punctuation' },
  { lo: 0x3040, hi: 0x309f, label: 'Hiragana' },
  { lo: 0x30a0, hi: 0x30ff, label: 'Katakana' },
  { lo: 0x4e00, hi: 0x9fff, label: 'CJK Unified Ideographs' },
  { lo: 0xac00, hi: 0xd7a3, label: 'Hangul Syllables' },
  { lo: 0xff00, hi: 0xffef, label: 'Halfwidth and Fullwidth Forms' },
];

export function checkChar(ch: string): SpriteCheck {
  const cp = ch.codePointAt(0)!;
  if (cp <= 0x7e) return { ok: true };
  if (ALLOWED_CHARS.has(ch)) return { ok: true };
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  const wide = WIDE_BLOCKS.find((b) => cp >= b.lo && cp <= b.hi);
  return fail(
    wide
      ? `"${ch}" (${hex}) is a ${wide.label} character — not guaranteed single-width in a monospace font`
      : `"${ch}" (${hex}) is not a known single-width character`,
  );
}

export function checkAlignment(lines: string[]): SpriteCheck {
  for (const line of lines) {
    for (const ch of line) {
      const c = checkChar(ch);
      if (!c.ok) return c;
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// REGION PLAN VALIDATION — runs on the LLM's raw CraftPlan, before render.
//
// Two distinct failure handling philosophies, deliberately different:
//   - Canvas size out of band, or a region's bounds not perfectly matching
//     the canvas: NOT a hard failure. A deterministic NORMALIZATION pass
//     (normalizePlan below) rescales the canvas into its band and
//     proportionally transforms every region's bounds along with it — an
//     otherwise semantically-good plan is never thrown away just because the
//     model's stated width/height missed the band. Phase A found this
//     happens often; the LLM's spatial/semantic reasoning was still good.
//   - Structurally invalid input (bad primitive name, unresolvable material,
//     a region with no usable overlap with the canvas at all, too few
//     regions): a real hard failure, worth one retry with the concrete error
//     fed back to the model.
//   - Too MANY regions is also not a hard failure: importance-based trimming
//     (applyBudgets below) keeps the highest-importance regions per budget
//     and drops the rest, logged as a warning.
// ---------------------------------------------------------------------------

export type PlanCheck = { ok: true; plan: CraftPlan; warnings: string[] } | { ok: false; error: string };

const MAJOR_CAP = 8;
const DETAIL_CAP = 12;
const VALID_PRIMITIVES = new Set([...SURFACE_PRIMITIVES, ...FEATURE_PRIMITIVES]);
const VALID_ROLES = new Set(['body', 'attachment', 'detail', 'accent']);
const HEX_RE = /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i;

function isValidMaterialSpec(spec: unknown): spec is string {
  if (typeof spec !== 'string') return false;
  return spec in { wood: 1, metal: 1, gold: 1, cloth: 1, leaf: 1, stone: 1, glass: 1, water: 1, fire: 1, bone: 1, leather: 1, skin: 1 } || HEX_RE.test(spec);
}

// A few primitives take optional extra fields — validated here IF present
// (all have safe defaults at render time, see glyphRender.ts's inPrimitive,
// so absence is never a failure, only a present-but-broken value is).
const PRIMITIVE_VALIDATORS: Partial<Record<ShapePrimitive, (r: RegionSpec) => boolean>> = {
  rounded_rectangle: (r) => r.cornerRadius === undefined || Number.isFinite(r.cornerRadius),
  trapezoid: (r) =>
    (r.topWidth === undefined || Number.isFinite(r.topWidth)) &&
    (r.bottomWidth === undefined || Number.isFinite(r.bottomWidth)),
  arc: (r) =>
    (r.startAngle === undefined || Number.isFinite(r.startAngle)) &&
    (r.endAngle === undefined || Number.isFinite(r.endAngle)),
};

function isStructurallyValidRegion(r: unknown): r is RegionSpec {
  if (!r || typeof r !== 'object') return false;
  const region = r as Partial<RegionSpec>;
  if (typeof region.primitive !== 'string' || !VALID_PRIMITIVES.has(region.primitive)) return false;
  if (typeof region.role !== 'string' || !VALID_ROLES.has(region.role)) return false;
  if (!Number.isInteger(region.importance) || (region.importance as number) < 1 || (region.importance as number) > 5) return false;
  if (!isValidMaterialSpec(region.material)) return false;
  const b = region.bounds;
  if (!b || typeof b !== 'object') return false;
  const { cx, cy, width, height, rotation } = b;
  if (![cx, cy, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  if (width <= 0 || height <= 0) return false;
  if (rotation !== undefined && !Number.isFinite(rotation)) return false;
  const extra = PRIMITIVE_VALIDATORS[region.primitive as ShapePrimitive];
  if (extra && !extra(region as RegionSpec)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// CANVAS SIZE — a pure code decision (Stage 2). Region bounds are already
// normalized/resolution-independent (see spriteConfig.ts's NormBounds), so
// there is nothing left to rescale a canvas INTO — this picks the actual
// glyph-cell canvas from sizeClass + RESOLUTION_MULTIPLIER directly,
// treating the plan's width/height purely as an aspect-ratio hint. Replaces
// the old normalizePlan (rescale) AND scalePlanCanvas (resolution upscale)
// — both are gone, not layered under a third function.
// ---------------------------------------------------------------------------

export function resolveCanvasSize(sizeClass: SizeClass, hintWidth: number, hintHeight: number): { width: number; height: number } {
  const band = SIZE_BANDS[sizeClass];
  const maxW = Math.min(band.maxW, MAX_SPRITE_WIDTH) * RESOLUTION_MULTIPLIER;
  const minW = band.minW * RESOLUTION_MULTIPLIER;
  const maxH = band.maxH * RESOLUTION_MULTIPLIER;
  const ratio = hintWidth > 0 && hintHeight > 0 ? hintWidth / hintHeight : 1;

  // Fit the hinted aspect ratio into [minW,maxW] x [1,maxH]: start from the
  // largest width (maxW) and derive height; if that height overflows maxH,
  // derive width from maxH instead; if THAT width undershoots minW, re-grow
  // to minW (a genuine floor/ceiling conflict — width wins and aspect is no
  // longer preserved, same "width is the hard floor" framing
  // validateSpriteCandidate already uses). Note every SIZE_BANDS tier has
  // minW > maxH once RESOLUTION_MULTIPLIER is applied, so a literal 1:1
  // hint can never yield a perfectly square canvas — that's the band
  // table's own shape, not a bug here.
  let width = maxW;
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  if (width < minW) {
    width = minW;
    height = Math.min(maxH, width / ratio);
  }
  width = Math.round(Math.max(minW, Math.min(maxW, width)));
  height = Math.round(Math.max(1, Math.min(maxH, height)));
  return { width, height };
}

// The ONE place normalized (0..1, centre-based) plan bounds become concrete
// integer cells — see spriteConfig.ts's NormBounds/RasterRegion doc
// comments. Runs after validateRegionPlan (structural checks + budget trim)
// once resolveCanvasSize has picked a concrete canvas.
export function resolveRegions(regions: RegionSpec[], canvasW: number, canvasH: number): RasterRegion[] {
  return regions.map((r) => {
    const width = Math.max(1, Math.round(r.bounds.width * canvasW));
    const height = Math.max(1, Math.round(r.bounds.height * canvasH));
    const x = Math.round(r.bounds.cx * canvasW - width / 2);
    const y = Math.round(r.bounds.cy * canvasH - height / 2);
    const raster: RasterRegion = {
      id: r.id,
      primitive: r.primitive,
      bounds: { x, y, width, height },
      material: r.material,
      role: r.role,
      importance: r.importance,
    };
    if (r.bounds.rotation !== undefined) raster.rotation = r.bounds.rotation;
    if (r.cornerRadius !== undefined) raster.cornerRadius = r.cornerRadius;
    if (r.topWidth !== undefined) raster.topWidth = r.topWidth;
    if (r.bottomWidth !== undefined) raster.bottomWidth = r.bottomWidth;
    if (r.startAngle !== undefined) raster.startAngle = r.startAngle;
    if (r.endAngle !== undefined) raster.endAngle = r.endAngle;
    return raster;
  });
}

// Importance-based trim: split into major (body/attachment) vs detail
// (detail/accent), keep the top-N of each by importance, but PRESERVE the
// original array order among the kept regions — paint order is semantically
// meaningful (a deliberately-layered highlight painted last), and re-sorting
// by importance would silently break intentional layering.
function applyBudgets(regions: RegionSpec[]): { regions: RegionSpec[]; warnings: string[] } {
  const warnings: string[] = [];
  const indexed = regions.map((r, i) => ({ r, i }));
  const major = indexed.filter((e) => e.r.role === 'body' || e.r.role === 'attachment');
  const detail = indexed.filter((e) => e.r.role === 'detail' || e.r.role === 'accent');

  function trim(group: typeof indexed, cap: number, label: string) {
    if (group.length <= cap) return group;
    const kept = [...group].sort((a, b) => b.r.importance - a.r.importance).slice(0, cap);
    warnings.push(`dropped ${group.length - cap} low-importance ${label} region(s) over the ${cap} cap`);
    const keptIdx = new Set(kept.map((e) => e.i));
    return group.filter((e) => keptIdx.has(e.i));
  }

  const keptMajor = trim(major, MAJOR_CAP, 'major');
  const keptDetail = trim(detail, DETAIL_CAP, 'detail');
  const kept = [...keptMajor, ...keptDetail].sort((a, b) => a.i - b.i); // restore paint order
  return { regions: kept.map((e) => e.r), warnings };
}

// ---------------------------------------------------------------------------
// RELATION ADJUSTMENT — a small, capped AABB gap-closer, not a constraint
// solver. Fixes the specific drift rounding during resolveRegions can
// introduce (a region that should touch another ends up a cell or two short
// after rounding); it does not relocate a region the model planned far from
// its stated relation partner — see MAX_NUDGE_CELLS below. Operates on
// concrete cell-based RasterRegion (post resolveRegions), called from
// spritePipeline.ts once a canvas size is known — MAX_NUDGE_CELLS stays a
// plain integer cell count, unchanged from before Stage 2.
// ---------------------------------------------------------------------------

const MAX_NUDGE_CELLS = 3;

function clampBounds(b: RegionBounds, canvasW: number, canvasH: number): RegionBounds {
  const width = Math.min(b.width, canvasW);
  const height = Math.min(b.height, canvasH);
  const x = Math.max(0, Math.min(b.x, canvasW - width));
  const y = Math.max(0, Math.min(b.y, canvasH - height));
  return { x, y, width, height };
}

// Signed gap needed on each axis to bring `a` to touch `b` (0 if the axis
// ranges already overlap). Positive dx/dy means "a" must move right/down.
function axisGap(aLo: number, aHi: number, bLo: number, bHi: number): number {
  if (aHi <= bLo) return bLo - aHi;
  if (aLo >= bHi) return -(aLo - bHi);
  return 0;
}

export function applyRelationAdjustments(
  regions: RasterRegion[],
  relations: ShapeRelation[],
  canvasW: number,
  canvasH: number,
): { regions: RasterRegion[]; warnings: string[] } {
  const warnings: string[] = [];
  if (relations.length === 0) return { regions, warnings };

  const byId = new Map(regions.map((r) => [r.id, r]));
  const out = [...regions];
  function replace(id: string, bounds: RegionBounds) {
    const idx = out.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const updated = { ...out[idx], bounds };
    out[idx] = updated;
    byId.set(id, updated);
  }

  for (const rel of relations) {
    const subject = byId.get(rel.subject);
    const object = byId.get(rel.object);
    if (!subject || !object) continue; // referential filtering already ran before this is called

    const sb = subject.bounds;
    const ob = object.bounds;
    let dx: number;
    let dy: number;
    if (rel.relation === 'centered_on') {
      const targetX = ob.x + ob.width / 2 - sb.width / 2;
      const targetY = ob.y + ob.height / 2 - sb.height / 2;
      dx = Math.round(targetX - sb.x);
      dy = Math.round(targetY - sb.y);
    } else {
      dx = axisGap(sb.x, sb.x + sb.width, ob.x, ob.x + ob.width);
      dy = axisGap(sb.y, sb.y + sb.height, ob.y, ob.y + ob.height);
    }

    if (dx === 0 && dy === 0) continue; // already touching/overlapping (or already centered)

    if (Math.abs(dx) > MAX_NUDGE_CELLS || Math.abs(dy) > MAX_NUDGE_CELLS) {
      warnings.push(
        `skipped '${rel.subject}' ${rel.relation} '${rel.object}': gap ${Math.max(Math.abs(dx), Math.abs(dy))} exceeds cap ${MAX_NUDGE_CELLS}`,
      );
      continue;
    }

    const nudged = clampBounds({ x: sb.x + dx, y: sb.y + dy, width: sb.width, height: sb.height }, canvasW, canvasH);
    replace(rel.subject, nudged);
    warnings.push(`nudged '${rel.subject}' to touch '${rel.object}' (${rel.relation})`);
  }

  return { regions: out, warnings };
}

// `plan` here is validated + budget-trimmed but still NORMALIZED (0..1,
// centre-based) — coordinate resolution (resolveCanvasSize/resolveRegions)
// and relation nudging happen afterward in spritePipeline.ts, once a
// concrete canvas size is known. See spriteConfig.ts's NormBounds/
// RasterRegion doc comments for why the split exists.
export function validateRegionPlan(plan: CraftPlan): PlanCheck {
  if (!Array.isArray(plan.regions) || plan.regions.length === 0) return { ok: false, error: 'no regions in plan' };
  for (const r of plan.regions) {
    if (!isStructurallyValidRegion(r)) {
      return { ok: false, error: `structurally invalid region: ${JSON.stringify(r).slice(0, 120)}` };
    }
  }
  // defense-in-depth: resolveMaterial never throws, but confirm it resolves
  // to *something* real (it always does — this just documents the contract).
  for (const r of plan.regions) resolveMaterial(r.material);

  const { regions: trimmedRegions, warnings: budgetWarnings } = applyBudgets(plan.regions);
  if (trimmedRegions.length === 0) return { ok: false, error: 'no regions survived budget trimming' };

  // Referential integrity: drop any relation whose subject/object id didn't
  // survive budget trimming (or never existed) before acting on the rest.
  const keptIds = new Set(trimmedRegions.map((r) => r.id));
  const allRelations = plan.relations ?? [];
  const liveRelations = allRelations.filter((rel) => keptIds.has(rel.subject) && keptIds.has(rel.object));
  const relationWarnings: string[] = [];
  if (liveRelations.length < allRelations.length) {
    relationWarnings.push(`dropped ${allRelations.length - liveRelations.length} relation(s) referencing a trimmed/unknown region`);
  }

  return {
    ok: true,
    plan: { ...plan, regions: trimmedRegions, relations: liveRelations },
    warnings: [...budgetWarnings, ...relationWarnings],
  };
}
