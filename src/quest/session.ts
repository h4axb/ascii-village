// The user test's session: who is playing (a participant id) and in which
// order they meet the two crafting designs. A = pre-clarification (crafting
// panel 1), B = post-reflection (crafting panel 2).
//
//   /1, /intro/1   order "AB"
//   /2, /intro/2   order "BA"
//
// A new run (a new player on a quest link, or New Game) asks the server for
// the next id (functions/api/participant.ts: P001, P002, … across every
// device) and keeps it in the save, so a reload keeps it. Offline, or before
// the database is set up, the run gets a local id instead ("L-" + 5 letters)
// so it still has one. Every feedback record is tagged with it
// (feedback/client.ts), and the final survey opens with it in the URL.
import { LINK, linkKey, type Link } from '../link';
import { ORDERS, QUEST_ORDER } from './quests';

export type DesignOrder = 'AB' | 'BA';
export interface TestSession {
  participantId: string;
  order: DesignOrder;
  key?: string; // the personal invite link's key (below), when the run has one
}

// The link that runs a design order: an uploaded save keeps playing in the
// order it started with ("BA" → /2, "AB" → /1)
export function linkOfOrder(order: DesignOrder): Link | null {
  for (const [link, o] of Object.entries(ORDERS)) {
    if (o && (o[0] === 'pre' ? 'AB' : 'BA') === order) return link as Link;
  }
  return null;
}

// this link's order ("AB" when the pre-clarification design comes first)
export const LINK_ORDER: DesignOrder | null = QUEST_ORDER ? (QUEST_ORDER[0] === 'pre' ? 'AB' : 'BA') : null;

const PATH = window.location.pathname.startsWith('/intro') ? `/intro/${LINK}` : `/${LINK}`;

function localId(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `L-${s}`;
}

// A fresh session for a new run
export async function requestTestSession(): Promise<TestSession> {
  // the testing link: no participant id from the server (link.ts)
  if (LINK === 'test') return { participantId: 'TEST', order: 'AB' };
  // a personal link: the run the server started for its key
  if (INVITE_KEY && run?.participantId) return { participantId: run.participantId, order: run.order, key: INVITE_KEY };
  const order = LINK_ORDER ?? 'AB';
  try {
    const res = await fetch('/api/participant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: PATH }),
    });
    if (res.ok) {
      const d = (await res.json()) as Partial<TestSession>;
      if (typeof d.participantId === 'string' && (d.order === 'AB' || d.order === 'BA')) {
        return { participantId: d.participantId, order: d.order };
      }
    }
  } catch {
    // offline: a local id below
  }
  return { participantId: localId(), order };
}

export function parseTestSession(v: unknown): TestSession | undefined {
  const s = v as Partial<TestSession> | undefined;
  if (!s || typeof s.participantId !== 'string' || (s.order !== 'AB' && s.order !== 'BA')) return undefined;
  return { participantId: s.participantId, order: s.order, ...(typeof s.key === 'string' ? { key: s.key } : {}) };
}

// The session of the run being played right now (App keeps it current):
// feedback records are tagged with it
let current: TestSession | null = null;
export const setCurrentTestSession = (s: TestSession | null) => {
  current = s;
};
export const currentTestSession = () => current;

// Where in the test the player is: the active crafting design (cond), the
// quest part and step (App keeps it current, quest/runlog.ts)
export type RunWhere = { cond?: 'pre' | 'post'; part?: string; step?: string };
let where: RunWhere = {};
export const setCurrentWhere = (w: RunWhere) => {
  where = w;
};
export const currentWhere = () => where;

// On a personal link the server's run is the source of truth: its
// participant id is the one the dashboard registered, so the survey, the
// feedback and the run log all carry that id (a save from an earlier start,
// or an id asked for before the run answered, can't differ from it)
export function studySession(s: TestSession | null): TestSession | null {
  if (INVITE_KEY && run?.participantId) {
    if (s?.participantId === run.participantId && s.order === run.order && s.key === INVITE_KEY) return s;
    return { participantId: run.participantId, order: run.order, key: INVITE_KEY };
  }
  return s;
}

// The final survey's link with the session in it:
// <url>?order=AB&test_id=P001 (keeps whatever query the url already has)
export function surveyUrl(base: string, s: TestSession | null): string {
  try {
    const u = new URL(base);
    if (s) {
      u.searchParams.set('order', s.order);
      u.searchParams.set('test_id', s.participantId);
    }
    return u.toString();
  } catch {
    return base;
  }
}

// ---------------------------------------------------------------------------
// Personal invite links (functions/api/session.ts): participants get
// /intro/1?k=<key> or /intro/2?k=<key>. The key is read once, kept in this
// browser, and taken out of the address bar. The server binds it to this
// browser, runs it for 3 hours from the first start, closes it when the
// survey opens, and holds its AI budgets: 6 crafts, 3 recrafts per crafted
// item, a few other calls. The open test links (/0-/4) have no key.
// ---------------------------------------------------------------------------
export const PERSONAL_LINK = /^\/intro\/[12]\/?$/.test(window.location.pathname);
const KEY_STORE = `asciia-invite-key-${LINK}`;
const DONE_STORE = 'asciia-invite-done';

function readKey(): { key: string | null; changed: boolean } {
  if (!PERSONAL_LINK) return { key: null, changed: false };
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY_STORE);
  } catch {
    // no storage: the URL's key only
  }
  const fromUrl = new URLSearchParams(window.location.search).get('k')?.trim() || null;
  if (fromUrl) {
    try {
      localStorage.setItem(KEY_STORE, fromUrl);
    } catch {
      // kept for this page load only
    }
    window.history.replaceState(null, '', window.location.pathname);
  }
  const key = fromUrl ?? stored;
  return { key, changed: !!fromUrl && !!stored && fromUrl !== stored };
}
const read = readKey();
export const INVITE_KEY = read.key;

// The browser storage name for something kept per run (the save, the craft
// history, the post-reflection settings): a personal link keeps its own,
// so it starts fresh even where the open test links were played before.
// `global`: the name used off the personal links when it isn't per link.
export const storeKey = (base: string, global = false) =>
  INVITE_KEY ? `${linkKey(base)}-k${INVITE_KEY.slice(0, 12)}` : global ? base : linkKey(base);
// a different personal link opened in this browser: a new participant
export const INVITE_KEY_CHANGED = read.changed;

export const markInviteDone = () => {
  try {
    if (INVITE_KEY) localStorage.setItem(DONE_STORE, `${localStorage.getItem(DONE_STORE) ?? ''} ${INVITE_KEY}`);
  } catch {
    // the server knows anyway
  }
};
export const inviteDoneHere = () => {
  try {
    return !!INVITE_KEY && (localStorage.getItem(DONE_STORE) ?? '').split(' ').includes(INVITE_KEY);
  } catch {
    return false;
  }
};

export interface RunInfo {
  participantId: string | null;
  order: DesignOrder;
  link: string;
  expiresAt: number;
  crafts: { allowed: number; used: number };
  recraftsPerItem: number;
  itemExtras: Record<string, number>; // extra recrafts granted per item chain
  recraftsUsed: Record<string, number>;
  bonusTokens: number; // extra crafting tokens granted on the dashboard
}
// reworks per crafted item on the quest links (the server's own limit too)
export const RECRAFTS_PER_ITEM = 3;
let run: RunInfo | null = null;
export const currentRun = () => run;
export type InviteState = 'ok' | 'unknown' | 'finished' | 'expired' | 'other-device' | 'no-key' | 'consent';

const keyHeader = (): Record<string, string> => (INVITE_KEY ? { 'X-Test-Key': INVITE_KEY } : {});

// Start (or resume) the run. Offline or no server: 'ok' (the game still
// plays, crafting offline). The first start needs `consent` (App.tsx
// Consent); without it the server answers 'consent'.
export async function startInviteRun(consent = false): Promise<InviteState> {
  if (!PERSONAL_LINK) return 'ok';
  if (!INVITE_KEY) return 'no-key';
  if (inviteDoneHere()) return 'finished';
  try {
    const res = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...keyHeader() },
      body: JSON.stringify({ key: INVITE_KEY, consent }),
    });
    const d = (await res.json().catch(() => ({}))) as Partial<RunInfo> & { error?: string };
    if (res.status === 428) return 'consent';
    if (res.ok && d.participantId) {
      run = d as RunInfo;
      return 'ok';
    }
    if (d.error === 'finished') markInviteDone();
    if (d.error === 'unknown' || d.error === 'finished' || d.error === 'expired' || d.error === 'other-device') return d.error;
    return 'ok';
  } catch {
    return 'ok';
  }
}

// The run's budgets and granted extras, fresh from the server
export async function refreshRun(): Promise<RunInfo | null> {
  if (!INVITE_KEY || !run) return run;
  try {
    const res = await fetch('/api/session/status', { headers: keyHeader() });
    if (res.ok) run = (await res.json()) as RunInfo;
  } catch {
    // keep the last one
  }
  return run;
}

// The survey opened: the key is done for good
export async function completeInviteRun(): Promise<void> {
  if (!INVITE_KEY) return;
  markInviteDone();
  try {
    await fetch('/api/session/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...keyHeader() },
      body: JSON.stringify({ key: INVITE_KEY }),
      keepalive: true,
    });
  } catch {
    // the local mark stays; the key also expires on its own
  }
}

// Which craft an AI call belongs to (set while a crafting panel is open):
// the server counts one craft per token and one recraft per try on an item
export interface CraftContext {
  id: string;
  kind: 'craft' | 'recraft';
  item?: string; // the crafted item's chain id (a recraft)
}
let craftCtx: CraftContext | null = null;
export const setCraftContext = (c: CraftContext | null) => {
  craftCtx = c;
};
// the headers every AI call sends
export function aiHeaders(): Record<string, string> {
  if (!INVITE_KEY) return {};
  return {
    ...keyHeader(),
    ...(craftCtx
      ? { 'X-Craft-Id': craftCtx.id, 'X-Craft-Kind': craftCtx.kind, ...(craftCtx.item ? { 'X-Craft-Item': craftCtx.item } : {}) }
      : {}),
  };
}
export const inviteHeaders = keyHeader;

// recrafts left on an item chain (Infinity off the personal links)
export function recraftsLeft(chain: string, doneOnChain: number): number {
  if (!INVITE_KEY || !run) return Infinity;
  const allowed = run.recraftsPerItem + (run.itemExtras[chain] ?? 0);
  return Math.max(0, allowed - Math.max(doneOnChain, run.recraftsUsed[chain] ?? 0));
}
