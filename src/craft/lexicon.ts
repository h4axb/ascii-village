// ---------------------------------------------------------------------------
// The words the game knows on its own, for when the model can't read a
// prompt (readPrompt.ts's local fallback): the reference library's words
// (titles, parts, tags, names, ship and dog words), the crafting
// vocabulary (nouns, body parts, shape words, colours, sizes, materials,
// patterns, finishes, moods, styles) and the colour words of every
// language colours.ts reads. A word outside it is unknown; the
// pre-clarification then offers the two closest known words to choose
// from (llm.ts preQuestions).
// ---------------------------------------------------------------------------
import { BODY_PARTS, LOOKUPS, NOUN_CATEGORY, NOUN_SYNONYMS, SHAPE_WORDS, STOPWORDS, NUMBER_WORDS } from './vocab';
import { BASE, typoDistance } from './colours';
import { libraryWords } from './refCraft';

export type WordKind = 'colour' | 'size' | 'other';
let lex: { kind: Map<string, WordKind>; filler: Set<string> } | null = null;

function build() {
  const kind = new Map<string, WordKind>();
  const add = (w: string, k: WordKind) => {
    for (const p of w.toLowerCase().split(/[\s_-]+/)) if (p.length >= 2 && /^[a-z]+$/.test(p) && (!kind.has(p) || k !== 'other')) kind.set(p, k);
  };
  const lib = libraryWords();
  lib.known.forEach((w) => add(w, 'other'));
  [...Object.keys(NOUN_CATEGORY), ...Object.keys(NOUN_SYNONYMS), ...Object.values(NOUN_SYNONYMS), ...BODY_PARTS, ...Object.keys(SHAPE_WORDS), ...Object.keys(NUMBER_WORDS)].forEach((w) => add(w, 'other'));
  for (const [dim, table] of Object.entries(LOOKUPS)) {
    const k: WordKind = dim === 'color' ? 'colour' : dim === 'size' ? 'size' : 'other';
    for (const [w, canon] of Object.entries(table)) {
      add(w, k);
      add(canon, k);
    }
  }
  Object.keys(BASE).forEach((w) => add(w, 'colour'));
  lib.sizes.forEach((w) => add(w, 'size'));
  return { kind, filler: new Set([...lib.filler, ...STOPWORDS]) };
}
const lexicon = () => (lex ??= build());

const sing = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
// a word the game knows, or one never asked about (filler, numbers, short)
export function isKnownWord(w: string): boolean {
  const l = lexicon();
  const lw = w.toLowerCase();
  return lw.length < 3 || /\d/.test(lw) || l.filler.has(lw) || l.kind.has(lw) || l.kind.has(sing(lw)) || (lw.endsWith('es') && l.kind.has(lw.slice(0, -2)));
}
export const kindOf = (w: string): WordKind | null => lexicon().kind.get(w.toLowerCase()) ?? null;

// the n known words spelled closest to `w`; ties: the same first letter,
// then a colour or size word (a typo there is the commonest)
export function closestWords(w: string, n = 2): string[] {
  const lw = w.toLowerCase();
  const scored: { word: string; d: number; tie: number }[] = [];
  for (const [word, k] of lexicon().kind) {
    if (word.length < 3 || Math.abs(word.length - lw.length) > 4) continue;
    const d = typoDistance(lw, word);
    scored.push({ word, d, tie: (word[0] === lw[0] ? 0 : 2) + (k === 'other' ? 1 : 0) });
  }
  scored.sort((a, b) => a.d - b.d || a.tie - b.tie || a.word.localeCompare(b.word));
  return scored.slice(0, n).map((s) => s.word);
}

// The prompt's main object and the words around it: the main object is the
// last word before the first "with / and / that / in / on / for" that isn't
// a colour, size or other describing word; words after "that / which /
// can / who" describe what it does and are never asked about.
const SPLIT = new Set(['with', 'and', 'in', 'on', 'for', 'of', 'mit', 'und']);
const FUNCTION = new Set(['that', 'which', 'who', 'lets', 'makes', 'named', 'called', 'welche', 'welcher']);
export function promptParts(prompt: string): { main: string | null; others: string[] } {
  const ws = prompt.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
  const fn = ws.findIndex((w) => FUNCTION.has(w));
  const body = fn >= 0 ? ws.slice(0, fn) : ws;
  const cut = body.findIndex((w) => SPLIT.has(w));
  const head = cut >= 0 ? body.slice(0, cut) : body;
  const tail = cut >= 0 ? body.slice(cut) : [];
  const l = lexicon();
  const content = (w: string) => !STOPWORDS.has(w) && !SPLIT.has(w) && w.length >= 2;
  const describing = (w: string) => {
    const k = l.kind.get(w) ?? l.kind.get(sing(w));
    return k === 'colour' || k === 'size' || !!LOOKUPS.material[w] || !!LOOKUPS.pattern[w] || !!LOOKUPS.finish[w] || !!LOOKUPS.mood[w] || !!LOOKUPS.style[w];
  };
  const headContent = head.filter(content);
  let mainIdx = -1;
  for (let i = headContent.length - 1; i >= 0; i--)
    if (!describing(headContent[i])) {
      mainIdx = i;
      break;
    }
  const main = mainIdx >= 0 ? headContent[mainIdx] : null;
  const others = [...headContent.filter((_, i) => i !== mainIdx), ...tail.filter(content)];
  return { main, others };
}
