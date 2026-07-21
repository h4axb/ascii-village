// ---------------------------------------------------------------------------
// Sprite generation config: size classes, allowed character sets, the
// real-world-scale guideline, and shared types. Pure data — imported by the
// generator, the validator, and the prompt builder.
// ---------------------------------------------------------------------------

import * as S from '../sprites';

export type SizeClass = 'small' | 'medium' | 'large';

// Build ceiling — the widest a generated sprite may be. Anchored to the world:
// the SHOP (22×8) is the widest hand-made sprite, so nothing generated may
// exceed it. (An earlier version allowed 30 and a 12-wide FLOOR — designed in
// a vacuum, which made a "medium" duck at 16-25 wide render BIGGER than the
// 17-wide house.)
export const MAX_SPRITE_WIDTH = 22;

// Disjoint size bands (no overlaps). Widths in characters, heights in lines.
// ANCHORED TO THE HAND-MADE WORLD so real-life proportion falls out naturally:
//   PLAYER (a human) 7×3, CAT 7×3, APPLE 6×5, APPLE_TREE 12×8, HOUSE 17×8,
//   SHOP 22×8.  duck < player < cow < tree/house — by construction.
export const SIZE_BANDS: Record<SizeClass, { minW: number; maxW: number; maxH: number }> = {
  small: { minW: 5, maxW: 8, maxH: 4 }, // below-human scale: most pets, items, food, tools (the cat is 7×3)
  medium: { minW: 9, maxW: 14, maxH: 6 }, // human-ish scale: people, big animals (pony/cow), furniture
  large: { minW: 15, maxW: 22, maxH: 9 }, // above-human: trees, vehicles, buildings (house 17×8, shop 22×8)
};

// How to pick a size class from the object's REAL-LIFE scale, with the world's
// own sprites as concrete anchors. Text for the prompt (used by both the
// pre-flight screen and the sprite generator).
export const SIZE_GUIDELINE =
  'Judge the item\'s REAL-LIFE size relative to a person. For scale: the player (a human) is drawn ' +
  '7 characters wide and 3 lines tall; the cat is 7x3; the whole house is only 17x8. ' +
  'Clearly smaller than a person (most pets - ducks, cats, dogs - plus items, fruits, tools, small flora) -> small; ' +
  'person-sized (people, large animals like a pony or cow, furniture) -> medium; ' +
  'clearly larger than a person (trees, vehicles, buildings) -> large. When unsure, choose smaller.';

// FACE SET — the cute dot-face glyphs (kaomoji), restricted to a hand-picked
// list of codepoints we can vouch for: `·` (U+00B7 middle dot, Latin-1),
// `ω` (U+03C9 Greek small omega), `°` (U+00B0 degree sign, Latin-1), plus
// ASCII `_`. These are common codepoints present (and single-width) in
// essentially every monospace font a mainstream OS ships. checkAlignment in
// spriteValidate.ts enforces this STATICALLY by codepoint — no font
// measurement — so this list IS the complete set of non-ASCII glyphs the model
// may emit. Add a glyph only after hand-verifying it renders single-width
// broadly. (Dropped: `˘` U+02D8 and `ᵔ` U+1D54 — obscure blocks with no
// reliable monospace guarantee; they were the root cause of the everything-
// falls-back-to-the-template bug.)
export const FACE_SET = ['·', 'ω', '°', '_'];

// BODY / STRUCTURE SET — the rest of the allowed glyphs (plus space). Note this
// deliberately includes the letters o, O and v; no other letters and no digits.
const BODY_SET = "@#*oO.,'\"`~-_=+|/\\()<>^v;:!%& ".split('');

// The full allowed character set (body + faces + space).
export const ALLOWED_CHARS = new Set<string>([...BODY_SET, ...FACE_SET]);

// A generated sprite as produced by Stage 2 (and returned by the pipeline).
export interface GeneratedSprite {
  name: string;
  sizeClass: SizeClass;
  parts: string[]; // the anatomy list (written BEFORE drawing — the analysis)
  layout?: string; // spatial arrangement note ("heads in a row on top, ...")
  symmetry?: 'mirror' | 'none'; // 'mirror' = model drew a half, we mirrored it
  lines: string[]; // the sprite itself
}

// One failed generation attempt on the way to a failure.
export interface CraftAttempt {
  level: 0 | 1 | 2;
  error: string;
}

// One structured log record per generation (see llm.ts craftLog).
export interface CraftLog {
  prompt: string;
  category: string;
  sizeClass: SizeClass;
  parts: string[];
  imageUsed: boolean;
  retried: boolean;
  // 0 = first attempt, 1 = image retry, 2 = text-only retry,
  // 3 = ALL attempts failed — no sprite was produced (the player sees an
  // error message; there is deliberately no template stand-in).
  fallbackLevel: 0 | 1 | 2 | 3;
  layout?: string; // the model's spatial-arrangement analysis (thesis data)
  symmetry?: 'mirror' | 'none'; // whether the mirror-half token-saving path was used
  durationMs: number;
  // Present only when attempts failed on the way here — each entry says exactly
  // why that level was rejected, so a failure in the console log is
  // self-explanatory without a debugging session.
  attempts?: CraftAttempt[];
}

// The existing hand-made sprites shown to the model as STYLE EXAMPLES so its
// output looks stylistically related. Verbatim from the code constants.
export const STYLE_EXAMPLES: { name: string; art: string[] }[] = [
  { name: 'player girl', art: S.PLAYER },
  { name: 'cat NPC', art: S.CAT },
  { name: 'apple tree', art: S.APPLE_TREE },
  { name: 'flower', art: S.FLOWER },
  { name: 'apple', art: S.APPLE },
  { name: 'shop', art: S.SHOP },
];
