# Intro cinematic

A cinematic of about 23 seconds:
1. Six rejection emails pile up on the laptop.
2. Three phrases are left in the dark.
3. **Letters to drops** (about 14 s in all, drawn in glyphs):
   - their letters fall apart and gather into **4 water drops**;
   - the drops land and their **ripples recede into depth**;
   - the water rises into a block on the right, and travels **right → left on an arc** (starting and landing at the same height), sloshing;
   - its **drips pour a front-facing door**, strip by strip, bottom up;
   - it lands on the left and splashes into seed drops.
4. **The door opens.** Inside are a sky with clouds and birds, the sea and an island. A **light beam reveals sandy ground**, **puddles** spread, and **plants grow** from the seed drops (stems, leaves, a few flowers).
5. After a **2 s hold**, the camera **zooms into the doorway**, and the glyph island fades into the real game.
6. The existing wake-up scene with Mitchy takes over.

For now it plays only on **`/cinematic`**. The usual intro (`/`, `/intro`, the laptop/MYLL prologue) is unchanged.

## Testing on localhost

`pnpm dev`, then open `http://localhost:5173/cinematic` and press Start.

- **Timeline bar** (dev only):
  - play / pause (Space), restart, the scrubber, and speed (0.25×–2×);
  - one button per shot (←/→ for the previous / next shot);
  - **shot only:** pause at the end of the shot you picked;
  - **hold at end:** stay on the island instead of handing over to the wake-up scene;
  - **skip → game:** end the cinematic now. T hides or shows the bar.
- **Start at a shot:** `/cinematic?shot=fall` (ids are in `SHOT_LIST`, `src/cinematic/config.ts`) or `/cinematic?t=12000`. The editor's Intro tab (E) has a button per shot that opens these.
- **Skip Intro** (bottom right) works as on the normal intro: the cinematic ends and the wake-up scene starts.

## How it is built (`src/cinematic/`)

| File | What |
|---|---|
| `config.ts` | All the numbers: the timeline per phase (`T`), the laptop screen's place in the reference picture, the letter fall, the water-and-door scene (`SCENE`: drop size, door size and place, the arc, strips, zoom), and the shot list |
| `scene.ts` | The water-and-door scene, a pure function of t, sampled per glyph cell: drops, ripples, the liquid's arc and drips, the door and its opening, the interior painting, the beam on the sand, puddles, plants, and the camera |
| `glyphCanvas.ts` | The full-screen glyph canvas: a cell grid (about 150 columns) drawn in three cheap passes (backings, white glyph stamps, a colour layer) |
| `emails.ts` | The six emails (text, with `*emphasis*` and `[surviving phrases]`) and every window's style, place and timing (styles: standard, portal, stacked) |
| `IntroCinematic.tsx` | The scene and one clock: `apply(t)` places every layer for time t, so seeking, pausing and skipping are exact |
| `cinematic.css` | The look of the room light, the windows, the letters and the timeline bar |

- **Background:** `public/intro/state2-laptop-scene.png`, scaled to cover the screen; the email windows are HTML clipped to the laptop's screen.
- **Phrases:** "Application Update", "Unfortunately" and "not selected" are real letters in the last email. The camera pushes in on them while everything else fades. When they come loose, each letter is replaced by a copy at exactly its place and size in a full-screen layer, so it can fall past the laptop.
- **Drops:** the letters are grouped left to right into 4. Each group drifts together, shrinks, and becomes a water drop on the glyph canvas.
- **Glyph scene:**
  - one canvas (`scene.ts` and `glyphCanvas.ts`) draws everything after the fall in the game's glyph style, with the theme's water, sand, grass and flower colours;
  - the zoom keeps the cell size and re-samples the doorway finer, so it stays glyph art.
- **Handoff:** the real game already runs underneath with the player at PLAYER START. The canvas fades out at the end of the zoom, so there is nothing to swap.
- **Reduced motion:** with `prefers-reduced-motion`:
  - no camera push, falling, liquid or zoom;
  - the letters fade, the door appears strip by strip and opens, then the scene fades into the game.
- **Audio:** none. The game has no audio system yet.
