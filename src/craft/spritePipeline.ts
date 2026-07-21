// ---------------------------------------------------------------------------
// The sprite pipeline: Stage 1 (optional reference image) → Stage 2
// (streamed generation) → Stage 3 (validate) with retries:
//
//   level 0: generate from the reference image (or text, if no image)
//   level 1: retry once, appending the exact validation error
//   level 2: text-only structural generation (no image), validate once
//   all failed → sprite: null + an error the UI shows to the player
//                (no hand-made template stand-in, no silent substitution)
//
// Generated sprites are NOT persisted/reused — every craft generates fresh.
// Both network dependencies are INJECTED (llm.ts owns the clients), so this
// file imports no API client and stays testable.
// ---------------------------------------------------------------------------

import {
  SIZE_BANDS,
  type CraftAttempt,
  type CraftLog,
  type GeneratedSprite,
  type SizeClass,
} from './spriteConfig';
import { generateSprite, type ChatStreamFn } from './spriteGen';
import { padLines, padToWidth, validateSpriteCandidate } from './spriteValidate';

export interface SpritePipelineDeps {
  genImage: (prompt: string) => Promise<string | null>; // Stage 1
  chatStream: ChatStreamFn; // Stage 2 transport (streaming, per-line fail-fast)
  // Stage 0b — fast size pre-classification (Haiku). Fully-bound function so
  // model wiring stays in llm.ts. Runs in parallel with Stage 1.
  classify?: (prompt: string, category: string) => Promise<SizeClass>;
  model?: string;
  // Retried once (Stage 2 only), automatically, if `model` fails before any
  // sprite content has streamed — see chatStream's fallback contract.
  modelFallback?: string;
  // Progressive-rendering hook: fired for each validated sprite line as it
  // streams in, tagged with the attempt level. NOTE: once levels 1+2 run
  // concurrently, two attempts can emit lines at the same time — a UI should
  // buffer per-level and only render the winner once the tie-break resolves
  // (that buffering is the App-side crafting-animation follow-up).
  onLine?: (line: string, index: number, level: 0 | 1 | 2) => void;
  // Coarse progress for the UI: sketching the reference image → drawing →
  // (maybe) retrying. Fired at stage boundaries.
  onStage?: (stage: 'image' | 'drawing' | 'retrying') => void;
  // Fired the moment the reference image is ready (base64 data URL) so the UI
  // can show what the sprite is being drawn from.
  onImage?: (dataUrl: string) => void;
  // A/B toggle: 'image-first' (default, today's behavior) runs Stage 1 and
  // transcribes the reference image; 'text-only' skips Stage 1 entirely and
  // derives the sprite from the words alone. Exists so both strategies can be
  // compared as first-class paths (thesis A/B), not just via failure fallback.
  strategy?: 'image-first' | 'text-only';
}

type Attempt = { ok: true; sprite: GeneratedSprite } | { ok: false; error?: string };

function sizeOf(lines: string[]): SizeClass {
  const w = Math.max(0, ...lines.map((l) => l.length));
  const h = lines.length;
  // Prefer the smallest band the sprite ACTUALLY fits on BOTH axes — picking
  // by width alone (the old behavior) can misclassify a narrow-but-tall
  // composition (e.g. a standing pose with a raised limb) into a band whose
  // height cap it doesn't meet, causing a false "too tall" rejection that a
  // wider band would have accepted just fine.
  for (const name of ['small', 'medium', 'large'] as const) {
    const b = SIZE_BANDS[name];
    if (w <= b.maxW && h <= b.maxH) return name;
  }
  // doesn't fit any band on both axes — fall back to width bucketing;
  // validateSpriteCandidate will reject on whichever axis still overflows
  return w <= SIZE_BANDS.small.maxW ? 'small' : w <= SIZE_BANDS.medium.maxW ? 'medium' : 'large';
}

export async function makeSprite(
  prompt: string,
  category: string,
  deps: SpritePipelineDeps,
): Promise<{ sprite: GeneratedSprite | null; log: CraftLog; refImage?: string; error?: string }> {
  const start = Date.now();

  // STAGE 0 + STAGE 1 in parallel — the size classification (Haiku) and the
  // reference image (Gemini) don't depend on each other, so neither sits on
  // the critical path of the other. strategy 'text-only' skips the image
  // entirely (item C: A/B comparison path).
  if (deps.strategy !== 'text-only') deps.onStage?.('image');
  const [image, sizeHint] = await Promise.all([
    deps.strategy === 'text-only' ? Promise.resolve<string | null>(null) : deps.genImage(prompt),
    deps.classify ? deps.classify(prompt, category) : Promise.resolve<SizeClass>('medium'),
  ]);
  const imageUsed = !!image;
  if (image) deps.onImage?.(image);
  deps.onStage?.('drawing');

  // the size hint is a stable constraint across every attempt, not re-decided
  const attempt = async (ref: string | null, level: 0 | 1 | 2, hint?: string): Promise<Attempt> => {
    const res = await generateSprite(prompt, category, ref, deps.chatStream, {
      model: deps.model,
      fallbackModel: deps.modelFallback,
      retryHint: hint,
      sizeClass: sizeHint,
      onLine: deps.onLine ? (line, index) => deps.onLine!(line, index, level) : undefined,
    });
    if ('error' in res) return { ok: false, error: res.error };
    const g = res.sprite;
    g.lines = padLines(g.lines);
    // Lift a good-but-slightly-narrow sprite up to the absolute floor, then
    // derive the size class from ACTUAL dimensions (the model's declared class
    // is unreliable), then close the band gap: a sprite whose HEIGHT pushed it
    // into a wider band (e.g. 8 wide x 5 tall -> medium) gets center-padded to
    // that band's minimum width instead of rejected for being "too narrow" —
    // salvaging good art rather than failing on a solvable technicality.
    const w = Math.max(0, ...g.lines.map((l) => l.length));
    if (w >= 3 && w < SIZE_BANDS.small.minW) g.lines = padToWidth(g.lines, SIZE_BANDS.small.minW);
    g.sizeClass = sizeOf(g.lines);
    const band = SIZE_BANDS[g.sizeClass];
    const w2 = Math.max(0, ...g.lines.map((l) => l.length));
    if (w2 < band.minW) g.lines = padToWidth(g.lines, band.minW);
    const v = validateSpriteCandidate(g);
    return v.ok ? { ok: true, sprite: g } : { ok: false, error: v.error };
  };

  // every failed attempt is recorded so a failure's log explains itself
  const attempts: CraftAttempt[] = [];

  const done = (sprite: GeneratedSprite, level: 0 | 1 | 2, retried: boolean) => ({
    sprite,
    refImage: image ?? undefined,
    log: {
      prompt,
      category,
      sizeClass: sprite.sizeClass,
      parts: sprite.parts,
      ...(sprite.layout ? { layout: sprite.layout } : {}),
      ...(sprite.symmetry ? { symmetry: sprite.symmetry } : {}),
      imageUsed,
      retried,
      fallbackLevel: level,
      durationMs: Date.now() - start,
      ...(attempts.length ? { attempts: [...attempts] } : {}),
    } satisfies CraftLog,
  });

  const NOGEN = 'generation failed (no candidate returned)';

  // level 0
  const a0 = await attempt(image, 0);
  if (a0.ok) return done(a0.sprite, 0, false);
  attempts.push({ level: 0, error: a0.error ?? NOGEN });

  deps.onStage?.('retrying');
  if (!image) {
    // No reference image (Stage 1 failed, or strategy 'text-only') — the image
    // retry (level 1) and the text-only path (level 2) collapse into the SAME
    // call; firing both would waste a gateway call on an identical request.
    const a2 = await attempt(null, 2, a0.error);
    if (a2.ok) return done(a2.sprite, 2, true);
    attempts.push({ level: 2, error: a2.error ?? NOGEN });
  } else {
    // Levels 1+2 fire CONCURRENTLY. Note both only see level 0's error hint —
    // level 2 can no longer wait for level 1's refined hint without
    // reintroducing the sequential latency this removes (accepted trade-off).
    const [r1, r2] = await Promise.allSettled([
      attempt(image, 1, a0.error), // level 1: image retry
      attempt(null, 2, a0.error), // level 2: text-only
    ]);
    const ok1 = r1.status === 'fulfilled' && r1.value.ok ? r1.value : null;
    const ok2 = r2.status === 'fulfilled' && r2.value.ok ? r2.value : null;
    const failErr = (r: PromiseSettledResult<Attempt>): string =>
      r.status === 'fulfilled' ? (!r.value.ok && r.value.error) || NOGEN : String(r.reason);
    if (!ok1) attempts.push({ level: 1, error: failErr(r1) });
    if (!ok2) attempts.push({ level: 2, error: failErr(r2) });
    // Tie-break: prefer the image-based retry when both succeed — it had a real
    // reference to work from. allSettled + explicit post-hoc selection, NOT
    // Promise.race (race would let a fast-but-lower-quality text-only win on a
    // network timing fluke, not on merit). fallbackLevel stays self-describing:
    // 1 = image retry won, 2 = text-only won (or there was no image).
    if (ok1) return done(ok1.sprite, 1, true);
    if (ok2) return done(ok2.sprite, 2, true);
  }

  // every attempt failed — no template stand-in: report the failure honestly
  // so the UI can show a real error message and let the player rephrase.
  const lastError = attempts[attempts.length - 1]?.error ?? 'generation failed';
  return {
    sprite: null,
    error: lastError,
    refImage: image ?? undefined,
    log: {
      prompt,
      category,
      sizeClass: sizeHint,
      parts: [],
      imageUsed,
      retried: true,
      fallbackLevel: 3, // 3 = all attempts failed, no sprite produced
      durationMs: Date.now() - start,
      ...(attempts.length ? { attempts: [...attempts] } : {}),
    } satisfies CraftLog,
  };
}
