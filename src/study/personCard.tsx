// Qualitatives Feedback: a participant's profile as a compact card. Testgruppe
// and Reihenfolge always visible; the rest (test link, name, age, job,
// tracking, date, time) under "Weitere Angaben". The pen turns the same card
// into fields; changed fields are outlined and listed until "Fertig".
import { useEffect, useRef, useState } from 'react';
import type { NotesMeta } from './types';
import { linkKeyOf, type Person } from './model';
import { composeSlot, fmtIsoDate, isoOfMs, orderOf, parseSlot, shortLink, testgroupOf } from './profile';
import { logChange, useCtx } from './ui';

const FOLD_KEY = 'asciia-study-pcard-more';
const readFold = () => {
  try {
    return localStorage.getItem(FOLD_KEY) === 'open';
  } catch {
    return false;
  }
};

const Icon = ({ d, size = 16, w = 2 }: { d: string; size?: number; w?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const PEN = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z';
const CHEV = 'm6 9 6 6 6-6';
const COPY = 'M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1';
const CHECK = 'M20 6 9 17l-5-5';
const OPEN = 'M7 17 17 7M8 7h9v9';
const CROSS = 'M18 6 6 18M6 6l12 12';

interface Draft {
  testgroup: string;
  order: string;
  name: string;
  age: string;
  job: string;
  date: string;
  time: string;
  links: string[];
}
const LABEL: Record<keyof Draft, string> = { testgroup: 'Testgruppe', order: 'Reihenfolge', name: 'Name', age: 'Alter', job: 'Beruf', date: 'Datum', time: 'Testzeit', links: 'Testlink' };

export function PersonCard({ pid, meta, person, onFold }: { pid: string; meta?: NotesMeta; person?: Person; onFold?: () => void }) {
  const { study, model } = useCtx();
  const m: NotesMeta = meta ?? { id: pid, name: '', link: '', slot: '', group: '' };
  const row = model.survey.find((r) => r.person === pid);
  const surveyOf = (re: RegExp) => (row ? Object.entries(row.info).find(([k]) => re.test(k))?.[1] : undefined);
  const surveyAge = surveyOf(/^(alter|age)$/i) ?? surveyOf(/alter|age/i);
  const surveyJob = surveyOf(/beruf|occupation|job|tätigkeit/i);
  const slot = parseSlot(m.slot);
  const links = [m.link, ...(m.links ?? [])].filter((l) => l.trim());
  // a link the game knows: its label (P005.2); otherwise not found
  const tracked = (l: string) => {
    const k = linkKeyOf(l);
    return k ? (person?.links.find((x) => x.key === k)?.label ?? null) : null;
  };
  const current: Draft = {
    testgroup: testgroupOf(m),
    order: orderOf(m) ?? '',
    name: m.name ?? '',
    age: person?.doc.age != null ? String(person.doc.age) : '',
    job: person?.doc.job ?? '',
    date: slot.date ?? '',
    time: slot.time,
    links,
  };
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Draft>(current);
  const [more, setMoreState] = useState(readFold);
  const [copied, setCopied] = useState<number | null>(null);
  const [linkEdit, setLinkEdit] = useState<number | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const setMore = (v: boolean) => {
    setMoreState(v);
    try {
      localStorage.setItem(FOLD_KEY, v ? 'open' : 'closed');
    } catch {
      // (not remembered)
    }
  };
  const changed = (Object.keys(LABEL) as (keyof Draft)[]).filter((k) => (k === 'links' ? draft.links.map((l) => l.trim()).filter(Boolean).join('\n') !== current.links.join('\n') : draft[k].trim() !== current[k]));
  const isChanged = (k: keyof Draft) => (changed.includes(k) ? ' is-changed' : '');

  const open = () => {
    setDraft(current);
    setNewGroup(false);
    setLinkEdit(null);
    setEdit(true);
  };
  const cancel = () => {
    if (changed.length && !confirm(`${changed.length} ungespeicherte ${changed.length === 1 ? 'Änderung' : 'Änderungen'} verwerfen?`)) return;
    setEdit(false);
  };
  const saveIt = () => {
    if (!changed.length) return setEdit(false);
    const ls = draft.links.map((l) => l.trim()).filter(Boolean);
    const next: NotesMeta = {
      ...m,
      id: pid,
      name: draft.name.trim(),
      testgroup: draft.testgroup.trim() || undefined,
      // (an old group of players in the order field leaves it)
      group: draft.order,
      // (the slot is only rewritten when date or time changed)
      slot: changed.includes('date') || changed.includes('time') ? composeSlot(draft.time, draft.date || null) : m.slot,
      link: ls[0] ?? '',
      links: ls.slice(1),
    };
    const ops: Parameters<typeof study.commit>[0] = [{ coll: 'settings', id: 'notesMeta', data: { ...((study.latest().settings.notesMeta ?? {}) as Record<string, NotesMeta>), [pid]: next } }];
    if (person && (changed.includes('age') || changed.includes('job'))) {
      const age = draft.age.trim() === '' ? null : Number(draft.age);
      ops.push({ coll: 'people', id: pid, data: { ...person.doc, id: pid, age: Number.isFinite(age) ? age : null, job: draft.job.trim() || null } });
    }
    study.commit(ops);
    logChange(study, `${pid}: Profil bearbeitet (${changed.map((k) => LABEL[k]).join(', ')})`);
    setEdit(false);
  };
  // Esc: leave the edit (asks first when something changed)
  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cardRef.current?.contains(document.activeElement)) cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const copy = async (l: string, k: number) => {
    try {
      await navigator.clipboard.writeText(l);
      setCopied(k);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      // (no clipboard: the link stays selectable)
    }
  };

  const groups = [...new Set([...Object.values((study.docs.settings.notesMeta ?? {}) as Record<string, NotesMeta>).map(testgroupOf), draft.testgroup].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const trackedOrder = person?.trackedGroup ?? null;
  const shownOrder = current.order || person?.group || '';
  const date = current.date || isoOfMs(person?.date ?? null) || '';
  const age = person?.doc.age != null ? String(person.doc.age) : surveyAge;
  const job = person?.doc.job || surveyJob;
  const trackLine = person?.links.length ? `${person.links.map((x) => x.label).join(', ')} · zugeordnet` : links.some((l) => linkKeyOf(l)) ? 'nicht im Spiel gefunden' : 'kein Link';
  const val = (v: string | undefined | null, extra?: string) => (v ? <div className="st-pc-val">{v}{extra && <span className="st-pc-src">{` · ${extra}`}</span>}</div> : <div className="st-pc-val is-empty">nicht angegeben</div>);
  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const setLinks = (ls: string[]) => setDraft((d) => ({ ...d, links: ls }));
  const linkState = (l: string) => {
    if (!l.trim()) return null;
    const t = tracked(l);
    return t ? <span className="st-pc-pid">{t}</span> : linkKeyOf(l) ? <span className="st-pc-pid is-warn">nicht gefunden</span> : <span className="st-pc-pid is-warn">kein ?k=</span>;
  };
  const showMore = more || edit;

  return (
    <div ref={cardRef} className={`st-pcard${edit ? ' is-editing' : ''}`}>
      <div className="st-pc-top">
        <h2>{pid}</h2>
        {person?.excluded && <span className="st-flag">ausgeschlossen</span>}
        <span className="st-pc-gap" />
        {edit ? (
          <>
            <button type="button" className="st-pc-ghost" onClick={cancel}>
              Abbrechen
            </button>
            <button type="button" className="st-pc-done" disabled={!changed.length} onClick={saveIt}>
              <Icon d={CHECK} w={2.4} />
              Fertig
            </button>
          </>
        ) : (
          <button type="button" className="st-pc-icon" onClick={open} aria-label={`${pid}: Profil bearbeiten`} title="Bearbeiten">
            <Icon d={PEN} size={17} />
          </button>
        )}
        {onFold && !edit && (
          <button type="button" className="st-pc-icon" onClick={onFold} aria-expanded={true} aria-label={`${pid} einklappen`} title="Einklappen">
            <Icon d="m6 15 6-6 6 6" size={17} />
          </button>
        )}
      </div>

      <div className="st-pc-grid is-primary">
        <div>
          <div className="st-pc-lab">Testgruppe</div>
          {!edit ? (
            val(current.testgroup)
          ) : newGroup ? (
            <input className={`st-pc-ctl${isChanged('testgroup')}`} value={draft.testgroup} onChange={(e) => set('testgroup', e.target.value)} placeholder="z. B. Hobby Gamer" aria-label="Neue Testgruppe" autoFocus onBlur={() => setNewGroup(false)} />
          ) : (
            <select
              className={`st-pc-ctl${isChanged('testgroup')}`}
              value={draft.testgroup}
              aria-label="Testgruppe"
              onChange={(e) => {
                if (e.target.value === '\u0000new') {
                  set('testgroup', '');
                  setNewGroup(true);
                } else set('testgroup', e.target.value);
              }}
            >
              <option value="">–</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={'\u0000new'}>Neu …</option>
            </select>
          )}
        </div>
        <div>
          <div className="st-pc-lab">Reihenfolge</div>
          {edit ? (
            <select className={`st-pc-ctl${isChanged('order')}`} value={draft.order} onChange={(e) => set('order', e.target.value)} aria-label="Reihenfolge">
              <option value="">{person?.group ? `– (Tracking: ${person.group})` : '–'}</option>
              <option value="AB">AB</option>
              <option value="BA">BA</option>
            </select>
          ) : (
            <>
              {val(shownOrder, !current.order && person?.group ? 'Tracking' : undefined)}
              {current.order && trackedOrder && current.order !== trackedOrder && <span className="st-pc-hint">{`Tracking: ${trackedOrder}`}</span>}
            </>
          )}
        </div>
      </div>

      <div className="st-pc-div" />
      <button type="button" className={`st-pc-fold${showMore ? ' is-open' : ''}`} aria-expanded={showMore} onClick={() => !edit && setMore(!more)} disabled={edit}>
        Weitere Angaben
        <Icon d={CHEV} size={18} />
      </button>

      {showMore && (
        <div className="st-pc-more">
          <div className="st-pc-links">
            <div className="st-pc-lab">Testlink</div>
            {!edit ? (
              links.length ? (
                links.map((l, k) => (
                  <div key={k} className="st-pc-linkval">
                    <span className="st-pc-url" title={l} data-notr>
                      {links.length > 1 ? `${k + 1}: ` : ''}
                      {shortLink(l)}
                    </span>
                    <button type="button" className="st-pc-icon is-small" onClick={() => void copy(l, k)} aria-label={`Link ${k + 1} kopieren`} title={copied === k ? 'Kopiert' : 'Link kopieren'}>
                      <Icon d={copied === k ? CHECK : COPY} />
                    </button>
                    {linkState(l)}
                  </div>
                ))
              ) : (
                <div className="st-pc-val is-empty">kein Link</div>
              )
            ) : (
              <>
                {draft.links.map((l, k) => (
                  <div key={k} className="st-pc-linkrow">
                    <span className={`st-pc-field${draft.links[k] !== current.links[k] ? ' is-changed' : ''}`}>
                      {linkEdit === k || !l.trim() ? (
                        <input
                          value={l}
                          autoFocus={linkEdit === k}
                          onChange={(e) => setLinks(draft.links.map((x, j) => (j === k ? e.target.value : x)))}
                          onBlur={() => setLinkEdit(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setLinkEdit(null)}
                          placeholder="https://…/intro/1?k=…"
                          aria-label={`Link ${k + 1}`}
                        />
                      ) : (
                        <button type="button" className="st-pc-linktext" onClick={() => setLinkEdit(k)} title={`${l}\nKlicken: Link bearbeiten`} data-notr>
                          {l}
                        </button>
                      )}
                      {l.trim() && (
                        <a className="st-pc-icon is-small" href={l} target="_blank" rel="noreferrer" aria-label={`Link ${k + 1} öffnen`} title="In neuem Tab öffnen">
                          <Icon d={OPEN} size={14} />
                        </a>
                      )}
                      <button type="button" className="st-pc-icon is-small is-muted" onClick={() => setLinks(draft.links.filter((_, j) => j !== k))} aria-label={`Link ${k + 1} entfernen`} title="Link entfernen">
                        <Icon d={CROSS} />
                      </button>
                    </span>
                    {linkState(l)}
                  </div>
                ))}
                <button
                  type="button"
                  className="st-linkbtn st-pc-add"
                  onClick={() => {
                    setLinks([...draft.links, '']);
                    setLinkEdit(draft.links.length);
                  }}
                >
                  + Link
                </button>
              </>
            )}
          </div>
          <div className="st-pc-grid">
            <div>
              <div className="st-pc-lab">Name (nur hier sichtbar)</div>
              {edit ? <input className={`st-pc-ctl${isChanged('name')}`} value={draft.name} onChange={(e) => set('name', e.target.value)} aria-label="Name" data-notr /> : <div data-notr>{val(current.name)}</div>}
            </div>
            <div>
              <div className="st-pc-lab">Alter</div>
              {edit ? <input className={`st-pc-ctl${isChanged('age')}`} type="number" min={0} max={120} inputMode="numeric" value={draft.age} onChange={(e) => set('age', e.target.value)} placeholder={surveyAge ? `${surveyAge} (Umfrage)` : 'nicht angegeben'} aria-label="Alter" /> : val(age, person?.doc.age == null && surveyAge ? 'Umfrage' : undefined)}
            </div>
            <div>
              <div className="st-pc-lab">Beruf</div>
              {edit ? <input className={`st-pc-ctl${isChanged('job')}`} value={draft.job} onChange={(e) => set('job', e.target.value)} placeholder={surveyJob ? `${surveyJob} (Umfrage)` : 'nicht angegeben'} aria-label="Beruf" /> : <div data-notr>{val(job, !person?.doc.job && surveyJob ? 'Umfrage' : undefined)}</div>}
            </div>
            <div>
              <div className="st-pc-lab">Tracking</div>
              <div className={`st-pc-val${person?.links.length ? '' : ' is-empty'}`}>{trackLine}</div>
            </div>
            <div>
              <div className="st-pc-lab">Datum</div>
              {edit ? <input className={`st-pc-ctl${isChanged('date')}`} type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} aria-label="Datum" /> : val(fmtIsoDate(date || null), !current.date && date ? 'Tracking' : undefined)}
            </div>
            <div>
              <div className="st-pc-lab">Testzeit</div>
              {edit ? <input className={`st-pc-ctl${isChanged('time')}`} value={draft.time} onChange={(e) => set('time', e.target.value)} placeholder="18:00–19:30" aria-label="Testzeit" /> : val(current.time)}
            </div>
          </div>
          {edit && changed.length > 0 && (
            <div className="st-pc-unsaved" role="status">
              <span className="st-pc-dot" aria-hidden="true" />
              {`${changed.length} ungespeicherte ${changed.length === 1 ? 'Änderung' : 'Änderungen'}: ${changed.map((k) => LABEL[k]).join(', ')}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
