// Qualitatives Feedback: a filter-first overview above the statements: what
// problems dominate and what to look into. Every tile and bar is a filter for the
// statements below; the same filters (and the active ones) sit in the Aussagen
// card as chips (DashFilterBar). The section can be folded.
import { useState } from 'react';
import type { ChipRole, ItemDoc, TagGroup } from './types';
import { effectiveChips, shortName, type Model } from './model';
import { relOf } from './crafting';

export type Kpi = 'problem' | 'essential' | 'tbd' | 'nice' | 'unchecked';
// the Crafting-Bezug (Klassifizierung des Feedbacks): only the game, crafting
// (generator & interface or its integration in the game), or not settled
// (no confirmed Crafting-Bezug, or Unklar)
export type Rel = 'game' | 'craft' | 'unclear';
export interface DashFilter {
  kpi?: Kpi;
  rel?: Rel;
  tags: Record<string, string>; // group id → tag id
  person?: string;
}
export const NO_DASH: DashFilter = { tags: {} };
export const dashActive = (f: DashFilter) => !!f.kpi || !!f.rel || !!f.person || Object.keys(f.tags).length > 0;

const unchecked = (i: ItemDoc) => !i.confirmed || i.suggested.length > 0;
const chipsOf = (m: Model, i: ItemDoc) => effectiveChips(i.chips, m.tags, m.chipRole);
const hasRole = (m: Model, chips: string[], r: ChipRole) => chips.some((c) => m.chipRole.get(c) === r);
const kpiOk = (m: Model, i: ItemDoc, chips: string[], k: Kpi) => (k === 'unchecked' ? unchecked(i) : hasRole(m, chips, k));

export const relOk = (m: Model, chips: string[], r: Rel) => {
  const x = relOf(m, { chips });
  return r === 'game' ? x === 'game' : r === 'craft' ? x === 'core' || x === 'integration' : x === 'open' || x === 'unclear';
};

// skip: the part of the filter left out (a figure counts against the other filters, never its own)
export function matchDash(m: Model, i: ItemDoc, f: DashFilter, skip?: 'kpi' | 'person' | string): boolean {
  const chips = chipsOf(m, i);
  if (f.kpi && skip !== 'kpi' && !kpiOk(m, i, chips, f.kpi)) return false;
  if (f.rel && skip !== 'rel' && !relOk(m, chips, f.rel)) return false;
  if (f.person && skip !== 'person' && i.person !== f.person) return false;
  for (const [g, c] of Object.entries(f.tags)) if (g !== skip && !chips.includes(c)) return false;
  return true;
}

const PICK_KEY = 'asciia-study-dash-group';
const MORE_KEY = 'asciia-study-dash-more';
const FOLD_KEY = 'asciia-study-dash-folded';
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

export function NotesDashboard({ model, live, f, setF }: { model: Model; live: ItemDoc[]; f: DashFilter; setF: (f: DashFilter) => void }) {
  const artGroup = model.tags.find((g) => g.chips.some((c) => c.role === 'problem'));
  const prioGroup = model.tags.find((g) => g.chips.some((c) => c.role === 'essential'));
  const groups = model.tags.filter((g) => g !== artGroup && g !== prioGroup && g.chips.length);
  const [pick, setPick] = useState(() => read(PICK_KEY) ?? '');
  const [more, setMore] = useState(() => read(MORE_KEY) === '1');
  const [folded, setFolded] = useState(() => read(FOLD_KEY) === '1');
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

  const kpiName = KPI_NAME(model);
  return (
    <section className={`st-dash${folded ? ' is-folded' : ''}`} aria-label="Probleme" data-nav="Probleme">
      <div className="st-foldhead">
        <h2>Probleme</h2>
        <FoldBtn
          folded={folded}
          label="Probleme"
          onClick={() => {
            setFolded(!folded);
            write(FOLD_KEY, folded ? '0' : '1');
          }}
        />
      </div>
      {!folded && (
      <>
      <div className="st-dash-kpis">
        {tile('problem', kpiName.problem, 'Aussagen mit der Art „Problem“ – anklicken zum Filtern')}
        {tile('essential', kpiName.essential, 'Probleme mit der Priorität „Essenziell“ – anklicken zum Filtern')}
        {tile('tbd', kpiName.tbd, 'Probleme, deren Priorität noch offen ist – anklicken zum Filtern')}
        {/* (the review progress, set apart from the three problem figures) */}
        {tile('unchecked', kpiName.unchecked, 'Noch nicht geprüfte Aussagen oder solche mit offenen KI-Vorschlägen – anklicken zum Filtern')}
      </div>
      {/* (the Crafting-Bezug, as in the Klassifizierung des Feedbacks) */}
      <div className="st-dash-kpis is-rel">
        {REL_TILES.map(([r, label, sub, hint]) => {
          const base = live.filter((i) => matchDash(model, i, f, 'rel'));
          const n = base.filter((i) => relOk(model, chipsOf(model, i), r)).length;
          const on = f.rel === r;
          return (
            <button key={r} type="button" className={`st-dash-kpi${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, rel: on ? undefined : r })} title={hint}>
              <span className="st-dash-kpilabel">{label}</span>
              <span className="st-dash-kpivalue">{n}</span>
              <span className="st-dash-kpisub">{sub(base.length)}</span>
            </button>
          );
        })}
      </div>

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

      </>
      )}
    </section>
  );
}

const KPI_NAME = (model: Model): Record<Kpi, string> => ({ problem: 'Probleme', essential: shortName(model, 'essential', 'Essenziell'), tbd: shortName(model, 'tbd', 'Offen'), nice: shortName(model, 'nice', 'Nice-to-have'), unchecked: 'Ungeprüft' });

// a fold button: "Einklappen" / "Ausklappen" with its arrow
export function FoldBtn({ folded, label, onClick, compact }: { folded: boolean; label: string; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" className={`st-foldtoggle${compact ? ' is-compact' : ''}`} aria-expanded={!folded} aria-label={`${label} ${folded ? 'ausklappen' : 'einklappen'}`} title={folded ? 'Ausklappen' : 'Einklappen'} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={folded ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} />
      </svg>
      {!compact && <span>{folded ? 'Ausklappen' : 'Einklappen'}</span>}
    </button>
  );
}

// the filters as chips in the Aussagen card: Probleme, Essenziell, Offen,
// Nice-to-have, Ungeprüft (each counted against the other filters), the active
// tag and person filters set above, and Zurücksetzen
export function DashFilterBar({ model, live, f, setF }: { model: Model; live: ItemDoc[]; f: DashFilter; setF: (f: DashFilter) => void }) {
  const kpiName = KPI_NAME(model);
  const base = live.filter((i) => matchDash(model, i, f, 'kpi'));
  const label = (id: string) => model.chipLabel.get(id) ?? id;
  const groupName = (id: string) => model.tags.find((g) => g.id === id)?.name ?? id;
  const kpis: Kpi[] = ['problem', 'essential', 'tbd', 'nice', 'unchecked'];
  return (
    <div className="st-lc-fchips" role="group" aria-label="Filtern">
      <b>Filtern:</b>
      {kpis.map((k) => {
        const n = base.filter((i) => kpiOk(model, i, chipsOf(model, i), k)).length;
        const on = f.kpi === k;
        return (
          <button key={k} type="button" className={`st-fchip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, kpi: on ? undefined : k })}>
            {kpiName[k]}
            <small>{n}</small>
          </button>
        );
      })}
      {REL_TILES.map(([r, l]) => {
        const relBase = live.filter((i) => matchDash(model, i, f, 'rel'));
        const n = relBase.filter((i) => relOk(model, chipsOf(model, i), r)).length;
        const on = f.rel === r;
        return (
          <button key={r} type="button" className={`st-fchip is-rel${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, rel: on ? undefined : r })}>
            {l}
            <small>{n}</small>
          </button>
        );
      })}
      {Object.entries(f.tags).map(([g, c]) => (
        <button key={g} type="button" className="st-fchip is-on" onClick={() => { const tags = { ...f.tags }; delete tags[g]; setF({ ...f, tags }); }} aria-label={`Filter ${groupName(g)}: ${label(c)} entfernen`}>
          {`${groupName(g)}: ${label(c)} ×`}
        </button>
      ))}
      {f.person && (
        <button type="button" className="st-fchip is-on" onClick={() => setF({ ...f, person: undefined })} aria-label={`Filter ${f.person} entfernen`}>
          {`${f.person} ×`}
        </button>
      )}
      {dashActive(f) && (
        <button type="button" className="st-linkbtn st-fchip-reset" onClick={() => setF(NO_DASH)}>
          Zurücksetzen
        </button>
      )}
    </div>
  );
}

export const REL_TILES: [Rel, string, (n: number) => string, string][] = [
  ['game', 'Nur Spiel', (n) => `von ${n} Aussagen`, 'Aussagen, die ausschließlich das allgemeine Spiel betreffen – anklicken zum Filtern'],
  ['craft', 'Crafting', () => 'Generator · Interface · Integration', 'Aussagen zu Generator/Interface und Crafting–Spiel-Integration – anklicken zum Filtern'],
  ['unclear', 'Ungeklärt', () => 'ohne bestätigte Relevanz', 'Aussagen ohne abschließend bestätigte Relevanzklassifizierung (noch offen oder „Unklar“) – anklicken zum Filtern'],
];
