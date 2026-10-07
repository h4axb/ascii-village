# Glyph Generator

A dev tool that turns pictures into marked glyph references. It's the source material for crafting from references (below) and for world-editor assets. It is not part of the game: nothing under `tools/` is imported by the game, and the game build never sees it.

```
pnpm ref        # opens on http://localhost:5180
```

Auto-marking uses the LLM key in `.env` (`VITE_LLM_API_KEY`, `VITE_LLM_BASE_URL`; the model is `VITE_LLM_MODEL_WORLDASSET`, default Claude Haiku), at **one call per image**. Without a key, everything else still works and parts start as colour areas.

## The workflow

### 1. Import

- **Adding images:** drop a **ZIP**, single **PNGs** (also webp or jpg) or a **folder**, up to **20 per batch**.
- **Processing:** each image gets a card with progress (queued, cleaning, marking, ready or flagged), and all of them run at once:
  - **cleaning:** removes the background (transparency, or a plain backdrop flood-filled from the corners), crops, and scales to at most 128 px. Photos (thousands of colours) are turned into flat pixel art first; this is on `auto` and can be switched always on or off.
  - **auto-marking:** the model names the object (role, category, title, tags, description) and outlines its **parts** with rough polygons, using the part names from `tools/glyph-ref/vocab.json`. It also places **anchors** and **areas**. The polygons are then **snapped** to the art: each flat colour area of the picture takes the part most of it was outlined as, so the borders follow the drawing exactly.
- **Folder names are hints:**
  - `boat/pirate.png` is a boat;
  - `boat/sails/striped.png` is a sail that can replace a boat's sail;
  - `decorations/gem.png` is a decoration.
- **Flagged:** a part too small to read at the simple sign count, or an AI call that failed. The reason is shown on the card.

### 2. Markers

Fix or add marks, one image at a time (prev / next):

| Tool | What it does |
|---|---|
| fill area | Click a colour area to give it the selected part. This is the fastest fix. |
| paint / erase | Brush the selected part on, or unmark. |
| anchor | A named point. Select one in the list, then click to move it. |
| ★ deco area | A box where a decoration (flag, gem …) may go, with the tags it suits. |
| ✎ detail area | A box where a detail with no reference may be painted (a skull on a sail), optionally only on one part. |

Each part has a **zone**:
- **primary** and **secondary**: recoloured by material and colour words;
- **trim**: small accents;
- **fixed**: never recoloured (eyes, faces).

Also set per image: role (**body** = a whole object, **part** = a swappable part with "replaces part", **decoration**), category, game category, size, tags and description.

### 3. Glyphs

**Generate glyphs** bakes the selected images.

- **Combined:** the result as the game draws it, and as the SVG sheet.
- **Components:** every part in its own colour, with cell counts; click a part to show it alone. This checks that the split worked. **← fix marks** goes back to the Markers tab.
- **Signs:**
  - simple about 200, middle about 600, detailed about 1,600, or any target;
  - plus edge contrast, outline, tones, contrast, saturation, lift, glyphs that follow edges, and filling enclosed gaps;
  - **apply to selected** copies the settings to every selected image;
  - **download .svg** saves the sheet.

### 4. Send

The checkboxes on the cards decide what goes where, so one batch can split. For example, tick 2 or 3 images and:

- **Send to editor assets** → `src/data/assets/<category>-<title>.json`. Reload the game to see them in the world editor under **New**. Asset kind (boulder or decor) and scale are set here.
- **Send to crafting library** → `src/data/refs/<id>/` (`art.png` + `ref.json`). The in-game crafting builds items from these.

Existing names ask before overwriting. The batch is autosaved to `tools/glyph-ref/refs/work/` (gitignored), so a reload keeps your work. **remove** clears selected images from the batch.

## Crafting from references (in the game)

`src/craft/refCraft.ts`, called first by `craftItem` (`src/llm.ts`) on the links in `REF_CRAFT_LINKS` (`/0` and `/3`). The quest test links keep the shape planner. A dev can turn it on anywhere with `localStorage['craft-refs'] = 'on'`.

1. **Match, with no LLM call.** The player's words become a recipe, step by step:
   - a **body** (by category nouns, tags, title words);
   - **colours** per part ("red sail", "sail of gold"; "a red boat" colours its main part);
   - **swapped parts:** a library part whose tags are named with the part ("a striped sail");
   - **decorations:** a library decoration named in the words, placed into a body area that accepts it.
2. **One call, only when needed.** It happens when words are left that the matcher couldn't place, or the player asks for a name or a function. The model gets the library's ids, parts and areas, and returns:
   - the recipe;
   - the **shapes of details with no reference**, drawn inside the body's detail areas and clipped to the area's part;
   - the item's **name, description and function**.

   This replaces the planner and describer calls.
3. **Build.** The pixels are composed in this order (`src/glyph/refs.ts`):
   - body;
   - swapped parts, fitted into the old part's place behind the other parts;
   - colours, keeping the art's shading;
   - decorations;
   - details;
   - optional mirror.

   They are then baked to glyphs at the size band's sign count (`src/glyph/bake.ts`). It takes about 20–80 ms.

When no reference body fits (and the model doesn't find one either), the craft goes to the shape planner as before. That miss, and any words the library could not place, are logged as feedback records. The feedback dashboard shows them under **Crafting library: missing references**, which is the list of references to make next.

## How the baker keeps details (`src/glyph/bake.ts`)

- **Dominant colour per cell**, not the mean, so edges stay crisp.
- **Shape matching on edges.** Where a cell holds two clearly different colours in a coherent shape (not dithering), its light/dark pattern is matched against every glyph's bitmap, drawn in the game font and doubled as in the game (`src/glyph/atlas.ts`).
- **Flat cells** use the density ramp.
- **Finishing:** outline, tone count (median cut, at most 62), contrast and saturation, and the lift for the game's dark backing.

## Making good source pictures

- **One object per image:** plain or transparent background, top-left light, no cast shadow.
- **Size:** about 32–128 px of pixel art carries all the detail a sign count can show.
- **Parts that will change colour:** draw them in one clear hue with full shading.
- **Swappable parts:** draw each part on its own image, roughly the size it has on the body.
- **Decorations:** small and readable (a gem, a flag, a flower).
- **From an image AI:** ask for "pixel art, single object, plain white background, no shadow".

## Files

| File | What |
|---|---|
| `src/glyph/bake.ts` | the baker (pure, no DOM), shared by the tool and the game |
| `src/glyph/atlas.ts` | glyph bitmaps in the game font |
| `src/glyph/refs.ts` | the reference format and the composer (recolour, swap, decorate, detail, mirror) |
| `src/glyph/sprite.ts` | baked grid → game sprite; cells → parts |
| `src/craft/refCraft.ts` | the library, the matcher, the one call, the build |
| `tools/glyph-ref/main.tsx` | the tool's page (Import, Markers, Glyphs) |
| `tools/glyph-ref/automark.ts` | the vision call, snapping, colour areas, folder hints |
| `tools/glyph-ref/clean.ts`, `zip.ts` | cleaning pictures, reading ZIPs |
| `tools/glyph-ref/exportSvg.ts` | SVG sheet, game asset, reference |
| `tools/glyph-ref/vocab.json` | categories and their part names |
| `tools/glyph-ref/vite.config.ts` | its dev server: AI call, autosave, the two send targets |
