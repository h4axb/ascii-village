// ---------------------------------------------------------------------------
// The never-fail fallback's reading of a prompt: one unified look-up over the
// three themed word lists (lexicon.ts), the library's words (refCraft.ts) and
// the category words (parseSpec), so a craft that can't be drawn any other
// way still knows what it is and which built-in shape to draw.
//   "a racoon"         -> racoon, pets   (the pets list knows it)
//   "a lamp"           -> lamp, utensils (no theme: the category words)
//   "a drgon"          -> dragon, pets   (a typo: its closest known word)
// llm.ts fallbackCraft builds the item from this: the library body when one
// fits, else the shape template for the category.
// ---------------------------------------------------------------------------
import { closestWords, kindOf, promptParts, themeOfObject, type Theme } from './lexicon';
import { typoDistance } from './colours';

export type FallbackCategory = 'plant' | 'pets' | 'clothing' | 'vehicle' | 'food' | 'utensils';

const THEME_CATEGORY: Record<Theme, FallbackCategory> = { pets: 'pets', ships: 'vehicle', watering: 'utensils' };

export interface FallbackSubject {
  word: string | null; // the main object, as read (typos fixed)
  theme: Theme | null;
  category: FallbackCategory | null; // null: leave it to the category words
}

export function fallbackSubject(prompt: string): FallbackSubject {
  const parts = promptParts(prompt);
  let word = parts.main;
  // an unknown main word: its closest known object when it's a typo away
  if (word && !parts.mainKnown) {
    const [c] = closestWords(word, 1, ['object']);
    if (c && typoDistance(word, c) <= (word.length >= 7 ? 2 : 1)) word = c;
  }
  const theme = (word && kindOf(word) === 'object' ? themeOfObject(word) : null) ?? parts.theme;
  return { word, theme, category: theme ? THEME_CATEGORY[theme] : null };
}

// what Mitchy says after a fallback craft
export const missingAssetNote = (word: string | null) =>
  `I don't have a pattern for ${word ? `"${word}"` : 'this'} yet, so this is my simple first try. I've noted it so it can be added in a next patch!`;
