// ---------------------------------------------------------------------------
// The words the game knows on its own, for when the model can't read a
// prompt (readPrompt.ts's local fallback), and a small reader that finds a
// prompt's main object and the words it doesn't know.
//
// Known words: the playtest's three themed lists (src/data/lexicon/*.json,
// built by scripts/build-lexicon.py: ships, watering tools, pets — each word
// with its kind: object / part / detail / style / material), the reference
// library's words, the crafting vocabulary (vocab.ts) and the colour words
// of every language colours.ts reads.
//
// Reading (promptParts):
//   1. multi-word names become one token ("watering can", "golden
//      retriever", "crow's nest")
//   2. what isn't about the look is dropped: relative clauses ("that can
//      fly"), "to + verb", a modal verb after a pronoun
//   3. the main object is the head of the first phrase: the last object
//      word before "with / and / on / in / for / of / made"; describing
//      words (colours, sizes, styles, materials, adjective endings) skipped
// scripts/test-main-noun.mjs measures it on themed sample prompts.
// ---------------------------------------------------------------------------
import { BODY_PARTS, LOOKUPS, NOUN_CATEGORY, NOUN_SYNONYMS, SHAPE_WORDS, STOPWORDS, NUMBER_WORDS } from './vocab';
import { BASE, typoDistance } from './colours';
import { libraryWords } from './refCraft';
import shipsWords from '../data/lexicon/ships.json';
import wateringWords from '../data/lexicon/watering.json';
import petsWords from '../data/lexicon/pets.json';

export type Theme = 'ships' | 'watering' | 'pets';
export type WordKind = 'object' | 'part' | 'detail' | 'style' | 'material' | 'colour' | 'size' | 'other';
interface Entry {
  kind: WordKind;
  themes: Theme[];
  objectIn: Theme[]; // the themes it is a craftable object in ("dragon": pets, not ships)
}
const THEMED: [Theme, { word: string; kind: string }[]][] = [
  ['ships', shipsWords],
  ['watering', wateringWords],
  ['pets', petsWords],
];

let lex: { words: Map<string, Entry>; maxPhrase: number; filler: Set<string> } | null = null;

function build() {
  const words = new Map<string, Entry>();
  const add = (w: string, kind: WordKind, theme?: Theme) => {
    const key = w.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key.length < 2) return;
    const e = words.get(key);
    if (!e) words.set(key, { kind, themes: theme ? [theme] : [], objectIn: theme && kind === 'object' ? [theme] : [] });
    else {
      if (theme && kind === 'object' && !e.objectIn.includes(theme)) e.objectIn.push(theme);
      // a colour or size word stays one; an object beats a describing kind
      if (e.kind === 'other' || (kind === 'object' && e.kind !== 'colour' && e.kind !== 'size')) e.kind = kind;
      if (theme && !e.themes.includes(theme)) e.themes.push(theme);
    }
  };
  for (const [theme, list] of THEMED) for (const { word, kind } of list) add(word, kind as WordKind, theme);
  // the multi-word names' single words count as known too
  for (const key of [...words.keys()]) if (key.includes(' ')) for (const p of key.split(' ')) if (p.length >= 3 && !words.has(p)) add(p, 'other');
  const lib = libraryWords();
  lib.known.forEach((w) => add(w, 'other'));
  Object.keys(NOUN_CATEGORY).forEach((w) => add(w, 'object'));
  [...Object.keys(NOUN_SYNONYMS), ...Object.values(NOUN_SYNONYMS)].forEach((w) => add(w, 'object'));
  [...BODY_PARTS].forEach((w) => add(w, 'part'));
  [...Object.keys(SHAPE_WORDS), ...Object.keys(NUMBER_WORDS)].forEach((w) => add(w, 'style'));
  for (const [dim, table] of Object.entries(LOOKUPS)) {
    const k: WordKind = dim === 'color' ? 'colour' : dim === 'size' ? 'size' : dim === 'material' ? 'material' : 'style';
    for (const [w, canon] of Object.entries(table)) {
      add(w, k);
      add(canon, k);
    }
  }
  Object.keys(BASE).forEach((w) => add(w, 'colour'));
  lib.sizes.forEach((w) => add(w, 'size'));
  // colours and sizes always keep their kind
  for (const w of Object.keys(BASE)) words.get(w)!.kind = 'colour';
  for (const w of lib.sizes) words.get(w)!.kind = 'size';
  let maxPhrase = 1;
  for (const k of words.keys()) maxPhrase = Math.max(maxPhrase, k.split(' ').length);
  return { words, maxPhrase: Math.min(maxPhrase, 5), filler: new Set([...lib.filler, ...STOPWORDS]) };
}
const lexicon = () => (lex ??= build());

const sing = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
function entryOf(w: string): Entry | null {
  const l = lexicon().words;
  return l.get(w) ?? l.get(sing(w)) ?? (w.endsWith('es') ? (l.get(w.slice(0, -2)) ?? null) : null);
}

// a word or name the game knows, or one never asked about (filler, numbers)
export function isKnownWord(w: string): boolean {
  const lw = w.toLowerCase();
  return lw.length < 3 || /\d/.test(lw) || lexicon().filler.has(lw) || !!entryOf(lw);
}
export const kindOf = (w: string): WordKind | null => entryOf(w.toLowerCase())?.kind ?? null;
export const themesOf = (w: string): Theme[] => entryOf(w.toLowerCase())?.themes ?? [];
// the theme a word is an object of (else any theme it belongs to)
export const themeOfObject = (w: string): Theme | null => {
  const e = entryOf(w.toLowerCase());
  return e?.objectIn[0] ?? e?.themes[0] ?? null;
};

// the n known words (or names) spelled closest to `w`; `kinds` limits the
// search (the closest object); ties: the same first letter, then a colour
// or size word (a typo there is the commonest)
export function closestWords(w: string, n = 1, kinds?: WordKind[]): string[] {
  const lw = w.toLowerCase();
  const scored: { word: string; d: number; tie: number }[] = [];
  for (const [word, e] of lexicon().words) {
    if (word.length < 3 || Math.abs(word.length - lw.length) > 4 || (kinds && !kinds.includes(e.kind))) continue;
    const d = typoDistance(lw, word);
    scored.push({ word, d, tie: (word[0] === lw[0] ? 0 : 2) + (e.kind === 'colour' || e.kind === 'size' ? 0 : 1) });
  }
  scored.sort((a, b) => a.d - b.d || a.tie - b.tie || a.word.localeCompare(b.word));
  return scored.slice(0, n).map((s) => s.word);
}

// ---- reading a prompt ----------------------------------------------------------
const SPLIT = new Set(['with', 'and', 'on', 'in', 'for', 'of', 'made', 'shaped', 'like', 'looking', 'wearing', 'mit', 'und', 'avec', 'con', 'met', 'en', 'auf', 'wie']);
const RELATIVE = new Set(['that', 'which', 'who', 'whose', 'welche', 'welcher', 'welches', 'qui', 'que', 'che']);
const PRONOUNS = new Set(['it', 'i', 'you', 'he', 'she', 'they', 'we', 'er', 'sie', 'es']);
const MODALS = new Set(['can', 'could', 'will', 'would', 'should', 'may', 'might', 'kann', 'könnte', 'koennte']);
const ARTICLES = new Set(['a', 'an', 'the', 'some', 'my', 'your', 'ein', 'eine', 'einen', 'der', 'die', 'das', 'un', 'une', 'le', 'la', 'les', 'el', 'los', 'las', 'il', 'lo', 'een', 'het', 'de']);
const ADJ_END = /(y|ish|ful|less|ous|ed|ing|al|ic|ive|ey|ig|lich|isch)$/;

const tokensOf = (prompt: string) => prompt.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu)?.map((t) => t.replace(/’/g, "'")) ?? [];

// multi-word names first: the longest known phrase at each position
function mergePhrases(ws: string[]): string[] {
  const { words, maxPhrase } = lexicon();
  const out: string[] = [];
  for (let i = 0; i < ws.length; ) {
    let took = 1;
    for (let n = Math.min(maxPhrase, ws.length - i); n > 1; n--) {
      const ph = ws.slice(i, i + n).join(' ');
      if (words.has(ph)) {
        took = n;
        break;
      }
    }
    out.push(ws.slice(i, i + took).join(' '));
    i += took;
  }
  return out;
}

// what isn't about the look: relative clauses up to the next "with/and",
// "to + verb", a modal verb after a pronoun
function dropNonLook(ts: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (RELATIVE.has(t)) {
      while (i + 1 < ts.length && ts[i + 1] !== 'with' && ts[i + 1] !== 'and' && ts[i + 1] !== 'mit' && ts[i + 1] !== 'und') i++;
      continue;
    }
    if (t === 'to' && i + 1 < ts.length && !entryOf(ts[i + 1])?.kind.match(/object|part|detail/)) {
      i++;
      continue;
    }
    if (MODALS.has(t) && (PRONOUNS.has(ts[i - 1]) || i === 0)) {
      if (i + 1 < ts.length) i++; // the verb after it too
      continue;
    }
    out.push(t);
  }
  return out;
}

const describing = (t: string) => {
  const e = entryOf(t);
  if (e) return e.kind === 'colour' || e.kind === 'size' || e.kind === 'style' || e.kind === 'material';
  return ADJ_END.test(t) && t.length > 4;
};

export interface PromptParts {
  main: string | null; // the main object, as read (a name stays whole)
  mainKnown: boolean;
  others: string[]; // the other content words / names
  unknown: string[]; // content words the game doesn't know (main included)
  content: number; // how many content words there are
  theme: Theme | null; // the theme the prompt is closest to
}
export function promptParts(prompt: string): PromptParts {
  const l = lexicon();
  const ts = dropNonLook(mergePhrases(tokensOf(prompt)));
  const content = ts.filter((t) => !ARTICLES.has(t) && !SPLIT.has(t) && !STOPWORDS.has(t) && t.length >= 2);
  const cut = ts.findIndex((t) => SPLIT.has(t));
  const head = (cut >= 0 ? ts.slice(0, cut) : ts).filter((t) => content.includes(t));
  // the head: the last object word, else the last word that isn't describing
  let main: string | null = null;
  for (let i = head.length - 1; i >= 0 && !main; i--) if (entryOf(head[i])?.kind === 'object') main = head[i];
  for (let i = head.length - 1; i >= 0 && !main; i--) if (!describing(head[i])) main = head[i];
  if (!main && head.length) main = head[head.length - 1];
  const unknown = content.filter((t) => !l.filler.has(t) && !isKnownWord(t));
  const others = content.filter((t) => t !== main);
  // the theme: the main object's, else the most hits among the words
  const count: Record<Theme, number> = { ships: 0, watering: 0, pets: 0 };
  for (const t of content) for (const th of themesOf(t)) count[th] += 1;
  const best = (Object.entries(count) as [Theme, number][]).sort((a, b) => b[1] - a[1])[0];
  const mainTheme = main ? (entryOf(main)?.objectIn[0] ?? null) : null;
  const theme = mainTheme ?? (best[1] > 0 ? best[0] : null);
  return { main, mainKnown: !!main && isKnownWord(main), others, unknown, content: content.length, theme };
}

// The prompt read as closely as the known words allow, for the "did you
// mean" of a prompt that's mostly unreadable: each unknown word becomes its
// closest known word when it's only a typo away (one letter, two in long
// words), else it's dropped ("a gree dragon with wngs" -> "a green dragon
// with wings", "zxq blorp boat" -> "boat"). null when no object is left.
export function closestReading(prompt: string): { text: string; main: string; theme: Theme | null } | null {
  const out: string[] = [];
  for (const t of tokensOf(prompt)) {
    if (isKnownWord(t) || ARTICLES.has(t) || SPLIT.has(t)) {
      out.push(t);
      continue;
    }
    const [c] = closestWords(t, 1);
    if (c && typoDistance(t, c) <= (t.length >= 7 ? 2 : 1)) out.push(c);
  }
  // no dangling "with" / articles at the end
  while (out.length && (SPLIT.has(out[out.length - 1]) || ARTICLES.has(out[out.length - 1]))) out.pop();
  const text = out.join(' ');
  const parts = promptParts(text);
  if (!parts.main || !parts.mainKnown || kindOf(parts.main) !== 'object') return null;
  return { text, main: parts.main, theme: themeOfObject(parts.main) ?? parts.theme };
}
