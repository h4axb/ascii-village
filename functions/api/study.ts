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
//   POST   /api/study/translate       AI translations of notes and survey texts (the
//                                    dashboard stores them as editable drafts)
import { dbOf, isAdmin, json, type D1Database, type SessionEnv } from './session';

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

  if (request.method === 'GET' && parts.length === 0) {
    const { results } = await db.prepare('SELECT coll, id, data, updated FROM study').all<{ coll: string; id: string; data: string; updated: number }>();
    const out: Record<string, Record<string, unknown>> = Object.fromEntries(STUDY_COLLS.map((c) => [c, {}]));
    for (const r of results) {
      try {
        (out[r.coll] ??= {})[r.id] = JSON.parse(r.data);
      } catch {
        // a broken row: skipped
      }
    }
    return json(200, out);
  }

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

async function chat(env: StudyEnv, key: string, system: string, user: string): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  const base = (env.LLM_BASE_URL || 'https://router.requesty.ai/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      temperature: 0,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }).catch(() => null);
  if (!res?.ok) return { ok: false, res: json(502, { error: `AI unavailable (${res?.status ?? 'network'})` }) };
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const text = data?.choices?.[0]?.message?.content ?? '';
  try {
    return { ok: true, value: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) };
  } catch {
    return { ok: false, res: json(502, { error: 'AI answer was not JSON' }) };
  }
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
  const r = await chat(env, key, system, user);
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
  if (!key) return json(503, { error: 'no AI key on the server' });
  const body = (await request.json().catch(() => null)) as {
    items?: { id: string; text: string; section?: string; question?: string }[];
    groups?: { id: string; name: string; multi?: boolean; chips: { id: string; label: string }[] }[];
    findings?: { id: string; name: string }[];
  } | null;
  if (!body?.items?.length || !body.groups) return json(400, { error: 'items and groups required' });
  const items = body.items.slice(0, 40);
  const system =
    'Du ordnest Rückmeldungen aus einem Usability-Test eines Spiels ein. Antworte nur mit JSON. ' +
    'Wähle für jede Aussage pro Kategorie die passenden Chips ausschließlich aus der gegebenen Liste (IDs). ' +
    'Bei Kategorien ohne "multi" höchstens einen Chip. Wenn nichts passt, lass die Kategorie leer. ' +
    'Ordne eine Aussage einem bestehenden wiederkehrenden Befund nur zu, wenn sie inhaltlich dasselbe Problem oder Lob beschreibt. ' +
    'Schlage für neue, eindeutig benennbare Befunde einen kurzen neutralen Namen vor (newFinding), sonst null.';
  const user = JSON.stringify({
    kategorien: body.groups.map((g) => ({ id: g.id, name: g.name, multi: !!g.multi, chips: g.chips })),
    befunde: body.findings ?? [],
    aussagen: items.map((i) => ({ id: i.id, text: i.text, abschnitt: i.section, frage: i.question })),
    format: { aussagen: [{ id: 'string', chips: { '<kategorie-id>': ['<chip-id>'] }, finding: '<befund-id> | null', newFinding: 'string | null' }] },
  });
  const base = (env.LLM_BASE_URL || 'https://router.requesty.ai/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }).catch(() => null);
  if (!res?.ok) return json(502, { error: `AI unavailable (${res?.status ?? 'network'})` });
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const text = data?.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { aussagen?: unknown[] };
    return json(200, { suggestions: Array.isArray(parsed.aussagen) ? parsed.aussagen : [] });
  } catch {
    return json(502, { error: 'AI answer was not JSON' });
  }
}
