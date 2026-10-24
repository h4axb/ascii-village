// The review Worker (wrangler.review.jsonc): the game alone, for a developer
// (npm run build:review → dist-review/, src/review.ts). Open to whoever has
// the link: there is nothing here to protect. No database, no AI key, no
// API (the developer's game calls their own AI provider from the browser),
// and nothing that could reach the main Worker.
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // nothing under /api: this Worker has no server side
    if (new URL(request.url).pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    // any path plays the game; kept out of search engines
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  },
};
