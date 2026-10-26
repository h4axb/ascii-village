// Reading the Tally export (CSV) and suggesting what each column is: the
// participant id, a Teil 1 comparison, a Teil 2 Likert item (design A/B),
// a Teil 3 UEQ-S item, a Teil 4 field or free text. Every suggestion can
// be changed on the Import page; re-importing keeps the mapping by header.
import type { ColumnRole, Design, Side } from './types';
import { UEQS_ITEMS } from './stats';

// RFC 4180 CSV (quotes, doubled quotes, line breaks in fields); the
// delimiter is guessed from the first line (, ; or tab)
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
// a header without Tally's " (2)" for a repeated question
const base = (h: string) => h.replace(/\s*\(\d+\)\s*$/, '').trim();

// the design a header or answer names: "Variante A", "Design B", "(A)", "Option 2"
export function designIn(s: string): Design | null {
  const n = ` ${norm(s)} `;
  const a = /(variante|methode|version|design|crafting|ansatz|option|approach)\s*a\b|\(a\)|\ba\s*[):]|\b(variante|methode|design|option) 1\b/.test(n) || /^\s*a\s*$/.test(n);
  const b = /(variante|methode|version|design|crafting|ansatz|option|approach)\s*b\b|\(b\)|\bb\s*[):]|\b(variante|methode|design|option) 2\b/.test(n) || /^\s*b\s*$/.test(n);
  return a && !b ? 'A' : b && !a ? 'B' : null;
}
// the 1st / 2nd run of the test: "first", "second round", "zweiter Durchgang"
export function conditionIn(s: string): '1' | '2' | null {
  const n = ` ${norm(s)} `;
  const one = /\b(first|1st|erste[nrsm]?|round 1|runde 1|durchgang 1|condition 1|teil 1 des tests)\b/.test(n);
  const two = /\b(second|2nd|zweite[nrsm]?|round 2|runde 2|durchgang 2|condition 2)\b/.test(n);
  return one && !two ? '1' : two && !one ? '2' : null;
}
// guidance before crafting is design A (questions first), after it B (reflection)
export function timingIn(s: string): Design | null {
  const n = ` ${norm(s)} `;
  const a = /\b(before|beforehand|prior|upfront|up front|pre|vorher|vorab|vor dem|zuerst|clarif\w*|ruckfrage\w*|questions? first)\b/.test(n);
  const b = /\b(after|afterwards|post|nachher|danach|nach dem|nachtraglich|reflect\w*|reflexion|tun\w*)\b/.test(n);
  return a && !b ? 'A' : b && !a ? 'B' : null;
}
const sideIn = (s: string): Side | null => designIn(s) ?? conditionIn(s) ?? timingIn(s);

// a Teil 1 answer: A, B (or the 1st / 2nd run) or no preference
export function choiceOf(v: string): Side | 'neutral' | null {
  const n = norm(v);
  if (!n) return null;
  if (/beide|gleich|keine|kein unterschied|egal|neutral|weiss nicht|both|neither|no preference|no difference|equal|same|don.?t know|not sure|unsure/.test(n)) return 'neutral';
  return sideIn(v);
}

// a Likert answer as a number: digits ("5 – strongly agree" too), or the usual German/English wording
const LIKERT_WORDS: [RegExp, number][] = [
  [/(stimme )?(uberhaupt|gar) nicht zu|strongly disagree|completely disagree|trifft (uberhaupt|gar) nicht zu/, 1],
  [/(stimme )?eher nicht zu|trifft eher nicht zu|somewhat disagree|slightly disagree|mostly disagree/, 2],
  [/(stimme )?nicht zu|disagree|trifft nicht zu/, 2],
  [/teils|neutral|weder|neither|unentschieden|undecided/, 3],
  [/(stimme )?voll( und ganz)? zu|strongly agree|completely agree|trifft voll( und ganz)? zu/, 5],
  [/(stimme )?eher zu|trifft eher zu|somewhat agree|slightly agree|mostly agree/, 4],
  [/(stimme )?zu|agree|trifft zu/, 4],
];
export function likertOf(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const num = /^(-?\d+(?:[.,]\d+)?)/.exec(s);
  if (num) return Number(num[1].replace(',', '.'));
  const n = norm(s);
  for (const [re, val] of LIKERT_WORDS) if (re.test(n)) return val;
  return null;
}

// which UEQ-S item a header names (by its word pair; in a Tally matrix the
// pair is in brackets), and whether its poles are reversed (positive first)
export function ueqsItemIn(header: string): { item: number; reversed: boolean } | null {
  const h = norm(/\[([^\]]+)\]\s*$/.exec(header)?.[1] ?? header);
  const EN: [string, string][] = [
    ['obstructive', 'supportive'],
    ['complicated', 'easy'],
    ['inefficient', 'efficient'],
    ['confusing', 'clear'],
    ['boring', 'exciting'],
    ['not interesting', 'interesting'],
    ['conventional', 'inventive'],
    ['usual', 'leading edge'],
  ];
  for (let i = 0; i < 8; i++) {
    for (const [neg, pos] of [UEQS_ITEMS[i], EN[i]].map(([a, b]) => [norm(a), norm(b)])) {
      const ni = h.indexOf(neg);
      // the positive pole, not as part of the negative one ("uninteressant" / "interessant")
      const re = new RegExp(`(^|[^a-z])${pos.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const pm = re.exec(h);
      if (ni >= 0 && pm && !(pm.index >= ni && pm.index < ni + neg.length)) return { item: i, reversed: pm.index < ni };
    }
  }
  return null;
}

// what a column looks like on its own
type Kind = 'id' | 'order' | 'time' | 'ignore' | 'empty' | 'ueqs' | 'p1' | 'likert' | 'age' | 'info' | 'text';
function kindOf(h: string, vals: string[], nRows: number): Kind {
  const n = norm(h);
  if (/^(tallyid|test_?id|teilnehmer.?id|participant.?id|p-?id)$/.test(n.replace(/\s/g, '')) || /tallyid|test_id/.test(n)) return 'id';
  if (/^order$|reihenfolge|test_?order/.test(n)) return 'order';
  if (/submitted at|eingereicht|zeitstempel|timestamp|created at|^datum$|^date$/.test(n)) return 'time';
  if (/submission id|respondent id|^id$/.test(n)) return 'ignore';
  if (ueqsItemIn(h)) return 'ueqs';
  if (!vals.length) return 'empty';
  const choices = vals.map(choiceOf);
  if (choices.every((c) => c !== null) && choices.some((c) => c !== 'neutral')) return 'p1';
  if (/\balter\b|\bage\b|wie alt|how old/.test(n) && vals.every((v) => /^\d{1,3}$/.test(v))) return 'age';
  if (vals.every((v) => {
    const x = likertOf(v);
    return x !== null && x >= 1 && x <= 7;
  })) return 'likert';
  const long = vals.some((v) => v.length > 60 || v.split(/\s+/).length >= 5);
  if (!long && new Set(vals).size <= Math.max(8, nRows / 2)) return 'info';
  return 'text';
}

// where Teil 1–4 start, from the kinds of the columns in order
export function guessParts(kinds: Kind[]): (number | null)[] {
  const first = (k: Kind[], from = 0) => {
    const i = kinds.findIndex((x, j) => j >= from && k.includes(x));
    return i >= 0 ? i : null;
  };
  const p1 = first(['p1']);
  const p3 = first(['ueqs'], p1 ?? 0);
  const p2 = first(['likert'], p1 ?? 0);
  const p2ok = p2 != null && (p3 == null || p2 < p3) ? p2 : null;
  let lastUeq = -1;
  kinds.forEach((k, j) => k === 'ueqs' && (lastUeq = j));
  // Teil 3 without pole words: the run of 1–7 answers after Teil 2's last item is not knowable; only with pole words
  const after = lastUeq >= 0 ? lastUeq + 1 : Math.max(p2ok ?? -1, p1 ?? -1) + 1;
  let p4 = first(['age', 'info'], after);
  if (lastUeq < 0 && p2ok != null) {
    // no UEQ-S found: Teil 4 starts after the last Likert column
    let lastLik = p2ok;
    kinds.forEach((k, j) => j >= p2ok && k === 'likert' && (lastLik = j));
    p4 = first(['age', 'info', 'text'], lastLik + 1);
  }
  return [p1, p2ok, p3, p4];
}

const partOf = (j: number, parts: (number | null)[]) => {
  let p = 0;
  parts.forEach((start, i) => start != null && j >= start && (p = i + 1));
  return p; // 0: before Teil 1
};
// a Likert item's name without its design words
const stripSide = (h: string) =>
  base(h)
    .replace(/\s*[([]?\b(variante|methode|version|design|option|approach)\s*[ab12]\b[)\]]?\s*/gi, ' ')
    .replace(/\s*[([](?:[^)\]]*\b(before|after|first|second|vorher|nachher|erste|zweite)\b[^)\]]*)[)\]]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–:]\s*$/, '')
    .trim();

// a role for each column, from its header, its answers and the part it is in
export function suggestMapping(headers: string[], rows: string[][], partsIn?: (number | null)[]): { mapping: ColumnRole[]; parts: (number | null)[] } {
  const valsOf = (j: number) => rows.map((r) => (r[j] ?? '').trim()).filter(Boolean);
  const kinds = headers.map((h, j) => kindOf(h, valsOf(j), rows.length));
  const parts = partsIn ?? guessParts(kinds);
  const values = <T,>(j: number, f: (v: string) => T) => Object.fromEntries([...new Set(valsOf(j))].map((v) => [v, f(v)])) as Record<string, T>;

  // Teil 2: questions asked once per design pair up (same text without the
  // design words); a question asked once describes both
  const likertCols = headers.map((_, j) => j).filter((j) => partOf(j, parts) === 2 && (kinds[j] === 'likert' || kinds[j] === 'p1' || kinds[j] === 'info') && valsOf(j).every((v) => likertOf(v) !== null));
  const groups = new Map<string, number[]>();
  for (const j of likertCols) {
    const k = norm(stripSide(headers[j]));
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  const likertSide = new Map<number, Side | null>();
  for (const cols of groups.values()) {
    if (cols.length === 2) {
      const [x, y] = cols.map((j) => sideIn(headers[j]));
      const named = x && y && x !== y;
      likertSide.set(cols[0], named ? x : '1');
      likertSide.set(cols[1], named ? y : '2');
    } else for (const j of cols) likertSide.set(j, designIn(headers[j]) ?? conditionIn(headers[j]));
  }
  // Teil 3: items by their pole words, else by position; 16 items = one UEQ-S per run
  const ueqCols = headers.map((_, j) => j).filter((j) => partOf(j, parts) === 3 && kinds[j] !== 'empty' && kinds[j] !== 'text' && valsOf(j).every((v) => /^[1-7]\b/.test(v)));
  const perRun = ueqCols.length >= 16;

  const mapping = headers.map((h, j): ColumnRole => {
    const k = kinds[j];
    if (k === 'id' || k === 'order' || k === 'time') return { role: k };
    if (k === 'ignore' || k === 'empty') return { role: 'ignore' };
    const part = partOf(j, parts);
    if (part === 3 && ueqCols.includes(j)) {
      const pos = ueqCols.indexOf(j);
      const u = ueqsItemIn(h);
      const side = designIn(h) ?? conditionIn(h) ?? (perRun ? (pos < 8 ? '1' : '2') : null);
      return { role: 'ueqs', item: u?.item ?? pos % 8, design: side, reversed: u?.reversed ?? false };
    }
    if (k === 'ueqs') {
      const u = ueqsItemIn(h)!;
      return { role: 'ueqs', item: u.item, design: designIn(h) ?? conditionIn(h), reversed: u.reversed };
    }
    if (part === 2 && likertSide.has(j)) return { role: 'likert', item: stripSide(h) || base(h), design: likertSide.get(j)!, values: values(j, likertOf) };
    if (k === 'p1' && (part === 1 || part === 0 || part === 2)) return { role: 'p1', question: base(h), values: values(j, choiceOf) };
    if (k === 'age') return { role: 'info', label: 'Alter', numeric: true };
    if (k === 'text') return { role: 'text', label: base(h) };
    if (k === 'likert' && part === 1) return { role: 'likert', item: base(h), design: null, values: values(j, likertOf) };
    return { role: 'info', label: base(h), numeric: valsOf(j).every((v) => /^-?\d+([.,]\d+)?$/.test(v)) };
  });
  return { mapping, parts };
}

// keep a mapping made for an earlier export: columns matched by header
export function carryMapping(oldHeaders: string[], old: ColumnRole[], headers: string[], suggested: ColumnRole[]): ColumnRole[] {
  return headers.map((h, j) => {
    const i = oldHeaders.indexOf(h);
    return i >= 0 && old[i] ? old[i] : suggested[j];
  });
}
// after a part's start changed: new roles only for the columns that moved to another part
export function reassignParts(headers: string[], rows: string[][], old: ColumnRole[], oldParts: (number | null)[], parts: (number | null)[]): ColumnRole[] {
  const fresh = suggestMapping(headers, rows, parts).mapping;
  return headers.map((_, j) => (partOf(j, oldParts) === partOf(j, parts) && old[j] ? old[j] : fresh[j]));
}
