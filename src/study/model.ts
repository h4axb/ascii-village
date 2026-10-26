// The one derived model behind every page of /feedback: the stored documents
// (Tally, notes, tags, corrections) plus the game's own data, recomputed on
// every change. Views read only from here, so a correction (A/B swapped,
// a participant excluded, the run-time rule) reaches every figure at once.
import { designOf, type FeedbackRecord } from '../feedback/schema';
import type { RunEvent } from '../quest/runlog';
import { endOf, linkLabels } from '../feedback/studyExport';
import type { ColumnRole, Design, GameData, Invite, ItemDoc, PersonDoc, StudyDocs, TagGroup, ChipRole } from './types';
import { matchRows, timeOf, type MatchVia } from './match';

// ---- the scope filter: everyone, one person, or one of their links ----
export type Scope = { kind: 'all' } | { kind: 'person'; id: string } | { kind: 'link'; id: string; key: string };
export const scopeLabel = (s: Scope) => (s.kind === 'all' ? 'Alle' : s.id);

export interface LinkInfo {
  key: string;
  label: string; // P009 or P009.2
  person: string;
  started: number | null;
  end: number | null;
  endedBy: string;
  minutes: number | null;
  order: 'AB' | 'BA' | null;
  crafts: number;
}

export interface Person {
  id: string;
  doc: PersonDoc;
  excluded: boolean;
  links: LinkInfo[];
  group: 'AB' | 'BA' | null; // corrected, else tracked
  trackedGroup: 'AB' | 'BA' | null;
  notesGroup: string | null; // from the notes header
  groupMismatch: boolean;
  minutes: number | null; // per the run-time rule
  tallyRow: number | null;
  tallyVia: MatchVia | null; // how the row was matched
  tallyConflict: boolean; // the row's AB/BA differs from the person's group
  surveyAt: number | null; // when the game opened the survey (tracked)
  date: number | null;
}

// one Tally answer row, already mapped and corrected
export interface SurveyRow {
  row: number;
  person: string | null;
  swapped: boolean;
  p1: Record<string, Design | 'neutral' | null>; // question → answer (swap applied)
  likert: Record<string, Partial<Record<Design, number | null>>>; // item → design → 1..7
  ueqs: Record<Design, (number | null)[]>; // 8 raw answers 1..7 (reversal applied)
  info: Record<string, string>;
  text: Record<string, string>;
}

export interface Model {
  persons: Person[]; // every known P-id, excluded ones too
  included: Person[];
  links: LinkInfo[];
  survey: SurveyRow[]; // rows of included persons (and unmatched rows)
  unmatchedRows: number[];
  ignoredRows: Set<number>;
  mapping: ColumnRole[];
  headers: string[];
  // the game's records, of included persons, per scope
  events: RunEvent[];
  feedback: FeedbackRecord[];
  items: ItemDoc[]; // confirmed statements of included persons
  allItems: ItemDoc[];
  tags: TagGroup[];
  chipRole: Map<string, ChipRole | undefined>;
  chipLabel: Map<string, string>;
}

const P_ID = /^P\d{3,}$/;

export function personIdOf(v: string): string | null {
  const m = /p\s*-?\s*(\d{1,4})/i.exec(v.trim());
  return m ? `P${m[1].padStart(3, '0')}` : null;
}

const asOrder = (v: unknown): 'AB' | 'BA' | null => (v === 'AB' || v === 'BA' ? v : null);

export function buildModel(docs: StudyDocs, game: GameData): Model {
  const invites = game.invites.filter((i) => i.participant_id && P_ID.test(i.participant_id));
  const labels = linkLabels(invites);
  const tally = docs.tally.main;
  const mapping = tally?.mapping ?? [];
  const headers = tally?.headers ?? [];
  const idCol = mapping.findIndex((m) => m.role === 'id');
  const orderCol = mapping.findIndex((m) => m.role === 'order');
  const timeCol = mapping.findIndex((m) => m.role === 'time');

  const ids = new Set<string>();
  for (const i of invites) ids.add(i.participant_id!);
  for (const e of game.events) if (P_ID.test(e.participant)) ids.add(e.participant);
  for (const id of Object.keys(docs.people)) if (P_ID.test(id)) ids.add(id);
  const tallyIds = (tally?.rows ?? []).map((r) => (idCol >= 0 ? personIdOf(r[idCol] ?? '') : null));
  for (const t of tallyIds) if (t) ids.add(t);
  for (const it of Object.values(docs.items)) if (P_ID.test(it.person)) ids.add(it.person);

  const notesMeta = (docs.settings.notesMeta ?? {}) as Record<string, { group?: string; slot?: string }>;

  const linkInfo = (i: Invite): LinkInfo => {
    const e = endOf(i);
    const evs = game.events.filter((x) => x.key === i.key || (!x.key && x.participant === i.participant_id && i.started && x.at >= i.started && (!e || x.at <= e.at + 60000)));
    return {
      key: i.key,
      label: labels.get(i.key) ?? i.participant_id!,
      person: i.participant_id!,
      started: i.started,
      end: e?.at ?? null,
      endedBy: e ? (e.how === 'finished' ? 'Umfrage' : e.how === 'closed' ? 'geschlossen' : 'abgelaufen') : i.started ? 'läuft' : 'nicht geöffnet',
      minutes: i.started && e ? (e.at - i.started) / 60000 : null,
      order: asOrder(i.run_order) ?? asOrder(evs[0]?.order),
      crafts: i.crafts_used,
    };
  };

  const persons: Person[] = [...ids].sort().map((id) => {
    const doc: PersonDoc = docs.people[id] ?? { id };
    const links = invites
      .filter((i) => i.participant_id === id)
      .map(linkInfo)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const trackedGroup = links.find((l) => l.order)?.order ?? asOrder(game.events.find((e) => e.participant === id)?.order) ?? asOrder(game.feedback.find((r) => r.participant === id)?.order);
    const notesGroup = notesMeta[id]?.group?.toUpperCase().replace(/[^AB]/g, '') || null;
    const timed = links.filter((l) => l.minutes != null);
    const main = links.find((l) => l.key === doc.mainLink) ?? [...timed].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0];
    const minutes = !timed.length ? null : doc.runtime === 'main' ? (main?.minutes ?? null) : timed.reduce((a, l) => a + (l.minutes ?? 0), 0);
    const surveyAt =
      game.events.filter((e) => e.participant === id && e.type === 'session' && e.data.what === 'survey').map((e) => e.at).sort((a, b) => a - b)[0] ??
      invites.filter((i) => i.participant_id === id && i.completed).map((i) => i.completed!).sort((a, b) => a - b)[0] ??
      null;
    return {
      id,
      doc,
      excluded: !!doc.excluded,
      links,
      group: doc.group ?? trackedGroup ?? (notesGroup === 'AB' || notesGroup === 'BA' ? notesGroup : null),
      trackedGroup,
      notesGroup,
      groupMismatch: !!notesGroup && !!trackedGroup && notesGroup !== trackedGroup,
      minutes,
      tallyRow: null,
      tallyVia: null,
      tallyConflict: false,
      surveyAt,
      date: links.map((l) => l.started).filter((x): x is number => !!x).sort()[0] ?? null,
    };
  });
  // the survey rows → participants (match.ts); the notes give the order
  // rows set aside (a test run, a duplicate): in no pairing and no statistic
  const ignoredRows = new Set((docs.settings.ignoredRows as { rows?: number[] } | undefined)?.rows ?? []);
  const notesOrder = ((docs.settings.notesOrder as { ids?: string[] } | undefined)?.ids ?? []).filter((id) => ids.has(id));
  const ordered = [...notesOrder, ...persons.map((p) => p.id).filter((id) => !notesOrder.includes(id))];
  const byId = new Map(persons.map((p) => [p.id, p]));
  const matched = matchRows(
    (tally?.rows ?? []).map((r, row) => ({ row, id: tallyIds[row], submitted: timeCol >= 0 ? timeOf(r[timeCol] ?? '') : null })).filter((r) => !ignoredRows.has(r.row)),
    ordered.map((id) => ({ id, manual: byId.get(id)!.doc.tallyRow, surveyAt: byId.get(id)!.surveyAt })),
  );
  for (const p of persons) {
    const m = matched.get(p.id);
    if (!m) continue;
    p.tallyRow = m.row;
    p.tallyVia = m.via;
    const sent = orderCol >= 0 ? asOrder((tally?.rows[m.row]?.[orderCol] ?? '').trim().toUpperCase()) : null;
    // (no tracked order: the one the game sent to the survey)
    if (!p.group) p.group = sent;
    const known = p.doc.group ?? p.trackedGroup ?? (p.notesGroup === 'AB' || p.notesGroup === 'BA' ? p.notesGroup : null);
    p.tallyConflict = !!sent && !!known && sent !== known;
  }
  const included = persons.filter((p) => !p.excluded);
  const incIds = new Set(included.map((p) => p.id));
  const exIds = new Set(persons.filter((p) => p.excluded).map((p) => p.id));

  // Tally rows → persons (corrections win over the id column)
  const rowOwner = new Map<number, string>();
  for (const p of persons) if (p.tallyRow != null) rowOwner.set(p.tallyRow, p.id);
  const survey: SurveyRow[] = [];
  const unmatchedRows: number[] = [];
  (tally?.rows ?? []).forEach((r, row) => {
    if (ignoredRows.has(row)) return;
    const person = rowOwner.get(row) ?? null;
    if (!person) unmatchedRows.push(row);
    if (person && exIds.has(person)) return;
    const swapped = !!(person && docs.people[person]?.swapP1);
    const out: SurveyRow = { row, person, swapped, p1: {}, likert: {}, ueqs: { A: Array(8).fill(null), B: Array(8).fill(null) }, info: {}, text: {} };
    mapping.forEach((m, j) => {
      const v = (r[j] ?? '').trim();
      if (m.role === 'p1') {
        let c = v ? (m.values[v] ?? null) : null;
        if (swapped && (c === 'A' || c === 'B')) c = c === 'A' ? 'B' : 'A';
        out.p1[m.question] = c;
      } else if (m.role === 'likert') {
        (out.likert[m.item] ??= {})[m.design] = v ? (m.values[v] ?? null) : null;
      } else if (m.role === 'ueqs') {
        const n = Number(/\d/.exec(v)?.[0]);
        out.ueqs[m.design][m.item] = n >= 1 && n <= 7 ? (m.reversed ? 8 - n : n) : null;
      } else if (m.role === 'info') {
        if (v) out.info[m.label] = v;
      } else if (m.role === 'text') {
        if (v) out.text[m.label] = v;
      }
    });
    if (person) {
      const age = docs.people[person]?.age;
      if (age != null) out.info.Alter = String(age);
    }
    survey.push(out);
  });

  const tags = Object.values(docs.tags).sort((a, b) => a.order - b.order);
  const chipRole = new Map<string, ChipRole | undefined>();
  const chipLabel = new Map<string, string>();
  for (const g of tags)
    for (const c of g.chips) {
      chipRole.set(c.id, c.role);
      chipLabel.set(c.id, c.label);
    }
  const allItems = Object.values(docs.items).sort((a, b) => a.person.localeCompare(b.person) || a.order - b.order);
  const items = allItems.filter((i) => incIds.has(i.person) && i.status !== 'removed' && !i.chips.some((c) => chipRole.get(c) === 'rejected'));

  return {
    persons,
    included,
    links: included.flatMap((p) => p.links),
    survey,
    unmatchedRows,
    ignoredRows,
    mapping,
    headers,
    events: game.events.filter((e) => incIds.has(e.participant)),
    feedback: game.feedback.filter((r) => !!r.participant && incIds.has(r.participant)),
    items,
    allItems,
    tags,
    chipRole,
    chipLabel,
  };
}

// ---- a scope's slice of the model ----
export interface Slice {
  persons: Person[];
  links: LinkInfo[];
  survey: SurveyRow[];
  events: RunEvent[];
  feedback: FeedbackRecord[];
  items: ItemDoc[];
}
export function slice(m: Model, s: Scope): Slice {
  if (s.kind === 'all') return { persons: m.included, links: m.links, survey: m.survey.filter((r) => r.person), events: m.events, feedback: m.feedback, items: m.items };
  const persons = m.included.filter((p) => p.id === s.id);
  const link = s.kind === 'link' ? m.links.find((l) => l.key === s.key) : null;
  const inLink = (r: { participant?: string; at: number; key?: string }) => {
    if (!link) return true;
    if (r.key) return r.key === link.key;
    return !!link.started && r.at >= link.started - 60000 && (link.end == null || r.at <= link.end + 60000);
  };
  return {
    persons,
    links: link ? [link] : m.links.filter((l) => l.person === s.id),
    survey: m.survey.filter((r) => r.person === s.id),
    events: m.events.filter((e) => e.participant === s.id && inLink(e)),
    feedback: m.feedback.filter((r) => r.participant === s.id && inLink(r)),
    items: m.items.filter((i) => i.person === s.id && (!link || !i.link || i.link === link.label)),
  };
}

// ---- figures from the game's tracking ----
export const PREF_LABEL: Record<string, { name: string; values: Record<string, string> }> = {
  detail: { name: 'Detailgrad', values: { '-1': 'weniger', '0': 'normal', '1': 'mehr' } },
  color: { name: 'Farbe', values: { '-1': 'pastell', '0': 'normal', '1': 'kräftig' } },
  surprise: { name: 'Überraschung', values: { '-1': 'kontrolliert', '0': 'beibehalten', '1': 'überraschen' } },
  unknown: { name: 'Unbekannte Wörter', values: { '-1': 'weglassen', '1': 'trotzdem erzeugen' } },
};
export const SCOPE_LABEL: Record<string, string> = { kind: 'gleiche Art', all: 'alle Crafts', session: 'nur diese Sitzung' };
export const RATING_LABEL: Record<string, string> = {
  control: 'Kontrolle',
  match: 'Erwartungstreue',
  frustration: 'Frustration',
  ease: 'Verständlichkeit',
  overall: 'Gesamteindruck',
};

// the preference answers in variant B (one count per record that tuned)
export function prefChoices(feedback: FeedbackRecord[]) {
  const out: Record<string, Record<string, number>> = {};
  const scopes: Record<string, number> = {};
  for (const r of feedback) {
    if (!r.answers) continue;
    for (const [k, v] of Object.entries(r.answers)) {
      if (v == null) continue;
      (out[k] ??= {})[String(v)] = (out[k][String(v)] ?? 0) + 1;
    }
    if (r.scope) scopes[r.scope] = (scopes[r.scope] ?? 0) + 1;
  }
  return { prefs: out, scopes };
}

// the in-game rating questions after each design (1–5), per design
export function gameRatings(feedback: FeedbackRecord[]) {
  const out: Record<string, Record<Design, number[]>> = {};
  for (const r of feedback) {
    if (!r.rating) continue;
    const d = designOf(r.cond);
    if (!d) continue;
    for (const [q, v] of Object.entries(r.rating)) if (typeof v === 'number') ((out[q] ??= { A: [], B: [] })[d]).push(v);
  }
  return out;
}

// crafts per design: count, votes, reworks, fallbacks
export function craftStats(events: RunEvent[], feedback: FeedbackRecord[]) {
  const per = (d: Design) => {
    const crafts = events.filter((e) => e.type === 'craft' && !e.data.recraftOf && designOf(e.data.design ?? e.cond) === d && e.data.outcome === 'crafted');
    const fb = feedback.filter((r) => !r.rating && designOf(r.cond) === d);
    return {
      crafts: crafts.length,
      reworks: crafts.reduce((a, c) => a + (Number(c.data.reworks) || 0), 0),
      fallbacks: crafts.filter((c) => ((c.data.results as { fallback?: unknown }[] | undefined) ?? []).some((r) => !!r?.fallback)).length,
      up: fb.filter((r) => r.vote === 'up').length,
      down: fb.filter((r) => r.vote === 'down').length,
      minutes: crafts.reduce((a, c) => a + (Number(c.data.ms) || 0), 0) / 60000,
    };
  };
  return { A: per('A'), B: per('B') };
}

// statements by the role of their confirmed chips
export function itemsWithRole(items: ItemDoc[], m: Model, role: ChipRole) {
  return items.filter((i) => i.chips.some((c) => m.chipRole.get(c) === role));
}
export const distinctPersons = (items: ItemDoc[]) => new Set(items.map((i) => i.person)).size;
