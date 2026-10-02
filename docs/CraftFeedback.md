# Crafting panels 1 and 2: pre-clarification, feedback and preferences

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

## Crafting panel 1: pre-clarification (`/1`, `/intro/1`)

Preventive guidance before generation, the counterpart of panel 2's
reflection afterwards. Code: `CraftModal.tsx` (`clarify`), `CraftClarify.tsx`,
`craft/spriteGen.ts` (`clarifyCraft`, `clarifyGuidance`), `craft/moods.ts`.

**Flow**

1. The player writes a prompt and presses Craft it!. One small AI call
   (`clarifyCraft`) decides whether the request leaves a decision open that
   really changes the sprite. Most clear requests get no questions and craft
   directly.
2. Otherwise Mitchy asks up to two questions, one chat message each. The
   answers are reply buttons, always with "✦ You decide". The text field is
   locked; there is no free-text back-and-forth.
3. After the last answer she shows her plan: every decision with its answers
   as tags. A click on another tag changes the answer. The workshop's own
   Craft it! button (green when usable, the same on every link) commits.
4. Esc skips at any point: open questions become "You decide" and the craft
   starts.
5. The result is rated in a fixed-size panel: ▲ I like it / ▼ Not quite, then
   in the same panel "What did you like?" / "What didn't work for you?" with
   standard tags, tags other /1 players wrote (soft green fill) and an own tag
   of at most 30 characters (max 3 picks). Done or Esc shows "Thank you for
   your honest feedback!", then the usual options (equip, inventory, adjust
   for 12 coins; an adjustment asks no questions and is rated again).
6. A failed craft offers no alternative ideas (that is the alternatives
   variant, `/3`); Mitchy says it didn't work and the prompt is pre-filled.

**Which questions are allowed, and why.** A sprite is a few planned shapes
drawn by fixed code, so only these axes visibly change it: main colour,
size, which feature gets the space, shape character, finish, mood. Tiny
details, behaviour and the scene are never asked about. Every answer carries
a concrete `effect` for the planner; size and finish are also applied
exactly in code, and a mood is a preset (`craft/moods.ts`): a palette shift
and glyph set (exact), a finish (exact) and a shape hint for the planner.
Measured on one plan: cute is lighter with round glyphs (`°@+:`), mysterious
clearly darker (average brightness 108 vs 146) with dense glyphs, large is
about 2.7× as wide as small.

**What is stored** (same backend as `/2`, `src/feedback/schema.ts`): each
rating with `positive` ("I like it" tags), `tags` (own and other players'
tags) and `clarify` (each question, its options, the answer or "You decide",
skipped, time spent, outcome). A clarification that never reached a rating
(the craft failed or the player left) is stored with `vote: null`.

**Shared tags.** `GET /api/feedback/tags` (public, no password) returns only
tag text and counts, top 8 per vote, from `/1` records; every tag passes the
content check before it is stored or shown. `/2` never shows them.

**Dashboard.** `/2/feedback` adds like rate by link, "Why I like it (/1)",
"Player tags (/1)" and a pre-clarification section (questions asked, answers
picked vs left to Mitchy, skips, failures, leaves, like rate with vs without
questions); the CSV/JSON export carries all new fields.
