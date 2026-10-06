// Cloudflare Worker route for the user test's participant ids (the quest
// links /1, /2, /intro/1, /intro/2), in the same D1 database as the crafting
// feedback (binding FEEDBACK_DB / asciia_feedback):
//
//   POST /api/participant  {link}  →  {participantId: "P001", order: "AB"}
//
// Every new run (a new player, or New Game) asks once; the game keeps the
// answer in its save. Ids count up across every device: P001, P002, …
// The order comes from the link: /1 runs the designs A then B ("AB"), /2
// B then A ("BA"). The table creates itself on first use.
import type { FeedbackEnv } from './feedback';

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}
interface D1Database {
  prepare(sql: string): D1Statement;
}

export const orderOfLink = (link: string): 'AB' | 'BA' => (/\/2$/.test(link) ? 'BA' : 'AB');
export const participantIdOf = (n: number) => `P${String(n).padStart(3, '0')}`;
const LINKS = ['/1', '/2', '/intro/1', '/intro/2'];

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function handleParticipant(request: Request, env: FeedbackEnv): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  const db = (env.FEEDBACK_DB ?? env.asciia_feedback) as unknown as D1Database | undefined;
  if (!db) return json(503, { error: 'no database (FEEDBACK_DB binding in wrangler.jsonc)' });
  const origin = request.headers.get('Origin');
  const allowed = [new URL(request.url).origin, ...(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
  if (!origin || !allowed.includes(origin)) return json(403, { error: 'origin not allowed' });
  let link = '/1';
  try {
    const body = (await request.json()) as { link?: unknown };
    if (typeof body.link === 'string' && LINKS.includes(body.link)) link = body.link;
  } catch {
    // no body: the /1 order
  }
  const order = orderOfLink(link);
  await db
    .prepare('CREATE TABLE IF NOT EXISTS participants (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, link TEXT NOT NULL, run_order TEXT NOT NULL)')
    .run();
  const { results } = await db
    .prepare('INSERT INTO participants (at, link, run_order) VALUES (?1, ?2, ?3) RETURNING n')
    .bind(Date.now(), link, order)
    .all<{ n: number }>();
  const n = results[0]?.n;
  if (!n) return json(500, { error: 'no id' });
  return json(200, { participantId: participantIdOf(n), order });
}
