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
  // falling letters -> water drops -> door (scene.ts): about 14 s in all
  fall: 9000,
  cluster: [9500, 10600], // the letters drift together into 4 groups
  merge: [10300, 10900], // each group becomes a water drop; they land ~11.1-11.7 s
  ripplesOut: [11900, 12700], // the ripples, receding into depth, fade
  rise: [12000, 12800], // the water gathers and rises into a block on the right
  arc: [12800, 16000], // the block travels right -> left on an arc, dripping the door into being
  settle: [16000, 16500], // it lands on the left and breaks into drops
  open: [16500, 18000], // the door opens
  beam: [16600, 17900], // the light reveals the sand
  puddles: [16800, 17700],
  plants: [16900, 18600],
  doorZoom: [20600, 22400], // after a 2 s hold: into the door
  fadeOut: [22200, 22800], // the glyph island fades to the real one
  end: 22800,
} as const;

export const ENTER_MS = 160; // an email window's entrance
export const ZOOM = 2.3; // how far the camera pushes in on the last email

// ---- falling letters ---------------------------------------------------------------
export const LETTERS = {
  staggerMs: 1400, // spread of the letters' start times
  gravity: 0.13, // in viewport heights / s²
  driftPx: 26, // sideways drift, px/s (either way)
  spinDeg: 70, // rotation while falling, deg/s (either way)
};

// ---- the water-and-door scene (scene.ts) -------------------------------------------------
export const SCENE = {
  bg: '#16212d', // the darkness (the reference picture's slate blue)
  drops: 4,
  dropR: 0.036, // a drop's radius, of the viewport height
  horizon: 0.5, // the ground plane's horizon, of the height
  door: { cx: 0.5, sill: 0.71, h: 0.36, aspect: 0.5, frame: 0.08 }, // sill y and height of the viewport height; width = h * aspect
  arc: { xR: 0.84, xL: 0.16, y: 0.42, apex: 0.13 }, // the liquid's path (of width / height): same start and landing height
  strips: 12, // the door is poured in this many vertical strips, two drips each
  zoom: 1.12, // how far past "the opening fills the screen" the camera goes
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
  { id: 'fall', label: 'Letters → drops', at: T.fall, end: 11100 },
  { id: 'ripples', label: 'Ripples', at: 11100, end: T.rise[0] },
  { id: 'door', label: 'Liquid & door', at: T.rise[0], end: T.open[0] },
  { id: 'open', label: 'Opening', at: T.open[0], end: T.doorZoom[0] },
  { id: 'zoom', label: 'Zoom', at: T.doorZoom[0], end: T.fadeOut[0] },
  { id: 'handoff', label: 'Handoff', at: T.fadeOut[0], end: T.end },
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
