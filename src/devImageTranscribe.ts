// ---------------------------------------------------------------------------
// DEV-ONLY: reference image -> 3 ASCII/glyph world-asset variants, via a real
// vision-capable LLM call. User-confirmed tradeoff (this is the ONE place in
// the world-asset tooling that costs real API money per call — everything
// else in devWorldAssets.ts/DevAssetPanel.tsx is free/local).
//
// Model choice: this project's own .env carries an explicit note that the
// whole app was consolidated onto the cheapest model everywhere because the
// playtest budget is down to $6 — so this defaults to Haiku (Anthropic's
// cheap, vision-capable tier), NOT Sonnet/Opus, unless overridden via
// VITE_LLM_MODEL_WORLDASSET. "Claude" was requested specifically because it's
// the only vision path this codebase has ever verified working (see
// src/llmClient.ts's ContentPart comment) — Haiku still satisfies that while
// respecting the budget reality already on record.
//
// ONE call requests all 3 variants together (not 3 separate calls) — cheaper,
// at the cost of needing a larger, carefully-bounded JSON response. If this
// turns out to truncate on larger/denser references in practice, splitting
// into 3 calls is the fallback (a scoped follow-up, not silently done here).
// ---------------------------------------------------------------------------
import { chatJSON } from './llmClient';
import type { ContentPart } from './llmClient';

const WORLDASSET_MODEL =
  import.meta.env.VITE_LLM_MODEL_WORLDASSET?.trim() || 'anthropic/claude-haiku-4-5-20251001';

export interface TranscribedVariant {
  name: string;
  palette: Record<string, string>;
  sprite: string[];
  colors: string[];
  solid?: string[];
  sizeTier: 'small' | 'medium' | 'large';
  suggestedScale: number;
  warnings: string[];
}

function systemPrompt(): string {
  return [
    'You transcribe a reference image into this game\'s ASCII/glyph world-asset ' +
      'format. Reproduce the anatomy you actually SEE in the image — every part ' +
      'that is there, in the same layout — do not add, drop, or "improve" parts ' +
      'based on assumptions. This is a permanent world decoration (a tree, plant, ' +
      'rock, structure), not a small inventory item, so it is EXPECTED to follow ' +
      'the reference closely, including organic depth/shading via a density ramp ' +
      '(sparse " . : o * 8 @ " dense) where the reference has visible shading or ' +
      'volume — unlike a flatter silhouette-only style.',

    'GRID: if the reference looks like it was drawn on SQUARE pixel cells (pixel ' +
      'art, or any square-unit source), double every column — both the glyph and ' +
      'its colour key — before transcribing. One square source cell becomes two ' +
      'characters wide, one line tall, since this game\'s character cells render ' +
      'about 1.667x taller than wide.',

    'CHARSET: plain ASCII only — @ # * o O . , \' " ` ~ - _ = + | / \\ ( ) < > ^ v ' +
      '; : ! % & and space. No block/geometric Unicode glyphs (they render ' +
      'double-width in this font and shear the row) — approximate density with the ' +
      'ASCII ramp above instead.',

    'COLOUR: a small fixed-hex palette (2-8 #rrggbb keys), one per visually ' +
      'distinct part. A "colors" grid the exact same width/height as "sprite", ' +
      'each cell either a palette key (over an inked, non-space glyph) or "." ' +
      '(uncoloured/base). Every non-space glyph in "sprite" must have a matching ' +
      'palette-key cell in "colors" at the same position, or "." if intentionally ' +
      'left uncoloured.',

    'SIZE: classify "sizeTier" against this game\'s real anchors, relative to a ' +
      'person: clearly smaller than a person (flowers, grass, small rocks, most ' +
      'decorations) -> small; person-sized (large bushes, furniture-scale objects) ' +
      '-> medium; clearly larger than a person (trees, buildings) -> large. Then ' +
      'suggest "suggestedScale" (a multiplier, typically 0.1-1) such that the ' +
      'sprite\'s own authored width times that scale reads as roughly: small ~3-7 ' +
      'characters wide on screen, medium ~7-14, large ~15-30.',

    'COLLISION: a "solid" grid, same shape as "sprite", using any non-space glyph ' +
      'to mark where this object should actually BLOCK a player\'s movement — not ' +
      'simply everywhere ink is drawn. Decorative overhang (leaves, a canopy, thin ' +
      'branches) can stay walkable (blank in "solid") even where "sprite" draws ' +
      'something there; a solid trunk/base/wall should block. This is advisory, ' +
      'reviewed visually before use — a reasonable best guess is enough.',

    'Produce THREE genuinely distinct variants — different reasonable ' +
      'interpretations of the same reference (e.g. differing in exact glyph ' +
      'choice, colour palette, or level of detail), not near-duplicates. Note any ' +
      'genuine uncertainty (e.g. "colour is a guess, image was monochrome") as a ' +
      'short string in that variant\'s "warnings" array — omit it entirely (empty ' +
      'array) when there is nothing to flag.',

    'Reply with JSON only: {"variants": [ {"name": "...", "palette": {...}, ' +
      '"sprite": ["...", ...], "colors": ["...", ...], "solid": ["...", ...], ' +
      '"sizeTier": "small"|"medium"|"large", "suggestedScale": 0.5, ' +
      '"warnings": ["..."] }, /* x3 */ ] }',
  ].join('\n\n');
}

function userText(hint?: string): string {
  return hint
    ? `Transcribe the attached reference image. Extra context from the developer: "${hint}".`
    : 'Transcribe the attached reference image.';
}

export interface TranscribeResult {
  ok: true;
  variants: TranscribedVariant[];
}
export interface TranscribeError {
  ok: false;
  error: string;
}

function isValidVariant(v: unknown): v is TranscribedVariant {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    !!o.palette &&
    typeof o.palette === 'object' &&
    Array.isArray(o.sprite) &&
    o.sprite.every((l) => typeof l === 'string') &&
    Array.isArray(o.colors) &&
    o.colors.every((l) => typeof l === 'string') &&
    o.sprite.length === o.colors.length &&
    (o.sizeTier === 'small' || o.sizeTier === 'medium' || o.sizeTier === 'large') &&
    typeof o.suggestedScale === 'number'
  );
}

export async function transcribeImage(
  dataUrl: string,
  hint?: string,
): Promise<TranscribeResult | TranscribeError> {
  try {
    const content: ContentPart[] = [
      { type: 'text', text: userText(hint) },
      { type: 'image_url', image_url: { url: dataUrl } },
    ];
    const res = await chatJSON<{ variants?: unknown }>(
      [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content },
      ],
      { model: WORLDASSET_MODEL, temperature: 0.6, maxTokens: 6000, thinking: { type: 'disabled' } },
    );
    const raw = Array.isArray(res?.variants) ? res.variants : [];
    const variants = raw.filter(isValidVariant).map((v) => ({ ...v, warnings: v.warnings ?? [] }));
    if (variants.length === 0) {
      return { ok: false, error: 'model returned no usable variants (bad shape) — try again' };
    }
    return { ok: true, variants };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
