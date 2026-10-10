# Intro cinematic

A cinematic of about 46 seconds:
1. **Four phases at the laptop** (0–15.1 s), told in six stills of the same desk (`public/intro/cinematic/`), from bright morning sun to the cold blue light of the screen deep at night. The camera starts close on the laptop screen and holds while the first mail opens; after about 2.5 s it pulls back to the whole desk, slowly at first and faster and faster. Over each still a desktop runs on the laptop's screen: the **taskbar clock** (time and date jump with each still; in the tray icons' blue, on a layer of its own so it holds steady while the camera pulls back), a **mail app** that stays open over the desktop icons and sits a little differently each shot, and its **inbox history**, rejections among ordinary mail.
   - *Optimism* (morning, fresh coffee): a notification, "Thank you for your application to Northstar Games", and the mail opens.
   - *The drift* (afternoon, long shadows): two rejections opened over the inbox, "We regret to inform you…" and "Unfortunately…".
   - *The routine* (overcast): the inbox scrolls down past a sea of bold unread "Update on your status".
   - *Resignation* (night, then deep night): the final mail arrives unread at 23:51 and is opened at 02:47: "Unfortunately… not selected… While your background is impressive, we have decided to move forward with other candidates."
2. The camera stops. Slowly (about 6 s) everything but the three keywords, **Application Update · Unfortunately… · not selected**, fades to black; they **hold 3 s**, the camera still.
3. **The letters fall, the camera follows them, and they turn to water** (from 24.1 s): they let go in four slightly staggered waves (0.25 s apart, each letter in one at random, with a little jitter and a slightly different speed, `LETTERS.waves`/`speed`) and fall, slowly (about 5 s down); the camera follows them, bringing their middle to the centre of the frame as they let go and keeping it there all the way down, until it rests on the door's framing (`LETTERS.pan`). On the way each letter stretches into a streak and turns into a **string of water** (glyphs `o | ¦ : .` in water colours) that keeps falling straight down (`LETTERS.converge` is 0) and lands across the door's foot: the last mail is placed on the screen so its keywords sit right above the door's place. From there the **door emerges, slowly and organically** (about 7 s, `growFrom` in `scene.ts`): a flood through the door's own shape whose every step costs a little noise, so the wet front advances unevenly until the whole shape is filled; each glyph comes up as water (`~ ≈`), then sets into the drawing's glyph and colour. The numbers are `LETTERS` in `config.ts`. The door is `src/cinematic/door-glyphs.svg` (31 × 44 glyphs), centred, with space around it.
4. **The door opens, slowly** (about 2.6 s): the leaf swings on its left hinge to about half its width, its free edge coming toward you. Inside are a sky with clouds and birds, the sea and an island; **light pours out** onto sandy ground.
5. After a **2 s hold**, the camera **moves in toward the doorway** (a smooth, linear push in, no bob) and **fades to black**.
6. After **3 s of black**, the wake-up scene with Mitchy starts (from black).

For now it plays only on **`/cinematic`**. The usual intro (`/`, `/intro`, the laptop/MYLL prologue) is unchanged.

## Testing on localhost

`pnpm dev`, then open `http://localhost:5173/cinematic` and press Start.

- **Timeline bar** (dev only):
  - play / pause (Space), restart, the scrubber, and speed (0.25×–2×);
  - one button per shot (←/→ for the previous / next shot);
  - **shot only:** pause at the end of the shot you picked;
  - **hold at end:** stay on the black instead of handing over to the wake-up scene;
  - **skip → game:** end the cinematic now. T hides or shows the bar.
- **Start at a shot:** `/cinematic?shot=fall` (ids are in `SHOT_LIST`, `src/cinematic/config.ts`) or `/cinematic?t=12000`. The editor's Intro tab (E) has a button per shot that opens these.
- **Skip Intro** (bottom right) works as on the normal intro: the cinematic ends and the wake-up scene starts.

## How it is built (`src/cinematic/`)

| File | What |
|---|---|
| `config.ts` | All the numbers: the stills (`FRAMES`: when each cuts in, where the laptop's screen is in it, the desktop clock, the mail app's place, the screen's glow), the timeline per phase (`T`; the door sequence is relative to `fall`), the letter fall, the door scene (`SCENE`: the darkness, the door's size and place, how far it opens, the walk), and the shot list |
| `scene.ts` | The door scene, a pure function of t: the bottom-up build, the leaf's swing (re-sampled column by column, so glyphs are never squeezed), the doorway painting, and the beam |
| `door.ts` + `door-glyphs.svg` | The door: the SVG's glyph cells (glyph + colour), split into frame, leaf and ground. **Replace the SVG to change the door** |
| `glyphCanvas.ts` | The full-screen glyph canvas: a grid of square cells sized so the door's cells map one to one, drawn in three cheap passes (backings, white glyph stamps, a colour layer), with a camera transform for the walk |
| `emails.ts` | The mail: the opened mails (text, with `*emphasis*` and `[keywords]`) with their place and timing, Phase 1's notification, the inbox history (each mail's arrival, unread until read) and Phase 3's scroll |
| `IntroCinematic.tsx` | The scene and one clock: `apply(t)` places every layer for time t, so seeking, pausing and skipping are exact |
| `cinematic.css` | The look of the room light, the windows, the letters and the timeline bar |

- **Stills:** `public/intro/cinematic/*.webp` (1672 × 643), scaled to cover the screen and crossfading at each cut. The desktop is HTML laid over the laptop's screen; its place is measured per still and eases between stills during a crossfade, so it stays on the screen. Each still is fitted (`fitFrame` in `config.ts`) so its laptop screen lands exactly on the first still's, with one small zoom for all so no edge shows a gap, so cuts don't jump. To add a still, add its file and a `FRAMES` entry (its measured screen rectangle, clock, app place).
- **Keywords:** "Application Update", "Unfortunately" and "not selected" are real letters in the last mail. The camera has stopped by then; everything else fades around them. When they come loose, each letter is replaced by a copy at exactly its place and size in a full-screen layer, so it can fall past the laptop.
- **The camera pan and the water:** the scene's world is the final framing, with the falling letters' span centred over the door (the last mail is placed so this shift is about 0). The camera follows the letters' (and then the water's) mean height - a pure function of t, since every path is analytic - aiming it at a centre that eases in from where they hung (so it starts from the keyword shot without a jump), never above that and never past the door's framing, smoothed over 0.5 s; any remaining sideways offset eases out over 1.6 s. While the camera pans, the falling letters (DOM) and the glyph canvas are both drawn shifted by the pan (the canvas by whole cells in the scene plus the remainder in `GlyphCanvas.draw`). The water strings continue each letter's fall exactly (same speed and gravity).
- **The door's parts** (`door.ts`), read from the drawing: per row, the frame's band runs from the silhouette's edge to the first dark groove cell; the **leaf** is what lies between the grooves (or the silhouette inset by the band's usual width where a row has none), clamped to the leaf's usual edges; the rows at the bottom wider than the door's body, or sparse, are the **ground** (vines, flower); the rest is **frame**. The leaf starts below the crown's groove.
- **The door boils:** the door (frame, leaf, foot) is drawn on a door-sized canvas of its own (`.cin-door`, `DOOR_PAD` in `scene.ts` leaves room for the leaf's swing) with an SVG filter on it (`#cin-boil` in `IntroCinematic.tsx`): turbulence noise displaces it by a few px (the displacement scale follows the cell size) and the noise's grain jumps between four sizes every 0.225 s (stepped by the cinematic's clock, so it scrubs and records exactly), so its glyphs wobble like a hand-drawn line. The doorway, the beam and the water stay on the main canvas, undistorted; the layer moves with the same camera.
- **Walk:** a transform in `GlyphCanvas.draw` (a linear scale about the doorway), so the door stays exactly its glyphs, just nearer.
- **Handoff:** the walk ends in black, which holds 3 s; then the cinematic calls `onComplete` and the wake-up scene starts from its own black screen.
- **Reduced motion:** with `prefers-reduced-motion`:
  - no camera zoom, falling, pan, water strings, boil or walk; the door emerges by fading; the inbox jumps instead of scrolling;
  - the door fades in row by row from the bottom, opens, then fades to black.
- **Audio:** none. The game has no audio system yet.
