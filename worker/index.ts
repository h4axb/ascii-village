// Cloudflare Worker entry (see wrangler.jsonc). Serves the built game from
// dist/ and routes the LLM proxy and the crafting-feedback store. The proxy logic itself lives in
// functions/api/chat/completions.ts so the same code also works as a Pages
// Function if the project is ever deployed to Pages instead.
import { onRequestPost } from '../functions/api/chat/completions';
import { handleFeedback, type FeedbackEnv } from '../functions/api/feedback';

interface Env extends FeedbackEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  'asciia-bay-crafting'?: string; // the provider API key secret
  LLM_API_KEY?: string; // (its older name, still accepted)
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
    // crafting feedback (crafting panel 2) — see functions/api/feedback.ts
    if (pathname === '/api/feedback' || pathname === '/api/feedback/tags') return handleFeedback(request, env);
    return env.ASSETS.fetch(request);
  },
};
