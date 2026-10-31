// Qualitatives Feedback: a filter-first overview above the statements. Three
// questions in seconds: what problems dominate, what to look into, and which
// observations back that up. Every tile and bar is a filter for the list below.
import { useState } from 'react';
import type { ChipRole, ItemDoc, TagGroup } from './types';
import { effectiveChips, shortName, type Model } from './model';
import { itemText, type ContentView } from './translations';

export type Kpi = 'problem' | 'essential' | 'tbd' | 'unchecked';
export interface DashFilter {
  kpi?: Kpi;
  tags: Record<string, string>; // group id → tag id
  person?: string;
}
export const NO_DASH: DashFilter = { tags: {} };
export const dashActive = (f: DashFilter) => !!f.kpi || !!f.person || Object.keys(f.tags).length > 0;

const unchecked = (i: ItemDoc) => !i.confirmed || i.suggested.length > 0;
const chipsOf = (m: Model, i: ItemDoc) => effectiveChips(i.chips, m.tags, m.chipRole);
const hasRole = (m: Model, chips: string[], r: ChipRole) => chips.some((c) => m.chipRole.get(c) === r);
const kpiOk = (m: Model, i: ItemDoc, chips: string[], k: Kpi) => (k === 'unchecked' ? unchecked(i) : hasRole(m, chips, k));

// skip: the part of the filter left out (a figure counts against the other filters, never its own)
export function matchDash(m: Model, i: ItemDoc, f: DashFilter, skip?: 'kpi' | 'person' | string): boolean {
  const chips = chipsOf(m, i);
  if (f.kpi && skip !== 'kpi' && !kpiOk(m, i, chips, f.kpi)) return false;
  if (f.person && skip !== 'person' && i.person !== f.person) return false;
  for (const [g, c] of Object.entries(f.tags)) if (g !== skip && !chips.includes(c)) return false;
  return true;
}

const PICK_KEY = 'asciia-study-dash-group';
const MORE_KEY = 'asciia-study-dash-more';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // (not remembered)
  }
};

function Bars({ rows, on, onPick, label }: { rows: { id: string; label: string; n: number }[]; on?: string; onPick: (id: string) => void; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="st-muted st-dash-none">keine Daten</p>;
  return (
    <ul className="st-dash-bars" aria-label={label}>
      {rows.map((r, k) => (
        <li key={r.id}>
          <button type="button" className={`st-dash-bar${on === r.id ? ' is-on' : ''}${k === 0 && r.n > 0 ? ' is-top' : ''}`} aria-pressed={on === r.id} onClick={() => onPick(r.id)} title="Anklicken zum Filtern">
            <span className="st-dash-barlabel">{r.label}</span>
            <span className="st-dash-track" aria-hidden="true">
              {r.n > 0 && <span className="st-dash-fill" style={{ width: `${(r.n / max) * 100}%` }} />}
            </span>
            <span className={`st-dash-barn${r.n ? '' : ' st-muted'}`}>{r.n}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function NotesDashboard({ model, live, shown, f, setF, view }: { model: Model; live: ItemDoc[]; shown: ItemDoc[]; f: DashFilter; setF: (f: DashFilter) => void; view: ContentView }) {
  const artGroup = model.tags.find((g) => g.chips.some((c) => c.role === 'problem'));
  const prioGroup = model.tags.find((g) => g.chips.some((c) => c.role === 'essential'));
  const groups = model.tags.filter((g) => g !== artGroup && g !== prioGroup && g.chips.length);
  const [pick, setPick] = useState(() => read(PICK_KEY) ?? '');
  const [more, setMore] = useState(() => read(MORE_KEY) === '1');
  const group: TagGroup | undefined = groups.find((g) => g.id === pick) ?? groups.find((g) => g.id === 'thema') ?? groups[0];

  const tile = (k: Kpi, label: string, hint: string) => {
    const base = live.filter((i) => matchDash(model, i, f, 'kpi'));
    const n = base.filter((i) => kpiOk(model, i, chipsOf(model, i), k)).length;
    const on = f.kpi === k;
    return (
      <button key={k} type="button" className={`st-dash-kpi${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, kpi: on ? undefined : k })} title={hint}>
        <span className="st-dash-kpilabel">{label}</span>
        <span className="st-dash-kpivalue">{n}</span>
        <span className="st-dash-kpisub">{`von ${base.length} Aussagen`}</span>
      </button>
    );
  };
  const setTag = (g: string, c: string) => {
    const tags = { ...f.tags };
    if (tags[g] === c) delete tags[g];
    else tags[g] = c;
    setF({ ...f, tags });
  };
  // problem statements per tag of the chosen category (against the other filters)
  const byGroup = (g: TagGroup, onlyProblems: boolean) => {
    const base = live.filter((i) => matchDash(model, i, f, g.id) && (!onlyProblems || hasRole(model, chipsOf(model, i), 'problem')));
    return g.chips
      .map((c) => ({ id: c.id, label: c.label, n: base.filter((i) => chipsOf(model, i).includes(c.id)).length }))
      .filter((r) => r.n > 0 || !onlyProblems)
      .sort((a, b) => b.n - a.n);
  };
  const people = (() => {
    const base = live.filter((i) => matchDash(model, i, f, 'person') && hasRole(model, chipsOf(model, i), 'problem'));
    const ids = [...new Set(live.map((i) => i.person))].sort();
    return ids.map((p) => ({ id: p, label: p, n: base.filter((i) => i.person === p).length })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  })();

  const label = (id: string) => model.chipLabel.get(id) ?? id;
  const groupName = (id: string) => model.tags.find((g) => g.id === id)?.name ?? id;
  const kpiName: Record<Kpi, string> = { problem: 'Probleme', essential: shortName(model, 'essential', 'Essenziell'), tbd: shortName(model, 'tbd', 'Offen'), unchecked: 'Ungeprüft' };
  const active = dashActive(f);

  // the evidence: the most pressing statements first
  const rank = (i: ItemDoc) => {
    const c = chipsOf(model, i);
    return hasRole(model, c, 'essential') ? 0 : hasRole(model, c, 'tbd') ? 1 : hasRole(model, c, 'problem') ? 2 : 3;
  };
  const evidence = [...shown].sort((a, b) => rank(a) - rank(b) || a.person.localeCompare(b.person) || a.order - b.order).slice(0, 8);
  const meta = (i: ItemDoc) => {
    const c = chipsOf(model, i);
    const prio = prioGroup ? c.filter((x) => prioGroup.chips.some((y) => y.id === x)).map(label) : [];
    const art = artGroup ? c.filter((x) => artGroup.chips.some((y) => y.id === x)).map(label) : [];
    const rest = group ? c.filter((x) => group.chips.some((y) => y.id === x)).map(label) : [];
    return [...(prio.length ? prio : art), ...rest, i.link ?? i.person].join(' · ');
  };
  const jump = (sel: string, block: ScrollLogicalPosition = 'center') => {
    const el = document.querySelector<HTMLElement>(sel);
    el?.scrollIntoView({ behavior: 'smooth', block });
    el?.classList.add('is-flash');
    window.setTimeout(() => el?.classList.remove('is-flash'), 1400);
  };

  return (
    <section className="st-dash" aria-label="Überblick und Filter" data-nav="Überblick">
      <div className="st-dash-kpis">
        {tile('problem', kpiName.problem, 'Aussagen mit der Art „Problem“ – anklicken zum Filtern')}
        {tile('essential', kpiName.essential, 'Probleme mit der Priorität „Essenziell“ – anklicken zum Filtern')}
        {tile('tbd', kpiName.tbd, 'Probleme, deren Priorität noch offen ist – anklicken zum Filtern')}
        {tile('unchecked', kpiName.unchecked, 'Noch nicht geprüfte Aussagen oder solche mit offenen KI-Vorschlägen – anklicken zum Filtern')}
      </div>

      <div className="st-dash-main">
        <div className="st-dash-card">
          <div className="st-dash-cardhead">
            <h3>
              Probleme nach{' '}
              {groups.length > 1 ? (
                <select
                  value={group?.id ?? ''}
                  aria-label="Kategorie"
                  onChange={(e) => {
                    setPick(e.target.value);
                    write(PICK_KEY, e.target.value);
                  }}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : (
                group?.name
              )}
            </h3>
            <span className="st-muted">Anklicken zum Filtern</span>
          </div>
          {group ? <Bars rows={byGroup(group, true)} on={f.tags[group.id]} onPick={(c) => setTag(group.id, c)} label={`Probleme nach ${group.name}`} /> : <p className="st-muted">Keine Kategorie</p>}
          <button
            type="button"
            className="st-linkbtn st-dash-more"
            aria-expanded={more}
            onClick={() => {
              setMore(!more);
              write(MORE_KEY, more ? '0' : '1');
            }}
          >
            {`Weitere Auswertungen · ${more ? 'Weniger anzeigen' : 'Mehr anzeigen'}`}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {more && (
            <div className="st-dash-moregrid">
              {artGroup && (
                <div>
                  <h4>{`Aussagen nach ${artGroup.name}`}</h4>
                  <Bars rows={byGroup(artGroup, false)} on={f.tags[artGroup.id]} onPick={(c) => setTag(artGroup.id, c)} label={`Aussagen nach ${artGroup.name}`} />
                </div>
              )}
              <div>
                <h4>Probleme je Teilnehmende</h4>
                <Bars rows={people} on={f.person} onPick={(p) => setF({ ...f, person: f.person === p ? undefined : p })} label="Probleme je Teilnehmende" />
              </div>
            </div>
          )}
        </div>

        <div className="st-dash-card st-dash-evidence">
          <div className="st-dash-cardhead">
            <h3>
              Gefilterte Beobachtungen: <span className="st-dash-count">{`${shown.length} von ${live.length}`}</span>
            </h3>
            {active && (
              <button type="button" className="st-linkbtn" onClick={() => setF(NO_DASH)}>
                Zurücksetzen
              </button>
            )}
          </div>
          {active && (
            <div className="st-dash-active">
              {f.kpi && (
                <button type="button" className="st-chip is-on" onClick={() => setF({ ...f, kpi: undefined })} aria-label={`Filter ${kpiName[f.kpi]} entfernen`}>
                  {kpiName[f.kpi]} ×
                </button>
              )}
              {Object.entries(f.tags).map(([g, c]) => (
                <button key={g} type="button" className="st-chip is-on" onClick={() => setTag(g, c)} aria-label={`Filter ${groupName(g)}: ${label(c)} entfernen`}>
                  {`${groupName(g)}: ${label(c)} ×`}
                </button>
              ))}
              {f.person && (
                <button type="button" className="st-chip is-on" onClick={() => setF({ ...f, person: undefined })} aria-label={`Filter ${f.person} entfernen`}>
                  {f.person} ×
                </button>
              )}
            </div>
          )}
          {evidence.length ? (
            <ul className="st-dash-list">
              {evidence.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => jump(`[data-anchor="i-${i.id}"]`)} title="Zur Aussage springen">
                    <svg className="st-dash-note" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <path d="M14 3v6h6M8 13h8M8 17h5" />
                    </svg>
                    <span className="st-dash-text">
                      <span data-notr>{itemText(view, i)}</span>
                      <span className="st-dash-meta">{meta(i)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="st-muted">Keine Aussage passt zu den Filtern.</p>
          )}
          {shown.length > evidence.length && (
            <button type="button" className="st-linkbtn" onClick={() => jump('.st-notes-bar', 'start')}>
              {`Alle ${shown.length} unten anzeigen`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
