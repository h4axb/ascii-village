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
// The desktop on the laptop's screen is in its own SCREEN px.
// ---------------------------------------------------------------------------

export const STAGE_W = 1672;
export const STAGE_H = 643;

// ---- the shots ---------------------------------------------------------------------
// Eight stills of the same desk, six months apart, morning to deep night
// (public/intro/cinematic/, never edited: the light and the clutter are in
// them). Each one: when it cuts in (ms), how long it crossfades from the one
// before, where the laptop screen is in it (its four corners, measured from
// the pixels: the screen is a little wider at the bottom) and the desktop's
// clock and date.
type Pt = readonly [number, number];
export type Quad = readonly [Pt, Pt, Pt, Pt]; // top left, top right, bottom right, bottom left
export interface Frame {
  src: string;
  at: number;
  fade: number; // ms: the crossfade from the still before
  quad: Quad;
  time: string;
  date: string;
}

// the cinematic opens on black (the title), then fades in on the first shot
export const TITLE = { enabled: true, text: 'Six months earlier', at: [0, 1000] as const, fade: 260 };
export const LEAD = 1000;
// the first rejection, the whole interaction: notification, the inbox opens
// on the new mail, the mail opens; then the montage (M) starts
export const FIRST = { toast: LEAD + 1500, inbox: LEAD + 3500, select: LEAD + 3750, open: LEAD + 4300 };
export const M = LEAD + 8800;
// the montage: cuts faster and faster, as weeks and months go by (ms from M)
const CUT = [0, 1800, 3200, 4400, 5500, 6500, 7400, 8300];
export const CUTS_END = M + 9800; // the last still holds from here
const QUADS: Quad[] = [
  [[515.6, 56.7], [1116.0, 56.7], [1125.0, 409.5], [502.9, 409.5]],
  [[523.9, 64.2], [1120.1, 64.2], [1129.0, 413.4], [509.3, 413.4]],
  [[524.5, 64.3], [1120.5, 64.3], [1129.4, 413.4], [509.6, 413.4]],
  [[524.7, 63.9], [1120.8, 63.9], [1129.5, 413.1], [510.0, 413.1]],
  [[524.3, 63.6], [1120.6, 63.6], [1129.6, 412.3], [510.4, 412.3]],
  [[524.8, 63.3], [1121.2, 63.3], [1131.0, 413.1], [510.4, 413.1]],
  [[525.5, 62.4], [1122.1, 62.4], [1131.1, 412.7], [511.0, 412.7]],
  [[526.9, 62.3], [1122.9, 62.3], [1131.4, 412.4], [512.1, 412.4]],
];
const CLOCK: [string, string][] = [
  ['08:12', 'Mon 3 Mar'], // warm morning, a tidy desk
  ['13:46', 'Fri 21 Mar'], // bright midday
  ['16:20', 'Wed 16 Apr'], // afternoon, a juice can
  ['15:05', 'Tue 13 May'], // cloudy, an energy drink, the sketchbook shut
  ['19:42', 'Thu 19 Jun'], // evening, application lists, crumpled notes
  ['21:18', 'Mon 21 Jul'], // blue hour, more cans
  ['23:51', 'Sat 23 Aug'], // almost dark
  ['02:47', 'Tue 2 Sep'], // deep night: only the screen's light
];
const FADES = [0, 140, 140, 140, 120, 120, 100, 100];
export const FRAMES: Frame[] = QUADS.map((quad, i) => ({
  src: `/intro/cinematic/${String(i + 1).padStart(2, '0')}-shot.webp`,
  at: i ? M + CUT[i] : LEAD,
  fade: FADES[i],
  quad,
  time: CLOCK[i][0],
  date: CLOCK[i][1],
}));

// The desktop (HTML over the stills) is laid out once, in a screen of its
// own size, and mapped onto the laptop's screen by one perspective
// transform: icons, taskbar, clock, mail sit on the same spot of the laptop
// in every still, whatever the camera does.
export const SCREEN = { w: 736, h: 426 };
export const TASKBAR = 0.075; // of the screen's height

// The stills were shot a little apart, so each is placed on the stage to put
// its screen on the first still's (a scale and a shift, least squares over
// the corners) - plus one small zoom for all, so none leaves a gap at an
// edge. fitFrame(i): where still i goes (stage px, scale about its top left);
// screenQuad(): the laptop screen's corners on the stage, the same in every still.
const centre = (q: Quad) => [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4];
const fits = () => {
  const ref = QUADS[0];
  const [rx, ry] = centre(ref);
  const base = QUADS.map((q) => {
    const [px, py] = centre(q);
    let num = 0, den = 0;
    q.forEach((p, k) => {
      num += (p[0] - px) * (ref[k][0] - rx) + (p[1] - py) * (ref[k][1] - ry);
      den += (p[0] - px) ** 2 + (p[1] - py) ** 2;
    });
    const a = num / den;
    return { a, bx: rx - a * px, by: ry - a * py };
  });
  const cx = rx, cy = ry;
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
    quad: ref.map(([x, y]) => [cx + k * (x - cx), cy + k * (y - cy)] as const) as unknown as Quad,
  };
};
let fitCache: ReturnType<typeof fits> | null = null;
export const fitFrame = (i: number) => (fitCache ??= fits()).frames[i];
export const screenQuad = () => (fitCache ??= fits()).quad;
// the screen's centre and size on the stage
export function screenBox() {
  const q = screenQuad();
  const [x, y] = centre(q);
  const w = (q[1][0] - q[0][0] + q[2][0] - q[3][0]) / 2, h = (q[3][1] - q[0][1] + q[2][1] - q[1][1]) / 2;
  return { x, y, w, h, top: q[0][1] };
}
// CSS matrix3d mapping a w x h box (from its top left) onto a quad: the
// desktop drawn flat, put onto the laptop's screen in its perspective
export function rectToQuad(w: number, h: number, q: Quad): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, hh = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${c},${f},0,1)`;
}

// ---- the camera -----------------------------------------------------------------------
// One camera over all eight stills: close on the laptop's screen, then one
// continuous pull back through the montage, slow at first and faster and
// faster as the cuts speed up. scale: [ms from M, zoom] (1 = the whole desk
// filling the frame); it holds the first zoom until M. It zooms toward
// `origin` (stage px; null = the screen's centre). `tune` is for the dev
// bar: a multiplier on the zoom and a shift of the origin.
export const CAMERA = {
  scale: [
    [0, 1.5],
    [1800, 1.46],
    [3200, 1.4],
    [4400, 1.32],
    [5500, 1.23],
    [6500, 1.14],
    [7400, 1.07],
    [8300, 1.02],
    [9800, 1.0],
  ] as [number, number][],
  origin: null as null | { x: number; y: number },
  tune: { zoom: 1, ox: 0, oy: 0 },
};

// the camera's zoom at time t: CAMERA.scale through a monotone cubic
// (Fritsch-Carlson), so it never overshoots or jumps between keys
export function cameraZoom(t: number): number {
  const K = CAMERA.scale, u = t - M;
  if (u <= K[0][0]) return K[0][1];
  if (u >= K[K.length - 1][0]) return K[K.length - 1][1];
  const n = K.length;
  const d = K.slice(1).map(([x, y], i) => (y - K[i][1]) / (x - K[i][0]));
  const m = K.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) m[i] = m[i + 1] = 0;
    else {
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) {
        const k = 3 / Math.sqrt(h);
        m[i] = k * a * d[i];
        m[i + 1] = k * b * d[i];
      }
    }
  }
  let i = 0;
  while (u > K[i + 1][0]) i++;
  const h = K[i + 1][0] - K[i][0], s = (u - K[i][0]) / h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * K[i][1] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * K[i + 1][1] + (s3 - s2) * h * m[i + 1];
}

// the notification chime (sound.ts): no sound files, a soft synthesized tone
export const SOUND = { enabled: true, volume: 0.18, minGap: 300 };

// ---- the timeline (ms) ---------------------------------------------------------
const END = CUTS_END + 1500; // the last mail holds, then everything but its keywords fades
const FALL = END + 9000; // the keywords come loose; everything after is relative to it
export const T = {
  // the stills (FRAMES[].at); the mails' times are in emails.ts
  fadeIn: [LEAD, LEAD + 1000], // out of the opening black
  montageEnd: END,
  // slowly (about 6 s) everything but the three keywords fades away, then
  // they hold alone 3 s
  othersOut: [END, END + 5000], // the mail app, the other text and the desktop fade
  frameOut: [END + 1000, END + 6000], // the last mail's window and other words dissolve
  blackIn: [END, END + 6000], // the room fades to black
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
  { id: 'start', label: 'Title', at: 0, end: FRAMES[0].at },
  { id: 'first', label: '1 First mail', at: FRAMES[0].at, end: M },
  { id: 'shot1', label: '1', at: M, end: FRAMES[1].at },
  ...FRAMES.slice(1).map((f, i) => ({ id: `shot${i + 2}`, label: `${i + 2}`, at: f.at, end: FRAMES[i + 2]?.at ?? T.montageEnd })),
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
