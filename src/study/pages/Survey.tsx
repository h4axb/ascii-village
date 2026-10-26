// Quantitative Analyse: the Tally survey per method, then the in-game
// ratings and the game's telemetry. Teil 1 direct comparison (sign test,
// Wilson interval), Teil 2 Likert (Wilcoxon, r), Teil 3 UEQ-S (scale means,
// intervals, benchmark, α), Teil 4 the participants' details.
import { Bars, Diverging, Dots, NEUTRAL, SERIES } from '../charts';
import { part1, part2, part2Single, part3, type P2Single, type P3Result } from '../analysis';
import { craftStats, gameRatings, prefChoices, PREF_LABEL, RATING_LABEL, SCOPE_LABEL } from '../model';
import { describe, fmt, fmtP, meanCI, pct, UEQS_ITEMS } from '../stats';
import { csv, Empty, Fig, Section, useCtx } from '../ui';

const AB = [
  { name: 'Variante A', color: SERIES.A },
  { name: 'Variante B', color: SERIES.B },
];
const LIKERT5 = ['1', '2', '3', '4', '5'];
const LIKERT7 = ['1', '2', '3', '4', '5', '6', '7'];
const SCALE_NAME = { pragmatisch: 'Pragmatische Qualität', hedonisch: 'Hedonische Qualität', gesamt: 'Gesamt' } as const;

function NoTally() {
  return <Empty>Noch keine Umfragedaten. Den Tally-Export unter „Import“ hochladen.</Empty>;
}

export default function Survey() {
  const { slice, model } = useCtx();
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
  return (
    <>
      <Section title="Teil 1: Direkter Vergleich" id="teil1">
        {p1.length ? (
          <>
            <Fig
              id="teil1"
              table={() => csv([['Frage', 'A', 'B', 'Keine Präferenz', 'n', 'Anteil Mehrheit', 'KI unten', 'KI oben', 'p (Vorzeichentest)'], ...p1.map((r) => [r.question, r.A, r.B, r.neutral, r.n, fmt(r.share), fmt(r.ci[0]), fmt(r.ci[1]), fmtP(r.p)])])}
            >
              <Bars
                rows={p1.map((r) => ({ label: r.question, values: [r.A, r.B, r.neutral] }))}
                series={[...AB, { name: 'Keine Präferenz', color: NEUTRAL }]}
              />
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
                      {r.question}
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
        ) : (
          <Empty>Keine Spalte als „Teil 1“ zugeordnet.</Empty>
        )}
      </Section>

      <Section title="Teil 2: Likert-Skala" id="teil2">
        {p2.length ? (
          <>
            <Fig
              id="teil2"
              table={() =>
                csv([
                  ['Item', 'Variante', ...(p2[0].scale === 7 ? LIKERT7 : LIKERT5), 'Median', 'Q1', 'Q3'],
                  ...p2.flatMap((r) => [
                    [r.item, 'A', ...r.countsA, fmt(r.A.median, 1), fmt(r.A.q1, 1), fmt(r.A.q3, 1)],
                    [r.item, 'B', ...r.countsB, fmt(r.B.median, 1), fmt(r.B.q1, 1), fmt(r.B.q3, 1)],
                  ]),
                ])
              }
            >
              <Diverging
                scale={p2[0].scale === 7 ? LIKERT7 : LIKERT5}
                rows={p2.flatMap((r) => [
                  { label: `${r.item} – A`, counts: r.countsA },
                  { label: `${r.item} – B`, counts: r.countsB },
                ])}
              />
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
                    <td>{r.item}</td>
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
      </Section>

      <Section title="Teil 3: UEQ-S" id="teil3">
        {p3.answered ? (
          <>
            <Fig
              id="teil3"
              table={() =>
                csv([
                  ['Skala', 'M A', 'KI A', 'SD A', 'α A', 'Benchmark A', 'M B', 'KI B', 'SD B', 'α B', 'Benchmark B', 'p (Wilcoxon)', 'r'],
                  ...p3.scales.map((s) => [
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
              <Dots
                series={AB}
                domain={[-3, 3]}
                refLines={[0]}
                rows={p3.scales.map((s) => ({
                  label: SCALE_NAME[s.scale],
                  points: [
                    { value: s.A.mean, lo: s.A.ci[0], hi: s.A.ci[1], series: 0 },
                    { value: s.B.mean, lo: s.B.ci[0], hi: s.B.ci[1], series: 1 },
                  ],
                }))}
              />
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
            <Fig id="teil3items" table={() => csv([['Item', 'M A', 'M B'], ...p3.items.map((i) => [UEQS_ITEMS[i.item].join(' – '), fmt(i.A), fmt(i.B)])])}>
              <Dots
                series={AB}
                domain={[-3, 3]}
                refLines={[0]}
                rows={p3.items.map((i) => ({
                  label: UEQS_ITEMS[i.item].join(' – '),
                  points: [
                    { value: i.A, lo: NaN, hi: NaN, series: 0 },
                    { value: i.B, lo: NaN, hi: NaN, series: 1 },
                  ],
                }))}
              />
            </Fig>
          </>
        ) : !p3.overall ? (
          <Empty>Keine Spalte als „Teil 3“ zugeordnet.</Empty>
        ) : null}
        {p3.overall && <Part3Overall p3={p3} />}
      </Section>

      <Telemetry />
      <FreeText />
    </>
  );
}

function FreeText() {
  const { slice } = useCtx();
  const labels = [...new Set(slice.survey.flatMap((r) => Object.keys(r.text)))];
  if (!labels.length) return null;
  return (
    <Section title="Freitextantworten">
      {labels.map((l) => (
        <div key={l} className="st-quotes">
          <h3>{l}</h3>
          <ul>
            {slice.survey
              .filter((r) => r.text[l])
              .map((r) => (
                <li key={r.row}>
                  <span className="st-pid">{r.person ?? `Zeile ${r.row + 1}`}</span> {r.text[l]}
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
  const { slice, model } = useCtx();
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
              <td>Teil 1: {r.question}</td>
              <td>{r.winner ? `${r.winner} ${r.k}/${r.decided} (${pct(r.share)}), keine Präferenz ${r.neutral}` : `unentschieden (${r.A}:${r.B})`}</td>
              <td className="num">{fmtP(r.p)}</td>
            </tr>
          ))}
          {p2.map((r) => (
            <tr key={`2${r.item}`}>
              <td>Teil 2: {r.item}</td>
              <td>
                Mdn A {fmt(r.A.median, 1)}, B {fmt(r.B.median, 1)}; r = {fmt(r.test.r)}
              </td>
              <td className="num">{fmtP(r.test.p)}</td>
            </tr>
          ))}
          {part2Single(slice.survey).map((r) => (
            <tr key={`2s${r.item}`}>
              <td>Teil 2: {r.item}</td>
              <td>
                Mdn {fmt(r.stats.median, 1)} (IQR {fmt(r.stats.q1, 1)}–{fmt(r.stats.q3, 1)}), M = {fmt(r.stats.mean)}
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
function Telemetry() {
  const { slice } = useCtx();
  const cs = craftStats(slice.events, slice.feedback);
  const ratings = gameRatings(slice.feedback);
  const { prefs, scopes } = prefChoices(slice.feedback);
  return (
      <Section title="In-Game-Ratings und Telemetrie" id="spiel">
        <div className="st-grid">
          <Fig id="crafts" table={() => csv([['Kennzahl', 'A', 'B'], ['Crafts', cs.A.crafts, cs.B.crafts], ['Überarbeitungen', cs.A.reworks, cs.B.reworks], ['Ersatzergebnisse', cs.A.fallbacks, cs.B.fallbacks], ['Minuten im Crafting', fmt(cs.A.minutes, 1), fmt(cs.B.minutes, 1)]])}>
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
          </Fig>
          <Fig id="votes" table={() => csv([['Bewertung', 'A', 'B'], ['Passt', cs.A.up, cs.B.up], ['Nicht ganz', cs.A.down, cs.B.down]])}>
            <Bars
              rows={[
                { label: 'Passt', values: [cs.A.up, cs.B.up] },
                { label: 'Nicht ganz', values: [cs.A.down, cs.B.down] },
              ]}
              series={AB}
            />
            {(() => {
              const a = cs.A.up + cs.A.down;
              const b = cs.B.up + cs.B.down;
              return a + b ? (
                <p className="st-note">
                  Anteil „Passt“: A {a ? Math.round((cs.A.up / a) * 100) : '–'} %, B {b ? Math.round((cs.B.up / b) * 100) : '–'} %
                </p>
              ) : null;
            })()}
          </Fig>
          <Fig
            id="spielfragen"
            table={() =>
              csv([
                ['Frage', 'M A', 'SD A', 'n A', 'M B', 'SD B', 'n B'],
                ...Object.entries(ratings).map(([q, v]) => [RATING_LABEL[q] ?? q, fmt(describe(v.A).mean), fmt(describe(v.A).sd), v.A.length, fmt(describe(v.B).mean), fmt(describe(v.B).sd), v.B.length]),
              ])
            }
          >
            {Object.keys(ratings).length ? (
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
            )}
          </Fig>
          <Fig
            id="praeferenzen"
            table={() =>
              csv([
                ['Einstellung', 'Wert', 'Anzahl'],
                ...Object.entries(prefs).flatMap(([k, vs]) => Object.entries(vs).map(([v, c]) => [PREF_LABEL[k]?.name ?? k, PREF_LABEL[k]?.values[v] ?? v, c])),
                ...Object.entries(scopes).map(([s, c]) => ['Gültigkeit', SCOPE_LABEL[s] ?? s, c]),
              ])
            }
          >
            {Object.keys(prefs).length ? (
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
            )}
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
  const scale = items[0].scale === 7 ? LIKERT7 : LIKERT5;
  return (
    <>
      <Fig id="teil2single" table={() => csv([['Aussage', ...scale, 'Median', 'Q1', 'Q3', 'M', 'SD', 'n'], ...items.map((r) => [r.item, ...r.counts, fmt(r.stats.median, 1), fmt(r.stats.q1, 1), fmt(r.stats.q3, 1), fmt(r.stats.mean), fmt(r.stats.sd), r.stats.n])])}>
        <Diverging scale={scale} rows={items.map((r) => ({ label: r.item, counts: r.counts }))} />
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
              <td>{r.item}</td>
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
      <Fig id="teil3gesamt" table={() => csv([['Skala', 'M', 'KI unten', 'KI oben', 'SD', 'α', 'Benchmark', 'n'], ...o.map((x) => [SCALE_NAME[x.scale], fmt(x.v.mean), fmt(x.v.ci[0]), fmt(x.v.ci[1]), fmt(x.v.sd), fmt(x.v.alpha), x.v.bench, x.v.n])])}>
        <Dots
          series={[{ name: 'Gesamtes Spiel', color: SERIES.B }]}
          domain={[-3, 3]}
          refLines={[0]}
          rows={[
            ...o.map((x) => ({ label: SCALE_NAME[x.scale], points: [{ value: x.v.mean, lo: x.v.ci[0], hi: x.v.ci[1], series: 0 }] })),
            ...p3.overallItems.map((m, i) => ({ label: UEQS_ITEMS[i].join(' – '), points: [{ value: m, lo: NaN, hi: NaN, series: 0 }] })),
          ]}
        />
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
