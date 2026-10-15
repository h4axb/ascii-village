# World editor

An in-game editor for the world's layout: where every building, plant and
prop stands, new objects from the asset list, scene markers, and colliders.
It runs only under `pnpm dev` and never ships in the build.

## Workflow

1. `pnpm dev`, open the game, press **E**. The game freezes: clicks go to the
   editor, WASD pans the camera, nothing in the game reacts.
2. Edit (see below).
3. **Ctrl+S** (or **save**). This writes:
   - `src/data/world.json` — moved / removed / placed objects and colliders
   - `src/data/sceneMarkers.json` — scene marker positions
   - `src/data/assets.meta.json` — per-asset settings (label, kind, default scale)
4. Commit and push those files. Cloudflare rebuilds and the live game shows
   the same world.

Nothing is written until you save. A yellow dot means unsaved changes, and
closing the tab with unsaved changes asks first. If one of the files changed on
disk since the page loaded (another tab, a `git pull`), the save is refused with
a message instead of overwriting it: reload to get the new version.

## On the map

| Action | How |
|---|---|
| Select | click an object (or a marker) |
| Move | drag it (whole tiles; hold Shift for ¼ tiles), or arrow keys (Shift: 5 tiles) |
| Pan the camera | drag empty ground, or WASD; the mouse wheel zooms |
| Scale | Alt+wheel, `+` / `-`, or the inspector |
| Rotate | R (Shift+R the other way) |
| Delete / duplicate | Del / Ctrl+D |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Deselect / cancel placing / close | Esc |

## Tabs

- **Objects** — every object on the map; click one to select it and jump to
  it. Removed built-in objects are listed at the bottom; click to bring one back.
- **Assets** — everything placeable. Click an asset, then click the map
  (Shift+click keeps placing). Each new object gets its own id (`grasshalm-3`).
- **Markers** — named positions cutscenes read by id. *place*/*move*, then
  click the map; drag them afterwards.
- **Colliders** — two modes, switched at the top of the tab:
  - **boxes** (default): drag on the map to draw a collider box (¼-tile steps,
    Shift: whole tiles). Click a box to select it: drag it to move, drag a
    corner to resize, click the red **×** at its top-right (or Del) to delete.
    Drawn on an object (the house), a box belongs to it and moves with it;
    anywhere else it's on the map. A box stops the player's feet on every tile
    it touches (the player still walks whole tiles). Saved as `colliderBoxes`
    in `world.json`; shown in cyan.
  - **tiles**: every collider is shown in red. Click a tile to flip it:
  a blocking tile stops blocking, an empty one starts. Drag to flip many (a
  drag keeps doing what its first tile did). A new blocking tile inside the
  *selected* object becomes part of that object's collider (it moves with it;
  stored per asset, so every copy gets it). Anywhere else it's a map tile of
  its own (orange), saved in `world.json` as `blockedTiles`. Blocking tiles
  stop the player's feet, like the buildings do.
- **Intro** — the intro narration editor (it has its own save button).
- **Ground** — paint dirt, meadow, stone ground, beach sand and stepping stones onto the land (its own save button). See docs/Theme.md.
- **Theme** — the environment colours (grass, sand, water, palms, flowers) and a colour grade, live, with presets; its own save button. See docs/Theme.md.
- **Start screen** — lays out the start screen, a live view of the island.
  The yellow frame on the map is what it shows in this browser window (its
  size is on the frame's label; the layout scales with the window): drag its
  label to move it, its corner to zoom (or use the zoom slider). Inside it,
  drag the title picture, the subtitle, the buttons box and the player where
  they should stand. The title has sliders for size, rotation and place, and
  *upload PNG…* replaces the picture: it's written to
  `public/start-title.png` at once (any size; a transparent background looks
  best), and its shape and a new version go into the layout. The subtitle is its own piece too: drag it, change its words
  and size in the tab. The buttons box has a size slider. Assets placed from this tab are **start screen
  only** (`startOnly` in `world.json`): they're drawn on the start screen,
  never in the game, and only show on the map while this tab is open. Move,
  scale (+/−, Alt+wheel) and rotate them like any object; the inspector's
  *start screen only* box moves an object between the start screen and the
  game. Saved with the world (`startScreen` in `world.json`); *open start
  screen* shows the saved result. Phones keep their own layout (the title on
  top, the player below the buttons).

The inspector (shown when something is selected) edits x, y, scale and
rotation; for placed objects also their kind, and for new assets the
settings every copy shares.

Its **Colour** group recolours just that object: saturation and brightness
(100% = as drawn) and tint (turns the hue, −180°…180°); *reset colours*
puts it back. Saved per object (`look` in `world.json`), for placed and
built-in objects alike.

The wayfinder sign, the Wayfinder (v4) and the Glyph Generator's wooden directional sign are made
of parts (`src/wayfinder.ts`, `layers` in their asset files): the inspector has a
**Sign** group to flip the whole sign and, per board (top / middle / bottom),
point it the other way or tilt it (−30°…+30°). The pictures on the boards
(house, shop, pond) never mirror. Saved per placement (`sign` in `world.json`).

Mitchy and the garden can be moved but not removed (the game needs them);
moving the house brings its door, chair and clothesline hotspots along.

## Adding a new asset

Put a sprite file into `src/data/assets/<slug>.json`:

```json
{ "sprite": ["..."], "colors": ["..."], "palette": { "a": "#rrggbb" },
  "solid": ["..."], "scale": 0.4, "label": "Oak", "kind": "decor" }
```

Only `sprite` is required (`colors`/`palette` colour it, `solid` is its
collider; the rest are defaults you can also change in the editor). Reload and
it's in the **Assets** tab under **New**. `scripts/svg-glyph-to-asset.mjs` and
the "make an asset from an image" section of the Assets tab both produce these
files. See `docs/AssetTranscriptionWorkflow.md`.

Kinds a placed asset can have:
- **decor:** just drawn;
- **boulder:** drawn solid, with an opaque backing per cell, on one canvas; the player's feet stop at its drawn cells. Used for the stones, bushes and glyph ponds.
- **grasshalm** (the grass tuft): drawn filled the same way, but never blocks: you walk through it.
- **ground:** drawn under everything, like grass;
- **landscape:** like the cliff;
- **bridge:** drawn over water;
- one of the collectables.

Anything with new behaviour needs code.

## Mitchy's look

There is only one Mitchy, but his art can be swapped:

1. Give an asset file `"kind": "cat"` (and `"headRows"`: how many rows from the top make his portrait).
2. In the **Assets** tab, under **Mitchy's look**, click a look (**Original** is his first art).

The look changes at once everywhere he is drawn:
- in the world;
- the chat and menu portraits;
- the rating screens;
- the map.

He keeps his height: the scale follows the art's row count. A look is never placed on its own. The choice is saved with the world (`mitchyLook` in `world.json`). An asset of kind `cat` gets its own painted collider, like any other.

## Where it lives

- `src/editor/useWorldEditor.ts` — editor state, input, save
- `src/editor/EditorPanel.tsx`, `src/editor/EditorLayers.tsx` — panel and on-map overlays
- `src/assets.ts` — the asset registry
- `src/world.ts` (`buildStructEnts`) — applies `world.json` when the game loads
- `vite.config.ts` (`worldEditorSavePlugin`) — the dev-only save endpoint

## The main island's shape

The main island and the shop island are baked from a picture: `assets/refs/island-map-ref.webp` →
`python3 scripts/bake-island.py [main|shop]` (numpy, scipy, Pillow) → `src/data/mainIsland.json` /
`src/data/shopIsland.json` (the picture's left and right island).
Every ground cell gets one class: water, grass, sand, cliff face (blocks walking) or
a stone in the water. Trees, ponds, paths and buildings in the picture all count as
grass. `world.ts` turns the land into the coast field that walking, boats and sea
routes use. `terrain.ts` draws each cell by its class. To change an island, edit
the picture (or the script's per-island crop / origin / ignore boxes) and re-run the script. The boat trips go
ashore at the `quest.shopLanding` scene marker (the shop island's south beach).
The painted ground from before the new island is kept in
`assets/refs/ground-before-island-v2.json`.

## Islands tab

Drag an island on the map to move it, in whole tiles. Grab its land or the water right round it. A dashed outline
shows each island's bounds and follows the drag. The ground is redrawn when you let go.

- **take everything on it along** (on by default): objects on the island (or just off its shore), the scene markers
  there and its free collider boxes move with it. Off: they stay put and only the island moves.
- **reset** puts an island back where it was made. What stands on it stays where it is.
- Painted ground never moves.

Moves are saved with the world (`world.json` → `islands`, whole-tile offsets by island index) and undo like any
other edit.

## Fences

Assets → **Fences** has a modular glyph fence (`src/fence.ts`) in two woods (red-brown and light):

- **rail**: the fence seen from the front, one tile; rails join up end to end.
- **upright**: the fence running down the screen, one tile.
- **post**: a lone post for row ends and corners.
- **gate**: 4 tiles, a post at each end. In the game, walking up to it shows **[F] open the gate**. Opening it swaps in
  the open drawing (leaves swung in), and only its posts block, so the player walks through. F again closes it.
  Open gates are kept in the save.
- **sign board**: the wooden sign, plain or with a notice pinned on.

Click places one piece. **Shift + drag** with a fence piece armed lays a row of it as long as the drag, across or down,
whichever way you drag furthest. The row is one undo step. Fence pieces are drawn solid and block where they're drawn.
