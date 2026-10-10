# Intro cinematic

A cinematic of about 32 seconds:
1. **Four phases at the laptop** (0–13.6 s), told in six stills of the same desk (`public/intro/cinematic/`), from bright morning sun to the cold blue light of the screen deep at night. The camera starts close on the laptop screen and slowly pulls back to the whole desk. Over each still a desktop runs on the laptop's screen: the **taskbar clock** (time and date jump with each still), a **mail app** that stays open over the desktop icons and sits a little differently each shot, and its **inbox history**, rejections among ordinary mail.
   - *Optimism* (morning, fresh coffee): a notification, "Thank you for your application to Northstar Games".
   - *The drift* (afternoon, long shadows): two rejections opened over the inbox, "We regret to inform you…" and "Unfortunately…".
   - *The routine* (overcast): the inbox scrolls down past a sea of bold unread "Update on your status".
   - *Resignation* (night, then deep night): the final mail arrives unread at 23:51 and is opened at 02:47: "Unfortunately… not selected… While your background is impressive, we have decided to move forward with other candidates."
2. The camera stops. Everything but the three keywords, **Application Update · Unfortunately… · not selected**, fades to black; they **hold 3 s**, the camera still.
3. **The letters drop, and the door grows out of them** (from 17.8 s): one after another, left to right, each falls straight down under gravity (stretched). The ones too far to either side to become the door **fade away as they fall**. The ones above the **door's foot** land on it with a short squash, take on the colour of the glyph under them and fade into it, and the **door grows out of those spots**, up and out (`growFrom` in `scene.ts`): each glyph emerges in its cell as a speck, a mark, then its glyph, brightening, and settles into the drawing's own colour. The numbers are `LETTERS` in `config.ts`. The door is `src/cinematic/door-glyphs.svg` (31 × 44 glyphs), centred, with space around it.
4. **The door opens, slowly** (about 2.6 s): the leaf swings on its left hinge to about half its width, its free edge coming toward you. Inside are a sky with clouds and birds, the sea and an island; **light pours out** onto sandy ground.
5. After a **2 s hold**, the camera **walks slowly toward the doorway** (a gentle push in with a step's bob) and **fades to black**.
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

- **Stills:** `public/intro/cinematic/*.webp` (1672 × 643), scaled to cover the screen and crossfading at each cut. The desktop is HTML laid over the laptop's screen; its place is measured per still and eases between stills during a crossfade, so it stays on the screen. To add a still, add its file and a `FRAMES` entry (screen rectangle, clock, app place).
- **Keywords:** "Application Update", "Unfortunately" and "not selected" are real letters in the last mail. The camera has stopped by then; everything else fades around them. When they come loose, each letter is replaced by a copy at exactly its place and size in a full-screen layer, so it can fall past the laptop.
- **Letters and the door's foot:** each letter falls straight down from where it hangs. Those above the door's foot (within `LETTERS.margin` cells of it) land there with a squash pivoting on the foot; the others fade out over part of their fall (`LETTERS.vanish`).
- **The door's parts** (`door.ts`), read from the drawing: per row, the frame's band runs from the silhouette's edge to the first dark groove cell; the **leaf** is what lies between the grooves (or the silhouette inset by the band's usual width where a row has none), clamped to the leaf's usual edges; the rows at the bottom wider than the door's body, or sparse, are the **ground** (vines, flower); the rest is **frame**. The leaf starts below the crown's groove.
- **Walk:** a transform in `GlyphCanvas.draw` (scale about the doorway plus a bob), so the door stays exactly its glyphs, just nearer.
- **Handoff:** the walk ends in black, which holds 3 s; then the cinematic calls `onComplete` and the wake-up scene starts from its own black screen.
- **Reduced motion:** with `prefers-reduced-motion`:
  - no camera zoom, falling or walk; the inbox jumps instead of scrolling;
  - the door fades in row by row from the bottom, opens, then fades to black.
- **Audio:** none. The game has no audio system yet.
