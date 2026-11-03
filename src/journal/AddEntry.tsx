// "New entry" as a drawer from the right: it covers part of the Project Log,
// whose entry titles stay readable beside it. One form for the day's work:
//
//   title, date            the entry itself (an entries record)
//   tasks                  inside the entry, each with its own time range
//   daily check-in         stored once per date (days/<date>), shared by every
//                          entry of that day; never copied into an entry
//   tags                   the entry's topics; reused across the journal, renamed everywhere
//   weekly review          on Tuesdays: the week's own record (weeks/<2026-W45>)
//   sections               which journal pages show it; a filled documentation
//                          field adds its section (removable)
//   documentation          optional blocks: methods, decisions, reflections, results
//
// The form is kept as a draft in this browser while it is written (closing the
// drawer keeps it), and stored only with "Save entry" after "Review entry".
import { useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from './markdown';
import type { JournalStore, Put } from './store';
import { suggestSections } from './suggest';
import { CHECKIN, SECTIONS, fmtMinutes, isoWeek, isTuesday, newId, shortDate, taskMinutes, today, type CheckinKey, type Day, type Entry, type Task, type Week } from './types';
import { allTopics, sectionTitle } from './EntryEditor';
import { Chips, Icon, IconBtn } from './ui';

const DRAFT_KEY = 'asciia-journal-draft';

// the optional documentation: its block label in the entry and the section it adds
const DOCS: { id: DocKey; label: string; block: string; section: string; hint: string }[] = [
  { id: 'methods', label: 'Methods', block: 'Method / Approach', section: 'methodology', hint: 'How it was done: tools, test setup, procedure …' },
  { id: 'decisions', label: 'Decisions', block: 'Decision / Action', section: 'decisions', hint: 'What was decided, and why …' },
  { id: 'reflections', label: 'Reflections', block: 'Reflection', section: 'personal', hint: 'What went well, what I learned …' },
  { id: 'results', label: 'Results', block: 'Outcome', section: 'research', hint: 'Findings, outcomes, next steps …' },
];
type DocKey = 'methods' | 'decisions' | 'reflections' | 'results';

interface Form {
  id: string;
  title: string;
  date: string;
  tasks: Task[];
  ratings: Partial<Record<CheckinKey, number>> | null; // null: the day's stored ratings, untouched
  tags: string[];
  week: { priorities: string; reflection: string } | null; // null: the week's stored review, untouched
  sections: string[]; // chosen by hand
  off: string[]; // added by the documentation, then removed by hand
  docs: Record<DocKey, string>;
  docOpen: boolean;
  created: number;
}
interface Draft {
  form: Form;
  at: number;
}

const blankTask = (): Task => ({ id: newId('t'), title: '', start: '', end: '' });
export function blankForm(section?: string, date?: string): Form {
  return { id: newId('e'), title: '', date: date || today(), tasks: [blankTask()], ratings: null, tags: [], week: null, sections: section ? [section] : [], off: [], docs: { methods: '', decisions: '', reflections: '', results: '' }, docOpen: false, created: Date.now() };
}
const isEmpty = (f: Form) => !f.title.trim() && !f.tasks.some((t) => t.title.trim() || t.start || t.end) && !f.ratings && !f.tags.length && !f.week && !Object.values(f.docs).some((d) => d.trim());

export function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    return d?.form?.id ? d : null;
  } catch {
    return null;
  }
}
const writeDraft = (f: Form) => {
  try {
    if (isEmpty(f)) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ form: f, at: Date.now() } satisfies Draft));
    return true;
  } catch {
    return false;
  }
};
const dropDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing kept */
  }
};
const clock = (at: number) => new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const weekday = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }) : '');
// Monday–Sunday of an ISO week, for the weekly review's heading
function weekSpan(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const f = (x: Date) => `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.`;
  return `${f(mon)}–${f(sun)}`;
}

export function AddEntryDrawer({ store, section, onClose, onSaved }: { store: JournalStore; section?: string; onClose: (kept: boolean) => void; onSaved: (e: Entry) => void }) {
  const [restored] = useState(readDraft);
  const [f, setF] = useState<Form>(() => restored?.form ?? blankForm(section));
  const [showRestored, setShowRestored] = useState(!!restored);
  const [savedAt, setSavedAt] = useState<number | null>(restored?.at ?? null);
  const [storageOk, setStorageOk] = useState(true);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState(false);
  const [tag, setTag] = useState('');
  const [manage, setManage] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  // the draft, kept in this browser a moment after each change
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const ok = writeDraft(f);
      setStorageOk(ok);
      setSavedAt(ok && !isEmpty(f) ? Date.now() : null);
    }, 500);
    return () => clearTimeout(t);
  }, [f]);

  const close = useRef<() => void>(() => {});
  close.current = () => {
    const kept = !isEmpty(f) && writeDraft(f);
    onClose(kept);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);
  useEffect(() => {
    document.body.classList.add('jr-noscroll');
    if (!restored) titleRef.current?.focus();
    return () => document.body.classList.remove('jr-noscroll');
  }, [restored]);

  const day = store.docs.days[f.date] as Day | undefined;
  const ratings = f.ratings ?? day?.ratings ?? {};
  const tuesday = isTuesday(f.date);
  const weekId = isoWeek(f.date);
  const weekRec = store.docs.weeks[weekId] as Week | undefined;
  const week = f.week ?? { priorities: weekRec?.priorities ?? '', reflection: weekRec?.reflection ?? '' };
  const total = f.tasks.reduce((n, t) => n + (taskMinutes(t) ?? 0), 0);
  const known = allTopics(store);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of Object.values(store.docs.entries)) for (const t of e.topics) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [store.docs.entries]);
  // sections: chosen by hand, plus the ones a filled documentation field adds
  const auto = DOCS.filter((d) => f.docs[d.id].trim()).map((d) => d.section);
  const sections = [...new Set([...f.sections, ...auto.filter((s) => !f.off.includes(s))])];
  const entry = (): Entry => {
    const now = Date.now();
    const blocks = DOCS.filter((d) => f.docs[d.id].trim()).map((d) => ({ id: `${f.id}-${d.id}`, label: d.block, md: f.docs[d.id].trim() }));
    return { id: f.id, date: f.date, dateEnd: null, title: f.title.trim(), type: 'log', status: 'none', sections: SECTIONS.map((s) => s.id).filter((s) => sections.includes(s)), topics: f.tags, blocks, sources: [], files: [], tasks: f.tasks.filter((t) => t.title.trim() || t.start || t.end).map((t) => ({ ...t, title: t.title.trim() })), visibility: 'private', created: f.created, updated: now };
  };
  const suggested = suggestSections({ ...entry(), sections });
  const toggleSection = (id: string) => {
    if (sections.includes(id)) set({ sections: f.sections.filter((s) => s !== id), off: auto.includes(id) ? [...f.off, id] : f.off });
    else set({ sections: [...f.sections, id], off: f.off.filter((s) => s !== id) });
  };
  const setTask = (i: number, p: Partial<Task>) => set({ tasks: f.tasks.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const rate = (k: CheckinKey, v: number) => {
    const r = { ...ratings };
    if (r[k] === v) delete r[k];
    else r[k] = v;
    set({ ratings: r });
  };
  const addTag = (raw: string) => {
    const v = raw.trim().replace(/^#/, '');
    if (v && !f.tags.some((x) => x.toLowerCase() === v.toLowerCase())) set({ tags: [...f.tags, known.find((k) => k.toLowerCase() === v.toLowerCase()) ?? v] });
    setTag('');
  };
  const renameTag = async (from: string, raw: string) => {
    const to = raw.trim().replace(/^#/, '');
    if (!to || to === from) return;
    const hit = Object.values(store.docs.entries).filter((e) => e.topics.includes(from));
    const merge = known.find((k) => k.toLowerCase() === to.toLowerCase() && k !== from);
    const name = merge ?? to;
    if (hit.length && !confirm(`Rename #${from} to #${name} in ${hit.length} ${hit.length === 1 ? 'entry' : 'entries'}?${merge ? ` (#${merge} already exists – the two are merged.)` : ''}`)) return;
    set({ tags: [...new Set(f.tags.map((t) => (t === from ? name : t)))] });
    if (hit.length)
      try {
        await store.commit(hit.map((e) => ({ coll: 'entries' as const, id: e.id, data: { ...e, topics: [...new Set(e.topics.map((t) => (t === from ? name : t)))], updated: Date.now() } })));
      } catch {
        /* reported by the store */
      }
  };
  const review = () => {
    if (!f.title.trim()) {
      setTitleErr(true);
      titleRef.current?.focus();
      return;
    }
    setStep('review');
    bodyRef.current?.scrollTo(0, 0);
  };
  const save = async () => {
    const e = entry();
    const now = Date.now();
    const put: Put[] = [{ coll: 'entries', id: e.id, data: e }];
    if (f.ratings) put.push({ coll: 'days', id: f.date, data: { date: f.date, ratings: f.ratings, updated: now } satisfies Day });
    if (tuesday && f.week) put.push({ coll: 'weeks', id: weekId, data: { id: weekId, priorities: f.week.priorities, reflection: f.week.reflection, updated: now } satisfies Week });
    setBusy(true);
    setErr(null);
    try {
      await store.commit(put);
      dropDraft();
      onSaved(e);
    } catch (x) {
      setErr(`Not saved: ${String((x as Error).message)}. Your draft is still kept in this browser – try again.`);
      setBusy(false);
    }
  };

  const status = !storageOk ? 'Draft cannot be kept in this browser' : savedAt ? `Draft saved · ${clock(savedAt)}` : 'Not saved yet';

  return (
    <>
      <div className="jr-drawer-scrim" onClick={() => !busy && close.current()} />
      <aside className="jr-drawer" role="dialog" aria-modal="true" aria-labelledby="jr-dw-h">
        <header className="jr-drawer-head">
          <div>
            <h2 id="jr-dw-h">{step === 'review' ? 'Review entry' : 'New entry'}</h2>
            <span className={`jr-dw-status${savedAt ? ' is-saved' : ''}`} role="status">
              {savedAt && <Icon name="check" />}
              {status}
            </span>
          </div>
          <IconBtn icon="x" label="Close (the draft is kept)" onClick={() => !busy && close.current()} />
        </header>

        <div className="jr-drawer-body" ref={bodyRef}>
          {step === 'edit' ? (
            <>
              {showRestored && restored && (
                <p className="jr-dw-restored" role="status">
                  <Icon name="history" />
                  <span>{`Draft restored from ${shortDate(new Date(restored.at).toLocaleDateString('sv-SE'))}, ${clock(restored.at)}.`}</span>
                  <button
                    type="button"
                    className="jr-linkbtn"
                    onClick={() => {
                      if (!confirm('Discard this draft and start an empty entry?')) return;
                      dropDraft();
                      setF(blankForm(section));
                      setSavedAt(null);
                      setShowRestored(false);
                    }}
                  >
                    Discard draft
                  </button>
                </p>
              )}

              <label className="jr-field">
                <span>
                  Title <span className="jr-req">*</span>
                </span>
                <input
                  ref={titleRef}
                  value={f.title}
                  placeholder="e.g. Usertesting evaluation"
                  aria-invalid={titleErr && !f.title.trim()}
                  aria-describedby={titleErr && !f.title.trim() ? 'jr-dw-title-err' : undefined}
                  onChange={(e) => (set({ title: e.target.value }), setTitleErr(false))}
                />
                {titleErr && !f.title.trim() && (
                  <span id="jr-dw-title-err" className="jr-dw-err">
                    A title is needed.
                  </span>
                )}
              </label>

              <div className="jr-dw-row">
                <span className="jr-field">
                  <span>Date</span>
                  <label className="jr-dw-date">
                    <Icon name="calendar" />
                    <span>{shortDate(f.date)}</span>
                    <span className="jr-muted">{weekday(f.date)}</span>
                    <input type="date" value={f.date} aria-label="Date" required onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()} onChange={(e) => e.target.value && set({ date: e.target.value, ratings: null, week: null })} />
                  </label>
                </span>
                {tuesday && <span className="jr-dw-weektag">{`Tuesday · weekly review below`}</span>}
              </div>

              <section className="jr-dw-sec" aria-labelledby="jr-dw-tasks">
                <header className="jr-dw-sechead">
                  <h3 id="jr-dw-tasks">Tasks</h3>
                  {total > 0 && <span className="jr-dw-total">{`${fmtMinutes(total)} total`}</span>}
                </header>
                <ul className="jr-dw-tasks">
                  {f.tasks.map((t, i) => {
                    const m = taskMinutes(t);
                    return (
                      <li key={t.id} className="jr-dw-task">
                        <input className="jr-dw-task-title" value={t.title} placeholder={`Task ${i + 1}`} aria-label={`Task ${i + 1}`} onChange={(e) => setTask(i, { title: e.target.value })} />
                        <span className="jr-dw-time">
                          <TimeField value={t.start} label={`Task ${i + 1} start`} onChange={(v) => setTask(i, { start: v })} />
                          <span aria-hidden="true">–</span>
                          <TimeField value={t.end} label={`Task ${i + 1} end`} onChange={(v) => setTask(i, { end: v })} />
                        </span>
                        <span className="jr-dw-dur" aria-label="Duration">
                          {m != null ? fmtMinutes(m) : '–'}
                        </span>
                        <IconBtn icon="x" label={`Remove task ${i + 1}`} onClick={() => set({ tasks: f.tasks.length > 1 ? f.tasks.filter((_, j) => j !== i) : [blankTask()] })} />
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="jr-linkbtn jr-dw-add" onClick={() => set({ tasks: [...f.tasks, { ...blankTask(), start: f.tasks[f.tasks.length - 1]?.end ?? '' }] })}>
                  <Icon name="plus" /> Add task
                </button>
              </section>

              <section className="jr-dw-sec" aria-labelledby="jr-dw-check">
                <header className="jr-dw-sechead">
                  <h3 id="jr-dw-check">Daily check-in</h3>
                  <span className="jr-muted jr-small">1 = Low · 10 = Excellent</span>
                </header>
                {day && !f.ratings && <p className="jr-muted jr-small">{`Already rated for ${shortDate(f.date)} – shared by every entry of this day. A change updates the day.`}</p>}
                <div className="jr-dw-scales">
                  {CHECKIN.map((c) => (
                    <div key={c.id} className="jr-dw-scale" role="radiogroup" aria-label={c.label}>
                      <span className="jr-dw-scale-label">
                        {c.label}
                        <strong>{ratings[c.id] ?? '–'}</strong>
                      </span>
                      <span className="jr-dw-scale-btns">
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                          <button key={v} type="button" role="radio" aria-checked={ratings[c.id] === v} aria-label={`${c.label} ${v}`} className={`jr-dw-dot${ratings[c.id] === v ? ' is-on' : ''}${(ratings[c.id] ?? 0) >= v ? ' is-fill' : ''}`} onClick={() => rate(c.id, v)}>
                            {v}
                          </button>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="jr-dw-sec" aria-labelledby="jr-dw-tags">
                <header className="jr-dw-sechead">
                  <h3 id="jr-dw-tags">Tags</h3>
                  <button type="button" className="jr-linkbtn jr-small" aria-expanded={manage} onClick={() => setManage(!manage)}>
                    {manage ? 'Done' : 'Manage tags'}
                  </button>
                </header>
                <div className="jr-chips">
                  {f.tags.map((t) => (
                    <span key={t} className="jr-chip is-on">
                      #{t}
                      <button type="button" className="jr-chip-x" aria-label={`Remove tag ${t}`} onClick={() => set({ tags: f.tags.filter((x) => x !== t) })}>
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="jr-chip-input"
                    value={tag}
                    list="jr-dw-taglist"
                    placeholder="+ tag"
                    aria-label="Add a tag"
                    onChange={(e) => setTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag(tag);
                      }
                    }}
                    onBlur={() => tag.trim() && addTag(tag)}
                  />
                  <datalist id="jr-dw-taglist">
                    {known.filter((k) => !f.tags.includes(k)).map((k) => (
                      <option key={k} value={k} />
                    ))}
                  </datalist>
                </div>
                {!manage && known.filter((k) => !f.tags.includes(k)).length > 0 && (
                  <div className="jr-chips jr-dw-reuse" role="group" aria-label="Reuse a tag">
                    {known
                      .filter((k) => !f.tags.includes(k))
                      .slice(0, 8)
                      .map((k) => (
                        <button key={k} type="button" className="jr-chip is-suggested" onClick={() => addTag(k)}>
                          <Icon name="plus" />#{k}
                        </button>
                      ))}
                  </div>
                )}
                {manage && <TagManager tags={[...new Set([...known, ...f.tags])]} usage={usage} onRename={(a, b) => void renameTag(a, b)} />}
              </section>

              {tuesday && (
                <section className="jr-dw-sec is-week" aria-labelledby="jr-dw-week">
                  <header className="jr-dw-sechead">
                    <h3 id="jr-dw-week">Weekly review</h3>
                    <span className="jr-muted jr-small">{`Week ${Number(weekId.slice(6))} · ${weekSpan(f.date)}`}</span>
                  </header>
                  <p className="jr-muted jr-small">{weekRec ? 'The week’s review, kept once for the whole week. Changes here update it.' : 'Kept once for the whole week, linked to its record.'}</p>
                  <label className="jr-field">
                    <span>Weekly priorities</span>
                    <textarea rows={3} value={week.priorities} placeholder="- Finish the evaluation …" onChange={(e) => set({ week: { ...week, priorities: e.target.value } })} />
                  </label>
                  <label className="jr-field">
                    <span>Reflection</span>
                    <textarea rows={3} value={week.reflection} placeholder="How did last week go?" onChange={(e) => set({ week: { ...week, reflection: e.target.value } })} />
                  </label>
                </section>
              )}

              <section className="jr-dw-sec" aria-labelledby="jr-dw-secs">
                <header className="jr-dw-sechead">
                  <h3 id="jr-dw-secs">Show in sections</h3>
                  <span className="jr-muted jr-small">{`${sections.length} selected`}</span>
                </header>
                <Chips all={SECTIONS.map((s) => ({ id: s.id, label: sectionTitle(store, s.id) }))} chosen={sections} suggested={suggested} label="Sections" onToggle={toggleSection} />
                <p className="jr-muted jr-small">Always in the Project Log and the Timeline. A filled documentation field adds its section.</p>
              </section>

              <section className={`jr-dw-sec jr-dw-docs${f.docOpen ? ' is-open' : ''}`}>
                <button type="button" className="jr-dw-toggle" aria-expanded={f.docOpen} onClick={() => set({ docOpen: !f.docOpen })}>
                  <Icon name="down" />
                  <span>Detailed documentation</span>
                  <span className="jr-muted jr-small">Optional</span>
                  {!f.docOpen && auto.length > 0 && <span className="jr-dw-count">{`${auto.length} filled`}</span>}
                </button>
                {f.docOpen &&
                  DOCS.map((d) => (
                    <label key={d.id} className="jr-field">
                      <span>
                        {d.label}
                        <span className="jr-muted jr-small">{` → ${sectionTitle(store, d.section)}`}</span>
                      </span>
                      <textarea rows={3} value={f.docs[d.id]} placeholder={d.hint} onChange={(e) => set({ docs: { ...f.docs, [d.id]: e.target.value } })} />
                    </label>
                  ))}
                {f.docOpen && <p className="jr-muted jr-small">Markdown: **bold**, - list, [ ] / [x], [link](https://…)</p>}
              </section>
            </>
          ) : (
            <Review store={store} e={entry()} ratings={ratings} ratingsShared={!f.ratings && !!day} week={tuesday && (f.week || weekRec) ? { id: weekId, span: weekSpan(f.date), ...week } : null} total={total} />
          )}
        </div>

        <footer className="jr-drawer-foot">
          {err && (
            <p className="jr-dw-err" role="alert">
              {err}
            </p>
          )}
          {step === 'edit' ? (
            <>
              <button type="button" onClick={() => close.current()}>
                Close
              </button>
              <span className="jr-spacer" />
              <button type="button" className="is-primary" onClick={review}>
                Review entry
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => setStep('edit')}>
                Back to edit
              </button>
              <span className="jr-spacer" />
              <button type="button" className="is-primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving …' : 'Save entry'}
              </button>
            </>
          )}
        </footer>
      </aside>
    </>
  );
}

// a time as 24h HH:MM: typed freely ("930", "9.30", "9"), written out on leaving
export function normTime(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  let h: number, m: number;
  const sep = v.match(/^(\d{1,2})\s*[:.h ]\s*(\d{1,2})$/);
  if (sep) [h, m] = [Number(sep[1]), Number(sep[2])];
  else if (/^\d{1,4}$/.test(v)) [h, m] = v.length <= 2 ? [Number(v), 0] : [Number(v.slice(0, -2)), Number(v.slice(-2))];
  else return raw;
  if (h > 24 || m > 59 || (h === 24 && m)) return raw;
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function TimeField({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const bad = !!value && !/^\d{2}:\d{2}$/.test(value);
  return <input className="jr-dw-timein" value={value} inputMode="numeric" placeholder="--:--" maxLength={5} aria-label={label} aria-invalid={bad} title={bad ? 'A time like 09:30' : undefined} onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(normTime(e.target.value))} />;
}

function TagManager({ tags, usage, onRename }: { tags: string[]; usage: Map<string, number>; onRename: (from: string, to: string) => void }) {
  if (!tags.length) return <p className="jr-muted jr-small">No tags yet. Type one above and press Enter.</p>;
  return (
    <ul className="jr-dw-tagman" aria-label="Rename tags">
      {tags.sort((a, b) => a.localeCompare(b)).map((t) => (
        <li key={t}>
          <span className="jr-muted">#</span>
          <input
            defaultValue={t}
            aria-label={`Rename tag ${t}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.stopPropagation();
                e.currentTarget.value = t;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value;
              if (v.trim() && v.trim() !== t) onRename(t, v);
              else e.currentTarget.value = t;
            }}
          />
          <span className="jr-muted jr-small">{`${usage.get(t) ?? 0} ${usage.get(t) === 1 ? 'entry' : 'entries'}`}</span>
        </li>
      ))}
    </ul>
  );
}

// the entry as it will be stored, before "Save entry"
function Review({ store, e, ratings, ratingsShared, week, total }: { store: JournalStore; e: Entry; ratings: Partial<Record<CheckinKey, number>>; ratingsShared: boolean; week: { id: string; span: string; priorities: string; reflection: string } | null; total: number }) {
  const rated = CHECKIN.filter((c) => ratings[c.id] != null);
  return (
    <div className="jr-dw-review">
      <div>
        <span className="jr-muted jr-small">{`${shortDate(e.date)} · ${weekday(e.date)}`}</span>
        <h3 className="jr-dw-review-title">{e.title}</h3>
        <div className="jr-meta">
          {e.sections.map((s) => (
            <span key={s} className="jr-tag is-section">
              {sectionTitle(store, s)}
            </span>
          ))}
          {e.topics.map((t) => (
            <span key={t} className="jr-tag">
              #{t}
            </span>
          ))}
          {!e.sections.length && !e.topics.length && <span className="jr-muted jr-small">Project Log only · no tags</span>}
        </div>
      </div>
      {!!e.tasks?.length && (
        <section>
          <h4>{`Tasks · ${fmtMinutes(total)} total`}</h4>
          <ul className="jr-dw-rtasks">
            {e.tasks.map((t) => {
              const m = taskMinutes(t);
              return (
                <li key={t.id}>
                  <span>{t.title || <em className="jr-muted">untitled</em>}</span>
                  <span className="jr-muted">{t.start || t.end ? `${t.start || '?'}–${t.end || '?'}` : ''}</span>
                  <strong>{m != null ? fmtMinutes(m) : '–'}</strong>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {rated.length > 0 && (
        <section>
          <h4>{`Daily check-in · ${shortDate(e.date)}${ratingsShared ? ' (already stored for this day)' : ''}`}</h4>
          <ul className="jr-dw-rchecks">
            {rated.map((c) => (
              <li key={c.id}>
                <span>{c.label}</span>
                <strong>{`${ratings[c.id]}/10`}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {week && (week.priorities.trim() || week.reflection.trim()) && (
        <section>
          <h4>{`Weekly review · week ${Number(week.id.slice(6))} · ${week.span}`}</h4>
          {week.priorities.trim() && (
            <>
              <h5>Weekly priorities</h5>
              <Markdown md={week.priorities} />
            </>
          )}
          {week.reflection.trim() && (
            <>
              <h5>Reflection</h5>
              <Markdown md={week.reflection} />
            </>
          )}
        </section>
      )}
      {e.blocks.map((b) => (
        <section key={b.id}>
          <h4>{DOCS.find((d) => d.block === b.label)?.label ?? b.label}</h4>
          <Markdown md={b.md} />
        </section>
      ))}
      <p className="jr-muted jr-small">Nothing is stored until “Save entry”. Type and status can be set afterwards in the entry.</p>
    </div>
  );
}

// in the entry panel: the entry's tasks, the day's check-in and (on Tuesdays)
// the week's review — the last two read from their own records
export function DayFacts({ store, e }: { store: JournalStore; e: Entry }) {
  const tasks = e.tasks ?? [];
  const day = store.docs.days[e.date] as Day | undefined;
  const rated = CHECKIN.filter((c) => day?.ratings[c.id] != null);
  const week = isTuesday(e.date) ? (store.docs.weeks[isoWeek(e.date)] as Week | undefined) : undefined;
  if (!tasks.length && !rated.length && !week) return null;
  const total = tasks.reduce((n, t) => n + (taskMinutes(t) ?? 0), 0);
  return (
    <div className="jr-dayfacts">
      {tasks.length > 0 && (
        <section>
          <h4>
            Tasks<span className="jr-muted">{total ? ` · ${fmtMinutes(total)} total` : ''}</span>
          </h4>
          <ul className="jr-dw-rtasks">
            {tasks.map((t) => {
              const m = taskMinutes(t);
              return (
                <li key={t.id}>
                  <span>{t.title || <em className="jr-muted">untitled</em>}</span>
                  <span className="jr-muted">{t.start || t.end ? `${t.start || '?'}–${t.end || '?'}` : ''}</span>
                  <strong>{m != null ? fmtMinutes(m) : '–'}</strong>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {rated.length > 0 && (
        <section>
          <h4>
            Daily check-in<span className="jr-muted">{` · ${shortDate(e.date)}`}</span>
          </h4>
          <ul className="jr-dw-rchecks">
            {rated.map((c) => (
              <li key={c.id}>
                <span>{c.label}</span>
                <strong>{`${day!.ratings[c.id]}/10`}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {week && (week.priorities.trim() || week.reflection.trim()) && (
        <section>
          <h4>
            Weekly review<span className="jr-muted">{` · week ${Number(week.id.slice(6))}`}</span>
          </h4>
          {week.priorities.trim() && (
            <>
              <h5>Weekly priorities</h5>
              <Markdown md={week.priorities} />
            </>
          )}
          {week.reflection.trim() && (
            <>
              <h5>Reflection</h5>
              <Markdown md={week.reflection} />
            </>
          )}
        </section>
      )}
    </div>
  );
}
