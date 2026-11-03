// A day's entry to read: the day (date, status), its tasks — collapsed to
// title, time and sections, opened with a click to their documentation — the
// day's check-in, the weekly review if one is added, and an older entry's own
// notes. The entry panel shows it with "Edit"; the new-entry drawer shows it
// as "Review entry" before storing.
import { useEffect, useRef, useState } from 'react';
import { Markdown } from './markdown';
import type { JournalStore } from './store';
import { ENTRY_STATUS, ENTRY_TYPES, fmtMinutes, tasksTotal, type CheckinKey, type Day, type Entry, type Task, type Week } from './types';
import { sectionTitle } from './EntryEditor';
import { CheckinStrip, longDate, taskTime, weekday, weekLabel } from './EntryForm';
import { FileThumb, Icon } from './ui';

type IconName = Parameters<typeof Icon>[0]['name'];
// a block's icon by its name (Context, Method / Approach …; own names get a note)
export function blockIcon(label: string): IconName {
  const l = label.toLowerCase();
  if (/context|kontext/.test(l)) return 'doc';
  if (/method|approach|methode|vorgehen/.test(l)) return 'flask';
  if (/decision|action|entscheid/.test(l)) return 'branch';
  if (/rationale|reason|begründ/.test(l)) return 'scale';
  if (/outcome|result|ergebnis/.test(l)) return 'target';
  if (/reflect|reflexion/.test(l)) return 'chat';
  return 'note';
}

export interface EditAt {
  task?: string;
  addTask?: boolean;
  checkin?: boolean;
}

export function EntryView({ store, e, ratings, week, focusTask, onEdit }: { store: JournalStore; e: Entry; ratings?: Partial<Record<CheckinKey, number>>; week?: { priorities: string; reflection: string } | null; focusTask?: string | null; onEdit?: (at: EditAt) => void }) {
  const tasks = e.tasks ?? [];
  const [open, setOpen] = useState<string[]>(() => (focusTask ? [focusTask] : tasks.length === 1 ? [tasks[0].id] : []));
  const day = store.docs.days[e.date] as Day | undefined;
  const r = ratings ?? day?.ratings ?? {};
  const wk = e.week ? (week ?? (store.docs.weeks[e.week] as Week | undefined)) : null;
  const st = ENTRY_STATUS.find((s) => s.id === e.status);
  const total = tasksTotal(tasks);
  const legacy = e.sections.length > 0 || e.topics.length > 0 || e.blocks.length > 0 || e.files.length > 0 || e.sources.length > 0;
  return (
    <div className="jr-view">
      <div className="jr-view-day">
        <span className="jr-muted jr-small">{`${longDate(e.date)} · ${weekday(e.date)}${e.type !== 'log' ? ` · ${ENTRY_TYPES.find((t) => t.id === e.type)?.label}` : ''}`}</span>
        <h2 className="jr-view-title">{e.title || <span className="jr-muted">Untitled</span>}</h2>
        {e.status !== 'none' && <span className={`jr-status is-${e.status}`}>{st?.label}</span>}
      </div>

      <section className="jr-view-sec" aria-label="Tasks">
        <header className="jr-dw-sechead">
          <h3>Tasks</h3>
          {total > 0 && <span className="jr-dw-total">{`${fmtMinutes(total)} total`}</span>}
        </header>
        {tasks.length ? (
          <ul className="jr-tasks">
            {tasks.map((t) => (
              <TaskView key={t.id} store={store} t={t} open={open.includes(t.id)} focus={t.id === focusTask} onToggle={() => setOpen((o) => (o.includes(t.id) ? o.filter((x) => x !== t.id) : [...o, t.id]))} onEdit={onEdit ? () => onEdit({ task: t.id }) : undefined} />
            ))}
          </ul>
        ) : (
          <p className="jr-muted jr-small">No tasks.</p>
        )}
        {onEdit && (
          <button type="button" className="jr-linkbtn jr-dw-add" onClick={() => onEdit({ addTask: true })}>
            <Icon name="plus" /> Add task
          </button>
        )}
      </section>

      <section className="jr-view-sec" aria-label="Daily check-in">
        <header className="jr-dw-sechead">
          <h3>Daily check-in</h3>
          {onEdit && (
            <button type="button" className="jr-linkbtn jr-small" aria-label="Edit daily check-in" onClick={() => onEdit({ checkin: true })}>
              Edit
            </button>
          )}
        </header>
        <CheckinStrip ratings={r} />
      </section>

      {wk && e.week && (
        <section className="jr-view-sec is-week" aria-label="Weekly review">
          <header className="jr-dw-sechead">
            <h3>Weekly review</h3>
            <span className="jr-muted jr-small">{weekLabel(e.week)}</span>
          </header>
          {wk.priorities.trim() && (
            <>
              <h5>Weekly priorities</h5>
              <Markdown md={wk.priorities} />
            </>
          )}
          {wk.reflection.trim() && (
            <>
              <h5>Reflection</h5>
              <Markdown md={wk.reflection} />
            </>
          )}
          {!wk.priorities.trim() && !wk.reflection.trim() && <p className="jr-muted jr-small">Empty.</p>}
        </section>
      )}

      {legacy && (
        <section className="jr-view-sec" aria-label="Notes for the whole day">
          <header className="jr-dw-sechead">
            <h3>Notes for the whole day</h3>
          </header>
          {(e.sections.length > 0 || e.topics.length > 0) && <Chipline store={store} sections={e.sections} topics={e.topics} />}
          {e.blocks.map((b) => (
            <Doc key={b.id} label={b.label} md={b.md} />
          ))}
          <Refs store={store} files={e.files} links={e.sources} />
        </section>
      )}
    </div>
  );
}

function Chipline({ store, sections, topics }: { store: JournalStore; sections: string[]; topics: string[] }) {
  return (
    <span className="jr-meta">
      {sections.map((s) => (
        <span key={s} className="jr-tag is-section">
          {sectionTitle(store, s)}
        </span>
      ))}
      {topics.map((t) => (
        <span key={t} className="jr-tag">
          #{t}
        </span>
      ))}
    </span>
  );
}

function Doc({ label, md }: { label: string; md: string }) {
  return (
    <div className="jr-vblock">
      <span className="jr-vblock-icon" aria-hidden="true">
        <Icon name={blockIcon(label)} />
      </span>
      <div>
        <h4>{label}</h4>
        <Markdown md={md} />
      </div>
    </div>
  );
}

function Refs({ store, files, links }: { store: JournalStore; files: string[]; links: { label: string; url: string }[] }) {
  if (!files.length && !links.length) return null;
  return (
    <div className="jr-vrefs">
      <h4>Attachments & links</h4>
      {files.length > 0 && (
        <div className="jr-files">
          {files.map((id) => (store.docs.files[id] ? <FileThumb key={id} meta={store.docs.files[id]} /> : null))}
        </div>
      )}
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" className="jr-vlink">
          <Icon name="link" />
          {l.label || l.url}
        </a>
      ))}
    </div>
  );
}

function TaskView({ store, t, open, focus, onToggle, onEdit }: { store: JournalStore; t: Task; open: boolean; focus: boolean; onToggle: () => void; onEdit?: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focus]);
  const time = taskTime(t);
  const blocks = (t.blocks ?? []).filter((b) => b.md.trim());
  const refs = (t.files ?? []).length + (t.sources ?? []).length;
  return (
    <li ref={ref} className={`jr-task${open ? ' is-open' : ''}${focus ? ' is-focus' : ''}`}>
      <button type="button" className="jr-task-head" aria-expanded={open} onClick={onToggle}>
        <Icon name="down" />
        <span className="jr-task-name">
          <strong>{t.title || <em className="jr-muted">Untitled task</em>}</strong>
          {time && <small>{time}</small>}
        </span>
        <span className="jr-task-chips">
          {(t.sections ?? []).map((s) => (
            <span key={s} className="jr-tag is-section">
              {sectionTitle(store, s)}
            </span>
          ))}
          {(t.topics ?? []).map((x) => (
            <span key={x} className="jr-tag">
              #{x}
            </span>
          ))}
          {!open && (blocks.length > 0 || refs > 0) && <span className="jr-muted jr-small">{[blocks.length ? `${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}` : '', refs ? `${refs} ${refs === 1 ? 'reference' : 'references'}` : ''].filter(Boolean).join(' · ')}</span>}
        </span>
      </button>
      {open && (
        <div className="jr-task-body">
          {blocks.map((b) => (
            <Doc key={b.id} label={b.label} md={b.md} />
          ))}
          <Refs store={store} files={t.files ?? []} links={t.sources ?? []} />
          {!blocks.length && !refs && <p className="jr-muted jr-small">No documentation yet.</p>}
          {onEdit && (
            <div className="jr-task-foot">
              <button type="button" className="jr-linkbtn jr-small" onClick={onEdit}>
                <Icon name="plus" /> Add block
              </button>
              <button type="button" className="jr-linkbtn jr-small" onClick={onEdit}>
                <Icon name="edit" /> Edit task
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
