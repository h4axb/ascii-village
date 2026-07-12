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
// Also note: any key shipped to the browser is visible to users. Fine for a
// local/personal project; use a backend proxy for anything public.
// ---------------------------------------------------------------------------

const API_KEY = import.meta.env.VITE_LLM_API_KEY?.trim() ?? '';
const BASE_URL = (import.meta.env.VITE_LLM_BASE_URL?.trim() || 'https://router.requesty.ai/v1').replace(/\/$/, '');

// Two runtime model tiers (see the build-time scripts for the offline tiers).
// FAST is the default for every latency-sensitive, high-frequency runtime call
// (the player is standing at a UI waiting). SMART is the escape hatch: bump a
// single call to it when FAST's output feels too dumb — a one-string change,
// because everything routes through this boundary.
const MODEL_FAST =
  import.meta.env.VITE_LLM_MODEL_FAST?.trim() || import.meta.env.VITE_LLM_MODEL?.trim() || 'anthropic/claude-haiku-4-5';
const MODEL_SMART = import.meta.env.VITE_LLM_MODEL_SMART?.trim() || 'anthropic/claude-sonnet-5';

export const MODELS = { fast: MODEL_FAST, smart: MODEL_SMART } as const;

// True only when a key is present. Callers use this to decide whether to hit
// the API or fall back to their built-in mock behavior.
export const llmEnabled = API_KEY.length > 0;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean; // ask the model to return a JSON object
  model?: string; // override the tier; defaults to MODELS.fast
}

// Low-level call. Returns the assistant's text, or throws on any failure so
// callers can catch and fall back to a mock.
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  if (!llmEnabled) throw new Error('LLM not configured (no VITE_LLM_API_KEY).');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model ?? MODELS.fast,
        messages,
        temperature: opts.temperature ?? 0.8,
        max_tokens: opts.maxTokens ?? 256,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM returned no content.');
    return text.trim();
  } finally {
    clearTimeout(timeout);
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
