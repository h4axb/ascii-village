// Reading the Tally export (CSV) and suggesting what each column is: the
// participant id, a Teil 1 comparison, a Teil 2 Likert item (design A/B),
// a Teil 3 UEQ-S item, a Teil 4 field or free text. Every suggestion can
// be changed on the Import page; re-importing keeps the mapping by header.
import type { ColumnRole, Design } from './types';
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

// the design a header or answer names: "Variante A", "Methode B", "(A)", "Version 1/2"
export function designIn(s: string): Design | null {
  const n = ` ${norm(s)} `;
  const a = /(variante|methode|version|design|crafting|ansatz)\s*a\b|\(a\)|\ba\s*[):]|\bvariante 1\b|\bmethode 1\b/.test(n) || /^\s*a\s*$/.test(n);
  const b = /(variante|methode|version|design|crafting|ansatz)\s*b\b|\(b\)|\bb\s*[):]|\bvariante 2\b|\bmethode 2\b/.test(n) || /^\s*b\s*$/.test(n);
  return a && !b ? 'A' : b && !a ? 'B' : null;
}

// a Teil 1 answer: A, B or no preference
export function choiceOf(v: string): Design | 'neutral' | null {
  const n = norm(v);
  if (!n) return null;
  const d = designIn(v);
  if (d) return d;
  if (/beide|gleich|keine|kein unterschied|egal|neutral|weiss nicht|both|no preference|equal/.test(n)) return 'neutral';
  return null;
}

// a Likert answer as a number: digits, or the usual German/English wording
const LIKERT_WORDS: [RegExp, number][] = [
  [/(stimme )?(uberhaupt|gar) nicht zu|strongly disagree|trifft (uberhaupt|gar) nicht zu/, 1],
  [/(stimme )?eher nicht zu|trifft eher nicht zu/, 2],
  [/(stimme )?nicht zu|disagree|trifft nicht zu/, 2],
  [/teils|neutral|weder|neither|unentschieden/, 3],
  [/(stimme )?voll( und ganz)? zu|strongly agree|trifft voll( und ganz)? zu/, 5],
  [/(stimme )?eher zu|trifft eher zu/, 4],
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

// which UEQ-S item a header names (by its word pair), and whether its poles
// are reversed (positive word first)
export function ueqsItemIn(header: string): { item: number; reversed: boolean } | null {
  const h = norm(header);
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
      if (ni >= 0 && pm) return { item: i, reversed: pm.index < ni };
    }
  }
  return null;
}

// a role for each column, from its header and answers
export function suggestMapping(headers: string[], rows: string[][]): ColumnRole[] {
  return headers.map((h, j) => {
    const vals = rows.map((r) => (r[j] ?? '').trim()).filter(Boolean);
    const n = norm(h);
    if (/^(tallyid|test_?id|teilnehmer.?id|participant.?id|p-?id)$/.test(n.replace(/\s/g, '')) || /tallyid|test_id/.test(n)) return { role: 'id' };
    if (/^order$|reihenfolge|test_?order/.test(n)) return { role: 'order' };
    if (/submission id|respondent id|submitted at|^id$|created at|eingereicht/.test(n)) return { role: 'ignore' };
    const ueq = ueqsItemIn(h);
    if (ueq) return { role: 'ueqs', item: ueq.item, design: designIn(h) ?? 'A', reversed: ueq.reversed };
    if (!vals.length) return { role: 'ignore' };
    const choices = vals.map(choiceOf);
    if (choices.filter((c) => c === 'A' || c === 'B').length >= vals.length * 0.5 && choices.every((c) => c !== null)) {
      return { role: 'p1', question: h, values: Object.fromEntries([...new Set(vals)].map((v) => [v, choiceOf(v)])) };
    }
    if (/\balter\b|\bage\b|wie alt/.test(n) && vals.every((v) => /^\d{1,3}$/.test(v))) return { role: 'info', label: 'Alter', numeric: true };
    const likert = vals.map(likertOf);
    const design = designIn(h);
    if (design && likert.every((x) => x !== null && x >= 1 && x <= 7)) {
      return { role: 'likert', item: h.replace(/\s*\(?(variante|methode|version)\s*[ab12]\)?\s*/gi, ' ').trim(), design, values: Object.fromEntries([...new Set(vals)].map((v) => [v, likertOf(v)])) };
    }
    const distinct = new Set(vals).size;
    // a sentence (5+ words) or a long answer: free text
    const long = vals.some((v) => v.length > 60 || v.split(/\s+/).length >= 5);
    if (!long && distinct <= Math.max(8, rows.length / 2)) return { role: 'info', label: h, numeric: vals.every((v) => /^-?\d+([.,]\d+)?$/.test(v)) };
    return { role: 'text', label: h };
  });
}

// keep a mapping made for an earlier export: columns matched by header
export function carryMapping(oldHeaders: string[], old: ColumnRole[], headers: string[], suggested: ColumnRole[]): ColumnRole[] {
  return headers.map((h, j) => {
    const i = oldHeaders.indexOf(h);
    return i >= 0 && old[i] ? old[i] : suggested[j];
  });
}
