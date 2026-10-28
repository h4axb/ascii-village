// The study dashboard's own data (/feedback, src/study/): the imported Tally
// answers, the session notes split into statements, their tags, the
// recurring findings, the per-participant corrections, figure captions and
// hypotheses. One table of JSON documents; dashboard password only.
//
//   GET    /api/study                 every document
//   PUT    /api/study/<coll>/<id>     store (replace) one document
//   DELETE /api/study/<coll>/<id>     remove one
//   POST   /api/study/batch           several puts/deletes at once {put: [...], del: [...]}
//   POST   /api/study/suggest         AI tag suggestions for statements (never stored:
//                                    the dashboard shows them as suggestions to confirm)
//   POST   /api/study/cluster         AI: similar statements of several participants as
//                                    recurring findings (proposals, checked before storing)
//   POST   /api/study/rewrite         AI: statements reworded by given criteria (proposals,
//                                    checked and editable before storing)
//   POST   /api/study/translate       AI translations of notes and survey texts (the
//                                    dashboard stores them as editable drafts)
//   GET    /api/study/versions        the saved states of all documents (id, time, reason)
//   POST   /api/study/versions        save the current state {reason} → {id}
//   GET    /api/study/versions/<id>   one saved state: every document as it was
//   GET    /api/study/game[/<id>]     the game data the dashboard works with (accepted
//                                    stand; the newest, or one by id) and the live data
//   POST   /api/study/game            take over records of the live game data
//                                    {accept: {invites, events, feedback}, drop: {…}, reason}
//                                    (nothing of the game's own changes is used unasked)
import { dbOf, handleAdmin, isAdmin, json, type D1Database, type SessionEnv } from './session';
import { handleEvents } from './events';
import { handleFeedback, type FeedbackEnv } from './feedback';

export const STUDY_COLLS = ['tally', 'notes', 'items', 'findings', 'tags', 'people', 'captions', 'hypotheses', 'claims', 'settings'] as const;
type Coll = (typeof STUDY_COLLS)[number];

interface StudyEnv extends SessionEnv {
  'asciia-bay-crafting'?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  STUDY_FAKE_AI?: string; // dev only (vite.config.ts): translations without a key
}

const MAX_DOC = 900_000; // D1 row limit is 1 MB

let ready: Promise<unknown> | null = null;
function ensure(db: D1Database) {
  ready ??= db
    .prepare('CREATE TABLE IF NOT EXISTS study (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (coll, id))')
    .run()
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

// ---- saved states: every document at one moment, gzipped, in parts under the row limit ----
let versionsReady: Promise<unknown> | null = null;
function ensureVersions(db: D1Database) {
  versionsReady ??= db
    .prepare('CREATE TABLE IF NOT EXISTS study_versions (id TEXT NOT NULL, part INTEGER NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, part))')
    .run()
    .catch((e) => {
      versionsReady = null;
      throw e;
    });
  return versionsReady;
}
const PART = 800_000;
async function gzip(text: string): Promise<string> {
  const buf = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzip(b64: string): Promise<string> {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
async function allDocs(db: D1Database) {
  const { results } = await db.prepare('SELECT coll, id, data FROM study').all<{ coll: string; id: string; data: string }>();
  const out: Record<string, Record<string, unknown>> = Object.fromEntries(STUDY_COLLS.map((c) => [c, {}]));
  for (const r of results) {
    try {
      (out[r.coll] ??= {})[r.id] = JSON.parse(r.data);
    } catch {
      // a broken row: skipped
    }
  }
  return out;
}
async function versions(request: Request, db: D1Database, id?: string): Promise<Response> {
  await ensureVersions(db);
  if (request.method === 'GET' && !id) {
    const { results } = await db.prepare('SELECT id, at, reason, size FROM study_versions WHERE part = 0 ORDER BY at DESC LIMIT 500').all<{ id: string; at: number; reason: string; size: number }>();
    return json(200, results);
  }
  if (request.method === 'GET' && id) {
    const { results } = await db.prepare('SELECT data FROM study_versions WHERE id = ?1 ORDER BY part').bind(id).all<{ data: string }>();
    if (!results.length) return json(404, { error: 'unknown version' });
    return new Response(await gunzip(results.map((r) => r.data).join('')), { headers: { 'Content-Type': 'application/json' } });
  }
  if (request.method === 'POST' && !id) {
    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = String(body?.reason ?? 'gesichert').slice(0, 200);
    await ensureGame(db);
    const g = (await db.prepare('SELECT id FROM study_game WHERE part = 0 ORDER BY at DESC LIMIT 1').all<{ id: string }>()).results[0];
    const text = JSON.stringify({ ...(await allDocs(db)), _game: g?.id ?? null });
    const packed = await gzip(text);
    const vid = `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const at = Date.now();
    for (let k = 0; k * PART < packed.length || k === 0; k++)
      await db.prepare('INSERT INTO study_versions (id, part, at, reason, size, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(vid, k, at, reason, text.length, packed.slice(k * PART, (k + 1) * PART)).run();
    return json(200, { id: vid, at });
  }
  return json(405, { error: 'method not allowed' });
}

// ---- the accepted game data: a stand of links, events and ratings, changed only by "accept" ----
type GameKind = 'invites' | 'events' | 'feedback';
type GameData = Record<GameKind, Record<string, unknown>[]>;
const GAME_KEY: Record<GameKind, string> = { invites: 'key', events: 'id', feedback: 'id' };
let gameReady: Promise<unknown> | null = null;
function ensureGame(db: D1Database) {
  gameReady ??= db
    .prepare('CREATE TABLE IF NOT EXISTS study_game (id TEXT NOT NULL, part INTEGER NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, part))')
    .run()
    .catch((e) => {
      gameReady = null;
      throw e;
    });
  return gameReady;
}
// the game's live data, through its own routes (the same shape the dashboards get)
async function liveGame(request: Request, env: StudyEnv): Promise<GameData> {
  const origin = new URL(request.url).origin;
  const headers = { Authorization: request.headers.get('Authorization') ?? '' };
  const get = async (r: Promise<Response>) => {
    const res = await r;
    const d = (await res.json().catch(() => [])) as unknown;
    return (Array.isArray(d) ? d : []) as Record<string, unknown>[];
  };
  const [invites, events, feedback] = await Promise.all([
    get(handleAdmin(new Request(`${origin}/api/admin/invites`, { headers }), env)),
    get(handleEvents(new Request(`${origin}/api/events`, { headers }), env)),
    get(handleFeedback(new Request(`${origin}/api/feedback`, { headers }), env as FeedbackEnv)),
  ]);
  return { invites, events, feedback };
}
async function loadGame(db: D1Database, id?: string): Promise<{ id: string; at: number; reason: string; data: GameData } | null> {
  type Head = { id: string; at: number; reason: string };
  const head = (
    id
      ? await db.prepare('SELECT id, at, reason FROM study_game WHERE id = ?1 AND part = 0').bind(id).all<Head>()
      : await db.prepare('SELECT id, at, reason FROM study_game WHERE part = 0 ORDER BY at DESC LIMIT 1').all<Head>()
  ).results[0];
  if (!head) return null;
  const { results } = await db.prepare('SELECT data FROM study_game WHERE id = ?1 ORDER BY part').bind(head.id).all<{ data: string }>();
  return { ...head, data: JSON.parse(await gunzip(results.map((r) => r.data).join(''))) as GameData };
}
async function game(request: Request, env: StudyEnv, db: D1Database, id?: string): Promise<Response> {
  await ensureGame(db);
  if (request.method === 'GET' && id === 'list') {
    const { results } = await db.prepare('SELECT id, at, reason FROM study_game WHERE part = 0 ORDER BY at DESC LIMIT 200').all<{ id: string; at: number; reason: string }>();
    return json(200, results);
  }
  if (request.method === 'GET') {
    const stand = await loadGame(db, id);
    return json(200, { stand, live: id ? null : await liveGame(request, env) });
  }
  if (request.method === 'POST' && !id) {
    const body = (await request.json().catch(() => null)) as { accept?: Partial<Record<GameKind, string[]>>; drop?: Partial<Record<GameKind, string[]>>; reason?: string } | null;
    if (!body) return json(400, { error: 'invalid JSON' });
    const prev = await loadGame(db);
    const live = await liveGame(request, env);
    const next = {} as GameData;
    for (const kind of Object.keys(GAME_KEY) as GameKind[]) {
      const k = GAME_KEY[kind];
      const byId = new Map((prev?.data[kind] ?? []).map((r) => [String(r[k]), r]));
      const take = new Set(body.accept?.[kind] ?? []);
      for (const r of live[kind]) if (take.has(String(r[k]))) byId.set(String(r[k]), r);
      for (const gone of body.drop?.[kind] ?? []) byId.delete(gone);
      next[kind] = [...byId.values()];
    }
    const packed = await gzip(JSON.stringify(next));
    const gid = `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const at = Date.now();
    const reason = String(body.reason ?? 'Spieldaten übernommen').slice(0, 200);
    for (let k = 0; k * PART < packed.length || k === 0; k++)
      await db.prepare('INSERT INTO study_game (id, part, at, reason, data) VALUES (?1, ?2, ?3, ?4, ?5)').bind(gid, k, at, reason, packed.slice(k * PART, (k + 1) * PART)).run();
    return json(200, { stand: { id: gid, at, reason, data: next } });
  }
  return json(405, { error: 'method not allowed' });
}

const isColl = (c: string): c is Coll => (STUDY_COLLS as readonly string[]).includes(c);

async function put(db: D1Database, coll: string, id: string, data: unknown) {
  const text = JSON.stringify(data);
  if (text.length > MAX_DOC) throw new Error(`document too large (${coll}/${id})`);
  await db
    .prepare('INSERT INTO study (coll, id, data, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
    .bind(coll, id, text, Date.now())
    .run();
}

export async function handleStudy(request: Request, env: StudyEnv): Promise<Response> {
  const db = dbOf(env);
  if (!db) return json(503, { error: 'no database (FEEDBACK_DB binding in wrangler.jsonc)' });
  if (!isAdmin(request, env)) return json(401, { error: 'wrong password' });
  await ensure(db);
  const parts = new URL(request.url).pathname.split('/').filter(Boolean).slice(2); // after /api/study

  if (request.method === 'GET' && parts.length === 0) return json(200, await allDocs(db));
  if (parts[0] === 'versions') return versions(request, db, parts[1]);
  if (parts[0] === 'game') return game(request, env, db, parts[1]);

  if (request.method === 'POST' && parts[0] === 'batch') {
    const body = (await request.json().catch(() => null)) as { put?: { coll: string; id: string; data: unknown }[]; del?: { coll: string; id: string }[] } | null;
    if (!body) return json(400, { error: 'invalid JSON' });
    for (const d of body.put ?? []) if (!isColl(d.coll) || !d.id) return json(400, { error: `bad document ${d.coll}/${d.id}` });
    for (const d of body.put ?? []) await put(db, d.coll, String(d.id).slice(0, 200), d.data);
    for (const d of body.del ?? []) if (isColl(d.coll)) await db.prepare('DELETE FROM study WHERE coll = ?1 AND id = ?2').bind(d.coll, String(d.id)).run();
    return json(200, { ok: true });
  }

  if (request.method === 'POST' && parts[0] === 'suggest') return suggest(request, env);
  if (request.method === 'POST' && parts[0] === 'translate') return translate(request, env);
  if (request.method === 'POST' && parts[0] === 'cluster') return cluster(request, env);
  if (request.method === 'POST' && parts[0] === 'rewrite') return rewrite(request, env);

  const [coll, id] = parts;
  if (!coll || !id || !isColl(coll)) return json(404, { error: 'unknown collection' });
  if (request.method === 'PUT') {
    const data = await request.json().catch(() => undefined);
    if (data === undefined) return json(400, { error: 'invalid JSON' });
    await put(db, coll, id.slice(0, 200), data);
    return json(200, { ok: true });
  }
  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM study WHERE coll = ?1 AND id = ?2').bind(coll, id).run();
    return json(200, { ok: true });
  }
  return json(405, { error: 'method not allowed' });
}

// the model's answer as JSON: code fences, text around the object and an
// answer cut off at the length limit (the complete entries of its list) are
// all read; null only when nothing usable is in it
function readJson(text: string, list?: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const tryParse = (x: string) => {
    try {
      return JSON.parse(x) as unknown;
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(t);
  if (whole !== undefined) return whole;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    const inner = tryParse(t.slice(a, b + 1));
    if (inner !== undefined) return inner;
  }
  // cut off: the entries of the list that are complete
  if (!list) return null;
  const at = t.indexOf(`"${list}"`);
  const open = at >= 0 ? t.indexOf('[', at) : -1;
  if (open < 0) return null;
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = open + 1; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const v = tryParse(t.slice(start, i + 1));
        if (v !== undefined) out.push(v);
        start = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return out.length ? { [list]: out } : null;
}

async function chat(env: StudyEnv, key: string, system: string, user: string, list?: string, maxTokens = 8000): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  const base = (env.LLM_BASE_URL || 'https://router.requesty.ai/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }).catch(() => null);
  if (!res?.ok) return { ok: false, res: json(502, { error: `AI unavailable (${res?.status ?? 'network'})` }) };
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string }; finish_reason?: string }[] } | null;
  const text = data?.choices?.[0]?.message?.content ?? '';
  const value = readJson(text, list);
  if (value == null) return { ok: false, res: json(502, { error: `AI answer was not JSON${data?.choices?.[0]?.finish_reason === 'length' ? ' (cut off: too long)' : ''}` }) };
  return { ok: true, value };
}

// ---- AI translations ----
// Faithful, neutral translations of note statements and survey texts; text
// already in the target language comes back as it is. Only drafts: the
// dashboard marks them "automatisch" until they are edited.
async function translate(request: Request, env: StudyEnv): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { texts?: { id: string; text: string }[]; to?: 'de' | 'en' } | null;
  const texts = (body?.texts ?? []).filter((t) => t && typeof t.text === 'string').slice(0, 40);
  if (!texts.length) return json(400, { error: 'texts required' });
  const to = body?.to === 'en' ? 'en' : 'de';
  const key = env['asciia-bay-crafting'] ?? env.LLM_API_KEY;
  if (!key) {
    if (env.STUDY_FAKE_AI === '1') return json(200, { translations: texts.map((t) => ({ id: t.id, text: `[${to.toUpperCase()}] ${t.text}` })) });
    return json(503, { error: 'no AI key on the server' });
  }
  const lang = to === 'de' ? 'Deutsch' : 'Englisch';
  const system =
    `Du übersetzt Notizen und Umfragetexte aus einem Usability-Test eines Spiels ins ${lang}. Antworte nur mit JSON. ` +
    'Übersetze sinngetreu und neutral, ohne etwas hinzuzufügen, wegzulassen oder zu deuten; behalte Stichpunktstil und Kürze bei. ' +
    `Texte, die schon auf ${lang} sind, gib unverändert zurück; gemischte Texte vollständig auf ${lang}. ` +
    'Behalte Teilnehmer-IDs (P001), Eigennamen (Mitchy, Asciia Bay), Variante A/B und Zahlen unverändert.';
  const user = JSON.stringify({ texte: texts.map((t) => ({ id: t.id, text: t.text.slice(0, 2000) })), format: { texte: [{ id: 'string', text: 'string' }] } });
  const r = await chat(env, key, system, user, 'texte');
  if (!r.ok) return r.res;
  const out = (r.value as { texte?: { id?: string; text?: string }[] }).texte ?? [];
  return json(200, { translations: out.filter((t) => t?.id && typeof t.text === 'string') });
}

// ---- AI tag suggestions ----
// The dashboard sends statements and the current tag vocabulary; the model
// answers, per statement, which existing chips fit (and which recurring
// finding it repeats). Only suggestions: nothing counts until confirmed.
async function suggest(request: Request, env: StudyEnv): Promise<Response> {
  const key = env['asciia-bay-crafting'] ?? env.LLM_API_KEY;
  if (!key && env.STUDY_FAKE_AI !== '1') return json(503, { error: 'no AI key on the server' });
  const body = (await request.json().catch(() => null)) as {
    items?: { id: string; text: string; section?: string; question?: string }[];
    groups?: { id: string; name: string; multi?: boolean; chips: { id: string; label: string }[] }[];
    findings?: { id: string; name: string }[];
  } | null;
  if (!body?.items?.length || !body.groups) return json(400, { error: 'items and groups required' });
  const groups = body.groups;
  const items = body.items.slice(0, 40);
  if (!key)
    return json(200, { suggestions: items.map((i) => ({ id: i.id, chips: Object.fromEntries(groups.map((g) => [g.id, g.chips.slice(0, 1).map((c) => c.id)])), finding: null, newFinding: null })) });
  const system =
    'Du ordnest Rückmeldungen aus einem Usability-Test eines Spiels ein. Antworte nur mit einem JSON-Objekt, ohne Text davor oder danach. ' +
    'Wähle für jede Aussage pro Kategorie die passenden Chips ausschließlich aus der gegebenen Liste (IDs). ' +
    'Bei Kategorien ohne "multi" höchstens einen Chip. Wenn nichts passt, lass die Kategorie weg. ' +
    'Ordne eine Aussage einem bestehenden wiederkehrenden Befund nur zu, wenn sie inhaltlich dasselbe Problem oder Lob beschreibt. ' +
    'Schlage für neue, eindeutig benennbare Befunde einen kurzen neutralen Namen vor (newFinding), sonst null.';
  const ask = async (part: typeof items): Promise<{ ok: true; list: unknown[] } | { ok: false; res: Response }> => {
    const user = JSON.stringify({
      kategorien: groups.map((g) => ({ id: g.id, name: g.name, multi: !!g.multi, chips: g.chips })),
      befunde: body.findings ?? [],
      aussagen: part.map((i) => ({ id: i.id, text: i.text.slice(0, 1500), abschnitt: i.section, frage: i.question })),
      format: { aussagen: [{ id: 'string', chips: { '<kategorie-id>': ['<chip-id>'] }, finding: '<befund-id> | null', newFinding: 'string | null' }] },
    });
    const r = await chat(env, key, system, user, 'aussagen');
    const list = r.ok ? (r.value as { aussagen?: unknown }).aussagen : undefined;
    if (r.ok && Array.isArray(list)) {
      // (a cut-off answer: the statements it did not reach are asked again)
      const got = new Set(list.map((x) => (x as { id?: string })?.id));
      const missing = part.filter((i) => !got.has(i.id));
      if (!missing.length || missing.length === part.length) return { ok: true, list };
      const more = await ask(missing);
      return more.ok ? { ok: true, list: [...list, ...more.list] } : { ok: true, list };
    }
    // (unreadable: half as many at a time)
    if (part.length > 1) {
      const mid = Math.ceil(part.length / 2);
      const x = await ask(part.slice(0, mid));
      if (!x.ok) return x;
      const y = await ask(part.slice(mid));
      if (!y.ok) return y;
      return { ok: true, list: [...x.list, ...y.list] };
    }
    return r.ok ? { ok: false, res: json(502, { error: 'AI answer was not JSON' }) } : r;
  };
  const r = await ask(items);
  if (!r.ok) return r.res;
  return json(200, { suggestions: r.list });
}

// ---- AI: recurring findings ----
// Statements of the test that say the same thing (a problem, praise or a
// behaviour) grouped across participants, each group with a short neutral
// name and an objective description fit for a thesis. Only proposals: the
// dashboard shows them for checking and editing before anything is stored.
type ClusterItem = { id: string; person: string; text: string; section?: string; question?: string };
type ClusterGroup = { name?: string; description?: string; ids?: string[]; finding?: string | null };
async function cluster(request: Request, env: StudyEnv): Promise<Response> {
  const key = env['asciia-bay-crafting'] ?? env.LLM_API_KEY;
  if (!key && env.STUDY_FAKE_AI !== '1') return json(503, { error: 'no AI key on the server' });
  const body = (await request.json().catch(() => null)) as { items?: ClusterItem[]; findings?: { id: string; name: string; description?: string }[] } | null;
  const items = (body?.items ?? []).filter((i) => i && typeof i.text === 'string' && i.id && i.person).slice(0, 300);
  if (items.length < 2) return json(400, { error: 'at least two statements required' });
  const findings = body?.findings ?? [];
  const persons = new Map(items.map((i) => [i.id, i.person]));
  // (a group counts only with two or more participants; each statement in one group)
  const clean = (groups: ClusterGroup[]) => {
    const used = new Set<string>();
    const out: { name: string; description: string; ids: string[]; finding: string | null }[] = [];
    for (const g of groups) {
      const ids = (g.ids ?? []).filter((id) => persons.has(id) && !used.has(id));
      if (new Set(ids.map((id) => persons.get(id))).size < 2 || !g.name) continue;
      ids.forEach((id) => used.add(id));
      out.push({ name: String(g.name).slice(0, 120), description: String(g.description ?? '').slice(0, 800), ids, finding: g.finding && findings.some((f) => f.id === g.finding) ? g.finding : null });
    }
    return out;
  };
  if (!key) {
    // (test mode without a key: statements sharing a longer word)
    const byWord = new Map<string, string[]>();
    for (const i of items) for (const w of new Set(i.text.toLowerCase().match(/[a-zäöüß]{6,}/g) ?? [])) byWord.set(w, [...(byWord.get(w) ?? []), i.id]);
    const groups = [...byWord].sort((a, b) => b[1].length - a[1].length).map(([w, ids]) => ({ name: `Wiederkehrend: ${w}`, description: `Mehrere Testpersonen äußerten sich zu „${w}“.`, ids, finding: null }));
    return json(200, { groups: clean(groups) });
  }
  const system =
    'Du wertest Notizen eines Usability-Tests eines Spiels für eine Bachelorarbeit aus. Antworte nur mit einem JSON-Objekt, ohne Text davor oder danach. ' +
    'Bilde Gruppen aus Aussagen verschiedener Testpersonen, die dasselbe Problem, dasselbe Lob oder dasselbe Verhalten beschreiben. ' +
    'Eine Gruppe braucht Aussagen von mindestens zwei verschiedenen Testpersonen; jede Aussage gehört höchstens zu einer Gruppe; Aussagen ohne Entsprechung lässt du weg. ' +
    'name: kurz, neutral, höchstens acht Wörter, auf Deutsch. ' +
    'description: ein bis drei Sätze auf Deutsch, sachlich und wissenschaftlich formuliert, wie in einer Bachelorarbeit: beschreibt das beobachtete Muster, ohne Wertung, ohne Zitate, ohne Zahlen zu erfinden. ' +
    'Passt eine Gruppe zu einem bestehenden Befund, gib dessen id in finding an, sonst null.';
  const ask = async (part: ClusterItem[]): Promise<{ ok: true; groups: ClusterGroup[] } | { ok: false; res: Response }> => {
    const user = JSON.stringify({
      befunde: findings.map((f) => ({ id: f.id, name: f.name, description: f.description ?? '' })),
      aussagen: part.map((i) => ({ id: i.id, person: i.person, text: i.text.slice(0, 500), abschnitt: i.section, frage: i.question })),
      format: { befunde: [{ name: 'string', description: 'string', ids: ['<aussage-id>'], finding: '<befund-id> | null' }] },
    });
    const r = await chat(env, key, system, user, 'befunde');
    const list = r.ok ? (r.value as { befunde?: unknown }).befunde : undefined;
    if (r.ok && Array.isArray(list)) return { ok: true, groups: list as ClusterGroup[] };
    // (unreadable: the statements in two halves, by participant so groups can still form)
    if (part.length > 40) {
      const sorted = [...part].sort((a, b) => a.person.localeCompare(b.person));
      const mid = Math.ceil(sorted.length / 2);
      const x = await ask(sorted.slice(0, mid));
      const y = await ask(sorted.slice(mid));
      if (!x.ok && !y.ok) return x;
      return { ok: true, groups: [...(x.ok ? x.groups : []), ...(y.ok ? y.groups : [])] };
    }
    return r.ok ? { ok: false, res: json(502, { error: 'AI answer was not JSON' }) } : r;
  };
  const r = await ask(items);
  if (!r.ok) return r.res;
  return json(200, { groups: clean(r.groups) });
}

// ---- AI: statements reworded ----
// Each statement in a clearer wording by the criteria the dashboard sends
// (set there, e.g. "sachlich, neutral, vollständige Sätze"); the meaning
// stays. Only proposals: shown side by side and editable before storing.
async function rewrite(request: Request, env: StudyEnv): Promise<Response> {
  const key = env['asciia-bay-crafting'] ?? env.LLM_API_KEY;
  if (!key && env.STUDY_FAKE_AI !== '1') return json(503, { error: 'no AI key on the server' });
  const body = (await request.json().catch(() => null)) as { items?: { id: string; text: string; question?: string }[]; criteria?: string } | null;
  const items = (body?.items ?? []).filter((i) => i && i.id && typeof i.text === 'string' && i.text.trim()).slice(0, 20);
  if (!items.length) return json(400, { error: 'items required' });
  const criteria = String(body?.criteria ?? '').slice(0, 2000);
  if (!key) return json(200, { rewrites: items.map((i) => ({ id: i.id, text: `Umformuliert: ${i.text.trim()}` })) });
  const system =
    'Du formulierst Aussagen aus den Notizen eines Usability-Tests eines Spiels um. Antworte nur mit einem JSON-Objekt, ohne Text davor oder danach. ' +
    'Halte dich an diese Kriterien: ' +
    (criteria || 'sachlich, neutral, vollständige Sätze auf Deutsch') +
    '. Immer gilt: die Bedeutung bleibt gleich; nichts hinzufügen, nichts weglassen, nichts deuten; Teilnehmer-IDs (P001), Eigennamen, Variante A/B und Zahlen bleiben unverändert.';
  const user = JSON.stringify({
    aussagen: items.map((i) => ({ id: i.id, text: i.text.slice(0, 2000), frage: i.question })),
    format: { aussagen: [{ id: 'string', text: 'string' }] },
  });
  const r = await chat(env, key, system, user, 'aussagen');
  if (!r.ok) return r.res;
  const out = ((r.value as { aussagen?: { id?: string; text?: string }[] }).aussagen ?? []).filter((x) => x?.id && typeof x.text === 'string' && x.text.trim());
  return json(200, { rewrites: out.map((x) => ({ id: x.id, text: x.text!.trim() })) });
}
