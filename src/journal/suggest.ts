// Section and topic suggestions for an entry, by local rules only (nothing is
// sent anywhere): the entry type, and words in its title and content, in
// German or English. Only suggestions: the editor shows them to accept or
// ignore, and they never replace what was chosen by hand.
import { plainText } from './markdown';
import type { Entry, EntryType } from './types';

const BY_TYPE: Partial<Record<EntryType, string>> = { decision: 'decisions', method: 'methodology', reflection: 'personal', design: 'design', research: 'research', meeting: 'research' };

const SECTION_WORDS: Record<string, RegExp> = {
  decisions: /\b(decid\w*|decision\w*|entschied\w*|entscheid\w*|entschluss|chose|choose|gewählt|statt|instead|wir nehmen|beschlossen|A:)/i,
  methodology: /\b(method\w*|methodik|usertest\w*|nutzertest\w*|playtest\w*|interview\w*|tally|umfrage\w*|survey|codier\w*|coding|evaluat\w*|evaluier\w*|ueq|likert|hypothes\w*|stichprobe|sample|protokoll|workflow)\b/i,
  personal: /\b(reflect\w*|reflexion|gelernt|learned|learning|ich habe|my own|persönlich|personal|motivation|stress|habit|routine|workflow|improv\w*|verbesser\w*)\b/i,
  design: /\b(design\w*|gestalt\w*|ui|ux|layout|mockup|prototype?\w*|wireframe|animation\w*|anim|screen\w*|button\w*|icon\w*|font\w*|farbe\w*|colou?r\w*|sprite\w*|editor|cinematic\w*|intro|loading|interface|nutzerführung|feedback-?design)\b/i,
  research: /\b(research\w*|recherch\w*|finding\w*|befund\w*|ergebnis\w*|result\w*|studie\w*|study|quelle\w*|source\w*|literatur\w*|paper\w*|analyse\w*|analysis|data|daten|exposé|fragestellung|research question)\b/i,
};

// a few topics to start from; the journal's own topics come first
const BASE_TOPICS: [string, RegExp][] = [
  ['Crafting', /\bcraft\w*/i],
  ['Usertesting', /\b(usertest\w*|nutzertest\w*|playtest\w*|testperson\w*|participant\w*)/i],
  ['UI Design', /\b(ui|interface|button\w*|layout|icon\w*|screen\w*)\b/i],
  ['UX', /\b(ux|nutzerführung|usability|interaction\w*|interaktion\w*)\b/i],
  ['Intro', /\b(intro\w*|cinematic\w*|wake up|loading screen)\b/i],
  ['Character', /\b(character\w*|charakter\w*|mannequin|outfit|fit|clothing|kleidung)\b/i],
  ['AI / LLM', /\b(ai|ki|llm|generat\w*|prompt\w*|gemini|claude|gpt)\b/i],
  ['Editor', /\b(editor|marker\w*|scene markings)\b/i],
  ['Feedback design', /\b(pre-clarification|post-feedback|variante?\s?[ab]|feedback\s?design)\b/i],
  ['Thesis', /\b(bachelor\w*|thesis|exposé|expose|antrag|kolloquium)\b/i],
  ['Workflow', /\b(workflow|documentation|dokumentation|journal|memory)\b/i],
];

export const entryText = (e: Pick<Entry, 'title' | 'blocks'>) => plainText([e.title, ...e.blocks.map((b) => `${b.label} ${b.md}`)].join('\n'));

export function suggestSections(e: Pick<Entry, 'title' | 'blocks' | 'type' | 'sections'>): string[] {
  const text = entryText(e);
  const out = new Set<string>();
  const t = BY_TYPE[e.type];
  if (t) out.add(t);
  for (const [id, re] of Object.entries(SECTION_WORDS)) if (re.test(text)) out.add(id);
  return [...out].filter((s) => !e.sections.includes(s));
}

export function suggestTopics(e: Pick<Entry, 'title' | 'blocks' | 'topics'>, known: string[]): string[] {
  const text = entryText(e);
  const out = new Set<string>();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const k of known) if (new RegExp(`(?<![\\p{L}\\p{N}])${esc(k)}(?![\\p{L}\\p{N}])`, 'iu').test(text)) out.add(k);
  for (const [name, re] of BASE_TOPICS) if (re.test(text)) out.add(known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name);
  const have = new Set(e.topics.map((t) => t.toLowerCase()));
  return [...out].filter((t) => !have.has(t.toLowerCase())).slice(0, 8);
}
