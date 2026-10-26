// Übersicht: every craft (prompt, Mitchy's questions, result, rating) and
// the run of the game (quest steps with their times), from the game's run
// log and ratings. Follows the participant filter.
import { Fragment } from 'react';
import { conditionOf, designOf, type FeedbackRecord } from '../../feedback/schema';
import { linkLabels, subIdOf } from '../../feedback/studyExport';
import type { RunEvent } from '../../quest/runlog';
import { FitSprite } from '../../ui';
import { Bars } from '../charts';
import { describe, fmt } from '../stats';
import { csv, Empty, Fig, Section, useCtx } from '../ui';

const PART_LABEL: Record<string, string> = {
  q1: 'Quest 1',
  q2: 'Quest 2',
  rate1: 'Bewertung 1',
  transition: 'Übergang',
  c2: '2. Durchgang',
  rate2: 'Bewertung 2',
  end: 'Ende',
};
const STEP_LABEL: Record<string, string> = {
  explore: 'Erkunden',
  gather: 'Sammeln',
  store: 'Einlagern',
  mitchy: 'Zu Mitchy',
  vehicle: 'Fahrzeug',
  tool: 'Werkzeug',
  fill: 'Füllen',
  plant: 'Pflanzen',
  water: 'Gießen',
  harvest: 'Ernten',
  companion: 'Begleiter',
  report: 'Berichten',
};
const SESSION_LABEL: Record<string, string> = { start: 'Start', resume: 'Fortgesetzt (neu geladen)', survey: 'Umfrage geöffnet', close: 'Spiel geschlossen', 'extra-token': 'Zusatz-Token', 'budget-refused': 'KI-Budget erschöpft' };
const clock = (t: number) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const mins = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

interface Result {
  at?: number;
  prompt?: string;
  name?: string;
  rework?: boolean;
  fallback?: unknown;
}
interface Turn {
  who?: string;
  text?: string;
  result?: string;
  prompt?: string;
  options?: unknown[];
  concepts?: string[];
}

function useLabel() {
  const { study } = useCtx();
  const invites = study.game.invites;
  const labels = linkLabels(invites);
  return (r: { participant?: string; at: number; key?: string }) => subIdOf(r, invites, labels);
}

// the rating record of a result: same person, same name, close in time
function ratingOf(fb: FeedbackRecord[], person: string, name: string | undefined, at: number) {
  return fb.filter((r) => r.participant === person && !r.rating && r.name === name && Math.abs(r.at - at) < 30 * 60000).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
}

export function CraftLog() {
  const { slice } = useCtx();
  const label = useLabel();
  const crafts = slice.events.filter((e) => e.type === 'craft' && ((e.data.results as Result[] | undefined)?.length || e.data.outcome === 'crafted')).sort((a, b) => a.at - b.at);
  const rows = crafts.flatMap((e) => {
    const results = ((e.data.results as Result[] | undefined) ?? []).filter((r) => r.name);
    return (results.length ? results : [{} as Result]).map((r, i) => ({ e, r, i, rating: r.name ? ratingOf(slice.feedback, e.participant, r.name, r.at ?? e.at) : undefined }));
  });
  const table = () =>
    csv([
      ['Zeit', 'Teilnehmende', 'Variante', 'Durchgang', 'Eingabe', 'Ergebnis', 'Überarbeitung', 'Bewertung', 'Gründe', 'Kommentar', 'Dauer (min)', 'Ersatzergebnis'],
      ...rows.map(({ e, r, rating }) => [
        new Date(r.at ?? e.at).toISOString(),
        label(e),
        designOf(e.data.design ?? e.cond) ?? '',
        conditionOf(e.order, e.data.design ?? e.cond) ?? '',
        r.prompt ?? '',
        r.name ?? '',
        r.rework ? 'ja' : '',
        rating?.vote === 'up' ? 'passt' : rating?.vote === 'down' ? 'nicht ganz' : '',
        rating?.reasons?.join(', ') ?? '',
        rating?.comment ?? '',
        typeof e.data.ms === 'number' ? fmt(e.data.ms / 60000, 1) : '',
        r.fallback ? 'ja' : '',
      ]),
    ]);
  return (
    <Section title={`Crafting-Vorgänge (${rows.length})`} id="crafting">
      {rows.length ? (
        <>
          <div className="st-toolbar">
            <button type="button" onClick={() => downloadCsv(table(), 'Crafting.csv')}>
              CSV
            </button>
          </div>
          <div className="st-table-wrap">
            <table className="st-table st-crafts">
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>TN</th>
                  <th>Var.</th>
                  <th>Eingabe und Verlauf</th>
                  <th>Ergebnis</th>
                  <th>Bewertung</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ e, r, i, rating }) => {
                  const d = designOf(e.data.design ?? e.cond);
                  const c = conditionOf(e.order, e.data.design ?? e.cond);
                  const thread = ((e.data.thread as Turn[] | undefined) ?? []).filter((t) => t.text || t.options || t.concepts);
                  const sprite = rating?.sprite;
                  return (
                    <tr key={`${e.id}-${i}`}>
                      <td className="num">
                        {clock(r.at ?? e.at)}
                        {i === 0 && typeof e.data.ms === 'number' && <div className="st-muted">{mins(e.data.ms)} min</div>}
                      </td>
                      <td>
                        <span className="st-pid">{label(e)}</span>
                      </td>
                      <td>
                        {d ?? '–'}
                        {c && <div className="st-muted">{c}. DG</div>}
                      </td>
                      <td>
                        <div>{r.prompt ?? <span className="st-muted">–</span>}</div>
                        {r.rework && <span className="st-flag">Überarbeitung</span>}
                        {i === 0 && thread.length > 0 && (
                          <details className="st-details">
                            <summary>Gesprächsverlauf ({thread.length})</summary>
                            <ol className="st-thread">
                              {thread.map((t, k) => (
                                <li key={k}>
                                  <span className="st-muted">{t.who === 'player' ? 'TN' : 'Mitchy'}:</span> {t.text ?? (t.concepts ? `Vorschläge: ${t.concepts.join(', ')}` : `${(t.options ?? []).length} Optionen`)}
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </td>
                      <td>
                        <div className="st-craft-result">
                          {sprite?.lines?.length ? (
                            <div className="st-sprite">
                              <FitSprite look={{ sprite: sprite.lines, colors: sprite.colors, palette: sprite.palette }} fill={0.85} maxScale={1.4} />
                            </div>
                          ) : null}
                          <span>{r.name ?? (e.data.outcome === 'crafted' ? '–' : 'abgebrochen')}</span>
                        </div>
                        {r.fallback ? <span className="st-flag">Ersatzergebnis</span> : null}
                      </td>
                      <td>
                        {rating?.vote === 'up' ? 'passt' : rating?.vote === 'down' ? 'nicht ganz' : <span className="st-muted">–</span>}
                        {rating?.reasons?.length ? <div className="st-muted">{rating.reasons.join(', ')}</div> : null}
                        {rating?.comment ? <div>„{rating.comment}“</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty>Keine Crafting-Vorgänge.</Empty>
      )}
    </Section>
  );
}

function downloadCsv(text: string, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// the time per quest part of one run (the steps' own durations)
function partTimes(evs: RunEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of evs) if (e.type === 'step' && typeof e.data.ms === 'number') out[String(e.data.part ?? e.part ?? '?')] = (out[String(e.data.part ?? e.part ?? '?')] ?? 0) + e.data.ms;
  return out;
}

export function GameFlow() {
  const { slice, scope } = useCtx();
  const label = useLabel();
  const steps = slice.events.filter((e) => e.type === 'step' || e.type === 'session' || e.type === 'hint' || e.type === 'error').sort((a, b) => a.at - b.at);
  if (!steps.length)
    return (
      <Section title="Spielablauf" id="ablauf">
        <Empty>Keine Ereignisse im Spiel-Tracking.</Empty>
      </Section>
    );
  // per participant (or link): time per part
  const runs = new Map<string, RunEvent[]>();
  for (const e of slice.events) {
    const k = scope.kind === 'all' ? e.participant : label(e);
    runs.set(k, [...(runs.get(k) ?? []), e]);
  }
  const perRun = [...runs].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, evs]) => ({ k, t: partTimes(evs) }));
  const parts = [...new Set(perRun.flatMap((r) => Object.keys(r.t)))].sort((a, b) => Object.keys(PART_LABEL).indexOf(a) - Object.keys(PART_LABEL).indexOf(b));
  const total = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);
  const single = scope.kind !== 'all';

  return (
    <Section title="Spielablauf" id="ablauf">
      <Fig id="ablauf" table={() => csv([['Teilnehmende', ...parts.map((p) => PART_LABEL[p] ?? p), 'Summe'], ...perRun.map((r) => [r.k, ...parts.map((p) => (r.t[p] ? fmt(r.t[p] / 60000, 1) : '')), fmt(total(r.t) / 60000, 1)])])}>
        <Bars rows={parts.map((p) => ({ label: PART_LABEL[p] ?? p, values: [describe(perRun.map((r) => (r.t[p] ?? 0) / 60000).filter((x) => x > 0)).median || 0] }))} digits={1} unit=" min" />
        <p className="st-note">{single ? 'Dauer je Abschnitt in Minuten.' : `Median der Dauer je Abschnitt in Minuten (n = ${perRun.length}).`}</p>
      </Fig>
      {!single && (
        <table className="st-table">
          <thead>
            <tr>
              <th>TN</th>
              {parts.map((p) => (
                <th key={p} className="num">
                  {PART_LABEL[p] ?? p}
                </th>
              ))}
              <th className="num">Summe</th>
            </tr>
          </thead>
          <tbody>
            {perRun.map((r) => (
              <tr key={r.k}>
                <td>
                  <span className="st-pid">{r.k}</span>
                </td>
                {parts.map((p) => (
                  <td key={p} className="num">
                    {r.t[p] ? mins(r.t[p]) : '–'}
                  </td>
                ))}
                <td className="num">{mins(total(r.t))}</td>
              </tr>
            ))}
            <tr className="st-sumrow">
              <td>Median</td>
              {parts.map((p) => {
                const xs = perRun.map((r) => r.t[p]).filter((x): x is number => !!x);
                return (
                  <td key={p} className="num">
                    {xs.length ? mins(describe(xs).median) : '–'}
                  </td>
                );
              })}
              <td className="num">{mins(describe(perRun.map((r) => total(r.t))).median || 0)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {single && (
        <ol className="st-timeline">
          {(() => {
            const start = steps[0].at;
            let part = '';
            return steps.map((e) => {
              const d = e.data as Record<string, unknown>;
              const p = String(d.part ?? e.part ?? '');
              const head = p && p !== part && e.type === 'step' ? ((part = p), <li className="st-timeline-part">{PART_LABEL[p] ?? p}</li>) : null;
              return (
                <Fragment key={e.id}>
                  {head}
                  <li className={`is-${e.type}`}>
                    <span className="st-muted num">{clock(e.at)}</span>
                    <span className="st-muted num">+{mins(e.at - start)}</span>
                    <span>
                      {e.type === 'step'
                        ? `${STEP_LABEL[String(d.step)] ?? String(d.step ?? e.step)} abgeschlossen`
                        : e.type === 'session'
                          ? (SESSION_LABEL[String(d.what)] ?? String(d.what))
                          : e.type === 'hint'
                            ? `Hinweis${e.step ? ` (${STEP_LABEL[e.step] ?? e.step})` : ''}`
                            : `Fehler: ${String(d.kind ?? d.detail ?? '')}`}
                    </span>
                    <span className="st-muted num">{e.type === 'step' && typeof d.ms === 'number' ? `${mins(d.ms)} min${d.hints ? ` · ${String(d.hints)} Hinweis(e)` : ''}` : ''}</span>
                  </li>
                </Fragment>
              );
            });
          })()}
        </ol>
      )}
    </Section>
  );
}
