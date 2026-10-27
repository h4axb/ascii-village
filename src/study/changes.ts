// What an import (or a restore) would change, as a list to check before
// anything is stored: new things to add, and conflicts with what is already
// there, each with "Aktuell behalten" (the default), "Neu übernehmen" or
// "Beide behalten". Every change applies itself to a working copy of the
// documents; what differs from the stored ones afterwards is saved.
import type { Del, Put } from './store';
import type { Coll, StudyDocs } from './types';

export type Choice = 'alt' | 'neu' | 'beide';
// one side of a conflict: a text (diffed word by word) and/or a table of fields
export interface DiffSide {
  text?: string;
  fields?: [string, string][];
  note?: string; // e.g. the tags it carries
}
export interface Change {
  id: string;
  kind: 'neu' | 'konflikt' | 'gleich'; // gleich: already so, only shown
  group: string; // the participant (or area) it belongs to
  label: string;
  current?: DiffSide;
  incoming?: DiffSide;
  both?: boolean; // "Beide behalten" offered
  choice: Choice; // the default: keep for conflicts, take for new things
  apply: (choice: Choice, w: StudyDocs) => void;
}

export const workCopy = (d: StudyDocs): StudyDocs => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v }])) as unknown as StudyDocs;

// the changes chosen, as documents to store and remove
export function resolve(changes: Change[], docs: StudyDocs, choices: Record<string, Choice>): { put: Put[]; del: Del[] } {
  const w = workCopy(docs);
  for (const c of changes) c.apply(choices[c.id] ?? c.choice, w);
  const put: Put[] = [];
  const del: Del[] = [];
  for (const coll of Object.keys(w) as Coll[]) {
    const before = docs[coll] as Record<string, unknown>;
    const after = w[coll] as Record<string, unknown>;
    for (const [id, v] of Object.entries(after)) if (v !== before[id]) put.push({ coll, id, data: v });
    for (const id of Object.keys(before)) if (!(id in after)) del.push({ coll, id });
  }
  return { put, del };
}

// ---- a word diff (longest common subsequence), for the two panes ----
export interface Piece {
  t: string;
  op: 'same' | 'del' | 'add';
}
const tokens = (s: string) => s.split(/(\s+)/).filter((x) => x !== '');
export function diffWords(a: string, b: string): { left: Piece[]; right: Piece[] } {
  const x = tokens(a);
  const y = tokens(b);
  // (long texts: a plain whole-text comparison is enough)
  if (x.length * y.length > 250_000) return { left: [{ t: a, op: a === b ? 'same' : 'del' }], right: [{ t: b, op: a === b ? 'same' : 'add' }] };
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const left: Piece[] = [];
  const right: Piece[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      left.push({ t: x[i], op: 'same' });
      right.push({ t: y[j], op: 'same' });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) left.push({ t: x[i++], op: 'del' });
    else right.push({ t: y[j++], op: 'add' });
  }
  while (i < x.length) left.push({ t: x[i++], op: 'del' });
  while (j < y.length) right.push({ t: y[j++], op: 'add' });
  return { left, right };
}

// the whole documents of a saved state against the current ones, one change per document
const COLL_NAME: Partial<Record<Coll, string>> = { items: 'Aussage', tally: 'Umfrage', notes: 'Notizen', findings: 'Befund', tags: 'Tags', people: 'Teilnehmende', captions: 'Bildunterschrift', hypotheses: 'Hypothese', claims: 'Aussage (Ergebnis)', settings: 'Einstellung' };
export function restoreChanges(current: StudyDocs, saved: StudyDocs): Change[] {
  const out: Change[] = [];
  const show = (coll: Coll, v: unknown): DiffSide => {
    if (v == null) return {};
    if (coll === 'items') {
      const i = v as { text: string; de?: string; chips?: string[]; person?: string };
      return { text: i.text, note: [i.person, i.de, (i.chips ?? []).join(', ')].filter(Boolean).join(' · ') };
    }
    const s = JSON.stringify(v);
    return { text: s.length > 600 ? `${s.slice(0, 600)} …` : s };
  };
  for (const coll of Object.keys(saved) as Coll[]) {
    const a = (current[coll] ?? {}) as Record<string, unknown>;
    const b = saved[coll] as Record<string, unknown>;
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      // (the change log stays as it is: it records the restore too)
      if (coll === 'settings' && id === 'log') continue;
      if (JSON.stringify(a[id]) === JSON.stringify(b[id])) continue;
      const person = ((b[id] ?? a[id]) as { person?: string } | undefined)?.person;
      out.push({
        id: `${coll}/${id}`,
        kind: 'konflikt',
        group: person ?? COLL_NAME[coll] ?? coll,
        label: `${COLL_NAME[coll] ?? coll}${coll === 'items' ? '' : ` „${id}“`}${b[id] == null ? ': im gespeicherten Stand nicht vorhanden' : a[id] == null ? ': fehlt heute' : ''}`,
        current: a[id] == null ? undefined : show(coll, a[id]),
        incoming: b[id] == null ? undefined : show(coll, b[id]),
        choice: 'neu',
        apply: (c, w) => {
          if (c !== 'neu') return;
          const target = w[coll] as Record<string, unknown>;
          if (b[id] == null) delete target[id];
          else target[id] = b[id];
        },
      });
    }
  }
  return out;
}
