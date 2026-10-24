# The review link (a developer plays the game) and the main site's lock

## The main site's lock (`worker/lock.ts`, `worker/index.ts`)

The main Worker checks every request before anything is served.

- **Open without a password:** a participant's personal link (`/intro/1?k=…`, `/intro/2?k=…`) with a key that exists. The key then stays in an HttpOnly cookie, so a reload works after the game takes it out of the address bar. The APIs that link uses with its key, and the static files (code and art), are open too.
- **Everything else asks for the dashboard password once per browser:** `/`, `/0`–`/4`, `/test`, `/cinematic`, `/2/feedback`, made-up paths like `/admin`, and the open APIs. The password is the secret `FEEDBACK_ADMIN_TOKEN`. Unlocking keeps a signed cookie for 30 days, and `/2/feedback` then opens without asking again. "Lock" in the dashboard header (or `/api/lock`) forgets it.

The game's JavaScript is public by nature: anyone can read it in DevTools, including the names of the other paths. Knowing them gives nothing, because the server refuses those pages and APIs without the password.

## The review Worker for a developer

A separate Worker, `island-preview`, built from the same repository:

- **What it plays:** the game alone (`npm run build:review`, `src/review.ts`). That is the intro (with "Skip intro"), then the quests from questline 1, design A then B. At the end there is "Finish game" instead of the survey, which goes back to the start screen.
- **Its own password** (`REVIEW_PASSWORD`), never the dashboard's.
- **No database, no AI key, no API** (`worker/review.ts` answers 404 for `/api/*`). It can't reach the main Worker or its data.
- **AI:** the developer enters their own OpenAI-compatible endpoint, key and model, on the start screen or in Settings → AI. The key stays in their browser, and the game calls their provider directly. Without a key, crafting runs offline.

### One-time setup (Cloudflare dashboard)

1. **Workers & Pages → Create → Import a repository:** the same repository and branch (`main`). Name it `island-preview` (it must match `"name"` in `wrangler.review.jsonc`).
2. **Build settings:**
   - **Build command:** `npm run build:review`
   - **Deploy command:** `npx wrangler deploy --config wrangler.review.jsonc`
3. **Settings → Variables and Secrets:** add a **Secret** `REVIEW_PASSWORD` with the password you give the developer. Use a different one from the dashboard password.
4. **Deploy.** The link is `https://island-preview.<your-account>.workers.dev`. Send the developer the link and the review password, separately.

From a terminal instead of the dashboard:

```sh
npm run build:review
npx wrangler deploy --config wrangler.review.jsonc
npx wrangler secret put REVIEW_PASSWORD --config wrangler.review.jsonc
```

### Before sending the link

- In a private window, open the review link: you should get the password page.
- After entering the password, DevTools → Network should show requests only to the review link and, once a key is entered, to the AI provider. Nothing goes to the main site.
- `https://island-preview…/api/admin/invites` → 404.

Both Workers share your `workers.dev` account subdomain, which shows they belong to the same account but opens nothing. For full separation, use a second Cloudflare account or a custom domain.

### Afterwards

Change `REVIEW_PASSWORD` to lock the developer out, or delete the `island-preview` Worker. The main site is not affected.
