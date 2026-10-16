// ---------------------------------------------------------------------------
// Colour phrases in a crafting prompt, in any wording ("baby blue", "sky
// blue", "hellblauer", "bleu clair", "crimson", "the colour of the sea").
// Local and only for RECOGNISING them: the exact colours come from the model
// (llm.ts craftColours). Recognised, a colour phrase is never a leftover
// detail and the colour question isn't asked. When the model doesn't answer,
// each phrase falls back to its base colour word ("baby blue" -> blue).
// ---------------------------------------------------------------------------
import { PALETTE } from './vocab';

// base colour words in English, German, French, Spanish, Italian, Dutch
// (accents folded; Romance words by their stem, endings are stripped) -> a
// PALETTE key
const BASE: Record<string, string> = {};
const add = (key: string, ...ws: string[]) => ws.forEach((w) => (BASE[w] = key));
for (const k of Object.keys(PALETTE)) BASE[k] = k;
add('gray', 'grey', 'grau', 'gris', 'grigio', 'grigi', 'grij', 'grijs');
add('blue', 'blau', 'bleu', 'azul', 'blu', 'blauw', 'azur', 'azure', 'cobalt', 'sapphire', 'indigo', 'bluish', 'blueish');
add('red', 'rot', 'rouge', 'roj', 'ross', 'rood', 'crimson', 'scarlet', 'maroon', 'ruby', 'burgundy', 'reddish');
add('green', 'grun', 'gruen', 'vert', 'verd', 'groen', 'emerald', 'olive', 'mint', 'jade', 'greenish');
add('yellow', 'gelb', 'jaune', 'amarill', 'giall', 'geel', 'lemon', 'mustard', 'yellowish');
add('orange', 'naranja', 'arancion', 'oranje', 'peach', 'coral', 'amber', 'tangerine', 'apricot', 'orangey');
add('purple', 'lila', 'violett', 'violet', 'morad', 'viola', 'paars', 'lavender', 'lilac', 'mauve', 'purplish');
add('pink', 'rosa', 'rosad', 'roze', 'pinkish');
add('magenta', 'fuchsia');
add('teal', 'turquoise', 'turkis', 'tuerkis', 'turquesa', 'turchese');
add('brown', 'braun', 'marron', 'brun', 'marrone', 'bruin', 'tan', 'brownish');
add('black', 'schwarz', 'noir', 'negr', 'ner', 'zwart', 'charcoal', 'ebony');
add('white', 'weiss', 'blanc', 'blanch', 'bianc', 'wit', 'ivory', 'cream');
add('beige', 'khaki');
add('gold', 'golden', 'goldene', 'dorad', 'dore', 'oro', 'goud', 'gouden');
add('silver', 'silber', 'argent', 'plata', 'argento', 'zilver');
add('rainbow', 'regenbogen', 'arcobaleno', 'arcoiris', 'regenboog', 'multicolor', 'multicolour', 'multicoloured', 'colorful', 'colourful', 'bunt');

// words that shade a colour ("baby", "dark") or name a colour by a thing
// ("sky", "sunset") — a colour only next to one, or on their own when listed
// in OWN below
const MODIFIERS = new Set([
  'baby', 'pastel', 'light', 'pale', 'soft', 'dark', 'deep', 'bright', 'neon', 'vivid', 'hot', 'royal', 'electric', 'dusty',
  'muted', 'warm', 'cool', 'icy', 'ice', 'powder', 'midnight', 'forest', 'sea', 'ocean', 'sky', 'sunset', 'sunny', 'blood',
  'rich', 'lime', 'navy', 'candy', 'bubblegum', 'cotton', 'metallic', 'shiny', 'glowing', 'faded', 'vibrant', 'mid', 'medium',
  // German, French, Spanish, Italian, Dutch (stems; compounds: hellblau)
  'hell', 'dunkel', 'dunkl', 'zart', 'tief', 'blass', 'knall', 'pastell', 'leucht', 'clair', 'fonce', 'pal', 'vif', 'viv',
  'clar', 'oscur', 'palid', 'bebe', 'chiar', 'scur', 'pallid', 'licht', 'donker', 'bleek', 'fel', 'zacht', 'baby',
]);
// shades said after the colour ("bleu clair", "azul claro", "rosso scuro"),
// and words that only say it's a colour ("sunset coloured")
const AFTER = new Set(['clair', 'claire', 'clairs', 'fonce', 'foncee', 'vif', 'vive', 'pale', 'bebe', 'clar', 'oscur', 'palid', 'chiar', 'scur', 'pallid', 'viv', 'baby', 'pastel', 'pastell', 'neon']);
const COLOURED = new Set(['coloured', 'colored', 'colour', 'color', 'tone', 'toned', 'shade', 'farben', 'farbig', 'farbe', 'couleur', 'colore', 'colorato', 'kleurig', 'gekleurd']);
const afterShade = (w: string) => AFTER.has(w) || ['a', 'o', 'e', 's', 'i', 'os', 'as'].some((e) => w.endsWith(e) && AFTER.has(w.slice(0, -e.length)));
// a thing that is a colour on its own (no base colour to fall back to)
const OWN = new Set(['sunset', 'neon', 'pastel']);
// "the colour of the sea", "in the colour of ..."
const COLOUR_NOUNS = new Set(['colour', 'color', 'farbe', 'couleur', 'colore', 'kleur']);
const OF = new Set(['of', 'von', 'wie', 'de', 'du', 'des', 'di', 'del', 'della', 'van', 'like']);
const ARTICLES = new Set(['the', 'a', 'an', 'der', 'die', 'das', 'des', 'le', 'la', 'les', 'el', 'los', 'las', 'il', 'lo', 'het', 'de', 'een']);

const ENDINGS = ['ish', 'en', 'em', 'er', 'es', 'e', 's', 'a', 'o', 'i'];
// a word's base colour key, its inflected forms too ("blauer", "rossa")
function baseWord(w: string): string | null {
  if (BASE[w]) return BASE[w];
  for (const e of ENDINGS) if (w.length - e.length >= 2 && w.endsWith(e) && BASE[w.slice(0, -e.length)]) return BASE[w.slice(0, -e.length)];
  return null;
}
function isModifier(w: string): boolean {
  if (MODIFIERS.has(w)) return true;
  return ENDINGS.some((e) => w.length - e.length >= 3 && w.endsWith(e) && MODIFIERS.has(w.slice(0, -e.length)));
}
// one word: its base colour (with a compound's shade: "hellblau",
// "lichtblauw", "baby-blue"), whether it's only a shade, and whether it's a
// plain colour word (no shade at all)
interface Token {
  base: string | null;
  modifier: boolean;
  plain: boolean;
  own: boolean;
}
function token(w: string): Token {
  const parts = w.split('-').filter(Boolean);
  if (parts.length > 1) {
    const ts = parts.map(token);
    const colour = ts.filter((t) => t.base || t.own);
    if (colour.length && ts.every((t) => t.base || t.modifier || t.own))
      return { base: colour[colour.length - 1].base, modifier: false, plain: false, own: colour.some((t) => t.own) };
    return { base: null, modifier: ts.every((t) => t.modifier), plain: false, own: false };
  }
  const b = baseWord(w);
  if (b) return { base: b, modifier: false, plain: w === b || w === 'grey', own: false };
  if (OWN.has(w)) return { base: null, modifier: true, plain: false, own: true };
  // a German / Dutch compound: a shade glued to a base ("hellblauer")
  for (const m of MODIFIERS) {
    if (m.length >= 3 && w.startsWith(m) && w.length > m.length + 2) {
      const rest = baseWord(w.slice(m.length));
      if (rest) return { base: rest, modifier: false, plain: false, own: false };
    }
  }
  return { base: null, modifier: isModifier(w), plain: false, own: false };
}

export interface ColourPhrase {
  start: number; // token index, inclusive
  end: number; // exclusive
  phrase: string; // as found ("baby blue")
  base: string | null; // its base colour word (a PALETTE key), null for "sunset"
  plain: boolean; // just a colour word ("blue"): the fallback loses nothing
}

// the colour phrases in a list of words (lowercase, accents folded)
export function colourPhrases(ws: string[]): ColourPhrase[] {
  const out: ColourPhrase[] = [];
  const ts = ws.map(token);
  for (let i = 0; i < ws.length; i++) {
    // "the colour of the sea": up to two words after it
    if (COLOUR_NOUNS.has(ws[i]) && OF.has(ws[i + 1] ?? '')) {
      let j = i + 2;
      while (j < ws.length && ARTICLES.has(ws[j])) j++;
      const end = Math.min(ws.length, j + (j + 1 < ws.length && ts[j + 1].base ? 2 : 1));
      if (j < ws.length) {
        const base = ts.slice(j, end).map((t) => t.base).filter(Boolean).pop() ?? null;
        out.push({ start: i, end, phrase: ws.slice(i, end).join(' '), base, plain: false });
        i = end - 1;
        continue;
      }
    }
    if (!ts[i].base && !ts[i].own) continue;
    let start = i;
    while (start > 0 && ts[start - 1].modifier && !out.some((p) => p.end > start - 1)) start--;
    let end = i + 1;
    // "blue green", "navy blue": one phrase, the last word its base
    while (end < ws.length && (ts[end].base || (ts[end].own && !ts[end - 1].base))) end++;
    while (end < ws.length && (afterShade(ws[end]) || COLOURED.has(ws[end]))) end++;
    const run = ts.slice(start, end);
    const base = run.map((t) => t.base).filter(Boolean).pop() ?? null;
    // ("blue coloured" loses nothing either)
    const shades = run.filter((t, k) => !COLOURED.has(ws[start + k]));
    out.push({ start, end, phrase: ws.slice(start, end).join(' '), base, plain: shades.length === 1 && shades[0].plain });
    i = end - 1;
  }
  return out;
}

// any colour named at all
export const namesColour = (ws: string[]) => colourPhrases(ws).length > 0;
// a word that belongs to a colour phrase on its own ("hellblau", "crimson")
export const isColourWord = (w: string) => {
  const t = token(w);
  return !!t.base || t.own;
};

// What the player is told when the colour helper (the model) didn't answer
// and the base colours were used instead, or null when nothing was lost.
export function fallbackNote(phrases: ColourPhrase[]): string | null {
  const lost = phrases.filter((p) => !p.plain);
  if (!lost.length) return null;
  const said = (p: ColourPhrase) => (p.base ? `your ${p.phrase} came out as regular ${p.base === 'gray' ? 'grey' : p.base}` : `the ${p.phrase.replace(/\s+(coloured|colored|colour|color)$/, '')} colours couldn't be mixed and it kept its own colours`);
  const list = lost.map(said);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
  return `My colour helper didn't answer, so ${joined}.`;
}
