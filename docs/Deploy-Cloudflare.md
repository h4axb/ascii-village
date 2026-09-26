# Deploying to Cloudflare Pages

The game is a static Vite site plus one small server function
(`functions/api/chat/completions.ts`) that holds the LLM API key. The
browser never sees the key: production builds send LLM requests to
`/api/chat/completions`, and the function adds the key and forwards them to
Requesty.

```
Browser ──(no key)──► <site>.pages.dev/api/chat/completions
                          │  Pages Function adds LLM_API_KEY (encrypted secret)
                          ▼
                      router.requesty.ai
```

Local development is unchanged: `pnpm dev` still reads `VITE_LLM_API_KEY`
from `.env` and calls Requesty directly.

The project uses **pnpm only** (`pnpm-lock.yaml`). Don't add a
`package-lock.json`. `pnpm-workspace.yaml` must keep its `packages: [.]`
entry: Cloudflare's build image runs pnpm 10, which rejects the file without
it ("packages field missing or empty"), while pnpm 11 locally needs the file
for the esbuild build permission (`allowBuilds`).

## One-time setup (~15 min)

1. **Create a Cloudflare account** at <https://dash.cloudflare.com/sign-up> (free plan).
2. **Workers & Pages → Create → Pages → Connect to Git.** Authorize GitHub and
   pick `h4axb/ascii-village`.
3. **Build settings:**
   | Field | Value |
   |---|---|
   | Production branch | the branch you want live (e.g. `main`) |
   | Framework preset | `Vite` (or None) |
   | Build command | `pnpm run build` |
   | Build output directory | `dist` |
   | Root directory | *(leave empty)* |
4. **Environment variable (build):** add `NODE_VERSION` = `22`. Cloudflare
   sees `pnpm-lock.yaml` and installs with pnpm automatically.
5. **Save and Deploy.** The first build takes ~1–2 minutes.
6. **Add the key as a secret:** project → **Settings → Variables and Secrets →
   Add** → type **Secret**, name `LLM_API_KEY`, value = your Requesty key.
   Add it for **Production** (and Preview if you want preview links to craft).
7. **Redeploy** (Deployments → latest → ⋯ → Retry deployment). Secrets only
   apply to deployments made after they were added.
8. **Set a spending limit** in the Requesty dashboard. Hiding the key stops it
   from being copied, but anyone could still call `/api` directly; the
   function limits what they can do (below), and the spending limit caps the
   worst case.

Do **not** add `VITE_LLM_API_KEY` to Cloudflare. Production builds ignore it
anyway, but it doesn't belong there.

## Optional settings

All set in the same **Variables and Secrets** screen (type *Text*):

| Name | Default | What it does |
|---|---|---|
| `LLM_ALLOWED_MODELS` | `google/gemini-2.5-flash-lite` | Comma list of models the proxy accepts. Add any model you set via `VITE_LLM_MODEL*`. |
| `LLM_MAX_TOKENS` | `2000` | Caps `max_tokens` per request. |
| `LLM_BASE_URL` | `https://router.requesty.ai/v1` | Any OpenAI-compatible provider. |
| `ALLOWED_ORIGINS` | *(none)* | Extra origins, e.g. `https://asciia-bay.com` for a custom domain. The `pages.dev` origin is always allowed. |
| `VITE_LLM_DISABLED` | *(unset)* | Build-time: `1` ships an offline build using the mock responses. |

## What the proxy enforces

- Only requests from the game's own site (checked via the `Origin` header).
- Only the allowed models.
- `max_tokens` capped.
- Request body ≤ 512 KB.

## Checking it works

1. Open the `*.pages.dev` link and craft an item: it should get a generated sprite.
2. DevTools → Network: LLM requests go to `/api/chat/completions` with **no**
   `Authorization` header.
3. DevTools → Sources: search the JS for your key's first characters. Nothing
   should be found.

If crafting fails, check **Functions → Real-time logs** in the Pages project.
`LLM_API_KEY is not configured` means step 6/7 was missed; `model not
allowed` means the model needs adding to `LLM_ALLOWED_MODELS`.

## Cost

- Cloudflare Pages hosting: free (unlimited bandwidth, 500 builds/month).
- Pages Functions: free up to 100,000 requests/day. Waiting on the LLM does
  not count toward the free plan's CPU limit.
- LLM calls: billed by Requesty.
