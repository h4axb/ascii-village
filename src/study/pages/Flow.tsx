// Übersicht: every craft (prompt, Mitchy's questions, result, rating) and
// the run of the game (quest steps with their times), from the game's run
// log and ratings. Follows the participant filter.
import { Fragment, useState } from 'react';
import { conditionOf, designOf, type FeedbackRecord } from '../../feedback/schema';
import { linkLabels, subIdOf } from '../../feedback/studyExport';
import type { RunEvent } from '../../quest/runlog';
import { FitSprite } from '../../ui';
import { Bars } from '../charts';
import { describe, fmt } from '../stats';
import { csv, Empty, Fig, Section, useCtx } from '../ui';
import { GAP_MIN, type Slice } from '../model';

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
const clock = (t: number) => new Date(t).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const minOf = (m: number | null | undefined) => (m == null || !Number.isFinite(m) ? '–' : mins(m * 60000));
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

// one crafted result (or an aborted craft), from the run log or, when the
// run log lacks it, from its rating record alone
interface CraftItem {
  key: string;
  person: string;
  label: string; // P009 or P009.2
  at: number;
  design: 'A' | 'B' | null;
  cond: 1 | 2 | null;
  prompt: string;
  name: string | null; // null: aborted
  rework: boolean;
  fallback: boolean;
  rating?: FeedbackRecord;
  source: 'log' | 'rating';
  thread: Turn[]; // the craft's conversation (first result of a craft only)
  ms: number | null; // the craft's duration (first result only)
}

function craftItems(events: RunEvent[], feedback: FeedbackRecord[], label: (r: { participant?: string; at: number; key?: string }) => string): CraftItem[] {
  const out: CraftItem[] = [];
  const used = new Set<string>();
  for (const e of events.filter((x) => x.type === 'craft').sort((x, y) => x.at - y.at)) {
    const design = designOf(e.data.design ?? e.cond);
    const cond = conditionOf(e.order, e.data.design ?? e.cond);
    const thread = ((e.data.thread as Turn[] | undefined) ?? []).filter((t) => t.text || t.options || t.concepts);
    const results = ((e.data.results as Result[] | undefined) ?? []).filter((r) => r.name);
    if (!results.length) {
      // opened and left without a result: an aborted craft (only when something was typed)
      if (!thread.some((t) => t.who === 'player' && t.text)) continue;
      out.push({ key: e.id, person: e.participant, label: label(e), at: e.at, design, cond, prompt: thread.find((t) => t.who === 'player')?.text ?? '', name: null, rework: false, fallback: false, source: 'log', thread, ms: typeof e.data.ms === 'number' ? e.data.ms : null });
      continue;
    }
    results.forEach((r, i) => {
      const at = r.at ?? e.at;
      const rating = ratingOf(feedback, e.participant, r.name, at);
      if (rating) used.add(rating.id);
      out.push({ key: `${e.id}-${i}`, person: e.participant, label: label(e), at, design, cond, prompt: r.prompt ?? '', name: r.name ?? null, rework: !!r.rework, fallback: !!r.fallback, rating, source: 'log', thread: i === 0 ? thread : [], ms: i === 0 && typeof e.data.ms === 'number' ? e.data.ms : null });
    });
  }
  // results the run log doesn't have (lost, or from before it existed): their rating
  for (const r of feedback) {
    if (r.rating || used.has(r.id) || !r.participant || !r.name) continue;
    if (out.some((x) => x.person === r.participant && x.name === r.name && Math.abs(x.at - r.at) < 2 * 60000)) continue;
    const design = designOf(r.cond);
    out.push({ key: `fb-${r.id}`, person: r.participant, label: label({ participant: r.participant, at: r.at }), at: r.at, design, cond: conditionOf(r.order, r.cond), prompt: r.prompt, name: r.name, rework: r.adjusted, fallback: !!r.fallback, rating: r, source: 'rating', thread: [], ms: null });
  }
  return out.sort((x, y) => x.at - y.at);
}

const VIEW_KEY = 'asciia-study-crafts-view';
const vote = (r?: FeedbackRecord) => (r?.vote === 'up' ? 'passt' : r?.vote === 'down' ? 'nicht ganz' : null);

function CraftCard({ it }: { it: CraftItem }) {
  const sprite = it.rating?.sprite;
  return (
    <div className={`st-card${it.name ? '' : ' is-aborted'}`}>
      <div className="st-card-sprite">
        {sprite?.lines?.length ? (
          <div className="st-sprite">
            <FitSprite look={{ sprite: sprite.lines, colors: sprite.colors, palette: sprite.palette }} fill={0.85} maxScale={1.4} />
          </div>
        ) : (
          <div className="st-sprite st-sprite-empty">{it.name ? '–' : '×'}</div>
        )}
      </div>
      <div className="st-card-body">
        <div className="st-card-name" data-notr={it.name ? '' : undefined}>{it.name ?? 'abgebrochen'}</div>
        {it.prompt && <div className="st-card-prompt" data-notr>„{it.prompt}“</div>}
        <div className="st-card-meta">
          <span>{clock(it.at)}</span>
          {vote(it.rating) && <span className={it.rating?.vote === 'up' ? 'is-up' : 'is-down'}>{vote(it.rating)}</span>}
          {it.rework && <span className="st-flag">Überarbeitung</span>}
          {it.fallback && <span className="st-flag">Ersatzergebnis</span>}
          {it.source === 'rating' && <span className="st-muted">nur Bewertung</span>}
        </div>
        {it.rating?.reasons?.length ? <div className="st-muted">{it.rating.reasons.join(', ')}</div> : null}
        {it.rating?.comment ? <div className="st-card-comment" data-notr>„{it.rating.comment}“</div> : null}
      </div>
    </div>
  );
}

// a person's (or link's) results in two columns: 1st and 2nd run
function RunColumns({ items }: { items: CraftItem[] }) {
  const runs = ([1, 2] as const).map((c) => items.filter((it) => it.cond === c));
  const other = items.filter((it) => it.cond == null);
  const col = (list: CraftItem[], title: string) => {
    const done = list.filter((x) => x.name);
    const rated = done.filter((x) => x.rating?.vote);
    const up = rated.filter((x) => x.rating?.vote === 'up').length;
    return (
      <div className="st-run">
        <div className="st-run-head">
          <span>{title}</span>
          <span className="st-muted">
            {`${done.length} Ergebnis${done.length === 1 ? '' : 'se'}`}
            {list.length > done.length ? ` · ${list.length - done.length} abgebrochen` : ''}
            {done.some((x) => x.rework) ? ` · ${done.filter((x) => x.rework).length} Überarb.` : ''}
            {rated.length ? ` · ${Math.round((up / rated.length) * 100)} % passt` : ''}
          </span>
        </div>
        {list.length ? list.map((it) => <CraftCard key={it.key} it={it} />) : <p className="st-empty">Keine.</p>}
      </div>
    );
  };
  const designOfRun = (list: CraftItem[]) => list.find((x) => x.design)?.design;
  return (
    <div className="st-runs">
      {runs.map((list, i) => col(list, `${i + 1}. Durchgang${designOfRun(list) ? ` · Variante ${designOfRun(list)}` : ''}`))}
      {other.length > 0 && col(other, 'Ohne Zuordnung')}
    </div>
  );
}

export function CraftLog() {
  const { slice } = useCtx();
  const label = useLabel();
  const items = craftItems(slice.events, slice.feedback, label);
  const [view, setView] = useState<'gallery' | 'table'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'gallery';
    } catch {
      return 'gallery';
    }
  });
  const choose = (v: 'gallery' | 'table') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // (not remembered)
    }
  };
  const done = items.filter((x) => x.name);
  const groups = [...new Set(items.map((x) => x.label))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const table = () =>
    csv([
      ['Zeit', 'Teilnehmende', 'Variante', 'Durchgang', 'Eingabe', 'Ergebnis', 'Überarbeitung', 'Bewertung', 'Gründe', 'Kommentar', 'Dauer (min)', 'Ersatzergebnis', 'Quelle'],
      ...items.map((it) => [
        new Date(it.at).toISOString(),
        it.label,
        it.design ?? '',
        it.cond ?? '',
        it.prompt,
        it.name ?? 'abgebrochen',
        it.rework ? 'ja' : '',
        vote(it.rating) ?? '',
        it.rating?.reasons?.join(', ') ?? '',
        it.rating?.comment ?? '',
        it.ms != null ? fmt(it.ms / 60000, 1) : '',
        it.fallback ? 'ja' : '',
        it.source === 'log' ? 'Run-Log' : 'nur Bewertung',
      ]),
    ]);
  return (
    <Section title={`Crafting-Ergebnisse (${done.length}${items.length > done.length ? ` + ${items.length - done.length} abgebrochen` : ''})`} id="crafting">
      {items.length ? (
        <>
          <div className="st-toolbar">
            <div className="st-seg" role="group" aria-label="Ansicht">
              <button type="button" className={view === 'gallery' ? 'is-on' : ''} onClick={() => choose('gallery')}>
                Nach Durchgang
              </button>
              <button type="button" className={view === 'table' ? 'is-on' : ''} onClick={() => choose('table')}>
                Tabelle
              </button>
            </div>
            <button type="button" onClick={() => downloadCsv(table(), 'Crafting.csv')}>
              CSV
            </button>
          </div>
          {view === 'gallery' ? (
            groups.length === 1 ? (
              <RunColumns items={items} />
            ) : (
              groups.map((g) => (
                <div key={g} className="st-craftperson">
                  <h3>
                    <span className="st-pid">{g}</span>
                  </h3>
                  <RunColumns items={items.filter((x) => x.label === g)} />
                </div>
              ))
            )
          ) : (
            <CraftTable items={items} />
          )}
        </>
      ) : (
        <Empty>Keine Crafting-Vorgänge.</Empty>
      )}
    </Section>
  );
}

function CraftTable({ items }: { items: CraftItem[] }) {
  return (
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
          {items.map((it) => {
            const sprite = it.rating?.sprite;
            return (
              <tr key={it.key}>
                <td className="num">
                  {clock(it.at)}
                  {it.ms != null && <div className="st-muted">{mins(it.ms)} min</div>}
                </td>
                <td>
                  <span className="st-pid">{it.label}</span>
                </td>
                <td>
                  {it.design ?? '–'}
                  {it.cond && <div className="st-muted">{it.cond}. DG</div>}
                </td>
                <td>
                  <div data-notr>{it.prompt || <span className="st-muted">–</span>}</div>
                  {it.rework && <span className="st-flag">Überarbeitung</span>}
                  {it.thread.length > 0 && (
                    <details className="st-details">
                      <summary>Gesprächsverlauf ({it.thread.length})</summary>
                      <ol className="st-thread" data-notr>
                        {it.thread.map((t, k) => (
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
                    <span>{it.name ?? 'abgebrochen'}</span>
                  </div>
                  {it.fallback ? <span className="st-flag">Ersatzergebnis</span> : null}
                  {it.source === 'rating' ? <div className="st-muted">nur Bewertung</div> : null}
                </td>
                <td>
                  {vote(it.rating) ?? <span className="st-muted">–</span>}
                  {it.rating?.reasons?.length ? <div className="st-muted">{it.rating.reasons.join(', ')}</div> : null}
                  {it.rating?.comment ? <div>„{it.rating.comment}“</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const perRunOf = (s: Slice) => {
    const runs = new Map<string, RunEvent[]>();
    for (const e of s.events) {
      const k = scope.kind === 'all' ? e.participant : label(e);
      runs.set(k, [...(runs.get(k) ?? []), e]);
    }
    return [...runs].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, evs]) => ({ k, t: partTimes(evs) }));
  };
  const perRun = perRunOf(slice);
  const parts = [...new Set(perRun.flatMap((r) => Object.keys(r.t)))].sort((a, b) => Object.keys(PART_LABEL).indexOf(a) - Object.keys(PART_LABEL).indexOf(b));
  const total = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);
  const single = scope.kind !== 'all';
  // the durations: of the person, or of the one link chosen
  const personOf = (id: string) => slice.persons.find((p) => p.id === id);
  const one = scope.kind === 'link' ? slice.links[0] : slice.persons[0];

  return (
    <Section title="Spielablauf" id="ablauf">
      <Fig id="ablauf" valid={(s) => new Set(perRunOf(s).map((r) => r.k.split('.')[0])).size} table={(s) => csv([['Teilnehmende', ...parts.map((p) => PART_LABEL[p] ?? p), 'Summe'], ...perRunOf(s).map((r) => [r.k, ...parts.map((p) => (r.t[p] ? fmt(r.t[p] / 60000, 1) : '')), fmt(total(r.t) / 60000, 1)])])}>
        {(s) => {
          const runs = perRunOf(s);
          return (
            <>
              <Bars rows={parts.map((p) => ({ label: PART_LABEL[p] ?? p, values: [describe(runs.map((r) => (r.t[p] ?? 0) / 60000).filter((x) => x > 0)).median || 0] }))} digits={1} unit=" min" />
              <p className="st-note">{single ? 'Dauer je Abschnitt in Minuten.' : `Median der Dauer je Abschnitt in Minuten (n = ${runs.length}).`}</p>
            </>
          );
        }}
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
              <th className="num">Summe Schritte</th>
              <th className="num">Spiel-Uhr</th>
              <th className="num">Link-Dauer</th>
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
                <td className="num">{minOf(personOf(r.k)?.clockMinutes)}</td>
                <td className="num">{minOf(personOf(r.k)?.linkMinutes)}</td>
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
              <td className="num">{minOf(describe(perRun.map((r) => personOf(r.k)?.clockMinutes).filter((x): x is number => x != null)).median)}</td>
              <td className="num">{minOf(describe(perRun.map((r) => personOf(r.k)?.linkMinutes).filter((x): x is number => x != null)).median)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {single && (
        <p className="st-flowsum">
          Spiel-Uhr bis Umfrage: <strong>{minOf(one?.clockMinutes)}</strong> · Link-Dauer: {minOf(one?.linkMinutes)} · Summe der Schritte: {minOf(one?.stepMinutes)}
          {one && one.gaps.count > 0 && (
            <span className="st-flag">
              {' '}
              · {one.gaps.count} Unterbrechung{one.gaps.count > 1 ? 'en' : ''} über {GAP_MIN} min ({Math.round(one.gaps.minutes)} min)
            </span>
          )}
        </p>
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
