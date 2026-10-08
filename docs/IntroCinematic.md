# Intro cinematic

A cinematic of about 26 seconds:
1. Six rejection emails pile up on the laptop.
2. Three phrases are left in the dark.
3. Their letters fall apart and gather into a glyph portal.
4. The portal opens onto the island.
5. The existing wake-up scene with Mitchy takes over.

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
| `config.ts` | All the numbers: the timeline per phase, the laptop screen's place in the reference picture, letter fall, portal size, the shot list |
| `emails.ts` | The six emails (text, with `*emphasis*` and `[surviving phrases]`) and every window's style, place and timing (styles: standard, portal, stacked) |
| `IntroCinematic.tsx` | The scene and one clock: `apply(t)` places every layer for time t, so seeking, pausing and skipping are exact |
| `cinematic.css` | The look of the room light, the windows, the letters and the timeline bar |

- **Background:** `public/intro/state2-laptop-scene.png`, scaled to cover the screen; the email windows are HTML clipped to the laptop's screen.
- **Phrases:** "Application Update", "Unfortunately" and "not selected" are real letters in the last email. The camera pushes in on them while everything else fades. When they come loose, each letter is replaced by a copy at exactly its place and size in a full-screen layer, so it can fall past the laptop.
- **Ring:** the letters bend from falling into a ring (the radius and the angle around the centre ease separately, so the paths curve). Some turn into the island's glyphs, and extra glyph marks fill the ring.
- **Opening:** the island behind the portal is the real game. It already runs underneath with the player at PLAYER START, so when the opening has grown over the whole screen there is nothing to swap.
- **Reduced motion:** with `prefers-reduced-motion`, there is no camera push or falling. The letters fade out and fade in on the ring, and the dark lifts instead of opening.
- **Audio:** none. The game has no audio system yet.
