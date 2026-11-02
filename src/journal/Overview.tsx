// The Overview: a homepage kept by hand. Its sections (text, milestones,
// deadlines, attachments) can be renamed, reordered, hidden, deleted and added;
// milestones and deadlines are maintained here, never inferred.
import { useEffect, useState } from 'react';
import type { JournalStore, Put } from './store';
import { fmtDate, MILESTONE_STATUS, newId, REASON_MAX, type Deadline, type Milestone, type OverviewSection } from './types';
import { Attachments, Icon, IconBtn, InlineText, MdField, VisibilitySwitch } from './ui';
import { PageHead } from './pages';

export function Overview({ store, openEntry }: { store: JournalStore; openEntry: (id: string) => void }) {
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
    const s: OverviewSection = { id: newId('s'), kind: 'text', title: 'New section', md: '', hidden: false, order, visibility: 'private' };
    save(s);
  };
  return (
    <>
      <PageHead store={store} id="overview" fallbackTitle="Project Overview" fallbackDescription="ASCIIA BAY · Project Journal" />
      {shown.map((s, i) => (
        <section key={s.id} className="jr-card" aria-labelledby={`h-${s.id}`}>
          <header className="jr-card-head">
            <InlineText as="h2" value={s.title} label="Section title" onSave={(v) => save({ ...s, title: v || s.title })} />
            <span className="jr-card-tools">
              <VisibilitySwitch value={s.visibility} onChange={(v) => save({ ...s, visibility: v })} />
              <IconBtn icon="up" label="Move section up" disabled={i === 0} onClick={() => move(s, -1)} />
              <IconBtn icon="down" label="Move section down" disabled={i === shown.length - 1} onClick={() => move(s, 1)} />
              <IconBtn icon="eyeoff" label="Hide section" onClick={() => save({ ...s, hidden: true })} />
              <IconBtn
                icon="trash"
                label="Delete section"
                danger
                onClick={() => {
                  if (!confirm(`Delete the section “${s.title}”?${s.kind !== 'text' ? ' (The milestones/deadlines themselves stay stored.)' : ''}`)) return;
                  void store.commit([], [{ coll: 'overview', id: s.id }]);
                }}
              />
            </span>
          </header>
          {s.kind === 'text' && <MdField md={s.md} label="Text" placeholder="Nothing written yet – click Edit to add." onSave={(md) => save({ ...s, md })} />}
          {s.kind === 'milestones' && <Milestones store={store} openEntry={openEntry} />}
          {s.kind === 'deadlines' && <Deadlines store={store} />}
          {s.kind === 'attachments' && <Attachments store={store} files={s.files ?? []} links={s.links ?? []} onChange={(files, links) => save({ ...s, files, links })} />}
        </section>
      ))}
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
    </>
  );
}

const MONTH = (v: string) => (/^\d{4}-\d{2}(-\d{2})?$/.test(v) ? v : '');
function Milestones({ store, openEntry }: { store: JournalStore; openEntry: (id: string) => void }) {
  const list = Object.values(store.docs.milestones).sort((a, b) => a.order - b.order);
  const [open, setOpen] = useState<string | null>(null);
  const save = (m: Milestone) => void store.commit([{ coll: 'milestones', id: m.id, data: m }]);
  const move = (i: number, d: number) => {
    const a = list[i],
      b = list[i + d];
    if (!b) return;
    const put: Put[] = [
      { coll: 'milestones', id: a.id, data: { ...a, order: b.order } },
      { coll: 'milestones', id: b.id, data: { ...b, order: a.order } },
    ];
    void store.commit(put);
  };
  const entries = Object.values(store.docs.entries).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="jr-milestones">
      {list.map((m, i) => (
        <div key={m.id} className={`jr-ms is-${m.status}`}>
          <span className="jr-ms-dot" aria-hidden="true" />
          <div className="jr-ms-main">
            <InlineText as="h3" value={m.name} label="Milestone name" onSave={(v) => save({ ...m, name: v || m.name })} />
            <div className="jr-ms-line">
              <span className="jr-ms-dates">
                <input type="month" value={MONTH(m.start).slice(0, 7)} aria-label="Start month" onChange={(e) => save({ ...m, start: e.target.value })} />
                <span className="jr-muted">–</span>
                <input type="month" value={MONTH(m.end).slice(0, 7)} aria-label="End month (optional)" onChange={(e) => save({ ...m, end: e.target.value })} />
              </span>
              <select value={m.status} aria-label="Status" onChange={(e) => save({ ...m, status: e.target.value as Milestone['status'] })}>
                {MILESTONE_STATUS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {open === m.id ? (
              <div className="jr-ms-more">
                <MdField md={m.description} label="Description" placeholder="No description." rows={3} onSave={(description) => save({ ...m, description })} />
                <div className="jr-field is-wide">
                  <span>Related entries</span>
                  <div className="jr-chips">
                    {m.related.map((id) =>
                      store.docs.entries[id] ? (
                        <span key={id} className="jr-chip is-on">
                          <button type="button" className="jr-chip-link" onClick={() => openEntry(id)}>
                            {store.docs.entries[id].title}
                          </button>
                          <button type="button" className="jr-chip-x" aria-label="Remove relation" onClick={() => save({ ...m, related: m.related.filter((x) => x !== id) })}>
                            ×
                          </button>
                        </span>
                      ) : null,
                    )}
                    <select value="" aria-label="Relate an entry" onChange={(e) => e.target.value && save({ ...m, related: [...m.related, e.target.value] })}>
                      <option value="">+ relate entry</option>
                      {entries
                        .filter((x) => !m.related.includes(x.id))
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {`${x.date ? fmtDate(x.date) + ' · ' : ''}${x.title}`}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <VisibilitySwitch value={m.visibility} onChange={(v) => save({ ...m, visibility: v })} />
              </div>
            ) : (
              m.description.trim() && <p className="jr-muted jr-small jr-clamp">{m.description}</p>
            )}
          </div>
          <span className="jr-card-tools">
            <button type="button" className="jr-linkbtn" onClick={() => setOpen(open === m.id ? null : m.id)}>
              {open === m.id ? 'Less' : 'Details'}
            </button>
            <IconBtn icon="up" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconBtn icon="down" label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)} />
            <IconBtn icon="trash" label="Delete milestone" danger onClick={() => confirm(`Delete the milestone “${m.name}”?`) && void store.commit([], [{ coll: 'milestones', id: m.id }])} />
          </span>
        </div>
      ))}
      <button
        type="button"
        className="jr-linkbtn"
        onClick={() => {
          const m: Milestone = { id: newId('m'), name: 'New milestone', description: '', start: '', end: '', status: 'planned', order: Math.max(-1, ...list.map((x) => x.order)) + 1, related: [], visibility: 'private' };
          save(m);
          setOpen(m.id);
        }}
      >
        <Icon name="plus" /> Add milestone
      </button>
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
