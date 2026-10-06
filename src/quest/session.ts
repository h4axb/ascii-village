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
import { LINK, type Link } from '../link';
import { ORDERS, QUEST_ORDER } from './quests';

export type DesignOrder = 'AB' | 'BA';
export interface TestSession {
  participantId: string;
  order: DesignOrder;
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
  return { participantId: s.participantId, order: s.order };
}

// The session of the run being played right now (App keeps it current):
// feedback records are tagged with it
let current: TestSession | null = null;
export const setCurrentTestSession = (s: TestSession | null) => {
  current = s;
};
export const currentTestSession = () => current;

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
