// Übersicht: the participants' profile, the core quantitative results, and
// the most frequent UX problems, positive and unexpected observations (from
// the confirmed tags). Opens on the whole sample.
import { Bars, SERIES, INK, Segments } from '../charts';
import { PRECISION_LABEL, SOURCE_LABEL, timingSummary, type TimingStat } from '../timing';
import { fmtBerlin } from '../match';
import { distinctPersons, findingsOf, itemsWithRole, type Model, type Slice } from '../model';
import { part4, type P4Field } from '../analysis';
import { useState } from 'react';
import { describe, fmt } from '../stats';
import { CATEGORY } from '../types';
import { csv, Empty, Fig, fmtDate, Section, Stat, useCtx } from '../ui';
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

// ages: the Tally answer, a correction on the Teilnehmende page wins
function agesOf(s: Slice) {
  const ages = s.survey.map((r) => ageOf(r.info)).filter((a): a is number => a != null);
  const bins = [];
  if (ages.length) {
    const lo = Math.floor(Math.min(...ages) / 5) * 5;
    const hi = Math.floor(Math.max(...ages) / 5) * 5;
    for (let b = lo; b <= hi; b += 5) bins.push({ label: `${b}–${b + 4}`, values: [ages.filter((a) => a >= b && a < b + 5).length] });
  }
  return { ages, bins };
}
const groupsOf = (s: Slice) => ({ AB: s.persons.filter((p) => p.group === 'AB').length, BA: s.persons.filter((p) => p.group === 'BA').length });
const catsOf = (s: Slice, model: Model) => [
  { label: CATEGORY.essential, items: itemsWithRole(s.items, model, 'essential') },
  { label: CATEGORY.positive, items: itemsWithRole(s.items, model, 'positive') },
  { label: CATEGORY.surprise, items: itemsWithRole(s.items, model, 'surprise') },
  { label: CATEGORY.intervention, items: itemsWithRole(s.items, model, 'intervention') },
  { label: CATEGORY.recurring, items: s.items.filter((i) => findingsOf(i).length > 0) },
];

export default function Overview() {
  const { model, slice, scope, omitted } = useCtx();
  const all = scope.kind === 'all';
  const n = slice.persons.length;
  const nAll = model.included.length;
  const groups = groupsOf(slice);
  const dates = slice.persons.map((p) => p.date).filter((d): d is number => !!d);
  // durations per participant (links are attempts, never extra participants)
  const ts = timingSummary(slice.persons.map((p) => p.timing));
  const mins = (v: number | null) => (v != null ? `${fmt(v, 1)} min` : '–');
  const pm = (x: TimingStat) => (x.n ? `${fmt(x.mean, 1)}${x.n > 1 ? ` ± ${fmt(x.sd, 1)}` : ''} min` : '–');
  const [measure, setMeasure] = useState<'aktiv' | 'verstrichen' | 'sauber'>('aktiv');
  // one link chosen at the top: the numbers are that attempt's; the person's total for comparison
  const whole = scope.kind === 'link' ? model.included.find((p) => p.id === slice.persons[0]?.id) : undefined;
  const attempt = whole?.timing.attempts.find((a) => scope.kind === 'link' && a.key === scope.key);

  // Teil 4 (age has its own figure)
  const p4 = part4(slice.survey, model.optionQuestions).filter((f) => !/^alter$|^age$/i.test(f.label));

  return (
    <>
      <div className="st-stats">
        <Stat
          label="Teilnehmende"
          value={n}
          n={nAll !== n || model.persons.length > nAll ? `von ${model.persons.length} erfasst` : undefined}
          details={all && (model.persons.length > nAll || omitted.length) ? [model.persons.length > nAll ? `${model.persons.length - nAll} ausgeschlossen (Teilnehmende & Sessions)` : '', omitted.length ? `ohne ${omitted.join(', ')} (Auswahl oben)` : ''].filter(Boolean).join(' · ') : undefined}
        />
        <Stat label="Testgruppen" value={`${groups.AB} AB · ${groups.BA} BA`} n={`n = ${n}`} />
        <Stat label="Zeitraum" value={dates.length ? `${fmtDate(Math.min(...dates))}${dates.length > 1 && fmtDate(Math.min(...dates)) !== fmtDate(Math.max(...dates)) ? ` – ${fmtDate(Math.max(...dates))}` : ''}` : '–'} />
        <Stat
          label="Aktive Spieldauer (M ± SD)"
          value={ts.estimated ? pm(ts.activeMeasured) : pm(ts.active)}
          n={ts.estimated ? `n = ${ts.activeMeasured.n}/${ts.active.N} gemessen` : `n = ${ts.active.n}/${ts.active.N}`}
          sub={ts.estimated ? `mit Schätzungen: ${pm(ts.active)} · n = ${ts.active.n}/${ts.active.N} (${ts.estimated} geschätzt)` : undefined}
          details={
            <>
              Aktive Spielzeit je Person, über alle ihre Versuche (Links) zusammengezählt; je Person ein Wert. <b>Gemessen</b>: von der Spiel-Uhr erfasst. <b>Geschätzt</b>: aus den Zeiten der Quest-Schritte oder den Spielereignissen berechnet, oder von Hand eingetragen. Der Hauptwert enthält nur gemessene Zeiten; „mit Schätzungen“ nimmt beide zusammen. Verstrichen (erster Start bis letztes Ende): {pm(ts.elapsed)}. <a href="#teilnehmende">Zeiten bearbeiten</a>
            </>
          }
        />
        {whole && attempt ? (
          <Stat label="Versuch" value={`${attempt.n.value} von ${whole.timing.attemptCount}`} n={attempt.label} details={`${attempt.outcome.value} · ganze Person: aktiv ${mins(whole.timing.active.value)}, verstrichen ${mins(whole.timing.elapsed.value)}`} />
        ) : (
          <Stat label="Mit Neustart" value={`${ts.withRestart}/${ts.N}`} n={`Ø ${fmt(ts.attemptsMean, 1)} Versuche je Person`} details={`Teilnehmende mit mehr als einem Link (Versuch). Technische Unterbrechung: ${ts.technical}/${ts.N}.`} />
        )}
        <Stat
          label="Saubere Durchlaufzeit (M ± SD)"
          value={pm(ts.clean)}
          n={`n = ${ts.clean.n}/${ts.clean.N}`}
          details="Nur gültige Erstdurchläufe: ein Versuch, abgeschlossen, ohne Unterbrechung, exakt gemessen. Alle anderen zählen nicht (kein Wert statt 0)."
        />
      </div>

      <Section title="Teilnehmerprofil">
        <div className="st-grid">
          <Fig id="alter" valid={(s) => agesOf(s).ages.length} table={(s) => csv([['Alter', 'Anzahl'], ...agesOf(s).bins.map((b) => [b.label, b.values[0]])])}>
            {(s) => {
              const { ages, bins } = agesOf(s);
              const ageD = describe(ages);
              return ages.length ? (
                <>
                  <Bars rows={bins} />
                  <p className="st-note">
                    M = {fmt(ageD.mean, 1)}, SD = {fmt(ageD.sd, 1)}, Spanne {ageD.min}–{ageD.max} (n = {ageD.n})
                  </p>
                </>
              ) : (
                <Empty>
                  Keine gültigen Altersdaten (n = 0)
                  <span className="st-empty-line2">Tally-Spalte unter Daten &amp; Validierung als „Alter“ zuordnen.</span>
                </Empty>
              );
            }}
          </Fig>
          <Fig id="gruppe" valid={(s) => groupsOf(s).AB + groupsOf(s).BA} table={(s) => csv([['Gruppe', 'Anzahl'], ['AB', groupsOf(s).AB], ['BA', groupsOf(s).BA]])}>
            {(s) => (
              <Bars
                rows={[
                  { label: 'AB (zuerst A)', values: [groupsOf(s).AB] },
                  { label: 'BA (zuerst B)', values: [groupsOf(s).BA] },
                ]}
              />
            )}
          </Fig>
          <Fig
            id="laufzeit"
            valid={(s) => {
              const st = timingSummary(s.persons.map((p) => p.timing));
              return (measure === 'aktiv' ? st.active : measure === 'verstrichen' ? st.elapsed : st.clean).n;
            }}
            tabs={
              <div className="st-tabs" role="tablist" aria-label="Maß">
                    {(
                      [
                        ['aktiv', 'Aktiv'],
                        ['verstrichen', 'Verstrichen'],
                        ['sauber', 'Sauber'],
                      ] as const
                    ).map(([k, l]) => (
                      <button key={k} type="button" role="tab" aria-selected={measure === k} className={measure === k ? 'is-on' : ''} onClick={() => setMeasure(k)}>
                        {l}
                      </button>
                    ))}
                  </div>
            }
            table={(s) =>
              csv([
                ['Teilnehmende', 'Versuch', 'Link', 'Start (dt. Zeit)', 'Ende (dt. Zeit)', 'Aktiv (min)', 'Ausgang', 'Quelle', 'Genauigkeit', 'Verstrichen (min)', 'Aktiv gesamt (min)', 'Aktiv geschätzt', 'Unterbrechung (min)', 'Saubere Erstdurchlaufzeit (min)', 'In sauberer Statistik', 'Ausschlussgrund'],
                ...s.persons.flatMap((p) => {
                  const t = p.timing;
                  const per = [p.id, '', '', '', '', '', '', SOURCE_LABEL[t.source.value], PRECISION_LABEL[t.precision.value], m1(t.elapsed.value), m1(t.active.value), t.activeEstimated ? 'ja' : 'nein', m1(t.interruption.value), m1(t.clean.value), t.eligible.value ? 'ja' : 'nein', t.exclusionReason.value];
                  return [per, ...t.attempts.map((a) => [p.id, a.n.value, a.label, a.start.value ? fmtBerlin(a.start.value) : '', a.end.value ? fmtBerlin(a.end.value) : '', m1(a.active.value), a.outcome.value, SOURCE_LABEL[a.source.value], PRECISION_LABEL[a.precision.value], '', '', '', '', '', '', ''])];
                }),
              ])
            }
          >
            {(s) => {
              const st = timingSummary(s.persons.map((p) => p.timing));
              const maxAttempts = Math.max(1, ...s.persons.map((p) => p.timing.attemptCount));
              const flags = (p: (typeof s.persons)[number]) =>
                [p.timing.attemptCount > 1 ? `${p.timing.attemptCount} Versuche` : '', (p.timing.interruption.value ?? 0) > 10 || p.timing.technical.value ? 'unterbrochen' : ''].filter(Boolean);
              const rows = s.persons.map((p) => {
                const t = p.timing;
                const v = measure === 'aktiv' ? t.active.value : measure === 'verstrichen' ? t.elapsed.value : t.eligible.value ? t.clean.value : null;
                const segments =
                  measure === 'aktiv' && t.attempts.length > 1
                    ? t.attempts.map((a) => ({ value: a.active.value ?? 0, name: `Versuch ${a.n.value} (${a.label})` }))
                    : v != null
                      ? [{ value: v, name: measure === 'aktiv' ? 'aktiv' : measure }]
                      : [];
                // (why someone has no clean value is listed below the chart, so the bars keep their width)
                const fl = measure === 'sauber' ? [] : flags(p);
                return { label: scope.kind === 'link' ? scope.id : p.id, estimated: measure === 'aktiv' && t.activeEstimated, segments, note: `${v != null ? `${fmt(v, 1)} min` : '–'}${fl.length ? ` · ${fl.join(', ')}` : ''}` };
              });
              const stat = measure === 'aktiv' ? st.active : measure === 'verstrichen' ? st.elapsed : st.clean;
              return (
                <>
                  {rows.some((r) => r.segments.length) ? (
                    <Segments rows={rows} digits={1} unit=" min" legend={measure === 'aktiv' && maxAttempts > 1 ? Array.from({ length: maxAttempts }, (_, i) => `Versuch ${i + 1}`) : undefined} />
                  ) : (
                    <Empty>{measure === 'sauber' ? 'Noch kein gültiger Erstdurchlauf.' : 'Keine Zeiten.'}</Empty>
                  )}
                  {measure === 'sauber' && s.persons.some((p) => !p.timing.eligible.value) && (
                    <ul className="st-excl">
                      {s.persons
                        .filter((p) => !p.timing.eligible.value)
                        .map((p) => (
                          <li key={p.id}>
                            <span className="st-pid">{p.id}</span> {p.timing.exclusionReason.value || 'kein gültiger Wert'}
                          </li>
                        ))}
                    </ul>
                  )}
                  <p className="st-note">
                    {measure === 'aktiv' ? 'Aktive Spielzeit je Teilnehmenden, Segmente = Versuche (Links); wiederholte Abschnitte eingeschlossen; schraffiert = geschätzt.' : measure === 'verstrichen' ? 'Verstrichene Zeit vom ersten Start bis zum letzten Ende, Pausen eingeschlossen.' : 'Gültige, ununterbrochene Erstdurchläufe; übrige ohne Wert (nicht 0).'}{' '}
                    {measure === 'aktiv' && st.estimated
                      ? `Gemessen: ${st.activeMeasured.n ? `M = ${fmt(st.activeMeasured.mean, 1)} min${st.activeMeasured.n > 1 ? `, SD = ${fmt(st.activeMeasured.sd, 1)}` : ''}` : '–'}, n = ${st.activeMeasured.n}/${st.N}. Mit Schätzungen: M = ${fmt(st.active.mean, 1)} min${st.active.n > 1 ? `, SD = ${fmt(st.active.sd, 1)}` : ''}, n = ${st.active.n}/${st.N} (${st.estimated} geschätzt).`
                      : stat.n
                        ? `M = ${fmt(stat.mean, 1)} min, SD = ${fmt(stat.sd, 1)}, Median ${fmt(stat.median, 1)}, n = ${stat.n}/${stat.N}.`
                        : `n = 0/${stat.N}.`}{' '}
                    {whole && attempt ? `Nur ${attempt.label} (Versuch ${attempt.n.value} von ${whole.timing.attemptCount}).` : 'Je Person ein Wert, mehrere Links zählen nicht mehrfach.'}
                  </p>
                </>
              );
            }}
          </Fig>
          {p4.length > 0 && <Profile fields={p4} />}
          <Fig id="kategorien" valid={(s) => distinctPersons(catsOf(s, model).flatMap((c) => c.items))} table={(s) => csv([['Kategorie', 'Rückmeldungen', 'Teilnehmende'], ...catsOf(s, model).map((c) => [c.label, c.items.length, distinctPersons(c.items)])])}>
            {(s) =>
              catsOf(s, model).some((c) => c.items.length) ? (
                <Bars
                  rows={catsOf(s, model).map((c) => ({ label: c.label, values: [c.items.length, distinctPersons(c.items)] }))}
                  series={[
                    { name: 'Rückmeldungen', color: INK },
                    { name: 'Teilnehmende', color: SERIES.B },
                  ]}
                />
              ) : (
                <Empty>
                  Noch keine bestätigten Rückmeldungen (n = 0)
                  <span className="st-empty-line2">Aussagen unter Qualitatives Feedback taggen und als geprüft markieren.</span>
                </Empty>
              )
            }
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
// an answer filter marks one answer and names who gave it. The questions are
// the whole sample's (stable list and numbers); the counts the figure's slice.
function profileOf(s: Slice, model: Model) {
  const persons = s.persons.map((p) => p.id);
  const rowOf = (person: string) => s.survey.find((r) => r.person === person);
  // (a question exported as one column per option: the options ticked)
  const answerOf = (person: string, label: string) => rowOf(person)?.multi[label]?.join(', ') ?? rowOf(person)?.info[label] ?? '';
  const gave = (person: string, label: string, v: string) => {
    const multi = rowOf(person)?.multi[label];
    if (multi) return multi.includes(v);
    const a = answerOf(person, label);
    return a === v || a.split(/\s*,\s*(?=[A-ZÄÖÜ])/).includes(v);
  };
  const here = part4(s.survey, model.optionQuestions);
  const counted = (fs: P4Field[]): P4Field[] => fs.map((f) => here.find((x) => x.label === f.label) ?? { ...f, counts: [], stats: null, n: 0 });
  return { persons, answerOf, gave, counted };
}

function Profile({ fields }: { fields: P4Field[] }) {
  const { study, model } = useCtx();
  const T = useSurveyText(study);
  const [pick, setPick] = useState('');
  const [answer, setAnswer] = useState(''); // "question\u0000answer"
  const i = fields.findIndex((f) => f.label === pick);
  // the questions offered (all or the one picked), and the ones drawn: an answer filter narrows to its question
  const listed = i >= 0 ? [fields[i]] : fields;
  const [aq, av] = answer ? answer.split('\u0000') : ['', ''];
  const shownAll = aq ? fields.filter((f) => f.label === aq) : listed;
  return (
    <Fig
      id="teil4"
      sub={shownAll.length === 1 && fields.length > 1 ? { n: fields.indexOf(shownAll[0]) + 1, title: T(shownAll[0].label) } : undefined}
      valid={(s) => {
        const { persons, answerOf } = profileOf(s, model);
        return shownAll.map((f) => persons.filter((p) => answerOf(p, f.label)).length);
      }}
      table={(s) => {
        const { persons, gave, counted } = profileOf(s, model);
        return csv([['Frage', 'Antwort', 'Anzahl', 'Teilnehmende'], ...counted(shownAll).flatMap((f) => f.counts.map(([v, c]) => [f.label, v, c, persons.filter((p) => gave(p, f.label, v)).join(' ')]))]);
      }}
    >
      {(s) => {
        const { persons, answerOf, gave, counted } = profileOf(s, model);
        const shown = counted(shownAll);
        const chosenBy = aq ? persons.filter((p) => gave(p, aq, av)) : [];
        const rowsOf = (f: P4Field) => {
          const missing = persons.filter((p) => !answerOf(p, f.label)).length;
          return [
            ...f.counts.map(([v, c]) => ({ label: T(v), values: [c], color: aq === f.label ? (v === av ? SERIES.B : '#c9c8c2') : undefined })),
            ...(missing ? [{ label: 'keine Angabe', values: [missing], color: '#c9c8c2' }] : []),
          ];
        };
        return (
          <>
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
                {counted(listed).map((f) => (
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
          </>
        );
      }}
    </Fig>
  );
}
