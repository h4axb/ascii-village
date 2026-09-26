// Cloudflare Pages Function: POST /api/chat/completions
//
// The production game (see src/llmClient.ts) sends its OpenAI-shaped chat
// requests here WITHOUT a key. This function adds the key from an encrypted
// Cloudflare secret and forwards the request to the LLM provider, streaming
// the answer straight back. The key never reaches the browser.
//
// Hiding the key does not stop someone from calling this endpoint directly,
// so it also enforces a few cheap limits: same-origin requests only, an
// allowlist of models, a max_tokens cap and a request-size cap. The real
// safety net is a spending limit on the provider account.
//
// Settings (Cloudflare dashboard → Pages project → Settings → Variables and
// Secrets). Only LLM_API_KEY is required:
//   LLM_API_KEY         secret  — provider API key (e.g. Requesty)
//   LLM_BASE_URL        text    — default https://router.requesty.ai/v1
//   LLM_ALLOWED_MODELS  text    — comma list, default google/gemini-2.5-flash-lite
//   LLM_MAX_TOKENS      text    — per-request cap, default 2000
//   ALLOWED_ORIGINS     text    — extra origins (comma list), e.g. a custom domain.
//                                 The site's own origin is always allowed.

interface Env {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_ALLOWED_MODELS?: string;
  LLM_MAX_TOKENS?: string;
  ALLOWED_ORIGINS?: string;
}

// Minimal slice of Cloudflare's PagesFunction context — avoids pulling in
// @cloudflare/workers-types just for these two fields.
interface Ctx {
  request: Request;
  env: Env;
}

const DEFAULT_BASE_URL = 'https://router.requesty.ai/v1';
const DEFAULT_MODELS = 'google/gemini-2.5-flash-lite';
const DEFAULT_MAX_TOKENS = 2000;
const MAX_BODY_BYTES = 512 * 1024;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  if (!env.LLM_API_KEY) return fail(500, 'LLM_API_KEY is not configured');

  // Browsers always send Origin on a POST fetch. Anything else (a missing or
  // foreign origin) is not the game.
  const origin = request.headers.get('Origin');
  const allowed = [new URL(request.url).origin, ...list(env.ALLOWED_ORIGINS)];
  if (!origin || !allowed.includes(origin)) return fail(403, 'origin not allowed');

  const len = Number(request.headers.get('Content-Length') ?? 0);
  if (len > MAX_BODY_BYTES) return fail(413, 'request too large');
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'request too large');

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid JSON');
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
    return fail(400, 'expected { model, messages }');
  }

  const models = list(env.LLM_ALLOWED_MODELS || DEFAULT_MODELS);
  if (typeof body.model !== 'string' || !models.includes(body.model)) {
    return fail(400, `model not allowed: ${String(body.model)}`);
  }

  const cap = Number(env.LLM_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  const asked = Number(body.max_tokens);
  body.max_tokens = Number.isFinite(asked) && asked > 0 ? Math.min(asked, cap) : Math.min(256, cap);

  const base = (env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const upstream = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  // Pass the provider's answer through unchanged — including streamed (SSE)
  // bodies, which Cloudflare forwards chunk by chunk.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
