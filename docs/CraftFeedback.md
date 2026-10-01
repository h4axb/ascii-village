# Crafting panel 2: feedback and preferences

The `/2` (and `/intro/2`) link runs the normal workshop plus a feedback loop.
`/2/feedback` shows what players said. Setup on Cloudflare:
`docs/character-sprite-parts/Deploy-Cloudflare.md` → "Crafting feedback".

## The flow (CraftModal.tsx + CraftFeedback.tsx)

1. A craft's result shows its **kind** tag (Plant, Creature, Wearable,
   Vehicle, Food, Object) and, when preferences were used, "made with: …".
2. **The player must rate it** — ▲ I like it / ▼ Not quite — before taking it.
3. **"Not quite"** offers up to 3 reason tags and an optional one-sentence
   comment (stops at the first `.`, `!` or `?`, max 120 characters).
   These are **pure feedback**: they change nothing in the game.
4. **"Tune future crafts →"** (optional) asks one question at a time:
   Detail, Colour, Interpretation, Surprise (each skippable), then where to
   remember the answers: this kind / all crafts / this session. A summary
   says they can be changed in **Settings → Crafting preferences**.
5. Only after that is **"Adjust it (12 coins)"** offered — so an adjustment
   already uses the new preferences. An adjusted result is rated again.
6. Leaving the workshop keeps the last result (like `/1`).

## What each preference does (craft/prefs.ts)

| Preference | Answers | How | Reliability |
|---|---|---|---|
| Detail | Less / Keep / More | Glyph density: the plan is rendered with 1× / 2× / 3× glyph cells per on-screen cell; the item's size in the world doesn't change | Exact (code) |
| Colour | Pastel / Keep / Vivid | The finished palette's saturation and lightness | Exact (code) |
| Interpretation | Essentials / Keep / Every detail | A planner instruction: only the main subject and its defining features, or every feature named | Steers the language model; not guaranteed per craft |
| Surprise | Controlled / Keep / Surprise me | A planner instruction + temperature (0.4 / 0.7 / 0.95): a concrete reading with nothing added, or an abstract reading with 1–3 details of its own on top | Steers the language model; not guaranteed per craft |

**Kinds.** The planner names the kind of every craft by its **main element**
("a dog with a witch hat" → Creature). Preferences saved for a kind apply to
every later craft of that kind. Interpretation and surprise must be known
before planning, so when kind preferences exist a tiny extra call classifies
the request first; detail and colour are applied after planning with the
planner's own kind. Per setting the most specific wins: this session, then
the kind, then all crafts.

**Where preferences live.** In the player's browser (`asciia-craft-prefs`);
"this session" ones only in memory. They apply only on the `/2` links.

## What is stored (src/feedback/schema.ts)

One record per rated result (updated when reasons, comment or tuning change):
time, an anonymous random player id and session id (no name, no account),
the link, the prompt and item name, the kind, whether it was an adjustment,
the vote, reasons and comment, the preferences it was made with, the tuning
answers and scope, and the sprite (so the dashboard can show it). The
Worker accepts records only from the game's own site, checks sizes, drops
unknown values, and lets only the same player update a record. Reading
needs the `FEEDBACK_ADMIN_TOKEN` password.

## The dashboard (`/2/feedback`, src/feedback/Dashboard.tsx)

Tiles (ratings, like rate, players, tuned, adjusted), votes per day, like
rate per kind, "Not quite" reasons, how each preference question was
answered, where answers were remembered, and a table of every rating
(comments first, with the sprite). Filters: date range, kind, link. Export
as CSV (spreadsheets) or JSON. It is loaded on demand, so the game never
downloads it.
