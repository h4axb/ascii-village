# Glyph Ref Maker

A dev tool that turns any PNG into glyph art for the game, without an LLM.

It makes the **reference material** for the crafting generator: glyph sheets with marks that say which part is which, where things attach and where decorations may go. It is not part of the game. Nothing under `tools/` is imported by `src/`, so nothing ships.

```
pnpm ref        # opens on http://localhost:5180
```

## Workflow

1. **Load an image.** Drop a PNG (or webp or jpg) anywhere on the page, or pick one from the list. Dropped images are copied to `tools/glyph-ref/refs/src/`.
2. **Choose the sign count**, the number of glyphs drawn:
   - **simple**: about 200 signs;
   - **middle**: about 600;
   - **detailed**: about 1,600;
   - or any target on the slider. The grid is solved from the object's silhouette, and the live count is shown on top.
3. **Tune it.** Three views update live:
   - the source;
   - the sheet (square cells, like the SVG);
   - the in-game look: columns doubled, rows stretched and the dark per-cell backing, on grass.
4. **Mark it** (optional, for the crafting generator):
   - **Parts:** add a part, then paint it on the sheet. Each part has a **material zone**: primary, secondary, trim, or fixed (never recoloured). **auto zones** splits the cells into colour groups as a first guess.
   - **Anchors:** click to place a named point (`top`, `handle`, `attach`, `seat`, …).
   - **Decoration slots:** drag a box, name it, and list the decorations it accepts.
   - **About it:** tags, category, size band.
5. **Save.** It writes to `refs/out/`:
   - `<name>.svg`: the glyph sheet, in the same format as the existing references (`cat8_glyph.svg`, `pond3_blueberries.svg`):
     - one `<text x y fill>` per 20px cell;
     - `<g data-part data-zone>` per part;
     - hidden anchor and slot markers;
     - `data-signs`, `data-anchors`, `data-slots`, `data-tags` on the root.
   - `<name>.json`: the bake settings, grid and marks.
   - `<name>.asset.json`: a game asset, columns doubled and rows stretched, with the part masks, anchors and slots in game cells.
   - With **also save simple / middle / detailed**, the same three files again for each preset, named `_simple`, `_middle` and `_detailed`.
   - With **also write src/data/assets/**, the game asset goes straight into the game. It shows in the world editor under **New**.
   - Settings and marks are kept in `refs/src/<name>.ref.json`.

**re-bake all** rebuilds every image that has saved settings. Use it after improving the baker, or to re-export everything.

Marks are stored relative to the object, not to the grid, so the same marks fit every sign count.

## How the baker keeps details (`tools/glyph-ref/bake.ts`)

- **Background:** removed by transparency, or by a flood fill from the corners over a plain backdrop (the `bg tolerance` setting).
- **Dominant colour per cell**, not the mean, so edges stay crisp.
- **Shape matching on edges.** Where a cell holds two clearly different colours in a coherent shape (not dithering), its light/dark pattern is compared with every glyph's bitmap, rendered in the game font and doubled as in the game (`glyphAtlas.ts`). The best match wins, so contours get `/ \ | _ ( ) ^ v`. Flat cells get the density ramp by their brightness.
- **Finishing:**
  - an outline (the outer ring of cells darkened);
  - enclosed gaps filled;
  - tone count (median cut, at most 62, which is the game's key limit);
  - contrast and saturation;
  - **lift** for the game's backing (each cell sits on its own colour at 45%).

## Making good source PNGs

- **One object per image:** transparent or plain background, light from the top-left, no cast shadow.
- **Resolution:** about 2 art pixels per glyph cell carries all the detail a sign count can show. That is roughly 32–64 px for items and up to 128 px for props; bigger images are fine and scaled down on load.
- **Strong silhouettes and clear value steps** read best. Fine noise and dithering turn into texture.
- **Colours that will change:** for parts whose material the generator will change, draw them in one base hue with full shading. Mark them `primary` or `secondary`.
- **Decorations** (flags, gems, flowers, eyes) work best as their own small images with one `attach` anchor.
- **From an image AI:** ask for "pixel art, single object, plain white background, no shadow".

## Files

| File | What |
|---|---|
| `tools/glyph-ref/bake.ts` | the baker (pure, no DOM) |
| `tools/glyph-ref/glyphAtlas.ts` | glyph bitmaps in the game font |
| `tools/glyph-ref/marks.ts` | parts, zones, anchors, slots |
| `tools/glyph-ref/exportSvg.ts` | SVG, JSON and game-asset writers |
| `tools/glyph-ref/main.tsx` | the page |
| `tools/glyph-ref/vite.config.ts` | its dev server and file endpoints (only under `refs/` and `src/data/assets/`) |
