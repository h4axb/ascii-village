// ---------------------------------------------------------------------------
// STAGE 3 — validation. A candidate must pass all checks (in order) or it's
// rejected with a reason the pipeline feeds back into a retry.
// ---------------------------------------------------------------------------

import { ALLOWED_CHARS, MAX_SPRITE_WIDTH, SIZE_BANDS, type GeneratedSprite } from './spriteConfig';

export interface SpriteCheck {
  ok: boolean;
  error?: string;
}
const fail = (error: string): SpriteCheck => ({ ok: false, error });

// Pad every line to the max width so the sprite is a clean rectangle.
export function padLines(lines: string[]): string[] {
  const w = Math.max(0, ...lines.map((l) => l.length));
  return lines.map((l) => l.padEnd(w, ' '));
}

// Center-pad every line to a target width (used to lift a good-but-narrow
// sprite up to the minimum grid width instead of rejecting it).
export function padToWidth(lines: string[], width: number): string[] {
  return lines.map((l) => {
    if (l.length >= width) return l;
    const total = width - l.length;
    const left = Math.floor(total / 2);
    return ' '.repeat(left) + l + ' '.repeat(total - left);
  });
}

export function validateSpriteCandidate(g: GeneratedSprite): SpriteCheck {
  const lines = g.lines;
  if (!lines || lines.length === 0) return fail('empty');
  if (lines[0].trim() === '') return fail('first line is empty');
  if (lines[lines.length - 1].trim() === '') return fail('last line is empty');

  const width = Math.max(0, ...lines.map((l) => l.length));
  const band = SIZE_BANDS[g.sizeClass];
  const maxW = Math.min(band.maxW, MAX_SPRITE_WIDTH);
  // absolute floor = the small band's own floor (world-anchored)
  if (width < SIZE_BANDS.small.minW) return fail(`too narrow (${width} < ${SIZE_BANDS.small.minW})`);
  if (width < band.minW) return fail(`width ${width} below ${g.sizeClass} minimum ${band.minW}`);
  if (width > maxW) return fail(`width ${width} over ${g.sizeClass} maximum ${maxW}`);
  if (lines.length > band.maxH) return fail(`too tall (${lines.length} > ${band.maxH})`);

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
// measurement. The old version measured rendered width in a hidden <pre>, but
// that depends on whatever font the player's browser actually resolves (no
// font is bundled/loaded by this project), so results varied per machine and
// on common systems rejected every kaomoji sprite. Instead we classify by
// codepoint: ASCII is single-width in every monospace font; our FACE_SET is a
// tiny hand-verified allowlist; and known-wide Unicode blocks are rejected
// outright with a clear message. Deterministic, and works identically in Node
// and the browser (no `document` dependency).
// ---------------------------------------------------------------------------

// Unicode blocks known to contain fullwidth/wide glyphs — not guaranteed
// single-width in a monospace font. None of these appear in ALLOWED_CHARS;
// this is a defense-in-depth net (clearer error than a generic reject) for
// when the model emits an unlisted glyph despite instructions.
const WIDE_BLOCKS: { lo: number; hi: number; label: string }[] = [
  { lo: 0x3000, hi: 0x303f, label: 'CJK Symbols and Punctuation' },
  { lo: 0x3040, hi: 0x309f, label: 'Hiragana' },
  { lo: 0x30a0, hi: 0x30ff, label: 'Katakana' }, // incl. the fullwidth kaomoji dot ・ U+30FB

  { lo: 0x4e00, hi: 0x9fff, label: 'CJK Unified Ideographs' },
  { lo: 0xac00, hi: 0xd7a3, label: 'Hangul Syllables' },
  { lo: 0xff00, hi: 0xffef, label: 'Halfwidth and Fullwidth Forms' },
];

// Charset gate for a single line (same rule as the whole-sprite loop below).
export function checkLineCharset(line: string): SpriteCheck {
  for (const ch of line) {
    if (!ALLOWED_CHARS.has(ch)) return fail(`illegal character "${ch}"`);
  }
  return { ok: true };
}

// Per-line fail-fast check for the streaming path: charset + codepoint width +
// a coarse runaway-length guard. Width-band / height / ink-density checks need
// the WHOLE sprite and stay in validateSpriteCandidate (run once at the end).
export function checkLine(line: string): SpriteCheck {
  if (line.length > 30) return fail(`line too long (${line.length} chars)`); // no band exceeds 22 wide; 30 = headroom
  const cs = checkLineCharset(line);
  if (!cs.ok) return cs;
  for (const ch of line) {
    const c = checkChar(ch);
    if (!c.ok) return c;
  }
  return { ok: true };
}

// Check a single character. Exported for the streaming per-line path.
export function checkChar(ch: string): SpriteCheck {
  const cp = ch.codePointAt(0)!;
  if (cp <= 0x7e) return { ok: true }; // printable Basic ASCII: always single-width
  if (ALLOWED_CHARS.has(ch)) return { ok: true }; // hand-verified FACE_SET glyphs
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  const wide = WIDE_BLOCKS.find((b) => cp >= b.lo && cp <= b.hi);
  return fail(
    wide
      ? `"${ch}" (${hex}) is a ${wide.label} character — not guaranteed single-width in a monospace font`
      : `"${ch}" (${hex}) is not a known single-width character`,
  );
}

// In the normal call path every char has already passed the ALLOWED_CHARS gate
// in validateSpriteCandidate, so this usually returns ok — it exists as an
// explicit, testable assertion of the width guarantee, and as a standalone-safe
// net when called outside that path.
export function checkAlignment(lines: string[]): SpriteCheck {
  for (const line of lines) {
    for (const ch of line) {
      const c = checkChar(ch);
      if (!c.ok) return c;
    }
  }
  return { ok: true };
}
