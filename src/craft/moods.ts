// Mood presets for crafting panel 1 (pre-clarification, the /1 link). A mood
// word like "cute" has no lever of its own in this pipeline (an AI plans
// simple shapes, fixed code draws them), so each mood is a fixed recipe:
//   palette  a lightness / saturation / hue shift of the finished palette (exact)
//   glyphs   the renderer's per-band glyph sets (exact)
//   finish   the item's CSS finish (exact)
//   shape    an instruction for the planner (strong, not guaranteed)
// The clarification call (spriteGen.ts clarifyCraft) may offer a mood as an
// answer; craftItem applies the preset. Every glyph here must be in
// spriteConfig.ts's ALLOWED_CHARS (the validator rejects anything else).
import type { TextureModifier } from './spec';
import type { PaletteShift } from './prefs';

export type Mood = 'cute' | 'mysterious' | 'unusual' | 'cozy' | 'bold';
export const MOODS: Mood[] = ['cute', 'mysterious', 'unusual', 'cozy', 'bold'];
export const isMood = (v: unknown): v is Mood => typeof v === 'string' && (MOODS as string[]).includes(v);

export type BandGlyphs = { lo: string[]; mid: string[]; hi: string[] };

export interface MoodPreset {
  palette: PaletteShift;
  glyphs: BandGlyphs;
  finish: TextureModifier;
  shape: string;
}

export const MOOD_PRESETS: Record<Mood, MoodPreset> = {
  cute: {
    palette: { light: 0.45, sat: -0.15 },
    glyphs: { lo: ['·', '°', ':'], mid: ['o', '°', '+'], hi: ['o', 'O', '@', '°'] },
    finish: 'matte',
    shape: 'round, soft shapes (circles, ellipses, blobs), a big head compared to the body, small and chubby, no sharp points',
  },
  mysterious: {
    palette: { light: -0.8, sat: 0.1, hue: 22 },
    glyphs: { lo: ['·', ':', '|'], mid: ['=', '‡', '#'], hi: ['%', '#', '§', '¤'] },
    finish: 'neon',
    shape: 'narrow, pointed shapes, deep dark colours with one small glowing accent (e.g. glowing eyes or a glowing mark)',
  },
  unusual: {
    palette: { sat: 0.35, hue: 140 },
    glyphs: { lo: ['·', '¬', '~'], mid: ['~', '^', '+', '‡'], hi: ['¤', '%', '&', '§', '*'] },
    finish: 'shiny',
    shape: 'one unexpected or asymmetric extra part and an uncommon colour combination, still clearly the requested thing',
  },
  cozy: {
    palette: { light: 0.15, sat: -0.25, hue: -8 },
    glyphs: { lo: ['·', ':', '¬'], mid: ['=', '+', '~'], hi: ['*', '¤', '&'] },
    finish: 'matte',
    shape: 'warm, rounded and slightly plump shapes, soft earthy colours, nothing sharp',
  },
  bold: {
    palette: { sat: 0.55, light: 0.05 },
    glyphs: { lo: [':', '¬', '='], mid: ['+', '†', '‡', '#'], hi: ['&', '%', '#', '@', '§'] },
    finish: 'shiny',
    shape: 'big, strong silhouette with clear contrasting colours and chunky parts',
  },
};
