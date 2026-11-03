// Qualitatives Feedback → Crafting UX, in two views:
//   Klassifizierung  every statement's Crafting-Bezug (Generator & Interface,
//                    Crafting–Spiel-Integration, Nur Spiel, Unklar): a review
//                    queue of the open ones, checked one by one in a drawer
//   UX-Analyse       the participants and the shared crafting problems side by
//                    side, linked by selection; each person's main problem is
//                    chosen in a drawer (a finding, a statement or a special case)
// Only confirmed tags count; AI suggestions are shown as such until taken over.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CraftingUxDoc, ItemDoc } from '../types';
import { SECTION_LABEL } from '../types';
import { artOf, candidatesOf, craftGroup, craftItems, cxProblemsOf, type CxProblem, distribution, mainOf, prioOf, relChip, relOf, REL_HINT, REL_LABEL, REL_SHORT, sharedIssues, SPECIAL_LABEL, suggestedRel, type Candidate, type CraftScope, type MainState, type Rel, type SharedIssue } from '../crafting';
import { designOfItem } from './Codes';
import { itemText, useContentView } from '../translations';
import { Empty, logChange, useCtx } from '../ui';

const TAB_KEY = 'asciia-study-cx-tab';
const readLocal = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const writeLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per viewer only */
  }
};
const PRIO_LABEL = ['', 'Nice-to-have', 'Offen', 'Essenziell'];
const RELS: Rel[] = ['core', 'integration', 'game', 'unclear', 'open'];

function Info({ text }: { text: string }) {
  return (
    <span className="st-cx-i" tabIndex={0} role="img" aria-label={text} title={text}>
      i
    </span>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="st-seg st-cx-seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className={v === value ? 'is-on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </span>
  );
}

// the right-side drawer (Esc and the scrim close it)
function Drawer({ title, sub, onClose, children, footer }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, []);
  return (
    <>
      <div className="st-cx-scrim" onClick={onClose} />
      <aside className="st-cx-drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="st-cx-dhead">
          <div>
            <h2>{title}</h2>
            {sub && <small>{sub}</small>}
          </div>
          <button type="button" className="st-cx-x" aria-label="Schließen" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="st-cx-dbody">{children}</div>
        <footer className="st-cx-dfoot">{footer}</footer>
      </aside>
    </>
  );
}

export default function CraftingUx() {
  const { model } = useCtx();
  const [tab, setTab] = useState<'class' | 'analysis'>(() => (readLocal(TAB_KEY, 'class') === 'analysis' ? 'analysis' : 'class'));
  const group = craftGroup(model);
  const { slice } = useCtx();
  const open = slice.items.filter((i) => relOf(model, i) === 'open').length;
  const pick = (t: 'class' | 'analysis') => {
    setTab(t);
    writeLocal(TAB_KEY, t);
  };
  if (!group)
    return (
      <Empty>
        Die Tag-Gruppe „Crafting-Bezug“ fehlt (gelöscht?). Unter „Tags“ eine Gruppe mit den Bedeutungen „Crafting-Bezug: Generator & Interface / Integration / Nur Spiel / Unklar“ anlegen.
      </Empty>
    );
  return (
    <div className="st-cx">
      <div className="st-cx-tabs" role="tablist" aria-label="Crafting UX">
        <button type="button" role="tab" aria-selected={tab === 'class'} className={tab === 'class' ? 'is-on' : ''} onClick={() => pick('class')}>
          Klassifizierung
          {open > 0 && <span className="st-cx-count">{open}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'analysis'} className={tab === 'analysis' ? 'is-on' : ''} onClick={() => pick('analysis')}>
          UX-Analyse
        </button>
      </div>
      {tab === 'class' ? <Classification /> : <Analysis />}
    </div>
  );
}

// ---- Klassifizierung ----
function DistBar({ dist, total }: { dist: Record<Rel, number>; total: number }) {
  return (
    <>
      <div className="st-cx-dist" role="img" aria-label={RELS.map((r) => `${dist[r]} ${REL_SHORT[r]}`).join(', ')}>
        {RELS.map((r) => (dist[r] ? <i key={r} className={`k-${r}`} style={{ width: `${(dist[r] / Math.max(1, total)) * 100}%` }} /> : null))}
      </div>
    </>
  );
}

function Classification() {
  const ctx = useCtx();
  const { study, model, slice } = ctx;
  const view = useContentView();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [byArt, setByArt] = useState(false);
  const [at, setAt] = useState<string | null>(null); // the statement in the drawer
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(40);
  const group = craftGroup(model)!;
  const items = slice.items;
  const dist = distribution(model, items);
  const persons = new Set(items.map((i) => i.person)).size;
  const list = filter === 'open' ? items.filter((i) => relOf(model, i) === 'open') : items;
  const withSug = items.filter((i) => relOf(model, i) === 'open' && suggestedRel(model, i));
  const noSug = items.filter((i) => relOf(model, i) === 'open' && !suggestedRel(model, i));
  const groupChips = new Set(group.chips.map((c) => c.id));

  // a Crafting-Bezug set (one per statement); the group's suggestions go
  const assign = (ids: string[], rel: (i: ItemDoc) => Exclude<Rel, 'open'> | null) => {
    const put = [];
    for (const id of ids) {
      const cur = study.latest().items[id];
      const r = cur && rel(cur);
      const chip = r && relChip(model, r);
      if (!cur || !chip) continue;
      put.push({ coll: 'items' as const, id, data: { ...cur, chips: [...cur.chips.filter((c) => !groupChips.has(c)), chip], suggested: cur.suggested.filter((c) => !groupChips.has(c)) } });
    }
    if (put.length) study.commit(put);
    return put.length;
  };
  const takeAll = async () => {
    if (!confirm(`${withSug.length} KI-Vorschläge für den Crafting-Bezug übernehmen? Vorher wird eine Version gespeichert.`)) return;
    setBusy('Version wird gespeichert …');
    try {
      await study.saveVersion(`vor dem Übernehmen von ${withSug.length} Crafting-Bezug-Vorschlägen`);
      const n = assign(
        withSug.map((i) => i.id),
        (i) => suggestedRel(model, i),
      );
      logChange(study, `Crafting-Bezug: ${n} KI-Vorschläge übernommen`);
    } catch (e) {
      alert(`Nicht übernommen: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  // AI suggestions for the open statements without one (stored as suggestions, not counted)
  const askAi = async () => {
    const todo = noSug;
    const groups = [{ id: group.id, name: group.name, hint: group.hint, multi: false, chips: group.chips.map((c) => ({ id: c.id, label: c.label, bedeutung: c.role ? REL_HINT[(Object.entries({ 'cx-core': 'core', 'cx-integration': 'integration', 'cx-game': 'game', 'cx-unclear': 'unclear' }) as [string, Exclude<Rel, 'open'>][]).find(([r]) => r === c.role)?.[1] ?? 'unclear'] : undefined })) }];
    try {
      for (let k = 0; k < todo.length; k += 10) {
        setBusy(`KI ordnet ein … ${k}/${todo.length}`);
        const batch = todo.slice(k, k + 10);
        const answer = (await study.suggest({ items: batch.map((x) => ({ id: x.id, text: x.de || x.text, section: SECTION_LABEL[x.section], question: x.question })), groups, findings: [] })) as { id?: string; chips?: Record<string, string[]> }[];
        const put = [];
        for (const s of answer) {
          const cur = s.id ? study.latest().items[s.id] : undefined;
          const chip = (s.chips?.[group.id] ?? []).find((c) => groupChips.has(c));
          if (!cur || !chip || cur.chips.some((c) => groupChips.has(c))) continue;
          put.push({ coll: 'items' as const, id: cur.id, data: { ...cur, suggested: [...cur.suggested.filter((c) => !groupChips.has(c)), chip] } });
        }
        if (put.length) study.commit(put);
      }
    } catch (e) {
      alert(`KI-Vorschläge nicht möglich: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const ids = list.map((i) => i.id);
  const cur = at ? items.find((i) => i.id === at) ?? null : null;
  const step = (d: number) => {
    const k = ids.indexOf(at ?? '');
    const next = ids[k + d];
    if (next) setAt(next);
  };
  const arts = model.tags.find((g) => g.id === 'art')?.chips ?? [];

  return (
    <>
      <section className="st-cx-card" aria-label="Crafting-Bezug">
        <h3>
          Crafting-Bezug
          <small>
            {`${items.length} Aussagen · ${persons} ${persons === 1 ? 'Person' : 'Personen'}`}
            <Info text="Ohne bestätigten Tag gilt eine Aussage als offen – nie als „Nur Spiel“. KI-Vorschläge zählen erst nach dem Übernehmen." />
          </small>
        </h3>
        <DistBar dist={dist} total={items.length} />
        <div className="st-cx-distlab">
          {RELS.filter((r) => r !== 'unclear' || dist.unclear).map((r) => (
            <span key={r}>
              <b className={`k-${r}`} />
              <strong>{dist[r]}</strong>
              {REL_SHORT[r]}
            </span>
          ))}
          <button type="button" className="st-linkbtn st-cx-right" aria-expanded={byArt} onClick={() => setByArt(!byArt)}>
            {byArt ? 'Aufschlüsselung ausblenden' : 'Aufschlüsselung nach Art'}
          </button>
        </div>
        {byArt && (
          <div className="st-cx-byart">
            {arts.map((a) => {
              const its = items.filter((i) => i.chips.includes(a.id));
              const d = distribution(model, its);
              const max = Math.max(1, ...arts.map((x) => items.filter((i) => i.chips.includes(x.id)).length));
              return (
                <div key={a.id} className="st-cx-artrow">
                  <span>{a.label}</span>
                  <span className="st-cx-dist is-row" style={{ width: `${(its.length / max) * 100}%` }}>
                    {RELS.map((r) => (d[r] ? <i key={r} className={`k-${r}`} style={{ width: `${(d[r] / its.length) * 100}%` }} title={`${d[r]} ${REL_SHORT[r]}`} /> : null))}
                  </span>
                  <span className="st-cx-n">{its.length}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="st-cx-card" aria-label="Zu prüfen">
        <h3>
          Zu prüfen
          <Seg
            value={filter}
            label="Aussagen"
            options={[
              ['open', `Offen ${dist.open}`],
              ['all', `Alle ${items.length}`],
            ]}
            onChange={(v) => (setFilter(v), setMore(40))}
          />
        </h3>
        {busy && <p className="st-cx-note" role="status">{busy}</p>}
        {list.length ? (
          <ul className="st-cx-q">
            {list.slice(0, more).map((i) => {
              const rel = relOf(model, i);
              const sug = suggestedRel(model, i);
              return (
                <li key={i.id} className={i.id === at ? 'is-sel' : ''}>
                  <span className="st-cx-pid">{i.person}</span>
                  <span className="st-cx-text">{itemText(view, i)}</span>
                  <span className="st-cx-sug">
                    {rel !== 'open' ? (
                      <>
                        <b className={`k-${rel}`} />
                        {REL_SHORT[rel]}
                      </>
                    ) : sug ? (
                      <>
                        <b className={`k-${sug}`} />
                        {`Vorschlag: ${REL_SHORT[sug]}`}
                      </>
                    ) : (
                      'kein Vorschlag'
                    )}
                  </span>
                  <button type="button" className="st-cx-btn" onClick={() => setAt(i.id)}>
                    {rel === 'open' ? 'Prüfen' : 'Ändern'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="st-cx-note">{filter === 'open' ? 'Alle Aussagen sind eingeordnet.' : 'Keine Aussagen.'}</p>
        )}
        {list.length > more && (
          <button type="button" className="st-linkbtn" onClick={() => setMore(more + 40)}>
            {`${list.length - more} weitere anzeigen`}
          </button>
        )}
        <div className="st-cx-qfoot">
          <span className="st-cx-note">Vorschläge zählen erst nach dem Übernehmen.</span>
          <span className="st-cx-actions">
            {noSug.length > 0 && (
              <button type="button" className="st-cx-btn" disabled={!!busy} onClick={() => void askAi()}>
                {`KI: vorschlagen (${noSug.length})`}
              </button>
            )}
            {withSug.length > 0 && (
              <button type="button" className="st-cx-btn" disabled={!!busy} onClick={() => void takeAll()}>
                {`${withSug.length} Vorschläge übernehmen`}
              </button>
            )}
          </span>
        </div>
      </section>

      {cur && <ReviewDrawer key={cur.id} item={cur} pos={ids.indexOf(cur.id)} count={ids.length} onClose={() => setAt(null)} onStep={step} onAssign={(r) => (assign([cur.id], () => r), filter === 'open' && ids[ids.indexOf(cur.id) + 1] ? setAt(ids[ids.indexOf(cur.id) + 1]) : filter === 'open' ? setAt(null) : undefined)} />}
    </>
  );
}

function ReviewDrawer({ item, pos, count, onClose, onStep, onAssign }: { item: ItemDoc; pos: number; count: number; onClose: () => void; onStep: (d: number) => void; onAssign: (r: Exclude<Rel, 'open'>) => void }) {
  const { model } = useCtx();
  const view = useContentView();
  const rel = relOf(model, item);
  const sug = suggestedRel(model, item);
  const [pick, setPick] = useState<Exclude<Rel, 'open'> | null>(rel !== 'open' ? rel : sug);
  const tags = item.chips.filter((c) => !craftGroup(model)!.chips.some((x) => x.id === c)).map((c) => model.chipLabel.get(c)).filter(Boolean);
  return (
    <Drawer
      title="Crafting-Bezug prüfen"
      sub={`${pos >= 0 ? `${pos + 1} von ${count} · ` : ''}${item.person} · ${SECTION_LABEL[item.section]}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="st-cx-btn" aria-label="Vorherige" disabled={pos <= 0} onClick={() => onStep(-1)}>
            ‹
          </button>
          <button type="button" className="st-cx-btn" aria-label="Nächste" disabled={pos < 0 || pos >= count - 1} onClick={() => onStep(1)}>
            ›
          </button>
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={() => (pos < count - 1 ? onStep(1) : onClose())}>
            Überspringen
          </button>
          <button type="button" className="st-cx-btn is-pri" disabled={!pick || pick === rel} onClick={() => pick && onAssign(pick)}>
            Übernehmen
          </button>
        </>
      }
    >
      <div className="st-cx-stmt">
        <small>{item.question ? `Frage: ${item.question}` : 'Aussage'}</small>
        {itemText(view, item)}
      </div>
      {tags.length > 0 && (
        <div className="st-cx-tags">
          {tags.map((t) => (
            <span key={t} className="st-cx-tag">
              {t}
            </span>
          ))}
        </div>
      )}
      <div role="radiogroup" aria-label="Crafting-Bezug">
        <span className="st-cx-lab">Crafting-Bezug</span>
        <div className="st-cx-opts">
          {(['core', 'integration', 'game', 'unclear'] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={pick === r} className={`st-cx-opt${pick === r ? ' is-on' : ''}`} onClick={() => setPick(r)}>
              <span className={`st-cx-r${pick === r ? ' is-on' : ''}`} aria-hidden="true" />
              <span>
                {REL_LABEL[r]}
                <small>{REL_HINT[r]}</small>
              </span>
              {sug === r && rel === 'open' && <span className="st-cx-ai">KI-Vorschlag</span>}
              {rel === r && <span className="st-cx-ai is-set">gespeichert</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="st-cx-note">Eine zusammengesetzte Aussage (Crafting- und Spiel-Problem) besser auf der Seite „Aussagen“ in zwei Aussagen teilen, dann einzeln einordnen.</p>
    </Drawer>
  );
}

// ---- UX-Analyse ----
// the problem groups, stored as one settings document (with the dashboard's versions)
function useGroups() {
  const { study } = useCtx();
  const groups = cxProblemsOf(study.docs.settings);
  const save = (list: CxProblem[], what: string) => {
    study.commit([{ coll: 'settings', id: 'craftingProblems', data: { list } }]);
    logChange(study, `Crafting UX: ${what}`);
  };
  const latest = () => cxProblemsOf(study.latest().settings);
  return { groups, save, latest };
}

function Analysis() {
  const ctx = useCtx();
  const { study, model, slice } = ctx;
  const view = useContentView();
  const { groups, save, latest } = useGroups();
  const [scope, setScope] = useState<CraftScope>('extended');
  const [variant, setVariant] = useState<'all' | 'A' | 'B'>('all');
  const [person, setPerson] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [mobile, setMobile] = useState<'people' | 'issues'>('people');
  const [editing, setEditing] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null); // a new group's name
  const [clusterOpen, setClusterOpen] = useState(false);
  const inView = useMemo(() => craftItems(model, slice.items, scope, variant), [model, slice.items, scope, variant]);
  const issues = useMemo(() => sharedIssues(model, inView, groups), [model, inView, groups]);
  const withItems = new Set(inView.map((i) => i.person)).size;
  // a person's main problem is decided over all their crafting statements (not the filter)
  const allCrafting = useMemo(() => craftItems(model, slice.items, 'extended'), [model, slice.items]);
  const people = slice.persons.map((p) => {
    const cands = candidatesOf(model, p.id, allCrafting, groups);
    return { p, cands, main: mainOf(p, cands, groups, study.docs.items) };
  });
  const sel = issue ? issues.find((x) => x.problem.id === issue) ?? null : null;
  const personIssues = person ? new Set(issues.filter((x) => x.persons.includes(person)).map((x) => x.problem.id)) : null;
  const mainOfPerson = person ? people.find((x) => x.p.id === person)?.main : null;
  const mainsBy = (gid: string) => people.filter((x) => x.main.status === 'confirmed' && x.main.key === `p:${gid}`).map((x) => x.p.id);
  const counts = { confirmed: people.filter((x) => x.main.status === 'confirmed').length, suggested: people.filter((x) => x.main.status === 'suggested').length };
  const editP = editing ? people.find((x) => x.p.id === editing) : null;
  const ungrouped = inView.filter((i) => !groups.some((g) => g.items.includes(i.id)));
  const create = (name: string, items: string[] = []) => {
    const g: CxProblem = { id: `cx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: name.trim(), items };
    save([...latest(), g], `Problem „${g.name}“ angelegt`);
    return g;
  };

  return (
    <>
      <div className="st-cx-top">
        <Seg value={scope} label="Crafting-Bezug" options={[['core', 'Kern'], ['extended', 'Kern + Integration']]} onChange={setScope} />
        <Seg value={variant} label="Variante" options={[['all', 'Alle Varianten'], ['A', 'A'], ['B', 'B']]} onChange={setVariant} />
        <span className="st-cx-mobile">
          <Seg value={mobile} label="Ansicht" options={[['people', 'Personen'], ['issues', 'Probleme']]} onChange={setMobile} />
        </span>
      </div>
      <div className={`st-cx-split is-${mobile}`}>
        <section className="st-cx-card st-cx-people" aria-label="Teilnehmende">
          <h3>
            Teilnehmende
            <small>
              {person || issue ? (
                <button type="button" className="st-linkbtn" onClick={() => (setPerson(null), setIssue(null))}>
                  Auswahl aufheben
                </button>
              ) : (
                <>
                  {`${counts.confirmed} bestätigt · ${counts.suggested} Vorschläge`}
                  <Info text="Hauptproblem je Person: eine eigene Einschätzung nach Auswirkung auf die Aufgabe, Beleg (beobachtet / ausdrücklich berichtet), Wiederholung und Forschungsbezug – nicht einfach die meisten Aussagen oder die höchste Priorität." />
                </>
              )}
            </small>
          </h3>
          <ul className="st-cx-pl">
            {people.map(({ p, main }) => {
              const cls = person === p.id ? 'is-sel' : sel ? (sel.persons.includes(p.id) ? 'is-hl' : 'is-dim') : '';
              return (
                <li key={p.id} className={cls}>
                  <button type="button" className="st-cx-prow" aria-pressed={person === p.id} onClick={() => (setIssue(null), setPerson(person === p.id ? null : p.id))}>
                    <span className="st-cx-pid">{p.id}</span>
                    <span className={`st-cx-t${main.status === 'confirmed' || main.status === 'suggested' ? '' : ' is-none'}${main.doc?.special ? ' is-none' : ''}`}>{main.label}</span>
                    <span className={`st-cx-dot is-${main.status}`} title={{ confirmed: 'bestätigt', suggested: 'Vorschlag – prüfen', open: 'offen', invalid: 'Beleg fehlt – prüfen' }[main.status]} />
                  </button>
                  <button type="button" className="st-cx-edit" aria-label={`Hauptproblem von ${p.id} festlegen`} title="Hauptproblem festlegen" onClick={() => setEditing(p.id)}>
                    ✎
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="st-cx-legend">
            <span>
              <span className="st-cx-dot is-confirmed" />
              bestätigt
            </span>
            <span>
              <span className="st-cx-dot is-suggested" />
              Vorschlag
            </span>
            <span>
              <span className="st-cx-dot is-invalid" />
              Beleg fehlt
            </span>
          </div>
        </section>

        <section className="st-cx-card st-cx-issues" aria-label="Gemeinsame Probleme">
          <h3>
            <span>
              Gemeinsame Probleme
              <Info text="Eigene Problem-Gruppen nur für Crafting UX, unabhängig von den Wiederkehrenden Befunden. Gezählt werden verschiedene Personen (eine Person mit fünf Aussagen = 1)." />
            </span>
            <small>{person ? `bei ${person} hervorgehoben` : sel ? 'Betroffene links hervorgehoben' : `n = ${withItems} ${withItems === 1 ? 'Person' : 'Personen'} mit Crafting-Aussagen`}</small>
          </h3>
          <div className="st-cx-gtools">
            {naming == null ? (
              <button type="button" className="st-cx-btn" onClick={() => setNaming('')}>
                + Problem anlegen
              </button>
            ) : (
              <span className="st-cx-newg">
                <input
                  autoFocus
                  value={naming}
                  maxLength={120}
                  placeholder="Name, z. B. Pre-Clarification-Optionen unklar"
                  aria-label="Name des neuen Problems"
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && naming.trim()) (setIssue(create(naming).id), setNaming(null));
                    if (e.key === 'Escape') (e.stopPropagation(), setNaming(null));
                  }}
                />
                <button type="button" className="st-cx-btn is-pri" disabled={!naming.trim()} onClick={() => (setIssue(create(naming).id), setNaming(null))}>
                  Anlegen
                </button>
                <button type="button" className="st-linkbtn" onClick={() => setNaming(null)}>
                  Abbrechen
                </button>
              </span>
            )}
            {naming == null && inView.length >= 2 && (
              <button type="button" className="st-cx-btn" onClick={() => setClusterOpen(true)}>
                KI: ähnliche Aussagen bündeln …
              </button>
            )}
          </div>
          {issues.length ? (
            <ul className="st-cx-il">
              {issues.map((x) => {
                const id = x.problem.id;
                const cls = person ? (personIssues!.has(id) ? 'is-hl' : 'is-dim') : sel ? (id === issue ? 'is-hl' : 'is-dim') : '';
                const isMain = person && mainOfPerson?.status === 'confirmed' && mainOfPerson.key === `p:${id}`;
                return (
                  <li key={id} className={cls}>
                    <IssueRow x={x} total={withItems} open={issue === id} isMain={!!isMain} onToggle={() => (setPerson(null), setIssue(issue === id ? null : id))} />
                    {issue === id && <IssueDetail x={x} mains={mainsBy(id)} inView={inView} view={view} />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="st-cx-note">{inView.length ? 'Noch keine gemeinsamen Probleme. „+ Problem anlegen“ oder die KI ähnliche Aussagen bündeln lassen.' : 'Noch keine Aussagen mit diesem Crafting-Bezug.'}</p>
          )}
          <div className="st-cx-legend">
            <span>
              <b className="a-a" />
              nur Variante A
            </span>
            <span>
              <b className="a-b" />
              nur Variante B
            </span>
            <span>
              <b className="a-both" />
              beide
            </span>
            <span>
              <b className="a-none" />
              ohne Variante
            </span>
          </div>
          <NoGroup items={ungrouped} total={inView.length} person={person} view={view} onCreate={create} />
        </section>
      </div>
      {editP && <MainDrawer key={editP.p.id} person={editP.p.id} doc={editP.p.doc} cands={editP.cands} main={editP.main} group={editP.p.group} onClose={() => setEditing(null)} />}
      {clusterOpen && <ClusterDrawer items={inView} onClose={() => setClusterOpen(false)} />}
    </>
  );
}

function IssueRow({ x, total, open, isMain, onToggle }: { x: SharedIssue; total: number; open: boolean; isMain: boolean; onToggle: () => void }) {
  const n = x.persons.length;
  const w = (k: number) => `${(k / Math.max(1, total)) * 100}%`;
  return (
    <button type="button" className="st-cx-ir" aria-expanded={open} onClick={onToggle}>
      <span className="st-cx-iname">
        {x.problem.name}
        {isMain && <span className="st-cx-star">★ Hauptproblem</span>}
        {n === 1 && <span className="st-cx-single">Einzelbefund</span>}
        {n === 0 && <span className="st-cx-single">leer</span>}
      </span>
      <span className="st-cx-ab" role="img" aria-label={`A ${x.a}, B ${x.b}, beide ${x.both}, ohne Variante ${x.none}`}>
        {x.a > 0 && <i className="a-a" style={{ width: w(x.a) }} />}
        {x.b > 0 && <i className="a-b" style={{ width: w(x.b) }} />}
        {x.both > 0 && <i className="a-both" style={{ width: w(x.both) }} />}
        {x.none > 0 && <i className="a-none" style={{ width: w(x.none) }} />}
      </span>
      <span className="st-cx-n">{`${n}/${total}`}</span>
      <span className="st-cx-chev" aria-hidden="true">
        {open ? '▾' : '▸'}
      </span>
    </button>
  );
}

// an open problem: its name and description, every statement (taken out with
// ×), statements added by search, the group deleted
function IssueDetail({ x, mains, inView, view }: { x: SharedIssue; mains: string[]; inView: ItemDoc[]; view: ReturnType<typeof useContentView> }) {
  const { model } = useCtx();
  const { save, latest } = useGroups();
  const [q, setQ] = useState('');
  const g = x.problem;
  const patch = (p: Partial<CxProblem>, what: string) => save(latest().map((y) => (y.id === g.id ? { ...y, ...p } : y)), what);
  const codes = [...new Set(x.items.flatMap((i) => i.chips).filter((c) => model.tags.find((t) => t.id === 'code')?.chips.some((k) => k.id === c)))].map((c) => model.chipLabel.get(c));
  const designs = [...new Set(x.items.map(designOfItem))];
  // (every word of the search somewhere in the person, the text or its German version)
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = q.trim().length >= 2 ? inView.filter((i) => !g.items.includes(i.id) && words.every((w) => `${i.person} ${i.text} ${i.de ?? ''}`.toLowerCase().includes(w))).slice(0, 8) : [];
  const hidden = g.items.length - x.items.length; // in the group, but outside the current view
  return (
    <div className="st-cx-ix">
      <input className="st-cx-gname" defaultValue={g.name} aria-label="Name des Problems" maxLength={120} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== g.name && patch({ name: e.target.value.trim() }, `Problem umbenannt: „${e.target.value.trim()}“`)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <textarea className="st-cx-gdesc" rows={2} defaultValue={g.description ?? ''} placeholder="Beschreibung (optional): das gemeinsame Muster, neutral formuliert" aria-label="Beschreibung des Problems" onBlur={(e) => e.target.value !== (g.description ?? '') && patch({ description: e.target.value.trim() || undefined }, `Beschreibung von „${g.name}“ geändert`)} />
      {x.items.length > 0 && (
        <div className="st-cx-tags">
          {x.rels.map((r) => (
            <span key={r} className="st-cx-tag">
              {REL_SHORT[r]}
            </span>
          ))}
          {codes.map((c) => (
            <span key={c} className="st-cx-tag">
              {c}
            </span>
          ))}
          <span className="st-cx-tag">{designs.includes('A') && designs.includes('B') ? 'A und B' : designs.includes('A') ? 'nur Variante A' : designs.includes('B') ? 'nur Variante B' : 'Variante nicht zugeordnet'}</span>
        </div>
      )}
      <span className="st-cx-note">{`${x.items.length} ${x.items.length === 1 ? 'Aussage' : 'Aussagen'}${x.persons.length ? ` · ${x.persons.join(', ')}` : ''}${mains.length ? ` · Hauptproblem bei ${mains.join(', ')}` : ''}${x.persons.length === 1 ? ' · nur eine Person: nicht wiederkehrend' : ''}${hidden > 0 ? ` · ${hidden} weitere außerhalb der Auswahl` : ''}`}</span>
      <Quotes items={x.items} view={view} onRemove={(i) => patch({ items: g.items.filter((id) => id !== i.id) }, `Aussage aus „${g.name}“ genommen`)} />
      <label className="st-cx-add">
        <span className="st-cx-lab">Aussage zuordnen</span>
        <input type="search" value={q} placeholder="Suchen: P-ID oder Wort …" onChange={(e) => setQ(e.target.value)} />
      </label>
      {hits.length > 0 && (
        <ul className="st-cx-hits">
          {hits.map((i) => (
            <li key={i.id}>
              <span>
                <small>{[i.person, artOf(model, i), REL_SHORT[relOf(model, i)]].filter(Boolean).join(' · ')}</small>
                {itemText(view, i)}
              </span>
              <button type="button" className="st-cx-btn" onClick={() => (patch({ items: [...g.items, i.id] }, `Aussage zu „${g.name}“`), setQ(''))}>
                Zuordnen
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !hits.length && <span className="st-cx-note">Keine passende Crafting-Aussage (außerhalb der Auswahl oder schon zugeordnet).</span>}
      <button
        type="button"
        className="st-linkbtn st-cx-del"
        onClick={() => confirm(`Problem „${g.name}“ löschen? Die Aussagen bleiben erhalten; ein darauf gesetztes Hauptproblem muss neu gewählt werden.`) && save(latest().filter((y) => y.id !== g.id), `Problem „${g.name}“ gelöscht`)}
      >
        Problem löschen
      </button>
    </div>
  );
}

// every statement, with its person, Art and Crafting-Bezug (optionally taken out)
function Quotes({ items, view, person, onRemove, action }: { items: ItemDoc[]; view: ReturnType<typeof useContentView>; person?: string | null; onRemove?: (i: ItemDoc) => void; action?: (i: ItemDoc) => ReactNode }) {
  const { model } = useCtx();
  return (
    <ul className="st-cx-quotes">
      {items.map((i) => (
        <li key={i.id} className={`st-cx-quote${person && i.person !== person ? ' is-dim' : ''}`}>
          <span>
            <small>{[i.person, artOf(model, i), REL_SHORT[relOf(model, i)], designOfItem(i) ? `Variante ${designOfItem(i)}` : ''].filter(Boolean).join(' · ')}</small>
            {itemText(view, i)}
          </span>
          {action?.(i)}
          {onRemove && (
            <button type="button" className="st-cx-x is-small" aria-label={`${i.person}: Aussage herausnehmen`} title="Aus dem Problem nehmen" onClick={() => onRemove(i)}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// the crafting statements in no problem group, each assignable to one
function NoGroup({ items, total, person, view, onCreate }: { items: ItemDoc[]; total: number; person: string | null; view: ReturnType<typeof useContentView>; onCreate: (name: string, items?: string[]) => CxProblem }) {
  const { groups, save, latest } = useGroups();
  const [open, setOpen] = useState(false);
  const own = person ? items.filter((i) => i.person === person).length : 0;
  const assign = (i: ItemDoc, v: string) => {
    if (v === '__new') {
      const name = prompt('Name des neuen Problems:');
      if (name?.trim()) onCreate(name, [i.id]);
      return;
    }
    const g = latest().find((x) => x.id === v);
    if (g) save(latest().map((x) => (x.id === v ? { ...x, items: [...x.items, i.id] } : x)), `Aussage zu „${g.name}“`);
  };
  return (
    <div className="st-cx-nof">
      <button type="button" className="st-cx-ir is-plain" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="st-cx-iname">
          Ohne Problem-Gruppe
          {person && own > 0 && <span className="st-cx-star">{`${own} von ${person}`}</span>}
        </span>
        <span className="st-cx-note">{`${items.length} von ${total} Crafting-Aussagen`}</span>
        <span />
        <span className="st-cx-chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="st-cx-ix">
          {items.length ? (
            <Quotes
              items={items}
              view={view}
              person={person}
              action={(i) => (
                <select className="st-cx-assign" value="" aria-label={`${i.person}: einem Problem zuordnen`} onChange={(e) => e.target.value && assign(i, e.target.value)}>
                  <option value="">Zuordnen …</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                  <option value="__new">+ Neues Problem …</option>
                </select>
              )}
            />
          ) : (
            <span className="st-cx-note">Alle Crafting-Aussagen gehören zu einem gemeinsamen Problem.</span>
          )}
        </div>
      )}
    </div>
  );
}

// AI: similar crafting statements bundled into problems; checked here first,
// a version saved before anything is stored
function ClusterDrawer({ items, onClose }: { items: ItemDoc[]; onClose: () => void }) {
  const { study } = useCtx();
  const { groups, save, latest } = useGroups();
  const view = useContentView();
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<{ take: boolean; name: string; description: string; ids: string[]; target: string | null }[]>([]);
  const byId = new Map(items.map((i) => [i.id, i]));
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await study.cluster({ items: items.map((i) => ({ id: i.id, person: i.person, text: i.de || i.text, section: SECTION_LABEL[i.section], question: i.question })), findings: groups.map((g) => ({ id: g.id, name: g.name, description: g.description })) });
        if (live) setRows(res.filter((r) => r.ids.length).map((r) => ({ take: true, name: r.name, description: r.description, ids: r.ids.filter((id) => byId.has(id)), target: r.finding && groups.some((g) => g.id === r.finding) ? r.finding : null })));
      } catch (e) {
        if (live) setErr(String((e as Error).message));
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const taken = rows.filter((r) => r.take && r.ids.length);
  const apply = async () => {
    setBusy(true);
    try {
      await study.saveVersion(`vor dem Übernehmen von ${taken.length} KI-Problemgruppen (Crafting UX)`);
      let list = latest();
      for (const r of taken) {
        if (r.target && list.some((g) => g.id === r.target)) list = list.map((g) => (g.id === r.target ? { ...g, items: [...new Set([...g.items, ...r.ids])] } : g));
        else list = [...list, { id: `cx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: r.name.trim() || 'Ohne Namen', description: r.description || undefined, items: r.ids, auto: true }];
      }
      save(list, `${taken.length} KI-Problemgruppen übernommen`);
      onClose();
    } catch (e) {
      setErr(String((e as Error).message));
      setBusy(false);
    }
  };
  return (
    <Drawer
      title="KI: ähnliche Aussagen bündeln"
      sub={`${items.length} Crafting-Aussagen · nur Vorschläge, nichts wird ohne „Übernehmen“ gespeichert`}
      onClose={onClose}
      footer={
        <>
          <span className="st-cx-note">{`${taken.length} von ${rows.length} gewählt`}</span>
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="st-cx-btn is-pri" disabled={busy || !taken.length} onClick={() => void apply()}>
            Übernehmen
          </button>
        </>
      }
    >
      {busy && !rows.length && <p className="st-cx-note" role="status">KI bündelt …</p>}
      {err && <p className="st-cx-note" role="alert">{`Nicht möglich: ${err}`}</p>}
      {!busy && !err && !rows.length && <p className="st-cx-note">Keine Gruppen gefunden.</p>}
      {rows.map((r, k) => (
        <div key={k} className={`st-cx-prop${r.take ? '' : ' is-off'}`}>
          <label className="st-cx-propHead">
            <input type="checkbox" checked={r.take} onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, take: e.target.checked } : x)))} />
            {r.target ? (
              <strong>{`→ zu „${groups.find((g) => g.id === r.target)?.name}“`}</strong>
            ) : (
              <input value={r.name} aria-label="Name des Problems" onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} />
            )}
          </label>
          <span className="st-cx-note">{`${r.ids.length} Aussagen · ${[...new Set(r.ids.map((id) => byId.get(id)?.person))].length} Personen${r.description ? ` · ${r.description}` : ''}`}</span>
          <Quotes items={r.ids.map((id) => byId.get(id)!).filter(Boolean)} view={view} onRemove={(i) => setRows(rows.map((x, j) => (j === k ? { ...x, ids: x.ids.filter((id) => id !== i.id) } : x)))} />
        </div>
      ))}
    </Drawer>
  );
}

function MainDrawer({ person, doc, cands, main, group, onClose }: { person: string; doc: import('../types').PersonDoc; cands: Candidate[]; main: MainState; group: 'AB' | 'BA' | null; onClose: () => void }) {
  const { study, model } = useCtx();
  const view = useContentView();
  const stored = doc.craftingUx ?? null;
  const [key, setKey] = useState<string | null>(stored?.special ? null : main.key);
  const [special, setSpecial] = useState<CraftingUxDoc['special']>(stored?.special ?? null);
  const [reason, setReason] = useState(stored?.reason ?? '');
  const chosen = cands.find((c) => c.key === key) ?? null;
  const save = (data: CraftingUxDoc | null) => {
    const { craftingUx: _old, ...rest } = doc;
    study.commit([{ coll: 'people', id: person, data: { ...rest, id: person, ...(data ? { craftingUx: data } : {}) } }]);
    logChange(study, `Crafting UX: Hauptproblem von ${person} ${data ? (data.special ? `= ${SPECIAL_LABEL[data.special]}` : 'festgelegt') : 'zurückgesetzt'}`);
    onClose();
  };
  const confirm = () => {
    if (special) save({ special, reason: reason.trim() || undefined, at: Date.now() });
    else if (chosen) save({ problem: chosen.problem?.id ?? null, item: chosen.problem ? null : chosen.item!.id, reason: reason.trim() || undefined, at: Date.now() });
  };
  const evidence = special ? [] : chosen?.items ?? [];
  return (
    <Drawer
      title={`${person} · Hauptproblem`}
      sub={`${cands.length} ${cands.length === 1 ? 'Kandidat' : 'Kandidaten'}${group ? ` · Reihenfolge ${group}` : ''}${main.status === 'invalid' ? ' · gespeicherter Beleg fehlt' : ''}`}
      onClose={onClose}
      footer={
        <>
          {stored && (
            <button type="button" className="st-linkbtn" onClick={() => save(null)}>
              Zurücksetzen
            </button>
          )}
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="st-cx-btn is-pri" disabled={!special && !chosen} onClick={confirm}>
            Bestätigen
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Hauptproblem">
        <span className="st-cx-lab">
          Hauptproblem
          <Info text="Kriterien: Auswirkung auf die Aufgabe · beobachtet oder ausdrücklich berichtet · wiederholt · Forschungsbezug (Kontrolle, Erwartung, Umgang mit dem KI-Ergebnis)." />
        </span>
        {cands.length ? (
          <div className="st-cx-opts">
            {cands.map((c) => {
              const on = !special && key === c.key;
              const sections = [...new Set(c.items.map((i) => SECTION_LABEL[i.section]))].join(' / ');
              return (
                <button key={c.key} type="button" role="radio" aria-checked={on} className={`st-cx-opt${on ? ' is-on' : ''}`} onClick={() => (setKey(c.key), setSpecial(null))}>
                  <span className={`st-cx-r${on ? ' is-on' : ''}`} aria-hidden="true" />
                  <span>
                    {c.problem ? c.problem.name : itemText(view, c.item!)}
                    <small>{[c.problem ? `Problem · ${c.items.length} eigene ${c.items.length === 1 ? 'Aussage' : 'Aussagen'}` : 'Aussage ohne Problem-Gruppe', REL_SHORT[c.rel], [...new Set(c.items.map((i) => artOf(model, i)))].filter(Boolean).join(' / '), PRIO_LABEL[c.prio], sections].filter(Boolean).join(' · ')}</small>
                  </span>
                  {main.status === 'suggested' && main.key === c.key && !stored && <span className="st-cx-ai">Vorschlag</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="st-cx-note">Keine Aussagen dieser Person mit Crafting-Bezug Kern oder Integration.</p>
        )}
      </div>
      <label className="st-cx-field">
        <span className="st-cx-lab">Oder ein Sonderfall</span>
        <select value={special ?? ''} onChange={(e) => setSpecial((e.target.value || null) as CraftingUxDoc['special'])}>
          <option value="">–</option>
          {(Object.keys(SPECIAL_LABEL) as (keyof typeof SPECIAL_LABEL)[]).map((k) => (
            <option key={k} value={k}>
              {SPECIAL_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="st-cx-field">
        <span className="st-cx-lab">Begründung (optional)</span>
        <textarea rows={3} value={reason} placeholder="Warum dieses Problem am schwersten wog …" onChange={(e) => setReason(e.target.value)} />
      </label>
      {evidence.length > 0 && (
        <div>
          <span className="st-cx-lab">Belege</span>
          {evidence.map((i) => (
            <div key={i.id} className="st-cx-quote">
              <small>{`${SECTION_LABEL[i.section]}${prioOf(model, i) ? ` · ${PRIO_LABEL[prioOf(model, i)]}` : ''}${designOfItem(i) ? ` · Variante ${designOfItem(i)}` : ''}`}</small>
              {itemText(view, i)}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
