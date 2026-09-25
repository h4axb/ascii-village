# Art & Sprite Design System

A reference guide to how ascii-village's world art is built, distilled from the
five assets that are furthest along: **ocean**, **flower** (`FLOWER_PLUS`),
**grass** (`GRASS_HALM`), **player**, and the **date palm** (`PALM`). Use this
when authoring a new entity so it sits comfortably next to what's already
there. Source of truth is always the code — this doc summarizes the
conventions documented inline in `src/sprites.ts` and `src/world.ts`; if the
two ever disagree, the code wins and this file should be updated.

## 1. The grid

Everything is drawn on a monospace character grid, and the grid is **not
square**:

- `TILE_CH = 4`, `TILE_LN = 2` — one world tile is 4 characters wide, 2 lines
  tall (`src/world.ts`).
- `CELL_ASPECT ≈ 14 / 8.4 ≈ 1.667` — a single character cell renders about
  1.667x **taller than it is wide** (`src/App.tsx`).

That ratio drives the single most important transcription rule in the
codebase:

> **If a reference image (SVG, pixel-art) was drawn on square cells, double
> every column** — both the glyph and its colour key — before transcribing it.
> One square reference cell = two characters wide, one character tall.
> `FLOWER_PLUS` and the player sprite both apply this. Skipping it
> visibly squishes the art ~1.67x too narrow.

Each entity is then drawn at its own authored resolution and shown in-world at
a per-entity `*_SCALE` constant (`src/world.ts`). Scale is independent of
authored grid size — it decouples "how much detail is in the source art" from
"how big it looks on screen":

| Constant | Value |
|---|---|
| `PLAYER_SCALE` | 0.15 |
| `PALM_SCALE` | 1 |
| `GRASS_SCALE` | 0.2 |
| `FLOWER_PLUS_SCALE` | 0.5 |

A dense, generated sprite (palm) can stay near its native size; a huge,
photo-derived one (player, 48×28 post-doubling) gets scaled way down and is
never drawn as a bare `<pre>` — always through `ColoredSprite`.

### Unified size tiers

Every asset — hand-authored, generated-and-baked, or LLM-crafted (§11) —
belongs to one of three real-world-scale tiers, anchored to specific existing
assets so "how big should this be" always has a concrete answer instead of
being tuned by eye per asset. The numbers below are **measured on-screen
widths** (`authored sprite width × its Ent scale`, or the raw authored width
for the two assets below that use the default scale of 1) — not authored-grid
width, and not the same as the numbers in a couple of older code comments,
which had drifted from the live baked assets (see the callout under the
table):

| Tier | Anchors | On-screen width × height (chars) |
|---|---|---|
| small | flower (`FLOWER_PLUS`, 6×3 authored ×0.5) ≈ 3×1.5; grass (`GRASS_HALM`, 18×7 ×0.2) ≈ 3.6×1.4; dates (`DATE_FRUIT`, scale 1) ≈ 7×7 | |
| medium | player (48×28 authored ×0.15) ≈ 7×4; shopkeeper (`CAT`, scale 1) ≈ 10×4 | |
| large | date palm (`PALM`, scale 1) ≈ 31×23; shop (scale 1) ≈ 29×17; house (≈60×0.35) ≈ 21×15 | |

Width alone isn't a perfectly clean proxy — the player is drawn narrow-but-tall
(7 wide, 4 tall) precisely because it's a standing figure, so its raw width
lands close to a small item's (dates, ~7 wide) even though the two are very
different real-world scales. Judge a new asset's tier by the anchors' overall
*silhouette footprint* (both axes, and the subject's real-world size relative
to a person), not by width in isolation.

For a **hand-authored or generated-and-baked** asset: pick the tier first,
then choose an authored grid size and a `*_SCALE` constant (`world.ts`)
together so `authored width × scale` lands near that tier's anchors — don't
tune scale by eye in isolation from the other assets already in its tier.

For an **LLM-crafted item**: the tier maps directly to a `SIZE_BANDS` size
class (§11) — this on-screen footprint never changes. The rendered glyph
grid itself, however, is bigger than that footprint by `RESOLUTION_MULTIPLIER`
(`spriteConfig.ts`) for extra internal detail, and `ShopItem.scale`
(`src/llm.ts`) is set to compensate 1:1 so the two stay decoupled — see
`spriteConfig.ts`'s `RESOLUTION_MULTIPLIER` comment. `resolveStyle()`'s own
size-word scale (a *player*-chosen display multiplier used elsewhere) is
deliberately NOT applied to crafted items, to avoid the two scale concerns
compounding.

> **A note on the numbers above, for whoever edits this table next:** two of
> them contradict an older anchor comment that used to live in
> `src/craft/spriteConfig.ts` (`"PALM 12×8"`, `"CAT 7×3"`) — those were stale
> relative to the live baked/authored assets (`PALM` bakes at `--cols 48`
> today, `src/data/palm.json`, not the size that produced "12×8"; `CAT` is 10
> wide, not 7). The numbers here were re-measured directly from
> `src/sprites.ts`, `src/data/*.json`, and `world.ts`'s scale constants at the
> time this section was written. If an asset's authored art or scale changes,
> re-measure rather than hand-adjusting this table by feel.

## 2. Anatomy of a sprite

Every static entity is the same triple:

- **sprite** — `string[]`, one row of glyphs per line.
- **colors** — parallel `string[]`, one palette-key character per glyph cell
  (`.` conventionally means "no fill / background").
- **palette** — `Record<string, string>` mapping each key to a colour (hex, or
  a CSS `color-mix()` expression — see §5).

This split lets shape and colour be edited independently and is what
`ColoredSprite` renders. A `perCell` rendering mode exists for sprites that
need every glyph pinned to exactly `1ch` (see §4).

## 3. Two authoring techniques — pick based on density

**Hand-transcribed**, cell-for-cell from a fully-specified reference (an SVG
with exact per-glyph fills, or a pixel-art image with a clear grid): used for
`PLAYER`, `FLOWER_PLUS`, `GRASS_HALM`, `HOUSE`. Practical for anything you can
eyeball and copy by hand — roughly up to a few hundred cells. No bake script;
re-authoring means re-parsing the reference by hand again.

**Generated + baked to JSON**, for anything too dense to hand-author (the palm
is 31×23 = 713 cells, each with its own glyph *and* palette key). The model
lives in `scripts/lib/*.mjs` and a `scripts/build-*.mjs`
script bakes it to `src/data/*.json`, which `sprites.ts` just imports —
**never hand-edit the baked JSON**, edit the generator and re-bake. Generation
is deterministic (same flags → byte-identical output), which is what makes
`--seed`, `--cols`, etc. useful for iterating on the look.

Rule of thumb: if you can count the cells and mentally place each one, hand
transcribe it. If the source is dense/procedural or you want tunable
variations, write a generator instead.

A third technique exists for content that isn't authored ahead of time at
all — the in-game LLM sprite crafting feature generates a sprite live, per
player request. It has its own deliberate constraints; see §11.

## 4. Glyph charset — stay single-width

Prefer plain ASCII (`. : , ' " ~ * # o ^ &` etc.) or Unicode glyphs you've
verified are single-width. **Block/geometric-shape characters (`█ ▪ ∘ ▫`
etc.) are East-Asian-ambiguous-width** and render double-width in CJK-aware
monospace fonts, which shears the whole row.

If an asset's look genuinely needs a solid block glyph (flat "paint by
numbers" fills — `FLOWER_PLUS` and `POND` both do this deliberately),
pair it with:
1. `ColoredSprite`'s `perCell` prop, and
2. a matching `.ent.<kind> span { width: 1ch }` rule in `styles.css`.

This pins every glyph to exactly one character width regardless of the font's
own ambiguous-width table. Don't reach for block glyphs without this pairing.

## 5. Depth without extra outline

Two different depth techniques are in use, chosen by subject:

**Organic / line-art (ferns, palm fronds)** — a sparse→dense **density ramp**,
the same trick a stippled drawing uses. Pick the glyph by how much "ink" a
cell should hold; colour tiers on top of it:

```
.  :  o  *  8  @      sparse ......................... dense
```

A lit edge gets `.`/`o`; a shadowed core gets `8`/`@`. This gives a shape a
near side and a far side with zero extra strokes. All-ASCII deliberately —
same East-Asian-width trap as §4.

**Architecture (buildings)** — buildings are pure contour otherwise, which
reads as a flat wireframe with nothing in front of/behind anything else. So
instead they get **mass + signs**, a 3-step value ramp carried by *both* glyph
and colour:

| Glyph | Role | Density |
|---|---|---|
| `.` | roof fill | sparse — lightest plane, faces the sky |
| `:` | wall fill | mid — the shaded mass, recedes from the outline |
| `#` `[]` `()` `*` `O` | windows/doors/signage | dense — the only thing "lit from inside" |

Every fill character replaces a space the outline already enclosed, so the
silhouette (and collision box) is unchanged by adding fill.

**Ocean** — a third technique again, see §7: four *hard-cutoff* brightness
tiers rather than a smooth gradient, because the crisp edges are what make the
caustics pop.

LLM-crafted items (§11) deliberately skip the density-ramp technique above —
a documented divergence, not an oversight.

## 6. Palette policy — fixed hex is the default now

Nearly everything now uses **fixed, hand-chosen hex values**, not colours
derived from a shared day/night variable. An earlier `--c-arch` /
day-night-derived palette scheme existed for architecture and was removed —
the comment trail in `sprites.ts` explicitly notes this. Current policy:

- **Default: fixed hex**, chosen deliberately for the asset (player, flower,
  grass, palm, pond, bridge, house are all fixed hex).
- **Architecture's exception-within-the-default**: `ARCH_PALETTE` (used by
  the shop) derives its 3 tiers from **one** base hex via CSS `color-mix()`,
  so the roof/wall/lit relationship survives if the base colour is ever
  changed — but the base itself is still a fixed, chosen value, not a
  day/night variable.
- **The palm is a documented, deliberate outlier**: its olive-to-rust gradient
  is fixed hex and does **not** shift with the day/night cycle at all, because
  re-deriving that specific look from one themed hue would flatten exactly
  what gives it depth. This is the precedent for future exceptions: it's fine
  to opt an asset out of a shared scheme, but say so in a comment and explain
  the tradeoff — don't let it happen by accident.

## 7. Ocean — a special case, not a static sprite

The ocean isn't a sprite at all; it's generated per animation frame
(`oceanCaustics()`, `src/world.ts`) because caustic drift never wraps/loops.
Notable choices worth reusing for other "living surface" effects:

- **Viewport-bounded compute** — the expensive per-cell noise pass only runs
  within camera bounds (+ a small margin), not the whole map, so cost scales
  with what's on screen. A cheap full-grid clear pass still runs everywhere.
- **One `<pre>` per colour tone**, not a `<span>` per character — six DOM
  elements total for the whole sea instead of one per cell.
- **Hard cutoffs between brightness tiers**, not a gradient — each tier is a
  solid region with a crisp edge, which is what makes the caustics read as
  glints rather than a haze.
- **Saturated, not dark**, as the design intent: "the sea should read as alive
  edge to edge, not as gloom with bright spots on it."

Current ocean palette:

| Layer | Hex | Role |
|---|---|---|
| base lattice | `#50ae93` | body of the water |
| base lattice (lit) | `#225a6e` | shadow tone in the two-tone base |
| caustic tier 0 | `#3d8c96` | darkest tier |
| caustic tier 1 | `#57b3b3` | |
| caustic tier 2 | `#66cdc1` | |
| caustic tier 3 | `#98e6d4` | brightest glints — deliberately the smallest slice of the range |
| shore foam (both bands) | `#a0e1e6` | density (glyph), not colour, separates the two foam bands |

## 8. Collision mask ≠ visual sprite

A sprite's walkable footprint can — and often should — be simpler than its
silhouette. The palm's `PALM_SOLID` mask only has a glyph over the trunk and
the hanging date bundles; the leafy crown is left blank even though `PALM`
draws it, so the player can walk under the canopy but still bumps the trunk.
Don't assume collision has to match the visual outline pixel-for-pixel —
design the mask for how the *space* should feel to walk through.

## 9. Reference: the five current assets

| Asset | Technique | Authored grid | Scale | Palette | Notes |
|---|---|---|---|---|---|
| **Ocean** | Generated per-frame (not a static sprite) | full map, viewport-bounded compute | n/a | 6 fixed hex tones (§7) | 4 hard-cutoff caustic tiers over a 2-tone base + 2-band foam |
| **Flower** (`FLOWER_PLUS`) | Hand-transcribed, column-doubled | 6×3 | 0.5 | 2 keys, fixed hex — petals `#E27E8F`, centre `#f5ec5a` | Solid `█` glyph → needs `perCell` + `1ch` CSS pin (§4) |
| **Grass** (`GRASS_HALM`) | Hand-transcribed, column-doubled | 18×7 | 0.2 | 22 keys, fixed hex, sage→olive ramp | Decorative accent, distinct from the per-region ground-scatter characters (`SCATTER` table, world.ts) |
| **Player** | Hand-transcribed from a reference SVG, colours k-means-reduced from 286 near-unique hexes to 40 | 48×28 (post-doubling) | 0.15 | 40 keys, fixed hex, near-photo gradient | Always drawn via `ColoredSprite`, never a bare `<pre>` — too big for native size |
| **Date palm** (`PALM`) | Generated (`scripts/lib/palm.mjs` → `src/data/palm.json`) | 31×23 | 1 | Fixed hex, olive→rust gradient — **does not** shift with day/night (§6) | Separate cropped `PALM_SOLID` collision mask (§8) + baked `PALM_ANIM` shake animation data |

## 10. Checklist for a new asset

1. **Pick a technique.** Small and fully-specified reference → hand-transcribe.
   Large/dense (hundreds of cells) or you want tunable variants → write a
   generator under `scripts/lib/` and a `scripts/build-*.mjs` baker.
2. **Column-double** if the source was drawn on square cells (§1).
3. **Build the sprite/colors/palette triple** (§2). Reuse an existing palette
   key scheme where the new asset is visually related to one (e.g. share the
   grass ramp for another ground plant).
4. **Choose fixed hex colours** deliberately (§6) — don't wire into a shared
   day/night variable unless one actually still exists and applies. If the
   asset should be an intentional outlier (like the palm), say so in a
   comment.
5. **Pick a depth technique** matching the subject: density ramp for organic
   line-art, mass+signs for solid structures (§5).
6. **Check every glyph for ambiguous width** (§4); add the `perCell` + `1ch`
   CSS pin if you used any block/geometric characters.
7. **Set a `*_SCALE` constant** in `world.ts` sized to how it should look
   in-world, independent of the authored grid.
8. **Design the collision mask** (if solid) for how the space should feel to
   walk around, not as a copy of the visual silhouette (§8).
9. Document the technique and any deliberate exceptions inline, the way
   `sprites.ts` does for every existing asset — the comment trail here *is*
   the style guide's living source.

## 11. LLM-crafted items — a third authoring technique (deliberately divergent)

The in-game crafting feature (`src/craft/spriteGen.ts`, `spriteValidate.ts`,
`spritePipeline.ts`) is a third technique alongside hand-transcription and
generate-and-bake (§3): a small/fast LLM generates a fresh sprite live from
the player's text description, validated and retried on the way to the
player — never persisted or reused as a template. Its constraints diverge
from the rest of this guide in a few specific, deliberate ways, each chosen
for **reliability on a small/fast model** over strict stylistic conformance:

- **No density-shading depth in the LLM's OWN output (diverges from §5) —
  but density-ramp shading now happens anyway, deterministically.** The
  crafting system prompt still forbids the LLM from reasoning about relative
  local ink density itself, for the reliability reason below — but as of the
  region-plan architecture (`spriteGen.ts`'s `planCraft`/`CraftPlan`), the
  LLM never emits glyphs or density at all; it only plans WHERE geometric
  regions go (`RegionSpec`). A local, deterministic renderer
  (`glyphRender.ts`) applies 3-band shading, a ramp, and — per-band —
  texture-glyph variety independently of the shading itself (see
  `glyphRender.ts`'s own header note on why glyph choice and colour/shading
  are deliberately decoupled). So the ORIGINAL reliability argument below
  (a model juggling density reasoning + everything else at once) no longer
  applies to that part of the pipeline; it's kept as policy for what the
  MODEL is asked to do, not a limit on what the final sprite looks like.
  Original tradeoff, still true of the model's own task: a model capable
  enough to reliably reason about relative local ink density *while* holding
  the rest of the grammar together is a bigger/more expensive model than
  this feature's budget allows; silhouette/region-only output is simpler and
  measurably more reliable at this model tier.
- **Stricter than §4's baseline charset policy, not looser.** §4 permits
  block/ambiguous-width glyphs *if* paired with `ColoredSprite`'s `perCell`
  mode and a `1ch` CSS pin. Crafted sprites ban ambiguous-width glyphs
  outright and never use `perCell` — there's no human authoring/review step
  before a crafted sprite reaches the player, so there's no point in the
  pipeline to catch a missed pairing the way a human author would.
  `ALLOWED_CHARS` (`spriteConfig.ts`) is pure ASCII plus a hand-verified
  four-glyph `FACE_SET`; anything else is rejected by
  `spriteValidate.ts`'s codepoint-based `checkChar`.
- **Fixed, small hex palette per part — matches §6, no divergence.** 2-5
  `#rrggbb` keys, assigned per anatomical part, exactly the "fixed hex is the
  default" policy in §6.
- **Size bands anchored to the hand-made world, same principle as
  everywhere else in this doc** — `SIZE_BANDS`/`MAX_SPRITE_WIDTH`
  (`spriteConfig.ts`) are derived directly from the PLAYER/CAT/PALM/HOUSE/SHOP
  hand sprites' own on-screen dimensions, so "duck < player < tree/house"
  falls out by construction instead of being hand-tuned in a vacuum. `
  sizeClass` also starts from a `CATEGORY_SIZE_DEFAULT` prior tied to the
  same small/medium/large tier table defined in §1's "Unified size tiers" —
  Stage 0 (`screenPrompt`) uses it as a strong default and only moves off it
  when the request's own words (a size adjective, an obviously-wrong-scale
  subject) call for something bigger or smaller.
- **Collision is a known future extension point, not implemented.** The
  `solidMask` mechanism (§8, `Ent.solidMask`) has no consumer for crafted
  items today — a crafted item currently only ever becomes inventory, an
  equipped pet/accessory, or a planted crop (a fixed-slot array with no `x`/
  `y`/`Ent`, bypassing world collision entirely). Add mask generation to the
  crafting pipeline only alongside an actual "place a crafted item in the
  world" feature — there is nothing to design against yet.
