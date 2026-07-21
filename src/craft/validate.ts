// ---------------------------------------------------------------------------
// Validation processes. A generated sprite is only accepted if it passes these
// legitimacy checks; the request itself is checked first. Everything is pure so
// it's cheap to run on every generation attempt.
// ---------------------------------------------------------------------------

import type { CraftSpec } from './spec';

export interface SpriteLimits {
  maxLines: number;
  minWidth: number;
  maxWidth: number;
  minInk: number; // minimum non-space characters
  maxFill: number; // max fraction of cells that are ink (reject solid blobs)
}

export const DEFAULT_LIMITS: SpriteLimits = {
  maxLines: 8,
  minWidth: 2,
  maxWidth: 14,
  minInk: 3,
  maxFill: 0.9,
};

export interface Check {
  ok: boolean;
  reasons: string[];
}

// tab or printable ASCII only (keeps the monospace grid safe)
const printableAscii = (s: string) => [...s].every((ch) => {
  const c = ch.charCodeAt(0);
  return c === 9 || (c >= 32 && c <= 126);
});

// 1) Is the request itself legitimate / craftable?
export function validateRequest(spec: CraftSpec): Check {
  const reasons: string[] = [];
  if (spec.base === 'thing' && spec.unknown.length === 0) {
    reasons.push('empty or unrecognizable request');
  }
  return { ok: reasons.length === 0, reasons };
}

// Tidy up a candidate so small model quirks don't fail an otherwise-fine sprite.
export function repairSprite(sprite: string[], limits: SpriteLimits = DEFAULT_LIMITS): string[] {
  let lines = sprite.map((l) =>
    l.replace(/\t/g, ' ').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+$/, ''),
  );
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines = lines.map((l) => l.slice(0, limits.maxWidth));
  return lines;
}

// 2) Is the generated sprite legitimate (right shape, legal chars, not junk)?
export function validateSprite(sprite: string[], limits: SpriteLimits = DEFAULT_LIMITS): Check {
  const reasons: string[] = [];
  if (sprite.length === 0) {
    return { ok: false, reasons: ['empty'] };
  }
  if (sprite.length > limits.maxLines) reasons.push('too tall');

  const width = Math.max(0, ...sprite.map((l) => l.length));
  if (width < limits.minWidth) reasons.push('too narrow / blank');
  if (width > limits.maxWidth) reasons.push('too wide');

  const ink = sprite.reduce((n, l) => n + [...l].filter((c) => c !== ' ').length, 0);
  if (ink < limits.minInk) reasons.push('too sparse');

  const cells = Math.max(1, width * sprite.length);
  if (ink / cells > limits.maxFill) reasons.push('too dense (a solid block, not a shape)');

  if (!sprite.every(printableAscii)) reasons.push('contains non-ascii or control characters');

  return { ok: reasons.length === 0, reasons };
}
