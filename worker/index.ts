// Cloudflare Worker entry (see wrangler.jsonc). Serves the built game from
// dist/ and routes the LLM proxy and the crafting-feedback store. The proxy logic itself lives in
// functions/api/chat/completions.ts so the same code also works as a Pages
// Function if the project is ever deployed to Pages instead.
//
// The whole site is locked (worker/lock.ts) with the dashboard's password,
// checked here before anything is served. Open without it: a participant's
// personal link (/intro/1, /intro/2 with a valid key; the key then stays in
// an HttpOnly cookie, as the game takes it out of the address bar), the APIs
// that link uses with its key, and the static files (code and art).
import { onRequestPost } from '../functions/api/chat/completions';
import { handleFeedback, type FeedbackEnv } from '../functions/api/feedback';
import { handleParticipant } from '../functions/api/participant';
import { dbOf, ensureSchema, gateLlm, handleAdmin, handleSession } from '../functions/api/session';
import { handleEvents } from '../functions/api/events';
import { cookieOf, handleUnlock, isStaticFile, isUnlocked, loginPage } from './lock';

interface Env extends FeedbackEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  'asciia-bay-crafting'?: string; // the provider API key secret
  LLM_API_KEY?: string; // (its older name, still accepted)
  LLM_BASE_URL?: string;
  LLM_ALLOWED_MODELS?: string;
  LLM_MAX_TOKENS?: string;
  ALLOWED_ORIGINS?: string;
  LLM_OPEN_DAILY_LIMIT?: string;
}

const TITLE = 'Asciia Bay';
const INVITE_COOKIE = 'asciia_inv';
const PERSONAL_PAGE = /^\/intro\/[12]\/?$/;

// a personal link's key that exists (finished or expired ones too: the game
// shows those its own screen)
async function knownKey(env: Env, key: string): Promise<boolean> {
  const db = dbOf(env);
  if (!db || !key || key.length > 80) return false;
  await ensureSchema(db);
  const { results } = await db.prepare('SELECT key FROM invites WHERE key = ?1').bind(key).all<{ key: string }>();
  return results.length > 0;
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/chat/completions') {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    // the personal links' AI budgets (functions/api/session.ts)
    const refused = await gateLlm(request, env);
    if (refused) return refused;
    return onRequestPost({ request, env });
  }
  // crafting feedback (crafting panel 2) — see functions/api/feedback.ts
  if (pathname === '/api/feedback' || pathname === '/api/feedback/tags') return handleFeedback(request, env);
  // the user test's participant ids — see functions/api/participant.ts
  if (pathname === '/api/participant') return handleParticipant(request, env);
  // personal invite links, the run log, the dashboard's Participants tab
  if (pathname.startsWith('/api/session/')) return handleSession(request, env);
  if (pathname === '/api/events') return handleEvents(request, env);
  if (pathname.startsWith('/api/admin/')) return handleAdmin(request, env);
  if (pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const secret = env.FEEDBACK_ADMIN_TOKEN;
    const unlock = await handleUnlock(request, secret, TITLE);
    if (unlock) return unlock;
    // static files: code and art, no data (a participant's page needs them)
    if (!pathname.startsWith('/api/') && isStaticFile(pathname)) return env.ASSETS.fetch(request);

    if (await isUnlocked(request, secret)) {
      // unlocked = the dashboard's password: its API calls need no other
      const auth = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s*/i, '').trim();
      if (pathname.startsWith('/api/') && !auth && secret) {
        const headers = new Headers(request.headers);
        headers.set('Authorization', `Bearer ${secret}`);
        request = new Request(request, { headers });
      }
      return route(request, env);
    }

    // a participant: their personal page with a valid key (from the link,
    // or kept from it), and the APIs that page uses
    const keyCookie = cookieOf(request, INVITE_COOKIE) ?? '';
    if (PERSONAL_PAGE.test(pathname)) {
      const fromUrl = url.searchParams.get('k')?.trim() ?? '';
      if (fromUrl && (await knownKey(env, fromUrl))) {
        const res = await env.ASSETS.fetch(request);
        const out = new Response(res.body, res);
        const secure = url.protocol === 'https:' ? '; Secure' : '';
        out.headers.append('Set-Cookie', `${INVITE_COOKIE}=${encodeURIComponent(fromUrl)}; Path=/; Max-Age=${14 * 86400}; HttpOnly; SameSite=Lax${secure}`);
        return out;
      }
      if (!fromUrl && (await knownKey(env, keyCookie))) return env.ASSETS.fetch(request);
    }
    if (pathname.startsWith('/api/')) {
      const key = (request.headers.get('X-Test-Key') ?? '').trim() || keyCookie;
      // the dashboard asks with its password (Authorization), checked by its routes
      const admin = !!(request.headers.get('Authorization') ?? '').replace(/^Bearer\s*/i, '').trim();
      const participantApi = pathname.startsWith('/api/session/') || pathname === '/api/events' || pathname.startsWith('/api/feedback') || pathname === '/api/chat/completions';
      if ((participantApi && (await knownKey(env, key))) || (admin && (pathname.startsWith('/api/admin/') || request.method === 'GET'))) {
        // a key only from the cookie: the handlers read it from the header
        if (!request.headers.get('X-Test-Key') && key) {
          const headers = new Headers(request.headers);
          headers.set('X-Test-Key', key);
          request = new Request(request, { headers });
        }
        return route(request, env);
      }
      return new Response(JSON.stringify({ error: 'locked' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    return loginPage(TITLE, pathname + url.search);
  },
};
