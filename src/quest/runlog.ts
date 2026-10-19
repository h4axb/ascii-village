// The user test's run log: everything one participant did, for the
// /2/feedback dashboard (functions/api/events.ts). One event per thing:
//
//   craft    one crafting panel: the prompt(s), the whole conversation, the
//            clarifying answers, every result with the settings it was
//            crafted with, the ratings, reworks, how it ended
//   hint     a hint used (quest step, what it showed)
//   step     a quest step finished, with its time and the hints it took
//   error    a technical problem (the AI unreachable, a fallback craft,
//            a page error)
//   session  the run starting or resuming, a budget refused, an extra
//            token arriving, the survey opening
//
// Only runs with a participant id log (the quest links). Events wait in a
// small outbox in this browser when they can't be sent, like the crafting
// feedback (feedback/client.ts), and go out with the next send.
import { currentTestSession, currentWhere, inviteHeaders, setCurrentWhere, type RunWhere } from './session';
import { newFeedbackId } from '../feedback/client';

export type RunEventType = 'craft' | 'hint' | 'step' | 'error' | 'session';
export interface RunEvent {
  id: string;
  at: number;
  type: RunEventType;
  participant: string;
  order: string;
  link: string;
  cond?: 'pre' | 'post'; // the crafting design active then
  part?: string; // the quest part (q1, q2, c2, …)
  step?: string; // the quest step id
  data: Record<string, unknown>;
}

const OUTBOX_KEY = 'asciia-events-outbox';
const OUTBOX_MAX = 300;
const MAX_TEXT = 60000;

// where in the test the player is (App keeps it current; kept in
// quest/session.ts so feedback records can carry the design too)
export const setRunWhere = (w: RunWhere) => {
  setCurrentWhere(w);
};

function readOutbox(): RunEvent[] {
  try {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeOutbox(list: RunEvent[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-OUTBOX_MAX)));
  } catch {
    // storage full or blocked: the event is lost, the game goes on
  }
}
async function post(ev: RunEvent): Promise<boolean> {
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...inviteHeaders() },
      body: JSON.stringify(ev),
      keepalive: true,
    });
    // 4xx other than a full server: the event itself is refused, don't retry it
    return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
  } catch {
    return false;
  }
}
let flushing = false;
export async function flushRunLog() {
  if (flushing) return;
  flushing = true;
  try {
    let list = readOutbox();
    while (list.length) {
      const first = list[0];
      if (!(await post(first))) break;
      list = readOutbox().filter((e) => !(e.id === first.id && e.at === first.at));
      writeOutbox(list);
    }
  } finally {
    flushing = false;
  }
}

// Log (or update, same id) one event. Never throws. Returns the id.
export function logEvent(type: RunEventType, data: Record<string, unknown>, id: string = newFeedbackId()): string {
  const ts = currentTestSession();
  if (!ts) return id;
  let ev: RunEvent = {
    id,
    at: Date.now(),
    type,
    participant: ts.participantId,
    order: ts.order,
    link: window.location.pathname,
    ...currentWhere(),
    data,
  };
  if (JSON.stringify(ev).length > MAX_TEXT) ev = { ...ev, data: { ...data, truncated: true, thread: undefined } };
  const queued = readOutbox().filter((e) => e.id !== id);
  void post(ev).then((ok) => {
    if (ok) {
      writeOutbox(readOutbox().filter((e) => e.id !== id));
      void flushRunLog();
    } else writeOutbox([...queued, ev]);
  });
  return id;
}

// Technical problems: page errors and AI budget refusals, logged on their own
let watching = false;
export function watchErrors() {
  if (watching) return;
  watching = true;
  window.addEventListener('error', (e) => {
    logEvent('error', { kind: 'page', message: String(e.message).slice(0, 300), where: `${e.filename ?? ''}:${e.lineno ?? ''}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    logEvent('error', { kind: 'promise', message: String(r?.message ?? r).slice(0, 300), where: (r?.stack ?? '').split('\n')[1]?.trim() ?? '' });
  });
  window.addEventListener('asciia-ai-error', (e) => {
    logEvent('error', { kind: 'ai', ...((e as CustomEvent).detail as Record<string, unknown>) });
  });
  window.addEventListener('asciia-fallback', (e) => {
    logEvent('error', { kind: 'fallback-craft', ...((e as CustomEvent).detail as Record<string, unknown>) });
  });
  window.addEventListener('asciia-feedback-queued', (e) => {
    logEvent('error', { kind: 'feedback-unsent', id: String((e as CustomEvent).detail) });
  });
  window.addEventListener('asciia-ai-budget', (e) => {
    logEvent('session', { what: 'budget-refused', detail: String((e as CustomEvent).detail) });
  });
}
