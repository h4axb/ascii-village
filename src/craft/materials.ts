// ---------------------------------------------------------------------------
// Pure data for the local, deterministic glyph renderer (glyphRender.ts).
// Ported from two Python reference tools shown this session:
//   - craft_glyph.py's MATERIALS dict (exact RGB values, verbatim)
//   - glyphify.py's RAMP_DEFAULT + colour gamma/lift constants
// See the plan (crafting sprite generator overhaul) for full provenance.
// These are colour/surface PRESETS only — never grow this into a semantic
// taxonomy (no "magic", no "strawberry"); anything without an obvious
// physical material is expected to arrive as a literal #rrggbb hex instead,
// resolved by glyphRender.ts's resolveMaterial().
// ---------------------------------------------------------------------------

import type { MaterialName } from './spriteConfig';

export const MATERIALS: Record<MaterialName, [number, number, number]> = {
  wood: [150, 96, 52],
  metal: [176, 180, 188],
  gold: [212, 168, 74],
  cloth: [196, 64, 64],
  leaf: [86, 150, 64],
  stone: [150, 146, 138],
  glass: [140, 200, 210],
  water: [70, 130, 200],
  fire: [230, 120, 40],
  bone: [222, 210, 180],
  leather: [120, 78, 46],
  skin: [240, 196, 160],
};

// One-line colour hints for the planning prompt (spriteGen.ts's planPrompt).
export const MATERIALS_HINT =
  'wood (warm brown), metal (cool gray-blue), gold, cloth (red-ish fabric default), ' +
  'leaf (green), stone (grey), glass (pale cyan, translucent-reading), water (blue), ' +
  'fire (orange), bone (pale cream), leather (dark brown), skin (warm tan)';

// glyphify.py's RAMP_DEFAULT, verbatim (leading space = unlit/space cell).
export const RAMP_DEFAULT = ' ·:¬=+†‡*¤§%&¥Ø@';

// glyphify.py's colour gamma/lift — keeps dark tones visible against the
// game's dark field. Applied once per distinct palette key, never per cell.
export const RAMP_GAMMA = 0.8;
export const RAMP_LIFT = 10;

// The small curated glyph choices for FEATURE mode (line/point/arc regions —
// geometry-matched, no luminance ramp). See glyphRender.ts.
export const FEATURE_GLYPHS = {
  point: '·', // isolated 1-cell accent
  pointLarge: '*', // a slightly bigger point-ish region
  pointRadial: '¤', // a rounder/denser isolated accent (biggest point tier)
  lineH: '=',
  lineV: ':',
  lineDiag: '/',
  lineDiagAlt: '\\',
  arc: '¬', // hook/curve — the only arc glyph, kept deliberately simple
} as const;
