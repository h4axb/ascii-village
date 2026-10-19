// Cloudflare Worker routes for the user test's personal invite links, the
// AI budgets that go with them, and the dashboard's Participants tab. Same
// D1 database as the crafting feedback (binding FEEDBACK_DB); the tables
// create themselves on first use.
//
// A participant gets /intro/1?k=<key> or /intro/2?k=<key> (made on the
// /2/feedback dashboard's Participants tab). The key:
//   - is bound to the first browser that opens it (an HttpOnly cookie)
//   - runs for 3 hours from that first start (a reload inside it continues)
//   - is closed for good once the final survey opens
//   - carries the AI budgets: 6 crafts (3 per design: Mitchy's gift token +
//     2 shop tokens), 3 recrafts per crafted item, 40 other calls (Mitchy's
//     lines, fun facts, prices)
//
//   POST /api/session/start     {key} → the run (or 404/409/410)
//   GET  /api/session/status    the run's budgets and extra tokens
//   POST /api/session/complete  the survey opened: the key is done
//   /api/admin/*                the Participants tab (dashboard password)
//
// gateLlm() runs in front of the LLM proxy (worker/index.ts): every call
// with a key spends from that key's budget; calls without one (the open test
// links /0-/4) share a daily limit.
import { participantIdOf, orderOfLink } from './participant';

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
}
export interface SessionEnv {
  FEEDBACK_DB?: unknown;
  asciia_feedback?: unknown;
  FEEDBACK_ADMIN_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  LLM_OPEN_DAILY_LIMIT?: string;
}

export const RUN_MS = 3 * 60 * 60 * 1000;
export const CRAFTS = 6;
export const RECRAFTS_PER_ITEM = 3;
export const CALLS_PER_CRAFT = 30; // the craft's own calls plus Mitchy's chatter in the panel
export const TALK_CALLS = 40;
const OPEN_DAILY_LIMIT = 300;
export const INVITE_LINKS = ['/intro/1', '/intro/2'];
const COOKIE = 'asciia_dev';

export interface Invite {
  key: string;
  link: string;
  note: string;
  created: number;
  started: number | null;
  device: string | null;
  completed: number | null;
  participant_id: string | null;
  crafts_allowed: number;
  crafts_used: number;
  bonus_tokens: number;
  expires_extra: number;
  talk_used: number;
  consented: number | null; // when the participant agreed to the study (the first start)
  run_order: string | null; // AB or BA, from the link
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS invites (key TEXT PRIMARY KEY, link TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL,
    started INTEGER, device TEXT, completed INTEGER, participant_id TEXT, crafts_allowed INTEGER NOT NULL DEFAULT ${CRAFTS},
    crafts_used INTEGER NOT NULL DEFAULT 0, bonus_tokens INTEGER NOT NULL DEFAULT 0, expires_extra INTEGER NOT NULL DEFAULT 0,
    talk_used INTEGER NOT NULL DEFAULT 0, consented INTEGER, run_order TEXT)`,
  'CREATE TABLE IF NOT EXISTS craft_ids (key TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, item TEXT, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, id))',
  'CREATE TABLE IF NOT EXISTS item_extras (key TEXT NOT NULL, item TEXT NOT NULL, extra INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, item))',
  'CREATE TABLE IF NOT EXISTS llm_open (day TEXT PRIMARY KEY, n INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS participants (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, link TEXT NOT NULL, run_order TEXT NOT NULL)',
];
let ready: Promise<void> | null = null;
export function dbOf(env: SessionEnv): D1Database | null {
  return ((env.FEEDBACK_DB ?? env.asciia_feedback) as D1Database | undefined) ?? null;
}
export async function ensureSchema(db: D1Database) {
  if (!ready) {
    ready = (async () => {
      for (const s of SCHEMA) await db.prepare(s).run();
      // a database made before the consent step: add its column
      const { results } = await db.prepare('PRAGMA table_info(invites)').all<{ name: string }>();
      if (!results.some((c) => c.name === 'consented')) await db.prepare('ALTER TABLE invites ADD COLUMN consented INTEGER').run();
      // the design order the link runs (AB: /intro/1, BA: /intro/2)
      if (!results.some((c) => c.name === 'run_order')) {
        await db.prepare('ALTER TABLE invites ADD COLUMN run_order TEXT').run();
        await db.prepare("UPDATE invites SET run_order = CASE WHEN link LIKE '%/2' THEN 'BA' ELSE 'AB' END").run();
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
export function sameOrigin(request: Request, env: SessionEnv): boolean {
  const origin = request.headers.get('Origin');
  const allowed = [new URL(request.url).origin, ...list(env.ALLOWED_ORIGINS)];
  return !!origin && allowed.includes(origin);
}
// constant-time-ish compare for the dashboard password
export function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function isAdmin(request: Request, env: SessionEnv): boolean {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  return !!env.FEEDBACK_ADMIN_TOKEN && sameToken(token, env.FEEDBACK_ADMIN_TOKEN);
}

// a key nobody can guess: 128 random bits, base32-ish (no 0/O/1/I/L)
export function newKey(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

function cookieOf(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function deviceCookie(request: Request, value: string): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${14 * 24 * 3600}; HttpOnly; SameSite=Lax${secure}`;
}

export const expiresAt = (inv: Invite) => (inv.started ?? Date.now()) + RUN_MS + inv.expires_extra;

async function invite(db: D1Database, key: string): Promise<Invite | null> {
  if (!key || key.length > 64) return null;
  const { results } = await db.prepare('SELECT * FROM invites WHERE key = ?1').bind(key).all<Invite>();
  return results[0] ?? null;
}

// Whether this request may use the key's run: 'ok', or why not
type RunState = 'ok' | 'unknown' | 'finished' | 'expired' | 'other-device' | 'not-started';
function runState(inv: Invite | null, request: Request): RunState {
  if (!inv) return 'unknown';
  if (inv.completed) return 'finished';
  if (!inv.started) return 'not-started';
  if (Date.now() > expiresAt(inv)) return 'expired';
  if (inv.device && cookieOf(request, COOKIE) !== inv.device) return 'other-device';
  return 'ok';
}
const STATUS: Record<Exclude<RunState, 'ok'>, number> = {
  unknown: 404,
  finished: 410,
  expired: 410,
  'other-device': 409,
  'not-started': 403,
};

async function itemExtras(db: D1Database, key: string): Promise<Record<string, number>> {
  const { results } = await db.prepare('SELECT item, extra FROM item_extras WHERE key = ?1').bind(key).all<{ item: string; extra: number }>();
  return Object.fromEntries(results.map((r) => [r.item, r.extra]));
}
async function recraftsUsed(db: D1Database, key: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT item, COUNT(*) AS n FROM craft_ids WHERE key = ?1 AND kind = 'recraft' GROUP BY item")
    .bind(key)
    .all<{ item: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.item, r.n]));
}

// what the game needs to know about its run
async function runInfo(db: D1Database, inv: Invite) {
  return {
    participantId: inv.participant_id,
    order: orderOfLink(inv.link),
    link: inv.link,
    expiresAt: expiresAt(inv),
    crafts: { allowed: inv.crafts_allowed, used: inv.crafts_used },
    recraftsPerItem: RECRAFTS_PER_ITEM,
    itemExtras: await itemExtras(db, inv.key),
    recraftsUsed: await recraftsUsed(db, inv.key),
    bonusTokens: inv.bonus_tokens,
  };
}

async function nextParticipant(db: D1Database, link: string): Promise<string> {
  const { results } = await db
    .prepare('INSERT INTO participants (at, link, run_order) VALUES (?1, ?2, ?3) RETURNING n')
    .bind(Date.now(), link, orderOfLink(link))
    .all<{ n: number }>();
  return participantIdOf(results[0]?.n ?? 0);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (raw.length > 4096) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
const keyOf = (request: Request, body?: Record<string, unknown>) =>
  String(request.headers.get('X-Test-Key') ?? (typeof body?.key === 'string' ? body.key : '') ?? '').trim();

export async function handleSession(request: Request, env: SessionEnv): Promise<Response> {
  const db = dbOf(env);
  if (!db) return json(503, { error: 'no database (FEEDBACK_DB binding in wrangler.jsonc)' });
  await ensureSchema(db);
  const path = new URL(request.url).pathname;

  if (path === '/api/session/start' && request.method === 'POST') {
    if (!sameOrigin(request, env)) return json(403, { error: 'origin not allowed' });
    const body = await readBody(request);
    const inv = await invite(db, keyOf(request, body));
    const st = runState(inv, request);
    if (st === 'not-started' && inv) {
      // the first start needs the participant's consent (App.tsx Consent)
      if (body.consent !== true) return json(428, { error: 'consent' });
      // the first start: this browser owns the run from now on
      const device = newKey();
      const pid = await nextParticipant(db, inv.link);
      const now = Date.now();
      await db
        .prepare('UPDATE invites SET started = ?1, device = ?2, participant_id = ?3, consented = ?1 WHERE key = ?4 AND started IS NULL')
        .bind(now, device, pid, inv.key)
        .run();
      const fresh = (await invite(db, inv.key))!;
      if (fresh.device !== device) return json(409, { error: 'other-device' }); // two first starts at once
      return json(200, { ...(await runInfo(db, fresh)), first: true }, { 'Set-Cookie': deviceCookie(request, device) });
    }
    if (st !== 'ok') return json(STATUS[st], { error: st });
    if (!inv!.device) {
      // reset on the dashboard: this browser owns the run now
      const device = newKey();
      await db.prepare('UPDATE invites SET device = ?1 WHERE key = ?2 AND device IS NULL').bind(device, inv!.key).run();
      return json(200, { ...(await runInfo(db, inv!)), first: false }, { 'Set-Cookie': deviceCookie(request, device) });
    }
    return json(200, { ...(await runInfo(db, inv!)), first: false });
  }

  // what a personal link would do, without starting its run
  if (path === '/api/session/check' && request.method === 'GET') {
    const st = runState(await invite(db, keyOf(request)), request);
    return json(200, { state: st });
  }

  if (path === '/api/session/status' && request.method === 'GET') {
    const inv = await invite(db, keyOf(request));
    const st = runState(inv, request);
    if (st !== 'ok') return json(STATUS[st], { error: st });
    return json(200, await runInfo(db, inv!));
  }

  if (path === '/api/session/complete' && request.method === 'POST') {
    if (!sameOrigin(request, env)) return json(403, { error: 'origin not allowed' });
    const body = await readBody(request);
    const inv = await invite(db, keyOf(request, body));
    const st = runState(inv, request);
    // a second press after completing is fine; an expired run may still finish
    if (st === 'finished') return json(200, { ok: true });
    if (st !== 'ok' && st !== 'expired') return json(STATUS[st], { error: st });
    await db.prepare('UPDATE invites SET completed = ?1 WHERE key = ?2').bind(Date.now(), inv!.key).run();
    return json(200, { ok: true });
  }

  return new Response('Not Found', { status: 404 });
}

// ---- the LLM budget, in front of the proxy ----
// null: go ahead; a Response: refuse with it
export async function gateLlm(request: Request, env: SessionEnv): Promise<Response | null> {
  const db = dbOf(env);
  const key = (request.headers.get('X-Test-Key') ?? '').trim();
  if (!db) return null; // no database: the proxy's own limits only
  await ensureSchema(db);
  if (!key) {
    const day = new Date().toISOString().slice(0, 10);
    const { results } = await db
      .prepare('INSERT INTO llm_open (day, n) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n')
      .bind(day)
      .all<{ n: number }>();
    const limit = Number(env.LLM_OPEN_DAILY_LIMIT) || OPEN_DAILY_LIMIT;
    return (results[0]?.n ?? 0) > limit ? json(429, { error: 'daily limit reached', budget: true }) : null;
  }
  const inv = await invite(db, key);
  const st = runState(inv, request);
  if (st !== 'ok') return json(403, { error: st, budget: true });
  const kind = request.headers.get('X-Craft-Kind');
  const id = (request.headers.get('X-Craft-Id') ?? '').slice(0, 80);
  if ((kind !== 'craft' && kind !== 'recraft') || !id) {
    const { results } = await db
      .prepare(`UPDATE invites SET talk_used = talk_used + 1 WHERE key = ?1 AND talk_used < ${TALK_CALLS} RETURNING talk_used`)
      .bind(key)
      .all<{ talk_used: number }>();
    return results.length ? null : json(429, { error: 'talk budget used up', budget: true });
  }
  // a craft or recraft already counted: its calls (questions, colours, Try again)
  const { results: known } = await db
    .prepare(`UPDATE craft_ids SET calls = calls + 1 WHERE key = ?1 AND id = ?2 AND calls < ${CALLS_PER_CRAFT} RETURNING kind`)
    .bind(key, id)
    .all<{ kind: string }>();
  if (known.length) return null;
  const { results: exists } = await db.prepare('SELECT calls FROM craft_ids WHERE key = ?1 AND id = ?2').bind(key, id).all<{ calls: number }>();
  if (exists.length) return json(429, { error: 'too many calls for one craft', budget: true });
  if (kind === 'craft') {
    const { results } = await db
      .prepare('UPDATE invites SET crafts_used = crafts_used + 1 WHERE key = ?1 AND crafts_used < crafts_allowed RETURNING crafts_used')
      .bind(key)
      .all<{ crafts_used: number }>();
    if (!results.length) return json(429, { error: 'no crafts left', budget: true });
    await db.prepare("INSERT INTO craft_ids (key, id, kind, item, calls) VALUES (?1, ?2, 'craft', NULL, 1)").bind(key, id).run();
    return null;
  }
  const item = (request.headers.get('X-Craft-Item') ?? '').slice(0, 80);
  if (!item) return json(400, { error: 'recraft without an item', budget: true });
  const used = (await recraftsUsed(db, key))[item] ?? 0;
  const extra = (await itemExtras(db, key))[item] ?? 0;
  if (used >= RECRAFTS_PER_ITEM + extra) return json(429, { error: 'no recrafts left for this item', budget: true });
  await db.prepare("INSERT INTO craft_ids (key, id, kind, item, calls) VALUES (?1, ?2, 'recraft', ?3, 1)").bind(key, id, item).run();
  return null;
}

// ---- the dashboard's Participants tab ----
export async function handleAdmin(request: Request, env: SessionEnv): Promise<Response> {
  const db = dbOf(env);
  if (!db) return json(503, { error: 'no database (FEEDBACK_DB binding in wrangler.jsonc)' });
  if (!env.FEEDBACK_ADMIN_TOKEN) return json(503, { error: 'FEEDBACK_ADMIN_TOKEN is not set' });
  if (!isAdmin(request, env)) return json(401, { error: 'wrong password' });
  await ensureSchema(db);
  const path = new URL(request.url).pathname;

  if (path === '/api/admin/invites' && request.method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM invites ORDER BY created DESC LIMIT 2000').all<Invite>();
    const { results: rc } = await db
      .prepare("SELECT key, item, COUNT(*) AS n FROM craft_ids WHERE kind = 'recraft' GROUP BY key, item")
      .all<{ key: string; item: string; n: number }>();
    const { results: ex } = await db.prepare('SELECT key, item, extra FROM item_extras').all<{ key: string; item: string; extra: number }>();
    return json(
      200,
      results.map((r) => ({
        ...r,
        device: r.device ? 'set' : null,
        expiresAt: r.started ? expiresAt(r) : null,
        recrafts: Object.fromEntries(rc.filter((x) => x.key === r.key).map((x) => [x.item, x.n])),
        itemExtras: Object.fromEntries(ex.filter((x) => x.key === r.key).map((x) => [x.item, x.extra])),
      })),
    );
  }

  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!sameOrigin(request, env)) return json(403, { error: 'origin not allowed' });
  const body = await readBody(request);

  if (path === '/api/admin/invites') {
    const n = Math.max(1, Math.min(100, Math.floor(Number(body.count) || 1)));
    const link = INVITE_LINKS.includes(String(body.link)) ? String(body.link) : '/intro/1';
    const note = typeof body.note === 'string' ? body.note.slice(0, 80) : '';
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
      const key = newKey();
      await db
        .prepare('INSERT INTO invites (key, link, note, created, run_order) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(key, link, note, Date.now(), orderOfLink(link))
        .run();
      keys.push(key);
    }
    return json(200, { keys, link });
  }

  const key = typeof body.key === 'string' ? body.key : '';
  const inv = await invite(db, key);
  if (!inv) return json(404, { error: 'unknown key' });
  switch (path) {
    case '/api/admin/note': // the note, changed later
      await db.prepare('UPDATE invites SET note = ?1 WHERE key = ?2').bind(typeof body.note === 'string' ? body.note.slice(0, 80) : '', key).run();
      break;
    case '/api/admin/delete': {
      // the link goes (opening it shows "Link not found"); with data: true
      // also everything its participant recorded (a deletion request)
      await db.prepare('DELETE FROM craft_ids WHERE key = ?1').bind(key).run();
      await db.prepare('DELETE FROM item_extras WHERE key = ?1').bind(key).run();
      await db.prepare('DELETE FROM invites WHERE key = ?1').bind(key).run();
      const removed: Record<string, number> = {};
      if (body.data === true && inv.participant_id) {
        for (const table of ['events', 'feedback']) {
          const { results: has } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(table).all<{ name: string }>();
          if (!has.length) continue;
          const { results } = await db.prepare(`DELETE FROM ${table} WHERE participant = ?1 RETURNING id`).bind(inv.participant_id).all<{ id: string }>();
          removed[table] = results.length;
        }
      }
      return json(200, { ok: true, removed });
    }
    case '/api/admin/token': // +1 crafting token: the game picks it up and adds it
      await db.prepare('UPDATE invites SET crafts_allowed = crafts_allowed + 1, bonus_tokens = bonus_tokens + 1 WHERE key = ?1').bind(key).run();
      break;
    case '/api/admin/recraft': {
      const item = typeof body.item === 'string' ? body.item.slice(0, 80) : '';
      if (!item) return json(400, { error: 'no item' });
      await db
        .prepare('INSERT INTO item_extras (key, item, extra) VALUES (?1, ?2, 1) ON CONFLICT(key, item) DO UPDATE SET extra = extra + 1')
        .bind(key, item)
        .run();
      break;
    }
    case '/api/admin/extend': // +1 hour
      await db.prepare('UPDATE invites SET expires_extra = expires_extra + 3600000 WHERE key = ?1').bind(key).run();
      break;
    case '/api/admin/reset-device': // the next browser to open the link owns it
      await db.prepare('UPDATE invites SET device = NULL WHERE key = ?1').bind(key).run();
      break;
    case '/api/admin/reopen':
      await db.prepare('UPDATE invites SET completed = NULL WHERE key = ?1').bind(key).run();
      break;
    default:
      return new Response('Not Found', { status: 404 });
  }
  return json(200, { ok: true });
}
