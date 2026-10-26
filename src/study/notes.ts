// Reading the session notes and merging a newer version into the stored
// statements without losing any tag.
//
// The notes, one block per participant:
//   P007                      the participant id (a line of its own, "# P007" too)
//   Name                      ┐ the header lines, in this order, or labelled
//   Link                      │ ("Name: …", "Link: …", "Zeit: …", "Gruppe: …")
//   Time slot                 │
//   Test group (AB / BA)      ┘
//   ## During Usertesting     what was observed during play
//   - statement …
//   ## Follow-up              the questions asked afterwards and the answers
//   - Question?               (a line ending in "?", or "F:"/"Q:"/"Frage:")
//     - answer …              its answers keep the question as context
import type { ItemDoc, NotesMeta, Section } from './types';
import type { Model } from './model';

export interface Parsed {
  meta: NotesMeta[];
  statements: Omit<ItemDoc, 'id' | 'chips' | 'suggested'>[];
}

const ID_LINE = /^\s*#{0,3}\s*\**\s*(P\s*-?\s*\d{1,4})(?:\.(\d))?\s*\**\s*(?:[-–:|]\s*(.*))?$/i;
const HEADING = /^\s*#{1,6}\s*(.+?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*•–]|\d+[.)])\s+(.*)$/;
const QUESTION_PREFIX = /^(?:f|q|frage|question)\s*\d*\s*[:.)]\s*/i;
const ANSWER_PREFIX = /^(?:a|antwort|answer)\s*\d*\s*[:.)]\s*/i;

const pid = (s: string) => `P${s.replace(/\D/g, '').padStart(3, '0')}`;

function sectionOf(title: string): Section | null {
  const t = title.toLowerCase();
  if (/during|währ|waehr|beobacht|usertest|test\b|observ/.test(t)) return 'during';
  if (/follow|nachgespr|nachfrag|interview|fragen|questions|debrief/.test(t)) return 'followup';
  return null;
}

export function parseNotes(text: string): Parsed {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const meta: NotesMeta[] = [];
  const statements: Parsed['statements'] = [];
  let cur: NotesMeta | null = null;
  let header: string[] = [];
  let section: Section | null = null;
  let question: string | undefined;
  let last: Parsed['statements'][number] | null = null;
  let lastIndent = 0;
  let order = 0;

  const finishHeader = () => {
    if (!cur || !header.length) return;
    const rest: string[] = [];
    for (const raw of header) {
      const l = raw.replace(/^[-*•]\s*/, '').trim();
      const lab = /^(name|link|zeit|time ?slot|slot|termin|datum|gruppe|test ?gruppe|test ?group|group|reihenfolge)\s*[:=]\s*(.*)$/i.exec(l);
      if (lab) {
        const k = lab[1].toLowerCase();
        if (k === 'name') cur.name = lab[2];
        else if (k === 'link') cur.link = lab[2];
        else if (/gruppe|group|reihenfolge/.test(k)) cur.group = lab[2];
        else cur.slot = lab[2];
      } else rest.push(l);
    }
    // unlabelled: by content where it is clear, else by position
    const left: string[] = [];
    for (const l of rest) {
      if (!cur.group && /^(gruppe\s*)?(AB|BA)$/i.test(l)) cur.group = l.replace(/gruppe\s*/i, '');
      else if (!cur.link && /https?:|\/intro\/|[?&]k=|^link\b/i.test(l)) cur.link = l;
      else if (!cur.slot && /\d{1,2}[:.]\d{2}|\d{1,2}\.\d{1,2}\./.test(l)) cur.slot = l;
      else left.push(l);
    }
    for (const l of left) {
      if (!cur.name) cur.name = l;
      else if (!cur.link) cur.link = l;
      else if (!cur.slot) cur.slot = l;
      else if (!cur.group) cur.group = l;
    }
    header = [];
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const idm = ID_LINE.exec(raw);
    if (idm && !BULLET.test(raw) && (idm[3] ?? '').length < 60) {
      finishHeader();
      cur = { id: pid(idm[1]), name: '', link: idm[2] ? `${pid(idm[1])}.${idm[2]}` : '', slot: '', group: '' };
      if (idm[3]) header.push(idm[3]);
      meta.push(cur);
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
        finishHeader();
        section = s;
        question = undefined;
        last = null;
        continue;
      }
      if (section === 'followup') {
        question = h[1].replace(QUESTION_PREFIX, '').trim();
        last = null;
        continue;
      }
    }
    if (!section) {
      header.push(raw);
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
    last = { person: cur.id, link: cur.link && /^P\d+\.\d$/.test(cur.link) ? cur.link : undefined, section, question: section === 'followup' ? question : undefined, text: body, order: order++ };
    lastIndent = indent;
    statements.push(last);
  }
  finishHeader();
  return { meta, statements };
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
      put.push({ ...best, text: s.text, order: s.order, question: s.question, link: s.link ?? best.link, status: 'changed', confirmed: false });
    } else {
      added++;
      const id = `n-${s.person}-${hash(`${s.section}|${norm(s.text)}|${s.order}|${Date.now()}`)}`;
      put.push({ ...s, id, chips: [], suggested: [], status: firstImport ? undefined : 'new' });
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
