// German versions of the English texts: the notes' statements (stored on
// each statement) and the survey's questions, answer options and free-text
// answers (a translation memory keyed by the original). AI drafts are
// marked "automatisch" until edited, and a new run never overwrites an
// edited one. The originals are never changed.
import { useEffect, useState } from 'react';
import type { ItemDoc, TallyDoc, TranslationMemory } from './types';
import type { Study } from './store';

// ---- which text the dashboard shows: the German version, the original, or both ----
export type ContentView = 'de' | 'orig' | 'both';
const VIEW_KEY = 'asciia-study-content';
let view: ContentView = (() => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'orig' || v === 'both' ? v : 'de';
  } catch {
    return 'de';
  }
})();
const listeners = new Set<(v: ContentView) => void>();
export function setContentView(v: ContentView) {
  view = v;
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // (not remembered)
  }
  listeners.forEach((f) => f(v));
}
export function useContentView(): ContentView {
  const [v, setV] = useState(view);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

// a text as one string (chart labels): the German version, the original, or "original / German"
export function pick(v: ContentView, orig: string, de: string | undefined): string {
  if (v === 'orig' || !de || de === orig) return orig;
  return v === 'de' ? de : `${orig} / ${de}`;
}
// a statement's text in the chosen view
export const itemText = (v: ContentView, i: ItemDoc) => pick(v, i.text, i.de);

// ---- the survey's translation memory ----
export const memoryOf = (study: Study): TranslationMemory => (study.docs.tally.tr as unknown as TranslationMemory | undefined) ?? {};
export function useTr() {
  const v = useContentView();
  return { view: v, tr: (s: string, study: Study) => pick(v, s, memoryOf(study)[s]?.de) };
}

// every survey text a reader sees: question names, answer options, free-text answers
export function tallyTexts(t: TallyDoc): string[] {
  const out = new Set<string>();
  t.mapping.forEach((m, j) => {
    const vals = () => t.rows.map((r) => (r[j] ?? '').trim()).filter(Boolean);
    if (m.role === 'p1') out.add(m.question);
    else if (m.role === 'option') {
      out.add(m.question);
      out.add(m.option);
    } else if (m.role === 'choice') {
      out.add(m.question);
      for (const v of vals()) out.add(v);
    }
    else if (m.role === 'likert') out.add(m.item);
    else if (m.role === 'info') {
      out.add(m.label);
      if (!m.numeric) for (const v of vals()) for (const part of v.split(/\s*,\s*(?=[A-ZÄÖÜ])/)) out.add(part);
    } else if (m.role === 'text') {
      out.add(m.label);
      for (const v of vals()) out.add(v);
    }
  });
  return [...out].filter((s) => /[a-z]/i.test(s));
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

// German drafts for the survey texts without one
export async function translateTally(study: Study, onProgress?: (d: number, a: number) => void): Promise<number> {
  const t = study.latest().tally.main;
  if (!t) return 0;
  const mem = { ...memoryOf(study) };
  const todo = tallyTexts(t).filter((s) => !mem[s]);
  if (!todo.length) return 0;
  const ids = new Map(todo.map((s) => [hash(s), s]));
  const out = await study.translate([...ids].map(([id, text]) => ({ id, text })), 'de', onProgress);
  const now = { ...memoryOf(study) };
  for (const [id, de] of out) {
    const s = ids.get(id);
    if (s && !now[s]) now[s] = { de, auto: true };
  }
  study.commit([{ coll: 'tally', id: 'tr', data: now }]);
  return out.size;
}

// German drafts for the statements without one (or with a stale draft)
export async function translateNotes(study: Study, only?: ItemDoc[], onProgress?: (d: number, a: number) => void): Promise<number> {
  const items = (only ?? Object.values(study.latest().items)).filter((i) => i.status !== 'removed' && (!i.de || (i.deAuto && i.deStale)));
  if (!items.length) return 0;
  const out = await study.translate(
    items.map((i) => ({ id: i.id, text: i.text })),
    'de',
    onProgress,
  );
  const latest = study.latest().items;
  const put: ItemDoc[] = [];
  for (const [id, de] of out) {
    const cur = latest[id];
    // never over an own wording made meanwhile
    if (!cur || (cur.de && !cur.deAuto)) continue;
    put.push({ ...cur, de, deAuto: true, deStale: false });
  }
  study.commit(put.map((p) => ({ coll: 'items' as const, id: p.id, data: p })));
  return put.length;
}

// the survey texts in the chosen view, for components inside the dashboard
export function useSurveyText(study: Study) {
  const v = useContentView();
  const mem = memoryOf(study);
  return (s: string) => pick(v, s, mem[s]?.de);
}
