// The task timer: plan a time for a task, then let a timer count it down.
// One timer at a time, kept in localStorage (it survives a reload: the time is
// worked out from timestamps). Pausing or stopping stores the period on the
// task (Task.runs), so the history can be read, changed and deleted.
//
// It floats at the top of the journal, and "Keep on top" moves it into a
// Document Picture-in-Picture window (Chrome / Edge): a small window the
// browser keeps above every other app, like PureRef. Elsewhere it stays in
// the page.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { JournalStore } from './store';
import { fmtMinutes, newId, runsMs, type Entry, type Run, type Task } from './types';
import { Icon } from './ui';

// ---------- time helpers ----------

export const PLAN_PRESETS = [15, 25, 45, 60, 90];
const pad2 = (n: number) => String(n).padStart(2, '0');
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
// 13:12 / 1:05:09
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    x = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${pad2(m)}:${pad2(x)}`;
}
// a run's time changed to HH:MM, on the day it started (an end before the start runs past midnight)
function withTime(base: number, v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(base);
  d.setHours(+m[1], +m[2], 0, 0);
  return d.getTime();
}

// ---------- the timer's state ----------

interface TimerState {
  entry: string;
  task: string;
  run: number | null; // the start of the running period, null = paused
  alerted?: boolean; // the overrun was announced
}
const KEY = 'jr-timer';
const VIEW_KEY = 'jr-timer-view';
const load = (): TimerState | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as TimerState | null;
  } catch {
    return null;
  }
};

interface TimerApi {
  state: TimerState | null;
  now: number;
  task: Task | null;
  entry: Entry | null;
  spent: number; // ms, the stored periods and the running one
  plan: number; // ms
  start: (entry: string, task: string, plan?: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  pip: boolean;
  pipSupported: boolean;
  openPip: () => void;
  closePip: () => void;
}
const Ctx = createContext<TimerApi | null>(null);
export const useTimer = () => useContext(Ctx);

declare global {
  interface Window {
    documentPictureInPicture?: { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window>; window: Window | null };
  }
}

function beep() {
  try {
    const a = new AudioContext();
    const o = a.createOscillator(),
      g = a.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.6);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.65);
  } catch {
    /* no sound */
  }
}

export function TimerProvider({ store, children }: { store: JournalStore; children: ReactNode }) {
  const [state, setStateRaw] = useState<TimerState | null>(load);
  const [now, setNow] = useState(Date.now());
  const [pipWin, setPipWin] = useState<Window | null>(null);
  const setState = useCallback((s: TimerState | null) => {
    setStateRaw(s);
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  }, []);
  // another tab started or stopped it
  useEffect(() => {
    const on = (e: StorageEvent) => e.key === KEY && setStateRaw(load());
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  useEffect(() => {
    if (!state) return;
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, [state]);

  const entry = state ? ((store.docs.entries[state.entry] as Entry | undefined) ?? null) : null;
  const task = entry && state ? ((entry.tasks ?? []).find((t) => t.id === state.task) ?? null) : null;
  const plan = (task?.plan ?? 0) * 60000;
  const spent = runsMs(task?.runs) + (state?.run ? Math.max(0, now - state.run) : 0);

  // the task it ran on was deleted: the timer goes with it
  useEffect(() => {
    if (state && store.state === 'ready' && !task) setState(null);
  }, [state, task, store.state, setState]);

  // a task changed and stored at once (its latest stored state)
  const putTask = (entryId: string, taskId: string, fn: (t: Task) => Task) => {
    const e = store.docs.entries[entryId] as Entry | undefined;
    if (!e) return;
    void store.commit([{ coll: 'entries', id: e.id, data: { ...e, tasks: (e.tasks ?? []).map((t) => (t.id === taskId ? fn(t) : t)), updated: Date.now() } }]);
  };
  // the running period, stored on the task; an empty start / end of the task is filled in
  const close = (s: TimerState, end: number, done: boolean) => {
    if (!s.run) return;
    const run: Run = { id: newId('r'), start: s.run, end };
    putTask(s.entry, s.task, (t) => {
      const runs = [...(t.runs ?? []), run].sort((a, b) => a.start - b.start);
      return { ...t, runs, start: t.start || hhmm(runs[0].start), end: done && !t.end ? hhmm(end) : t.end };
    });
  };

  // the overrun, announced once
  useEffect(() => {
    if (!state || state.alerted || !plan || spent < plan) return;
    setState({ ...state, alerted: true });
    beep();
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Time is up', { body: `${task?.title || 'Task'}: ${fmtMinutes(Math.round(plan / 60000))} planned`, silent: true });
  }, [state, spent, plan, task, setState]);

  const api: TimerApi = {
    state,
    now,
    task,
    entry,
    spent,
    plan,
    start: (entryId, taskId, planMin) => {
      if (state?.run) close(state, Date.now(), true);
      if (planMin != null) putTask(entryId, taskId, (t) => ({ ...t, plan: planMin }));
      const t = ((store.docs.entries[entryId] as Entry | undefined)?.tasks ?? []).find((x) => x.id === taskId);
      const p = (planMin ?? t?.plan ?? 0) * 60000;
      setState({ entry: entryId, task: taskId, run: Date.now(), alerted: !!p && runsMs(t?.runs) >= p });
      setNow(Date.now());
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    },
    pause: () => {
      if (!state?.run) return;
      close(state, Date.now(), false);
      setState({ ...state, run: null });
    },
    resume: () => state && !state.run && setState({ ...state, run: Date.now() }),
    stop: () => {
      if (!state) return;
      close(state, Date.now(), true);
      setState(null);
      pipWin?.close();
    },
    pip: !!pipWin,
    pipSupported: typeof window !== 'undefined' && 'documentPictureInPicture' in window,
    openPip: async () => {
      if (!window.documentPictureInPicture || pipWin) return;
      const compact = localStorage.getItem(VIEW_KEY) === 'compact';
      const w = await window.documentPictureInPicture.requestWindow(compact ? { width: 280, height: 64 } : { width: 380, height: 150 });
      // the page's styles, so the timer looks the same in its own window
      for (const sh of [...document.styleSheets]) {
        try {
          const st = w.document.createElement('style');
          st.textContent = [...sh.cssRules].map((r) => r.cssText).join('\n');
          w.document.head.appendChild(st);
        } catch {
          if (sh.href) {
            const l = w.document.createElement('link');
            l.rel = 'stylesheet';
            l.href = sh.href;
            w.document.head.appendChild(l);
          }
        }
      }
      w.document.body.className = 'jr-pip';
      w.addEventListener('pagehide', () => setPipWin(null));
      setPipWin(w);
    },
    closePip: () => pipWin?.close(),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {state && task && (pipWin ? createPortal(<TimerCard api={api} inPip win={pipWin} />, pipWin.document.body) : <TimerCard api={api} />)}
    </Ctx.Provider>
  );
}

// ---------- the timer itself ----------

function TimerCard({ api, inPip, win }: { api: TimerApi; inPip?: boolean; win?: Window }) {
  const [compact, setCompactRaw] = useState(() => localStorage.getItem(VIEW_KEY) === 'compact');
  const setCompact = (c: boolean) => {
    setCompactRaw(c);
    localStorage.setItem(VIEW_KEY, c ? 'compact' : 'full');
    if (win) win.resizeTo(c ? 280 : 380, c ? 64 + (win.outerHeight - win.innerHeight) : 150 + (win.outerHeight - win.innerHeight));
  };
  // dragged along the top of the page (in the page only), remembered
  const [off, setOff] = useState(() => Number(localStorage.getItem('jr-timer-x') ?? 0) || 0);
  const drag = useRef<{ x: number; off: number } | null>(null);
  const { state, task, spent, plan, now } = api;
  if (!state || !task) return null;
  const running = !!state.run;
  const over = plan > 0 && spent > plan;
  const left = plan ? plan - spent : spent;
  const frac = plan ? Math.min(1, spent / plan) : 0;
  const time = plan ? (over ? `+${clock(spent - plan)}` : clock(left)) : clock(spent);
  const endAt = running && plan && !over ? hhmm(now + left) : null;
  const cls = `jr-timer${compact ? ' is-compact' : ''}${over ? ' is-over' : ''}${running ? '' : ' is-paused'}${inPip ? ' in-pip' : ''}`;
  const pos = inPip ? undefined : ({ '--x': `${off}px` } as React.CSSProperties);
  const onDown = (e: React.PointerEvent) => {
    if (inPip || (e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, off };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => drag.current && setOff(drag.current.off + e.clientX - drag.current.x);
  const onUp = () => {
    if (drag.current) localStorage.setItem('jr-timer-x', String(off));
    drag.current = null;
  };

  if (compact)
    return (
      <div className={cls} style={pos} role="timer" aria-label={`${task.title || 'Task'}: ${time}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <button type="button" className="jr-timer-pill" onClick={() => setCompact(false)} title="Open timer">
          <svg className="jr-timer-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="14" className="trk" />
            <circle cx="18" cy="18" r="14" className="bar" pathLength={100} strokeDasharray={`${(over ? 1 : frac) * 100} 100`} transform="rotate(-90 18 18)" />
          </svg>
          <span className="jr-timer-pill-t">{time}</span>
        </button>
      </div>
    );
  return (
    <div className={cls} style={pos} role="timer" aria-label={`${task.title || 'Task'}: ${time}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <svg className="jr-timer-edge" aria-hidden="true">
        <rect className="trk" x="3" y="3" rx="30" pathLength={100} />
        <rect className="bar" x="3" y="3" rx="30" pathLength={100} strokeDasharray={`${(over ? 1 : frac) * 100} 100`} />
      </svg>
      <button type="button" className="jr-timer-btn" onClick={running ? api.pause : api.resume} aria-label={running ? 'Pause' : 'Resume'}>
        {running ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6.5" y="5" width="3.6" height="14" rx="1.6" />
            <rect x="13.9" y="5" width="3.6" height="14" rx="1.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>
      <div className="jr-timer-mid">
        <span className="jr-timer-sub">{over ? `over · ${fmtMinutes(Math.round(plan / 60000))} planned` : endAt ? `🔔 ${endAt}` : running ? 'counting' : 'paused'}</span>
        <span className="jr-timer-t">{time}</span>
        <span className="jr-timer-name">{task.title || 'Task'}</span>
      </div>
      <button type="button" className="jr-timer-btn is-stop" onClick={api.stop} aria-label="Stop timer">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
      <span className="jr-timer-tools">
        {!inPip && api.pipSupported && (
          <button type="button" onClick={api.openPip} title="Keep on top of every window" aria-label="Keep on top">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <rect x="12" y="11" width="7" height="6" rx="1" className="fill" />
            </svg>
          </button>
        )}
        {inPip && (
          <button type="button" onClick={api.closePip} title="Back into the page" aria-label="Back into the page">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 15l-5 5M4 15v5h5M15 9l5-5M20 9V4h-5" />
            </svg>
          </button>
        )}
        <button type="button" onClick={() => setCompact(true)} title="Make small" aria-label="Make small">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
      </span>
    </div>
  );
}

// ---------- on a task: plan, start, progress ----------

export function TaskTimer({ store, entry, task, onRuns }: { store: JournalStore; entry: Entry; task: Task; onRuns: (runs: Run[], p?: Partial<Task>) => void }) {
  const api = useTimer();
  const [choose, setChoose] = useState(false);
  const [custom, setCustom] = useState('');
  const saved = !!store.docs.entries[entry.id];
  const active = !!api?.state && api.state.entry === entry.id && api.state.task === task.id;
  const spent = active && api ? api.spent : runsMs(task.runs);
  const plan = (task.plan ?? 0) * 60000;
  const over = plan > 0 && spent > plan;
  const [hist, setHist] = useState(false);
  const showHist = hist || over;
  if (!api || !saved) return null;
  const begin = (m?: number) => {
    setChoose(false);
    api.start(entry.id, task.id, m);
  };
  const n = (task.runs ?? []).length;
  return (
    <div className={`jr-tt${over ? ' is-over' : ''}`}>
      <div className="jr-tt-row">
        {(plan > 0 || spent > 0) && (
          <span className="jr-tt-bar" title={plan ? `${fmtMinutes(Math.round(spent / 60000))} of ${fmtMinutes(task.plan!)}` : undefined}>
            {plan > 0 && (
              <i>
                <b style={{ width: `${Math.min(100, (spent / plan) * 100)}%` }} />
              </i>
            )}
            <span>
              {fmtMinutes(Math.round(spent / 60000))}
              {plan > 0 && ` / ${fmtMinutes(task.plan!)}`}
              {over && <em>{` +${fmtMinutes(Math.round((spent - plan) / 60000))}`}</em>}
            </span>
          </span>
        )}
        {active ? (
          <>
            <button type="button" className="jr-tt-btn" onClick={api.state?.run ? api.pause : api.resume}>
              {api.state?.run ? 'Pause' : '▶ Resume'}
            </button>
            <button type="button" className="jr-tt-btn" onClick={api.stop}>
              Stop
            </button>
          </>
        ) : (
          <button type="button" className="jr-tt-btn is-go" onClick={() => (task.plan ? begin() : setChoose(!choose))}>
            ▶ {task.plan ? `Timer · ${fmtMinutes(task.plan)}` : 'Plan & start'}
          </button>
        )}
        {!active && task.plan ? (
          <button type="button" className="jr-linkbtn jr-small" onClick={() => setChoose(!choose)}>
            Change plan
          </button>
        ) : null}
        {n > 0 && !over && (
          <button type="button" className="jr-linkbtn jr-small" aria-expanded={showHist} onClick={() => setHist(!hist)}>
            {`History (${n})`}
          </button>
        )}
      </div>
      {choose && (
        <div className="jr-tt-plan" role="group" aria-label="Plan">
          <span className="jr-muted jr-small">Plan:</span>
          {PLAN_PRESETS.map((m) => (
            <button key={m} type="button" className="jr-chip is-small" onClick={() => begin(m)}>
              {fmtMinutes(m)}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const m = Math.round(Number(custom));
              if (m > 0) begin(m);
            }}
          >
            <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="min" aria-label="Minutes" />
            <button type="submit" className="jr-chip is-small" disabled={!Number(custom)}>
              Start
            </button>
          </form>
        </div>
      )}
      {showHist && <RunsEditor runs={task.runs ?? []} over={over} onChange={onRuns} />}
    </div>
  );
}

// ---------- the history: every period, editable ----------

export function RunsEditor({ runs: raw, over, onChange }: { runs: Run[]; over?: boolean; onChange: (runs: Run[], p?: Partial<Task>) => void }) {
  const runs = [...raw].sort((a, b) => a.start - b.start);
  const set = (id: string, p: Partial<Run>) => onChange(runs.map((r) => (r.id === id ? { ...r, ...p } : r)).sort((a, b) => a.start - b.start));
  return (
    <div className="jr-runs">
      <div className="jr-runs-head">
        <strong>{over ? 'Over the plan · history' : 'History'}</strong>
        <span className="jr-muted jr-small">{`${runs.length} ${runs.length === 1 ? 'period' : 'periods'} · ${fmtMinutes(Math.round(runsMs(runs) / 60000))}`}</span>
      </div>
      {runs.length > 0 && (
        <ul>
          {runs.map((r) => (
            <RunRow key={r.id} r={r} onChange={(p) => set(r.id, p)} onRemove={() => onChange(runs.filter((x) => x.id !== r.id))} />
          ))}
        </ul>
      )}
      <div className="jr-runs-foot">
        <button
          type="button"
          className="jr-linkbtn jr-small"
          onClick={() => {
            const end = Date.now();
            onChange([...runs, { id: newId('r'), start: end - 25 * 60000, end }]);
          }}
        >
          <Icon name="plus" /> Add period
        </button>
        {runs.length > 0 && (
          <button type="button" className="jr-linkbtn jr-small" title="Set the task's start and end from the first and last period" onClick={() => onChange(runs, runsSpan(runs))}>
            Use as task time
          </button>
        )}
        {runs.length > 0 && (
          <button type="button" className="jr-linkbtn jr-small is-danger" onClick={() => confirm('Delete every period of this task?') && onChange([])}>
            Delete all
          </button>
        )}
      </div>
    </div>
  );
}

function RunRow({ r, onChange, onRemove }: { r: Run; onChange: (p: Partial<Run>) => void; onRemove: () => void }) {
  const [a, setA] = useState(hhmm(r.start));
  const [b, setB] = useState(hhmm(r.end));
  useEffect(() => {
    setA(hhmm(r.start));
    setB(hhmm(r.end));
  }, [r.start, r.end]);
  const commit = () => {
    const s = withTime(r.start, a);
    let e = withTime(r.start, b);
    if (s == null || e == null) {
      setA(hhmm(r.start));
      setB(hhmm(r.end));
      return;
    }
    if (e < s) e += 86400000;
    if (s !== r.start || e !== r.end) onChange({ start: s, end: e });
  };
  const d = new Date(r.start);
  return (
    <li>
      <span className="jr-runs-day">{`${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`}</span>
      <input value={a} onChange={(e) => setA(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Start" inputMode="numeric" maxLength={5} />
      <span aria-hidden="true">–</span>
      <input value={b} onChange={(e) => setB(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="End" inputMode="numeric" maxLength={5} />
      <span className="jr-runs-dur">{fmtMinutes(Math.max(0, Math.round((r.end - r.start) / 60000)))}</span>
      <button type="button" className="jr-iconbtn" aria-label="Delete period" title="Delete period" onClick={onRemove}>
        <Icon name="trash" />
      </button>
    </li>
  );
}

// the task's start and end from its periods (the first start, the last end)
export const runsSpan = (runs: Run[]) => (runs.length ? { start: hhmm(Math.min(...runs.map((r) => r.start))), end: hhmm(Math.max(...runs.map((r) => r.end))) } : {});
