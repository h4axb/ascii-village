// ---------------------------------------------------------------------------
// Colour phrases in a crafting prompt, in any wording ("baby blue", "sky
// blue", "hellblauer", "bleu clair", "crimson", "the colour of the sea").
// Local and only for RECOGNISING them: the exact colours come from the model
// (llm.ts craftColours). Recognised, a colour phrase is never a leftover
// detail and the colour question isn't asked. When the model doesn't answer,
// each phrase falls back to its base colour word ("baby blue" -> blue).
// ---------------------------------------------------------------------------
import { PALETTE } from './vocab';
import { themeColor } from '../theme';

// base colour words in English, German, French, Spanish, Italian, Dutch
// (accents folded; Romance words by their stem, endings are stripped) -> a
// PALETTE key
export const BASE: Record<string, string> = {};
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

// ---- the game's palette ----------------------------------------------------
// A colour the AI chose (the colour call, the reference model's or the shape
// planner's "#rrggbb") brought into the game's soft palette: theme.json's
// colours mostly stay under about 0.65 HSV saturation and 0.9 brightness, so a neon
// answer (#ff0000, #00ff88) is eased down to that range. The hue stays, and
// greys / whites / blacks are left as they are.
const SAT_KNEE = 0.45; // saturation eased above this ...
const SAT_SOFT = 0.3; // ... by this much, so 1.0 lands at about 0.62
const VAL_MAX = 0.86;
const VAL_MIN = 0.18; // a coloured but nearly black answer still shows a hue
export function fitToGame([r, g, b]: [number, number, number]): [number, number, number] {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const s = mx ? (mx - mn) / mx : 0;
  if (s < 0.12) return [r, g, b];
  let h = 0;
  const d = mx - mn;
  const [R, G, B] = [r / 255, g / 255, b / 255];
  h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  const s2 = s > SAT_KNEE ? SAT_KNEE + (s - SAT_KNEE) * SAT_SOFT : s;
  const v2 = Math.min(VAL_MAX, Math.max(VAL_MIN, mx));
  const c = v2 * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v2 - c;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

// what the game's own colours look like, for the colour prompts: soft pixel
// art, never neon (the answers are eased into this range too, fitToGame)
export const gameColourHint = () =>
  `- The game is soft pixel art with muted, earthy colours, for example grass ${themeColor('grassTuft.base')}, sand ${themeColor('sand.glyph')}, ` +
  `water ${themeColor('water.base')}, a flower petal ${themeColor('flower.orangePetal')}, wood ${themeColor('palm.trunk')}. ` +
  'Pick colours that sit with these: never neon or fully saturated (no #ff0000, #00ff00, #ff00ff), a soft red is #c94a3c.';

// ---- typos in colour and size words (the local fallback of readPrompt.ts) --
// A word that isn't a colour itself but is one or two letters off a common
// colour or size word ("gree", "yelow", "smal", "purpel") is read as that word.
// Short words and common English words that happen to sit close to a colour
// ("queen", "crown", "glue", "cold") are never changed.
const TYPO_TARGETS = [
  'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'white', 'black', 'brown', 'grey', 'gray', 'gold', 'golden', 'silver',
  'violet', 'turquoise', 'rainbow', 'small', 'large', 'little', 'medium', 'giant', 'tiny', 'huge', 'viking',
];
const TYPO_KEEP = new Set([
  'queen', 'greet', 'greed', 'greek', 'grown', 'crown', 'drown', 'frown', 'brow', 'brows', 'glue', 'clue', 'true', 'blur', 'blues',
  'prey', 'pick', 'ink', 'mink', 'link', 'sink', 'wink', 'pine', 'pint', 'cold', 'bold', 'hold', 'told', 'fold', 'mold', 'goal',
  'gild', 'mall', 'smell', 'tall', 'ball', 'wall', 'call', 'fall', 'hall', 'small', 'barge', 'large', 'write', 'whine', 'while',
  'whale', 'whit', 'block', 'slack', 'back', 'blank', 'clack', 'black', 'tine', 'tin', 'hug', 'hue', 'tide', 'range', 'grange',
  'purse', 'people', 'giants', 'litter', 'kitten', 'mitten', 'brew', 'brain', 'grain', 'great', 'bike', 'king', 'grew', 'grow',
  'blew', 'blow', 'glow', 'flow', 'slow', 'below', 'yell', 'mellow', 'fellow', 'hollow', 'willow', 'pinky', 'tidy', 'tins',
]);
// edit distance with swapped neighbours counting once ("gerrn" -> green)
export function typoDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
// the word a typo stands for, or null
export function typoFix(w: string): string | null {
  const lw = w.toLowerCase();
  if (lw.length < 4 || TYPO_KEEP.has(lw) || TYPO_TARGETS.includes(lw) || token(lw).base || isModifier(lw)) return null;
  const max = lw.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  for (const t of TYPO_TARGETS) {
    if (Math.abs(t.length - lw.length) > max) continue;
    const dist = typoDistance(lw, t);
    if (dist < bestD) {
      best = t;
      bestD = dist;
    }
  }
  return best;
}
// the prompt with its colour / size typos fixed, and what was changed
export function fixTypos(prompt: string): { fixed: string; fixes: [string, string][] } {
  const fixes: [string, string][] = [];
  const fixed = prompt.replace(/[A-Za-zÀ-ÿ]+/g, (w) => {
    const f = typoFix(w);
    if (!f) return w;
    fixes.push([w, f]);
    return w[0] === w[0].toUpperCase() ? f[0].toUpperCase() + f.slice(1) : f;
  });
  return { fixed, fixes };
}
