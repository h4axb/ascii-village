// ---------------------------------------------------------------------------
// Node-side Requesty client for the OFFLINE build-time scripts.
//
// This is the server/CLI twin of src/llmClient.ts. It reads process.env (not
// import.meta.env) and is never bundled into the browser app. Run the scripts
// with Node's native env-file loader so the key comes straight from .env:
//
//   node --env-file=.env scripts/build-catalog.mjs
//   node --env-file=.env scripts/build-sprites.mjs
//
// Requesty's OpenAI-compatible endpoint does not expose Anthropic's native
// Batch API, so these scripts fan out concurrent synchronous calls instead.
// They run once, offline, so there's no 50%-off batch rate — but 200 items is
// still pennies, and the 24h turnaround simply doesn't apply.
// ---------------------------------------------------------------------------

const API_KEY = (process.env.VITE_LLM_API_KEY || '').trim();
const BASE_URL = (process.env.VITE_LLM_BASE_URL || 'https://router.requesty.ai/v1').replace(/\/$/, '');

// Build-time model tiers (kept separate from the runtime tiers on purpose).
export const MODELS = {
  // Quality-critical foundation everything else samples from.
  catalog: (process.env.BUILD_MODEL_CATALOG || 'anthropic/claude-sonnet-5').trim(),
  // High-volume narrow extraction — tiny constrained JSON per species.
  sprites: (process.env.BUILD_MODEL_SPRITES || 'anthropic/claude-haiku-4-5').trim(),
};

if (!API_KEY) {
  console.error('No VITE_LLM_API_KEY found. Run with:  node --env-file=.env <script>');
  process.exit(1);
}

export async function chat(messages, { model, temperature = 0.7, maxTokens = 1024, json = false } = {}) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('LLM returned no content.');
  return text.trim();
}

export async function chatJSON(messages, opts = {}) {
  const raw = await chat(messages, { ...opts, json: true });
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

// Small concurrency limiter so we don't fire 200 requests at once.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
