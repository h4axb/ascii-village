// Übersicht: the participants' profile, the core quantitative results, and
// the most frequent UX problems, positive and unexpected observations (from
// the confirmed tags). Opens on the whole sample.
import { Bars, SERIES, INK } from '../charts';
import { distinctPersons, itemsWithRole } from '../model';
import { part4, type P4Field } from '../analysis';
import { useState } from 'react';
import { describe, fmt } from '../stats';
import { CATEGORY } from '../types';
import { csv, DurationSelect, Empty, Fig, fmtDate, Section, Stat, useCtx } from '../ui';
import { SurveySummary, TrackingSummary } from './Survey';
import { useSurveyText } from '../translations';
import { CraftLog, GameFlow } from './Flow';
import { FeedbackLists } from './Notes';

const m1 = (x: number | null) => (x != null ? fmt(x, 1) : '');

export function ageOf(info: Record<string, string>): number | null {
  const v = info.Alter ?? Object.entries(info).find(([k]) => /alter|age/i.test(k))?.[1];
  const n = v ? Number(/\d{1,3}/.exec(v)?.[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function Overview() {
  const { model, slice, scope } = useCtx();
  const all = scope.kind === 'all';
  const n = slice.persons.length;
  const nAll = model.included.length;
  const groups = { AB: slice.persons.filter((p) => p.group === 'AB').length, BA: slice.persons.filter((p) => p.group === 'BA').length };
  const times = slice.persons.map((p) => p.minutes).filter((m): m is number => m != null);
  const dates = slice.persons.map((p) => p.date).filter((d): d is number => !!d);
  const t = describe(times);

  // ages: the Tally answer, a correction on the Teilnehmende page wins
  const ages = slice.survey.map((r) => ageOf(r.info)).filter((a): a is number => a != null);
  const ageD = describe(ages);
  const ageBins = (() => {
    if (!ages.length) return [];
    const lo = Math.floor(Math.min(...ages) / 5) * 5;
    const hi = Math.floor(Math.max(...ages) / 5) * 5;
    const out = [];
    for (let b = lo; b <= hi; b += 5) out.push({ label: `${b}–${b + 4}`, values: [ages.filter((a) => a >= b && a < b + 5).length] });
    return out;
  })();

  const cats = [
    { label: CATEGORY.essential, items: itemsWithRole(slice.items, model, 'essential') },
    { label: CATEGORY.positive, items: itemsWithRole(slice.items, model, 'positive') },
    { label: CATEGORY.surprise, items: itemsWithRole(slice.items, model, 'surprise') },
    { label: CATEGORY.intervention, items: itemsWithRole(slice.items, model, 'intervention') },
    { label: CATEGORY.recurring, items: slice.items.filter((i) => i.finding) },
  ];

  // Teil 4 (age has its own figure)
  const p4 = part4(slice.survey, model.optionQuestions).filter((f) => !/^alter$|^age$/i.test(f.label));

  return (
    <>
      <div className="st-stats">
        <Stat label="Teilnehmende" value={n} sub={all && model.persons.length > nAll ? `${model.persons.length - nAll} ausgeschlossen` : undefined} />
        <Stat label="Testgruppen" value={`${groups.AB} AB · ${groups.BA} BA`} />
        <Stat label="Zeitraum" value={dates.length ? `${fmtDate(Math.min(...dates))}${dates.length > 1 && fmtDate(Math.min(...dates)) !== fmtDate(Math.max(...dates)) ? ` – ${fmtDate(Math.max(...dates))}` : ''}` : '–'} />
        <Stat
          label="Bearbeitungsdauer"
          value={times.length ? `${Math.round(t.median)} min` : '–'}
          sub={
            <>
              {times.length > 1 ? `Median, IQR ${Math.round(t.q1)}–${Math.round(t.q3)} min · ` : ''}
              <a href="#teilnehmende">bearbeiten</a>
            </>
          }
        />
      </div>

      <Section title="Teilnehmerprofil">
        <div className="st-grid">
          <Fig id="alter" table={() => csv([['Alter', 'Anzahl'], ...ageBins.map((b) => [b.label, b.values[0]])])}>
            {ages.length ? (
              <>
                <Bars rows={ageBins} />
                <p className="st-note">
                  M = {fmt(ageD.mean, 1)}, SD = {fmt(ageD.sd, 1)}, Spanne {ageD.min}–{ageD.max} (n = {ageD.n})
                </p>
              </>
            ) : (
              <Empty>Keine Altersangaben (Import: Tally-Spalte als „Alter“ zuordnen).</Empty>
            )}
          </Fig>
          <Fig id="gruppe" table={() => csv([['Gruppe', 'Anzahl'], ['AB', groups.AB], ['BA', groups.BA]])}>
            <Bars
              rows={[
                { label: 'AB (zuerst A)', values: [groups.AB] },
                { label: 'BA (zuerst B)', values: [groups.BA] },
              ]}
            />
          </Fig>
          <Fig
            id="laufzeit"
            table={() =>
              csv([
                ['Teilnehmende', 'Link', 'Bearbeitungsdauer (min)', 'Spiel-Uhr (min)', 'Link-Dauer (min)', 'Schritte (min)', 'Unterbrechungen', 'Unterbrechungen (min)'],
                ...slice.links.map((l) => [l.person, l.label, m1(l.minutes), m1(l.clockMinutes), m1(l.linkMinutes), m1(l.stepMinutes), l.gaps.count, m1(l.gaps.minutes)]),
              ])
            }
          >
            <DurationSelect />
            {times.length ? (
              <>
                <Bars rows={slice.persons.filter((p) => p.minutes != null).map((p) => ({ label: p.id, values: [p.minutes!], note: p.links.length > 1 ? `${fmt(p.minutes!, 1)} (${p.links.length} Links)` : undefined }))} digits={1} />
                <p className="st-note">
                  M = {fmt(t.mean, 1)} min, SD = {fmt(t.sd, 1)}, Median {fmt(t.median, 1)}
                </p>
              </>
            ) : (
              <Empty>Keine abgeschlossenen Durchläufe.</Empty>
            )}
          </Fig>
          {p4.length > 0 && <Profile fields={p4} />}
          <Fig id="kategorien" table={() => csv([['Kategorie', 'Rückmeldungen', 'Teilnehmende'], ...cats.map((c) => [c.label, c.items.length, distinctPersons(c.items)])])}>
            <Bars
              rows={cats.map((c) => ({ label: c.label, values: [c.items.length, distinctPersons(c.items)] }))}
              series={[
                { name: 'Rückmeldungen', color: INK },
                { name: 'Teilnehmende', color: SERIES.B },
              ]}
            />
            {!slice.items.length && <Empty>Noch keine bestätigten Rückmeldungen (Notizen).</Empty>}
          </Fig>
        </div>
      </Section>

      <SurveySummary />
      <TrackingSummary />
      <CraftLog />
      <GameFlow />
      <FeedbackLists />
    </>
  );
}


// Teil 4: every question with all its answer options in one figure (all
// questions by default); a question filter shows one question in its place,
// an answer filter marks one answer and names who gave it
function Profile({ fields }: { fields: P4Field[] }) {
  const { slice, study } = useCtx();
  const T = useSurveyText(study);
  const [pick, setPick] = useState('');
  const [answer, setAnswer] = useState(''); // "question\u0000answer"
  const i = fields.findIndex((f) => f.label === pick);
  // the questions offered (all or the one picked), and the ones drawn: an answer filter narrows to its question
  const listed = i >= 0 ? [fields[i]] : fields;
  const [aq, av] = answer ? answer.split('\u0000') : ['', ''];
  const shown = aq ? fields.filter((f) => f.label === aq) : listed;
  const persons = slice.persons.map((p) => p.id);
  const rowOf = (person: string) => slice.survey.find((r) => r.person === person);
  // (a question exported as one column per option: the options ticked)
  const answerOf = (person: string, label: string) => rowOf(person)?.multi[label]?.join(', ') ?? rowOf(person)?.info[label] ?? '';
  const gave = (person: string, label: string, v: string) => {
    const multi = rowOf(person)?.multi[label];
    if (multi) return multi.includes(v);
    const a = answerOf(person, label);
    return a === v || a.split(/\s*,\s*(?=[A-ZÄÖÜ])/).includes(v);
  };
  const chosenBy = aq ? persons.filter((p) => gave(p, aq, av)) : [];
  const rowsOf = (f: P4Field) => {
    const missing = persons.filter((p) => !answerOf(p, f.label)).length;
    return [
      ...f.counts.map(([v, c]) => ({ label: T(v), values: [c], color: aq === f.label ? (v === av ? SERIES.B : '#c9c8c2') : undefined })),
      ...(missing ? [{ label: 'keine Angabe', values: [missing], color: '#c9c8c2' }] : []),
    ];
  };
  return (
    <Fig
      id="teil4"
      sub={shown.length === 1 && fields.length > 1 ? { n: fields.indexOf(shown[0]) + 1, title: T(shown[0].label) } : undefined}
      table={() => csv([['Frage', 'Antwort', 'Anzahl', 'Teilnehmende'], ...shown.flatMap((f) => f.counts.map(([v, c]) => [f.label, v, c, persons.filter((p) => gave(p, f.label, v)).join(' ')]))])}
    >
      <div className="st-figfilters">
        <select
          className="st-figfilter"
          value={i >= 0 ? pick : ''}
          onChange={(e) => {
            setPick(e.target.value);
            if (e.target.value && aq && aq !== e.target.value) setAnswer('');
          }}
          aria-label="Frage"
        >
          <option value="">Alle Fragen ({fields.length})</option>
          {fields.map((f) => (
            <option key={f.label} value={f.label}>
              {T(f.label)}
            </option>
          ))}
        </select>
        <select className="st-figfilter" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Antwort">
          <option value="">Alle Antworten</option>
          {listed.map((f) => (
            <optgroup key={f.label} label={T(f.label)}>
              {f.counts.map(([v, c]) => (
                <option key={v} value={`${f.label}\u0000${v}`}>
                  {T(v)} ({c})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {aq && (
        <p className="st-note">
          „{T(av)}“ ({T(aq)}): {chosenBy.length} von {persons.length} – {chosenBy.join(', ') || 'niemand'}
        </p>
      )}
      {/* all questions in one chart: each question a heading, its options below */}
      <Bars rows={shown.flatMap((f) => [...(shown.length > 1 ? [{ label: `${T(f.label)} (n = ${f.n})`, values: [], heading: true }] : []), ...rowsOf(f)])} />
      {shown
        .filter((f) => shown.length === 1 || f.stats || f.counts.reduce((x, [, c]) => x + c, 0) > f.n)
        .map((f) => (
          <p key={f.label} className="st-note">
            {shown.length > 1 && <>{T(f.label)}: </>}n = {f.n} von {persons.length}
            {f.counts.reduce((x, [, c]) => x + c, 0) > f.n ? ' (Mehrfachauswahl)' : ''}
            {f.stats ? ` · M = ${fmt(f.stats.mean, 1)}, SD = ${fmt(f.stats.sd, 1)}, Spanne ${f.stats.min}–${f.stats.max}` : ''}
          </p>
        ))}
      <details className="st-details">
        <summary>Antworten je Teilnehmer</summary>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                <th>TN</th>
                {listed.map((f) => (
                  <th key={f.label}>{T(f.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {persons.map((p) => (
                <tr key={p} className={aq && gave(p, aq, av) ? 'is-picked' : ''}>
                  <td>
                    <span className="st-pid">{p}</span>
                  </td>
                  {listed.map((f) => (
                    <td key={f.label}>{answerOf(p, f.label) ? T(answerOf(p, f.label)) : <span className="st-muted">–</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Fig>
  );
}
