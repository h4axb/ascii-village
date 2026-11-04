// Qualitatives Feedback → Crafting UX, in two views:
//   Klassifizierung  every statement's Crafting-Bezug (Generator & Interface,
//                    Crafting–Spiel-Integration, Nur Spiel, Unklar): a review
//                    queue of the open ones, checked one by one in a drawer
//   Problemanalyse & Lösungen (UX-Problemanalyse & Lösungsentwicklung)
//                    the workflow from the observed problem to its solution: each
//                    person's up to three central problems (chosen in a drawer),
//                    the shared problem groups, and per group what was observed
//                    (problem, the people affected, central for, evidence) kept
//                    apart from the interpretation and design (possible cause,
//                    design requirement, solutions with their status and
//                    evaluation, the problem's status and evaluation result)
// Only confirmed tags count; AI suggestions are shown as such until taken over.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CraftingUxDoc, CraftingUxRating, ItemDoc } from '../types';
import { SECTION_LABEL } from '../types';
import { artOf, candidatesOf, centralTo, craftGroup, craftItems, cxProblemsOf, CX_STATUS, type CxProblem, type CxSolution, type CxStatus, distribution, mainOf, MAX_PICKS, picksOf, pickKey, rankCands, ratedAny, scoreOf, prioOf, relChip, relOf, REL_HINT, REL_LABEL, REL_SHORT, roleIn, sharedIssues, solStatus, SPECIAL_LABEL, suggestedRel, type Candidate, type CraftScope, type MainState, type Rel, type SharedIssue } from '../crafting';
import { designOfItem } from './Codes';
import { itemText, useContentView } from '../translations';
import { Empty, logChange, useCtx } from '../ui';

const TAB_KEY = 'asciia-study-cx-tab';
const QUEUE_KEY = 'asciia-study-cx-queue';
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
          Problemanalyse & Lösungen
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

export function Classification() {
  const ctx = useCtx();
  const { study, model, slice } = ctx;
  const view = useContentView();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [byArt, setByArt] = useState(false);
  const [at, setAt] = useState<string | null>(null); // the statement in the drawer
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(40);
  // the queue "Zu prüfen": folded until opened (remembered)
  const [qOpen, setQOpen] = useState(() => readLocal(QUEUE_KEY, '0') === '1');
  const toggleQ = () => {
    setQOpen(!qOpen);
    writeLocal(QUEUE_KEY, qOpen ? '0' : '1');
  };
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

      <section className={`st-cx-card${qOpen ? '' : ' is-folded'}`} aria-label="Zu prüfen">
        <h3>
          <button type="button" className="st-cx-qtoggle" aria-expanded={qOpen} onClick={toggleQ}>
            Zu prüfen
            <small>{`${dist.open} offen`}</small>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={qOpen ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
            </svg>
          </button>
          {qOpen && (
            <Seg
              value={filter}
              label="Aussagen"
              options={[
                ['open', `Offen ${dist.open}`],
                ['all', `Alle ${items.length}`],
              ]}
              onChange={(v) => (setFilter(v), setMore(40))}
            />
          )}
        </h3>
        {busy && <p className="st-cx-note" role="status">{busy}</p>}
        {!qOpen ? null : list.length ? (
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
        {qOpen && list.length > more && (
          <button type="button" className="st-linkbtn" onClick={() => setMore(more + 40)}>
            {`${list.length - more} weitere anzeigen`}
          </button>
        )}
        {qOpen && (
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
        )}
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
  const [mobile, setMobile] = useState<'people' | 'issues'>('issues');
  const [editing, setEditing] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null); // a new group's name
  const [find, setFind] = useState<string | null>(null); // the search, when open
  const [clusterOpen, setClusterOpen] = useState(false);
  const inView = useMemo(() => craftItems(model, slice.items, scope, variant), [model, slice.items, scope, variant]);
  const issuesAll = useMemo(() => sharedIssues(model, inView, groups), [model, inView, groups]);
  const withItems = new Set(inView.map((i) => i.person)).size;
  // a person's main problem is decided over all their crafting statements (not the filter)
  const allCrafting = useMemo(() => craftItems(model, slice.items, 'extended'), [model, slice.items]);
  const people = slice.persons.map((p) => {
    const cands = candidatesOf(model, p.id, allCrafting, groups);
    return { p, cands, main: mainOf(p, cands, groups, study.docs.items) };
  });
  const words = (find ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (x: SharedIssue) => !words.length || words.every((w) => `${x.problem.name} ${x.problem.description ?? ''} ${x.items.map((i) => `${i.person} ${i.text} ${i.de ?? ''}`).join(' ')}`.toLowerCase().includes(w));
  const issues = issuesAll.filter(matches);
  const sel = issue ? issuesAll.find((x) => x.problem.id === issue) ?? null : null;
  const centralBy = (gid: string) => centralTo(gid, people);
  const editP = editing ? people.find((x) => x.p.id === editing) : null;
  const ungrouped = inView.filter((i) => !groups.some((g) => g.items.includes(i.id)));
  const create = (name: string, items: string[] = []) => {
    const g: CxProblem = { id: `cx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: name.trim(), items, status: 'idea' };
    save([...latest(), g], `Problem „${g.name}“ angelegt`);
    return g;
  };
  // a person's dots: one per problem group they are in, their central problems
  // coloured by their state (in their order), a proposal as a ring
  const dotsOf = (pid: string, main: MainState) => {
    const mine = issuesAll.filter((x) => x.persons.includes(pid) || x.context.includes(pid));
    const rank = (id: string) => main.picks.findIndex((x) => x.key === `p:${id}`);
    const out = mine.map((x) => {
      const r = rank(x.problem.id);
      const cls = r >= 0 ? (main.picks[r].ok ? 'is-ok' : 'is-bad') : main.status === 'suggested' && main.key === `p:${x.problem.id}` ? 'is-sug' : '';
      return { id: x.problem.id, name: r >= 0 ? `${r + 1}. ${x.problem.name}` : x.problem.name, cls, r: r >= 0 ? r : 9 };
    });
    for (const [r, x] of main.picks.entries()) if (!x.ok || x.key.startsWith('i:')) out.push({ id: x.key, name: `${r + 1}. ${x.label}`, cls: x.ok ? 'is-ok' : 'is-bad', r });
    if (main.status === 'invalid' && !main.picks.length) out.push({ id: 'bad', name: main.label, cls: 'is-bad', r: 0 });
    return out.sort((a, b) => a.r - b.r);
  };
  // the workflow, step by step, with how far each step is
  const n = groups.length;
  const ideas = groups.reduce((a, g) => a + (g.solutions?.length ?? 0), 0);
  const flow: { label: string; value: string; hint: string; done: boolean }[] = [
    { label: 'Zentrale Probleme', value: `${people.filter((x) => x.main.status === 'confirmed').length} / ${people.length} Personen`, hint: `bis zu ${MAX_PICKS} je Person`, done: people.length > 0 && people.every((x) => x.main.status === 'confirmed') },
    { label: 'Problem-Gruppen', value: `${n} ${n === 1 ? 'Gruppe' : 'Gruppen'}`, hint: 'über Personen gebündelt', done: n > 0 && !ungrouped.length },
    { label: 'Problem beschrieben', value: `${groups.filter((g) => g.description?.trim()).length} / ${n}`, hint: 'was genau schwierig war', done: n > 0 && groups.every((g) => g.description?.trim()) },
    { label: 'Mögliche Ursache', value: `${groups.filter((g) => g.cause?.trim()).length} / ${n}`, hint: 'Hypothese, aus den Belegen', done: n > 0 && groups.every((g) => g.cause?.trim()) },
    { label: 'Lösungen', value: `${groups.filter((g) => g.solutions?.length).length} / ${n} · ${ideas} ${ideas === 1 ? 'Idee' : 'Ideen'}`, hint: 'mehrere vergleichen', done: n > 0 && groups.every((g) => g.solutions?.length) },
    { label: 'Umsetzung & Evaluation', value: `${groups.filter((g) => g.status === 'tested' || g.evaluation?.trim()).length} / ${n} bewertet`, hint: `${groups.filter((g) => (g.solutions ?? []).some((x) => ['implemented', 'tested'].includes(solStatus(x)))).length} mit umgesetzter Lösung`, done: n > 0 && groups.every((g) => g.status === 'tested' || g.status === 'rejected' || g.evaluation?.trim()) },
  ];

  return (
    <>
      <div className="st-cx-flowhead">
        <h2>UX-Problemanalyse & Lösungsentwicklung</h2>
        <span>Beobachtung → Ursache → Anforderung → Lösung → Umsetzung</span>
      </div>
      <ol className="st-cx-flow" aria-label="Ablauf">
        {flow.map((f, k) => (
          <li key={f.label} className={f.done ? 'is-done' : ''}>
            <b>
              <i aria-hidden="true">{f.done ? '✓' : k + 1}</i>
              {f.label}
            </b>
            <em>{f.value}</em>
            <small>{f.hint}</small>
          </li>
        ))}
      </ol>
      <div className="st-cx-top">
        <Seg value={scope} label="Crafting-Bezug" options={[['core', 'Kern'], ['extended', 'Kern + Integration']]} onChange={setScope} />
        <Seg value={variant} label="Variante" options={[['all', 'Alle Varianten'], ['A', 'A'], ['B', 'B']]} onChange={setVariant} />
        <span className="st-cx-mobile">
          <Seg value={mobile} label="Ansicht" options={[['people', 'Personen'], ['issues', 'Probleme']]} onChange={setMobile} />
        </span>
      </div>
      <div className={`st-cx-split2 is-${mobile}`}>
        <section className="st-cx-card st-cx-people" aria-label="Teilnehmende">
          <h3>
            Teilnehmende
            {person || issue ? (
              <button type="button" className="st-linkbtn st-small" onClick={() => (setPerson(null), setIssue(null))}>
                Auswahl aufheben
              </button>
            ) : (
              <Info text={`Ein Punkt je Problem-Gruppe der Person; farbig sind ihre bis zu ${MAX_PICKS} zentralen Probleme, in ihrer Reihenfolge. Zeile anklicken: ihre Probleme hervorheben; › : ihre Probleme bewerten (A · S · W) – die drei höchsten werden automatisch zentral, oder manuell wählen. n/3: zentrale Probleme; ≈: Gleichstand an Platz 3.`} />
            )}
          </h3>
          <ul className="st-cx-pl2">
            {people.map(({ p, main }) => {
              const cls = person === p.id ? 'is-sel' : sel ? (sel.persons.includes(p.id) ? 'is-hl' : 'is-dim') : '';
              const dots = dotsOf(p.id, main);
              return (
                <li key={p.id} className={cls}>
                  <button type="button" className="st-cx-prow2" aria-pressed={person === p.id} title={`Zentrale Probleme: ${main.label}`} onClick={() => (setIssue(null), setPerson(person === p.id ? null : p.id), setMobile('issues'))}>
                    <span className="st-cx-pid">{p.id}</span>
                    <span className="st-cx-dots" aria-label={`${dots.length} ${dots.length === 1 ? 'Problem' : 'Probleme'}`}>
                      {dots.slice(0, 6).map((d) => (
                        <i key={d.id} className={d.cls} title={d.name} />
                      ))}
                      {dots.length > 6 && <small>{`+${dots.length - 6}`}</small>}
                    </span>
                    {main.picks.length > 0 && (
                      <span className={`st-cx-n${main.picks.length >= MAX_PICKS ? ' is-full' : ''}${main.tie ? ' is-tie' : ''}`} title={`${main.picks.length} von ${MAX_PICKS} zentralen Problemen${main.auto ? ' · automatisch aus der Bewertung' : ' · manuell'}${main.tie ? ' · Gleichstand an Platz 3: vorläufig' : ''}`}>
                        {`${main.picks.length}/${MAX_PICKS}`}
                        {main.tie && '≈'}
                      </span>
                    )}
                  </button>
                  <button type="button" className="st-cx-open" aria-label={`Crafting-Probleme von ${p.id} bewerten`} title="Bewerten und zentrale Probleme festlegen" onClick={() => setEditing(p.id)}>
                    <Ico n="chev" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="st-cx-legend st-cx-legend2">
            <span className="is-wide">{`bis zu ${MAX_PICKS} zentrale Probleme je Person`}</span>
            <span>
              <i className="st-cx-d is-ok" />
              bestätigt
            </span>
            <span>
              <i className="st-cx-d is-sug" />
              Vorschlag
            </span>
            <span>
              <i className="st-cx-d is-bad" />
              Beleg fehlt
            </span>
            <span>
              <i className="st-cx-d" />
              weiteres Problem
            </span>
          </div>
        </section>

        <section className="st-cx-card st-cx-issues2" aria-label="Gemeinsame Probleme">
          <h3>
            <span>
              Gemeinsame Probleme
              <Info text="Eigene Problem-Gruppen nur für Crafting UX, unabhängig von den Wiederkehrenden Befunden. Als betroffen zählt, wer die Schwierigkeit belegt (eine Person mit fünf Aussagen = 1); Aussagen als Kontext (Vorlieben, neutrale Anmerkungen) zählen nicht." />
            </span>
            <span className="st-cx-tools">
              <button type="button" aria-label="Problem anlegen" title="Problem anlegen" onClick={() => setNaming(naming == null ? '' : null)}>
                <Ico n="plus" />
              </button>
              <button type="button" aria-label="KI: ähnliche Aussagen bündeln" title="KI: ähnliche Aussagen bündeln" disabled={inView.length < 2} onClick={() => setClusterOpen(true)}>
                <Ico n="tree" />
              </button>
              <button type="button" aria-label="Suchen" title="Suchen" aria-pressed={find != null} onClick={() => setFind(find == null ? '' : null)}>
                <Ico n="search" />
              </button>
            </span>
          </h3>
          {naming != null && (
            <div className="st-cx-bar2">
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
            </div>
          )}
          {find != null && (
            <div className="st-cx-bar2">
              <input type="search" autoFocus value={find} placeholder="Probleme und Aussagen durchsuchen …" aria-label="Probleme durchsuchen" onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setFind(null))} />
              <span className="st-cx-note">{`${issues.length} von ${issuesAll.length}`}</span>
            </div>
          )}
          <ul className="st-cx-il2">
            {issues.map((x) => {
              const id = x.problem.id;
              const central = centralBy(id);
              const sols = x.problem.solutions?.length ?? 0;
              const st = x.problem.status ?? 'idea';
              const cls = person ? (x.persons.includes(person) ? 'is-hl' : 'is-dim') : sel ? (id === issue ? '' : 'is-dim') : '';
              return (
                <li key={id} className={cls}>
                  <button type="button" className={`st-cx-row${issue === id ? ' is-open' : ''}`} aria-expanded={issue === id} onClick={() => (setPerson(null), setIssue(issue === id ? null : id))}>
                    <Ico n={issue === id ? 'down' : 'chev'} />
                    <span className="st-cx-rname">
                      <span>
                        {x.problem.name}
                        {person && central.some((c) => c.person === person) && <span className="st-cx-star">{`★ zentral (#${central.find((c) => c.person === person)!.rank})`}</span>}
                        {x.persons.length === 1 && <span className="st-cx-single">Einzelbefund</span>}
                      </span>
                      <small className="st-cx-rsub">
                        <b>{x.persons.length}</b> betroffen · <b>{`${central.length}×`}</b> zentral · <b>{sols}</b> {sols === 1 ? 'Lösung' : 'Lösungen'}
                      </small>
                    </span>
                    <span className={`st-cx-stat is-${st}`}>{CX_STATUS.find(([k]) => k === st)?.[1]}</span>
                  </button>
                  {issue === id && <IssueDetail x={x} central={central} inView={inView} view={view} total={withItems} onCollapse={() => setIssue(null)} />}
                </li>
              );
            })}
            <NoGroup items={ungrouped} total={inView.length} person={person} view={view} onCreate={create} />
          </ul>
          {!issuesAll.length && <p className="st-cx-note st-cx-pad">{inView.length ? 'Noch keine gemeinsamen Probleme: mit ＋ anlegen oder die KI ähnliche Aussagen bündeln lassen.' : 'Noch keine Aussagen mit diesem Crafting-Bezug.'}</p>}
          <p className="st-cx-note st-cx-foot2">{`n = ${withItems} ${withItems === 1 ? 'Person' : 'Personen'} mit Crafting-Aussagen${person ? ` · Probleme von ${person} hervorgehoben` : sel ? ' · Betroffene in der Personenliste hervorgehoben' : ''}`}</p>
        </section>
      </div>
      {editP && <MainDrawer key={editP.p.id} person={editP.p.id} doc={editP.p.doc} cands={editP.cands} main={editP.main} group={editP.p.group} onClose={() => setEditing(null)} />}
      {clusterOpen && <ClusterDrawer items={inView} onClose={() => setClusterOpen(false)} />}
    </>
  );
}

const ICONS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  tree: 'M12 3v6M6 15v-3h12v3M4 15h4v5H4zM10 15h4v5h-4zM16 15h4v5h-4z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 000-6M21 20a6 6 0 00-4-5.6',
  star: 'M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z',
  docs: 'M8 4h9l3 3v13H8zM4 8v12h11',
  chev: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z',
  cause: 'M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  quote: 'M7 17c-2 0-3-1.5-3-4 0-3 2-6 5-7M17 17c-2 0-3-1.5-3-4 0-3 2-6 5-7',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  pen: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  up: 'M6 15l6-6 6 6',
  eval: 'M4 19h16M7 16V9M12 16V5M17 16v-4',
};
function Ico({ n, s = 15 }: { n: string; s?: number }) {
  return (
    <svg className="st-cx-ico" viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[n]} />
    </svg>
  );
}

// an open problem: what was observed (the problem, the people affected by
// Crafting-Bezug, the people it is central to, the evidence) kept apart from
// the interpretation and design (possible cause, design requirement, solutions
// with their status and evaluation, the problem's status and evaluation
// result). ✎ edits the texts and the statements; a statement's role (evidence
// or context), a solution's status and the problem's status change with one click.
type Draft = { name: string; category: string; description: string; cause: string; requirement: string; evaluation: string; solutions: CxSolution[] };
const draftOf = (g: CxProblem): Draft => ({ name: g.name, category: g.category ?? '', description: g.description ?? '', cause: g.cause ?? '', requirement: g.requirement ?? '', evaluation: g.evaluation ?? '', solutions: (g.solutions ?? []).map((s) => ({ ...s, status: solStatus(s) })) });
function IssueDetail({ x, central, inView, view, total, onCollapse }: { x: SharedIssue; central: { person: string; rank: number }[]; inView: ItemDoc[]; view: ReturnType<typeof useContentView>; total: number; onCollapse: () => void }) {
  const { model } = useCtx();
  const { save, latest } = useGroups();
  const g = x.problem;
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(g));
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const patch = (p: Partial<CxProblem>, what: string) => save(latest().map((y) => (y.id === g.id ? { ...y, ...p } : y)), what);
  const start = () => (setDraft(draftOf(g)), setEdit(true));
  const opt = (v: string) => v.trim() || undefined;
  const commit = () => {
    patch(
      { name: draft.name.trim() || g.name, category: opt(draft.category), description: opt(draft.description), cause: opt(draft.cause), requirement: opt(draft.requirement), evaluation: opt(draft.evaluation), solutions: draft.solutions.filter((s) => s.text.trim()).map((s) => ({ ...s, text: s.text.trim(), evaluation: s.evaluation?.trim() || undefined })) },
      `Problem „${draft.name.trim() || g.name}“ bearbeitet`,
    );
    setEdit(false);
  };
  const solutions = edit ? draft.solutions : (g.solutions ?? []).map((s) => ({ ...s, status: solStatus(s) }));
  const setSol = (id: string, p: Partial<CxSolution>) =>
    edit ? setDraft({ ...draft, solutions: draft.solutions.map((s) => (s.id === id ? { ...s, ...p } : s)) }) : patch({ solutions: (g.solutions ?? []).map((s) => (s.id === id ? { ...s, ...p } : s)) }, `Lösung in „${g.name}“ geändert`);
  const setRole = (i: ItemDoc, r: 'evidence' | 'context') => patch({ roles: { ...(g.roles ?? {}), [i.id]: r } }, `${i.person}: Aussage in „${g.name}“ als ${r === 'evidence' ? 'Beleg' : 'Kontext'}`);
  // the people affected (by evidence only), by their statements' Crafting-Bezug, each with the variant(s) they spoke about
  const byRel = (['core', 'integration'] as const)
    .map((r) => {
      const its = x.evidence.filter((i) => relOf(model, i) === r);
      const ps = [...new Set(its.map((i) => i.person))].sort();
      return { r, ps: ps.map((p) => ({ p, v: [...new Set(its.filter((i) => i.person === p).map(designOfItem).filter(Boolean))].join('/') })) };
    })
    .filter((x2) => x2.ps.length);
  const variants = [...new Set(x.evidence.map(designOfItem).filter(Boolean))].sort();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = q.trim().length >= 2 ? inView.filter((i) => !g.items.includes(i.id) && words.every((w) => `${i.person} ${i.text} ${i.de ?? ''}`.toLowerCase().includes(w))).slice(0, 8) : [];
  const hidden = g.items.length - x.items.length; // in the group, but outside the current view
  // evidence first, then context
  const ordered = [...x.evidence, ...x.items.filter((i) => !x.evidence.includes(i))];
  const shown = all || edit ? ordered : ordered.slice(0, 4);
  const nCtx = x.items.length - x.evidence.length;
  const field = (k: 'description' | 'cause' | 'requirement' | 'evaluation', placeholder: string) =>
    edit ? <textarea rows={Math.min(8, Math.max(2, Math.ceil(draft[k].length / 46) + 1))} value={draft[k]} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /> : g[k] ? <span className="st-cx-txt">{g[k]}</span> : <span className="st-cx-empty">–</span>;
  const status = g.status ?? 'idea';
  return (
    <div className="st-cx-det">
      <div className="st-cx-dettools">
        {edit ? (
          <span className="st-cx-names">
            <input className="st-cx-gname" value={draft.name} aria-label="Name des Problems" placeholder="Problemtitel" maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="st-cx-gcat" value={draft.category} aria-label="Kategorie" placeholder="Kategorie, z. B. Verständlichkeit" maxLength={60} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </span>
        ) : (
          <span className="st-cx-tags">
            {x.rels.filter((r) => r !== 'open').map((r) => (
              <span key={r} className={`st-cx-tag is-${r}`}>
                {REL_SHORT[r]}
              </span>
            ))}
            {variants.map((v) => (
              <span key={v} className="st-cx-tag">{`Variante ${v}`}</span>
            ))}
            {g.category && <span className="st-cx-tag is-cat">{g.category}</span>}
            <span className="st-cx-note">{`${x.persons.length}/${total} Personen · ${x.items.length} ${x.items.length === 1 ? 'Aussage' : 'Aussagen'}${hidden > 0 ? ` · ${hidden} weitere außerhalb der Auswahl` : ''}${x.persons.length === 1 ? ' · nur eine Person: nicht wiederkehrend' : ''}`}</span>
          </span>
        )}
        {!edit && (
          <span className="st-cx-dbtns">
            <button type="button" className="st-cx-btn" onClick={start}>
              <Ico n="pen" s={13} /> Bearbeiten
            </button>
            <button type="button" className="st-cx-btn" onClick={onCollapse}>
              <Ico n="up" s={13} /> Einklappen
            </button>
          </span>
        )}
      </div>

      <section className="st-cx-blk" aria-label="Beobachtet">
        <h4>
          Beobachtet <span>aus den Aussagen</span>
        </h4>
        <div className="st-cx-f">
          <Ico n="warn" />
          <b>
            Problem<small>neutral beschrieben</small>
          </b>
          {field('description', 'Was genau den Testpersonen schwerfiel, neutral formuliert')}
        </div>
        <div className="st-cx-f">
          <Ico n="people" />
          <b>
            Betroffene
            <small>nur Belege zählen</small>
          </b>
          <div>
            {byRel.map(({ r, ps }) => (
              <div key={r} className="st-cx-cat">
                <span>
                  <b className={`k-${r}`} />
                  {REL_SHORT[r]}
                </span>
                <span className="st-cx-chips">
                  {ps.map(({ p, v }) => (
                    <span key={p} className="st-cx-chip">
                      {p}
                      {v && <small>{v}</small>}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {x.context.length > 0 && (
              <div className="st-cx-cat">
                <span>Nur Kontext</span>
                <span className="st-cx-chips">
                  {x.context.map((p) => (
                    <span key={p} className="st-cx-chip is-ctx" title="nur Kontext-Aussagen: nicht als betroffen gezählt">
                      {p}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {!byRel.length && !x.context.length && <span className="st-cx-empty">–</span>}
          </div>
        </div>
        <div className="st-cx-f">
          <Ico n="star" />
          <b>
            Zentral bei<small>{`aus den Top ${MAX_PICKS} je Person`}</small>
          </b>
          <span className="st-cx-chips">
            {central.length ? (
              central.map((c) => (
                <span key={c.person} className="st-cx-chip is-dark" title={`${c.rank}. zentrales Problem von ${c.person}`}>
                  {c.person}
                  <small>{`#${c.rank}`}</small>
                </span>
              ))
            ) : (
              <span className="st-cx-empty">bei niemandem als zentrales Problem gewählt</span>
            )}
          </span>
        </div>
        <div className="st-cx-f">
          <Ico n="quote" />
          <b>
            Belege <small>{`${x.evidence.length} ${x.evidence.length === 1 ? 'Beleg' : 'Belege'}${nCtx ? ` · ${nCtx} Kontext` : ''}`}</small>
          </b>
          <div>
            {edit ? (
              <Quotes items={shown} view={view} onRemove={(i) => patch({ items: g.items.filter((id) => id !== i.id) }, `Aussage aus „${g.name}“ genommen`)} />
            ) : (
              <div className="st-cx-qgrid">
                {shown.map((i) => {
                  const r = roleIn(model, g, i);
                  return (
                    <div key={i.id} className={`st-cx-qc${r === 'context' ? ' is-ctx' : ''}`}>
                      {`„${itemText(view, i)}“`}
                      <small>
                        <span>{[i.person, artOf(model, i), REL_SHORT[relOf(model, i)], designOfItem(i) ? `Variante ${designOfItem(i)}` : ''].filter(Boolean).join(' · ')}</span>
                        <button
                          type="button"
                          className={`st-cx-role is-${r}`}
                          title={r === 'evidence' ? 'Belegt die Schwierigkeit (zählt). Klick: nur als Kontext' : 'Nur Kontext (zählt nicht). Klick: als Beleg'}
                          aria-label={`${i.person}: ${r === 'evidence' ? 'Beleg, als Kontext setzen' : 'Kontext, als Beleg setzen'}`}
                          onClick={() => setRole(i, r === 'evidence' ? 'context' : 'evidence')}
                        >
                          {r === 'evidence' ? 'Beleg' : 'Kontext'}
                        </button>
                      </small>
                    </div>
                  );
                })}
              </div>
            )}
            {!edit && x.items.length > 4 && (
              <button type="button" className="st-linkbtn st-cx-more2" onClick={() => setAll(!all)}>
                {all ? 'Weniger anzeigen' : `Alle ${x.items.length} Aussagen anzeigen`}
              </button>
            )}
            {edit && (
              <>
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
              </>
            )}
          </div>
        </div>
      </section>

      <section className="st-cx-blk" aria-label="Interpretation & Design">
        <h4>
          Interpretation & Design <span>eigene Annahmen und Vorschläge</span>
        </h4>
        <div className="st-cx-f">
          <Ico n="cause" />
          <b>
            Mögliche Ursache<small>Hypothese</small>
          </b>
          {field('cause', 'Was das Problem auslösen könnte (aus den Belegen begründet)')}
        </div>
        <div className="st-cx-f">
          <Ico n="target" />
          <b>Designanforderung</b>
          {field('requirement', 'Was das Redesign verbessern muss')}
        </div>
        <div className="st-cx-f">
          <Ico n="bulb" />
          <b>
            Lösungen<small>{solutions.length ? `${solutions.length} ${solutions.length === 1 ? 'Idee' : 'Ideen'}` : ''}</small>
          </b>
          <div className="st-cx-sols">
            {solutions.map((sol, k) => {
              const st = solStatus(sol);
              return (
                <div key={sol.id} className={`st-cx-solc is-${st}`}>
                  <span className="st-cx-solh">
                    <span>{`Lösung ${k + 1}`}</span>
                    <select className={`st-cx-solst is-${st}`} value={st} aria-label={`Status von Lösung ${k + 1}`} onChange={(e) => setSol(sol.id, { status: e.target.value as CxStatus })}>
                      {CX_STATUS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {edit && (
                      <button type="button" className="st-cx-x is-small" aria-label={`Lösung ${k + 1} entfernen`} onClick={() => setDraft({ ...draft, solutions: draft.solutions.filter((s) => s.id !== sol.id) })}>
                        ×
                      </button>
                    )}
                  </span>
                  {edit ? <textarea rows={2} value={sol.text} aria-label={`Lösung ${k + 1}`} placeholder="Lösungsidee …" onChange={(e) => setSol(sol.id, { text: e.target.value })} /> : <span className="st-cx-txt">{sol.text}</span>}
                  {edit ? (
                    <textarea rows={1} value={sol.evaluation ?? ''} aria-label={`Evaluation von Lösung ${k + 1}`} placeholder="Evaluation: was ein erneuter Test gezeigt hat (optional)" onChange={(e) => setSol(sol.id, { evaluation: e.target.value })} />
                  ) : sol.evaluation ? (
                    <span className="st-cx-ev">
                      <b>Evaluation:</b> {sol.evaluation}
                    </span>
                  ) : (
                    ['implemented', 'tested'].includes(st) && (
                      <span className="st-cx-ev">
                        <b>Evaluation:</b> noch nicht eingetragen
                      </span>
                    )
                  )}
                </div>
              );
            })}
            {!solutions.length && !edit && <span className="st-cx-empty">Noch keine Lösungsidee.</span>}
            {edit && (
              <button type="button" className="st-linkbtn st-cx-more2" onClick={() => setDraft({ ...draft, solutions: [...draft.solutions, { id: `sol${Date.now().toString(36)}`, text: '', status: 'idea' }] })}>
                + Lösung hinzufügen
              </button>
            )}
          </div>
        </div>
        <div className="st-cx-f">
          <Ico n="flag" />
          <b>
            Status<small>des Problems</small>
          </b>
          <span className="st-cx-steps" role="radiogroup" aria-label="Status des Problems">
            {CX_STATUS.map(([k, l], n) => (
              <span key={k} className="st-cx-stepw">
                {n > 0 && n < 4 && <i aria-hidden="true">›</i>}
                <button type="button" role="radio" aria-checked={status === k} className={`st-cx-step${status === k ? ' is-on' : ''}${k === 'rejected' ? ' is-rej' : ''}`} onClick={() => patch({ status: k }, `Status von „${g.name}“: ${l}`)}>
                  {l}
                </button>
              </span>
            ))}
          </span>
        </div>
        <div className="st-cx-f">
          <Ico n="eval" />
          <b>
            Evaluationsergebnis<small>nach erneutem Test</small>
          </b>
          {field('evaluation', 'Ob spätere Tests die Wirksamkeit der Lösung stützen')}
        </div>
      </section>
      {edit && (
        <div className="st-cx-editfoot">
          <button
            type="button"
            className="st-linkbtn st-cx-del"
            onClick={() => confirm(`Problem „${g.name}“ löschen? Die Aussagen bleiben erhalten; ein darauf gesetztes zentrales Problem muss neu gewählt werden.`) && save(latest().filter((y) => y.id !== g.id), `Problem „${g.name}“ gelöscht`)}
          >
            Problem löschen
          </button>
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={() => setEdit(false)}>
            Abbrechen
          </button>
          <button type="button" className="st-cx-btn is-pri" onClick={commit}>
            Speichern
          </button>
        </div>
      )}
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
    <li className="st-cx-nof2">
      <button type="button" className={`st-cx-row is-plain${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ico n={open ? 'down' : 'chev'} />
        <span className="st-cx-rname">
          Ohne Problem-Gruppe
          {person && own > 0 && <span className="st-cx-star">{`${own} von ${person}`}</span>}
        </span>
        <span className="st-cx-cnt">
          <span title={`${items.length} von ${total} Crafting-Aussagen`}>
            <Ico n="docs" />
            {items.length}
          </span>
        </span>
      </button>
      {open && (
        <div className="st-cx-det">
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
    </li>
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

// a person's central Crafting UX problems. Automatisch: each candidate (the
// problem groups their statements are in, their statements without a group) is
// rated A (Aufgabenbeeinträchtigung), S (Schwierigkeit), W (Wiederholung), 0–3
// each, and its evidence confirmed; the three highest scores are the central
// problems (a tie at place three is provisional). Manuell: up to three picked
// and ordered by hand. Or one special case.
const CRIT: { k: 'a' | 's' | 'w'; l: string; name: string }[] = [
  { k: 'a', l: 'A', name: 'Aufgabenbeeinträchtigung' },
  { k: 's', l: 'S', name: 'Schwierigkeit' },
  { k: 'w', l: 'W', name: 'Wiederholung' },
];
function MainDrawer({ person, doc, cands, main, group, onClose }: { person: string; doc: import('../types').PersonDoc; cands: Candidate[]; main: MainState; group: 'AB' | 'BA' | null; onClose: () => void }) {
  const { study, model } = useCtx();
  const view = useContentView();
  const stored = doc.craftingUx ?? null;
  // (older decisions picked by hand stay manual; anything new starts automatic)
  const [mode, setMode] = useState<'auto' | 'manual'>(stored?.mode ?? (picksOf(stored).length ? 'manual' : 'auto'));
  const [ratings, setRatings] = useState<Record<string, CraftingUxRating>>(stored?.ratings ?? {});
  const [onlyTop, setOnlyTop] = useState(false);
  // the stored picks (kept even when their evidence is gone, to be seen and removed), else the proposal
  const [keys, setKeys] = useState<string[]>(() => (stored && stored.mode !== 'auto' ? picksOf(stored).map(pickKey) : []));
  const [special, setSpecial] = useState<CraftingUxDoc['special']>(stored?.special ?? null);
  const [reason, setReason] = useState(stored?.reason ?? '');
  const byKey = new Map(cands.map((c) => [c.key, c]));
  const rank = rankCands(cands, ratings);
  const rate = (k: string, p: Partial<CraftingUxRating>) => setRatings((r) => ({ ...r, [k]: { ...r[k], ...p } }));
  const toMode = (m: 'auto' | 'manual') => {
    // (to decide by hand: start from the automatic three)
    if (m === 'manual' && !keys.length) setKeys(rank.top.map((x) => x.cand.key));
    setMode(m);
  };
  const chosen = special ? [] : mode === 'auto' ? rank.top.map((x) => x.cand.key) : keys;
  const toggle = (k: string) => {
    setSpecial(null);
    setKeys(keys.includes(k) ? keys.filter((x) => x !== k) : keys.length < MAX_PICKS ? [...keys, k] : keys);
  };
  const moveBy = (k: string, d: number) => {
    const i = keys.indexOf(k);
    const j = i + d;
    if (i < 0 || j < 0 || j >= keys.length) return;
    const n = [...keys];
    [n[i], n[j]] = [n[j], n[i]];
    setKeys(n);
  };
  // (the ratings of candidates that are gone are left out)
  const keptRatings = Object.fromEntries(Object.entries(ratings).filter(([k, r]) => byKey.has(k) && (ratedAny(r) || r.ok)));
  const save = (data: CraftingUxDoc | null) => {
    const { craftingUx: _old, ...rest } = doc;
    study.commit([{ coll: 'people', id: person, data: { ...rest, id: person, ...(data ? { craftingUx: data } : {}) } }]);
    logChange(study, `Crafting UX: zentrale Probleme von ${person} ${data ? (data.special ? `= ${SPECIAL_LABEL[data.special]}` : data.mode === 'auto' ? `automatisch aus der Bewertung (${rankCands(cands, data.ratings).top.length})` : `festgelegt (${data.picks?.length ?? 0})`) : 'zurückgesetzt'}`);
    onClose();
  };
  const valid = keys.filter((k) => byKey.has(k));
  const base = { ratings: Object.keys(keptRatings).length ? keptRatings : undefined, reason: reason.trim() || undefined, at: Date.now() };
  const confirm = () => {
    if (special) return save({ ...base, mode, special });
    if (mode === 'auto') return save({ ...base, mode: 'auto' });
    const picks = valid.map((k) => (k.startsWith('p:') ? { problem: k.slice(2), item: null } : { problem: null, item: k.slice(2) }));
    if (picks.length) save({ ...base, mode: 'manual', picks, problem: picks[0].problem, item: picks[0].item });
  };
  const lost = keys.filter((k) => !byKey.has(k));
  const others = cands.filter((c) => !keys.includes(c.key));
  const evidence = chosen.flatMap((k) => byKey.get(k)?.items ?? []);
  const nameOf = (c: Candidate) => (c.problem ? c.problem.name : itemText(view, c.item!));
  const line = (c: Candidate) => [c.problem ? `Problem-Gruppe · ${c.items.length} eigene ${c.items.length === 1 ? 'Aussage' : 'Aussagen'}` : 'Aussage ohne Problem-Gruppe', REL_SHORT[c.rel], [...new Set(c.items.map((i) => artOf(model, i)))].filter(Boolean).join(' / '), PRIO_LABEL[c.prio], [...new Set(c.items.map((i) => SECTION_LABEL[i.section]))].join(' / ')].filter(Boolean).join(' · ');
  const shownRanked = onlyTop ? rank.ranked.filter((x) => x.top) : rank.ranked;
  return (
    <Drawer
      title={`${person} · Crafting-Probleme bewerten`}
      sub={`${cands.length} ${cands.length === 1 ? 'Kandidat' : 'Kandidaten'}${group ? ` · Reihenfolge ${group}` : ''}${main.status === 'invalid' ? ' · ein gespeicherter Beleg fehlt' : ''}`}
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
          <button type="button" className="st-cx-btn is-pri" disabled={!special && mode === 'manual' && !valid.length} onClick={confirm}>
            Bestätigen
          </button>
        </>
      }
    >
      <div className="st-cx-rtop">
        <Seg value={mode} label="Auswahl der zentralen Probleme" options={[['auto', 'Automatisch'], ['manual', 'Manuell']]} onChange={toMode} />
        {mode === 'auto' && (
          <label className="st-cx-onlytop">
            <input type="checkbox" checked={onlyTop} onChange={(e) => setOnlyTop(e.target.checked)} /> Nur Top 3
          </label>
        )}
      </div>
      {mode === 'auto' ? (
        <>
          <p className="st-cx-note">A = Aufgabenbeeinträchtigung · S = Schwierigkeit · W = Wiederholung, je 0–3 · max. 9. Gewertet wird nur mit bestätigtem Beleg und allen drei Werten – nach den dokumentierten Beobachtungen, nicht nach Art oder Priorität.</p>
          {cands.length ? (
            <div className="st-cx-rrows">
              {shownRanked.map(({ cand: c, score, top, tie }) => {
                const r = ratings[c.key] ?? {};
                return (
                  <div key={c.key} className={`st-cx-rrow${top ? ' is-top' : ''}${score == null ? ' is-off' : ''}`}>
                    <span className="st-cx-rname2">
                      <strong>
                        {nameOf(c)}
                        {top && <span className={`st-cx-topb${tie ? ' is-tie' : ''}`}>{tie ? 'Gleichstand' : 'Top 3'}</span>}
                        {!top && tie && <span className="st-cx-topb is-tie is-out">Gleichstand</span>}
                      </strong>
                      <small>{line(c)}</small>
                    </span>
                    <span className="st-cx-score" aria-label={score == null ? 'nicht gewertet' : `${score} von 9 Punkten`}>
                      {score ?? '—'}
                      <small>/9</small>
                    </span>
                    <span className="st-cx-rctl">
                      {CRIT.map(({ k, l, name }) => (
                        <span key={k} className="st-cx-crit" role="radiogroup" aria-label={`${name}: ${nameOf(c)}`}>
                          <b title={name}>{l}</b>
                          <span>
                            {([null, 0, 1, 2, 3] as const).map((v) => (
                              <button key={String(v)} type="button" role="radio" aria-checked={(r[k] ?? null) === v} aria-label={`${l} ${v ?? 'nicht bewertet'}`} className={(r[k] ?? null) === v ? 'is-on' : ''} onClick={() => rate(c.key, { [k]: v })}>
                                {v ?? '—'}
                              </button>
                            ))}
                          </span>
                        </span>
                      ))}
                      <label className={`st-cx-okb${r.ok ? '' : ' is-no'}`}>
                        <input type="checkbox" checked={!!r.ok} onChange={(e) => rate(c.key, { ok: e.target.checked })} />
                        {r.ok ? 'Beleg bestätigt' : 'Beleg prüfen'}
                      </label>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="st-cx-note">Keine Aussagen dieser Person mit Crafting-Bezug Kern oder Integration.</p>
          )}
          <div>
            <span className="st-cx-lab">
              <span>Automatisch verknüpfte zentrale Probleme</span>
              <small>{`${rank.top.length} ausgewählt`}</small>
            </span>
            {rank.top.length ? (
              <ol className="st-cx-res">
                {rank.top.map((x, i) => (
                  <li key={x.cand.key}>
                    <b>{i + 1}</b>
                    <span>{nameOf(x.cand)}</span>
                    <em>{`${x.score}/9`}</em>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="st-cx-note">Noch keins: ein Problem mit allen drei Werten und bestätigtem Beleg bewerten.</p>
            )}
            {rank.tie && <p className="st-cx-warn2">Gleichstand an Platz 3: die Auswahl ist vorläufig. Unter „Manuell“ entscheiden.</p>}
          </div>
        </>
      ) : (
        <>
          <div>
            <span className="st-cx-lab">
              <span>
                Zentrale Probleme
                <Info text="Kriterien: Auswirkung auf die Aufgabe · beobachtet oder ausdrücklich berichtet · wiederholt · Forschungsbezug (Kontrolle, Erwartung, Umgang mit dem KI-Ergebnis). Das wichtigste zuerst." />
              </span>
              <small>{`bis zu ${MAX_PICKS}, nach Gewicht geordnet · ${keys.length} gewählt`}</small>
            </span>
            {keys.length > 0 && !special ? (
              <ol className="st-cx-picks">
                {keys.map((k, r) => {
                  const c = byKey.get(k);
                  const label = c ? nameOf(c) : main.picks.find((x) => x.key === k)?.label ?? 'Beleg fehlt';
                  const sc = scoreOf(ratings[k]);
                  return (
                    <li key={k} className={`st-cx-pick is-on${c ? '' : ' is-bad'}`}>
                      <button type="button" className="st-cx-rank" aria-label={`${label}: abwählen`} title="Abwählen" onClick={() => toggle(k)}>
                        {r + 1}
                      </button>
                      <span>
                        {label}
                        <small>{c ? `${line(c)}${sc != null ? ` · ${sc}/9` : ''}` : 'gehört nicht mehr zu einer eigenen Crafting-Aussage – abwählen oder neu wählen'}</small>
                      </span>
                      <span className="st-cx-mv">
                        <button type="button" aria-label={`${label}: nach oben`} disabled={r === 0} onClick={() => moveBy(k, -1)}>
                          <Ico n="up" s={13} />
                        </button>
                        <button type="button" aria-label={`${label}: nach unten`} disabled={r === keys.length - 1} onClick={() => moveBy(k, 1)}>
                          <Ico n="down" s={13} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="st-cx-note">{special ? 'Sonderfall gewählt.' : 'Noch keins gewählt: unten antippen.'}</p>
            )}
          </div>
          {others.length > 0 && (
            <div>
              <span className="st-cx-lab">
                <span>{keys.length ? 'Weitere Kandidaten' : 'Kandidaten'}</span>
                {keys.length >= MAX_PICKS && <small>{`schon ${MAX_PICKS} gewählt: erst eins abwählen`}</small>}
              </span>
              <div className="st-cx-opts">
                {others.map((c) => {
                  const sc = scoreOf(ratings[c.key]);
                  return (
                    <button key={c.key} type="button" className="st-cx-opt st-cx-pick" disabled={keys.length >= MAX_PICKS} onClick={() => toggle(c.key)}>
                      <span className="st-cx-rank" aria-hidden="true" />
                      <span>
                        {nameOf(c)}
                        <small>{`${line(c)}${sc != null ? ` · ${sc}/9` : ''}`}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!cands.length && !lost.length && <p className="st-cx-note">Keine Aussagen dieser Person mit Crafting-Bezug Kern oder Integration.</p>}
        </>
      )}
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
        <textarea rows={3} value={reason} placeholder="Warum diese Probleme am schwersten wogen …" onChange={(e) => setReason(e.target.value)} />
      </label>
      {evidence.length > 0 && (
        <div>
          <span className="st-cx-lab">Belege der zentralen Probleme</span>
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
