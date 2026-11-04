// The Overview's milestone timeline: one row per milestone, a coloured beam from
// its start to its end with its title in white (a single date is a diamond), the
// deadlines in a row of their own, and today marked. The scale is fixed (weeks,
// zoomable), so the beams are never squeezed: the time axis scrolls sideways
// and the names stay in place. Hovering a beam or a deadline tells the days
// left until it is due; a click on a milestone opens it for editing.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JournalStore, Put } from './store';
import { fmtDate, MILESTONE_STATUS, newId, PALETTE, today, type Milestone } from './types';
import { Swatches } from './EntryForm';
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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

// the days from today to a date: 0 today, negative past
const daysTo = (now: Date, d: Date) => Math.round((d.getTime() - now.getTime()) / DAY);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
// what the tooltip says about the time left
export function timeLeft(now: Date, a: Date | null, b: Date | null, done: boolean): string {
  if (!a) return 'No date';
  const end = b ?? a;
  const toEnd = daysTo(now, end);
  if (done) return toEnd < 0 ? `Completed · ended ${plural(-toEnd, 'day')} ago` : 'Completed';
  const toStart = daysTo(now, a);
  if (toStart > 0 && b && b.getTime() !== a.getTime()) return `Starts in ${plural(toStart, 'day')} · ${plural(toEnd, 'day')} until the deadline`;
  if (toEnd > 0) return `${plural(toEnd, 'day')} left until the deadline`;
  if (toEnd === 0) return 'Deadline today';
  return `${plural(-toEnd, 'day')} overdue`;
}
const ZOOM = [4, 6, 9, 13, 18, 26]; // px per day
const DEFAULT_ZOOM = 3; // a week ≈ 91 px
const weekStart = (d: Date) => new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY); // its Monday
const md = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const colorOf = (m: Milestone, i: number) => m.color ?? PALETTE[i % PALETTE.length];
// a text that fades out at its end only when it is too long for its place
function Fade({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [children]);
  return (
    <span ref={ref} className={`jr-gt-fade${over ? ' is-over' : ''}`}>
      {children}
    </span>
  );
}

interface Tip {
  x: number;
  y: number;
  title: string;
  when: string;
  left: string;
  color: string;
}

export function MilestoneTimeline({ store, editing, openMilestone }: { store: JournalStore; editing: boolean; openMilestone: (m: Milestone) => void }) {
  const list = Object.values(store.docs.milestones).sort((a, b) => a.order - b.order);
  const deadlines = Object.values(store.docs.deadlines).filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
  const now = startOf(today())!;
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [tip, setTip] = useState<(Tip & { id: string }) | null>(null);
  const touch = useRef(false);
  const ppd = ZOOM[zoom];

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const compact = width < 820;
  const labelW = width < 560 ? 132 : compact ? 200 : 300;

  // the range: whole weeks from a week before the first date to three after the
  // last, longer when the card has room for more; the scale never shrinks
  const range = useMemo(() => {
    const ds = [now, ...list.flatMap((m) => [startOf(m.start), endOf(m.end)]), ...deadlines.map((d) => startOf(d.date))].filter((x): x is Date => !!x);
    const first = weekStart(new Date(Math.min(...ds.map((d) => d.getTime())) - 7 * DAY));
    const last = Math.max(...ds.map((d) => d.getTime())) + 21 * DAY;
    let weeks = Math.ceil((last - first.getTime()) / (7 * DAY));
    weeks = Math.max(weeks, Math.ceil((width - labelW) / (7 * ppd)));
    return { first, weeks };
  }, [list, deadlines, now, width, labelW, ppd]);
  const x = (d: Date) => ((d.getTime() - range.first.getTime()) / DAY) * ppd;
  const track = range.weeks * 7 * ppd;
  const todayX = x(now) + ppd / 2;
  const weeks = Array.from({ length: range.weeks }, (_, i) => new Date(range.first.getTime() + i * 7 * DAY));
  // the month bands of the top header row
  const months = useMemo(() => {
    const out: { key: string; label: string; left: number; width: number }[] = [];
    const end = new Date(range.first.getTime() + range.weeks * 7 * DAY);
    let d = new Date(Date.UTC(range.first.getUTCFullYear(), range.first.getUTCMonth(), 1, 12));
    while (d < end) {
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12));
      const l = Math.max(0, x(d));
      const r = Math.min(track, x(next));
      out.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, left: l, width: r - l });
      d = next;
    }
    return out;
  }, [range, ppd, track]);

  const toToday = (smooth = true) => scroll.current?.scrollTo({ left: Math.max(0, todayX - (width - labelW) / 3), behavior: smooth ? 'smooth' : 'auto' });
  // it opens at today, and stays there when zoomed
  useEffect(() => {
    if (width) toToday(false);
  }, [ppd, width > 0]);
  // (the tooltip goes when the axis scrolls)
  useEffect(() => {
    const el = scroll.current;
    const off = () => setTip(null);
    el?.addEventListener('scroll', off, { passive: true });
    return () => el?.removeEventListener('scroll', off);
  }, []);

  const show = (el: HTMLElement, t: Omit<Tip, 'x' | 'y'> & { id: string }) => {
    const box = root.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    // (kept inside the card: the tooltip is at most 260 px wide)
    const half = Math.min(130, box.width / 2);
    const cx = Math.min(Math.max(r.left + r.width / 2, box.left + Math.min(labelW + 8, half)), box.right - half);
    setTip({ ...t, x: cx - box.left, y: r.top - box.top });
  };
  // on hover and focus; on a touch screen the first tap shows it, the next opens
  const hover = (t: Omit<Tip, 'x' | 'y'> & { id: string }, open?: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => (touch.current = e.pointerType !== 'mouse'),
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => !touch.current && show(e.currentTarget, t),
    onMouseLeave: () => !touch.current && setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => !touch.current && show(e.currentTarget, t),
    onBlur: () => setTip(null),
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (touch.current && tip?.id !== t.id) show(e.currentTarget, t);
      else (setTip(null), open?.());
    },
  });

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
  const lastDay = new Date(range.first.getTime() + (range.weeks * 7 - 1) * DAY);
  const weekLabel = (w: Date) => {
    if (ppd >= 12) {
      const e = new Date(w.getTime() + 6 * DAY);
      return e.getUTCMonth() === w.getUTCMonth() ? `${md(w)} – ${e.getUTCDate()}` : `${md(w)} – ${md(e)}`;
    }
    return ppd >= 6 ? String(w.getUTCDate()) : '';
  };

  return (
    <div ref={root} className={`jr-gt${compact ? ' is-compact' : ''}`} style={{ ['--jr-gt-label' as string]: `${labelW}px`, ['--jr-gt-week' as string]: `${7 * ppd}px` }}>
      <div className="jr-gt-bar">
        <span className="jr-muted jr-small">{`Project phases & deadlines · ${md(range.first)} ${range.first.getUTCFullYear()} – ${md(lastDay)} ${lastDay.getUTCFullYear()}`}</span>
        <span className="jr-gt-tools">
          <IconBtn icon="minus" label="Zoom out" onClick={() => setZoom(Math.max(0, zoom - 1))} disabled={zoom === 0} />
          <IconBtn icon="plus" label="Zoom in" onClick={() => setZoom(Math.min(ZOOM.length - 1, zoom + 1))} disabled={zoom === ZOOM.length - 1} />
          <button type="button" onClick={() => toToday()}>
            Today
          </button>
        </span>
      </div>
      <div className="jr-gt-scroll" ref={scroll}>
        <div className="jr-gt-grid" style={{ width: labelW + track }} role="table" aria-label="Milestone timeline">
          <div className="jr-gt-row is-head" role="row">
            <div className="jr-gt-label" role="columnheader">
              <span>Milestone / Phase</span>
              <span className="jr-gt-period">Period</span>
            </div>
            <div className="jr-gt-track" style={{ width: track }}>
              {months.map((m) => (
                <span key={m.key} className="jr-gt-month" style={{ left: m.left, width: m.width }}>
                  <span>{m.label}</span>
                </span>
              ))}
              {weeks.map((w, i) => (
                <span key={i} className={`jr-gt-week${now >= w && now.getTime() < w.getTime() + 7 * DAY ? ' is-now' : ''}`} style={{ left: i * 7 * ppd, width: 7 * ppd }}>
                  {weekLabel(w)}
                </span>
              ))}
              <span className="jr-gt-today" style={{ left: todayX }} title={`Today · ${fmtDate(today())}`}>
                {now.getUTCDate()}
              </span>
            </div>
          </div>
          {list.map((m, i) => {
            const a = startOf(m.start);
            const b = endOf(m.end);
            const status = MILESTONE_STATUS.find((s) => s.id === m.status)?.label ?? '';
            const color = colorOf(m, i);
            const left = a ? x(a) : 0;
            const w = a && b ? Math.max(24, x(new Date(b.getTime() + DAY)) - left) : 0;
            const done = m.status === 'completed';
            const t = { id: m.id, title: m.name, when: `${a ? period(m.start, m.end) : 'no date'} · ${status}`, left: timeLeft(now, a, b, done), color };
            return (
              <div key={m.id} className={`jr-gt-row is-${m.status}`} role="row" style={{ '--k': color } as React.CSSProperties}>
                <div className="jr-gt-label" role="rowheader">
                  {editing && (
                    <span className="jr-gt-move">
                      <IconBtn icon="up" label={`Move ${m.name} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                      <IconBtn icon="down" label={`Move ${m.name} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                    </span>
                  )}
                  <span className={`jr-gt-state is-${m.status}`} aria-label={status} role="img">
                    {done && <Icon name="check" />}
                  </span>
                  <button type="button" className="jr-gt-name" onClick={() => openMilestone(m)} aria-label={`Edit ${m.name}`}>
                    <Fade>{m.name}</Fade>
                    <small>{a ? period(m.start, m.end) : 'no date'}</small>
                  </button>
                  <span className="jr-gt-period">{period(m.start, m.end)}</span>
                </div>
                <div className="jr-gt-track" style={{ width: track }} role="cell">
                  <span className="jr-gt-now" style={{ left: todayX }} aria-hidden="true" />
                  {a && b && (
                    <>
                      {/* the title always inside, fading out when the beam is too short for it */}
                      <button type="button" className="jr-gt-beam" style={{ left, width: w }} aria-label={`${m.name} · ${t.when} · ${t.left}`} {...hover(t, () => openMilestone(m))}>
                        {done && <Icon name="check" />}
                        <Fade>{m.name}</Fade>
                      </button>
                    </>
                  )}
                  {a && !b && (
                    <button type="button" className="jr-gt-point" style={{ left: left + ppd / 2 }} aria-label={`${m.name} · ${t.when} · ${t.left}`} {...hover(t, () => openMilestone(m))}>
                      <span className="jr-gt-diamond" aria-hidden="true" />
                      <span>{m.name}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {deadlines.length > 0 && (
            <div className="jr-gt-row is-group" role="row">
              <div className="jr-gt-label" role="rowheader">
                <span>Deadlines</span>
                <span className="jr-gt-period">{`${deadlines.filter((d) => !d.done).length} open`}</span>
              </div>
              <div className="jr-gt-track" style={{ width: track }} role="cell">
                <span className="jr-gt-now" style={{ left: todayX }} aria-hidden="true" />
              </div>
            </div>
          )}
          {deadlines.map((d) => {
            // each deadline in a row of its own: a diamond on its date, or a beam
            // when it spans several days
            const at = startOf(d.date)!;
            const end = d.dateEnd ? startOf(d.dateEnd) : null;
            const span = end && end > at ? end : null;
            const range = d.dateEnd && span ? period(d.date, d.dateEnd) : fmtDate(d.date);
            const t = { id: d.id, title: d.label, when: `${range}${d.done ? ' · Done' : ''}`, left: timeLeft(now, at, span, d.done).replace('Completed', 'Done'), color: d.done ? '#9a9a94' : '#9a3b0c' };
            const left = x(at);
            const w = span ? Math.max(24, x(new Date(span.getTime() + DAY)) - left) : 0;
            return (
              <div key={d.id} className={`jr-gt-row is-deadline${d.done ? ' is-done' : ''}`} role="row" style={{ '--k': t.color } as React.CSSProperties}>
                <div className="jr-gt-label" role="rowheader">
                  <span className={`jr-gt-state is-deadline${d.done ? ' is-done' : ''}`} aria-label={d.done ? 'Done' : 'Open'} role="img" />
                  <span className="jr-gt-name is-static">
                    <Fade>{d.label}</Fade>
                    <small>{range}</small>
                  </span>
                  <span className="jr-gt-period">{range}</span>
                </div>
                <div className="jr-gt-track" style={{ width: track }} role="cell">
                  <span className="jr-gt-now" style={{ left: todayX }} aria-hidden="true" />
                  {span ? (
                    <span tabIndex={0} className="jr-gt-beam is-deadline" style={{ left, width: w }} aria-label={`${d.label} · ${t.when} · ${t.left}`} {...hover(t)}>
                      {d.done && <Icon name="check" />}
                      <Fade>{d.label}</Fade>
                    </span>
                  ) : (
                    <span tabIndex={0} className={`jr-gt-point is-deadline${d.done ? ' is-done' : ''}`} style={{ left: left + ppd / 2 }} aria-label={`${d.label} · ${t.when} · ${t.left}`} {...hover(t)}>
                      <span className="jr-gt-diamond" aria-hidden="true" />
                      <span>{d.label}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {!list.length && <p className="jr-muted jr-gt-empty">No milestones yet – add the first one with “Add milestone”.</p>}
        </div>
      </div>
      {tip && (
        <div className="jr-gt-tip" role="tooltip" style={{ left: tip.x, top: tip.y, '--k': tip.color } as React.CSSProperties}>
          <strong>{tip.title}</strong>
          <span>{tip.when}</span>
          <b>{tip.left}</b>
        </div>
      )}
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
          <span>Colour</span>
          <Swatches value={m.color ?? colorOf(m, Math.max(0, Object.values(store.docs.milestones).sort((a, b) => a.order - b.order).findIndex((x) => x.id === m.id)))} label="Colour of the beam" onPick={(c) => set({ color: c })} />
        </div>
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
