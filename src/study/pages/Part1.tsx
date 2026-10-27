// "Teil 1: direkter Vergleich" on Teilnehmende & Sessions: per question the
// answer from Tally (1st / 2nd run turned into A / B by the test group, the
// swap applied) or one set by hand – A, B, no preference or no answer. Answers
// set by hand are stored with the person, so a new Tally upload never replaces them.
import type { Person } from '../model';
import type { PersonDoc } from '../types';
import { logChange, useCtx } from '../ui';

type Answer = 'A' | 'B' | 'neutral' | null;
const LABEL: Record<string, string> = { A: 'A', B: 'B', neutral: 'kein Unterschied', null: 'keine Angabe' };
const label = (v: Answer | undefined) => (v === undefined ? '–' : LABEL[String(v)]);

export function Part1Editor({ p }: { p: Person }) {
  const { study, model } = useCtx();
  const questions = [...new Set(model.mapping.flatMap((m) => (m.role === 'p1' ? [m.question] : [])))];
  if (!questions.length) return null;
  const row = model.survey.find((r) => r.person === p.id && r.row >= 0);
  const hand = p.doc.p1 ?? {};
  const group = p.group;
  // "B (2. Durchlauf)": which run the design was for this person
  const run = (v: Answer | undefined) => (v === 'A' || v === 'B') && group ? ` (${group.indexOf(v) + 1}. Durchlauf)` : '';
  const save = (patch: Partial<PersonDoc>, what: string) => {
    study.commit([{ coll: 'people', id: p.id, data: { ...p.doc, id: p.id, ...patch } }]);
    logChange(study, `${p.id}: ${what}`);
  };
  const setAnswer = (q: string, v: string) => {
    const next = { ...hand };
    if (v === '') delete next[q];
    else next[q] = v === 'null' ? null : (v as Answer);
    save({ p1: Object.keys(next).length ? next : undefined }, `Teil 1 „${q}“ → ${v === '' ? 'aus Tally' : LABEL[v]}`);
  };
  const changed = Object.keys(hand).length;
  return (
    <details className="st-part1" open={changed > 0 || !!p.doc.swapP1}>
      <summary>
        Teil 1: direkter Vergleich{changed ? ` · ${changed} von Hand` : ''}
        {p.doc.swapP1 ? ' · A ↔ B getauscht' : ''}
        {!row ? ' · keine Tally-Zeile' : ''}
      </summary>
      <ul className="st-part1-list">
        {questions.map((q) => {
          const tally = row?.p1Tally[q];
          const own = q in hand;
          return (
            <li key={q} className={own ? 'is-manual' : undefined}>
              <span className="st-part1-q">{q}</span>
              <span className="st-inline">
                <select value={own ? String(hand[q]) : ''} onChange={(e) => setAnswer(q, e.target.value)} aria-label={`Teil 1: ${q}`}>
                  <option value="">{row ? `aus Tally: ${label(tally)}${run(tally)}` : 'aus Tally: –'}</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="neutral">kein Unterschied</option>
                  <option value="null">keine Angabe</option>
                </select>
                {own && (
                  <button type="button" className="st-linkbtn st-reset" onClick={() => setAnswer(q, '')} title="zurück zur Tally-Antwort">
                    ↺
                  </button>
                )}
              </span>
              {own && row && <span className="st-muted st-part1-tally">Tally: {label(tally)}{run(tally)}</span>}
            </li>
          );
        })}
      </ul>
      <label className="st-check">
        <input type="checkbox" checked={!!p.doc.swapP1} onChange={(e) => save({ swapP1: e.target.checked }, `Teil 1: Tally-Antworten A ↔ B ${e.target.checked ? 'getauscht' : 'nicht getauscht'}`)} />
        Alle Tally-Antworten A ↔ B tauschen (Person hat A und B verwechselt)
      </label>
      <p className="st-note">A / B = Design. „1. / 2. Durchlauf“ aus Tally wird über die Testgruppe ({group ?? '–'}) umgerechnet. Von Hand gesetzte Antworten werden nicht getauscht und bei einem neuen Tally-Upload nicht überschrieben.</p>
    </details>
  );
}
