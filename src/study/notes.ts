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
//     - answer …              a question and all its answers are one point
// (headings with any number of #; "Follow Up", "Follow-up – Fragen", … all count)
// The same id twice (one block per link) is one participant.
import type { ItemDoc, NotesMeta, Section, StudyDocs } from './types';
import type { Change } from './changes';
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
  if (/follow|nachgespr|nachfrag|interview|fragen|questions|debrief/.test(t.replace(/[\s_-]+/g, ''))) return 'followup';
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
  let qPoint: Parsed['statements'][number] | null = null; // the current follow-up question's point
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
      qPoint = null;
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
        qPoint = null;
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
      qPoint = null;
      continue;
    }
    const b = BULLET.exec(raw);
    const indent = b ? b[1].replace(/\t/g, '  ').length : (raw.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0);
    let body = (b ? b[3] : raw).trim();
    // a Follow-up question: not a statement, the context of what follows
    if (section === 'followup' && (QUESTION_PREFIX.test(body) || (/\?\s*$/.test(body) && !ANSWER_PREFIX.test(body)))) {
      question = body.replace(QUESTION_PREFIX, '').trim();
      last = null;
      qPoint = null;
      continue;
    }
    body = body.replace(ANSWER_PREFIX, '').trim();
    // an answer to the current follow-up question: part of its one point
    if (section === 'followup' && question && body) {
      if (qPoint) {
        qPoint.text += !b && indent > lastIndent ? ` ${body}` : ` · ${body}`;
        continue;
      }
      qPoint = { person: cur.meta.id, section, question, text: body, order: order++ };
      last = qPoint;
      lastIndent = indent;
      cur.statements.push(qPoint);
      continue;
    }
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

// A notes file against what is stored, as changes to check (changes.ts):
// nothing already there is changed without asking. Only the participants in
// the file are looked at.
//   same wording (or the wording before an "Original korrigieren")  nothing
//   new statement                                                    neu
//   similar wording (≥ 50 % of the words)                            konflikt: keep / take the new / both
//   the same wording under another P-ID                              konflikt: keep / move it (all edits kept)
//   single follow-up answers that the file now has as one point      konflikt: keep / combine them
//   a stored statement no longer in the file                         konflikt: keep (default) / delete
//   other header fields (name, link, slot, group)                    konflikt
//   a new order of all participants                                  konflikt (a partial file keeps the order)
export function planNotes(parsed: Parsed, docs: StudyDocs, tags: (id: string) => string, file?: string, src = ''): Change[] {
  const out: Change[] = [];
  const persons = new Set(parsed.meta.map((m) => m.id));
  const all = Object.values(docs.items).filter((i) => i.section !== 'survey');
  const pool = all.filter((i) => !i.manual && persons.has(i.person));
  const used = new Set<string>();
  const firstImport = !all.some((i) => !i.manual);
  const same = (i: ItemDoc, text: string) => norm(i.text) === norm(text) || (!!i.original && norm(i.original) === norm(text));
  const note = (i: ItemDoc) => [i.chips.map(tags).filter(Boolean).join(', '), i.de ? `DE: ${i.de}` : '', i.finding ? 'mit Befund' : ''].filter(Boolean).join(' · ') || undefined;
  const freshItem = (st: Parsed['statements'][number]): ItemDoc => ({ ...st, id: `n-${st.person}-${hash(`${st.section}|${norm(st.text)}|${st.order}|${Date.now()}|${Math.random()}`)}`, original: st.text, chips: [], suggested: [], status: firstImport ? undefined : 'new' });
  const put = (w: StudyDocs, i: ItemDoc) => {
    w.items[i.id] = i;
  };
  const pending: Parsed['statements'] = [];
  // 1. the same wording, the same person: nothing to do
  for (const st of parsed.statements) {
    const hit = pool.find((i) => !used.has(i.id) && i.person === st.person && i.section === st.section && same(i, st.text));
    if (hit) used.add(hit.id);
    else pending.push(st);
  }
  const rest: Parsed['statements'] = [];
  for (const st of pending) {
    // 2. the same wording under another participant: move it?
    const moved = all.find((i) => !used.has(i.id) && !i.manual && i.person !== st.person && i.section === st.section && same(i, st.text));
    if (moved) {
      used.add(moved.id);
      out.push({
        id: `move:${moved.id}`,
        kind: 'konflikt',
        group: st.person,
        label: `Aussage steht bei ${moved.person}, in der Datei bei ${st.person}: verschieben?`,
        current: { text: moved.text, fields: [['Teilnehmende', moved.person]], note: note(moved) },
        incoming: { text: st.text, fields: [['Teilnehmende', st.person]], note: 'Tags, deutsche Fassung und Bearbeitungen bleiben' },
        choice: 'alt',
        apply: (c, w) => {
          if (c === 'neu') put(w, { ...w.items[moved.id], person: st.person, link: st.link, question: moved.questionOwn ? moved.question : st.question });
        },
      });
      continue;
    }
    // 3. a follow-up question's single answers, now one point
    if (st.section === 'followup' && st.question) {
      const singles = pool.filter((i) => !used.has(i.id) && i.person === st.person && i.section === 'followup' && i.question && norm(i.question) === norm(st.question!) && norm(st.text).includes(norm(i.text)));
      if (singles.length > 1 || (singles.length === 1 && norm(singles[0].text) !== norm(st.text))) {
        singles.forEach((i) => used.add(i.id));
        const [first, ...others] = singles.sort((a, b) => a.order - b.order);
        out.push({
          id: `combine:${first.id}`,
          kind: 'konflikt',
          group: st.person,
          label: `Nachgespräch „${st.question}“: ${singles.length} einzelne Antworten → ein Punkt`,
          current: { text: singles.map((i) => i.text).join('\n'), note: singles.map(note).filter(Boolean).join(' | ') || undefined },
          incoming: { text: st.text, note: 'Tags vereint, deutsche Fassungen zusammengeführt (zu prüfen)' },
          choice: 'alt',
          apply: (c, w) => {
            if (c !== 'neu') return;
            const cur = singles.map((i) => w.items[i.id] ?? i);
            const de = cur.map((i) => i.de).filter(Boolean).join(' · ');
            put(w, {
              ...cur[0],
              text: st.text,
              original: st.text,
              chips: [...new Set(cur.flatMap((i) => i.chips))],
              suggested: [...new Set(cur.flatMap((i) => i.suggested))],
              de: de || undefined,
              deStale: !!de,
              interpretation: cur.map((i) => i.interpretation).filter(Boolean).join(' · ') || undefined,
              addition: cur.map((i) => i.addition).filter(Boolean).join(' · ') || undefined,
              finding: cur.find((i) => i.finding)?.finding ?? null,
              confirmed: false,
              status: 'changed',
            });
            for (const o of others) delete w.items[o.id];
          },
        });
        continue;
      }
    }
    rest.push(st);
  }
  for (const st of rest) {
    // 4. similar wording: the stored text or the new one?
    let best: ItemDoc | null = null;
    let score = 0.5;
    for (const i of pool) {
      if (used.has(i.id) || i.person !== st.person || i.section !== st.section) continue;
      const v = similarity(i.text, st.text);
      if (v > score) {
        score = v;
        best = i;
      }
    }
    if (best) {
      const b = best;
      used.add(b.id);
      out.push({
        id: `edit:${b.id}`,
        kind: 'konflikt',
        group: st.person,
        label: `Geänderter Wortlaut${st.question ? ` („${st.question}“)` : ''}`,
        current: { text: b.text, note: note(b) },
        incoming: { text: st.text, note: 'Tags und Bearbeitungen bleiben; die deutsche Fassung wird zur Prüfung markiert' },
        both: true,
        choice: 'alt',
        apply: (c, w) => {
          if (c === 'neu') put(w, { ...w.items[b.id], text: st.text, status: 'changed', confirmed: false, deStale: !!b.de });
          if (c === 'beide') put(w, freshItem(st));
        },
      });
      continue;
    }
    // 5. new
    out.push({
      id: `new:${st.person}:${st.order}`,
      kind: 'neu',
      group: st.person,
      label: `Neue Aussage (${st.section === 'followup' ? 'Nachgespräch' : 'Beobachtung'})${st.question ? `: „${st.question}“` : ''}`,
      incoming: { text: st.text },
      choice: 'neu',
      apply: (c, w) => {
        if (c === 'neu') put(w, freshItem(st));
      },
    });
  }
  // 6. stored statements the file no longer has
  for (const i of pool)
    if (!used.has(i.id))
      out.push({
        id: `gone:${i.id}`,
        kind: 'konflikt',
        group: i.person,
        label: 'Nicht mehr in der Datei',
        current: { text: i.text, note: note(i) },
        choice: 'alt',
        apply: (c, w) => {
          if (c === 'neu') delete w.items[i.id];
        },
      });
  // 7. the participants' header fields
  const metas = (docs.settings.notesMeta ?? {}) as Record<string, NotesMeta>;
  const FIELDS: [keyof NotesMeta, string][] = [
    ['name', 'Name'],
    ['link', 'Link'],
    ['slot', 'Termin'],
    ['group', 'Gruppe'],
  ];
  for (const m of parsed.meta) {
    const old = metas[m.id];
    const take = (w: StudyDocs, v: NotesMeta) => {
      w.settings.notesMeta = { ...((w.settings.notesMeta ?? {}) as Record<string, NotesMeta>), [m.id]: v };
    };
    if (!old) {
      out.push({ id: `meta:${m.id}`, kind: 'neu', group: m.id, label: 'Neues Profil', incoming: { fields: FIELDS.map(([k, l]) => [l, String(m[k] ?? '')]) }, choice: 'neu', apply: (c, w) => c === 'neu' && take(w, m) });
      continue;
    }
    const diff = FIELDS.filter(([k]) => (m[k] ?? '') && (m[k] ?? '') !== (old[k] ?? ''));
    if (diff.length)
      out.push({
        id: `meta:${m.id}`,
        kind: 'konflikt',
        group: m.id,
        label: `Profil: ${diff.map(([, l]) => l).join(', ')} geändert`,
        current: { fields: FIELDS.map(([k, l]) => [l, String(old[k] ?? '')]) },
        incoming: { fields: FIELDS.map(([k, l]) => [l, String((m[k] || old[k]) ?? '')]) },
        choice: 'alt',
        apply: (c, w) => c === 'neu' && take(w, { ...old, ...Object.fromEntries(diff.map(([k]) => [k, m[k]])) }),
      });
  }
  // 8. the order of the participants (pairs the survey rows without an id)
  const stored = ((docs.settings.notesOrder as { ids?: string[] } | undefined)?.ids ?? []) as string[];
  const fileOrder = parsed.meta.map((m) => m.id);
  const appended = [...stored, ...fileOrder.filter((id) => !stored.includes(id))];
  const full = stored.length > 0 && stored.every((id) => persons.has(id));
  if (full && fileOrder.join() !== stored.join())
    out.push({
      id: 'order',
      kind: 'konflikt',
      group: 'Reihenfolge',
      label: 'Reihenfolge der Teilnehmenden in der Datei ist anders',
      current: { text: stored.join(', ') },
      incoming: { text: fileOrder.join(', ') },
      choice: 'alt',
      apply: (c, w) => {
        if (c === 'neu') w.settings.notesOrder = { ids: fileOrder };
      },
    });
  else if (appended.join() !== stored.join())
    out.push({
      id: 'order',
      kind: 'neu',
      group: 'Reihenfolge',
      label: 'Neue Teilnehmende ans Ende der Reihenfolge',
      current: { text: stored.join(', ') },
      incoming: { text: appended.join(', ') },
      choice: 'neu',
      apply: (c, w) => {
        if (c === 'neu') w.settings.notesOrder = { ids: appended };
      },
    });
  // 9. the file itself (the source shown on the import page)
  out.push({
    id: 'file',
    kind: 'neu',
    group: 'Datei',
    label: `Notizendatei${file ? ` „${file}“` : ''} als Quelle speichern`,
    current: docs.notes.main ? { fields: [['Datei', docs.notes.main.file ?? 'eingefügt'], ['Eingelesen', new Date(docs.notes.main.importedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })]] } : undefined,
    incoming: { fields: [['Datei', file ?? 'eingefügt'], ['Teilnehmende', parsed.meta.map((m) => m.id).join(', ')], ['Punkte', String(parsed.statements.length)]] },
    choice: 'neu',
    apply: (c, w) => {
      if (c === 'neu') w.notes.main = { text: src, importedAt: Date.now(), file };
    },
  });
  return out;
}
