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
- **Colliders** — every collider is shown in red. Click a tile to flip it:
  a blocking tile stops blocking, an empty one starts. Drag to flip many (a
  drag keeps doing what its first tile did). A new blocking tile inside the
  *selected* object becomes part of that object's collider (it moves with it;
  stored per asset, so every copy gets it). Anywhere else it's a map tile of
  its own (orange), saved in `world.json` as `blockedTiles`. Blocking tiles
  stop the player's feet, like the buildings do.
- **Intro** — the intro narration editor (it has its own save button).

The inspector (shown when something is selected) edits x, y, scale and
rotation; for placed objects also their kind, and for new assets the
settings every copy shares.

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

Kinds a placed asset can have: decor (just drawn), ground (drawn under
everything, like grass), landscape (like the cliff), bridge (drawn over
water), or one of the collectables. Anything with new behaviour needs code.

## Where it lives

- `src/editor/useWorldEditor.ts` — editor state, input, save
- `src/editor/EditorPanel.tsx`, `src/editor/EditorLayers.tsx` — panel and on-map overlays
- `src/assets.ts` — the asset registry
- `src/world.ts` (`buildStructEnts`) — applies `world.json` when the game loads
- `vite.config.ts` (`worldEditorSavePlugin`) — the dev-only save endpoint
