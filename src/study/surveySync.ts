// The survey's free-text answers as statements (section "Umfrage"), following
// the live Tally matching: a statement belongs to its answer (a Tally row and
// column), and whoever that row is matched to now is its participant. When the
// matching changes, the statement moves with everything set on it (tags, the
// Crafting-Bezug, problem groups, edits); answers without a statement yet get
// one. Statements from before this have no row stored: they are tied to theirs
// once by their answer text (when that is unambiguous), else left as they are
// and reported.
import type { ItemDoc, StudyDocs, TallyDoc } from './types';

const ID_HEADER = /^(submission|response|respondent)[ _-]?id$/i;
export function rowKeyOf(t: TallyDoc, row: number): string {
  const j = t.headers.findIndex((h) => ID_HEADER.test(h.trim()));
  const v = j >= 0 ? (t.rows[row]?.[j] ?? '').trim() : '';
  return v ? `id:${v}` : `row:${row}`;
}
const safe = (k: string) => k.replace(/[^\w-]+/g, '_').slice(0, 60);
const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim();
// (unedited: the text is still the answer as imported)
const unedited = (i: ItemDoc) => !i.original || same(i.original, i.text);

export interface SurveySync {
  items: Record<string, ItemDoc>; // every statement, the survey ones as they follow the matching
  changed: ItemDoc[]; // to store: moved, re-texted or newly tied to their row
  created: ItemDoc[]; // to store: answers that had no statement
  moved: { id: string; from: string; to: string }[];
  unresolved: string[]; // older statements whose answer row is not clear
  orphaned: string[]; // statements whose row is matched to nobody now (hidden)
}

export function syncSurvey(docs: StudyDocs, rowOwner: Map<number, string>): SurveySync {
  const t = docs.tally.main;
  const out: SurveySync = { items: { ...docs.items }, changed: [], created: [], moved: [], unresolved: [], orphaned: [] };
  if (!t) return out;
  const cols = t.mapping.map((m, j) => (m.role === 'text' ? { j, label: m.label } : null)).filter((x): x is { j: number; label: string } => !!x);
  const keys = t.rows.map((_, r) => rowKeyOf(t, r));
  const rowOfKey = new Map(keys.map((k, r) => [k, r]));
  const ownRow = new Map<string, number>();
  for (const [r, p] of rowOwner) ownRow.set(p, r);
  const put = (i: ItemDoc) => {
    out.items[i.id] = i;
    out.changed.push(i);
  };
  for (const c of cols) {
    const cell = (r: number) => (t.rows[r]?.[c.j] ?? '').trim();
    const stored = Object.values(docs.items).filter((i) => i.section === 'survey' && (i.src ? i.src.col === c.label : i.question === c.label));
    const claimed = new Map<number, ItemDoc>();
    // 1. tied to their row already
    for (const i of stored.filter((x) => x.src)) {
      const r = rowOfKey.get(i.src!.key);
      if (r != null && !claimed.has(r)) claimed.set(r, i);
    }
    // 2. older ones by their answer text: their participant's current row first, then a single match
    let rest = stored.filter((x) => !x.src);
    const free = (i: ItemDoc) => t.rows.map((_, r) => r).filter((r) => !claimed.has(r) && same(cell(r), i.original ?? i.text));
    for (const i of [...rest]) {
      const r = ownRow.get(i.person);
      if (r != null && free(i).includes(r)) (claimed.set(r, i), (rest = rest.filter((x) => x !== i)));
    }
    for (let progress = true; progress && rest.length; ) {
      progress = false;
      for (const i of [...rest]) {
        const f = free(i);
        if (f.length === 1) (claimed.set(f[0], i), (rest = rest.filter((x) => x !== i)), (progress = true));
      }
    }
    out.unresolved.push(...rest.filter((i) => i.status !== 'removed').map((i) => i.id));
    // 3. each claimed statement follows its row
    for (const [r, i] of claimed) {
      const owner = rowOwner.get(r) ?? null;
      const live = cell(r);
      let n: ItemDoc = i.src ? i : { ...i, src: { key: keys[r], col: c.label } };
      if (owner && owner !== i.person) {
        out.moved.push({ id: i.id, from: i.person, to: owner });
        n = { ...n, person: owner };
      }
      if (live && !same(live, n.text) && unedited(n)) n = { ...n, text: live, original: live, deStale: !!n.de, status: 'changed', confirmed: false };
      // (a row matched to nobody: hidden until it is matched again)
      if (!owner && n.status !== 'removed') (n = { ...n, status: 'removed', orphan: true }), out.orphaned.push(i.id);
      if (owner && n.orphan) n = { ...n, status: undefined, orphan: undefined };
      if (n !== i) put(n);
    }
    // 4. answers without a statement
    for (let r = 0; r < t.rows.length; r++) {
      const owner = rowOwner.get(r);
      if (claimed.has(r) || !owner || !cell(r)) continue;
      const id = `s-${safe(keys[r])}-${c.j}`;
      if (docs.items[id]) continue;
      const n: ItemDoc = { id, person: owner, section: 'survey', question: c.label, text: cell(r), order: 1000 + c.j, chips: [], suggested: [], src: { key: keys[r], col: c.label } };
      out.items[id] = n;
      out.created.push(n);
    }
  }
  return out;
}
