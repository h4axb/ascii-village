// A day's entry to read, as an activity log: the day on top with its icon,
// then each task on the timeline at its time, with its documentation blocks as
// cards in their category's colour; below, the day's check-in, the weekly
// review if one is added, and an older entry's own notes. The entry panel
// shows it with "Edit"; the new-entry drawer shows it as "Review entry".
import { useEffect, useRef } from 'react';
import { Markdown } from './markdown';
import type { JournalStore } from './store';
import { ENTRY_STATUS, ENTRY_TYPES, PALETTE, blockKinds, kindOf, blockTitle, fmtMinutes, shortDate, taskMinutes, tasksTotal, type Block, type BlockKind, type CheckinKey, type Day, type Entry, type Source, type Task, type Week } from './types';
import { sectionTitle } from './EntryEditor';
import { CheckinStrip, weekday, weekLabel } from './EntryForm';
import { FileThumb, Icon, type IconName } from './ui';
import { ZoteroSource } from './zotero';

export interface EditAt {
  task?: string;
  addTask?: boolean;
  checkin?: boolean;
}

export function EntryView({ store, e, ratings, week, focusTask, onEdit }: { store: JournalStore; e: Entry; ratings?: Partial<Record<CheckinKey, number>>; week?: { priorities: string; reflection: string } | null; focusTask?: string | null; onEdit?: (at: EditAt) => void }) {
  const tasks = e.tasks ?? [];
  const kinds = blockKinds(store.docs.settings);
  const day = store.docs.days[e.date] as Day | undefined;
  const r = ratings ?? day?.ratings ?? {};
  const wk = e.week ? (week ?? (store.docs.weeks[e.week] as Week | undefined)) : null;
  const st = ENTRY_STATUS.find((s) => s.id === e.status);
  const total = tasksTotal(tasks);
  const legacy = e.sections.length > 0 || e.topics.length > 0 || e.blocks.length > 0 || e.files.length > 0 || e.sources.length > 0;
  return (
    <div className="jr-view">
      <ol className="jr-act">
        <li className="jr-act-day">
          <span className="jr-act-time">
            {shortDate(e.date)}
            <small>{weekday(e.date)}</small>
          </span>
          <span className="jr-node" style={{ '--k': e.color ?? PALETTE[0] } as React.CSSProperties} aria-hidden="true">
            <Icon name={(e.icon ?? 'doc') as IconName} />
          </span>
          <div className="jr-act-body">
            <h2 className="jr-view-title">{e.title || <span className="jr-muted">Untitled</span>}</h2>
            <span className="jr-meta">
              {e.status !== 'none' && <span className={`jr-status is-${e.status}`}>{st?.label}</span>}
              {e.type !== 'log' && <span className="jr-type">{ENTRY_TYPES.find((t) => t.id === e.type)?.label}</span>}
              <span className="jr-muted jr-small">{[`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`, total ? `${fmtMinutes(total)} total` : ''].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
        </li>
        {tasks.map((t) => (
          <TaskItem key={t.id} store={store} t={t} kinds={kinds} focus={t.id === focusTask} onEdit={onEdit ? () => onEdit({ task: t.id }) : undefined} />
        ))}
        {onEdit && (
          <li className="jr-act-add">
            <span className="jr-act-time" />
            <span className="jr-act-dot is-add" aria-hidden="true" />
            <div className="jr-act-body">
              <button type="button" className="jr-linkbtn jr-dw-add" onClick={() => onEdit({ addTask: true })}>
                <Icon name="plus" /> Add task
              </button>
            </div>
          </li>
        )}
      </ol>

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
            <BlockCard key={b.id} b={b} kinds={kinds} />
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

// a documentation block: a card with its category's colour, title and text
export function BlockCard({ b, kinds }: { b: Block; kinds: BlockKind[] }) {
  const k = kindOf(kinds, b);
  const title = blockTitle(b);
  return (
    <div className="jr-bcard" style={{ '--k': k.color } as React.CSSProperties}>
      <span className="jr-bcard-kind">{k.label}</span>
      {title && <strong className="jr-bcard-title">{title}</strong>}
      <Markdown md={b.md} />
    </div>
  );
}

function Refs({ store, files, links }: { store: JournalStore; files: string[]; links: Source[] }) {
  if (!files.length && !links.length) return null;
  return (
    <div className="jr-vrefs">
      {files.length > 0 && (
        <div className="jr-files">
          {files.map((id) => (store.docs.files[id] ? <FileThumb key={id} meta={store.docs.files[id]} /> : null))}
        </div>
      )}
      {links.map((l, i) =>
        l.zotero ? (
          <ZoteroSource key={i} s={l} zotero={store.docs.zotero} />
        ) : (
          <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" className="jr-vlink">
            <Icon name="link" />
            {l.label || l.url}
          </a>
        ),
      )}
    </div>
  );
}

// a task on the timeline: its time on the left, its blocks as cards
function TaskItem({ store, t, kinds, focus, onEdit }: { store: JournalStore; t: Task; kinds: BlockKind[]; focus: boolean; onEdit?: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [focus]);
  const blocks = (t.blocks ?? []).filter((b) => b.md.trim());
  const m = taskMinutes(t);
  const first = blocks[0] ? kindOf(kinds, blocks[0]).color : undefined;
  return (
    <li ref={ref} className={`jr-act-task${focus ? ' is-focus' : ''}`}>
      <span className="jr-act-time">
        {t.start || t.end ? `${t.start || '?'}–${t.end || '?'}` : '–'}
        {m != null && <small>{fmtMinutes(m)}</small>}
      </span>
      <span className="jr-act-dot" style={first ? ({ '--k': first } as React.CSSProperties) : undefined} aria-hidden="true" />
      <div className="jr-act-body">
        <div className="jr-act-head">
          <strong>{t.title || <em className="jr-muted">Untitled task</em>}</strong>
          {onEdit && (
            <button type="button" className="jr-linkbtn jr-small jr-act-edit" onClick={onEdit} aria-label={`Edit task ${t.title}`}>
              <Icon name="edit" /> Edit
            </button>
          )}
        </div>
        {((t.sections ?? []).length > 0 || (t.topics ?? []).length > 0) && <Chipline store={store} sections={t.sections ?? []} topics={t.topics ?? []} />}
        {blocks.map((b) => (
          <BlockCard key={b.id} b={b} kinds={kinds} />
        ))}
        <Refs store={store} files={t.files ?? []} links={t.sources ?? []} />
        {onEdit && !blocks.length && (
          <button type="button" className="jr-linkbtn jr-small jr-dw-add" onClick={onEdit}>
            <Icon name="plus" /> Add block
          </button>
        )}
      </div>
    </li>
  );
}
