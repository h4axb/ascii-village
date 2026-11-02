// Pseudonymising the exports: every file the dashboard hands out goes through
// here, so no participant's name leaves it. Names are known from the notes
// header (NotesMeta.name) and from the survey's name columns; each one, and
// each of its parts (first name, surname), is replaced by "[Name]" wherever it
// appears: statements, interpretations, survey answers, game records, file
// names. Free-text fields that hold who someone is (an invite's note, the
// survey's name / e-mail / phone columns) are emptied outright.
import type { NotesMeta, StudyDocs, TallyDoc } from './types';

export const NAME_MARK = '[Name]';

// survey columns that identify a person
const PERSONAL_COLUMN = /\b(vor-?|nach-?|full\s*|first\s*|last\s*|sur)?name\b|wie hei(ß|ss)t du|e-?mail|telefon|phone|handy|kontakt|contact|adresse|address/i;
export const personalColumns = (headers: string[]) => headers.flatMap((h, i) => (PERSONAL_COLUMN.test(h) ? [i] : []));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the names to remove, longest first (so "Anna Berg" goes before "Anna")
export function knownNames(docs: StudyDocs): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const n = String(v ?? '').trim();
    if (n.length < 2) return;
    out.add(n);
    // the parts of a full name; short ones ("Li", "von") would hit ordinary words
    for (const p of n.split(/[\s,;/]+/)) if (p.length >= 3 && !/^(von|van|der|den|de|du|la|le|zu)$/i.test(p)) out.add(p);
  };
  for (const m of Object.values((docs.settings.notesMeta ?? {}) as Record<string, NotesMeta>)) add(m.name);
  for (const t of Object.values(docs.tally)) {
    // only a short name question's answers count as names (not "Kontakt" or an item's name)
    const cols = personalColumns(t.headers).filter((i) => t.headers[i].length <= 40 && !/mail|telefon|phone|handy|kontakt|contact|adresse|address|item|objekt|gegenstand/i.test(t.headers[i]));
    for (const r of t.rows) for (const i of cols) add(r[i]);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

// one pattern for all names: whole words only, any case, with a possessive s ("Annas", "Jonas'")
export function namePattern(names: string[]): RegExp | null {
  if (!names.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join('|')})(?:['’]s|['’]|s)?(?![\\p{L}\\p{N}])`, 'giu');
}

export function scrubText(text: string, re: RegExp | null): string {
  return re ? text.replace(re, NAME_MARK) : text;
}

// every string inside a value (keys included), names replaced
export function scrubDeep<T>(v: T, re: RegExp | null): T {
  if (!re) return v;
  if (typeof v === 'string') return scrubText(v, re) as T;
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, re)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [scrubText(k, re), scrubDeep(x, re)])) as T;
  return v;
}

// the survey without its identifying columns (the cells emptied, the columns kept)
export function scrubTally(t: TallyDoc): TallyDoc {
  const cols = new Set(personalColumns(t.headers));
  if (!cols.size) return t;
  return { ...t, rows: t.rows.map((r) => r.map((c, i) => (cols.has(i) && c.trim() ? '[entfernt]' : c))) };
}

// the study's documents ready for an export: no notes, no name in the header,
// the survey's personal columns emptied, every name replaced
export function pseudonymDocs(docs: StudyDocs, re = namePattern(knownNames(docs))): Omit<StudyDocs, 'notes'> {
  const { notesMeta, ...settings } = docs.settings as Record<string, unknown>;
  const meta = Object.fromEntries(Object.entries((notesMeta ?? {}) as Record<string, NotesMeta>).map(([id, m]) => {
    const { name: _name, ...rest } = m;
    return [id, rest];
  }));
  const { notes: _notes, ...rest } = docs;
  const tally = Object.fromEntries(Object.entries(rest.tally).map(([id, t]) => [id, scrubTally(t)]));
  return scrubDeep({ ...rest, tally, settings: { ...settings, notesMeta: meta } }, re);
}

// an invite without the note the test lead wrote on it (often the person's name)
export const withoutNote = <I extends { note: string }>(i: I): I => ({ ...i, note: '' });

// a list of files, all scrubbed (names inside and in the file names)
export const scrubFiles = (files: { name: string; text: string }[], re: RegExp | null) => files.map((f) => ({ name: scrubText(f.name, re), text: scrubText(f.text, re) }));
