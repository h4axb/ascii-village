// ---------------------------------------------------------------------------
// STAGE 1 — reference image provider. The ONLY file besides llm.ts allowed to
// import a network API client. Generates a small cute cartoon reference image
// from a fixed template (player words are the only variable), which Stage 2's
// vision call then transcribes into an ASCII sprite.
//
// Three request shapes are supported, since providers expose images
// differently; the one used is picked from VITE_IMAGE_URL:
//   1. Cloudflare Workers AI  — account ID + model are IN the URL path; POSTs
//      {prompt, steps}, response is JSON with base64 at result.image. Detected
//      by the "/ai/run/@cf/" path segment (present whether VITE_IMAGE_URL is
//      the real "api.cloudflare.com" URL or a proxied "/cf-ai/..." path — see
//      vite.config.ts: Cloudflare sends no CORS headers, so the browser must
//      go through the Vite dev proxy instead of calling it directly). No
//      other path matches this shape, so it's tried exclusively.
//   2. /images/generations    (classic OpenAI images shape — Together, etc.)
//   3. /chat/completions      (Gemini "image" models return the picture here,
//                              e.g. via the Requesty gateway)
// Whichever yields an image wins. On any failure/timeout/blank key → null, and
// the sprite pipeline drops to its text-only path.
//
//   VITE_IMAGE_API_KEY   provider key (blank → image stage disabled)
//   VITE_IMAGE_URL       base URL, or (Cloudflare) the full run endpoint
//   VITE_IMAGE_MODEL     image model id (ignored for Cloudflare — see above)
// ---------------------------------------------------------------------------

const IMG_KEY = import.meta.env.VITE_IMAGE_API_KEY?.trim() ?? '';
const IMG_BASE = (import.meta.env.VITE_IMAGE_URL?.trim() || 'https://router.requesty.ai/v1').replace(/\/$/, '');
const IMG_MODEL = import.meta.env.VITE_IMAGE_MODEL?.trim() || 'vertex/gemini-2.5-flash-image';

export const imageEnabled = IMG_KEY.length > 0;

const imagesUrl = () => (IMG_BASE.endsWith('/images/generations') ? IMG_BASE : `${IMG_BASE}/images/generations`);
const chatUrl = () => `${IMG_BASE.replace(/\/(images\/generations|chat\/completions)$/, '')}/chat/completions`;

// FIXED template — only the player's words are inserted. Note the full-figure
// instruction: for any living subject the picture must show the WHOLE body
// (head, torso, limbs), never a cropped headshot or a floating head. This is
// where anatomy is decided — the ASCII step then just transcribes the image.
const imagePrompt = (playerPrompt: string) =>
  `cute chibi cartoon icon of ${playerPrompt}, shown as a FULL figure: if it is a creature, animal, ` +
  `person, pet or monster, draw its entire body — head, torso and limbs, standing or sitting in full ` +
  `view — never a cropped close-up or a floating head; kawaii style, thick clean black outlines, ` +
  `flat pastel colors, white background, single object centered, simple shapes, no shading, ` +
  `no text, sticker style`;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Turn a data: URL or an http(s) URL into a base64 data URL.
async function toDataUrl(url: string, signal: AbortSignal): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return blobToDataUrl(await res.blob());
}

const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${IMG_KEY}` });

// Path 1: classic OpenAI images endpoint.
async function viaImages(prompt: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(imagesUrl(), {
      method: 'POST',
      headers: headers(),
      signal,
      body: JSON.stringify({ model: IMG_MODEL, prompt, n: 1 }),
    });
    if (!res.ok) return null;
    const item = (await res.json())?.data?.[0];
    if (!item) return null;
    if (typeof item.b64_json === 'string') return `data:${item.mime_type || 'image/png'};base64,${item.b64_json}`;
    if (typeof item.url === 'string') return toDataUrl(item.url, signal);
    return null;
  } catch {
    return null;
  }
}

// Path 0: Cloudflare Workers AI. Model + account ID live in the URL itself, so
// this POSTs directly to IMG_BASE with no suffixing. Response is base64
// already — no secondary fetch needed (unlike a provider that returns a URL).
async function viaCloudflare(prompt: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(IMG_BASE, {
      method: 'POST',
      headers: headers(),
      signal,
      body: JSON.stringify({ prompt, steps: 4 }),
    });
    if (!res.ok) return null;
    const b64 = (await res.json())?.result?.image;
    return typeof b64 === 'string' ? `data:image/jpeg;base64,${b64}` : null;
  } catch {
    return null;
  }
}

// Path 2: chat endpoint — Gemini image models return the picture in the reply.
async function viaChat(prompt: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(chatUrl(), {
      method: 'POST',
      headers: headers(),
      signal,
      body: JSON.stringify({
        model: IMG_MODEL,
        messages: [{ role: 'user', content: `Generate an image. ${prompt}` }],
      }),
    });
    if (!res.ok) return null;
    const msg = (await res.json())?.choices?.[0]?.message;
    if (!msg) return null;
    // a) some gateways attach images explicitly
    const imgUrl = msg.images?.[0]?.image_url?.url ?? msg.images?.[0]?.url;
    if (typeof imgUrl === 'string') return toDataUrl(imgUrl, signal);
    // b) content as an array of parts
    if (Array.isArray(msg.content)) {
      const part = msg.content.find((p: { type?: string }) => p?.type === 'image_url' || p?.type === 'output_image');
      const url = part?.image_url?.url ?? part?.url;
      if (typeof url === 'string') return toDataUrl(url, signal);
    }
    // c) content as text with an embedded data URL or markdown image
    if (typeof msg.content === 'string') {
      const data = msg.content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
      if (data) return data[0];
      const md = msg.content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
      if (md) return toDataUrl(md[1], signal);
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateReferenceImage(playerPrompt: string): Promise<string | null> {
  if (!imageEnabled) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const prompt = imagePrompt(playerPrompt);
    if (IMG_BASE.includes('/ai/run/@cf/')) {
      // Cloudflare's shape matches neither of the other two paths — trying
      // them first would just waste a request, so use it exclusively.
      return await viaCloudflare(prompt, controller.signal);
    }
    // chat path first — it's what Gemini image models use (the configured
    // default). viaImages is the fallback for classic image endpoints.
    return (await viaChat(prompt, controller.signal)) ?? (await viaImages(prompt, controller.signal));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
