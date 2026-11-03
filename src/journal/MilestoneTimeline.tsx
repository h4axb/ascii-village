// The Overview's milestone timeline: one row per milestone, a bar from its
// start to its end (a single date is a diamond), the open deadlines in a row of
// their own, and a line for today. Everything shown is kept by hand: a click on
// a milestone opens it for editing. On narrow screens only the time axis
// scrolls sideways; the names stay in place.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JournalStore, Put } from './store';
import { fmtDate, MILESTONE_STATUS, newId, today, type Milestone } from './types';
import { Icon, IconBtn, MdEditor, Modal, VisibilitySwitch } from './ui';

// "2026-10" (a month) or "2026-10-05"; a month's end is its last day
const DAY = 86_400_000;
export function startOf(v: string): Date | null {
  if (/^\d{4}-\d{2}$/.test(v)) return new Date(`${v}-01T12:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00Z`);
  return null;
}
export function endOf(v: string): Date | null {
  if (/^\d{4}-\d{2}$/.test(v)) {
    const d = new Date(`${v}-01T12:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
  }
  return startOf(v);
}
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZOOM = [28, 40, 56, 80, 112, 160]; // px per month
const isoDate = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? `${v}-01` : v);
// a compact period: "05.01. – 15.02.2026", across years "01.10.26 – 10.01.27"
export function period(start: string, end: string): string {
  const a = startOf(start);
  if (!a) return '–';
  const b = end ? endOf(end) : null;
  const dm = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.`;
  const y = (d: Date, short = false) => String(d.getUTCFullYear()).slice(short ? 2 : 0);
  if (!b || b.getTime() === a.getTime()) return `${dm(a)}${y(a)}`;
  return a.getUTCFullYear() === b.getUTCFullYear() ? `${dm(a)} – ${dm(b)}${y(b)}` : `${dm(a)}${y(a, true)} – ${dm(b)}${y(b, true)}`;
}

export function MilestoneTimeline({ store, editing, openMilestone }: { store: JournalStore; editing: boolean; openMilestone: (m: Milestone) => void }) {
  const list = Object.values(store.docs.milestones).sort((a, b) => a.order - b.order);
  const deadlines = Object.values(store.docs.deadlines).filter((d) => d.date);
  const now = startOf(today())!;
  const scroll = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit to the card

  // the range: first to last date (and today), whole months, two to spare at the end
  const range = useMemo(() => {
    const ds = [now, ...list.flatMap((m) => [startOf(m.start), endOf(m.end)]), ...deadlines.map((d) => startOf(d.date))].filter((x): x is Date => !!x);
    const a = Math.min(...ds.map(monthIndex));
    const b = Math.max(...ds.map(monthIndex)) + 2; // room for the last labels
    return { first: a, months: b - a + 1 };
  }, [list, deadlines, now]);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // narrow cards: the period below the name instead of a column of its own
  const compact = width < 820;
  const labelW = width < 560 ? 148 : compact ? 200 : 320;
  const fit = Math.max(ZOOM[0], Math.floor((width - labelW) / range.months));
  const mw = zoom == null ? fit : ZOOM[zoom];
  const x = (d: Date) => {
    const m = monthIndex(d) - range.first;
    const inMonth = (d.getUTCDate() - 1) / new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return (m + inMonth) * mw;
  };
  const track = range.months * mw;
  const todayX = x(now);
  const label = (i: number) => {
    const m = (range.first + i) % 12;
    return { m, y: Math.floor((range.first + i) / 12) };
  };
  const zoomStep = (d: number) => {
    const cur = zoom ?? ZOOM.findIndex((z) => z >= fit);
    setZoom(Math.min(ZOOM.length - 1, Math.max(0, (cur < 0 ? ZOOM.length - 1 : cur) + d)));
  };
  const toToday = () => scroll.current?.scrollTo({ left: Math.max(0, todayX - (width - labelW) / 2), behavior: 'smooth' });
  // a timeline wider than the card starts at today
  useEffect(() => {
    if (track > width - labelW) toToday();
  }, [mw, width]);

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
  const first = label(0);
  const last = label(range.months - 1);

  return (
    <div className={`jr-gantt${compact ? ' is-compact' : ''}`} style={{ ['--jr-gantt-label' as string]: `${labelW}px`, ['--jr-gantt-month' as string]: `${mw}px` }}>
      <div className="jr-gantt-bar">
        <span className="jr-muted jr-small">{`Project phases & deadlines · ${MONTHS[first.m]} ${first.y} – ${MONTHS[last.m]} ${last.y}`}</span>
        <span className="jr-gantt-tools">
          <IconBtn icon="minus" label="Zoom out" onClick={() => zoomStep(-1)} disabled={mw <= ZOOM[0]} />
          <IconBtn icon="plus" label="Zoom in" onClick={() => zoomStep(1)} disabled={mw >= ZOOM[ZOOM.length - 1]} />
          <button type="button" onClick={toToday}>
            Today
          </button>
        </span>
      </div>
      <div className="jr-gantt-scroll" ref={scroll}>
        <div className="jr-gantt-grid" style={{ width: labelW + track }} role="table" aria-label="Milestone timeline">
          <div className="jr-gantt-row is-head" role="row">
            <div className="jr-gantt-label" role="columnheader">
              <span>Milestone / Phase</span>
              <span className="jr-gantt-period">Period</span>
            </div>
            <div className="jr-gantt-track" style={{ width: track }}>
              {Array.from({ length: range.months }, (_, i) => {
                const l = label(i);
                return (
                  <span key={i} className="jr-gantt-month" style={{ left: i * mw, width: mw }}>
                    {(i === 0 || l.m === 0) && <b>{l.y}</b>}
                    {mw >= 36 ? MONTHS[l.m] : MONTHS[l.m][0]}
                  </span>
                );
              })}
              <span className="jr-gantt-today-label" style={{ left: todayX }}>
                Today
                <small>{fmtDate(today())}</small>
              </span>
            </div>
          </div>
          {list.map((m, i) => {
            const a = startOf(m.start);
            const b = endOf(m.end);
            const status = MILESTONE_STATUS.find((s) => s.id === m.status)?.label;
            const left = a ? x(a) : 0;
            const w = a && b ? Math.max(8, x(new Date(b.getTime() + DAY)) - left) : 0;
            return (
              <div key={m.id} className={`jr-gantt-row is-${m.status}`} role="row">
                <div className="jr-gantt-label" role="rowheader">
                  {editing && (
                    <span className="jr-gantt-move">
                      <IconBtn icon="up" label={`Move ${m.name} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                      <IconBtn icon="down" label={`Move ${m.name} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                    </span>
                  )}
                  <span className="jr-gantt-swatch" aria-hidden="true" />
                  <button type="button" className="jr-gantt-name" onClick={() => openMilestone(m)} title={`Edit ${m.name}`}>
                    <span>{m.name}</span>
                    <small>{a ? period(m.start, m.end) : 'no date'}</small>
                  </button>
                  <span className="jr-gantt-period">{period(m.start, m.end)}</span>
                </div>
                <div className="jr-gantt-track" style={{ width: track }} role="cell">
                  <span className="jr-gantt-now" style={{ left: todayX }} aria-hidden="true" />
                  {a && b && (
                    <button type="button" className="jr-gantt-span" style={{ left, width: w }} onClick={() => openMilestone(m)} title={`${m.name} · ${status}`}>
                      {m.status === 'completed' && <Icon name="check" />}
                      {w > 96 && <span>{m.name}</span>}
                    </button>
                  )}
                  {a && !b && (
                    <button type="button" className="jr-gantt-point" style={{ left }} onClick={() => openMilestone(m)} title={`${m.name} · ${status}`}>
                      <span className="jr-gantt-diamond" aria-hidden="true" />
                      <span>{m.name}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {deadlines.length > 0 && (
            <div className="jr-gantt-row is-deadlines" role="row">
              <div className="jr-gantt-label" role="rowheader">
                <span className="jr-gantt-swatch is-deadline" aria-hidden="true" />
                <span className="jr-gantt-name is-static">
                  <span>Deadlines</span>
                  <small>{`${deadlines.filter((d) => !d.done).length} open`}</small>
                </span>
                <span className="jr-gantt-period" />
              </div>
              <div className="jr-gantt-track" style={{ width: track }} role="cell">
                <span className="jr-gantt-now" style={{ left: todayX }} aria-hidden="true" />
                {deadlines.map((d) => (
                  <span key={d.id} className={`jr-gantt-point is-deadline${d.done ? ' is-done' : ''}`} style={{ left: x(startOf(d.date)!) }} title={`${d.label} · ${fmtDate(d.date)}${d.done ? ' · done' : ''}`}>
                    <span className="jr-gantt-diamond" aria-hidden="true" />
                    {!d.done && <span>{d.label}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!list.length && <p className="jr-muted jr-gantt-empty">No milestones yet – add the first one with “Add milestone”.</p>}
        </div>
      </div>
    </div>
  );
}

export function blankMilestone(store: JournalStore): Milestone {
  return { id: newId('m'), name: '', description: '', start: today(), end: '', status: 'planned', order: Math.max(-1, ...Object.values(store.docs.milestones).map((m) => m.order)) + 1, related: [], visibility: 'private' };
}

// one milestone: every field, Save / Cancel / Delete
export function MilestoneDialog({ store, milestone, isNew, onClose, openEntry }: { store: JournalStore; milestone: Milestone; isNew?: boolean; onClose: () => void; openEntry: (id: string) => void }) {
  const [m, setM] = useState<Milestone>({ ...milestone, start: isoDate(milestone.start), end: milestone.end ? (/^\d{4}-\d{2}$/.test(milestone.end) ? endOf(milestone.end)!.toISOString().slice(0, 10) : milestone.end) : '' });
  const [preview, setPreview] = useState(false);
  const set = (p: Partial<Milestone>) => setM((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(m) !== JSON.stringify(milestone);
  const entries = Object.values(store.docs.entries).sort((a, b) => b.date.localeCompare(a.date));
  const close = () => (!dirty || isNew || confirm('Discard the changes?')) && onClose();
  const bad = !m.name.trim() ? 'A name is needed.' : m.end && m.start && m.end < m.start ? 'The end is before the start.' : null;
  return (
    <Modal
      title={isNew ? 'New milestone' : 'Edit milestone'}
      onClose={close}
      footer={
        <>
          {!isNew && (
            <button type="button" className="is-danger" onClick={() => confirm(`Delete the milestone “${milestone.name}”?`) && (void store.commit([], [{ coll: 'milestones', id: m.id }]), onClose())}>
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="jr-spacer" />
          {bad && dirty && <span className="jr-warn">{bad}</span>}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="is-primary" disabled={!!bad || (!dirty && !isNew)} onClick={() => (void store.commit([{ coll: 'milestones', id: m.id, data: { ...m, name: m.name.trim() } }]), onClose())}>
            Save
          </button>
        </>
      }
    >
      <div className="jr-form">
        <label className="jr-field is-wide">
          <span>Name</span>
          <input value={m.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Evaluation & redesign" autoFocus />
        </label>
        <label className="jr-field">
          <span>Start</span>
          <input type="date" value={m.start} onChange={(e) => set({ start: e.target.value })} />
        </label>
        <label className="jr-field">
          <span>End (empty = one day)</span>
          <input type="date" value={m.end} min={m.start || undefined} onChange={(e) => set({ end: e.target.value })} />
        </label>
        <label className="jr-field">
          <span>Status</span>
          <select value={m.status} onChange={(e) => set({ status: e.target.value as Milestone['status'] })}>
            {MILESTONE_STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="jr-field">
          <span>Visibility</span>
          <VisibilitySwitch value={m.visibility} onChange={(v) => set({ visibility: v })} />
        </div>
      </div>
      <div className="jr-field is-wide">
        <span>Description</span>
        <MdEditor value={m.description} onChange={(v) => set({ description: v })} rows={4} preview={preview} setPreview={setPreview} label="Description" />
      </div>
      <div className="jr-field is-wide">
        <span>Related entries</span>
        <div className="jr-chips">
          {m.related.map((id) =>
            store.docs.entries[id] ? (
              <span key={id} className="jr-chip is-on">
                <button type="button" className="jr-chip-link" onClick={() => openEntry(id)}>
                  {store.docs.entries[id].title}
                </button>
                <button type="button" className="jr-chip-x" aria-label="Remove relation" onClick={() => set({ related: m.related.filter((x) => x !== id) })}>
                  ×
                </button>
              </span>
            ) : null,
          )}
          <select value="" aria-label="Relate an entry" onChange={(e) => e.target.value && set({ related: [...m.related, e.target.value] })}>
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
    </Modal>
  );
}
