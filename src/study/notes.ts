// Reading the session notes and merging a newer version into the stored
// statements without losing any tag.
//
// The notes: one file, one block per participant. A block starts at a line
// naming a participant id ("P007", "# P007", "ID: P007", "Teilnehmer: P7",
// "P009.2") and everything up to the next id belongs to that person. Its
// header fields come in any order, labelled ("Name: …", "Link: …",
// "Zeit: …", "Gruppe: …") or not (then told apart by their content: AB/BA,
// a link, a time or date, else the name):
//   ## During Usertesting     what was observed during play
//   - statement …
//   ## Follow-up              the questions asked afterwards and the answers
//   - Question?               (a line ending in "?", or "F:"/"Q:"/"Frage:")
//     - answer …              its answers keep the question as context
// The same id twice (one block per link) is one participant.
import type { ItemDoc, NotesMeta, Section } from './types';
import type { Model } from './model';

export interface Parsed {
  meta: NotesMeta[]; // in file order
  statements: Omit<ItemDoc, 'id' | 'chips' | 'suggested'>[];
}

const BARE_ID = /^(P\s*-?\s*\d{1,4})(?:\.(\d))?(?![\d.])\s*(?:[-–:|,]\s*(.*))?$/i;
const LABELLED_ID = /^(?:p-?id|id|teilnehmer(?:in)?|teilnehmende[rs]?|participant|proband(?:in)?|tn)\s*(?:nr\.?)?\s*[:#.\-–]?\s*(P?\s*-?\s*\d{1,4})(?:\.(\d))?(?![\d.])\s*(?:[-–:|,]\s*(.*))?$/i;
const HEADING = /^\s*#{1,6}\s*(.+?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*•–]|\d+[.)])\s+(.*)$/;
const QUESTION_PREFIX = /^(?:f|q|frage|question)\s*\d*\s*[:.)]\s*/i;
const ANSWER_PREFIX = /^(?:a|antwort|answer)\s*\d*\s*[:.)]\s*/i;
const FIELD = /^(name|link|zeit|uhrzeit|time ?slot|slot|termin|datum|date|gruppe|test ?gruppe|test ?group|group|reihenfolge|order)\s*[:=]\s*(.*)$/i;
const GROUP = /^(?:(?:test\s*)?(?:gruppe|group|reihenfolge)\s*:?\s*)?([AB])\s*(?:→|->|\/|-|–|\s)?\s*([AB])$/i;
const LINKLIKE = /https?:|\/intro\/|[?&]k=|^link\b|^P\d+\.\d$/i;
const SLOTLIKE = /\d{1,2}[:.]\d{2}|\d{1,2}\s*[-–]\s*\d{1,2}\s*uhr|\buhr\b|\b\d{1,2}\.\d{1,2}\.|\b(mo|di|mi|do|fr|sa|so)(ntag|nstag|ttwoch|nnerstag|eitag|mstag)?\b\.?\s*\d|\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i;

const pid = (s: string) => `P${s.replace(/\D/g, '').padStart(3, '0')}`;
const clean = (raw: string) => raw.replace(/^\s*#{0,6}\s*/, '').replace(/^\*+|\*+$/g, '').replace(/^[-*•]\s+/, '').trim();

function sectionOf(title: string): Section | null {
  const t = title.toLowerCase();
  if (/during|währ|waehr|beobacht|usertest|test\b|observ/.test(t)) return 'during';
  if (/follow|nachgespr|nachfrag|interview|fragen|questions|debrief/.test(t)) return 'followup';
  return null;
}

// a participant id line: the id, a link suffix (P009.2), and what follows it
function idOf(raw: string, inSection: boolean): { id: string; sub?: string; rest: string } | null {
  const l = clean(raw);
  const lab = LABELLED_ID.exec(l);
  // (a bare id as a bullet inside a section is part of a statement)
  const bare = !(inSection && BULLET.test(raw)) ? BARE_ID.exec(l) : null;
  const m = lab ?? bare;
  if (!m || (m[3] ?? '').length > 60) return null;
  return { id: pid(m[1]), sub: m[2], rest: m[3] ?? '' };
}

type Field = 'name' | 'link' | 'slot' | 'group';
function fieldOf(label: string): Field {
  const k = label.toLowerCase();
  return k === 'name' ? 'name' : k === 'link' ? 'link' : /gruppe|group|reihenfolge|order/.test(k) ? 'group' : 'slot';
}
// a labelled field inside a section only counts when its value looks like one
function plausible(f: Field, v: string): boolean {
  if (f === 'group') return GROUP.test(v.trim()) || /^(AB|BA)$/i.test(v.trim());
  if (f === 'link') return LINKLIKE.test(v.trim()) || /^\d$/.test(v.trim());
  if (f === 'slot') return /\d/.test(v);
  return v.length <= 40 && !/[.!?]$/.test(v);
}
const groupOf = (v: string) => {
  const g = GROUP.exec(v.trim());
  return g ? `${g[1]}${g[2]}`.toUpperCase() : v.trim().toUpperCase();
};

interface Block {
  meta: NotesMeta;
  header: string[]; // unlabelled lines outside the sections
  link: string; // this block's link (one person may have a block per link)
  statements: Parsed['statements'];
}

export function parseNotes(text: string): Parsed {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const metas = new Map<string, NotesMeta>();
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let section: Section | null = null;
  let question: string | undefined;
  let last: Parsed['statements'][number] | null = null;
  let lastIndent = 0;
  let order = 0;

  const setField = (b: Block, f: Field, v: string) => {
    const val = f === 'group' ? groupOf(v) : v.trim();
    if (!val) return;
    if (f === 'link') b.link ||= val;
    if (!b.meta[f]) b.meta[f] = val;
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const idm = idOf(raw, !!section);
    if (idm) {
      const meta = metas.get(idm.id) ?? { id: idm.id, name: '', link: '', slot: '', group: '' };
      metas.set(idm.id, meta);
      cur = { meta, header: [], link: idm.sub ? `${idm.id}.${idm.sub}` : '', statements: [] };
      if (idm.rest) cur.header.push(idm.rest);
      blocks.push(cur);
      section = null;
      question = undefined;
      last = null;
      continue;
    }
    if (!cur) continue;
    const h = HEADING.exec(raw);
    if (h) {
      const s = sectionOf(h[1]);
      if (s) {
        section = s;
        question = undefined;
        last = null;
        continue;
      }
    }
    // a labelled header field, wherever it is in the block
    const lab = FIELD.exec(clean(raw));
    if (lab && (!section || plausible(fieldOf(lab[1]), lab[2]))) {
      setField(cur, fieldOf(lab[1]), lab[2]);
      continue;
    }
    if (!section) {
      cur.header.push(clean(raw));
      continue;
    }
    if (h && section === 'followup') {
      question = h[1].replace(QUESTION_PREFIX, '').trim();
      last = null;
      continue;
    }
    const b = BULLET.exec(raw);
    const indent = b ? b[1].replace(/\t/g, '  ').length : (raw.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0);
    let body = (b ? b[3] : raw).trim();
    // a Follow-up question: not a statement, the context of what follows
    if (section === 'followup' && (QUESTION_PREFIX.test(body) || (/\?\s*$/.test(body) && !ANSWER_PREFIX.test(body)))) {
      question = body.replace(QUESTION_PREFIX, '').trim();
      last = null;
      continue;
    }
    body = body.replace(ANSWER_PREFIX, '').trim();
    // a continuation line of the statement before
    if (!b && last && indent > lastIndent) {
      last.text += ` ${body}`;
      continue;
    }
    if (!body) continue;
    last = { person: cur.meta.id, section, question: section === 'followup' ? question : undefined, text: body, order: order++ };
    lastIndent = indent;
    cur.statements.push(last);
  }

  // the unlabelled header lines: by content, the rest by position
  for (const b of blocks) {
    const left: string[] = [];
    for (const l of b.header) {
      if (!l) continue;
      if (GROUP.test(l)) setField(b, 'group', l);
      else if (LINKLIKE.test(l)) setField(b, 'link', l);
      else if (SLOTLIKE.test(l)) setField(b, 'slot', l);
      else left.push(l);
    }
    for (const l of left) {
      const f = (['name', 'link', 'slot', 'group'] as Field[]).find((x) => !b.meta[x] && (x !== 'link' || !b.link));
      if (f) setField(b, f, l);
    }
    // a block's statements carry its link (resolved to P009.2 on import)
    for (const s of b.statements) if (b.link) s.link = b.link;
  }
  return { meta: [...metas.values()], statements: blocks.flatMap((b) => b.statements) };
}

// the header's link → the dashboard's link label (P009.2)
export function linkLabelOf(meta: NotesMeta, m: Model): string | undefined {
  const p = m.persons.find((x) => x.id === meta.id);
  if (!p || p.links.length < 2) return undefined;
  const l = meta.link;
  const key = /[?&]k=([\w-]+)/.exec(l)?.[1];
  if (key) return p.links.find((x) => x.key === key)?.label;
  const sub = /P\d+\.(\d)/i.exec(l)?.[1] ?? /link\s*(\d)/i.exec(l)?.[1] ?? (/^\d$/.test(l.trim()) ? l.trim() : null);
  return sub ? p.links.find((x) => x.label.endsWith(`.${sub}`))?.label : undefined;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function similarity(a: string, b: string): number {
  const x = new Set(norm(a).split(' ').filter(Boolean));
  const y = new Set(norm(b).split(' ').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export interface MergeResult {
  put: ItemDoc[];
  kept: number;
  changed: number;
  added: number;
  removed: number;
}
// a newer notes file against the stored statements: unchanged ones keep
// everything, edited ones keep their tags (marked "geändert"), new ones
// come in empty, missing ones are marked "entfernt" (deleted on confirm)
export function mergeStatements(parsed: Parsed['statements'], existing: ItemDoc[], persons: Set<string>): MergeResult {
  const pool = existing.filter((i) => !i.manual && i.section !== 'survey' && persons.has(i.person));
  const used = new Set<string>();
  const put: ItemDoc[] = [];
  let kept = 0;
  let changed = 0;
  let added = 0;
  const firstImport = !pool.length;
  const pending: Parsed['statements'] = [];
  // exact matches first, so a moved line never steals an edited one's tags
  for (const s of parsed) {
    const hit = pool.find((i) => !used.has(i.id) && i.person === s.person && i.section === s.section && norm(i.text) === norm(s.text));
    if (hit) {
      used.add(hit.id);
      kept++;
      put.push({ ...hit, order: s.order, question: s.question, link: s.link ?? hit.link, status: hit.status === 'removed' || hit.status === 'new' ? undefined : hit.status });
    } else pending.push(s);
  }
  for (const s of pending) {
    let best: ItemDoc | null = null;
    let score = 0.5;
    for (const i of pool) {
      if (used.has(i.id) || i.person !== s.person || i.section !== s.section) continue;
      const v = similarity(i.text, s.text);
      if (v > score) {
        score = v;
        best = i;
      }
    }
    if (best) {
      used.add(best.id);
      changed++;
      // (its German version, interpretation and addition stay; the German one is marked to check)
      put.push({ ...best, text: s.text, order: s.order, question: s.question, link: s.link ?? best.link, status: 'changed', confirmed: false, deStale: !!best.de });
    } else {
      added++;
      const id = `n-${s.person}-${hash(`${s.section}|${norm(s.text)}|${s.order}|${Date.now()}`)}`;
      put.push({ ...s, id, original: s.text, chips: [], suggested: [], status: firstImport ? undefined : 'new' });
    }
  }
  let removed = 0;
  for (const i of pool)
    if (!used.has(i.id) && i.status !== 'removed') {
      removed++;
      put.push({ ...i, status: 'removed' });
    }
  return { put, kept, changed, added, removed };
}
