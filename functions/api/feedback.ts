// Cloudflare Worker routes for crafting feedback (crafting panel 2, the /2
// link), stored in a Cloudflare D1 database (binding FEEDBACK_DB):
//
//   POST /api/feedback  — the game stores (or updates, same id) one record.
//                         Same-origin only, size-capped, validated with the
//                         shared schema (src/feedback/schema.ts).
//   GET  /api/feedback  — every record, newest first, for the /2/feedback
//                         dashboard. Needs `Authorization: Bearer <token>`
//                         matching the FEEDBACK_ADMIN_TOKEN secret.
//   GET  /api/feedback/tags — public: the tags /1 players wrote, as
//                         {up: [{tag, count}], down: [...]}, top 8 each.
//                         Only tag text, nothing else.
//
// Setup (once) is in docs/Deploy-Cloudflare.md: create the database, put its
// id in wrangler.jsonc, create the table (worker/feedback.sql), set the
// secret. Until then both routes answer 503 and the game keeps feedback in
// the browser's outbox (src/feedback/client.ts) to resend later.
import { cleanTag, conditionOf, designOf, normalizeFeedback } from '../../src/feedback/schema';

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
  // the name `wrangler d1 create asciia-feedback` writes into wrangler.jsonc
  // on its own — accepted too, so either binding name works
  asciia_feedback?: D1Database;
  FEEDBACK_ADMIN_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
}

const MAX_BODY_BYTES = 48 * 1024;
const MAX_ROWS = 10000;
const TAG_LINKS = ['/1', '/intro/1'];
const TAGS_SHOWN = 8;

// [{tag, count}] over the records' own tags, most used first; tags are
// matched ignoring case and spacing, and re-checked before going public
export function topTags(records: { tags?: unknown }[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const r of records) {
    for (const raw of Array.isArray(r.tags) ? r.tags : []) {
      const tag = cleanTag(raw);
      if (!tag) continue;
      const key = tag.toLowerCase();
      const e = counts.get(key);
      if (e) e.count++;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, TAGS_SHOWN);
}
export function tagsByVote(records: { tags?: unknown; vote?: unknown }[]) {
  return {
    up: topTags(records.filter((r) => r.vote === 'up')),
    down: topTags(records.filter((r) => r.vote === 'down')),
  };
}

// The user test's analysis columns (src/feedback/schema.ts designOf,
// conditionOf): participant, run_order (AB/BA), condition (1/2), design
// (A/B), fallback_used (0/1), fallback_reason. Filled by the server from each
// record on insert; a table made before them gets them added, and rows
// already stored are filled from their JSON (here and in events.ts).
export const SQL_DESIGN = (j: string) => `CASE json_extract(${j},'$.cond') WHEN 'pre' THEN 'A' WHEN 'post' THEN 'B' END`;
export const SQL_CONDITION = (j: string, order: string) =>
  `CASE WHEN ${order} = 'AB' THEN (CASE json_extract(${j},'$.cond') WHEN 'pre' THEN 1 WHEN 'post' THEN 2 END) ` +
  `WHEN ${order} = 'BA' THEN (CASE json_extract(${j},'$.cond') WHEN 'post' THEN 1 WHEN 'pre' THEN 2 END) END`;
export async function addColumns(db: D1Database, table: string, cols: [string, string][]): Promise<boolean> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const have = new Set(results.map((c) => c.name));
  let added = false;
  for (const [name, type] of cols) {
    if (have.has(name)) continue;
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
    added = true;
  }
  return added;
}
let columnsReady: Promise<void> | null = null;
function ensureColumns(db: D1Database) {
  columnsReady ??= (async () => {
    await addColumns(db, 'feedback', [
      ['participant', 'TEXT'],
      ['run_order', 'TEXT'],
      ['condition', 'INTEGER'],
      ['design', 'TEXT'],
      ['fallback_used', 'INTEGER'],
      ['fallback_reason', 'TEXT'],
    ]);
    // rows stored before the columns: filled once from their JSON
    await db
      .prepare(
        `UPDATE feedback SET participant = json_extract(data,'$.participant'), run_order = json_extract(data,'$.order'), ` +
          `design = ${SQL_DESIGN('data')}, condition = ${SQL_CONDITION('data', "json_extract(data,'$.order')")}, ` +
          `fallback_used = CASE WHEN json_extract(data,'$.fallback') IS NOT NULL THEN 1 ELSE 0 END, ` +
          `fallback_reason = json_extract(data,'$.fallback.why') WHERE fallback_used IS NULL`,
      )
      .run();
    // ratings made before results carried their fallback flag: a fallback the
    // run log noted for the same participant and prompt within a minute
    const { results: hasEvents } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'").all<{ name: string }>();
    await db.prepare('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, at INTEGER NOT NULL)').run();
    const { results: done } = await db.prepare("SELECT name FROM migrations WHERE name = 'feedback-fallback-from-events'").all<{ name: string }>();
    if (hasEvents.length && !done.length) {
      {
        await db
          .prepare(
            `UPDATE feedback SET fallback_used = 1, fallback_reason = (SELECT json_extract(e.data,'$.data.why') FROM events e ` +
              `WHERE e.participant = feedback.participant AND e.type = 'error' AND json_extract(e.data,'$.data.kind') = 'fallback-craft' ` +
              `AND json_extract(e.data,'$.data.prompt') = substr(json_extract(feedback.data,'$.prompt'), 1, 200) AND abs(e.at - feedback.at) < 60000 LIMIT 1) ` +
              `WHERE fallback_used = 0 AND json_extract(data,'$.fallback') IS NULL AND EXISTS (SELECT 1 FROM events e ` +
              `WHERE e.participant = feedback.participant AND e.type = 'error' AND json_extract(e.data,'$.data.kind') = 'fallback-craft' ` +
              `AND json_extract(e.data,'$.data.prompt') = substr(json_extract(feedback.data,'$.prompt'), 1, 200) AND abs(e.at - feedback.at) < 60000)`,
          )
          .run();
        // records stored without the design (crafts from the reference
        // library): the design the run log shows for that moment
        await db
          .prepare(
            `UPDATE feedback SET design = CASE (SELECT json_extract(e.data,'$.cond') FROM events e WHERE e.participant = feedback.participant AND json_extract(e.data,'$.cond') IS NOT NULL AND e.at <= feedback.at + 5000 ORDER BY e.at DESC LIMIT 1) WHEN 'pre' THEN 'A' WHEN 'post' THEN 'B' END, ` +
              `condition = CASE WHEN run_order = 'AB' THEN (CASE (SELECT json_extract(e.data,'$.cond') FROM events e WHERE e.participant = feedback.participant AND json_extract(e.data,'$.cond') IS NOT NULL AND e.at <= feedback.at + 5000 ORDER BY e.at DESC LIMIT 1) WHEN 'pre' THEN 1 WHEN 'post' THEN 2 END) ` +
              `WHEN run_order = 'BA' THEN (CASE (SELECT json_extract(e.data,'$.cond') FROM events e WHERE e.participant = feedback.participant AND json_extract(e.data,'$.cond') IS NOT NULL AND e.at <= feedback.at + 5000 ORDER BY e.at DESC LIMIT 1) WHEN 'post' THEN 1 WHEN 'pre' THEN 2 END) END ` +
              `WHERE design IS NULL AND participant IS NOT NULL`,
          )
          .run();
        // once only: later ratings carry their own flag
        await db.prepare("INSERT OR IGNORE INTO migrations (name, at) VALUES ('feedback-fallback-from-events', ?1)").bind(Date.now()).run();
      }
    }
  })().catch((e) => {
    columnsReady = null;
    throw e;
  });
  return columnsReady;
}

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
  const db = env.FEEDBACK_DB ?? env.asciia_feedback;
  if (!db) return json(503, { error: 'feedback storage is not set up (no FEEDBACK_DB binding in wrangler.jsonc)' });
  await ensureColumns(db);

  if (request.method === 'GET' && new URL(request.url).pathname === '/api/feedback/tags') {
    const { results } = await db
      .prepare(`SELECT data FROM feedback WHERE link IN (${TAG_LINKS.map((_, i) => `?${i + 1}`).join(', ')}) ORDER BY at DESC LIMIT ${MAX_ROWS}`)
      .bind(...TAG_LINKS)
      .all<{ data: string }>();
    const recs = results.map((r) => {
      try {
        return JSON.parse(r.data) as { tags?: unknown; vote?: unknown };
      } catch {
        return {};
      }
    });
    return new Response(JSON.stringify(tagsByVote(recs)), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
  }

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
        'INSERT INTO feedback (id, at, player, link, kind, vote, data, participant, run_order, condition, design, fallback_used, fallback_reason) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ' +
          'ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, vote = excluded.vote, data = excluded.data, participant = excluded.participant, ' +
          'run_order = excluded.run_order, condition = excluded.condition, design = excluded.design, ' +
          'fallback_used = excluded.fallback_used, fallback_reason = excluded.fallback_reason ' +
          'WHERE feedback.player = excluded.player',
      )
      .bind(
        rec.id,
        rec.at,
        rec.player,
        rec.link,
        rec.kind,
        rec.vote ?? 'none',
        JSON.stringify(rec),
        rec.participant ?? null,
        rec.order ?? null,
        conditionOf(rec.order, rec.cond),
        designOf(rec.cond),
        rec.fallback ? 1 : 0,
        rec.fallback?.why ?? null,
      )
      .run();
    return json(200, { ok: true });
  }

  if (request.method === 'GET') {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!env.FEEDBACK_ADMIN_TOKEN) return json(503, { error: 'FEEDBACK_ADMIN_TOKEN is not set' });
    if (!token || !sameToken(token, env.FEEDBACK_ADMIN_TOKEN)) return json(401, { error: 'wrong password' });
    // an id changed on the dashboard before the record followed it: the
    // column is the truth (session.ts /api/admin/participant), and the
    // stored record is set to it once
    await db
      .prepare("UPDATE feedback SET data = json_set(data, '$.participant', participant) WHERE participant IS NOT NULL AND participant != '' AND json_extract(data, '$.participant') IS NOT participant")
      .run();
    const { results } = await db
      .prepare('SELECT participant, data FROM feedback ORDER BY at DESC LIMIT ?1')
      .bind(MAX_ROWS)
      .all<{ participant: string | null; data: string }>();
    const rows = results.map((r) => {
      try {
        const rec = JSON.parse(r.data);
        return r.participant ? { ...rec, participant: r.participant } : rec;
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
