// Qualitatives Feedback → A/B-Vergleich & Gestaltungsableitung, in three steps:
//   1. A/B-Ergebnisse   every Tally comparison question (Teil 1: Direkter Vergleich)
//                       as a row: A, B, without a preference, the sign test; the
//                       values come from Tally and are never changed here; a click
//                       on a row filters the hypotheses by that research dimension
//   2. Hypothesen       own interpretations, each with linked statements from
//                       Beobachtungen & Feedback (supporting, contradicting or
//                       complementary); weakly backed ones are flagged
//   3. Redesign         design decisions: the hypotheses considered, the proposal
//                       and why; a hypothesis can also be "Nicht berücksichtigt"
// The tiles on top (Präferenz A / B, Hypothesen, Redesign) choose what is shown
// below the results. Stored in settings/abCompare.
import { useEffect, useMemo, useState } from 'react';
import { part1, type P1Result } from './analysis';
import type { ItemDoc } from './types';
import { SECTION_LABEL } from './types';
import { itemText, useContentView } from './translations';
import { logChange, useCtx } from './ui';
import { FoldBtn } from './notesDashboard';

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
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)} %` : '–');
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
  const { slice, study } = useCtx();
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
  const toggle = (v: View) => setShow(show === v ? null : v);
  const shownHyps = dim ? hyps.filter((h) => h.dims.includes(dim)) : hyps;
  const putHyp = (h: AbHyp, what: string) => save({ hyps: (latest().hyps ?? []).some((x) => x.id === h.id) ? (latest().hyps ?? []).map((x) => (x.id === h.id ? h : x)) : [...(latest().hyps ?? []), h] }, what);
  const delHyp = (h: AbHyp) =>
    save({ hyps: (latest().hyps ?? []).filter((x) => x.id !== h.id), decisions: (latest().decisions ?? []).map((d) => ({ ...d, hyps: d.hyps.filter((x) => x !== h.id) })) }, `Hypothese ${h.code} gelöscht`);
  const putDec = (d: AbDecision, what: string) => save({ decisions: (latest().decisions ?? []).some((x) => x.id === d.id) ? (latest().decisions ?? []).map((x) => (x.id === d.id ? d : x)) : [...(latest().decisions ?? []), d] }, what);
  const nextCode = () => `H${Math.max(0, ...hyps.map((h) => Number(h.code.replace(/\D/g, '')) || 0)) + 1}`;
  const [fresh, setFresh] = useState<string | null>(null);

  return (
    <section className={`st-lcard st-ab${folded ? ' is-folded' : ''}`} data-nav="A/B-Vergleich" aria-label="A/B-Vergleich & Gestaltungsableitung">
      <div className="st-lc-title">
        <h2>A/B-Vergleich & Gestaltungsableitung</h2>
        <span className="st-muted st-lc-who">Empirische Ergebnisse · Interpretation · Redesign</span>
        <FoldBtn folded={folded} label="A/B-Vergleich" onClick={onFold} />
      </div>
      {!folded && (
        <>
          <div className="st-ab-tiles">
            {(
              [
                ['A', 'Präferenz A', byPref('A').length, `von ${slice.survey.filter((r) => r.person && prefQ && r.p1[prefQ] != null).length} Personen`],
                ['B', 'Präferenz B', byPref('B').length, `von ${slice.survey.filter((r) => r.person && prefQ && r.p1[prefQ] != null).length} Personen`],
                ['hyp', 'Hypothesen', hyps.length, `${hyps.filter((h) => h.status === 'selected').length} für Redesign`],
                ['red', 'Redesign', decisions.length, decisions.length === 1 ? 'Maßnahme' : 'Maßnahmen'],
              ] as [View, string, number, string][]
            ).map(([v, l, n, sub]) => (
              <button key={v} type="button" className={`st-dash-kpi${show === v ? ' is-on' : ''}`} aria-pressed={show === v} onClick={() => toggle(v)}>
                <span className="st-dash-kpilabel">{l}</span>
                <span className="st-dash-kpivalue">{n}</span>
                <span className="st-dash-kpisub">{sub}</span>
              </button>
            ))}
          </div>

          <div className="st-ab-step">
            <i>1</i>
            <b>A/B-Ergebnisse</b>
            <span className="st-muted">Tally · Teil 1: Direkter Vergleich · Zeile anklicken filtert die Hypothesen</span>
          </div>
          {results.length ? (
            <>
              <div className="st-ab-tblwrap">
              <table className="st-ab-tbl">
                <thead>
                  <tr>
                    <th>Forschungsdimension</th>
                    <th>A</th>
                    <th>B</th>
                    <th className="st-ab-hm">ohne Präf.</th>
                    <th className="st-ab-hm" aria-label="Verteilung" />
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <ResultRow
                      key={r.question}
                      r={r}
                      label={label(r.question)}
                      pref={r.question === prefQ}
                      on={dim === r.question}
                      renaming={rename === r.question}
                      onClick={() => setDim(dim === r.question ? null : r.question)}
                      onRename={() => setRename(r.question)}
                      onRenamed={(v) => {
                        setRename(null);
                        if (v !== null) save({ dims: { ...(latest().dims ?? {}), [r.question]: v.trim() } }, `Kurzname für „${lead(r.question)}“`);
                      }}
                      nHyp={hyps.filter((h) => h.dims.includes(r.question)).length}
                    />
                  ))}
                </tbody>
              </table>
              </div>
              <div className="st-ab-under">
                <span className="st-muted">Werte aus Tally, hier nicht veränderbar. „ohne Präf.“ zählt nicht im Vorzeichentest.</span>
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
                {dim && (
                  <button type="button" className="st-fchip is-on" onClick={() => setDim(null)}>
                    {`${label(dim)} ×`}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="st-muted st-ab-empty">Noch keine Tally-Vergleichsfragen: unter Daten & Validierung → Zuordnung die Spalten als „Teil 1“ zuordnen.</p>
          )}

          {(show === 'A' || show === 'B') && (
            <div className="st-ab-people">
              <div className="st-ab-step">
                <b>{`Präferenz ${show}`}</b>
                <span className="st-muted">{`${byPref(show).length} Personen · ihre Tally-Antworten und verknüpften Aussagen`}</span>
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

function ResultRow({ r, label, pref, on, renaming, onClick, onRename, onRenamed, nHyp }: { r: P1Result; label: string; pref: boolean; on: boolean; renaming: boolean; onClick: () => void; onRename: () => void; onRenamed: (v: string | null) => void; nHyp: number }) {
  const [v, setV] = useState(label);
  useEffect(() => setV(label), [label, renaming]);
  const of = r.A + r.B + r.neutral;
  return (
    <tr className={on ? 'is-on' : ''} onClick={renaming ? undefined : onClick} aria-selected={on}>
      <td>
        {renaming ? (
          <input
            autoFocus
            value={v}
            aria-label="Kurzname der Forschungsdimension"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenamed(v);
              if (e.key === 'Escape') (e.stopPropagation(), onRenamed(null));
            }}
            onBlur={() => onRenamed(v)}
          />
        ) : (
          <span className="st-ab-dim">
            <button type="button" className="st-ab-dimname" aria-pressed={on} title={r.question}>
              {label}
            </button>
            {pref && <span className="st-ab-pref">Präferenzfrage</span>}
            {nHyp > 0 && <span className="st-ab-nh">{`${nHyp} H`}</span>}
            <button
              type="button"
              className="st-ab-ren"
              aria-label={`Kurzname für ${label} ändern`}
              title="Kurzname ändern"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              ✎
            </button>
          </span>
        )}
      </td>
      <td className="st-ab-num">
        {r.A}
        <small>{pct(r.A, of)}</small>
      </td>
      <td className="st-ab-num">
        {r.B}
        <small>{pct(r.B, of)}</small>
      </td>
      <td className="st-ab-num st-ab-hm">{r.neutral}</td>
      <td className="st-ab-hm">
        <span className="st-ab-bar" aria-hidden="true">
          <i className="is-a" style={{ width: `${of ? (r.A / of) * 100 : 0}%` }} />
          <i className="is-b" style={{ width: `${of ? (r.B / of) * 100 : 0}%` }} />
          <i className="is-n" style={{ width: `${of ? (r.neutral / of) * 100 : 0}%` }} />
        </span>
      </td>
      <td className="st-ab-det">{r.winner ? `Mehrheit ${r.winner} · ${pText(r.p)}` : 'keine Mehrheit'}</td>
    </tr>
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
