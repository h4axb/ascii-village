// Sends crafting feedback (crafting panel 2) to the store behind
// /api/feedback (functions/api/feedback.ts on Cloudflare; a local file under
// `pnpm dev`, see vite.config.ts). Anything that can't be sent right now —
// storage not set up yet, offline — waits in a small outbox in this browser
// and goes out with the next successful send or page load.
import type { FeedbackRecord } from './schema';

const PLAYER_KEY = 'asciia-player-id';
const OUTBOX_KEY = 'asciia-feedback-outbox';
const OUTBOX_MAX = 100;

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

// An anonymous id for this browser — no name, no account.
export function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage-' + SESSION.slice(0, 8);
  }
}

export const SESSION = randomId();
export const newFeedbackId = () => randomId();

function readOutbox(): FeedbackRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeOutbox(list: FeedbackRecord[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-OUTBOX_MAX)));
  } catch {
    // storage full or blocked: this record is lost, the game goes on
  }
}

async function post(rec: FeedbackRecord): Promise<boolean> {
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    let list = readOutbox();
    while (list.length) {
      const first = list[0];
      if (!(await post(first))) break;
      list = readOutbox().filter((r) => r.id !== first.id);
      writeOutbox(list);
    }
  } finally {
    flushing = false;
  }
}

// Store (or update — same id) one record. Never throws.
export async function sendFeedback(rec: FeedbackRecord): Promise<void> {
  // a newer version of the same record replaces a queued one
  const queued = readOutbox().filter((r) => r.id !== rec.id);
  if (await post(rec)) {
    writeOutbox(queued);
    void flush();
  } else writeOutbox([...queued, rec]);
}

// resend whatever is waiting, once per page load
export function flushFeedbackOutbox(): void {
  void flush();
}
