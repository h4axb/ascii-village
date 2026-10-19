// Cloudflare Worker route for the user test's run log: what each participant
// crafted (the whole input and conversation), hints, quest step times,
// technical errors and session moments (src/quest/runlog.ts). Same D1
// database as the crafting feedback; the table creates itself.
//
//   POST /api/events  — the game stores (or updates, same id) one event.
//                       Same-origin, size-capped; a personal-link run's key
//                       must still be valid (it can't write into another run).
//   GET  /api/events  — every event, newest first, for the /2/feedback
//                       dashboard (dashboard password).
import { dbOf, ensureSchema, isAdmin, json, sameOrigin, type D1Database, type SessionEnv } from './session';

export const EVENT_TYPES = ['craft', 'hint', 'step', 'error', 'session'] as const;
export type RunEventType = (typeof EVENT_TYPES)[number];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ROWS = 20000;

let ready: Promise<unknown> | null = null;
function ensureEvents(db: D1Database) {
  ready ??= db
    .prepare('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at INTEGER NOT NULL, participant TEXT NOT NULL, link TEXT, type TEXT NOT NULL, data TEXT NOT NULL)')
    .run()
    .then(() => db.prepare('CREATE INDEX IF NOT EXISTS events_participant ON events (participant, at)').run())
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

export async function handleEvents(request: Request, env: SessionEnv): Promise<Response> {
  const db = dbOf(env);
  if (!db) return json(503, { error: 'no database (FEEDBACK_DB binding in wrangler.jsonc)' });
  await ensureEvents(db);

  if (request.method === 'GET') {
    if (!env.FEEDBACK_ADMIN_TOKEN) return json(503, { error: 'FEEDBACK_ADMIN_TOKEN is not set' });
    if (!isAdmin(request, env)) return json(401, { error: 'wrong password' });
    const { results } = await db.prepare('SELECT data FROM events ORDER BY at DESC LIMIT ?1').bind(MAX_ROWS).all<{ data: string }>();
    const rows = results.map((r) => {
      try {
        return JSON.parse(r.data);
      } catch {
        return null;
      }
    });
    return json(200, rows.filter(Boolean));
  }

  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
  if (!sameOrigin(request, env)) return json(403, { error: 'origin not allowed' });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'event too large' });
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  if (!ev || typeof ev !== 'object') return json(400, { error: 'not an object' });
  const id = typeof ev.id === 'string' ? ev.id.slice(0, 80) : '';
  const type = ev.type as RunEventType;
  const participant = typeof ev.participant === 'string' ? ev.participant.slice(0, 40) : '';
  const at = Number(ev.at);
  if (!id || !EVENT_TYPES.includes(type) || !participant || !Number.isFinite(at)) return json(400, { error: 'id, type, participant, at required' });
  // a personal-link run writes only under its own participant id
  const key = (request.headers.get('X-Test-Key') ?? '').trim();
  if (key) {
    await ensureSchema(db);
    const { results } = await db.prepare('SELECT participant_id FROM invites WHERE key = ?1').bind(key).all<{ participant_id: string | null }>();
    if (!results.length || results[0].participant_id !== participant) return json(403, { error: 'not this run' });
  }
  const link = typeof ev.link === 'string' ? ev.link.slice(0, 20) : null;
  await db
    .prepare(
      'INSERT INTO events (id, at, participant, link, type, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
        'ON CONFLICT(id) DO UPDATE SET at = excluded.at, data = excluded.data WHERE events.participant = excluded.participant',
    )
    .bind(id, at, participant, link, type, raw)
    .run();
  return json(200, { ok: true });
}
