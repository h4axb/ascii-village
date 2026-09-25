// ---------------------------------------------------------------------------
// CraftSpec — the structured form of a player prompt, and the split between
// SHAPE (goes into the cache key) and COSMETICS (applied per player at render).
//
// The same base asset is shared by everyone; "purple dog" and "blue dog" resolve
// to the same key and reuse one sprite, differing only in colour. Only true
// silhouette changes (extra heads, wings, a hybrid noun) change the key.
// ---------------------------------------------------------------------------

import {
  LOOKUPS,
  NOUN_CATEGORY,
  NOUN_SYNONYMS,
  NUMBER_WORDS,
  SHAPE_WORDS,
  STOPWORDS,
  PALETTE,
  SIZE_SCALE,
  type Dimension,
} from './vocab';

export interface CraftSpec {
  raw: string; // original prompt
  category: string; // creature / plant / weapon / ... or 'misc'
  base: string; // primary noun (normalized)
  hybrid?: string; // second noun → a mashup (affects the silhouette)
  shape: string[]; // silhouette-changing features, sorted (e.g. ['heads3','wings'])
  // cosmetics (do NOT affect the key)
  color?: string;
  size: string; // canonical size (default 'medium')
  material?: string;
  pattern?: string;
  finish?: string;
  mood?: string;
  style?: string;
  rarity?: string;
  unknown: string[]; // tokens we couldn't classify (log these to grow the vocab)
}

// One player's owned thing: a reference to a shared base + their cosmetics.
export interface ItemInstance {
  baseId: string;
  colorKey?: string;
  size: string;
  material?: string;
  pattern?: string;
  finish?: string;
  mood?: string;
  style?: string;
  rarity?: string;
}

// cosmetic dimensions, in precedence order (first match wins per token)
const COSMETIC_ORDER: Dimension[] = ['material', 'color', 'pattern', 'finish', 'mood', 'style', 'rarity', 'size'];

// "<part>ed" adjectives → the body part they imply
const ED_PARTS: Record<string, string> = {
  headed: 'head', winged: 'wing', horned: 'horn', tailed: 'tail',
  legged: 'leg', armed: 'arm', eyed: 'eye', spiked: 'spike',
};
const SINGULAR_PARTS = new Set(['head', 'wing', 'horn', 'tail', 'leg', 'arm', 'eye', 'spike']);

// return the singular body part for a token (handles plurals + "-ed"), else null
function bodyPartOf(tok: string): string | null {
  if (SINGULAR_PARTS.has(tok)) return tok;
  if (tok.endsWith('s') && SINGULAR_PARTS.has(tok.slice(0, -1))) return tok.slice(0, -1);
  if (ED_PARTS[tok]) return ED_PARTS[tok];
  return null;
}

export function parseSpec(prompt: string): CraftSpec {
  const norm = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  const tokens = norm.split(/[\s-]+/).filter(Boolean);

  const spec: CraftSpec = { raw: prompt, category: 'misc', base: 'thing', shape: [], size: 'medium', unknown: [] };
  const nouns: string[] = [];
  const leftovers: string[] = [];
  let pendingCount = 0;

  const addShape = (part: string, count: number) => {
    if (part === 'head' && count < 2) return; // every creature has a head
    spec.shape.push(count >= 2 ? `${part}s${count}` : `${part}s`);
  };

  for (const tok of tokens) {
    if (STOPWORDS.has(tok)) continue;
    if (NUMBER_WORDS[tok] != null) {
      pendingCount = NUMBER_WORDS[tok];
      continue;
    }
    const part = bodyPartOf(tok);
    if (part) {
      addShape(part, pendingCount);
      pendingCount = 0;
      continue;
    }
    if (SHAPE_WORDS[tok]) {
      spec.shape.push(SHAPE_WORDS[tok]);
      pendingCount = 0;
      continue;
    }
    const noun = NOUN_SYNONYMS[tok] ?? (NOUN_CATEGORY[tok] ? tok : undefined);
    if (noun) {
      nouns.push(noun);
      continue;
    }
    let matched = false;
    for (const dim of COSMETIC_ORDER) {
      const canon = LOOKUPS[dim][tok];
      if (canon) {
        // don't overwrite an earlier, more specific value for the same dim
        if (spec[dim] == null || dim === 'size') (spec as unknown as Record<Dimension, string>)[dim] = canon;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    leftovers.push(tok);
    spec.unknown.push(tok);
  }

  if (nouns.length > 0) {
    spec.base = nouns[0];
    if (nouns[1]) spec.hybrid = nouns[1];
    spec.category = NOUN_CATEGORY[spec.base] ?? 'misc';
  } else if (leftovers.length > 0) {
    // a novel noun we don't know yet — still craftable, just categorised 'misc'
    spec.base = leftovers[0];
    spec.category = 'misc';
    spec.unknown = spec.unknown.filter((w) => w !== spec.base);
  }

  spec.shape = [...new Set(spec.shape)].sort();
  return spec;
}

// material → a sensible default colour when the player didn't name one
const MATERIAL_COLOR: Record<string, string> = {
  wood: 'brown', stone: 'gray', metal: 'silver', gold: 'gold', silver: 'silver',
  bronze: 'brown', crystal: 'cyan', glass: 'cyan', ice: 'cyan', fire: 'orange',
  water: 'blue', cloud: 'white', slime: 'green', bone: 'white', diamond: 'cyan',
  obsidian: 'black', plush: 'pink', paper: 'beige', clay: 'brown', sand: 'beige',
  leaf: 'green', candy: 'pink', chocolate: 'brown', cheese: 'yellow', shadow: 'black',
  light: 'yellow',
};

// Resolve a player's cosmetics into concrete render values.
export function resolveStyle(inst: ItemInstance): { colorKey?: string; color?: string; scale: number } {
  const colorKey = inst.colorKey ?? (inst.material ? MATERIAL_COLOR[inst.material] : undefined);
  return {
    colorKey,
    color: colorKey ? PALETTE[colorKey] : undefined,
    scale: SIZE_SCALE[inst.size] ?? 1,
  };
}

// The four crafting "finish" effects the frontend can render (see
// ColoredSprite.tsx's `texture` prop / styles.css's .tex-* rules). Derived
// from `spec.finish` — vocab.ts's FINISH_GROUPS already classifies the
// player's words into this exact register (shiny/glowing/metallic/matte/
// transparent/wet/furry) via deterministic keyword lookup, so this reuses
// that existing, already-tested extraction rather than asking the sprite-
// generation LLM to separately re-infer the same thing (a second source of
// truth for one concept, and one more thing riding on that already-tuned,
// reliability-sensitive prompt — see spriteGen.ts's own notes on keeping
// that prompt narrow).
export type TextureModifier = 'shiny' | 'neon' | 'metallic' | 'matte';
const FINISH_TO_TEXTURE: Partial<Record<string, TextureModifier>> = {
  shiny: 'shiny',
  glowing: 'neon', // "an ambient light radius" reads as neon glow, not literal shine
  metallic: 'metallic',
  matte: 'matte',
  // transparent/wet/furry have no dedicated CSS effect (out of scope per the
  // spec's own 4-bucket list) — they fall through to the 'matte' default,
  // same as no finish at all.
};
export function textureModifierFor(finish?: string): TextureModifier {
  return (finish && FINISH_TO_TEXTURE[finish]) || 'matte';
}

// Pull the per-player cosmetics off a spec into an ItemInstance.
export function instanceFromSpec(spec: CraftSpec, baseId: string): ItemInstance {
  return {
    baseId,
    colorKey: spec.color,
    size: spec.size,
    material: spec.material,
    pattern: spec.pattern,
    finish: spec.finish,
    mood: spec.mood,
    style: spec.style,
    rarity: spec.rarity,
  };
}
