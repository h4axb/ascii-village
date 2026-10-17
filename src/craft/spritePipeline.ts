// ---------------------------------------------------------------------------
// The crafting pipeline, post-plan: validate (with deterministic size/bounds
// normalization, see spriteValidate.ts) → one retry of the PLAN if it's
// structurally broken → render (local, deterministic, no LLM) → validate the
// rendered output as a last line of defense.
//
//   level 0: the plan as first returned
//   level 1: one retry, seeded with the concrete validation error
//   both failed → sprite: null + an error the UI shows to the player
//                 (no hand-made template stand-in, no silent substitution)
//   neverFail (the /1 link): instead of failing, rescue — the AI's plans
//                 with only their broken shapes dropped and a lenient
//                 render check, else a built-in shape template by category
//
// Rendering is local and synchronous, so there is no "image vs text-only"
// strategy any more and nothing to retry concurrently — this file is much
// smaller than its predecessor. Generated sprites are NOT persisted/reused —
// every craft generates fresh.
// ---------------------------------------------------------------------------

import {
  RESOLUTION_MULTIPLIER,
  type CraftAttempt,
  type CraftLog,
  type CraftPlan,
  type GeneratedSprite,
} from './spriteConfig';
import { planCraft, planRetryGuidance, type VisionJSON } from './spriteGen';
import { renderRegions } from './glyphRender';
import { applyColorPref, transformPalette, type PaletteShift, type PrefValue } from './prefs';
import type { BandGlyphs } from './moods';
import type { SizeClass } from './spriteConfig';
import {
  applyRelationAdjustments,
  cropBlankEdges,
  padLines,
  resolveCanvasSize,
  resolveRegions,
  sanitizeColors,
  isStructurallyValidRegion,
  validateRegionPlan,
  validateSpriteCandidate,
} from './spriteValidate';
import type { RegionSpec } from './spriteConfig';

export interface PlanAndRenderDeps {
  chat: VisionJSON;
  model?: string;
  fallbackModel?: string;
  // false: no automatic re-plan after a failed first plan (the /3 test link)
  retry?: boolean;
  // the player's crafting preferences (craft/prefs.ts, the /2 link):
  // multiplier = glyph density (render resolution), color = palette shift,
  // prefsText/temperature = the planner settings, reused by the re-plan
  multiplier?: number;
  color?: PrefValue;
  prefsText?: string;
  temperature?: number;
  // the player's clarification answers (the /1 link): an exact size class,
  // and a mood's palette shift and glyph sets (craft/moods.ts)
  sizeClass?: SizeClass;
  palette?: PaletteShift;
  glyphs?: BandGlyphs;
  // the /1 link: never end without a sprite (see the rescue below), and the
  // colour the player picked, for the built-in template
  neverFail?: boolean;
  colour?: string;
}

// The last resort: a simple figure for the item's kind, drawn with the same
// shapes and renderer as a planned one, in the picked colour (else the
// kind's own material). Always renders.
export function templatePlan(category: string, name: string, colour: string | undefined, sizeClass: SizeClass): CraftPlan {
  const R = (
    id: string,
    primitive: RegionSpec['primitive'],
    cx: number,
    cy: number,
    width: number,
    height: number,
    material: string,
    role: RegionSpec['role'] = 'body',
    importance: RegionSpec['importance'] = 4,
  ): RegionSpec => ({ id, primitive, bounds: { cx, cy, width, height }, material, role, importance });
  const dark = '#3a2a22';
  let regions: RegionSpec[];
  let w = 1;
  let h = 1;
  switch (category) {
    case 'pets':
      w = 4;
      h = 3;
      regions = [
        R('tail', 'line', 0.12, 0.42, 0.22, 0.3, colour ?? 'leather', 'attachment', 3),
        R('leg_back', 'rectangle', 0.3, 0.84, 0.1, 0.3, colour ?? 'leather', 'attachment', 3),
        R('leg_front', 'rectangle', 0.62, 0.84, 0.1, 0.3, colour ?? 'leather', 'attachment', 3),
        R('body', 'ellipse', 0.46, 0.58, 0.62, 0.5, colour ?? 'leather', 'body', 5),
        R('head', 'ellipse', 0.8, 0.32, 0.3, 0.46, colour ?? 'leather', 'body', 5),
        R('eye', 'point', 0.85, 0.27, 0.06, 0.08, dark, 'detail', 4),
      ];
      break;
    case 'plant':
      w = 3;
      h = 4;
      regions = [
        R('stem', 'line', 0.5, 0.62, 0.08, 0.4, 'leaf', 'body', 4),
        R('crown', 'blob', 0.5, 0.32, 0.8, 0.5, colour ?? 'leaf', 'body', 5),
        R('pot', 'trapezoid', 0.5, 0.86, 0.5, 0.26, 'stone', 'body', 4),
      ];
      break;
    case 'food':
      regions = [
        R('food', 'blob', 0.5, 0.55, 0.86, 0.78, colour ?? 'fire', 'body', 5),
        R('shine', 'point', 0.36, 0.38, 0.08, 0.08, '#fff4d6', 'accent', 2),
      ];
      break;
    case 'vehicle':
      w = 4;
      h = 2;
      regions = [
        R('hull', 'rounded_rectangle', 0.5, 0.45, 0.9, 0.55, colour ?? 'wood', 'body', 5),
        R('wheel_back', 'circle', 0.24, 0.8, 0.18, 0.18, 'metal', 'attachment', 4),
        R('wheel_front', 'circle', 0.76, 0.8, 0.18, 0.18, 'metal', 'attachment', 4),
      ];
      break;
    case 'clothing':
      w = 3;
      h = 3;
      regions = [R('garment', 'trapezoid', 0.5, 0.52, 0.86, 0.88, colour ?? 'cloth', 'body', 5)];
      break;
    default: // utensils and anything else
      w = 2;
      h = 4;
      regions = [
        R('handle', 'rectangle', 0.5, 0.7, 0.2, 0.56, 'wood', 'body', 4),
        R('head', 'ellipse', 0.5, 0.24, 0.7, 0.42, colour ?? 'metal', 'body', 5),
      ];
  }
  return { fit: true, sensitive: false, sizeAdjust: 'default', sizeClass, name, width: w, height: h, parts: regions.map((r) => r.id), regions };
}

export async function planAndRender(
  prompt: string,
  category: string,
  initialPlan: CraftPlan,
  deps: PlanAndRenderDeps,
): Promise<{ sprite: GeneratedSprite | null; log: CraftLog; error?: string; rescue?: 'salvaged' | 'template' }> {
  const start = Date.now();
  const attempts: CraftAttempt[] = [];
  const mult = deps.multiplier ?? RESOLUTION_MULTIPLIER;

  // lenient (the rescue): broken shapes are dropped instead of failing the
  // plan, and any non-empty render is accepted
  async function tryRender(plan: CraftPlan, level: 0 | 1, lenient = false): Promise<
    { ok: true; sprite: GeneratedSprite; warnings: string[] } | { ok: false; error: string }
  > {
    if (lenient) plan = { ...plan, regions: (plan.regions ?? []).filter(isStructurallyValidRegion) };
    const check = validateRegionPlan(plan);
    if (!check.ok) return { ok: false, error: plan.issue ? `${check.error}: ${plan.issue}` : check.error };
    const validated = deps.sizeClass ? { ...check.plan, sizeClass: deps.sizeClass } : check.plan;
    // Canvas size is a pure code decision (Stage 2) — resolveCanvasSize
    // already bakes in RESOLUTION_MULTIPLIER's larger glyph grid (more
    // cells for glyphRender.ts's texture/edge work), compensated afterward
    // with a CSS scale so the item's on-screen footprint matches its
    // sizeClass band exactly. See spriteConfig.ts's RESOLUTION_MULTIPLIER
    // comment. resolveRegions converts the plan's normalized (0..1,
    // centre-based) bounds into concrete cells at that canvas size, then
    // relation nudging runs in that same concrete cell space.
    const canvas = resolveCanvasSize(validated.sizeClass, validated.width, validated.height, mult);
    const rasterRegions = resolveRegions(validated.regions, canvas.width, canvas.height);
    const { regions: adjustedRegions, warnings: relationWarnings } = applyRelationAdjustments(
      rasterRegions,
      validated.relations ?? [],
      canvas.width,
      canvas.height,
    );
    const rendered = renderRegions(canvas.width, canvas.height, adjustedRegions, prompt, validated.face, deps.glyphs);
    const cropped = cropBlankEdges(rendered.lines, rendered.colors);
    const g: GeneratedSprite = {
      name: validated.name || prompt.trim().slice(0, 24),
      sizeClass: validated.sizeClass,
      parts: validated.parts,
      lines: padLines(cropped.lines),
      palette: rendered.palette,
      colors: cropped.colors,
      resolutionScale: 1 / mult,
    };
    const v = validateSpriteCandidate(g, mult);
    if (lenient ? !g.lines.some((l) => l.trim()) : !v.ok) return { ok: false, error: v.error ?? 'render validation failed' };
    sanitizeColors(g);
    if (g.palette && deps.color) g.palette = applyColorPref(g.palette, deps.color);
    if (g.palette && deps.palette) g.palette = transformPalette(g.palette, deps.palette);
    return { ok: true, sprite: g, warnings: [...check.warnings, ...relationWarnings] };
  }

  const done = (sprite: GeneratedSprite, level: 0 | 1, retried: boolean, warnings: string[], rescue?: 'salvaged' | 'template') => ({
    sprite,
    log: {
      prompt,
      category,
      sizeClass: sprite.sizeClass,
      parts: sprite.parts,
      retried,
      fallbackLevel: level,
      durationMs: Date.now() - start,
      ...(warnings.length ? { warnings } : {}),
      ...(attempts.length ? { attempts: [...attempts] } : {}),
      ...(rescue ? { rescue } : {}),
    } satisfies CraftLog,
    ...(rescue ? { rescue } : {}),
  });

  // level 0: the plan already fetched by the caller (llm.ts needs it early
  // anyway, for the sensitive/tokenHint check before spending any more effort)
  const a0 = await tryRender(initialPlan, 0);
  if (a0.ok) return done(a0.sprite, 0, false, a0.warnings);
  attempts.push({ level: 0, error: a0.error });
  if (deps.retry === false) return deps.neverFail ? rescue([initialPlan], false) : failed(false);

  // level 1: one retry, seeded with the concrete validation error. Retrying
  // the PLAN, not the render — rendering is deterministic, so retrying an
  // identical plan would only reproduce the same failure.
  const retryPrompt = `${prompt}\n\nYour previous attempt failed: ${a0.error}.${planRetryGuidance(a0.error)} Fix exactly that.`;
  let plan1: CraftPlan | null = null;
  try {
    plan1 = await planCraft(retryPrompt, category, deps.chat, {
      model: deps.model,
      fallbackModel: deps.fallbackModel,
      prefsText: deps.prefsText,
      temperature: deps.temperature,
    });
  } catch (err) {
    if (!deps.neverFail) throw err;
    attempts.push({ level: 1, error: `retry call failed: ${String(err)}` });
    return rescue([initialPlan], true);
  }
  const a1 = await tryRender(plan1, 1);
  if (a1.ok) return done(a1.sprite, 1, true, a1.warnings);
  attempts.push({ level: 1, error: a1.error });
  return deps.neverFail ? rescue([plan1, initialPlan], true) : failed(true);

  // neverFail: the AI's own plans first, leniently, then the template
  async function rescue(plans: CraftPlan[], retried: boolean) {
    for (const p of plans) {
      const a = await tryRender(p, 1, true);
      if (a.ok) return done(a.sprite, 1, retried, a.warnings, 'salvaged');
    }
    const t = templatePlan(category, initialPlan.name || prompt.trim().slice(0, 24), deps.colour, deps.sizeClass ?? initialPlan.sizeClass ?? 'medium');
    const a = await tryRender(t, 1, true);
    if (a.ok) return done(a.sprite, 1, retried, a.warnings, 'template');
    return failed(retried);
  }

  function failed(retried: boolean) {
    const lastError = attempts[attempts.length - 1]?.error ?? 'generation failed';
    return {
      sprite: null,
      error: lastError,
      log: {
        prompt,
        category,
        sizeClass: initialPlan.sizeClass,
        parts: [],
        retried,
        fallbackLevel: 2, // 2 = every attempt failed, no sprite produced
        durationMs: Date.now() - start,
        ...(attempts.length ? { attempts: [...attempts] } : {}),
      } satisfies CraftLog,
    };
  }
}

// A plan drawn exactly as a craft would be (the same canvas, renderer, crop
// and colour preference as tryRender above), without the checks: the
// preference previews (CraftFeedback.tsx) use it so what they show is what
// a craft with that setting gets.
export function renderPlan(prompt: string, plan: CraftPlan, opts: { multiplier?: number; color?: PrefValue } = {}): GeneratedSprite {
  const mult = opts.multiplier ?? RESOLUTION_MULTIPLIER;
  const canvas = resolveCanvasSize(plan.sizeClass, plan.width, plan.height, mult);
  const regions = resolveRegions(plan.regions, canvas.width, canvas.height);
  const rendered = renderRegions(canvas.width, canvas.height, regions, prompt, plan.face);
  const cropped = cropBlankEdges(rendered.lines, rendered.colors);
  const g: GeneratedSprite = {
    name: plan.name,
    sizeClass: plan.sizeClass,
    parts: plan.parts,
    lines: padLines(cropped.lines),
    palette: rendered.palette,
    colors: cropped.colors,
    resolutionScale: 1 / mult,
  };
  sanitizeColors(g);
  if (g.palette && opts.color) g.palette = applyColorPref(g.palette, opts.color);
  return g;
}
