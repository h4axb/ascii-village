// Übersicht: the participants' profile, the core quantitative results, and
// the most frequent UX problems, positive and unexpected observations (from
// the confirmed tags). Opens on the whole sample.
import { Bars, SERIES, INK } from '../charts';
import { distinctPersons, itemsWithRole } from '../model';
import { part4, type P4Field } from '../analysis';
import { useState } from 'react';
import { describe, fmt } from '../stats';
import { CATEGORY } from '../types';
import { csv, Empty, Fig, fmtDate, Section, Stat, useCtx } from '../ui';
import { SurveySummary, TrackingSummary } from './Survey';
import { CraftLog, GameFlow } from './Flow';
import { FeedbackLists } from './Notes';

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
  const p4 = part4(slice.survey).filter((f) => !/^alter$|^age$/i.test(f.label));

  return (
    <>
      <div className="st-stats">
        <Stat label="Teilnehmende" value={n} sub={all && model.persons.length > nAll ? `${model.persons.length - nAll} ausgeschlossen` : undefined} />
        <Stat label="Testgruppen" value={`${groups.AB} AB · ${groups.BA} BA`} />
        <Stat label="Zeitraum" value={dates.length ? `${fmtDate(Math.min(...dates))}${dates.length > 1 && fmtDate(Math.min(...dates)) !== fmtDate(Math.max(...dates)) ? ` – ${fmtDate(Math.max(...dates))}` : ''}` : '–'} />
        <Stat label="Bearbeitungsdauer" value={times.length ? `${fmt(t.median, 1)} min` : '–'} sub={times.length > 1 ? `Median, IQR ${fmt(t.q1, 1)}–${fmt(t.q3, 1)}` : undefined} />
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
          <Fig id="laufzeit" table={() => csv([['Teilnehmende', 'Link', 'Minuten'], ...slice.links.map((l) => [l.person, l.label, l.minutes != null ? fmt(l.minutes, 1) : ''])])}>
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


// Teil 4: every question in one figure; the filter shows one question in its place
function Profile({ fields }: { fields: P4Field[] }) {
  const [pick, setPick] = useState<string>(() => {
    try {
      return localStorage.getItem(PROFILE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const i = fields.findIndex((f) => f.label === pick);
  const shown = i >= 0 ? [fields[i]] : fields;
  const choose = (v: string) => {
    setPick(v);
    try {
      localStorage.setItem(PROFILE_KEY, v);
    } catch {
      // (not remembered)
    }
  };
  return (
    <Fig
      id="teil4"
      sub={i >= 0 ? { n: i + 1, title: fields[i].label } : undefined}
      table={() => csv([['Frage', 'Antwort', 'Anzahl'], ...shown.flatMap((f) => f.counts.map(([v, c]) => [f.label, v, c]))])}
    >
      <select className="st-figfilter" value={i >= 0 ? pick : ''} onChange={(e) => choose(e.target.value)} aria-label="Frage">
        <option value="">Alle Fragen ({fields.length})</option>
        {fields.map((f) => (
          <option key={f.label} value={f.label}>
            {f.label}
          </option>
        ))}
      </select>
      {shown.map((f) => (
        <div key={f.label} className="st-subfig">
          <Bars title={shown.length > 1 ? f.label : undefined} rows={f.counts.map(([v, c]) => ({ label: v, values: [c] }))} />
          {f.stats && (
            <p className="st-note">
              M = {fmt(f.stats.mean, 1)}, SD = {fmt(f.stats.sd, 1)}, Spanne {f.stats.min}–{f.stats.max} (n = {f.n})
            </p>
          )}
        </div>
      ))}
    </Fig>
  );
}
const PROFILE_KEY = 'asciia-study-profile';
