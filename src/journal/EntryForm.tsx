// One form for a day's entry, used to write a new one (the drawer) and to edit
// one (the entry panel's "Edit"): everything is changed in one session and
// stored with one "Save".
//
//   the day     title, date, status, optional type
//   tasks       each on its own: time, sections, tags, documentation blocks,
//               attachments & links (a section page shows only its tasks)
//   check-in    the day's four ratings, stored once per date (days/<date>)
//   weekly      an optional weekly review, added by hand, stored once per ISO
//               week (weeks/<2026-W45>) and linked from the entry
//   day notes   an older entry's own sections, tags and notes, kept as they were
import { useMemo, useState } from 'react';
import type { Del, JournalStore, Put } from './store';
import { suggestSections } from './suggest';
import { CHECKIN, ENTRY_ICONS, ENTRY_STATUS, ENTRY_TYPES, PALETTE, SECTIONS, blockKinds, kindOf, kindsSetting, type BlockKindsSetting, blockTitle, entryTopics, fmtMinutes, isoWeek, newId, shortDate, taskMinutes, tasksTotal, today, type Block, type BlockKind, type CheckinKey, type Day, type Entry, type Task, type Week } from './types';
import { allTopics, sectionTitle } from './EntryEditor';
import { Attachments, Chips, Icon, IconBtn, type IconName } from './ui';

export interface Form {
  entry: Entry;
  ratings: Partial<Record<CheckinKey, number>> | null; // null: the day's stored ratings, untouched
  week: { priorities: string; reflection: string } | null; // null: the linked week's stored text, untouched
  weekDrop: string | null; // a week this entry no longer links (its record goes if nothing else links it)
  open: string[]; // expanded tasks
  checkin: boolean; // the check-in's scales shown
}

export const blankTask = (section?: string): Task => ({ id: newId('t'), title: '', start: '', end: '', sections: section ? [section] : [], topics: [], blocks: [], files: [], sources: [] });
export function newEntryForm(section?: string, date?: string): Form {
  const now = Date.now();
  const t = blankTask(section);
  return {
    entry: { id: newId('e'), date: date || today(), dateEnd: null, title: '', type: 'log', status: 'none', sections: [], topics: [], blocks: [], sources: [], files: [], tasks: [t], week: null, visibility: 'private', created: now, updated: now },
    ratings: null,
    week: null,
    weekDrop: null,
    open: [t.id],
    checkin: true,
  };
}
export const formOf = (e: Entry, opts: { task?: string; addTask?: boolean; checkin?: boolean } = {}): Form => {
  const tasks = (e.tasks ?? []).map((t) => ({ sections: [], topics: [], blocks: [], files: [], sources: [], ...t }));
  const add = opts.addTask ? [blankTask()] : [];
  return { entry: { ...e, tasks: [...tasks, ...add] }, ratings: null, week: null, weekDrop: null, open: [...(opts.task ? [opts.task] : []), ...add.map((t) => t.id)], checkin: !!opts.checkin };
};

const taskEmpty = (t: Task) => !t.title.trim() && !t.start && !t.end && !(t.blocks ?? []).some((b) => b.md.trim()) && !(t.files ?? []).length && !(t.sources ?? []).length && !(t.topics ?? []).length;
export const formEmpty = (f: Form) => !f.entry.title.trim() && (f.entry.tasks ?? []).every(taskEmpty) && !f.ratings && !f.entry.week;

// the entry as stored: empty tasks and empty blocks left out
export function cleanEntry(f: Form): Entry {
  const e = f.entry;
  const tasks = (e.tasks ?? []).filter((t) => !taskEmpty(t)).map((t) => ({ ...t, title: t.title.trim(), blocks: (t.blocks ?? []).filter((b) => b.md.trim()).map((b) => ({ ...b, label: b.kind ? b.label.trim() : b.label.trim() || 'Notes' })) }));
  return { ...e, title: e.title.trim(), tasks, blocks: e.blocks.filter((b) => b.md.trim()), updated: Date.now() };
}
export function formChanges(store: JournalStore, f: Form): { put: Put[]; del: Del[]; entry: Entry } {
  const entry = cleanEntry(f);
  const now = Date.now();
  const put: Put[] = [{ coll: 'entries', id: entry.id, data: entry }];
  const del: Del[] = [];
  if (f.ratings) put.push({ coll: 'days', id: entry.date, data: { date: entry.date, ratings: f.ratings, updated: now } satisfies Day });
  if (entry.week && f.week) put.push({ coll: 'weeks', id: entry.week, data: { id: entry.week, priorities: f.week.priorities, reflection: f.week.reflection, updated: now } satisfies Week });
  const drop = f.weekDrop;
  if (drop && drop !== entry.week && store.docs.weeks[drop] && !Object.values(store.docs.entries).some((x) => x.id !== entry.id && x.week === drop)) del.push({ coll: 'weeks', id: drop });
  return { put, del, entry };
}

export const weekday = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }) : '');
export const longDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : iso);
// Monday of an ISO week (2026-W45 → 2026-11-02)
export function weekMonday(id: string): string {
  const [y, w] = [Number(id.slice(0, 4)), Number(id.slice(6))];
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
  return mon.toISOString().slice(0, 10);
}
const shiftDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekLabel = (id: string) => {
  const mon = weekMonday(id);
  const f = (x: string) => `${x.slice(8, 10)}.${x.slice(5, 7)}.`;
  return `Week ${Number(id.slice(6))} · ${f(mon)}–${f(shiftDays(mon, 6))}`;
};

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

export const taskTime = (t: Task) => {
  const m = taskMinutes(t);
  const range = t.start || t.end ? `${t.start || '?'}–${t.end || '?'}` : '';
  return [range, m != null ? fmtMinutes(m) : ''].filter(Boolean).join(' · ');
};

export function EntryForm({ store, f, set, titleErr, titleRef }: { store: JournalStore; f: Form; set: (fn: (f: Form) => Form) => void; titleErr?: boolean; titleRef?: React.Ref<HTMLInputElement> }) {
  const e = f.entry;
  const tasks = e.tasks ?? [];
  const setE = (p: Partial<Entry>) => set((x) => ({ ...x, entry: { ...x.entry, ...p } }));
  const setTask = (id: string, p: Partial<Task>) => set((x) => ({ ...x, entry: { ...x.entry, tasks: (x.entry.tasks ?? []).map((t) => (t.id === id ? { ...t, ...p } : t)) } }));
  const toggleOpen = (id: string) => set((x) => ({ ...x, open: x.open.includes(id) ? x.open.filter((o) => o !== id) : [...x.open, id] }));
  const total = tasksTotal(tasks);
  const day = store.docs.days[e.date] as Day | undefined;
  const ratings = f.ratings ?? day?.ratings ?? {};
  const weekRec = e.week ? (store.docs.weeks[e.week] as Week | undefined) : undefined;
  const week = f.week ?? { priorities: weekRec?.priorities ?? '', reflection: weekRec?.reflection ?? '' };
  const known = useMemo(() => [...new Set([...allTopics(store), ...entryTopics(e)])].sort((a, b) => a.localeCompare(b)), [store, e]);
  const legacy = e.sections.length > 0 || e.topics.length > 0 || e.blocks.length > 0 || e.files.length > 0 || e.sources.length > 0;

  // a tag renamed in every entry (stored at once) and in this form
  const renameTag = async (from: string, raw: string) => {
    const to = raw.trim().replace(/^#/, '');
    if (!to || to === from) return;
    const name = known.find((k) => k.toLowerCase() === to.toLowerCase() && k !== from) ?? to;
    const swap = (ts: string[] | undefined) => [...new Set((ts ?? []).map((t) => (t === from ? name : t)))];
    const hit = Object.values(store.docs.entries).filter((x) => x.id !== e.id && entryTopics(x).includes(from));
    if (!confirm(`Rename #${from} to #${name}${hit.length ? ` in ${hit.length} other ${hit.length === 1 ? 'entry' : 'entries'} (stored at once)` : ''} and in this one?`)) return;
    set((x) => ({ ...x, entry: { ...x.entry, topics: swap(x.entry.topics), tasks: (x.entry.tasks ?? []).map((t) => ({ ...t, topics: swap(t.topics) })) } }));
    if (hit.length)
      try {
        await store.commit(hit.map((x) => ({ coll: 'entries' as const, id: x.id, data: { ...x, topics: swap(x.topics), tasks: (x.tasks ?? []).map((t) => ({ ...t, topics: swap(t.topics) })), updated: Date.now() } })));
      } catch {
        /* reported by the store */
      }
  };

  // the weekly review moved to another week: this entry's own review (or text
  // typed here) goes with it, unless that week already has one; a review other
  // entries share stays where it is
  const setWeek = (id: string | null) => {
    if (id === e.week) return;
    const target = id ? (store.docs.weeks[id] as Week | undefined) : undefined;
    const targetText = !!(target && (target.priorities.trim() || target.reflection.trim()));
    const shared = !!e.week && Object.values(store.docs.entries).some((x) => x.id !== e.id && x.week === e.week);
    const carry = !!id && !targetText && (f.week != null || !shared) && !!(week.priorities.trim() || week.reflection.trim());
    set((x) => ({ ...x, entry: { ...x.entry, week: id }, week: carry ? week : null, weekDrop: x.entry.week && !shared && (carry || !targetText) ? x.entry.week : x.weekDrop }));
  };

  return (
    <div className="jr-eform">
      <div className="jr-titlerow">
        <NodePicker icon={e.icon} color={e.color} onChange={(icon, color) => setE({ icon, color })} />
        <label className="jr-field">
          <span>
            Title <span className="jr-req">*</span>
          </span>
          <input ref={titleRef} value={e.title} placeholder="e.g. Usertesting feedback tagging" aria-invalid={titleErr && !e.title.trim()} onChange={(x) => setE({ title: x.target.value })} />
          {titleErr && !e.title.trim() && <span className="jr-dw-err">A title is needed.</span>}
        </label>
      </div>

      <div className="jr-dw-row">
        <span className="jr-field">
          <span>Date</span>
          <label className="jr-dw-date">
            <Icon name="calendar" />
            <span>{shortDate(e.date)}</span>
            <span className="jr-muted">{weekday(e.date)}</span>
            <input type="date" value={e.date} aria-label="Date" required onClick={(x) => (x.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()} onChange={(x) => x.target.value && (setE({ date: x.target.value }), set((y) => ({ ...y, ratings: null })))} />
          </label>
        </span>
        <label className="jr-field">
          <span>Status</span>
          <select value={e.status} onChange={(x) => setE({ status: x.target.value as Entry['status'] })}>
            {ENTRY_STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="jr-field">
          <span>
            Type <span className="jr-muted jr-small">optional</span>
          </span>
          <select value={e.type} onChange={(x) => setE({ type: x.target.value as Entry['type'] })}>
            {ENTRY_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="jr-dw-sec" aria-labelledby="jr-f-tasks">
        <header className="jr-dw-sechead">
          <h3 id="jr-f-tasks">Tasks</h3>
          {total > 0 && <span className="jr-dw-total">{`${fmtMinutes(total)} total`}</span>}
        </header>
        <ul className="jr-tasks">
          {tasks.map((t, i) => (
            <TaskEdit
              key={t.id}
              store={store}
              t={t}
              n={i + 1}
              open={f.open.includes(t.id)}
              known={known}
              onToggle={() => toggleOpen(t.id)}
              onChange={(p) => setTask(t.id, p)}
              onRename={(a, b) => void renameTag(a, b)}
              onRemove={() => {
                if (!taskEmpty(t) && !confirm(`Remove the task “${t.title || `Task ${i + 1}`}” with its documentation?`)) return;
                set((x) => ({ ...x, entry: { ...x.entry, tasks: (x.entry.tasks ?? []).filter((y) => y.id !== t.id) } }));
              }}
            />
          ))}
        </ul>
        <button
          type="button"
          className="jr-linkbtn jr-dw-add"
          onClick={() => {
            const last = tasks[tasks.length - 1];
            const t = { ...blankTask(), start: last?.end ?? '' };
            set((x) => ({ ...x, entry: { ...x.entry, tasks: [...(x.entry.tasks ?? []), t] }, open: [...x.open, t.id] }));
          }}
        >
          <Icon name="plus" /> Add task
        </button>
      </section>

      <section className="jr-dw-sec" aria-labelledby="jr-f-check">
        <header className="jr-dw-sechead">
          <h3 id="jr-f-check">Daily check-in</h3>
          <button type="button" className="jr-linkbtn jr-small" aria-expanded={f.checkin} onClick={() => set((x) => ({ ...x, checkin: !x.checkin }))}>
            {f.checkin ? 'Done' : 'Edit'}
          </button>
        </header>
        {!f.checkin && <CheckinStrip ratings={ratings} />}
        {f.checkin && (
          <>
            <p className="jr-muted jr-small">{`1 = Low · 10 = Excellent. Stored once for ${shortDate(e.date)}, shared by every entry of this day.`}</p>
            <div className="jr-dw-scales">
              {CHECKIN.map((c) => (
                <div key={c.id} className="jr-dw-scale" role="radiogroup" aria-label={c.label}>
                  <span className="jr-dw-scale-label">
                    {c.label}
                    <strong>{ratings[c.id] ?? '–'}</strong>
                  </span>
                  <span className="jr-dw-scale-btns">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={ratings[c.id] === v}
                        aria-label={`${c.label} ${v}`}
                        className={`jr-dw-dot${ratings[c.id] === v ? ' is-on' : ''}${(ratings[c.id] ?? 0) >= v ? ' is-fill' : ''}`}
                        onClick={() => {
                          const r = { ...ratings };
                          if (r[c.id] === v) delete r[c.id];
                          else r[c.id] = v;
                          set((x) => ({ ...x, ratings: r }));
                        }}
                      >
                        {v}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {e.week ? (
        <section className="jr-dw-sec is-week" aria-labelledby="jr-f-week">
          <header className="jr-dw-sechead">
            <h3 id="jr-f-week">Weekly review</h3>
            <span className="jr-week-nav">
              <IconBtn icon="left" label="Previous week" onClick={() => setWeek(isoWeek(shiftDays(weekMonday(e.week!), -7)))} />
              <span className="jr-small">{weekLabel(e.week)}</span>
              <IconBtn icon="right" label="Next week" onClick={() => setWeek(isoWeek(shiftDays(weekMonday(e.week!), 7)))} />
            </span>
          </header>
          <p className="jr-muted jr-small">Stored once for the week; every entry it is added to shows the same review.</p>
          <label className="jr-field">
            <span>Weekly priorities</span>
            <textarea rows={3} value={week.priorities} placeholder="- Finish the evaluation …" onChange={(x) => set((y) => ({ ...y, week: { ...week, priorities: x.target.value } }))} />
          </label>
          <label className="jr-field">
            <span>Reflection</span>
            <textarea rows={3} value={week.reflection} placeholder="How did the week go?" onChange={(x) => set((y) => ({ ...y, week: { ...week, reflection: x.target.value } }))} />
          </label>
          <button
            type="button"
            className="jr-linkbtn jr-small jr-week-remove"
            onClick={() => {
              const others = Object.values(store.docs.entries).some((x) => x.id !== e.id && x.week === e.week);
              if ((week.priorities.trim() || week.reflection.trim()) && !confirm(others ? 'Remove the weekly review from this entry? It stays with the other entries of that week.' : 'Remove the weekly review? Its text is deleted with “Save” (the edit history keeps it).')) return;
              set((x) => ({ ...x, entry: { ...x.entry, week: null }, week: null, weekDrop: x.weekDrop ?? x.entry.week ?? null }));
            }}
          >
            Remove weekly review
          </button>
        </section>
      ) : (
        <button type="button" className="jr-addblock" onClick={() => setWeek(isoWeek(e.date))}>
          <Icon name="plus" /> Weekly Review
          <span className="jr-muted jr-small">optional · priorities and reflection for the week</span>
        </button>
      )}

      {legacy && <DayNotes store={store} e={e} known={known} onChange={setE} onRename={(a, b) => void renameTag(a, b)} />}
    </div>
  );
}

// the four ratings in one row
export function CheckinStrip({ ratings }: { ratings: Partial<Record<CheckinKey, number>> }) {
  return (
    <dl className="jr-checkstrip">
      {CHECKIN.map((c) => (
        <div key={c.id}>
          <dt>{c.short}</dt>
          <dd>{ratings[c.id] != null ? `${ratings[c.id]}/10` : '–'}</dd>
        </div>
      ))}
    </dl>
  );
}

function TaskEdit({ store, t, n, open, known, onToggle, onChange, onRemove, onRename }: { store: JournalStore; t: Task; n: number; open: boolean; known: string[]; onToggle: () => void; onChange: (p: Partial<Task>) => void; onRemove: () => void; onRename: (from: string, to: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'new' | 'manage' | null>(null);
  const [att, setAtt] = useState(() => !!((t.files ?? []).length || (t.sources ?? []).length));
  const sections = t.sections ?? [];
  const blocks = t.blocks ?? [];
  const sug = suggestSections({ title: t.title, blocks, type: 'log', sections });
  const setBlock = (id: string, p: Partial<Block>) => onChange({ blocks: blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const kinds = blockKinds(store.docs.settings);
  // a new block of a category; the category's section is added to the task once
  const addBlock = (k: BlockKind) => {
    const sec = k.section;
    onChange({ blocks: [...blocks, { id: newId('b'), kind: k.id, label: '', md: '' }], ...(sec && !sections.includes(sec) ? { sections: [...sections, sec] } : {}) });
    setAdding(false);
  };
  const time = taskTime(t);
  return (
    <li className={`jr-task${open ? ' is-open' : ''}`}>
      <button type="button" className="jr-task-head" aria-expanded={open} onClick={onToggle}>
        <Icon name="down" />
        <span className="jr-task-name">
          <strong>{t.title || `Task ${n}`}</strong>
          {time && !open && <small>{time}</small>}
        </span>
        {!open && (
          <span className="jr-task-chips">
            {sections.map((s) => (
              <span key={s} className="jr-tag is-section">
                {sectionTitle(store, s)}
              </span>
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="jr-task-body">
          <div className="jr-task-row">
            <input className="jr-dw-task-title" value={t.title} placeholder={`Task ${n}`} aria-label={`Task ${n} title`} onChange={(x) => onChange({ title: x.target.value })} />
            <span className="jr-dw-time">
              <TimeField value={t.start} label={`Task ${n} start`} onChange={(v) => onChange({ start: v })} />
              <span aria-hidden="true">–</span>
              <TimeField value={t.end} label={`Task ${n} end`} onChange={(v) => onChange({ end: v })} />
            </span>
            <span className="jr-dw-dur">{taskMinutes(t) != null ? fmtMinutes(taskMinutes(t)!) : '–'}</span>
          </div>

          <div className="jr-task-part">
            <span className="jr-task-label">{`Show in sections · ${sections.length} selected`}</span>
            <Chips all={SECTIONS.map((s) => ({ id: s.id, label: sectionTitle(store, s.id) }))} chosen={sections} suggested={sug} label={`Sections of task ${n}`} onToggle={(id) => onChange({ sections: sections.includes(id) ? sections.filter((s) => s !== id) : [...sections, id] })} />
          </div>

          <div className="jr-task-part">
            <TagEdit tags={t.topics ?? []} known={known} label={`task ${n}`} onChange={(topics) => onChange({ topics })} onRename={onRename} />
          </div>

          <div className="jr-task-part">
            <span className="jr-task-label">{`Documentation · ${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`}</span>
            {blocks.map((b) => (
              <BlockEdit key={b.id} store={store} b={b} onChange={(p) => setBlock(b.id, p)} onRemove={() => onChange({ blocks: blocks.filter((x) => x.id !== b.id) })} />
            ))}
            {adding && mode === 'new' ? (
              <NewKind store={store} onDone={(k) => (setMode(null), k ? addBlock(k) : undefined)} />
            ) : adding && mode === 'manage' ? (
              <KindManager store={store} onClose={() => setMode(null)} />
            ) : adding ? (
              <div className="jr-chips jr-addmenu" role="group" aria-label="Add a block">
                <span className="jr-muted jr-small">Category:</span>
                {kinds.map((k) => (
                  <button key={k.id} type="button" className="jr-chip is-small jr-kindchip" style={{ '--k': k.color } as React.CSSProperties} onClick={() => addBlock(k)}>
                    <span className="jr-kdot" aria-hidden="true" />
                    {k.label}
                  </button>
                ))}
                <button type="button" className="jr-chip is-small is-suggested" onClick={() => setMode('new')}>
                  <Icon name="plus" /> New category
                </button>
                <button type="button" className="jr-linkbtn jr-small" onClick={() => setMode('manage')}>
                  Manage
                </button>
                <button type="button" className="jr-linkbtn jr-small" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="jr-linkbtn jr-dw-add" onClick={() => setAdding(true)}>
                <Icon name="plus" /> Add block
              </button>
            )}
          </div>

          <div className="jr-task-part">
            <button type="button" className="jr-dw-toggle jr-small" aria-expanded={att} onClick={() => setAtt(!att)}>
              <Icon name="down" />
              <span>{`Attachments & links${(t.files ?? []).length + (t.sources ?? []).length ? ` (${(t.files ?? []).length + (t.sources ?? []).length})` : ''}`}</span>
            </button>
            {att && <Attachments store={store} files={t.files ?? []} links={t.sources ?? []} onChange={(files, sources) => onChange({ files, sources })} />}
          </div>

          <div className="jr-task-foot">
            <button type="button" className="jr-linkbtn jr-small" onClick={onRemove}>
              Remove task
            </button>
            <button type="button" className="jr-linkbtn jr-small" onClick={onToggle}>
              Collapse
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function TagEdit({ tags, known, label, onChange, onRename }: { tags: string[]; known: string[]; label: string; onChange: (t: string[]) => void; onRename: (from: string, to: string) => void }) {
  const [v, setV] = useState('');
  const [manage, setManage] = useState(false);
  const add = (raw: string) => {
    const x = raw.trim().replace(/^#/, '');
    if (x && !tags.some((t) => t.toLowerCase() === x.toLowerCase())) onChange([...tags, known.find((k) => k.toLowerCase() === x.toLowerCase()) ?? x]);
    setV('');
  };
  const reuse = known.filter((k) => !tags.includes(k)).slice(0, 6);
  return (
    <>
      <span className="jr-task-label">
        Tags
        <button type="button" className="jr-linkbtn jr-small" aria-expanded={manage} onClick={() => setManage(!manage)}>
          {manage ? 'Done' : 'Rename tags'}
        </button>
      </span>
      <div className="jr-chips">
        {tags.map((t) => (
          <span key={t} className="jr-chip is-on is-small">
            #{t}
            <button type="button" className="jr-chip-x" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="jr-chip-input"
          value={v}
          list="jr-f-taglist"
          placeholder="+ tag"
          aria-label={`Add a tag to ${label}`}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(v);
            }
          }}
          onBlur={() => v.trim() && add(v)}
        />
        <datalist id="jr-f-taglist">
          {known.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        {!manage &&
          reuse.map((k) => (
            <button key={k} type="button" className="jr-chip is-suggested is-small" onClick={() => add(k)} title="Reuse this tag">
              <Icon name="plus" />#{k}
            </button>
          ))}
      </div>
      {manage &&
        (known.length ? (
          <ul className="jr-dw-tagman" aria-label="Rename tags">
            {known.map((t) => (
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
                    const x = e.currentTarget.value;
                    if (x.trim() && x.trim() !== t) onRename(t, x);
                    else e.currentTarget.value = t;
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="jr-muted jr-small">No tags yet.</p>
        ))}
    </>
  );
}

// an older entry's own sections, tags and notes (before tasks had their own)
function DayNotes({ store, e, known, onChange, onRename }: { store: JournalStore; e: Entry; known: string[]; onChange: (p: Partial<Entry>) => void; onRename: (from: string, to: string) => void }) {
  return (
    <section className="jr-dw-sec" aria-labelledby="jr-f-day">
      <header className="jr-dw-sechead">
        <h3 id="jr-f-day">Notes for the whole day</h3>
      </header>
      <p className="jr-muted jr-small">Written before tasks had their own sections and documentation; kept as they were. New documentation goes into a task.</p>
      <div className="jr-task-part">
        <span className="jr-task-label">{`Sections of the whole entry · ${e.sections.length}`}</span>
        <Chips all={SECTIONS.map((s) => ({ id: s.id, label: sectionTitle(store, s.id) }))} chosen={e.sections} label="Sections of the whole entry" onToggle={(id) => onChange({ sections: e.sections.includes(id) ? e.sections.filter((s) => s !== id) : [...e.sections, id] })} />
      </div>
      <div className="jr-task-part">
        <TagEdit tags={e.topics} known={known} label="the whole entry" onChange={(topics) => onChange({ topics })} onRename={onRename} />
      </div>
      {e.blocks.map((b) => (
        <BlockEdit key={b.id} store={store} b={b} onChange={(p) => onChange({ blocks: e.blocks.map((y) => (y.id === b.id ? { ...y, ...p } : y)) })} onRemove={() => onChange({ blocks: e.blocks.filter((y) => y.id !== b.id) })} />
      ))}
      <Attachments store={store} files={e.files} links={e.sources} onChange={(files, sources) => onChange({ files, sources })} />
    </section>
  );
}

// the categories' settings (colours, names, own categories): stored at once, for the whole journal
async function saveKinds(store: JournalStore, patch: (s: BlockKindsSetting) => BlockKindsSetting) {
  try {
    await store.commit([{ coll: 'settings', id: 'blockKinds', data: patch(kindsSetting(store.docs.settings)) }]);
  } catch {
    /* reported by the store */
  }
}
export const setKindColor = (store: JournalStore, id: string, color: string) => saveKinds(store, (s) => ({ ...s, colors: { ...s.colors, [id]: color } }));
// how many blocks use a category (every entry, its tasks too)
const kindUses = (store: JournalStore, id: string) => Object.values(store.docs.entries).reduce((n, e) => n + [...e.blocks, ...(e.tasks ?? []).flatMap((t) => t.blocks ?? [])].filter((b) => b.kind === id).length, 0);

// a new category of one's own: name, colour, and the section a block of it adds to its task
function NewKind({ store, onDone }: { store: JournalStore; onDone: (k: BlockKind | null) => void }) {
  const kinds = blockKinds(store.docs.settings);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(PALETTE[(kinds.length + 3) % PALETTE.length]);
  const [section, setSection] = useState('');
  const dup = kinds.some((k) => k.label.toLowerCase() === label.trim().toLowerCase());
  const create = async () => {
    const k: BlockKind = { id: newId('k-'), label: label.trim(), color, ...(section ? { section } : {}) };
    await saveKinds(store, (s) => ({ ...s, custom: [...(s.custom ?? []), k] }));
    onDone(k);
  };
  return (
    <div className="jr-newkind" style={{ '--k': color } as React.CSSProperties}>
      <span className="jr-task-label">New category</span>
      <div className="jr-newkind-row">
        <span className="jr-kdot" aria-hidden="true" />
        <input
          value={label}
          autoFocus
          maxLength={40}
          placeholder="e.g. Usertest, Literature, Idea"
          aria-label="Name of the new category"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && label.trim() && !dup) void create();
            if (e.key === 'Escape') (e.stopPropagation(), onDone(null));
          }}
        />
      </div>
      <Swatches value={color} label="Colour of the new category" onPick={setColor} />
      <label className="jr-newkind-sec">
        <span className="jr-muted jr-small">Adds the task to</span>
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="">no section</option>
          {SECTIONS.map((x) => (
            <option key={x.id} value={x.id}>
              {sectionTitle(store, x.id)}
            </option>
          ))}
        </select>
      </label>
      {dup && <span className="jr-dw-err">A category with this name exists.</span>}
      <div className="jr-newkind-foot">
        <button type="button" className="jr-linkbtn jr-small" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="button" className="is-primary" disabled={!label.trim() || dup} onClick={() => void create()}>
          Create & add block
        </button>
      </div>
    </div>
  );
}

// every category: rename, recolour; one's own also re-section or delete
function KindManager({ store, onClose }: { store: JournalStore; onClose: () => void }) {
  const kinds = blockKinds(store.docs.settings);
  const [colorOf, setColorOf] = useState<string | null>(null);
  const rename = (k: BlockKind & { own?: boolean }, v: string) => {
    const name = v.trim();
    if (!name || name === k.label) return;
    void saveKinds(store, (s) => (k.own ? { ...s, custom: (s.custom ?? []).map((x) => (x.id === k.id ? { ...x, label: name } : x)) } : { ...s, labels: { ...s.labels, [k.id]: name } }));
  };
  const remove = (k: BlockKind) => {
    const n = kindUses(store, k.id);
    if (!confirm(n ? `Delete the category “${k.label}”? Its ${n} ${n === 1 ? 'block keeps its text and shows' : 'blocks keep their text and show'} as Notes.` : `Delete the category “${k.label}”?`)) return;
    void saveKinds(store, (s) => ({ ...s, custom: (s.custom ?? []).filter((x) => x.id !== k.id) }));
  };
  return (
    <div className="jr-kindman">
      <span className="jr-task-label">
        Categories
        <button type="button" className="jr-linkbtn jr-small" onClick={onClose}>
          Done
        </button>
      </span>
      <ul>
        {kinds.map((k) => (
          <li key={k.id} style={{ '--k': k.color } as React.CSSProperties}>
            <div className="jr-kindman-row">
              <button type="button" className="jr-kdot is-btn" aria-label={`Colour of ${k.label}`} aria-expanded={colorOf === k.id} onClick={() => setColorOf(colorOf === k.id ? null : k.id)} />
              <input defaultValue={k.label} aria-label={`Rename ${k.label}`} maxLength={40} onBlur={(e) => rename(k, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
              {k.own ? (
                <select value={k.section ?? ''} aria-label={`Section added by ${k.label}`} onChange={(e) => void saveKinds(store, (s) => ({ ...s, custom: (s.custom ?? []).map((x) => (x.id === k.id ? { ...x, section: e.target.value || undefined } : x)) }))}>
                  <option value="">no section</option>
                  {SECTIONS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {sectionTitle(store, x.id)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="jr-muted jr-small">{k.section ? sectionTitle(store, k.section) : 'built in'}</span>
              )}
              {k.own ? <IconBtn icon="trash" label={`Delete ${k.label}`} danger onClick={() => remove(k)} /> : <span />}
            </div>
            {colorOf === k.id && <Swatches value={k.color} label={`Colour of ${k.label}`} onPick={(c) => void setKindColor(store, k.id, c)} />}
          </li>
        ))}
      </ul>
      <span className="jr-muted jr-small">Changes apply to every block in the journal and are stored at once.</span>
    </div>
  );
}

function Swatches({ value, label, onPick }: { value: string; label: string; onPick: (c: string) => void }) {
  return (
    <span className="jr-swatches" role="radiogroup" aria-label={label}>
      {PALETTE.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={c} className={`jr-swatch${c === value ? ' is-on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} />
      ))}
    </span>
  );
}

// a block: its category (with the category's colour), an own title, free text
function BlockEdit({ store, b, onChange, onRemove }: { store: JournalStore; b: Block; onChange: (p: Partial<Block>) => void; onRemove: () => void }) {
  const kinds = blockKinds(store.docs.settings);
  const k = kindOf(kinds, b);
  const title = b.kind ? b.label : blockTitle(b);
  const [colors, setColors] = useState(false);
  return (
    <div className="jr-tblock" style={{ '--k': k.color } as React.CSSProperties}>
      <div className="jr-tblock-head">
        <span className="jr-kindsel">
          <button type="button" className="jr-kdot is-btn" aria-label={`Colour of ${k.label}`} aria-expanded={colors} title="Change the category's colour" onClick={() => setColors(!colors)} />
          <select value={k.id} aria-label="Category" onChange={(x) => onChange({ kind: x.target.value, label: title })}>
            {kinds.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </span>
        <input className="jr-tblock-label" value={title} placeholder="Title (optional)" aria-label={`${k.label} block title`} onChange={(x) => onChange({ kind: k.id, label: x.target.value })} />
        <IconBtn icon="x" label={`Remove ${title || k.label}`} onClick={() => (!b.md.trim() || confirm(`Remove the block “${title || k.label}”?`)) && onRemove()} />
      </div>
      {colors && (
        <div className="jr-colorpick">
          <Swatches value={k.color} label={`Colour of ${k.label}`} onPick={(c) => void setKindColor(store, k.id, c)} />
          <span className="jr-muted jr-small">{`For every ${k.label} block in the journal; stored at once.`}</span>
        </div>
      )}
      <textarea rows={Math.min(12, Math.max(3, b.md.split('\n').length + 1))} value={b.md} aria-label={`${k.label} text`} placeholder="Free text · Markdown: **bold**, - list, [link](https://…)" onChange={(x) => onChange({ md: x.target.value })} />
    </div>
  );
}

// the day's node in the timeline: an icon and its colour
function NodePicker({ icon, color, onChange }: { icon?: string; color?: string; onChange: (icon: string, color: string) => void }) {
  const [open, setOpen] = useState(false);
  const ic = (icon ?? 'doc') as IconName;
  const c = color ?? PALETTE[0];
  return (
    <span className="jr-nodepick">
      <button type="button" className="jr-node is-btn" style={{ '--k': c } as React.CSSProperties} aria-label="Icon and colour of the entry" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={ic} />
      </button>
      {open && (
        <span className="jr-nodepop" role="dialog" aria-label="Icon and colour">
          <span className="jr-icongrid" role="radiogroup" aria-label="Icon">
            {ENTRY_ICONS.map((x) => (
              <button key={x} type="button" role="radio" aria-checked={x === ic} aria-label={x} className={x === ic ? 'is-on' : ''} onClick={() => onChange(x, c)}>
                <Icon name={x as IconName} />
              </button>
            ))}
          </span>
          <Swatches value={c} label="Colour" onPick={(x) => onChange(ic, x)} />
          <button type="button" className="jr-linkbtn jr-small" onClick={() => setOpen(false)}>
            Done
          </button>
        </span>
      )}
    </span>
  );
}
