// The project journal's data (/journal, src/journal/): log entries, milestones,
// deadlines, page settings, the Overview's sections, the daily check-ins (days,
// one per date) and the weekly reviews (weeks, one per ISO week), each a JSON document,
// plus uploaded files. Kept apart from the study's tables (its exports and
// versions never contain the journal). Dashboard password only.
//
//   GET    /api/journal                    every document {coll: {id: doc}}
//   PUT    /api/journal/<coll>/<id>        store (replace) one document
//   DELETE /api/journal/<coll>/<id>        remove one
//   POST   /api/journal/batch              several at once {put: [...], del: [...]}
//   GET    /api/journal/history/<coll>/<id> earlier states of one document, newest first
//   POST   /api/journal/files              upload {name, type, data (base64)} → {id, name, type, size}
//   GET    /api/journal/files/<id>         the file itself
//   DELETE /api/journal/files/<id>         remove it
//   POST   /api/journal/zotero/…           the sources from Zotero (functions/api/zotero.ts)
//
// Every replaced or removed document is kept in journal_history first, so an
// edit can always be looked up and restored.
import { dbOf, isAdmin, json, type D1Database, type SessionEnv } from './session';
import { handleZotero, type ZoteroEnv } from './zotero';

// zotero: the copies of the Zotero library's items, written by a sync only
export const JOURNAL_COLLS = ['entries', 'milestones', 'deadlines', 'pages', 'overview', 'settings', 'days', 'weeks', 'files', 'zotero'] as const;
type Coll = (typeof JOURNAL_COLLS)[number];
const isColl = (c: string): c is Coll => (JOURNAL_COLLS as readonly string[]).includes(c);

const MAX_DOC = 900_000; // D1 row limit is 1 MB
const MAX_FILE = 8 * 1024 * 1024;
const PART = 700_000; // base64 characters per row
const HISTORY_KEEP = 50; // earlier states kept per document

let ready: Promise<unknown> | null = null;
function ensure(db: D1Database) {
  ready ??= (async () => {
    await db.prepare('CREATE TABLE IF NOT EXISTS journal (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (coll, id))').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS journal_history (coll TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS journal_files (id TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, part))').run();
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

const validId = (id: string) => /^[\w.-]{1,120}$/.test(id);

async function keepHistory(db: D1Database, coll: Coll, id: string, at: number) {
  const { results } = await db.prepare('SELECT data FROM journal WHERE coll = ? AND id = ?').bind(coll, id).all<{ data: string }>();
  if (!results.length) return;
  await db.prepare('INSERT INTO journal_history (coll, id, at, data) VALUES (?, ?, ?, ?)').bind(coll, id, at, results[0].data).run();
  // only the newest states stay
  await db
    .prepare('DELETE FROM journal_history WHERE coll = ? AND id = ? AND at NOT IN (SELECT at FROM journal_history WHERE coll = ? AND id = ? ORDER BY at DESC LIMIT ?)')
    .bind(coll, id, coll, id, HISTORY_KEEP)
    .run();
}

async function putDoc(db: D1Database, coll: Coll, id: string, data: unknown, at: number): Promise<string | null> {
  if (!validId(id)) return `invalid id: ${id}`;
  const text = JSON.stringify(data);
  if (text.length > MAX_DOC) return `document too large: ${coll}/${id}`;
  await keepHistory(db, coll, id, at);
  await db.prepare('INSERT INTO journal (coll, id, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated = excluded.updated').bind(coll, id, text, at).run();
  return null;
}
async function delDoc(db: D1Database, coll: Coll, id: string, at: number) {
  await keepHistory(db, coll, id, at);
  await db.prepare('DELETE FROM journal WHERE coll = ? AND id = ?').bind(coll, id).run();
}

export async function handleJournal(request: Request, env: SessionEnv & ZoteroEnv): Promise<Response> {
  if (!isAdmin(request, env)) return json(401, { error: 'unauthorized' });
  const db = dbOf(env);
  if (!db) return json(503, { error: 'no database' });
  await ensure(db);
  const parts = new URL(request.url).pathname.replace(/^\/api\/journal\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const now = Date.now();

  if (request.method === 'GET' && !parts.length) {
    const { results } = await db.prepare('SELECT coll, id, data FROM journal').all<{ coll: string; id: string; data: string }>();
    const out: Record<string, Record<string, unknown>> = Object.fromEntries(JOURNAL_COLLS.map((c) => [c, {}]));
    for (const r of results) if (isColl(r.coll)) out[r.coll][r.id] = JSON.parse(r.data);
    return json(200, out);
  }

  if (parts[0] === 'history' && request.method === 'GET' && parts.length === 3 && isColl(parts[1])) {
    const { results } = await db.prepare('SELECT at, data FROM journal_history WHERE coll = ? AND id = ? ORDER BY at DESC').bind(parts[1], parts[2]).all<{ at: number; data: string }>();
    return json(200, results.map((r) => ({ at: r.at, data: JSON.parse(r.data) })));
  }

  if (parts[0] === 'zotero') return handleZotero(request, env, db, parts.slice(1), now);

  if (parts[0] === 'files') {
    if (request.method === 'POST' && parts.length === 1) {
      const body = (await request.json().catch(() => null)) as { name?: unknown; type?: unknown; data?: unknown } | null;
      const data = typeof body?.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
      const size = Math.floor((data.length * 3) / 4);
      if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) return json(400, { error: 'no file data' });
      if (size > MAX_FILE) return json(413, { error: `file larger than ${MAX_FILE / 1024 / 1024} MB` });
      const id = `f${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const meta = { id, name: String(body?.name ?? 'file').slice(0, 200), type: String(body?.type ?? 'application/octet-stream').slice(0, 100), size, created: now };
      for (let i = 0, n = 0; i < data.length; i += PART, n++) await db.prepare('INSERT INTO journal_files (id, part, data) VALUES (?, ?, ?)').bind(id, n, data.slice(i, i + PART)).run();
      await putDoc(db, 'files', id, meta, now);
      return json(200, meta);
    }
    if (parts.length === 2 && validId(parts[1])) {
      const id = parts[1];
      if (request.method === 'GET') {
        const { results: m } = await db.prepare("SELECT data FROM journal WHERE coll = 'files' AND id = ?").bind(id).all<{ data: string }>();
        if (!m.length) return json(404, { error: 'not found' });
        const meta = JSON.parse(m[0].data) as { name: string; type: string };
        const { results } = await db.prepare('SELECT data FROM journal_files WHERE id = ? ORDER BY part').bind(id).all<{ data: string }>();
        const bin = Uint8Array.from(atob(results.map((r) => r.data).join('')), (c) => c.charCodeAt(0));
        // shown inline only for images and PDFs; everything else downloads
        const inline = /^image\/(png|jpe?g|gif|webp)$|^application\/pdf$/.test(meta.type);
        return new Response(bin, {
          headers: {
            'Content-Type': inline ? meta.type : 'application/octet-stream',
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM journal_files WHERE id = ?').bind(id).run();
        await delDoc(db, 'files', id, now);
        return json(200, { ok: true });
      }
    }
    return json(404, { error: 'not found' });
  }

  if (parts[0] === 'batch' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { put?: { coll: string; id: string; data: unknown }[]; del?: { coll: string; id: string }[] } | null;
    for (const p of body?.put ?? []) {
      if (!isColl(p.coll) || p.coll === 'files' || p.coll === 'zotero') return json(400, { error: `unknown collection: ${p.coll}` });
      const err = await putDoc(db, p.coll, p.id, p.data, now);
      if (err) return json(400, { error: err });
    }
    for (const d of body?.del ?? []) if (isColl(d.coll) && d.coll !== 'files' && d.coll !== 'zotero' && validId(d.id)) await delDoc(db, d.coll, d.id, now);
    return json(200, { ok: true });
  }

  if (parts.length === 2 && isColl(parts[0]) && parts[0] !== 'files' && parts[0] !== 'zotero') {
    const [coll, id] = parts as [Coll, string];
    if (request.method === 'PUT') {
      const err = await putDoc(db, coll, id, await request.json(), now);
      return err ? json(400, { error: err }) : json(200, { ok: true });
    }
    if (request.method === 'DELETE') {
      await delDoc(db, coll, id, now);
      return json(200, { ok: true });
    }
  }
  return json(404, { error: 'not found' });
}
