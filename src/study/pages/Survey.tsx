// Quantitative Analyse: the Tally survey per method, then the in-game
// ratings and the game's telemetry. Teil 1 direct comparison (sign test,
// Wilson interval), Teil 2 Likert (Wilcoxon, r), Teil 3 UEQ-S (scale means,
// intervals, benchmark, α), Teil 4 the participants' details.
import { Bars, Diverging, Dots, NEUTRAL, SERIES } from '../charts';
import { choices, part1, part2, part2Single, part3, type ChoiceResult, type P1Result, type P2Single, type P3Result } from '../analysis';
import { craftStats, gameRatings, partOfKey, prefChoices, PREF_LABEL, RATING_LABEL, SCOPE_LABEL, type Slice } from '../model';
import { describe, fmt, fmtP, meanCI, pct, UEQS_ITEMS } from '../stats';
import { csv, Empty, Fig, Section, useCtx } from '../ui';
import { useSurveyText } from '../translations';

const AB = [
  { name: 'Variante A', color: SERIES.A },
  { name: 'Variante B', color: SERIES.B },
];
const LIKERT5 = ['1', '2', '3', '4', '5'];
const LIKERT7 = ['1', '2', '3', '4', '5', '6', '7'];
const SCALE_NAME = { pragmatisch: 'Pragmatische Qualität', hedonisch: 'Hedonische Qualität', gesamt: 'Gesamt' } as const;

function NoTally() {
  return (
    <Empty>
      Noch keine Umfragedaten. Den Tally-Export unter <a href="#daten">Daten &amp; Validierung → Hochladen</a> hochladen.
    </Empty>
  );
}

export default function Survey() {
  const { slice, model, study } = useCtx();
  const T = useSurveyText(study);
  const rows = slice.survey;
  if (!model.headers.length)
    return (
      <>
        <NoTally />
        <Telemetry />
      </>
    );
  const p1 = part1(rows);
  const p2 = part2(rows);
  const p2s = part2Single(rows);
  const p3 = part3(rows);
  // choice questions go to the part they sit in (Daten & Validierung), not all to Teil 1
  const parts = study.docs.tally.main?.parts;
  const ch = choices(rows, model.optionQuestions);
  const chIn = (k: number) => ch.filter((c) => Math.max(2, Math.min(3, partOfKey(model, parts, c.question) || 2)) === k);
  const p1In = (k: number) => p1.filter((r) => Math.max(1, Math.min(3, partOfKey(model, parts, r.question) || 1)) === k);
  return (
    <>
      <Section title="Teil 1: Direkter Vergleich" id="teil1">
        {p1In(1).length ? <ChoiceBlock results={p1In(1)} figId="teil1" /> : <Empty>Keine Spalte als „Teil 1“ zugeordnet.</Empty>}
      </Section>

      <Section title="Teil 2: Likert-Skala" id="teil2">
        {p2.length ? (
          <>
            <Fig
              id="teil2"
              table={(s) =>
                csv([
                  ['Item', 'Variante', ...(p2[0].scale === 7 ? LIKERT7 : LIKERT5), 'Median', 'Q1', 'Q3'],
                  ...part2(s.survey).flatMap((r) => [
                    [r.item, 'A', ...r.countsA, fmt(r.A.median, 1), fmt(r.A.q1, 1), fmt(r.A.q3, 1)],
                    [r.item, 'B', ...r.countsB, fmt(r.B.median, 1), fmt(r.B.q1, 1), fmt(r.B.q3, 1)],
                  ]),
                ])
              }
            >
              {(s) => (
                <Diverging
                  scale={p2[0].scale === 7 ? LIKERT7 : LIKERT5}
                  rows={part2(s.survey).flatMap((r) => [
                    { label: `${T(r.item)} – A`, counts: r.countsA },
                    { label: `${T(r.item)} – B`, counts: r.countsB },
                  ])}
                />
              )}
            </Fig>
            <table className="st-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>A: Mdn (IQR)</th>
                  <th>B: Mdn (IQR)</th>
                  <th>n Paare</th>
                  <th>W+ / W−</th>
                  <th>p</th>
                  <th>r</th>
                </tr>
              </thead>
              <tbody>
                {p2.map((r) => (
                  <tr key={r.item}>
                    <td>{T(r.item)}</td>
                    <td>
                      {fmt(r.A.median, 1)} ({fmt(r.A.q1, 1)}–{fmt(r.A.q3, 1)})
                    </td>
                    <td>
                      {fmt(r.B.median, 1)} ({fmt(r.B.q1, 1)}–{fmt(r.B.q3, 1)})
                    </td>
                    <td className="num">
                      {r.pairs}
                      {r.test.zeros ? ` (${r.test.zeros} gleich)` : ''}
                    </td>
                    <td className="num">
                      {fmt(r.test.wPlus, 1)} / {fmt(r.test.wMinus, 1)}
                    </td>
                    <td className="num">{fmtP(r.test.p)}</td>
                    <td className="num">{fmt(r.test.r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="st-note">Exakter Wilcoxon-Vorzeichen-Rang-Test (zweiseitig, B − A, Nulldifferenzen ausgeschlossen); r = Rang-biseriale Korrelation (positiv: B höher).</p>
          </>
        ) : !p2s.length ? (
          <Empty>Keine Spalte als „Teil 2“ zugeordnet.</Empty>
        ) : null}
        {p2s.length > 0 && <Part2Single items={p2s} />}
        {p1In(2).length > 0 && <ChoiceBlock results={p1In(2)} figId="teil2vergleich" />}
        {chIn(2).map((c, i) => (
          <SingleChoice key={c.question} c={c} figId="teil2wahl" n={i + 1} />
        ))}
      </Section>

      <Section title="Teil 3: UEQ-S" id="teil3">
        {p3.answered ? (
          <>
            <Fig
              id="teil3"
              table={(sl) =>
                csv([
                  ['Skala', 'M A', 'KI A', 'SD A', 'α A', 'Benchmark A', 'M B', 'KI B', 'SD B', 'α B', 'Benchmark B', 'p (Wilcoxon)', 'r'],
                  ...part3(sl.survey).scales.map((s) => [
                    SCALE_NAME[s.scale],
                    fmt(s.A.mean),
                    `${fmt(s.A.ci[0])}–${fmt(s.A.ci[1])}`,
                    fmt(s.A.sd),
                    fmt(s.A.alpha),
                    s.A.bench,
                    fmt(s.B.mean),
                    `${fmt(s.B.ci[0])}–${fmt(s.B.ci[1])}`,
                    fmt(s.B.sd),
                    fmt(s.B.alpha),
                    s.B.bench,
                    fmtP(s.test.p),
                    fmt(s.test.r),
                  ]),
                ])
              }
            >
              {(sl) => (
                <Dots
                  series={AB}
                  domain={[-3, 3]}
                  refLines={[0]}
                  rows={part3(sl.survey).scales.map((s) => ({
                    label: SCALE_NAME[s.scale],
                    points: [
                      { value: s.A.mean, lo: s.A.ci[0], hi: s.A.ci[1], series: 0 },
                      { value: s.B.mean, lo: s.B.ci[0], hi: s.B.ci[1], series: 1 },
                    ],
                  }))}
                />
              )}
            </Fig>
            <table className="st-table">
              <thead>
                <tr>
                  <th>Skala</th>
                  <th>A: M [95 %-KI]</th>
                  <th>α</th>
                  <th>Benchmark</th>
                  <th>B: M [95 %-KI]</th>
                  <th>α</th>
                  <th>Benchmark</th>
                  <th>p</th>
                  <th>r</th>
                </tr>
              </thead>
              <tbody>
                {p3.scales.map((s) => (
                  <tr key={s.scale}>
                    <td>{SCALE_NAME[s.scale]}</td>
                    <td>
                      {fmt(s.A.mean)} [{fmt(s.A.ci[0])}; {fmt(s.A.ci[1])}]
                    </td>
                    <td className="num">{fmt(s.A.alpha)}</td>
                    <td>{s.A.bench}</td>
                    <td>
                      {fmt(s.B.mean)} [{fmt(s.B.ci[0])}; {fmt(s.B.ci[1])}]
                    </td>
                    <td className="num">{fmt(s.B.alpha)}</td>
                    <td>{s.B.bench}</td>
                    <td className="num">{fmtP(s.test.p)}</td>
                    <td className="num">{fmt(s.test.r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="st-note">Skalenwerte −3 bis +3 (Schrepp, Hinderks &amp; Thomaschewski, 2017); nur vollständige Skalen. Benchmark-Grenzen vor der Verwendung mit der aktuellen UEQ-S-Handreichung abgleichen.</p>
            <Fig id="teil3items" table={(sl) => csv([['Item', 'M A', 'M B'], ...part3(sl.survey).items.map((i) => [UEQS_ITEMS[i.item].join(' – '), fmt(i.A), fmt(i.B)])])}>
              {(sl) => (
                <Dots
                  series={AB}
                  domain={[-3, 3]}
                  refLines={[0]}
                  rows={part3(sl.survey).items.map((i) => ({
                    label: UEQS_ITEMS[i.item].join(' – '),
                    points: [
                      { value: i.A, lo: NaN, hi: NaN, series: 0 },
                      { value: i.B, lo: NaN, hi: NaN, series: 1 },
                    ],
                  }))}
                />
              )}
            </Fig>
          </>
        ) : !p3.overall ? (
          <Empty>Keine Spalte als „Teil 3“ zugeordnet.</Empty>
        ) : null}
        {p3.overall && <Part3Overall p3={p3} />}
        {p1In(3).length > 0 && <ChoiceBlock results={p1In(3)} figId="teil3vergleich" />}
        {chIn(3).map((c, i) => (
          <SingleChoice key={c.question} c={c} figId="teil3wahl" n={i + 1} />
        ))}
      </Section>

      <Telemetry />
      <FreeText />
    </>
  );
}

function FreeText() {
  const { slice, study } = useCtx();
  const T = useSurveyText(study);
  const labels = [...new Set(slice.survey.flatMap((r) => Object.keys(r.text)))];
  if (!labels.length) return null;
  return (
    <Section title="Freitextantworten">
      {labels.map((l) => (
        <div key={l} className="st-quotes">
          <h3 data-notr>{T(l)}</h3>
          <ul>
            {slice.survey
              .filter((r) => r.text[l])
              .sort(byPerson)
              .map((r) => (
                <li key={r.row}>
                  <span className="st-pid">{r.person ?? `Zeile ${r.row + 1}`}</span> <span data-notr>{T(r.text[l])}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

// the short form on the Übersicht
export function SurveySummary() {
  const { slice, model, study } = useCtx();
  const T = useSurveyText(study);
  if (!model.headers.length) return null;
  const p1 = part1(slice.survey);
  const p2 = part2(slice.survey);
  const p3 = part3(slice.survey);
  return (
    <Section title="Umfrage">
      <table className="st-table">
        <thead>
          <tr>
            <th>Methode</th>
            <th>Ergebnis</th>
            <th>p</th>
          </tr>
        </thead>
        <tbody>
          {p1.map((r) => (
            <tr key={`1${r.question}`}>
              <td>
                Teil {Math.max(1, partOfKey(model, study.docs.tally.main?.parts, r.question) || 1)}: {T(r.question)}
              </td>
              <td>{r.winner ? `${r.winner} ${r.k}/${r.decided} (${pct(r.share)}), keine Präferenz ${r.neutral}` : `unentschieden (${r.A}:${r.B})`}</td>
              <td className="num">{fmtP(r.p)}</td>
            </tr>
          ))}
          {p2.map((r) => (
            <tr key={`2${r.item}`}>
              <td>Teil 2: {T(r.item)}</td>
              <td>
                Mdn A {fmt(r.A.median, 1)}, B {fmt(r.B.median, 1)}; r = {fmt(r.test.r)}
              </td>
              <td className="num">{fmtP(r.test.p)}</td>
            </tr>
          ))}
          {part2Single(slice.survey).map((r) => (
            <tr key={`2s${r.item}`}>
              <td>Teil 2: {T(r.item)}</td>
              <td>
                Mdn {fmt(r.stats.median, 1)} (IQR {fmt(r.stats.q1, 1)}–{fmt(r.stats.q3, 1)}), M = {fmt(r.stats.mean)}
              </td>
              <td className="num">–</td>
            </tr>
          ))}
          {choices(slice.survey, model.optionQuestions).map((c) => (
            <tr key={`c${c.question}`}>
              <td>
                Teil {Math.max(2, partOfKey(model, study.docs.tally.main?.parts, c.question) || 2)}: {T(c.question)}
              </td>
              <td>
                {c.options
                  .map((o) => `${T(o.option)} ${o.k}/${c.n}`)
                  .join(' · ')}
              </td>
              <td className="num">–</td>
            </tr>
          ))}
          {p3.overall?.map((o) => (
            <tr key={`3o${o.scale}`}>
              <td>Teil 3: {SCALE_NAME[o.scale]} (gesamtes Spiel)</td>
              <td>
                M {fmt(o.v.mean)} ({o.v.bench})
              </td>
              <td className="num">–</td>
            </tr>
          ))}
          {p3.answered &&
            p3.scales.map((s) => (
              <tr key={`3${s.scale}`}>
                <td>Teil 3: {SCALE_NAME[s.scale]}</td>
                <td>
                  M A {fmt(s.A.mean)} ({s.A.bench}), B {fmt(s.B.mean)} ({s.B.bench})
                </td>
                <td className="num">{fmtP(s.test.p)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </Section>
  );
}

// in-game ratings and telemetry (the game's own tracking)
const csOf = (s: Slice) => craftStats(s.events, s.feedback);
function Telemetry() {
  return (
      <Section title="In-Game-Ratings und Telemetrie" id="spiel">
        <div className="st-grid">
          <Fig
            id="crafts"
            table={(s) => {
              const cs = csOf(s);
              return csv([['Kennzahl', 'A', 'B'], ['Crafts', cs.A.crafts, cs.B.crafts], ['Überarbeitungen', cs.A.reworks, cs.B.reworks], ['Ersatzergebnisse', cs.A.fallbacks, cs.B.fallbacks], ['Minuten im Crafting', fmt(cs.A.minutes, 1), fmt(cs.B.minutes, 1)]]);
            }}
          >
            {(s) => {
              const cs = csOf(s);
              return (
                <>
                  <Bars
                    rows={[
                      { label: 'Crafts', values: [cs.A.crafts, cs.B.crafts] },
                      { label: 'Überarbeitungen', values: [cs.A.reworks, cs.B.reworks] },
                      { label: 'Ersatzergebnisse', values: [cs.A.fallbacks, cs.B.fallbacks] },
                    ]}
                    series={AB}
                  />
                  <p className="st-note">
                    Zeit im Crafting: A {fmt(cs.A.minutes, 1)} min, B {fmt(cs.B.minutes, 1)} min
                  </p>
                </>
              );
            }}
          </Fig>
          <Fig
            id="votes"
            table={(s) => {
              const cs = csOf(s);
              return csv([['Bewertung', 'A', 'B'], ['Passt', cs.A.up, cs.B.up], ['Nicht ganz', cs.A.down, cs.B.down]]);
            }}
          >
            {(s) => {
              const cs = csOf(s);
              const a = cs.A.up + cs.A.down;
              const b = cs.B.up + cs.B.down;
              return (
                <>
                  <Bars
                    rows={[
                      { label: 'Passt', values: [cs.A.up, cs.B.up] },
                      { label: 'Nicht ganz', values: [cs.A.down, cs.B.down] },
                    ]}
                    series={AB}
                  />
                  {a + b > 0 && (
                    <p className="st-note">
                      Anteil „Passt“: A {a ? Math.round((cs.A.up / a) * 100) : '–'} %, B {b ? Math.round((cs.B.up / b) * 100) : '–'} %
                    </p>
                  )}
                </>
              );
            }}
          </Fig>
          <Fig
            id="spielfragen"
            table={(s) =>
              csv([
                ['Frage', 'M A', 'SD A', 'n A', 'M B', 'SD B', 'n B'],
                ...Object.entries(gameRatings(s.feedback)).map(([q, v]) => [RATING_LABEL[q] ?? q, fmt(describe(v.A).mean), fmt(describe(v.A).sd), v.A.length, fmt(describe(v.B).mean), fmt(describe(v.B).sd), v.B.length]),
              ])
            }
          >
            {(s) => {
              const ratings = gameRatings(s.feedback);
              return Object.keys(ratings).length ? (
                <Dots
                  series={AB}
                  domain={[1, 5]}
                  rows={Object.entries(ratings).map(([q, v]) => ({
                    label: RATING_LABEL[q] ?? q,
                    points: (['A', 'B'] as const).map((d, i) => {
                      const [lo, hi] = meanCI(v[d]);
                      return { value: describe(v[d]).mean, lo, hi, series: i };
                    }),
                  }))}
                />
              ) : (
                <Empty>Keine Bewertungen im Spiel.</Empty>
              );
            }}
          </Fig>
          <Fig
            id="praeferenzen"
            table={(sl) => {
              const { prefs, scopes } = prefChoices(sl.feedback);
              return csv([
                ['Einstellung', 'Wert', 'Anzahl'],
                ...Object.entries(prefs).flatMap(([k, vs]) => Object.entries(vs).map(([v, c]) => [PREF_LABEL[k]?.name ?? k, PREF_LABEL[k]?.values[v] ?? v, c])),
                ...Object.entries(scopes).map(([s, c]) => ['Gültigkeit', SCOPE_LABEL[s] ?? s, c]),
              ]);
            }}
          >
            {(sl) => {
              const { prefs, scopes } = prefChoices(sl.feedback);
              return Object.keys(prefs).length ? (
                <>
                  <Bars rows={Object.entries(prefs).flatMap(([k, vs]) => Object.entries(vs).map(([v, c]) => ({ label: `${PREF_LABEL[k]?.name ?? k}: ${PREF_LABEL[k]?.values[v] ?? v}`, values: [c] })))} />
                  {Object.keys(scopes).length > 0 && (
                    <p className="st-note">
                      Gültigkeit: {Object.entries(scopes).map(([s, c]) => `${SCOPE_LABEL[s] ?? s} ${c}`).join(', ')}
                    </p>
                  )}
                </>
              ) : (
                <Empty>Keine Präferenzen gewählt.</Empty>
              );
            }}
          </Fig>
        </div>
      </Section>

  );
}

// the core numbers of the tracking, for the Übersicht
export function TrackingSummary() {
  const { slice } = useCtx();
  const cs = craftStats(slice.events, slice.feedback);
  const ratings = gameRatings(slice.feedback);
  const share = (u: number, d: number) => (u + d ? pct(u / (u + d)) : '–');
  return (
    <Section title="Spiel-Tracking">
      <table className="st-table">
        <thead>
          <tr>
            <th>Kennzahl</th>
            <th>Variante A</th>
            <th>Variante B</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Crafts / Überarbeitungen</td>
            <td>
              {cs.A.crafts} / {cs.A.reworks}
            </td>
            <td>
              {cs.B.crafts} / {cs.B.reworks}
            </td>
          </tr>
          <tr>
            <td>Anteil „Passt“</td>
            <td>{share(cs.A.up, cs.A.down)}</td>
            <td>{share(cs.B.up, cs.B.down)}</td>
          </tr>
          {Object.entries(ratings).map(([q, v]) => (
            <tr key={q}>
              <td>Bewertung: {RATING_LABEL[q] ?? q} (M)</td>
              <td>{fmt(describe(v.A).mean)}</td>
              <td>{fmt(describe(v.B).mean)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// Teil 2 statements about both designs: distribution and median
function Part2Single({ items }: { items: P2Single[] }) {
  const { study } = useCtx();
  const T = useSurveyText(study);
  const scale = items[0].scale === 7 ? LIKERT7 : LIKERT5;
  return (
    <>
      <Fig id="teil2single" table={(s) => csv([['Aussage', ...scale, 'Median', 'Q1', 'Q3', 'M', 'SD', 'n'], ...part2Single(s.survey).map((r) => [r.item, ...r.counts, fmt(r.stats.median, 1), fmt(r.stats.q1, 1), fmt(r.stats.q3, 1), fmt(r.stats.mean), fmt(r.stats.sd), r.stats.n])])}>
        {(s) => <Diverging scale={scale} rows={part2Single(s.survey).map((r) => ({ label: T(r.item), counts: r.counts }))} />}
      </Fig>
      <table className="st-table">
        <thead>
          <tr>
            <th>Aussage</th>
            <th>Mdn (IQR)</th>
            <th>M (SD)</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.item}>
              <td>{T(r.item)}</td>
              <td>
                {fmt(r.stats.median, 1)} ({fmt(r.stats.q1, 1)}–{fmt(r.stats.q3, 1)})
              </td>
              <td>
                {fmt(r.stats.mean)} ({fmt(r.stats.sd)})
              </td>
              <td className="num">{r.stats.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// one UEQ-S for the whole game (not per design)
function Part3Overall({ p3 }: { p3: P3Result }) {
  const o = p3.overall!;
  return (
    <>
      <Fig id="teil3gesamt" table={(s) => csv([['Skala', 'M', 'KI unten', 'KI oben', 'SD', 'α', 'Benchmark', 'n'], ...(part3(s.survey).overall ?? []).map((x) => [SCALE_NAME[x.scale], fmt(x.v.mean), fmt(x.v.ci[0]), fmt(x.v.ci[1]), fmt(x.v.sd), fmt(x.v.alpha), x.v.bench, x.v.n])])}>
        {(s) => {
          const f = part3(s.survey);
          return (
            <Dots
              series={[{ name: 'Gesamtes Spiel', color: SERIES.B }]}
              domain={[-3, 3]}
              refLines={[0]}
              rows={[
                ...(f.overall ?? []).map((x) => ({ label: SCALE_NAME[x.scale], points: [{ value: x.v.mean, lo: x.v.ci[0], hi: x.v.ci[1], series: 0 }] })),
                ...f.overallItems.map((m, i) => ({ label: UEQS_ITEMS[i].join(' – '), points: [{ value: m, lo: NaN, hi: NaN, series: 0 }] })),
              ]}
            />
          );
        }}
      </Fig>
      <table className="st-table">
        <thead>
          <tr>
            <th>Skala</th>
            <th>M [95 %-KI]</th>
            <th>SD</th>
            <th>α</th>
            <th>Benchmark</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {o.map((x) => (
            <tr key={x.scale}>
              <td>{SCALE_NAME[x.scale]}</td>
              <td>
                {fmt(x.v.mean)} [{fmt(x.v.ci[0])}; {fmt(x.v.ci[1])}]
              </td>
              <td className="num">{fmt(x.v.sd)}</td>
              <td className="num">{fmt(x.v.alpha)}</td>
              <td>{x.v.bench}</td>
              <td className="num">{x.v.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// survey rows by participant (P001, P002, …; unmatched rows last)
const byPerson = (a: { person: string | null; row: number }, b: { person: string | null; row: number }) =>
  (a.person ?? '\uffff').localeCompare(b.person ?? '\uffff', undefined, { numeric: true }) || a.row - b.row;

// choice questions (A / B / no preference, or the 1st / 2nd run): figure, table, sign test
function ChoiceBlock({ results, figId }: { results: P1Result[]; figId: string }) {
  const { study } = useCtx();
  const T = useSurveyText(study);
  const p1 = results;
  // (the figure's own slice: the same questions, counted without the ones left out)
  const of = (s: Slice) => {
    const all = part1(s.survey);
    return p1.map((r) => all.find((x) => x.question === r.question) ?? { ...r, A: 0, B: 0, neutral: 0, n: 0 });
  };
  return (
    <>
            <Fig
              id={figId}
              table={(s) => csv([['Frage', 'A', 'B', 'Keine Präferenz', 'n', 'Anteil Mehrheit', 'KI unten', 'KI oben', 'p (Vorzeichentest)'], ...of(s).map((r) => [r.question, r.A, r.B, r.neutral, r.n, fmt(r.share), fmt(r.ci[0]), fmt(r.ci[1]), fmtP(r.p)])])}
            >
              {(s) => (
                <Bars
                  rows={of(s).map((r) => ({ label: T(r.question), values: [r.A, r.B, r.neutral] }))}
                  series={[...AB, { name: 'Keine Präferenz', color: NEUTRAL }]}
                />
              )}
            </Fig>
            <table className="st-table">
              <thead>
                <tr>
                  <th>Frage</th>
                  <th>A</th>
                  <th>B</th>
                  <th>Keine</th>
                  <th>Mehrheit</th>
                  <th>95 %-KI</th>
                  <th>p</th>
                </tr>
              </thead>
              <tbody>
                {p1.map((r) => (
                  <tr key={r.question}>
                    <td>
                      {T(r.question)}
                      {r.swapped > 0 && <span className="st-flag"> {r.swapped}× korrigiert</span>}
                    </td>
                    <td className="num">{r.A}</td>
                    <td className="num">{r.B}</td>
                    <td className="num">{r.neutral}</td>
                    <td>{r.winner ? `${r.winner}: ${r.k}/${r.decided} (${pct(r.share)})` : 'unentschieden'}</td>
                    <td>{r.decided ? `${pct(r.ci[0])}–${pct(r.ci[1])}` : '–'}</td>
                    <td className="num">{fmtP(r.p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="st-note">Exakter Vorzeichentest (zweiseitig) über die Urteile mit Präferenz; „keine Präferenz“ ausgeschlossen. Wilson-Intervall für den Anteil der Mehrheit.</p>
    </>
  );
}

// a single-choice question with several options: one bar per option, share and interval
function SingleChoice({ c, figId, n }: { c: ChoiceResult; figId: string; n: number }) {
  const { study, slice } = useCtx();
  const T = useSurveyText(study);
  const { model } = useCtx();
  // (the figure's own slice: the same options, counted without the ones left out)
  const of = (s: Slice): ChoiceResult => choices(s.survey, model.optionQuestions).find((x) => x.question === c.question) ?? { ...c, n: 0, options: c.options.map((o) => ({ ...o, k: 0, share: 0, persons: [] })) };
  return (
    <>
      <Fig id={figId} sub={{ n, title: T(c.question) }} table={(s) => csv([['Antwort', 'n', 'Anteil', 'KI unten', 'KI oben', 'Teilnehmende'], ...of(s).options.map((o) => [o.option, o.k, fmt(o.share), fmt(o.ci[0]), fmt(o.ci[1]), o.persons.join(' ')])])}>
        {(s) => {
          const cc = of(s);
          const missing = s.persons.length - cc.n;
          return <Bars rows={[...cc.options.map((o) => ({ label: T(o.option), values: [o.k], note: `${o.k} (${pct(o.share)})` })), ...(missing > 0 ? [{ label: 'keine Angabe', values: [missing], color: NEUTRAL }] : [])]} />;
        }}
      </Fig>
      <table className="st-table">
        <thead>
          <tr>
            <th>Antwort</th>
            <th className="num">n</th>
            <th className="num">Anteil</th>
            <th>95 %-KI</th>
            <th>Teilnehmende</th>
          </tr>
        </thead>
        <tbody>
          {c.options.map((o) => (
            <tr key={o.option}>
              <td>{T(o.option)}</td>
              <td className="num">{o.k}</td>
              <td className="num">{pct(o.share)}</td>
              <td>
                {pct(o.ci[0])}–{pct(o.ci[1])}
              </td>
              <td className="st-muted">{o.persons.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="st-note">
        Einfachauswahl, n = {c.n} von {slice.persons.length}; Anteile der Antwortenden mit Wilson-Intervall (95 %). Jede Option wird einzeln gezählt, nicht als A/B-Vergleich.
      </p>
    </>
  );
}
