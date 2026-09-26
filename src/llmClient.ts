// ---------------------------------------------------------------------------
// Minimal OpenAI-COMPATIBLE chat client.
//
// Works with any provider that exposes the OpenAI "/chat/completions" shape:
// OpenAI (GPT), Groq, OpenRouter, Together, DeepSeek, local Ollama, etc.
// To switch providers, change the three VITE_LLM_* values in ".env" — nothing
// in this file needs editing.
//
// Heads-up (browser CORS): this app runs in the browser, so the request goes
// out from the user's page. Most providers (Groq, OpenRouter, Together) send
// CORS headers and work directly. OpenAI's api.openai.com does NOT allow
// direct browser calls — for GPT you'd need a tiny server/proxy in front.
// Any key shipped to the browser is visible to users, so production builds
// don't ship one: they go through the /api proxy (see below and
// docs/Deploy-Cloudflare.md).
// ---------------------------------------------------------------------------

// Two modes:
//   dev  (`npm run dev`)  — calls the provider directly with VITE_LLM_API_KEY
//                           from .env, same as always. Local only.
//   prod (`npm run build`) — calls this site's own /api proxy (a Cloudflare
//                           Pages Function, see functions/api/), which adds
//                           the key server-side. The key is NEVER read in a
//                           production build: `import.meta.env.DEV` is replaced
//                           with `false` at build time and the dead branch is
//                           dropped, so even a stray .env can't leak it into
//                           the public bundle.
// VITE_LLM_DISABLED=1 at build time ships a build with the mock/offline
// behavior instead (no proxy calls at all).
const API_KEY = import.meta.env.DEV ? (import.meta.env.VITE_LLM_API_KEY?.trim() ?? '') : '';
const BASE_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_LLM_BASE_URL?.trim() || 'https://router.requesty.ai/v1').replace(/\/$/, '')
  : '/api';
const authHeader = (): Record<string, string> => (API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {});

// ONE model for everything (user directive): sprite generation, fun facts,
// Mitchy's dialogue/chat, size classification — all google/gemini-2.5-flash-lite
// unless VITE_LLM_MODEL overrides it. The fast/smart tier split is kept ONLY
// as an optional per-tier override hook (VITE_LLM_MODEL_FAST/_SMART); when
// those are unset — the normal case — both tiers resolve to the ONE model.
// There are deliberately no hardcoded per-tier model defaults anymore: an
// earlier version defaulted SMART to claude-sonnet-5, which silently put
// sprite generation back on an expensive model whenever the env line went
// missing. Now a missing env line can only ever mean "use the one model".
const MODEL = import.meta.env.VITE_LLM_MODEL?.trim() || 'google/gemini-2.5-flash-lite';
const MODEL_FAST = import.meta.env.VITE_LLM_MODEL_FAST?.trim() || MODEL;
const MODEL_SMART = import.meta.env.VITE_LLM_MODEL_SMART?.trim() || MODEL;
// Optional retry-once-with-a-different-model fallbacks; unset = disabled.
const MODEL_FAST_FALLBACK = import.meta.env.VITE_LLM_MODEL_FAST_FALLBACK?.trim() || undefined;
const MODEL_SMART_FALLBACK = import.meta.env.VITE_LLM_MODEL_SMART_FALLBACK?.trim() || undefined;

export const MODELS = {
  fast: MODEL_FAST,
  fastFallback: MODEL_FAST_FALLBACK,
  smart: MODEL_SMART,
  smartFallback: MODEL_SMART_FALLBACK,
} as const;

// Callers use this to decide whether to hit the API or fall back to their
// built-in mock behavior. Dev: only when a key is present. Prod: on (the
// proxy holds the key) unless the build opted out with VITE_LLM_DISABLED=1.
export const llmEnabled = import.meta.env.DEV
  ? API_KEY.length > 0
  : import.meta.env.VITE_LLM_DISABLED !== '1';

// A message part — text, or an image (data URL or https URL). Vision-capable
// models (Claude via the gateway) accept an array of parts as `content`.
// `cache_control` on a text part enables Anthropic prompt caching for the
// prefix up to that part — verified live through the Requesty gateway
// (second identical call: cached_tokens > 0, ~11x cheaper).
export type ContentPart =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean; // ask the model to return a JSON object
  model?: string; // override the tier; defaults to MODELS.fast
  // Anthropic thinking control (passthrough). Sonnet 5 thinks by default, which
  // can eat the whole token budget on complex calls — disable it for tasks that
  // just need direct output (e.g. the sprite transcription). Anthropic-only —
  // only sent when the effective model string is an "anthropic/..." id, since
  // other providers don't recognize this field.
  thinking?: { type: 'disabled' | 'enabled' | 'adaptive' };
  // If the call with `model` (or MODELS.fast) fails for any reason, retry
  // ONCE with this model before giving up — same key/gateway, just a
  // different `model` string. Callers typically pass MODELS.fastFallback.
  fallbackModel?: string;
}

// One HTTP attempt against a specific model. Throws on any failure.
async function chatOnce(messages: ChatMessage[], opts: ChatOptions, model: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        // only send temperature when explicitly set — Sonnet 5 rejects
        // non-default sampling params
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        max_tokens: opts.maxTokens ?? 256,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        // Anthropic-only field — guard by the model actually being sent in
        // THIS attempt (matters when a fallback model swaps providers).
        ...(opts.thinking && model.startsWith('anthropic/') ? { thinking: opts.thinking } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM returned no content.');
    // Visible in the browser console for every non-streaming call — the
    // quickest way to confirm which model actually answered (e.g. that a
    // fallback fired), without digging through the Network tab.
    console.info(`[llm] model=${model}`);
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// Low-level call. Returns the assistant's text, or throws on any failure so
// callers can catch and fall back to a mock. Retries once with
// `opts.fallbackModel`, if set, before throwing.
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  if (!llmEnabled) throw new Error('LLM not configured (no VITE_LLM_API_KEY / VITE_LLM_DISABLED=1).');
  const primary = opts.model ?? MODELS.fast;
  try {
    return await chatOnce(messages, opts, primary);
  } catch (err) {
    if (!opts.fallbackModel || opts.fallbackModel === primary) throw err;
    console.warn(`[llm] "${primary}" failed, retrying with fallback "${opts.fallbackModel}":`, err);
    return await chatOnce(messages, opts, opts.fallbackModel);
  }
}

// ---------------------------------------------------------------------------
// Streaming chat. Hand-rolled SSE consumption over fetch (no library, per the
// project's zero-dependency convention). Yields text deltas as they arrive.
//
// Wire shape verified live against the Requesty gateway: OpenAI-style
// `data: {...}` events with `choices[0].delta.content`, terminated by
// `data: [DONE]`. Thinking-only chunks carry `reasoning_content` and no
// `content` — they are skipped. A single delta may contain multiple newlines;
// consumers must split within deltas.
// ---------------------------------------------------------------------------

interface StreamChatOptions extends ChatOptions {
  signal?: AbortSignal; // external abort (e.g. fail-fast on a bad sprite line)
}

async function* chatStreamOnce(
  messages: ChatMessage[],
  opts: StreamChatOptions,
  model: string,
): AsyncGenerator<string, void, void> {
  const controller = new AbortController();
  // streaming spends wall time token-by-token → higher ceiling than chat()'s 15s
  const timeout = setTimeout(() => controller.abort(), 30000);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        max_tokens: opts.maxTokens ?? 256,
        ...(opts.thinking && model.startsWith('anthropic/') ? { thinking: opts.thinking } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const event = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue; // comments/keepalives
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const delta = JSON.parse(payload)?.choices?.[0]?.delta;
            if (typeof delta?.content === 'string' && delta.content.length > 0) {
              yield delta.content;
            }
          } catch {
            // malformed chunk — skip, don't kill the stream
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onExternalAbort);
    controller.abort(); // release the connection if the consumer bailed early
  }
}

// Streaming chat with the same fallback contract as chat(): if `opts.model`
// fails, retry once with `opts.fallbackModel`. Only falls back when NOTHING
// has streamed yet — once any content has been yielded, a failure propagates
// as-is rather than restarting (a fresh generation appended after a partial
// one would produce a corrupted/duplicated sprite).
export async function* chatStream(
  messages: ChatMessage[],
  opts: StreamChatOptions = {},
): AsyncGenerator<string, void, void> {
  if (!llmEnabled) throw new Error('LLM not configured (no VITE_LLM_API_KEY / VITE_LLM_DISABLED=1).');
  const primary = opts.model ?? MODELS.fast;
  let yieldedAny = false;
  try {
    for await (const delta of chatStreamOnce(messages, opts, primary)) {
      yieldedAny = true;
      yield delta;
    }
  } catch (err) {
    if (yieldedAny || !opts.fallbackModel || opts.fallbackModel === primary) throw err;
    console.warn(`[llm] stream "${primary}" failed before any output, retrying with fallback "${opts.fallbackModel}":`, err);
    yield* chatStreamOnce(messages, opts, opts.fallbackModel);
  }
}

// Convenience: run a chat and parse the reply as JSON. Tolerates models that
// wrap JSON in ```code fences``` or add stray prose around it.
export async function chatJSON<T = unknown>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<T> {
  const raw = await chat(messages, { ...opts, json: true });
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(slice) as T;
}
