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
import { addColumns, SQL_CONDITION, SQL_DESIGN } from './feedback';
import { conditionOf, designOf } from '../../src/feedback/schema';

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
    // the analysis columns (src/feedback/schema.ts): run_order (AB/BA),
    // condition (1/2), design (A/B), fallback_used (0/1)
    .then(() => addColumns(db, 'events', [['run_order', 'TEXT'], ['condition', 'INTEGER'], ['design', 'TEXT'], ['fallback_used', 'INTEGER']]))
    .then(() =>
      // events stored before the columns: filled once from their JSON. A
      // craft logged before results carried their fallback flag counts as a
      // fallback when the game noted one for the same prompt within a minute.
      db
        .prepare(
          `UPDATE events SET run_order = json_extract(data,'$.order'), design = ${SQL_DESIGN('data')}, ` +
            `condition = ${SQL_CONDITION('data', "json_extract(data,'$.order')")}, fallback_used = CASE ` +
            `WHEN type = 'error' AND json_extract(data,'$.data.kind') = 'fallback-craft' THEN 1 ` +
            `WHEN type = 'craft' AND EXISTS (SELECT 1 FROM json_each(json_extract(events.data,'$.data.results')) r WHERE json_extract(r.value,'$.fallback') IS NOT NULL) THEN 1 ` +
            `WHEN type = 'craft' AND EXISTS (SELECT 1 FROM json_each(json_extract(events.data,'$.data.results')) r, events e2 ` +
            `WHERE e2.participant = events.participant AND e2.type = 'error' AND json_extract(e2.data,'$.data.kind') = 'fallback-craft' ` +
            `AND json_extract(e2.data,'$.data.prompt') = substr(json_extract(r.value,'$.prompt'), 1, 200) ` +
            `AND abs(e2.at - json_extract(r.value,'$.at')) < 60000) THEN 1 ELSE 0 END WHERE fallback_used IS NULL`,
        )
        .run(),
    )
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
    // an id changed on the dashboard before the event followed it: the
    // column is the truth, and the stored event is set to it once
    await db
      .prepare("UPDATE events SET data = json_set(data, '$.participant', participant) WHERE json_extract(data, '$.participant') IS NOT participant")
      .run();
    const { results } = await db.prepare('SELECT participant, data FROM events ORDER BY at DESC LIMIT ?1').bind(MAX_ROWS).all<{ participant: string; data: string }>();
    const rows = results.map((r) => {
      try {
        return { ...JSON.parse(r.data), participant: r.participant };
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
  // A personal-link run writes only under its link's participant id: the
  // id the link has NOW (an id rewritten on the dashboard while the game
  // still sends the old one is taken over, never refused and lost). The
  // event keeps its link's key, so the dashboard can tell several links of
  // one person apart. The survey opening also finishes the link, in case
  // the game's own call didn't get through.
  const key = (request.headers.get('X-Test-Key') ?? '').trim();
  let participantId = participant;
  let body = raw;
  if (key) {
    await ensureSchema(db);
    const { results } = await db.prepare('SELECT participant_id, completed FROM invites WHERE key = ?1').bind(key).all<{ participant_id: string | null; completed: number | null }>();
    if (!results.length || !results[0].participant_id) return json(403, { error: 'not this run' });
    participantId = results[0].participant_id;
    body = JSON.stringify({ ...ev, participant: participantId, key });
    if (type === 'session' && (ev.data as { what?: unknown } | undefined)?.what === 'survey' && !results[0].completed)
      await db.prepare('UPDATE invites SET completed = ?1 WHERE key = ?2 AND completed IS NULL').bind(at, key).run();
  }
  const link = typeof ev.link === 'string' ? ev.link.slice(0, 20) : null;
  // the analysis columns, worked out here from the event itself
  const order = ev.order === 'AB' || ev.order === 'BA' ? ev.order : null;
  const d = (ev.data ?? {}) as Record<string, unknown>;
  const fallback =
    (type === 'error' && d.kind === 'fallback-craft') ||
    (type === 'craft' && Array.isArray(d.results) && d.results.some((r) => !!(r as { fallback?: unknown } | null)?.fallback));
  await db
    .prepare(
      'INSERT INTO events (id, at, participant, link, type, data, run_order, condition, design, fallback_used) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ' +
        'ON CONFLICT(id) DO UPDATE SET at = excluded.at, data = excluded.data, run_order = excluded.run_order, condition = excluded.condition, ' +
        'design = excluded.design, fallback_used = excluded.fallback_used WHERE events.participant = excluded.participant',
    )
    .bind(id, at, participantId, link, type, body, order, conditionOf(order, ev.cond), designOf(ev.cond), fallback ? 1 : 0)
    .run();
  return json(200, { ok: true });
}
