// Which Tally row belongs to which participant, when the survey's id column
// is empty. In this order, each step only for what is still open:
//   1. a row chosen by hand (Teilnehmende & Sessions)
//   2. the id the game sent to the survey (tallyid / test_id)
//   3. time (only when switched on): the submission 10 min before to 120 min
//      after the participant's tracked survey start, nearest first
//   4. order: the remaining participants in the order of the notes, paired
//      with the remaining rows in the order they were submitted
// A pairing by order is checked against the AB/BA value the survey got.
export type MatchVia = 'manuell' | 'id' | 'zeit' | 'reihenfolge';
export interface MatchPerson {
  id: string;
  manual?: number | null; // undefined: automatic
  surveyAt: number | null;
}
export interface MatchRow {
  row: number;
  id: string | null; // from the id column
  submitted: number | null;
}

export const SUBMIT_BEFORE = 10 * 60000;
export const SUBMIT_AFTER = 120 * 60000;

// "2026-10-26 10:41:03" (UTC), ISO, or "26.10.2026 10:41" (local)
export function timeOf(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (de) {
    const y = Number(de[3]) < 100 ? 2000 + Number(de[3]) : Number(de[3]);
    return new Date(y, Number(de[2]) - 1, Number(de[1]), Number(de[4] ?? 0), Number(de[5] ?? 0), Number(de[6] ?? 0)).getTime();
  }
  // Tally's "2026-10-26 10:41:03" has no zone: it is UTC
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? t : null;
}

export function matchRows(rows: MatchRow[], persons: MatchPerson[], useTime = false): Map<string, { row: number; via: MatchVia }> {
  const out = new Map<string, { row: number; via: MatchVia }>();
  const taken = new Set<number>();
  const set = (p: string, row: number, via: MatchVia) => {
    out.set(p, { row, via });
    taken.add(row);
  };
  // 1. by hand (null = "no row")
  for (const p of persons) if (p.manual !== undefined && p.manual !== null && rows.some((r) => r.row === p.manual)) set(p.id, p.manual, 'manuell');
  const open = () => persons.filter((p) => p.manual === undefined && !out.has(p.id));
  // 2. by id
  for (const p of open()) {
    const r = rows.find((x) => x.id === p.id && !taken.has(x.row));
    if (r) set(p.id, r.row, 'id');
  }
  // 3. by time, nearest pairs first
  const pairs: { p: string; row: number; gap: number }[] = [];
  for (const p of useTime ? open() : [])
    for (const r of rows)
      if (!taken.has(r.row) && !r.id && p.surveyAt && r.submitted && r.submitted >= p.surveyAt - SUBMIT_BEFORE && r.submitted <= p.surveyAt + SUBMIT_AFTER)
        pairs.push({ p: p.id, row: r.row, gap: Math.abs(r.submitted - p.surveyAt) });
  for (const x of pairs.sort((a, b) => a.gap - b.gap)) if (!out.has(x.p) && !taken.has(x.row)) set(x.p, x.row, 'zeit');
  // 4. by order (rows that name another id never pair by order)
  const rest = rows.filter((r) => !taken.has(r.row) && !r.id).sort((a, b) => (a.submitted != null && b.submitted != null ? a.submitted - b.submitted : a.row - b.row));
  open().forEach((p, i) => rest[i] && set(p.id, rest[i].row, 'reihenfolge'));
  return out;
}
