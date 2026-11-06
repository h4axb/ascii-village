// Qualitatives Feedback: a filter-first overview above the statements: what
// problems dominate and what to look into. Every tile and bar is a filter for the
// statements below; the same filters (and the active ones) sit in the Aussagen
// card as chips (DashFilterBar). Under the problem figures, the problems of
// every category (Thema …) can be shown.
import { useState } from 'react';
import type { ChipRole, ItemDoc, TagGroup } from './types';
import { effectiveChips, shortName, type Model } from './model';
import { craftGroup, relOf } from './crafting';
import { useAbSummary, type AbView } from './abCompare';

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

const TAB_KEY = 'asciia-study-dash-tab';
const OPEN_KEY = 'asciia-study-dash-filters';
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

export function NotesDashboard({ model, live, f, setF, abShow, onAb }: { model: Model; live: ItemDoc[]; f: DashFilter; setF: (f: DashFilter) => void; abShow: AbView; onAb: (v: AbView) => void }) {
  const artGroup = model.tags.find((g) => g.chips.some((c) => c.role === 'problem'));
  const prioGroup = model.tags.find((g) => g.chips.some((c) => c.role === 'essential'));
  const groups = model.tags.filter((g) => g !== artGroup && g !== prioGroup && g.chips.length);
  const [tab, setTab] = useState<DashTab>(() => (read(TAB_KEY) as DashTab) || 'probleme');
  // (the problems by category: hidden until shown)
  const [open, setOpen] = useState(() => read(OPEN_KEY) === '1');

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

  const kpiName = KPI_NAME(model);
  const ab = useAbSummary();
  const hasRel = !!craftGroup(model);
  const tabs = TABS.filter((t) => t.id !== 'klass' || hasRel);
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0];
  const pickTab = (t: DashTab) => {
    setTab(t);
    write(TAB_KEY, t);
  };
  const toggleOpen = () => {
    setOpen(!open);
    write(OPEN_KEY, open ? '0' : '1');
  };
  // the statements by Crafting-Bezug (a click filters: Kern and Integration together as Crafting)
  const relRows = (() => {
    const base = live.filter((i) => matchDash(model, i, f, 'rel'));
    const of = (r: string) => base.filter((i) => relOf(model, { chips: chipsOf(model, i) }) === r).length;
    return [
      { id: 'core', label: 'Generator & Interface', n: of('core'), rel: 'craft' as Rel },
      { id: 'integration', label: 'Crafting–Spiel-Integration', n: of('integration'), rel: 'craft' as Rel },
      { id: 'game', label: 'Nur Spiel', n: of('game'), rel: 'game' as Rel },
      { id: 'unclear', label: 'Unklar', n: of('unclear'), rel: 'unclear' as Rel },
      { id: 'open', label: 'Noch nicht eingeordnet', n: of('open'), rel: 'unclear' as Rel },
    ].sort((x, y) => y.n - x.n);
  })();
  const abTile = (v: AbView, label: string, n: number, sub: string, hint?: string) => (
    <button key={v} type="button" className={`st-dash-kpi${abShow === v ? ' is-on' : ''}`} aria-pressed={abShow === v} onClick={() => onAb(abShow === v ? null : v)} title={`${hint ? `${hint} · ` : ''}Anklicken: im Bereich A/B-Vergleich anzeigen`}>
      <span className="st-dash-kpilabel">{label}</span>
      <span className="st-dash-kpivalue">{n}</span>
      <span className="st-dash-kpisub">{sub}</span>
    </button>
  );
  return (
    <section className="st-dash2" aria-label="Dashboard" data-nav="Dashboard">
      <div className="st-dash2-tabs" role="tablist" aria-label="Auswertung">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === cur.id} aria-label={t.label} title={t.label} className={`st-dash2-tab${t.id === cur.id ? ' is-on' : ''}`} onClick={() => pickTab(t.id)}>
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            {t.id === cur.id && <span>{t.label}</span>}
          </button>
        ))}
      </div>
      <div className="st-dash2-card" role="tabpanel" aria-label={cur.label}>
        {cur.id === 'probleme' && (
          <>
            <div className="st-dash-kpis">
              {tile('problem', kpiName.problem, 'Aussagen mit der Art „Problem“ – anklicken zum Filtern')}
              {tile('essential', kpiName.essential, 'Probleme mit der Priorität „Essenziell“ – anklicken zum Filtern')}
              {tile('tbd', kpiName.tbd, 'Probleme, deren Priorität noch offen ist – anklicken zum Filtern')}
              {/* (the review progress, set apart from the three problem figures) */}
              {tile('unchecked', kpiName.unchecked, 'Noch nicht geprüfte Aussagen oder solche mit offenen KI-Vorschlägen – anklicken zum Filtern')}
            </div>
            {/* (under the figures: every category's problems, shown on demand) */}
            <button type="button" className="st-dash2-more" aria-expanded={open} onClick={toggleOpen}>
              {open ? 'Filter ausblenden' : 'Filter einblenden'}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
              </svg>
            </button>
            {open && (
              <>
                {groups.map((g) => {
                  const rows = byGroup(g, true);
                  return rows.length ? (
                    <div key={g.id} className="st-dash2-sec">
                      <h3>{`Probleme nach ${g.name}`}</h3>
                      <Bars rows={rows} on={f.tags[g.id]} onPick={(c) => setTag(g.id, c)} label={`Probleme nach ${g.name}`} />
                    </div>
                  ) : null;
                })}
                {artGroup && (
                  <div className="st-dash2-sec">
                    <h3>{`Aussagen nach ${artGroup.name}`}</h3>
                    <Bars rows={byGroup(artGroup, false)} on={f.tags[artGroup.id]} onPick={(c) => setTag(artGroup.id, c)} label={`Aussagen nach ${artGroup.name}`} />
                  </div>
                )}
              </>
            )}
          </>
        )}
        {cur.id === 'klass' && (
          <>
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
            <div className="st-dash2-sec">
              <h3>Aussagen nach Crafting-Bezug</h3>
              <Bars rows={relRows} on={relRows.find((r) => r.rel === f.rel)?.id} onPick={(id) => { const r = relRows.find((x) => x.id === id)!.rel; setF({ ...f, rel: f.rel === r ? undefined : r }); }} label="Aussagen nach Crafting-Bezug" />
            </div>
          </>
        )}
        {cur.id === 'ab' && (
          <>
            <div className="st-dash-kpis is-ab">
              {ab.combos.map((c) => {
                const on = abShow === c.k;
                const side = (x?: string) => (x === 'tie' ? 'Gleich' : (x ?? '–'));
                return (
                  <button key={c.k} type="button" className={`st-dash-kpi st-ab-combo${on ? ' is-on' : ''}`} aria-pressed={on} aria-describedby={`combo-${c.k}`} onClick={() => onAb(on ? null : c.k)}>
                    <span className="st-dash-kpilabel">{c.label}</span>
                    <span className="st-dash-kpivalue">{c.n}</span>
                    <span className="st-dash-kpisub">{`von ${ab.of} ${ab.of === 1 ? 'Person' : 'Personen'}`}</span>
                    {/* (the hover: who is in it, with their two results) */}
                    <span className="st-ab-combopop" role="tooltip" id={`combo-${c.k}`}>
                      <b>{c.label}</b>
                      <span className="st-ab-comborule">{c.hint}</span>
                      {c.people.length ? (
                        <span className="st-ab-combolist">
                          {c.people.map((x) => (
                            <span key={x.person} className="st-ab-comborow">
                              <span className="st-ab-combopid">{x.person}</span>
                              <span>{`Tally ${side(x.tally)}`}</span>
                              <span>{`In-Game ${side(x.game)}`}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="st-ab-comborule">Niemand.</span>
                      )}
                    </span>
                  </button>
                );
              })}
              {abTile('hyp', 'Hypothesen', ab.hyps, `${ab.selected} für Redesign`)}
              {abTile('red', 'Redesign', ab.decisions, ab.decisions === 1 ? 'Maßnahme' : 'Maßnahmen')}
            </div>
            <p className="st-muted st-dash2-note">
              {ab.results
                ? `Je Person: Tally-Ergebnis (öfter gewählte Variante) gegen In-Game-Ergebnis (mehr gewonnene Bewertungen).${ab.incomplete ? ` ${ab.incomplete} ${ab.incomplete === 1 ? 'Person hat' : 'Personen haben'} nur eines der beiden Ergebnisse und ${ab.incomplete === 1 ? 'zählt' : 'zählen'} nicht.` : ''} Anklicken zeigt sie im Bereich „A/B-Vergleich & Gestaltungsableitung“.`
                : 'Noch keine Tally-Vergleichsfragen (Teil 1) zugeordnet.'}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export type DashTab = 'probleme' | 'klass' | 'ab';
// the three tabs, each with an icon for its topic (no title in the card: the
// active tab names it): a warning sign for the problems, a magnifier with a
// check for the classification, two arrows for the A/B comparison
const TABS: { id: DashTab; label: string; icon: string }[] = [
  { id: 'probleme', label: 'Probleme', icon: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' },
  { id: 'klass', label: 'Klassifizierung', icon: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35M7.5 11l2.5 2.5 4.5-4.5' },
  { id: 'ab', label: 'A/B-Vergleich', icon: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16' },
];

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
