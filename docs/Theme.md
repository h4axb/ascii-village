# Environment theme

All the colours of the world's nature live in one file, `src/data/theme.json`, and can be edited live in the world editor's **Theme** tab (press `E`, then **Theme**).

## What it covers

| Group | What |
|---|---|
| Grass | ground, light and dark patches, coast band, grass glyphs |
| Bushes | the bushy coast edge and its glyphs |
| Sand | sand, outer and wet sand, grain |
| Water | shallows to deepest, water glyphs, sparkles, foam, the map's sea |
| Rocks | rocks and beach stones |
| Palm | fronds, dead fronds, trunk, dates (dropped dates too) |
| Flowers & tufts | collectable flower, grass tufts (tip and base, blended between) |

The house, shop, Mitchy, the pond, the player, crafted items and the UI keep their own colours: neither the swatches nor the grade touch them.

## Presets and the grade

`theme.json` holds named **presets**. `active` is the preset the game ships with. Each preset has:

- **swatches:** one colour per name (`grass.base`, `water.deep`, …);
- **grade:** applied on top of every swatch:
  - saturation, brightness and contrast (1 = unchanged);
  - warmth (−1 cool … +1 warm);
  - a tint colour and how strongly to pull toward it.

For trying a mood, start with the grade sliders and adjust single swatches afterwards. To try something without losing the current look, use **+ new**: it copies the current preset.

## Workflow

1. `pnpm dev`, open the game, press `E`, then open **Theme**.
2. Drag sliders and pick colours. The world repaints within a fraction of a second; the terrain rebuild is throttled while you drag.
3. **save theme** writes `src/data/theme.json`, with the selected preset as `active`. **revert** throws away unsaved changes.
4. Commit `theme.json`.

Saving is dev-server only (`/__dev/save-theme` in `vite.config.ts`). A build simply reads the file.

## For code

- **`src/theme.ts`:** the swatch list (`SWATCH_GROUPS`), the grade maths and the live API.
- **Reading a colour:** `themeColor('water.foam')` for a hex string, `themeRgb()` for an RGB array.
- **Colours you bake:** subscribe with `onThemeChange()`. `terrain.ts` rebuilds its field and `sprites.ts` refills the palm, flower and tuft palettes.
- **Adding a swatch:**
  1. add it to `SWATCH_GROUPS` and to the preset in `theme.json`;
  2. read it with `themeColor()` wherever the colour is used.

## Ground paint

The world editor's **Ground** tab paints onto the island's land:

| Tool | What it does |
|---|---|
| Dirt | Bare earth with pebbles; grass creeps in at the edge. |
| Meadow | Lighter grass with tiny cream flowers. |
| Stone | Stony ground with a few pebbles. |
| Stepping stones | Drag to lay flat, irregular stones along a path. |
| Erase | Back to grass; also lifts stepping stones. |

**Brush settings:**
- **size**, also used as the stone size for stepping stones;
- **softness:** soft edges fray into the grass;
- **strength:** low strength gives patchy, worn ground.

**Saving:** each stroke has undo and redo. **save ground** writes `src/data/ground.json`.

**Colours** are the Theme tab's "Ground paint" swatches.

**Wild plants** don't grow on dirt, stone ground or stepping stones.

**Code:**
- `src/ground.ts` holds the data and the brush.
- `src/terrain.ts` (`paintGround`) draws it.
- A stroke repaints only the cells under it.
