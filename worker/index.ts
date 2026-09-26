// Cloudflare Worker entry (see wrangler.jsonc). Serves the built game from
// dist/ and routes the LLM proxy. The proxy logic itself lives in
// functions/api/chat/completions.ts so the same code also works as a Pages
// Function if the project is ever deployed to Pages instead.
import { onRequestPost } from '../functions/api/chat/completions';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_ALLOWED_MODELS?: string;
  LLM_MAX_TOKENS?: string;
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/chat/completions') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return onRequestPost({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
