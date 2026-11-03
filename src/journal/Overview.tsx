// The Overview: a homepage kept by hand, laid out as a calm dashboard. Its
// sections, in an order of your own: the four tiles (current phase, next
// deadline, milestones done, days left), the milestone timeline, recent
// decisions / method notes / personal focus, and any text, deadline or
// attachment sections. "Edit overview" shows the tools to rename, reorder,
// hide, delete and add sections; the content itself is edited in place.
import { useEffect, useState, type ReactNode } from 'react';
import { plainText } from './markdown';
import type { JournalStore } from './store';
import { fmtDate, sectionItems, MILESTONE_STATUS, newId, REASON_MAX, today, type Deadline, type FocusItem, type Milestone, type OverviewSection } from './types';
import { Attachments, Icon, IconBtn, InlineText, MdField, VisibilitySwitch } from './ui';
import { PageHead, pageConfig } from './pages';
import { blankMilestone, endOf, MilestoneDialog, MilestoneTimeline, startOf } from './MilestoneTimeline';

type IconName = Parameters<typeof Icon>[0]['name'];

export function Overview({ store, openEntry, newEntry, go }: { store: JournalStore; openEntry: (id: string, task?: string) => void; newEntry: (section?: string) => void; go: (path: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [ms, setMs] = useState<{ m: Milestone; isNew?: boolean } | null>(null);
  const secs = Object.values(store.docs.overview).sort((a, b) => a.order - b.order);
  const shown = secs.filter((s) => !s.hidden);
  const hidden = secs.filter((s) => s.hidden);
  const save = (s: OverviewSection) => void store.commit([{ coll: 'overview', id: s.id, data: s }]);
  const move = (s: OverviewSection, d: number) => {
    const i = shown.indexOf(s);
    const o = shown[i + d];
    if (!o) return;
    void store.commit([
      { coll: 'overview', id: s.id, data: { ...s, order: o.order } },
      { coll: 'overview', id: o.id, data: { ...o, order: s.order } },
    ]);
  };
  const add = () => {
    const order = Math.max(-1, ...secs.map((s) => s.order)) + 1;
    save({ id: newId('s'), kind: 'text', title: 'New section', md: '', hidden: false, order, visibility: 'private' });
  };
  const tools = (s: OverviewSection, i: number) =>
    editing && (
      <span className="jr-card-tools">
        <VisibilitySwitch value={s.visibility} onChange={(v) => save({ ...s, visibility: v })} />
        <IconBtn icon="up" label="Move section up" disabled={i === 0} onClick={() => move(s, -1)} />
        <IconBtn icon="down" label="Move section down" disabled={i === shown.length - 1} onClick={() => move(s, 1)} />
        <IconBtn icon="eyeoff" label="Hide section" onClick={() => save({ ...s, hidden: true })} />
        <IconBtn
          icon="trash"
          label="Delete section"
          danger
          onClick={() => confirm(`Delete the section “${s.title}”?${s.kind !== 'text' ? ' (Milestones, deadlines and entries themselves stay stored.)' : ''}`) && void store.commit([], [{ coll: 'overview', id: s.id }])}
        />
      </span>
    );
  const title = (s: OverviewSection, icon?: IconName, sub?: ReactNode) => (
    <div className="jr-card-title">
      {icon && (
        <span className="jr-card-icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
      )}
      <span>
        {editing ? <InlineText as="h2" value={s.title} label="Section title" onSave={(v) => save({ ...s, title: v || s.title })} /> : <h2>{s.title}</h2>}
        {sub}
      </span>
    </div>
  );
  return (
    <>
      <PageHead
        store={store}
        id="overview"
        fallbackTitle="Project Overview"
        fallbackDescription="ASCIIA BAY — Bachelor Project · Project Journal"
        actions={
          <>
            <button type="button" className={editing ? 'is-on' : ''} aria-pressed={editing} onClick={() => setEditing(!editing)}>
              <Icon name={editing ? 'check' : 'edit'} /> {editing ? 'Done' : 'Edit overview'}
            </button>
            <button type="button" className="is-primary" onClick={() => setMs({ m: blankMilestone(store), isNew: true })}>
              <Icon name="plus" /> Add milestone
            </button>
          </>
        }
      />
      {shown.map((s, i) =>
        s.kind === 'stats' ? (
          <section key={s.id} className="jr-statsec" aria-label={s.title}>
            {editing && (
              <header className="jr-card-head is-bare">
                {title(s)}
                {tools(s, i)}
              </header>
            )}
            <Stats store={store} sec={s} editing={editing} save={save} />
          </section>
        ) : s.kind === 'highlights' ? (
          <section key={s.id} className="jr-hlsec" aria-label={s.title}>
            {editing && (
              <header className="jr-card-head is-bare">
                {title(s)}
                {tools(s, i)}
              </header>
            )}
            <Highlights store={store} sec={s} save={save} openEntry={openEntry} newEntry={newEntry} go={go} />
          </section>
        ) : (
          <section key={s.id} className={`jr-card${s.kind === 'milestones' ? ' is-timeline' : ''}`}>
            <header className="jr-card-head">
              {title(s, s.kind === 'milestones' ? 'calendar' : s.kind === 'deadlines' ? 'flag' : undefined)}
              {tools(s, i)}
            </header>
            {s.kind === 'text' && <MdField md={s.md} label="Text" placeholder="Nothing written yet." onSave={(md) => save({ ...s, md })} />}
            {s.kind === 'milestones' && <MilestoneTimeline store={store} editing={editing} openMilestone={(m) => setMs({ m })} />}
            {s.kind === 'deadlines' && <Deadlines store={store} />}
            {s.kind === 'attachments' && <Attachments store={store} files={s.files ?? []} links={s.links ?? []} onChange={(files, links) => save({ ...s, files, links })} />}
          </section>
        ),
      )}
      {editing && (
        <div className="jr-addrow">
          <button type="button" onClick={add}>
            <Icon name="plus" /> Add section
          </button>
          {hidden.length > 0 && (
            <span className="jr-hiddenlist">
              <span className="jr-muted">Hidden:</span>
              {hidden.map((s) => (
                <button key={s.id} type="button" className="jr-chip" onClick={() => save({ ...s, hidden: false, order: Math.max(...secs.map((x) => x.order)) + 1 })} title="Show this section again">
                  <Icon name="eye" /> {s.title}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
      {!editing && hidden.length > 0 && <p className="jr-muted jr-small">{`${hidden.length} hidden ${hidden.length === 1 ? 'section' : 'sections'} – “Edit overview” to show ${hidden.length === 1 ? 'it' : 'them'}.`}</p>}
      {ms && <MilestoneDialog store={store} milestone={ms.m} isNew={ms.isNew} onClose={() => setMs(null)} openEntry={openEntry} />}
    </>
  );
}

// ---- the four tiles ----
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
function Stats({ store, sec, editing, save }: { store: JournalStore; sec: OverviewSection; editing: boolean; save: (s: OverviewSection) => void }) {
  const ms = Object.values(store.docs.milestones).sort((a, b) => a.order - b.order);
  const phaseSec = store.docs.overview.phase ?? Object.values(store.docs.overview).find((s) => s.kind === 'text' && /phase/i.test(s.title));
  const phaseText = phaseSec ? plainText(phaseSec.md).split(/(?<=[.!?])\s/)[0] : '';
  const running = ms.find((m) => m.status === 'in-progress');
  const phase = phaseText || running?.name || '';
  const phaseMs = ms.find((m) => m.name.toLowerCase() === phase.toLowerCase()) ?? (phaseText ? undefined : running);
  const savePhase = (v: string) => {
    const base: OverviewSection = phaseSec ?? { id: 'phase', kind: 'text', title: 'Current phase', md: '', hidden: true, order: 99, visibility: 'private' };
    void store.commit([{ coll: 'overview', id: base.id, data: { ...base, md: v } }]);
  };
  const dls = Object.values(store.docs.deadlines).filter((d) => !d.done).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  const next = dls[0];
  const done = ms.filter((m) => m.status === 'completed').length;
  const dated = ms.filter((m) => startOf(m.start));
  const last = [...dated].sort((a, b) => (endOf(b.end || b.start)!.getTime() - endOf(a.end || a.start)!.getTime()))[0];
  const target = (sec.target && store.docs.milestones[sec.target]) || last;
  const now = startOf(today())!;
  const days = target ? daysBetween(now, (target.end ? endOf(target.end) : startOf(target.start))!) : null;
  return (
    <div className="jr-stats">
      <div className="jr-stat">
        <span className="jr-stat-icon" aria-hidden="true">
          <Icon name="target" />
        </span>
        <div>
          <span className="jr-stat-label">Current phase</span>
          <InlineText as="h3" value={phase} placeholder="Set the phase" label="Current phase" onSave={savePhase} className="jr-stat-value" />
          {phaseMs && <span className={`jr-pill is-${phaseMs.status}`}>{MILESTONE_STATUS.find((s) => s.id === phaseMs.status)?.label}</span>}
        </div>
      </div>
      <div className="jr-stat">
        <span className="jr-stat-icon is-accent" aria-hidden="true">
          <Icon name="calendar" />
        </span>
        <div>
          <span className="jr-stat-label">Next deadline</span>
          <h3 className="jr-stat-value">{next ? next.label : <span className="jr-muted">None open</span>}</h3>
          {next?.date && <span className="jr-stat-sub">{fmtDate(next.date, next.dateEnd)}{next.changes?.length ? ` · moved ${next.changes.length}×` : ''}</span>}
        </div>
      </div>
      <div className="jr-stat">
        <span className="jr-stat-icon is-good" aria-hidden="true">
          <Icon name="check" />
        </span>
        <div>
          <span className="jr-stat-label">Completed milestones</span>
          <h3 className="jr-stat-value">{`${done} / ${ms.length}`}</h3>
          <span className="jr-progress" role="progressbar" aria-valuemin={0} aria-valuemax={ms.length} aria-valuenow={done} aria-label="Completed milestones">
            <span style={{ width: `${ms.length ? (done / ms.length) * 100 : 0}%` }} />
          </span>
        </div>
      </div>
      <div className="jr-stat">
        <span className="jr-stat-icon" aria-hidden="true">
          <Icon name="hourglass" />
        </span>
        <div>
          <span className="jr-stat-label">Days remaining</span>
          <h3 className="jr-stat-value">{days == null ? <span className="jr-muted">–</span> : days >= 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${-days} days ago`}</h3>
          {editing ? (
            <select className="jr-stat-target" value={target?.id ?? ''} aria-label="Count down to" onChange={(e) => save({ ...sec, target: e.target.value || null })}>
              {dated.map((m) => (
                <option key={m.id} value={m.id}>
                  {`until ${m.name}`}
                </option>
              ))}
            </select>
          ) : (
            target && <span className="jr-stat-sub">{`until ${target.name}`}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- recent decisions, method notes, personal focus ----
function Highlights({ store, sec, save, openEntry, newEntry, go }: { store: JournalStore; sec: OverviewSection; save: (s: OverviewSection) => void; openEntry: (id: string, task?: string) => void; newEntry: (section?: string) => void; go: (path: string) => void }) {
  // the newest tasks (and older whole entries) of a section
  const latest = (section: string) =>
    sectionItems(Object.values(store.docs.entries), section)
      .sort((a, b) => (b.e.date || '0').localeCompare(a.e.date || '0') || b.e.updated - a.e.updated || (b.t?.start ?? '').localeCompare(a.t?.start ?? ''))
      .slice(0, 3);
  const card = (section: string, label: string, icon: IconName, row: 'dot' | 'doc') => {
    const list = latest(section);
    const page = pageConfig(store, section);
    return (
      <div className="jr-hl">
        <header className="jr-hl-head">
          <span className="jr-card-icon" aria-hidden="true">
            <Icon name={icon} />
          </span>
          <h2>{label}</h2>
          <button type="button" className="jr-linkbtn jr-hl-add" onClick={() => newEntry(section)}>
            <Icon name="plus" /> Add
          </button>
        </header>
        {list.length ? (
          <ul className="jr-hl-list">
            {list.map(({ key, e, t }) => (
              <li key={key}>
                <button type="button" className="jr-hl-item" onClick={() => openEntry(e.id, t?.id)}>
                  {row === 'dot' ? <span className={`jr-hl-dot is-${e.status}`} aria-hidden="true" /> : <Icon name="clip" />}
                  <span className="jr-hl-title">{t ? t.title || e.title : e.title}</span>
                  <span className="jr-hl-date">{e.date ? fmtDate(e.date) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="jr-muted jr-small">{`Nothing in ${page.title} yet.`}</p>
        )}
        <a
          className="jr-hl-more"
          href={`/journal/${section}`}
          onClick={(e) => {
            e.preventDefault();
            go(`/journal/${section}`);
          }}
        >
          {`View all in ${page.title}`} <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  };
  return (
    <div className="jr-hls">
      {card('decisions', 'Recent decisions', 'flag', 'dot')}
      {card('methodology', 'Methods & methodology notes', 'layers', 'doc')}
      <Focus sec={sec} save={save} />
    </div>
  );
}

// the personal development focus: a short checklist, kept here
function Focus({ sec, save }: { sec: OverviewSection; save: (s: OverviewSection) => void }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState('');
  const items = sec.items ?? [];
  const put = (list: FocusItem[]) => save({ ...sec, items: list });
  const addItem = () => {
    if (!draft.trim()) return;
    put([...items, { id: newId('f'), text: draft.trim(), done: false }]);
    setDraft('');
  };
  return (
    <div className="jr-hl">
      <header className="jr-hl-head">
        <span className="jr-card-icon" aria-hidden="true">
          <Icon name="sprout" />
        </span>
        <h2>Personal development focus</h2>
        <button type="button" className="jr-linkbtn jr-hl-add" onClick={() => setEdit(!edit)}>
          <Icon name={edit ? 'check' : 'edit'} /> {edit ? 'Done' : 'Edit'}
        </button>
      </header>
      <ul className="jr-focus">
        {items.map((it, i) => (
          <li key={it.id} className={it.done ? 'is-done' : ''}>
            <input type="checkbox" checked={it.done} aria-label={it.text} onChange={(e) => put(items.map((x) => (x.id === it.id ? { ...x, done: e.target.checked } : x)))} />
            {edit ? <InlineText value={it.text} label="Focus" onSave={(v) => put(items.map((x) => (x.id === it.id ? { ...x, text: v || x.text } : x)))} /> : <span>{it.text}</span>}
            {edit && (
              <span className="jr-focus-tools">
                <IconBtn icon="up" label="Move up" disabled={i === 0} onClick={() => put(items.map((x, j) => (j === i - 1 ? it : j === i ? items[i - 1] : x)))} />
                <IconBtn icon="trash" label={`Remove ${it.text}`} danger onClick={() => put(items.filter((x) => x.id !== it.id))} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {!items.length && !edit && <p className="jr-muted jr-small">No focus points yet – “Edit” to add some.</p>}
      {edit && (
        <form
          className="jr-focus-add"
          onSubmit={(e) => {
            e.preventDefault();
            addItem();
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Plan design iterations more efficiently" aria-label="New focus point" />
          <button type="submit" disabled={!draft.trim()}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function Deadlines({ store }: { store: JournalStore }) {
  const list = Object.values(store.docs.deadlines).sort((a, b) => Number(a.done) - Number(b.done) || (a.done ? b.date.localeCompare(a.date) : (a.date || '9').localeCompare(b.date || '9')));
  const next = list.find((d) => !d.done);
  const save = (d: Deadline) => void store.commit([{ coll: 'deadlines', id: d.id, data: d }]);
  return (
    <div className="jr-deadlines">
      {next ? (
        <p className="jr-next">
          <span className="jr-muted">Next deadline</span>
          <strong>{next.label}</strong>
          {next.date && <span>{fmtDate(next.date, next.dateEnd)}</span>}
          {next.changes?.length ? <span className="jr-muted jr-small">{`moved ${next.changes.length}× · last: ${next.changes[next.changes.length - 1].reason || 'no reason given'}`}</span> : null}
        </p>
      ) : (
        <p className="jr-muted">No open deadline.</p>
      )}
      <ul>
        {list.map((d) => (
          <DeadlineRow key={d.id} d={d} save={save} remove={() => confirm(`Delete the deadline “${d.label}”?`) && void store.commit([], [{ coll: 'deadlines', id: d.id }])} />
        ))}
      </ul>
      <button type="button" className="jr-linkbtn" onClick={() => save({ id: newId('d'), label: 'New deadline', date: '', done: false })}>
        <Icon name="plus" /> Add deadline
      </button>
    </div>
  );
}

// one deadline; a new date for one that had a date asks why, in one short
// sentence, before it is stored (kept with the old and new date)
function DeadlineRow({ d, save, remove }: { d: Deadline; save: (d: Deadline) => void; remove: () => void }) {
  const [date, setDate] = useState(d.date);
  const [reason, setReason] = useState('');
  const [all, setAll] = useState(false);
  useEffect(() => setDate(d.date), [d.date]);
  const moving = !!d.date && !!date && date !== d.date;
  const commit = () => {
    const change = { at: Date.now(), from: d.date, to: date, reason: reason.trim().slice(0, REASON_MAX) };
    save({ ...d, date, changes: [...(d.changes ?? []), change] });
    setReason('');
  };
  const cancel = () => {
    setDate(d.date);
    setReason('');
  };
  const changes = d.changes ?? [];
  const shown = all ? [...changes].reverse() : changes.slice(-1);
  return (
    <li className={`jr-dl${d.done ? ' is-done' : ''}`}>
      <div className="jr-dl-row">
        <input type="checkbox" checked={d.done} aria-label={`${d.label} done`} onChange={(e) => save({ ...d, done: e.target.checked })} />
        <InlineText value={d.label} label="Deadline" onSave={(v) => save({ ...d, label: v || d.label })} className="jr-dl-label" />
        <input
          type="date"
          value={date}
          aria-label="Date"
          onChange={(e) => {
            const v = e.target.value;
            setDate(v);
            // a first date, or one cleared: nothing to explain
            if (!d.date || !v) save({ ...d, date: v });
          }}
        />
        <IconBtn icon="trash" label="Delete deadline" danger onClick={remove} />
      </div>
      {moving && (
        <form
          className="jr-dl-why"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <span className="jr-small">{`${fmtDate(d.date)} → ${fmtDate(date)}. Why did it move?`}</span>
          <input
            autoFocus
            value={reason}
            maxLength={REASON_MAX}
            placeholder="One short sentence, e.g. More time needed to code the interviews."
            aria-label="Why the deadline moved"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && cancel()}
          />
          <span className="jr-dl-why-actions">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="is-primary" disabled={!reason.trim()}>
              Save
            </button>
          </span>
        </form>
      )}
      {changes.length > 0 && !moving && (
        <ul className="jr-dl-changes">
          {shown.map((c) => (
            <li key={c.at}>
              <span className="jr-muted">{`${fmtDate(c.from)} → ${fmtDate(c.to)}`}</span>
              <span>{c.reason || <span className="jr-muted">no reason given</span>}</span>
              <span className="jr-muted jr-small">{new Date(c.at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</span>
            </li>
          ))}
          {changes.length > 1 && (
            <li>
              <button type="button" className="jr-linkbtn" onClick={() => setAll(!all)}>
                {all ? 'Show only the last change' : `All ${changes.length} changes`}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
