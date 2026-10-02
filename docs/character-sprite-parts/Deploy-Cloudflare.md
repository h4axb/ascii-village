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

## Live links

| Link | What it opens |
|---|---|
| <https://asciia-bay-2.app-testing.workers.dev/> | The game as a new player gets it: **with the intro** for a new save, straight into the island for a finished one. |
| <https://asciia-bay-2.app-testing.workers.dev/0> | **Standard workshop, without the intro:** starts straight on the island, whatever the save says. |
| <https://asciia-bay-2.app-testing.workers.dev/intro/0> | **Standard workshop with the intro** (same as `/intro`): always plays the intro, even over a finished save. |
| <https://asciia-bay-2.app-testing.workers.dev/intro> | Same as `/intro/0`. |
| <https://asciia-bay-2.app-testing.workers.dev/1> | **Pre-clarification (panel 1), without the intro:** after the player writes a prompt, Mitchy asks 0–2 short questions that really change the picture (one chat message each, answers as buttons, always with "✦ You decide"), then shows her plan, where any answer can be changed by clicking a tag; the green Craft it! button commits, Esc skips. Every result is rated (▲ I like it / ▼ Not quite, then tags, other /1 players' tags and an own 30-character tag), failures offer no alternatives. See `docs/CraftFeedback.md`. |
| <https://asciia-bay-2.app-testing.workers.dev/intro/1> | **Pre-clarification with the intro.** |
| <https://asciia-bay-2.app-testing.workers.dev/2> | **Post-reflection (panel 2), without the intro:** the normal workshop, but every result must be rated (▲ I like it / ▼ Not quite, with optional reasons and a one-sentence comment), the player can tune future crafts (detail, colour, interpretation, surprise — remembered per kind, for all crafts or for the session), and only then is "Adjust it (12 coins)" offered. See `docs/CraftFeedback.md`. |
| <https://asciia-bay-2.app-testing.workers.dev/intro/2> | **Post-reflection with the intro.** |
| <https://asciia-bay-2.app-testing.workers.dev/3> | **Alternatives (panel 3), without the intro:** a preflight offers two concepts or "Surprise me" for requests that can't be drawn as asked, no automatic re-plan, and leaving keeps the last finished design (this was `/1` before). |
| <https://asciia-bay-2.app-testing.workers.dev/intro/3> | **Alternatives with the intro.** |
| <https://asciia-bay-2.app-testing.workers.dev/2/feedback> | **The feedback dashboard** (password: the `FEEDBACK_ADMIN_TOKEN` secret): every rating from /1 and /2 (plus /1's clarification answers) as charts, a table and CSV/JSON export. Needs the one-time setup in "Crafting feedback" below. |

These paths work because `wrangler.jsonc` sets `not_found_handling:
"single-page-application"`, so the Worker serves the game for any path;
`src/App.tsx` (`INTRO_LINK`) reads the path to decide (and `src/main.tsx`
for `/2/feedback`).

## Workers or Pages?

The repo works with both:

- **Workers** (Cloudflare's recommended option, used now): `wrangler.jsonc`
  serves `dist/` and routes `/api/chat/completions` to `worker/index.ts`.
- **Pages**: uses `functions/` automatically and ignores the Worker files.

Both run the same proxy code (`functions/api/chat/completions.ts`).

## Setup as a Worker

1. **Workers & Pages → Create application → Import a repository** →
   `h4axb/ascii-village`.
2. **Settings:**
   | Field | Value |
   |---|---|
   | Project / Worker name | `asciia-bay-2` (must match `name` in `wrangler.jsonc`) |
   | Build command | `pnpm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *(leave empty)* |
3. **Deploy.** The log should end with a `…workers.dev` URL.
4. **Add the key:** Worker → **Settings → Variables and Secrets → Add** →
   type **Secret**, name `LLM_API_KEY`. Secrets apply immediately; no
   redeploy needed.
5. **Set a spending limit** in the Requesty dashboard.

To rename the Worker, change `name` in `wrangler.jsonc` to the same value.

Test locally: create `.dev.vars` with `LLM_API_KEY=...` (git-ignored), run
`pnpm run build`, then `npx wrangler dev`.

## Setup as Pages (alternative, ~15 min)

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

## Crafting feedback (one-time setup for `/2` and `/2/feedback`)

Panel-2 ratings are stored in a **Cloudflare D1** database through the same
Worker (`functions/api/feedback.ts`, routed in `worker/index.ts`). Until this
is set up the game works normally; ratings wait in each player's browser and
are sent once the store exists. Run these in the project folder (PowerShell
works), logged in with `npx wrangler login` if asked:

1. **Create the database:**
   `npx wrangler d1 create asciia-feedback`
   It prints a `database_id`.
2. **Bind it:** in `wrangler.jsonc`, remove the `//` in front of the
   `"d1_databases"` lines (3 lines) and paste the `database_id` in place of
   `PASTE-ID-HERE`.
3. **Create the table:**
   `npx wrangler d1 execute asciia-feedback --remote --file=worker/feedback.sql`
4. **Set the dashboard password** (it asks you to type it; it's stored
   encrypted on Cloudflare, never in the repo):
   `npx wrangler secret put FEEDBACK_ADMIN_TOKEN`
5. Commit + push `wrangler.jsonc`. After the deploy, open `/2/feedback` and
   enter the password.

What it stores, and what it never stores, is in `docs/CraftFeedback.md`.
Under `pnpm dev` none of this is needed: ratings go to `.feedback-dev.json`
(not committed) and the dashboard password there is `dev` (or the
`FEEDBACK_ADMIN_TOKEN` environment variable, if set).

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
