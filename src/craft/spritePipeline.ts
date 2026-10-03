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
  validateRegionPlan,
  validateSpriteCandidate,
} from './spriteValidate';

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
}

export async function planAndRender(
  prompt: string,
  category: string,
  initialPlan: CraftPlan,
  deps: PlanAndRenderDeps,
): Promise<{ sprite: GeneratedSprite | null; log: CraftLog; error?: string }> {
  const start = Date.now();
  const attempts: CraftAttempt[] = [];
  const mult = deps.multiplier ?? RESOLUTION_MULTIPLIER;

  async function tryRender(plan: CraftPlan, level: 0 | 1): Promise<
    { ok: true; sprite: GeneratedSprite; warnings: string[] } | { ok: false; error: string }
  > {
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
    if (!v.ok) return { ok: false, error: v.error ?? 'render validation failed' };
    sanitizeColors(g);
    if (g.palette && deps.color) g.palette = applyColorPref(g.palette, deps.color);
    if (g.palette && deps.palette) g.palette = transformPalette(g.palette, deps.palette);
    return { ok: true, sprite: g, warnings: [...check.warnings, ...relationWarnings] };
  }

  const done = (sprite: GeneratedSprite, level: 0 | 1, retried: boolean, warnings: string[]) => ({
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
    } satisfies CraftLog,
  });

  // level 0: the plan already fetched by the caller (llm.ts needs it early
  // anyway, for the sensitive/tokenHint check before spending any more effort)
  const a0 = await tryRender(initialPlan, 0);
  if (a0.ok) return done(a0.sprite, 0, false, a0.warnings);
  attempts.push({ level: 0, error: a0.error });
  if (deps.retry === false) return failed(false);

  // level 1: one retry, seeded with the concrete validation error. Retrying
  // the PLAN, not the render — rendering is deterministic, so retrying an
  // identical plan would only reproduce the same failure.
  const retryPrompt = `${prompt}\n\nYour previous attempt failed: ${a0.error}.${planRetryGuidance(a0.error)} Fix exactly that.`;
  const plan1 = await planCraft(retryPrompt, category, deps.chat, {
    model: deps.model,
    fallbackModel: deps.fallbackModel,
    prefsText: deps.prefsText,
    temperature: deps.temperature,
  });
  const a1 = await tryRender(plan1, 1);
  if (a1.ok) return done(a1.sprite, 1, true, a1.warnings);
  attempts.push({ level: 1, error: a1.error });
  return failed(true);

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
