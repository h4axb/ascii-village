// Qualitatives Feedback → A/B-Vergleich & Gestaltungsableitung:
//   Gesamtbewertung     the leading variant in Tally (the preference question)
//                       and in-game (the overall rating, compared per person)
//   Einzelbewertungen   Tally (Teil 1: Direkter Vergleich) or In-Game (the five
//                       rating questions after each variant), one row per
//                       criterion: the leading variant and A · Gleich · B; Tally
//                       values are never changed here; a click on a Tally row
//                       filters the hypotheses by that research dimension
//   2. Hypothesen       own interpretations, each with linked statements from
//                       Beobachtungen & Feedback (supporting, contradicting or
//                       complementary); weakly backed ones are flagged
//   3. Redesign         design decisions: the hypotheses considered, the proposal
//                       and why; a hypothesis can also be "Nicht berücksichtigt"
// The dashboard's A/B tiles can show the people with preference A or B.
// Stored in settings/abCompare.
import { useEffect, useMemo, useState } from 'react';
import { part1, type P1Result } from './analysis';
import type { ItemDoc } from './types';
import { SECTION_LABEL } from './types';
import { itemText, useContentView } from './translations';
import { logChange, useCtx } from './ui';
import { FoldBtn } from './notesDashboard';
import { RATING_LABEL, scopeLabel } from './model';
import { designOf } from '../feedback/schema';
import { RATING_QUESTIONS } from '../quest/quests';

export type EvKind = 'support' | 'contra' | 'extra';
export const EV_KIND: [EvKind, string][] = [
  ['support', 'stützend'],
  ['contra', 'widersprechend'],
  ['extra', 'ergänzend'],
];
export type HypStatus = 'open' | 'selected' | 'rejected';
export const HYP_STATUS: [HypStatus, string][] = [
  ['open', 'Offen'],
  ['selected', 'Für Redesign ausgewählt'],
  ['rejected', 'Nicht berücksichtigt'],
];
export interface AbHyp {
  id: string;
  code: string; // H1, H2 …
  title: string;
  dims: string[]; // the Tally questions (research dimensions) it is about
  factors: string[]; // possible influences, e.g. Outputqualität
  text: string; // the interpretation
  evidence: { item: string; kind: EvKind }[];
  status: HypStatus;
  reason?: string; // why not considered
}
export interface AbDecision {
  id: string;
  title: string;
  proposal: string; // the design proposal
  why: string; // the reason for the decision
  hyps: string[];
}
interface AbDoc {
  dims?: Record<string, string>; // question → short name of its research dimension
  prefQ?: string; // the overall preference question
  hyps?: AbHyp[];
  decisions?: AbDecision[];
}

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const pText = (p: number) => (Number.isFinite(p) ? `p = ${p < 0.001 ? '< 0,001' : p.toFixed(2).replace('.', ',')}` : '');
const lead = (q: string) => q.replace(/[\s?:.]+$/, '');
const PREF_RE = /insgesamt|gefallen|präferenz|bevorzug|lieber|overall|prefer/i;

function useAb() {
  const { study } = useCtx();
  const doc = (study.docs.settings.abCompare ?? {}) as AbDoc;
  const latest = () => (study.latest().settings.abCompare ?? {}) as AbDoc;
  const save = (p: Partial<AbDoc>, what: string) => {
    study.commit([{ coll: 'settings', id: 'abCompare', data: { ...latest(), ...p } }]);
    logChange(study, `A/B-Vergleich: ${what}`);
  };
  return { doc, latest, save };
}

export type AbView = 'A' | 'B' | 'hyp' | 'red' | null;
type View = AbView;

// the figures for the tiles: people preferring A or B (in the preference
// question), hypotheses (and those chosen for the redesign), decisions
export function useAbSummary() {
  const { slice } = useCtx();
  const { doc } = useAb();
  const results = useMemo(() => part1(slice.survey).filter((r) => r.n), [slice.survey]);
  const prefQ = doc.prefQ && results.some((r) => r.question === doc.prefQ) ? doc.prefQ : (results.find((r) => PREF_RE.test(r.question)) ?? results[results.length - 1])?.question;
  const rows = slice.survey.filter((r) => r.person && prefQ && r.p1[prefQ] != null);
  const hyps = doc.hyps ?? [];
  return {
    results: results.length,
    of: rows.length,
    A: rows.filter((r) => r.p1[prefQ!] === 'A').length,
    B: rows.filter((r) => r.p1[prefQ!] === 'B').length,
    hyps: hyps.length,
    selected: hyps.filter((h) => h.status === 'selected').length,
    decisions: (doc.decisions ?? []).length,
  };
}

export function AbSection({ folded, onFold, show: shown, setShow: setShown }: { folded: boolean; onFold: () => void; show?: AbView; setShow?: (v: AbView) => void }) {
  const { slice, study, scope } = useCtx();
  const view = useContentView();
  const { doc, latest, save } = useAb();
  const [own, setOwn] = useState<View>(null);
  const show = shown !== undefined ? shown : own;
  const setShow = setShown ?? setOwn;
  const [dim, setDim] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const results = useMemo(() => part1(slice.survey).filter((r) => r.n), [slice.survey]);
  const label = (q: string) => doc.dims?.[q]?.trim() || lead(q);
  const prefQ = doc.prefQ && results.some((r) => r.question === doc.prefQ) ? doc.prefQ : (results.find((r) => PREF_RE.test(r.question)) ?? results[results.length - 1])?.question;
  const hyps = doc.hyps ?? [];
  const decisions = doc.decisions ?? [];
  const items = useMemo(() => new Map(slice.items.map((i) => [i.id, i])), [slice.items]);
  const allItems = study.docs.items;
  const byPref = (v: 'A' | 'B') => slice.survey.filter((r) => r.person && prefQ && r.p1[prefQ] === v);
  const shownHyps = dim ? hyps.filter((h) => h.dims.includes(dim)) : hyps;
  const putHyp = (h: AbHyp, what: string) => save({ hyps: (latest().hyps ?? []).some((x) => x.id === h.id) ? (latest().hyps ?? []).map((x) => (x.id === h.id ? h : x)) : [...(latest().hyps ?? []), h] }, what);
  const delHyp = (h: AbHyp) =>
    save({ hyps: (latest().hyps ?? []).filter((x) => x.id !== h.id), decisions: (latest().decisions ?? []).map((d) => ({ ...d, hyps: d.hyps.filter((x) => x !== h.id) })) }, `Hypothese ${h.code} gelöscht`);
  const putDec = (d: AbDecision, what: string) => save({ decisions: (latest().decisions ?? []).some((x) => x.id === d.id) ? (latest().decisions ?? []).map((x) => (x.id === d.id ? d : x)) : [...(latest().decisions ?? []), d] }, what);
  const nextCode = () => `H${Math.max(0, ...hyps.map((h) => Number(h.code.replace(/\D/g, '')) || 0)) + 1}`;
  const [fresh, setFresh] = useState<string | null>(null);
  const [src, setSrc] = useState<'tally' | 'game'>('tally');
  const game = useMemo(() => gameVotes(slice.feedback), [slice.feedback]);
  const tallyRows: Vote[] = results.map((r) => ({
    key: r.question,
    title: r.question === prefQ ? 'Gesamtbewertung' : label(r.question),
    sub: r.question === prefQ ? label(r.question) : r.question,
    A: r.A,
    B: r.B,
    tie: r.neutral,
    pref: r.question === prefQ,
    nHyp: hyps.filter((h) => h.dims.includes(r.question)).length,
    hint: r.winner ? `Mehrheit ${r.winner} · ${pText(r.p)}` : 'keine Mehrheit',
  }));
  const rows = src === 'tally' ? tallyRows : game;
  const tallyAll = tallyRows.find((r) => r.pref) ?? null;
  const gameAll = game.find((r) => r.key === 'overall') ?? null;
  const nPeople = new Set([...slice.survey.filter((r) => r.person && Object.keys(r.p1).length).map((r) => r.person), ...slice.feedback.filter((r) => r.rating && r.participant).map((r) => r.participant)]).size;

  return (
    <section className={`st-lcard st-ab${folded ? ' is-folded' : ''}`} data-nav="A/B-Vergleich" aria-label="A/B-Vergleich & Gestaltungsableitung">
      <div className="st-lc-title">
        <h2>A/B-Vergleich & Gestaltungsableitung</h2>
        <span className="st-muted st-lc-who">{`${scopeLabel(scope)} · n = ${nPeople}`}</span>
        <FoldBtn folded={folded} label="A/B-Vergleich" onClick={onFold} />
      </div>
      {!folded && (
        <>
          <div className="st-ab-step">
            <b>Gesamtbewertung</b>
          </div>
          <div className="st-ab-tiles is-two">
            <OverallTile source="Tally" v={tallyAll} unit="Person" what={prefQ ? label(prefQ) : 'Direkte Nutzungspräferenz'} />
            <OverallTile source="In-Game" v={gameAll} unit="Person" what="Crafting-Erfahrung 1–5 · Gesamteindruck" />
          </div>

          <div className="st-ab-step st-ab-rhead">
            <i>1</i>
            <b>Einzelbewertungen</b>
            <span className="st-ab-rtools">
              <span className="st-seg st-cx-seg" role="group" aria-label="Quelle">
                {(
                  [
                    ['tally', 'Tally'],
                    ['game', 'In-Game'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" className={src === v ? 'is-on' : ''} aria-pressed={src === v} onClick={() => setSrc(v)}>
                    {l}
                  </button>
                ))}
              </span>
            </span>
          </div>
          {rows.length ? (
            <>
              <div className="st-ab-rows">
                {rows.map((r) =>
                    src === 'tally' ? (
                      <VoteRow
                        key={r.key}
                        r={r}
                        on={dim === r.key}
                        renaming={rename === r.key}
                        onClick={() => setDim(dim === r.key ? null : r.key)}
                        onRename={() => setRename(r.key)}
                        onRenamed={(v) => {
                          setRename(null);
                          if (v !== null) save({ dims: { ...(latest().dims ?? {}), [r.key]: v.trim() } }, `Kurzname für „${lead(r.key)}“`);
                        }}
                      />
                    ) : (
                      <VoteRow key={r.key} r={r} />
                    ),
                  )}
              </div>
              <div className="st-ab-under">
                <span className="st-muted">
                  {src === 'tally'
                    ? 'Werte aus Tally, hier nicht veränderbar. Zeile anklicken filtert die Hypothesen.'
                    : 'Je Person gezählt: die höhere Bewertung ist eine Stimme für die Variante, bei Frustration die niedrigere. Gleiche Werte zählen als „Gleich“.'}
                </span>
                {src === 'tally' && (
                  <label className="st-ab-prefsel">
                    Präferenzfrage
                    <select value={prefQ ?? ''} onChange={(e) => save({ prefQ: e.target.value }, 'Präferenzfrage gewählt')}>
                      {results.map((r) => (
                        <option key={r.question} value={r.question}>
                          {label(r.question)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {dim && (
                  <button type="button" className="st-fchip is-on" onClick={() => setDim(null)}>
                    {`${label(dim)} ×`}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="st-muted st-ab-empty">
              {src === 'tally' ? 'Noch keine Tally-Vergleichsfragen: unter Daten & Validierung → Zuordnung die Spalten als „Teil 1“ zuordnen.' : 'Noch keine In-Game-Bewertungen (die 5 Fragen nach jeder Variante).'}
            </p>
          )}

          {(show === 'A' || show === 'B') && (
            <div className="st-ab-people">
              <div className="st-ab-step">
                <b>{`Präferenz ${show}`}</b>
                <span className="st-muted">{`${byPref(show).length} Personen · ihre Tally-Antworten und verknüpften Aussagen`}</span>
                <button type="button" className="st-cx-btn st-ab-add" onClick={() => setShow(null)}>
                  Schließen
                </button>
              </div>
              {!byPref(show).length && <p className="st-muted st-ab-empty">Niemand mit dieser Präferenz.</p>}
              {byPref(show).map((row) => {
                const linked = hyps.flatMap((h) => h.evidence.filter((e) => (items.get(e.item) ?? allItems[e.item])?.person === row.person).map((e) => ({ h, e, i: items.get(e.item) ?? allItems[e.item] })));
                return (
                  <div key={row.person!} className="st-ab-person">
                    <div className="st-ab-phead">
                      <strong>{row.person}</strong>
                      <span className="st-ab-answers">
                        {results.map((r) => (
                          <span key={r.question} className={`st-ab-ans is-${row.p1[r.question] ?? 'none'}`} title={r.question}>
                            {label(r.question)}
                            <b>{row.p1[r.question] === 'neutral' ? '–' : (row.p1[r.question] ?? '·')}</b>
                          </span>
                        ))}
                      </span>
                    </div>
                    {linked.length ? (
                      <ul className="st-ab-evlist">
                        {linked.map(({ h, e, i }) => (
                          <li key={`${h.id}-${e.item}`}>
                            <span className="st-ab-code">{h.code}</span>
                            <span>{i ? itemText(view, i) : 'Aussage gelöscht'}</span>
                            <span className={`st-ab-kind is-${e.kind}`}>{EV_KIND.find(([k]) => k === e.kind)?.[1]}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="st-muted st-ab-none">Keine Aussage mit einer Hypothese verknüpft.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(show === null || show === 'hyp') && (
            <>
              <div className="st-ab-step">
                <i>2</i>
                <b>Hypothesen & Belege</b>
                <span className="st-muted">eigene Interpretation · Aussagen verknüpfen</span>
                <button
                  type="button"
                  className="st-cx-btn st-ab-add"
                  onClick={() => {
                    const h: AbHyp = { id: uid('h'), code: nextCode(), title: '', dims: dim ? [dim] : [], factors: [], text: '', evidence: [], status: 'open' };
                    putHyp(h, `Hypothese ${h.code} angelegt`);
                    setFresh(h.id);
                  }}
                >
                  + Hypothese
                </button>
              </div>
              {!shownHyps.length && <p className="st-muted st-ab-empty">{dim ? 'Keine Hypothese zu dieser Forschungsdimension.' : 'Noch keine Hypothese: mit „+ Hypothese“ anlegen.'}</p>}
              {shownHyps.map((h) => (
                <HypCard key={h.id} h={h} results={results} label={label} items={items} allItems={allItems} startEdit={fresh === h.id} onSave={(x, what) => putHyp(x, what)} onDelete={() => delHyp(h)} />
              ))}
              <p className="st-muted st-ab-note">Hypothesen sind Interpretationen, keine bestätigten Erkenntnisse. Tally-Werte und Originalaussagen bleiben unverändert.</p>
            </>
          )}

          {(show === null || show === 'red') && (
            <>
              <div className="st-ab-step">
                <i>3</i>
                <b>Redesign-Entscheidungen</b>
                <span className="st-muted">Hypothesen auswählen · Lösung · Begründung</span>
                <button
                  type="button"
                  className="st-cx-btn st-ab-add"
                  onClick={() => {
                    const d: AbDecision = { id: uid('d'), title: '', proposal: '', why: '', hyps: hyps.filter((h) => h.status === 'selected').map((h) => h.id) };
                    putDec(d, 'Redesign-Entscheidung angelegt');
                    setFresh(d.id);
                  }}
                >
                  + Entscheidung
                </button>
              </div>
              {!decisions.length && <p className="st-muted st-ab-empty">Noch keine Redesign-Entscheidung.</p>}
              {decisions.map((d) => (
                <DecCard key={d.id} d={d} hyps={hyps} startEdit={fresh === d.id} onSave={(x, what) => putDec(x, what)} onDelete={() => save({ decisions: (latest().decisions ?? []).filter((x) => x.id !== d.id) }, 'Redesign-Entscheidung gelöscht')} />
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}

// one criterion, A against B: votes per person (Tally answers, or the in-game
// ratings compared per person), the leading variant and a small distribution bar
interface Vote {
  key: string;
  title: string;
  sub: string;
  A: number;
  B: number;
  tie: number;
  pref?: boolean;
  nHyp?: number;
  hint?: string;
  means?: { A: number | null; B: number | null; nA: number; nB: number };
  scale?: { low: string; high: string; lower?: boolean }; // in-game: what 1 and 5 mean
  calc?: { who: string; a: number; b: number; v: 'A' | 'B' | null }[]; // in-game: the comparison per person
}
const lead2 = (v: Pick<Vote, 'A' | 'B'>) => (v.A > v.B ? 'A' : v.B > v.A ? 'B' : null);
const num = (x: number | null) => (x == null ? '–' : x.toFixed(1).replace('.', ','));
const val = (x: number) => (Number.isInteger(x) ? String(x) : num(x)); // a person's rating (a mean if rated twice)

// the in-game rating questions: per person the mean of each design's ratings,
// the higher one is a vote for that design (frustration: the lower one)
export function gameVotes(feedback: { participant?: string; rating?: Record<string, number | null>; cond?: string }[]): Vote[] {
  const per = new Map<string, Record<string, { A: number[]; B: number[] }>>();
  for (const r of feedback) {
    if (!r.rating || !r.participant) continue;
    const d = designOf(r.cond);
    if (!d) continue;
    const p = per.get(r.participant) ?? {};
    per.set(r.participant, p);
    for (const [q, v] of Object.entries(r.rating)) if (typeof v === 'number') (p[q] ??= { A: [], B: [] })[d].push(v);
  }
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return RATING_QUESTIONS.map((q) => {
    const out: Vote = { key: q.id, title: RATING_LABEL[q.id] ?? q.id, sub: q.text, A: 0, B: 0, tie: 0, scale: { low: q.low, high: q.high, lower: q.id === 'frustration' }, calc: [] };
    const all = { A: [] as number[], B: [] as number[] };
    for (const [who, p] of [...per.entries()].sort(([x], [y]) => x.localeCompare(y))) {
      const x = p[q.id];
      if (!x) continue;
      all.A.push(...x.A);
      all.B.push(...x.B);
      const a = avg(x.A);
      const b = avg(x.B);
      if (a == null || b == null) continue;
      const d = q.id === 'frustration' ? a - b : b - a;
      if (d > 0) out.B++;
      else if (d < 0) out.A++;
      else out.tie++;
      out.calc!.push({ who, a, b, v: d > 0 ? 'B' : d < 0 ? 'A' : null });
    }
    out.means = { A: avg(all.A), B: avg(all.B), nA: all.A.length, nB: all.B.length };
    return out;
  }).filter((v) => v.A + v.B + v.tie > 0);
}

function OverallTile({ source, v, unit, what }: { source: string; v: Vote | null; unit: string; what: string }) {
  const of = v ? v.A + v.B + v.tie : 0;
  const w = v ? lead2(v) : null;
  return (
    <div className="st-ab-otile">
      <span className="st-ab-olabel">{source}</span>
      <span className={`st-ab-ovalue is-${w ?? 'tie'}`}>{!of ? '–' : (w ?? '=')}</span>
      <span className="st-ab-otext">{!of ? 'noch keine Antworten' : w ? `Variante ${w} · ${v![w]} von ${of} ${of === 1 ? unit : `${unit}en`}` : `Gleichstand · A ${v!.A} · Gleich ${v!.tie} · B ${v!.B}`}</span>
      <span className="st-muted st-ab-owhat">{what}</span>
    </div>
  );
}

function VoteRow({ r, on, renaming, onClick, onRename, onRenamed }: { r: Vote; on?: boolean; renaming?: boolean; onClick?: () => void; onRename?: () => void; onRenamed?: (v: string | null) => void }) {
  const [v, setV] = useState(r.title);
  useEffect(() => setV(r.pref ? r.sub : r.title), [r.title, r.sub, r.pref, renaming]);
  const of = r.A + r.B + r.tie;
  const w = lead2(r);
  const body = (
    <>
      <span className="st-ab-rname">
        {renaming ? (
          <input
            autoFocus
            value={v}
            aria-label="Kurzname der Forschungsdimension"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenamed?.(v);
              if (e.key === 'Escape') (e.stopPropagation(), onRenamed?.(null));
            }}
            onBlur={() => onRenamed?.(v)}
          />
        ) : (
          <b>
            {r.title}
            {(r.nHyp ?? 0) > 0 && <span className="st-ab-nh">{`${r.nHyp} H`}</span>}
          </b>
        )}
        <span className="st-muted" title={r.sub}>
          {r.sub}
        </span>
      </span>
      {r.scale && (
        <span className="st-ab-scale" aria-label={`Skala 1 bis 5: 1 = ${r.scale.low}, 5 = ${r.scale.high}`}>
          <span>
            <b>1</b> {r.scale.low}
          </span>
          <span>
            <b>5</b> {r.scale.high}
          </span>
          {r.scale.lower && <em>niedriger ist besser</em>}
        </span>
      )}
      {r.calc ? (
        <span className="st-ab-wwrap">
          <button type="button" className={`st-ab-win is-${w ?? 'tie'}`} aria-describedby={`calc-${r.key}`}>
            {w ?? 'Gleich'}
          </button>
          <span className="st-ab-calc" role="tooltip" id={`calc-${r.key}`}>
            <b>So berechnet</b>
            <span className="st-muted">{r.scale?.lower ? 'je Person: der niedrigere Wert gewinnt' : 'je Person: der höhere Wert gewinnt'}</span>
            <span className="st-ab-ctbl">
              {r.calc.map((c) => (
                <span key={c.who} className="st-ab-crow">
                  <span>{c.who}</span>
                  <span>{`A ${val(c.a)}`}</span>
                  <span>{c.v === 'A' ? (r.scale?.lower ? '<' : '>') : c.v === 'B' ? (r.scale?.lower ? '>' : '<') : '='}</span>
                  <span>{`B ${val(c.b)}`}</span>
                  <span className={`st-ab-cv is-${c.v ?? 'tie'}`}>{`→ ${c.v ?? 'Gleich'}`}</span>
                </span>
              ))}
            </span>
            <span className="st-ab-csum">{`A ${r.A} · Gleich ${r.tie} · B ${r.B} → ${w ? `Variante ${w}` : 'Gleichstand'}`}</span>
          </span>
        </span>
      ) : (
        <span className={`st-ab-win is-${w ?? 'tie'}`}>{w ?? 'Gleich'}</span>
      )}
      <span className="st-ab-count">
        {`A ${r.A} · Gleich ${r.tie} · B ${r.B}`}
        {r.means && <small title="Mittelwert aller Bewertungen (1–5) je Variante">{`Ø A ${num(r.means.A)} (n=${r.means.nA}) · Ø B ${num(r.means.B)} (n=${r.means.nB})`}</small>}
      </span>
      <span className="st-ab-bar" aria-hidden="true">
        <i className="is-a" style={{ width: `${of ? (r.A / of) * 100 : 0}%` }} />
        <i className="is-n" style={{ width: `${of ? (r.tie / of) * 100 : 0}%` }} />
        <i className="is-b" style={{ width: `${of ? (r.B / of) * 100 : 0}%` }} />
      </span>
    </>
  );
  if (!onClick) return <div className={`st-ab-r${r.scale ? ' is-game' : ''}`}>{body}</div>;
  return (
    <div className={`st-ab-r is-click${on ? ' is-on' : ''}`} title={r.hint}>
      <button type="button" className="st-ab-rbtn" aria-pressed={on} aria-label={`${r.title}: Hypothesen filtern`} onClick={renaming ? undefined : onClick} />
      {body}
      <button
        type="button"
        className="st-ab-ren"
        aria-label={`Kurzname für ${r.title} ändern`}
        title="Kurzname ändern"
        onClick={(e) => {
          e.stopPropagation();
          onRename?.();
        }}
      >
        ✎
      </button>
    </div>
  );
}

// a hypothesis: its dimensions, influences, interpretation, the linked
// statements (each supporting, contradicting or complementary) and its status
function HypCard({ h, results, label, items, allItems, startEdit, onSave, onDelete }: { h: AbHyp; results: P1Result[]; label: (q: string) => string; items: Map<string, ItemDoc>; allItems: Record<string, ItemDoc>; startEdit: boolean; onSave: (h: AbHyp, what: string) => void; onDelete: () => void }) {
  const view = useContentView();
  const [edit, setEdit] = useState(startEdit);
  const [draft, setDraft] = useState(h);
  const [factor, setFactor] = useState('');
  const [pick, setPick] = useState(false);
  const itemOf = (id: string) => items.get(id) ?? allItems[id];
  const sup = h.evidence.filter((e) => e.kind === 'support');
  const supPeople = new Set(sup.map((e) => itemOf(e.item)?.person).filter(Boolean)).size;
  const weak = supPeople < 2;
  const st = HYP_STATUS.find(([k]) => k === h.status)?.[1];
  const start = () => (setDraft(h), setEdit(true));
  const commit = () => {
    onSave({ ...draft, title: draft.title.trim() || 'Ohne Titel', text: draft.text.trim(), reason: draft.reason?.trim() || undefined }, `Hypothese ${h.code} bearbeitet`);
    setEdit(false);
  };
  if (edit)
    return (
      <div className="st-ab-card is-edit">
        <div className="st-ab-chead">
          <span className="st-ab-code">{h.code}</span>
          <input className="st-ab-in" value={draft.title} placeholder="Kurzer Titel, z. B. Präferenz durch Ergebnisqualität beeinflusst" aria-label="Titel der Hypothese" autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <span className="st-cx-lab">Forschungsdimension</span>
        <div className="st-ab-chips">
          {results.map((r) => {
            const on = draft.dims.includes(r.question);
            return (
              <button key={r.question} type="button" className={`st-fchip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setDraft({ ...draft, dims: on ? draft.dims.filter((x) => x !== r.question) : [...draft.dims, r.question] })}>
                {label(r.question)}
              </button>
            );
          })}
        </div>
        <span className="st-cx-lab">Mögliche Einflussfaktoren</span>
        <div className="st-ab-chips">
          {draft.factors.map((f) => (
            <button key={f} type="button" className="st-fchip" onClick={() => setDraft({ ...draft, factors: draft.factors.filter((x) => x !== f) })} aria-label={`${f} entfernen`}>
              {`${f} ×`}
            </button>
          ))}
          <input
            className="st-ab-in is-small"
            value={factor}
            placeholder="+ Faktor, Enter"
            aria-label="Einflussfaktor hinzufügen"
            onChange={(e) => setFactor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && factor.trim()) {
                e.preventDefault();
                if (!draft.factors.includes(factor.trim())) setDraft({ ...draft, factors: [...draft.factors, factor.trim()] });
                setFactor('');
              }
            }}
          />
        </div>
        <span className="st-cx-lab">Interpretation</span>
        <textarea rows={3} value={draft.text} placeholder="Was die Ergebnisse erklären könnte – als Annahme formuliert" aria-label="Interpretation" onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <span className="st-cx-lab">Status</span>
        <span className="st-ab-chips" role="radiogroup" aria-label="Status der Hypothese">
          {HYP_STATUS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={draft.status === k} className={`st-fchip${draft.status === k ? ' is-on' : ''}`} onClick={() => setDraft({ ...draft, status: k })}>
              {l}
            </button>
          ))}
        </span>
        {draft.status === 'rejected' && <textarea rows={2} value={draft.reason ?? ''} placeholder="Warum nicht berücksichtigt (z. B. zu wenig Evidenz, Projektumfang)" aria-label="Grund" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />}
        <div className="st-ab-foot">
          <button type="button" className="st-linkbtn st-cx-del" onClick={() => confirm(`Hypothese ${h.code} löschen? Sie wird auch aus den Redesign-Entscheidungen genommen.`) && onDelete()}>
            Löschen
          </button>
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={() => setEdit(false)}>
            Abbrechen
          </button>
          <button type="button" className="st-cx-btn is-pri" onClick={commit}>
            Speichern
          </button>
        </div>
      </div>
    );
  return (
    <div className={`st-ab-card is-${h.status}`}>
      <div className="st-ab-chead">
        <span className="st-ab-code">{h.code}</span>
        <strong>{h.title || 'Ohne Titel'}</strong>
        {h.dims.map((d) => (
          <span key={d} className="st-ab-tag is-dim">
            {label(d)}
          </span>
        ))}
        {h.factors.map((f) => (
          <span key={f} className="st-ab-tag">
            {f}
          </span>
        ))}
        <span className={`st-ab-status is-${h.status}`}>{st}</span>
      </div>
      {h.text && <p className="st-ab-text">{h.text}</p>}
      {h.status === 'rejected' && h.reason && <p className="st-ab-reason">{`Nicht berücksichtigt: ${h.reason}`}</p>}
      {weak && <p className="st-ab-weak">{`Unzureichend belegt: ${sup.length} ${sup.length === 1 ? 'stützender Beleg' : 'stützende Belege'} (${supPeople} ${supPeople === 1 ? 'Person' : 'Personen'})`}</p>}
      {h.evidence.length > 0 && (
        <ul className="st-ab-evlist">
          {h.evidence.map((e) => {
            const i = itemOf(e.item);
            return (
              <li key={e.item}>
                <strong>{i?.person ?? '–'}</strong>
                <span>
                  <small>{i ? SECTION_LABEL[i.section] : ''}</small>
                  {i ? itemText(view, i) : 'Aussage gelöscht'}
                </span>
                <select className={`st-ab-kind is-${e.kind}`} value={e.kind} aria-label={`Art des Belegs von ${i?.person ?? ''}`} onChange={(ev) => onSave({ ...h, evidence: h.evidence.map((x) => (x.item === e.item ? { ...x, kind: ev.target.value as EvKind } : x)) }, `Beleg in ${h.code} geändert`)}>
                  {EV_KIND.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <button type="button" className="st-cx-x is-small" aria-label={`Beleg von ${i?.person ?? ''} entfernen`} onClick={() => onSave({ ...h, evidence: h.evidence.filter((x) => x.item !== e.item) }, `Beleg aus ${h.code} genommen`)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="st-ab-row">
        <button type="button" className="st-cx-btn" onClick={() => setPick(true)}>
          + Beleg verknüpfen
        </button>
        <button type="button" className="st-cx-btn" onClick={start}>
          Bearbeiten
        </button>
      </div>
      {pick && <EvidencePicker h={h} items={[...items.values()]} onClose={() => setPick(false)} onPick={(item, kind) => onSave({ ...h, evidence: [...h.evidence.filter((x) => x.item !== item), { item, kind }] }, `Beleg zu ${h.code}`)} />}
    </div>
  );
}

// a small search over Beobachtungen & Feedback to link statements
function EvidencePicker({ h, items, onClose, onPick }: { h: AbHyp; items: ItemDoc[]; onClose: () => void; onPick: (item: string, kind: EvKind) => void }) {
  const view = useContentView();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<EvKind>('support');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const linked = new Set(h.evidence.map((e) => e.item));
  const hits = items.filter((i) => words.every((w) => `${i.person} ${i.text} ${i.de ?? ''} ${i.question ?? ''}`.toLowerCase().includes(w))).slice(0, 40);
  return (
    <div className="st-modal-back" role="presentation" onClick={onClose}>
      <div className="st-modal st-ab-picker" role="dialog" aria-modal="true" aria-label={`Belege für ${h.code}`} onClick={(e) => e.stopPropagation()}>
        <header className="st-modal-head">
          <h2>{`Belege für ${h.code}${h.title ? ` · ${h.title}` : ''}`}</h2>
          <div className="st-ab-pickbar">
            <input type="search" autoFocus value={q} placeholder="Suchen: P-ID oder Wort …" aria-label="Aussagen durchsuchen" onChange={(e) => setQ(e.target.value)} />
            <span className="st-ab-chips" role="radiogroup" aria-label="Art des Belegs">
              {EV_KIND.map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`st-fchip${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)}>
                  {l}
                </button>
              ))}
            </span>
          </div>
        </header>
        <div className="st-modal-body">
          {!hits.length && <p className="st-muted">Keine Aussage gefunden.</p>}
          <ul className="st-ab-hits">
            {hits.map((i) => (
              <li key={i.id}>
                <span>
                  <small>{`${i.person} · ${SECTION_LABEL[i.section]}`}</small>
                  {itemText(view, i)}
                </span>
                <button type="button" className={`st-cx-btn${linked.has(i.id) ? '' : ' is-pri'}`} onClick={() => onPick(i.id, kind)}>
                  {linked.has(i.id) ? 'Verknüpft ✓' : 'Verknüpfen'}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer className="st-modal-foot">
          <span className="st-muted">{`${h.evidence.length} verknüpft`}</span>
          <span className="st-selbar-gap" />
          <button type="button" onClick={onClose}>
            Fertig
          </button>
        </footer>
      </div>
    </div>
  );
}

// a redesign decision: the hypotheses considered, the proposal, why
function DecCard({ d, hyps, startEdit, onSave, onDelete }: { d: AbDecision; hyps: AbHyp[]; startEdit: boolean; onSave: (d: AbDecision, what: string) => void; onDelete: () => void }) {
  const [edit, setEdit] = useState(startEdit);
  const [draft, setDraft] = useState(d);
  const [copied, setCopied] = useState(false);
  const linked = hyps.filter((h) => d.hyps.includes(h.id));
  const copy = async () => {
    const t = [`Redesign: ${d.title || 'Ohne Titel'}`, `Berücksichtigte Hypothesen: ${linked.map((h) => `${h.code} ${h.title}`).join('; ') || '–'}`, `Gestaltungsvorschlag: ${d.proposal || '–'}`, `Begründung: ${d.why || '–'}`].join('\n');
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Zum Kopieren:', t);
    }
  };
  if (edit)
    return (
      <div className="st-ab-card is-edit">
        <input className="st-ab-in" value={draft.title} placeholder="Maßnahme, z. B. Wirkung des Feedbacks vorab zeigen" aria-label="Titel der Maßnahme" autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <span className="st-cx-lab">Berücksichtigte Hypothesen</span>
        <div className="st-ab-chips">
          {hyps.map((h) => {
            const on = draft.hyps.includes(h.id);
            return (
              <button key={h.id} type="button" className={`st-fchip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setDraft({ ...draft, hyps: on ? draft.hyps.filter((x) => x !== h.id) : [...draft.hyps, h.id] })}>
                {`${h.code} · ${h.title || 'Ohne Titel'}`}
              </button>
            );
          })}
          {!hyps.length && <span className="st-muted">Noch keine Hypothese.</span>}
        </div>
        <span className="st-cx-lab">Gestaltungsvorschlag</span>
        <textarea rows={3} value={draft.proposal} aria-label="Gestaltungsvorschlag" placeholder="Was im Redesign geändert wird" onChange={(e) => setDraft({ ...draft, proposal: e.target.value })} />
        <span className="st-cx-lab">Begründung der Entscheidung</span>
        <textarea rows={3} value={draft.why} aria-label="Begründung der Entscheidung" placeholder="Warum – mit Bezug auf Ergebnisse und Belege" onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
        <div className="st-ab-foot">
          <button type="button" className="st-linkbtn st-cx-del" onClick={() => confirm('Diese Redesign-Entscheidung löschen?') && onDelete()}>
            Löschen
          </button>
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={() => setEdit(false)}>
            Abbrechen
          </button>
          <button
            type="button"
            className="st-cx-btn is-pri"
            onClick={() => {
              onSave({ ...draft, title: draft.title.trim() || 'Ohne Titel', proposal: draft.proposal.trim(), why: draft.why.trim() }, `Redesign „${draft.title.trim() || 'Ohne Titel'}“ gespeichert`);
              setEdit(false);
            }}
          >
            Speichern
          </button>
        </div>
      </div>
    );
  return (
    <div className="st-ab-card">
      <div className="st-ab-chead">
        <strong>{d.title || 'Ohne Titel'}</strong>
      </div>
      <span className="st-cx-lab">Berücksichtigte Hypothesen</span>
      <div className="st-ab-chips">
        {linked.length ? (
          linked.map((h) => (
            <span key={h.id} className="st-ab-tag is-dim">
              {`${h.code} · ${h.title || 'Ohne Titel'}`}
            </span>
          ))
        ) : (
          <span className="st-muted">keine</span>
        )}
      </div>
      <span className="st-cx-lab">Gestaltungsvorschlag</span>
      <p className="st-ab-text">{d.proposal || '–'}</p>
      <span className="st-cx-lab">Begründung der Entscheidung</span>
      <p className="st-ab-text">{d.why || '–'}</p>
      <div className="st-ab-row">
        <span className="st-muted">{`${linked.length} ${linked.length === 1 ? 'Hypothese' : 'Hypothesen'} verknüpft`}</span>
        <span className="st-cx-sp" />
        <button type="button" className="st-cx-btn" onClick={() => void copy()}>
          {copied ? 'Kopiert ✓' : 'Kopieren'}
        </button>
        <button type="button" className="st-cx-btn" onClick={() => (setDraft(d), setEdit(true))}>
          Bearbeiten
        </button>
      </div>
    </div>
  );
}
