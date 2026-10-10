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

// The stills, morning to deep night: when each cuts in (it crossfades over
// FRAME_FADE), where the laptop's screen is in it (measured from its pixels;
// the bottom 10 % of the screen is the taskbar), the desktop clock, the mail
// app's place (% of the desktop above the taskbar) and the screen's glow in
// the room.
export interface Frame {
  src: string;
  at: number;
  screen: { x: number; y: number; w: number; h: number };
  time: string;
  date: string;
  app: { left: number; top: number; width: number; height: number };
  glow: number;
}
export const FRAME_FADE = 450;
export const TASKBAR = 0.1; // of the screen's height
export const FRAMES: Frame[] = [
  // Phase 1, optimism: bright morning, fresh coffee
  { src: '/intro/cinematic/01-morning.webp', at: 0, screen: { x: 468, y: 63, w: 736, h: 429 }, time: '08:12', date: 'Mon 3 Mar', app: { left: 2, top: 4, width: 95, height: 88 }, glow: 0 },
  // Phase 2, the drift: harsh afternoon light, long shadows
  { src: '/intro/cinematic/02-midday.webp', at: 3000, screen: { x: 468, y: 63, w: 736, h: 425 }, time: '13:46', date: 'Wed 5 Mar', app: { left: 3, top: 6, width: 94, height: 86 }, glow: 0.05 },
  { src: '/intro/cinematic/03-afternoon.webp', at: 5200, screen: { x: 468, y: 63, w: 736, h: 429 }, time: '17:38', date: 'Fri 14 Mar', app: { left: 1.5, top: 3, width: 96, height: 90 }, glow: 0.1 },
  // Phase 3, the routine: overcast, stagnant
  { src: '/intro/cinematic/04-overcast.webp', at: 7400, screen: { x: 461, y: 48, w: 739, h: 423 }, time: '11:07', date: 'Thu 3 Apr', app: { left: 2.5, top: 5, width: 95, height: 88 }, glow: 0.2 },
  // Phase 4, resignation: deep night, only the screen's cold light
  { src: '/intro/cinematic/05-night.webp', at: 10200, screen: { x: 462, y: 48, w: 738, h: 423 }, time: '23:51', date: 'Sun 27 Apr', app: { left: 2, top: 4, width: 95, height: 89 }, glow: 0.6 },
  { src: '/intro/cinematic/06-deep-night.webp', at: 11600, screen: { x: 468, y: 63, w: 733, h: 429 }, time: '02:47', date: 'Mon 28 Apr', app: { left: 3, top: 6, width: 94, height: 87 }, glow: 0.75 },
];

// ---- the timeline (ms) ---------------------------------------------------------
const FALL = 17800; // the keywords come loose; everything after is relative to it
export const T = {
  // the stills (FRAMES[].at); the opened mails' times are in emails.ts
  montageEnd: 13600,
  // the camera has stopped; everything but the three keywords fades, then they hold 3 s
  othersOut: [13600, 14200], // the mail app, the other text and the desktop fade
  frameOut: [13800, 14500], // the last mail's window and other words dissolve
  dotsIn: [14500, 15100], // "Unfortunately," -> "Unfortunately..."
  blackIn: [13600, 14800], // the room fades to black
  zoomIn: [0, 13600], // all the while before, the camera eases slowly in, from outside
  // falling letters -> the glyph door -> through it (scene.ts), then 3 s of black
  fall: FALL, // the letters fall into the door's foot (they land ~1.0-1.7 s later)
  build: [FALL + 1200, FALL + 4200], // the door builds itself bottom up, glyph by glyph
  open: [FALL + 4600, FALL + 7200], // it opens, slowly, onto the sea and the island
  beam: [FALL + 4900, FALL + 7200], // light comes out of the doorway
  walk: [FALL + 9200, FALL + 11600], // after a 2 s hold: the camera walks toward the doorway
  fadeOut: [FALL + 10400, FALL + 11600], // to black
  end: FALL + 14600, // 3 s of black, then the wake-up scene
} as const;

export const ENTER_MS = 160; // an email window's entrance
export const ZOOM_IN = 1.35; // how near the camera gets by the end of the stills (then it stays)

// ---- falling letters ---------------------------------------------------------------
export const LETTERS = {
  staggerMs: 700, // spread of the letters' start times
  gravity: 0.55, // in viewport heights / s²
  driftPx: 26, // sideways drift, px/s (either way)
  spinDeg: 70, // rotation while falling, deg/s (either way)
};

// ---- the water-and-door scene (scene.ts) -------------------------------------------------
export const SCENE = {
  bg: '#16100d', // the darkness (the door drawing's own background)
  door: { h: 0.56, cy: 0.47, open: 0.55 }, // height and centre of the viewport height; open = the leaf's width when open, of its closed width
  walk: { zoom: 1.45, bob: 0.004, steps: 1.8 }, // the walk toward the door: how near, the step bob (of the height), steps per second
};

// the game's own glyph ramp (src/craft/materials.ts RAMP_DEFAULT)
export const GLYPHS = '·:¬=+†‡*¤§%&¥Ø@';
export const GLYPH_FONT = "'Sarasa Mono', 'Cascadia Code', 'Courier New', ui-monospace, Menlo, Consolas, monospace";

// ---- the shots, as the dev timeline lists them ----------------------------------------
export const SHOT_LIST: { id: string; label: string; at: number; end: number }[] = [
  { id: 'optimism', label: '1 Optimism', at: FRAMES[0].at, end: FRAMES[1].at },
  { id: 'drift', label: '2 Drift', at: FRAMES[1].at, end: FRAMES[2].at },
  { id: 'drift2', label: '2b Drift', at: FRAMES[2].at, end: FRAMES[3].at },
  { id: 'routine', label: '3 Routine', at: FRAMES[3].at, end: FRAMES[4].at },
  { id: 'resignation', label: '4 Resignation', at: FRAMES[4].at, end: T.montageEnd },
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
