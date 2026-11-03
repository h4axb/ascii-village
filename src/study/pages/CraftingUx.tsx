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
import { candidatesOf, craftGroup, craftProblems, distribution, mainOf, prioOf, relChip, relOf, REL_HINT, REL_LABEL, REL_SHORT, sharedIssues, SPECIAL_LABEL, suggestedRel, type Candidate, type CraftScope, type MainState, type Rel, type SharedIssue } from '../crafting';
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
function Analysis() {
  const ctx = useCtx();
  const { study, model, slice } = ctx;
  const view = useContentView();
  const [scope, setScope] = useState<CraftScope>('extended');
  const [variant, setVariant] = useState<'all' | 'A' | 'B'>('all');
  const [person, setPerson] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [mobile, setMobile] = useState<'people' | 'issues'>('people');
  const [editing, setEditing] = useState<string | null>(null);
  const findings = study.docs.findings;
  const problems = useMemo(() => craftProblems(model, slice.items, scope, variant), [model, slice.items, scope, variant]);
  const issues = useMemo(() => sharedIssues(model, problems, findings), [model, problems, findings]);
  const withProblems = new Set(problems.map((i) => i.person)).size;
  // a person's main problem is decided over all their crafting problems (not the filter)
  const allProblems = useMemo(() => craftProblems(model, slice.items, 'extended'), [model, slice.items]);
  const people = slice.persons.map((p) => {
    const cands = candidatesOf(model, p.id, allProblems, findings);
    return { p, cands, main: mainOf(p, cands, findings, study.docs.items) };
  });
  const sel = issue ? issues.find((x) => x.finding.id === issue) ?? null : null;
  const personIssues = person ? new Set(issues.filter((x) => x.persons.includes(person)).map((x) => x.finding.id)) : null;
  const mainOfPerson = person ? people.find((x) => x.p.id === person)?.main : null;
  const mainsBy = (fid: string) => people.filter((x) => x.main.status === 'confirmed' && x.main.key === `f:${fid}`).map((x) => x.p.id);
  const counts = { confirmed: people.filter((x) => x.main.status === 'confirmed').length, suggested: people.filter((x) => x.main.status === 'suggested').length };
  const editP = editing ? people.find((x) => x.p.id === editing) : null;

  return (
    <>
      <div className="st-cx-top">
        <Seg value={scope} label="Crafting-Probleme" options={[['core', 'Kern'], ['extended', 'Kern + Integration']]} onChange={setScope} />
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
              const affected = sel ? sel.persons.includes(p.id) : true;
              const cls = person === p.id ? 'is-sel' : sel ? (affected ? 'is-hl' : 'is-dim') : person ? '' : '';
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
            Gemeinsame Probleme
            <small>{person ? `bei ${person} hervorgehoben` : sel ? 'Betroffene links hervorgehoben' : `n = ${withProblems} ${withProblems === 1 ? 'Person' : 'Personen'} mit Crafting-Problemen`}</small>
          </h3>
          {issues.length ? (
            <ul className="st-cx-il">
              {issues.map((x) => {
                const id = x.finding.id;
                const cls = person ? (personIssues!.has(id) ? 'is-hl' : 'is-dim') : sel ? (id === issue ? 'is-hl' : 'is-dim') : '';
                const isMain = person && mainOfPerson?.status === 'confirmed' && mainOfPerson.key === `f:${id}`;
                return (
                  <li key={id} className={cls}>
                    <IssueRow x={x} total={withProblems} open={issue === id} isMain={!!isMain} onToggle={() => (setPerson(null), setIssue(issue === id ? null : id))} />
                    {issue === id && <IssueDetail x={x} mains={mainsBy(id)} view={view} />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="st-cx-note">{problems.length ? 'Die Crafting-Probleme sind noch keinem wiederkehrenden Befund zugeordnet (Seite „Wiederkehrende Befunde“).' : 'Noch keine bestätigten Crafting-Probleme in dieser Auswahl.'}</p>
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
          <p className="st-cx-note">
            {`${problems.length} bestätigte Crafting-Probleme · ${problems.filter((i) => !i.finding && !(i.moreFindings ?? []).length).length} ohne Befund. `}
            <a href="#qualitativ/befunde">Befunde bündeln →</a>
          </p>
        </section>
      </div>
      {editP && <MainDrawer key={editP.p.id} person={editP.p.id} doc={editP.p.doc} cands={editP.cands} main={editP.main} group={editP.p.group} onClose={() => setEditing(null)} />}
    </>
  );
}

function IssueRow({ x, total, open, isMain, onToggle }: { x: SharedIssue; total: number; open: boolean; isMain: boolean; onToggle: () => void }) {
  const n = x.persons.length;
  const w = (k: number) => `${(k / Math.max(1, total)) * 100}%`;
  return (
    <button type="button" className="st-cx-ir" aria-expanded={open} onClick={onToggle}>
      <span className="st-cx-iname">
        {x.finding.name}
        {isMain && <span className="st-cx-star">★ Hauptproblem</span>}
        {n === 1 && <span className="st-cx-single">Einzelbefund</span>}
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

function IssueDetail({ x, mains, view }: { x: SharedIssue; mains: string[]; view: ReturnType<typeof useContentView> }) {
  const { model } = useCtx();
  const codes = [...new Set(x.items.flatMap((i) => i.chips).filter((c) => model.tags.find((g) => g.id === 'code')?.chips.some((k) => k.id === c)))].map((c) => model.chipLabel.get(c));
  const designs = [...new Set(x.items.map(designOfItem))];
  return (
    <div className="st-cx-ix">
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
      <span className="st-cx-note">{`${x.items.length} ${x.items.length === 1 ? 'Aussage' : 'Aussagen'} · ${x.persons.join(', ')}${mains.length ? ` · Hauptproblem bei ${mains.join(', ')}` : ''}${x.persons.length === 1 ? ' · nur eine Person: nicht wiederkehrend' : ''}`}</span>
      {x.items.slice(0, 3).map((i) => (
        <div key={i.id} className="st-cx-quote">
          <small>{i.person}</small>
          {itemText(view, i)}
        </div>
      ))}
      <a className="st-cx-more" href="#qualitativ/befunde">
        {x.items.length > 3 ? `Alle ${x.items.length} Aussagen · Befund bearbeiten` : 'Befund bearbeiten'}
      </a>
    </div>
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
    else if (chosen) save({ finding: chosen.finding?.id ?? null, item: chosen.finding ? null : chosen.item!.id, reason: reason.trim() || undefined, at: Date.now() });
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
                    {c.finding ? c.finding.name : itemText(view, c.item!)}
                    <small>{[c.finding ? `Befund · ${c.items.length} eigene ${c.items.length === 1 ? 'Aussage' : 'Aussagen'}` : 'Aussage ohne Befund', REL_SHORT[c.rel], PRIO_LABEL[c.prio], sections].filter(Boolean).join(' · ')}</small>
                  </span>
                  {main.status === 'suggested' && main.key === c.key && !stored && <span className="st-cx-ai">Vorschlag</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="st-cx-note">Keine bestätigten Crafting-Probleme dieser Person.</p>
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
