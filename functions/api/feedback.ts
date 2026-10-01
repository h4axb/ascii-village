// Cloudflare Worker routes for crafting feedback (crafting panel 2, the /2
// link), stored in a Cloudflare D1 database (binding FEEDBACK_DB):
//
//   POST /api/feedback  — the game stores (or updates, same id) one record.
//                         Same-origin only, size-capped, validated with the
//                         shared schema (src/feedback/schema.ts).
//   GET  /api/feedback  — every record, newest first, for the /2/feedback
//                         dashboard. Needs `Authorization: Bearer <token>`
//                         matching the FEEDBACK_ADMIN_TOKEN secret.
//
// Setup (once) is in docs/Deploy-Cloudflare.md: create the database, put its
// id in wrangler.jsonc, create the table (worker/feedback.sql), set the
// secret. Until then both routes answer 503 and the game keeps feedback in
// the browser's outbox (src/feedback/client.ts) to resend later.
import { normalizeFeedback } from '../../src/feedback/schema';

// Minimal slice of Cloudflare's D1 API — avoids pulling in
// @cloudflare/workers-types for these few calls.
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}
interface D1Database {
  prepare(sql: string): D1Statement;
}

export interface FeedbackEnv {
  FEEDBACK_DB?: D1Database;
  FEEDBACK_ADMIN_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
}

const MAX_BODY_BYTES = 48 * 1024;
const MAX_ROWS = 10000;

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// constant-time-ish string compare for the admin token
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function handleFeedback(request: Request, env: FeedbackEnv): Promise<Response> {
  if (!env.FEEDBACK_DB) return json(503, { error: 'feedback storage is not set up (FEEDBACK_DB)' });
  const db = env.FEEDBACK_DB;

  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    const allowed = [new URL(request.url).origin, ...list(env.ALLOWED_ORIGINS)];
    if (!origin || !allowed.includes(origin)) return json(403, { error: 'origin not allowed' });
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'record too large' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json(400, { error: 'invalid JSON' });
    }
    const rec = normalizeFeedback(parsed);
    if (typeof rec === 'string') return json(400, { error: rec });
    // An update (tuning answers added later) only from the same player.
    await db
      .prepare(
        'INSERT INTO feedback (id, at, player, link, kind, vote, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ' +
          'ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, vote = excluded.vote, data = excluded.data ' +
          'WHERE feedback.player = excluded.player',
      )
      .bind(rec.id, rec.at, rec.player, rec.link, rec.kind, rec.vote, JSON.stringify(rec))
      .run();
    return json(200, { ok: true });
  }

  if (request.method === 'GET') {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!env.FEEDBACK_ADMIN_TOKEN) return json(503, { error: 'FEEDBACK_ADMIN_TOKEN is not set' });
    if (!token || !sameToken(token, env.FEEDBACK_ADMIN_TOKEN)) return json(401, { error: 'wrong password' });
    const { results } = await db
      .prepare('SELECT data FROM feedback ORDER BY at DESC LIMIT ?1')
      .bind(MAX_ROWS)
      .all<{ data: string }>();
    const rows = results.map((r) => {
      try {
        return JSON.parse(r.data);
      } catch {
        return null;
      }
    });
    return json(200, rows.filter(Boolean));
  }

  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
}

// Same code as a Pages Function, if the project is ever deployed to Pages.
export const onRequest = ({ request, env }: { request: Request; env: FeedbackEnv }) => handleFeedback(request, env);
