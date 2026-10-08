// ---------------------------------------------------------------------------
// The intro cinematic's numbers, all in one place (src/cinematic/).
//
// Everything the cinematic shows is a pure function of ONE clock, `t` (ms
// since the start): IntroCinematic.tsx reads these phases and positions on
// every frame. That is what makes the dev timeline able to jump to any shot,
// scrub, pause or replay a single shot without timers getting out of step.
//
// Coordinates inside the laptop scene are in the reference image's own
// 1920 x 1080 pixels (public/intro/state2-laptop-scene.png); the whole scene
// is scaled to cover the viewport. Portal sizes are fractions of the
// viewport's smaller side.
// ---------------------------------------------------------------------------

export const CINEMATIC_BG = '/intro/state2-laptop-scene.png';
export const STAGE_W = 1920;
export const STAGE_H = 1080;

// The laptop's screen inside the reference image (measured from its pixels:
// bezel edges at x 536 / 1385, y 243 / 736, taskbar included). The email
// windows are clipped to it.
export const SCREEN = { x: 536, y: 243, w: 849, h: 493 };

// ---- the timeline (ms) ---------------------------------------------------------
export const T = {
  // the six rejection emails (shot n starts at SHOTS[n-1])
  shots: [0, 1200, 2200, 3200, 4200, 5200],
  montageEnd: 6800,
  // only the three phrases remain
  othersOut: [6800, 7300], // the other windows fade
  frameOut: [7000, 7700], // the last window's frame and other text dissolve
  dotsIn: [7900, 8500], // "Unfortunately," -> "Unfortunately..."
  blackIn: [7300, 8600], // the room fades to black
  zoom: [7200, 8900], // the camera pushes in on the phrases
  // falling letters
  fall: 9000,
  pull: [10800, 14800], // a second force takes over from gravity
  // portal
  portal: 13000,
  spin: 13000, // the ring starts its slow turn
  morph: [14500, 16800], // some letters turn into glyphs
  fillersIn: [14000, 17000], // extra glyph marks complete the ring
  glowIn: [15500, 17500], // turquoise light inside the ring
  // island reveal
  reveal: 17500,
  holeSmall: 19500, // a small window onto the island
  holeFull: 23000, // the portal has opened over the whole screen
  ringOut: [20500, 22500],
  glowOut: [19500, 21500],
  // the island alone, then the wake-up scene takes over
  end: 26000,
} as const;

export const ENTER_MS = 160; // an email window's entrance
export const ZOOM = 2.3; // how far the camera pushes in on the last email

// ---- falling letters ---------------------------------------------------------------
export const LETTERS = {
  staggerMs: 1400, // spread of the letters' start times
  gravity: 0.13, // in viewport heights / s²
  driftPx: 26, // sideways drift, px/s (either way)
  spinDeg: 70, // rotation while falling, deg/s (either way)
  glyphShare: 0.45, // share of letters that turn into glyphs in the ring
};

// ---- the portal ----------------------------------------------------------------------
export const PORTAL = {
  radius: 0.3, // of the viewport's smaller side
  ellipse: 0.9, // vertical radius / horizontal radius
  jitter: 0.06, // per-slot radius irregularity
  spinRadPerS: 0.07,
  pulse: 0.015,
  fillers: 30, // extra glyph marks around the ring
  holeSmall: 0.72, // the first opening, of the ring radius
  feather: 0.18, // soft edge of the opening, of the ring radius
};

// the game's own glyph ramp (src/craft/materials.ts RAMP_DEFAULT)
export const GLYPHS = '·:¬=+†‡*¤§%&¥Ø@';
export const GLYPH_FONT = "'Sarasa Mono', 'Cascadia Code', 'Courier New', ui-monospace, Menlo, Consolas, monospace";

// ---- the shots, as the dev timeline lists them ----------------------------------------
export const SHOT_LIST: { id: string; label: string; at: number; end: number }[] = [
  { id: 'shot1', label: '1 Pixelvale', at: T.shots[0], end: T.shots[1] },
  { id: 'shot2', label: '2 Paper Lantern', at: T.shots[1], end: T.shots[2] },
  { id: 'shot3', label: '3 Moss & Moon', at: T.shots[2], end: T.shots[3] },
  { id: 'shot4', label: '4 Cloverbyte', at: T.shots[3], end: T.shots[4] },
  { id: 'shot5', label: '5 Driftwood', at: T.shots[4], end: T.shots[5] },
  { id: 'shot6', label: '6 Northstar', at: T.shots[5], end: T.montageEnd },
  { id: 'phrases', label: 'Phrases', at: T.montageEnd, end: T.fall },
  { id: 'fall', label: 'Falling', at: T.fall, end: T.portal },
  { id: 'portal', label: 'Portal', at: T.portal, end: T.reveal },
  { id: 'reveal', label: 'Reveal', at: T.reveal, end: T.holeFull },
  { id: 'handoff', label: 'Handoff', at: T.holeFull, end: T.end },
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
