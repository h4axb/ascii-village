// ---------------------------------------------------------------------------
// The intro cinematic's numbers, all in one place (src/cinematic/).
//
// Everything the cinematic shows is a pure function of ONE clock, `t` (ms
// since the start): IntroCinematic.tsx reads these phases and positions on
// every frame. That is what makes the dev timeline able to jump to any shot,
// scrub, pause or replay a single shot without timers getting out of step.
//
// Coordinates inside the laptop scene are in the stills' own 1672 x 643
// pixels (public/intro/cinematic/); the scene is scaled to cover the viewport.
// ---------------------------------------------------------------------------

export const STAGE_W = 1672;
export const STAGE_H = 643;

// The shots, one still each (morning to deep night; a still can serve more
// than one day): when each cuts in (it crossfades over FRAME_FADE), where
// the laptop's screen is in it (measured from its pixels; the bottom 10 % of
// the screen is the taskbar), where its taskbar's battery icon is (its right
// edge and middle, measured: the clock sits beside it, so it is on the same
// spot of the laptop in every still), the desktop clock, the mail app's place
// (% of the desktop above the taskbar) and the screen's glow in the room.
export interface Frame {
  src: string;
  at: number;
  screen: { x: number; y: number; w: number; h: number };
  tray: { x: number; y: number };
  time: string;
  date: string;
  app: { left: number; top: number; width: number; height: number };
  glow: number;
}
export const FRAME_FADE = 450;

// The stills were shot a little apart (the laptop sits higher and smaller in
// some), so each is placed on the stage to put its screen exactly on the
// first still's - plus one small zoom for all, so none leaves a gap at an
// edge. fitFrame(i): where still i goes (stage px, scale about its top
// left); SCREEN_FIT: the laptop screen's place, the same in every still.
const fits = () => {
  const ref = FRAMES[0].screen;
  const base = FRAMES.map((f) => {
    const a = (ref.w / f.screen.w + ref.h / f.screen.h) / 2;
    return { a, bx: ref.x - a * f.screen.x, by: ref.y - a * f.screen.y };
  });
  const cx = ref.x + ref.w / 2, cy = ref.y + ref.h / 2;
  let k = 1;
  for (const { a, bx, by } of base) {
    if (bx > 0) k = Math.max(k, cx / (cx - bx));
    if (by > 0) k = Math.max(k, cy / (cy - by));
    if (a * STAGE_W + bx < STAGE_W) k = Math.max(k, (STAGE_W - cx) / (a * STAGE_W + bx - cx));
    if (a * STAGE_H + by < STAGE_H) k = Math.max(k, (STAGE_H - cy) / (a * STAGE_H + by - cy));
  }
  k *= 1.002; // a hair more, against rounding
  return {
    frames: base.map(({ a, bx, by }) => ({ s: k * a, x: cx + k * (bx - cx), y: cy + k * (by - cy) })),
    screen: { x: cx + k * (ref.x - cx), y: cy + k * (ref.y - cy), w: k * ref.w, h: k * ref.h },
  };
};
let fitCache: ReturnType<typeof fits> | null = null;
export const fitFrame = (i: number) => (fitCache ??= fits()).frames[i];
export const screenFit = () => (fitCache ??= fits()).screen;
export const TASKBAR = 0.1; // of the screen's height
// the cinematic opens on black this long, then fades in on the first shot
export const LEAD = 2500;
export const FRAMES: Frame[] = [
  // the thank-you: bright morning, fresh coffee (a notification, then it opens)
  { src: '/intro/cinematic/01-morning.webp', at: LEAD, screen: { x: 468, y: 63, w: 736, h: 429 }, tray: { x: 1120, y: 468.5 }, time: '08:12', date: 'Mon 3 Mar', app: { left: 2, top: 4, width: 95, height: 88 }, glow: 0 },
  // then a rejection a shot, each already open when the shot cuts in: the
  // days go by, the light goes from harsh afternoon to overcast to night
  { src: '/intro/cinematic/02-midday.webp', at: LEAD + 4500, screen: { x: 468, y: 63, w: 736, h: 425 }, tray: { x: 1121, y: 465 }, time: '13:46', date: 'Wed 5 Mar', app: { left: 3, top: 6, width: 94, height: 86 }, glow: 0.05 },
  { src: '/intro/cinematic/03-afternoon.webp', at: LEAD + 6500, screen: { x: 468, y: 63, w: 736, h: 429 }, tray: { x: 1121, y: 468.5 }, time: '17:38', date: 'Fri 14 Mar', app: { left: 1.5, top: 3, width: 96, height: 90 }, glow: 0.1 },
  { src: '/intro/cinematic/04-overcast.webp', at: LEAD + 8500, screen: { x: 461, y: 48, w: 739, h: 423 }, tray: { x: 1119, y: 448.5 }, time: '11:07', date: 'Thu 3 Apr', app: { left: 2.5, top: 5, width: 95, height: 88 }, glow: 0.2 },
  { src: '/intro/cinematic/02-midday.webp', at: LEAD + 10500, screen: { x: 468, y: 63, w: 736, h: 425 }, tray: { x: 1121, y: 465 }, time: '14:22', date: 'Tue 15 Apr', app: { left: 2, top: 5, width: 95, height: 88 }, glow: 0.3 },
  { src: '/intro/cinematic/05-night.webp', at: LEAD + 12500, screen: { x: 462, y: 48, w: 738, h: 423 }, tray: { x: 1120, y: 448.5 }, time: '23:51', date: 'Sun 27 Apr', app: { left: 2, top: 4, width: 95, height: 89 }, glow: 0.6 },
  // the last one, deep night, only the screen's cold light
  { src: '/intro/cinematic/06-deep-night.webp', at: LEAD + 14500, screen: { x: 468, y: 63, w: 733, h: 429 }, tray: { x: 1120, y: 468.5 }, time: '02:47', date: 'Mon 28 Apr', app: { left: 3, top: 6, width: 94, height: 87 }, glow: 0.75 },
];
// the clock's right edge, this far right of the battery icon's (px of the stills)
export const CLOCK_GAP = 62;

// ---- the timeline (ms) ---------------------------------------------------------
const FALL = LEAD + 25900; // the keywords come loose; everything after is relative to it
export const T = {
  // the stills (FRAMES[].at); the opened mails' times are in emails.ts
  fadeIn: [LEAD, LEAD + 900], // out of the opening black
  montageEnd: LEAD + 16900,
  // the camera has stopped; slowly (about 6 s) everything but the three
  // keywords fades away, then they hold alone 3 s
  othersOut: [LEAD + 16900, LEAD + 21900], // the mail app, the other text and the desktop fade
  frameOut: [LEAD + 17900, LEAD + 22900], // the last mail's window and other words dissolve
  dotsIn: [LEAD + 22300, LEAD + 22900], // "Unfortunately," -> "Unfortunately..."
  blackIn: [LEAD + 16900, LEAD + 22900], // the room fades to black
  pullBack: [LEAD + 4100, LEAD + 16900], // the camera holds on the first mail, then pulls back from the screen to the whole desk, slowly at first, faster and faster
  // falling letters -> the glyph door -> through it (scene.ts), then 3 s of black
  fall: FALL, // the letters fall, the camera following them down; they turn to water (LETTERS)
  build: [FALL + 4800, FALL + 11800], // the door emerges from the water, slowly, filling its shape
  open: [FALL + 12300, FALL + 14900], // it opens, slowly, onto the sea and the island
  beam: [FALL + 12600, FALL + 14900], // light comes out of the doorway
  walk: [FALL + 16900, FALL + 19300], // after a 2 s hold: the camera moves in toward the doorway, steadily
  fadeOut: [FALL + 18100, FALL + 19300], // to black
  end: FALL + 22300, // 3 s of black, then the wake-up scene
} as const;

export const ENTER_MS = 160; // an email window's entrance
export const ZOOM_START = 1.35; // how near the camera starts, on the laptop's screen (it pulls back to the full desk, then stays)

// ---- falling letters ---------------------------------------------------------------
// The letters let go (in a few waves) and fall; the camera follows them, keeping them at the centre of the frame, from the
// keywords to the door's place below. On the way each letter stretches into
// a streak and turns to water - a string of glyphs (scene.ts) that keeps
// falling, drifting only a little toward the door, and lands on its foot,
// where the door starts to emerge (growFrom).
export const LETTERS = {
  waves: { n: 4, gap: 250, jitter: 70 }, // the letters let go in a few waves (each letter one at random), gap ms apart, with a little jitter each
  speed: 0.08, // each letter falls up to this much faster or slower (of gravity)
  gravity: 0.11, // the fall, letters and water alike, in viewport heights / s² (about 5 s down: slow, weightless)
  fallScale: [0.9, 1.15] as const, // stretched while it falls
  morphAt: [1.0, 1.6] as const, // s into its fall when it turns to water (spread per letter)
  morphMs: 220, // the turn: it stretches into a streak and fades into the string
  streak: [0.45, 3] as const, // the streak's scale (x, y)
  tail: [5, 9] as const, // a water string's tail, cells
  converge: 0, // how far a water string drifts toward the door's middle as it falls (0: straight down, 1: all to the middle)
  pan: { dist: 0.95, smooth: 380 }, // the camera follows the falling letters down to the door: how far (of the height); how softly it starts and stops (ms, the spread of its smoothing)
};

// ---- the water-and-door scene (scene.ts) -------------------------------------------------
export const SCENE = {
  bg: '#16100d', // the darkness (the door drawing's own background)
  door: { h: 0.56, cy: 0.47, open: 0.55 }, // height and centre of the viewport height; open = the leaf's width when open, of its closed width
  walk: { zoom: 1.45 }, // the push in toward the door (linear): how near
};

// the game's own glyph ramp (src/craft/materials.ts RAMP_DEFAULT)
export const GLYPHS = '·:¬=+†‡*¤§%&¥Ø@';
export const GLYPH_FONT = "'Sarasa Mono', 'Cascadia Code', 'Courier New', ui-monospace, Menlo, Consolas, monospace";

// ---- the shots, as the dev timeline lists them ----------------------------------------
export const SHOT_LIST: { id: string; label: string; at: number; end: number }[] = [
  { id: 'start', label: 'Opening black', at: 0, end: FRAMES[0].at },
  { id: 'optimism', label: '1 Thank-you', at: FRAMES[0].at, end: FRAMES[1].at },
  ...FRAMES.slice(1).map((f, i) => ({ id: `reject${i + 1}`, label: `${i + 2} Rejection ${i + 1}`, at: f.at, end: FRAMES[i + 2]?.at ?? T.montageEnd })),
  { id: 'keywords', label: 'Keywords', at: T.montageEnd, end: T.fall },
  { id: 'fall', label: 'Letters fall', at: T.fall, end: T.build[0] },
  { id: 'build', label: 'Door builds', at: T.build[0], end: T.open[0] },
  { id: 'open', label: 'Opening', at: T.open[0], end: T.open[1] },
  { id: 'hold', label: 'Hold', at: T.open[1], end: T.walk[0] },
  { id: 'walk', label: 'Walk in', at: T.walk[0], end: T.walk[1] },
  { id: 'black', label: 'Black', at: T.walk[1], end: T.end },
];

// ---- small maths --------------------------------------------------------------------------
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (k: number) => k * k * (3 - 2 * k);
// 0 before a, 1 after b, eased in between
export const span = (t: number, [a, b]: readonly [number, number] | readonly number[]) => smooth(clamp01((t - a) / (b - a)));
export const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
export const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
// a stable pseudo-random number in 0..1 for (seed, n)
export function rand(seed: number, n = 0): number {
  const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
