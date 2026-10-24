// The review Worker (wrangler.review.jsonc): the game alone, for a developer
// (npm run build:review → dist-review/, src/review.ts). Locked with its own
// password (secret REVIEW_PASSWORD, worker/lock.ts), never the dashboard's.
// No database, no AI key, no API: the developer's game calls their own AI
// provider from the browser. Nothing here can reach the main Worker.
import { handleUnlock, isStaticFile, isUnlocked, loginPage } from './lock';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  REVIEW_PASSWORD?: string;
}

const TITLE = 'Island preview';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const unlock = await handleUnlock(request, env.REVIEW_PASSWORD, TITLE);
    if (unlock) return unlock;
    // nothing else under /api: this Worker has no server side
    if (url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    // the game's code and art; every page (any path plays the game) needs the password
    if (isStaticFile(url.pathname) || (await isUnlocked(request, env.REVIEW_PASSWORD))) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('X-Robots-Tag', 'noindex');
      return out;
    }
    return loginPage(TITLE, url.pathname + url.search);
  },
};
