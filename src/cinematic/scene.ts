// ---------------------------------------------------------------------------
// THE WATER-AND-DOOR SCENE (after the letters fall), drawn in glyphs on the
// cinematic's glyph canvas (glyphCanvas.ts). Everything is a pure function of
// the clock t (config.ts's T), sampled per cell, so seeking and zooming are
// exact and the zoom re-samples finer instead of blowing glyphs up.
//
//   drops     the letters' 4 groups fall as water drops and land
//   ripples   each landing rings out on a ground plane, receding into depth
//   rise      the water gathers on the right and rises into a block
//   arc       the block travels right -> left on an arc (start and landing at
//             one height), sloshing; its drips fall and pour the door, strip
//             by strip, bottom up; a few fall to the ground (plant seeds)
//   settle    it lands on the left and breaks into drops that hop to the
//             plants' places
//   door      front view: frame + leaf; the leaf swings open on its hinge
//   interior  sky with clouds and birds, the sea, an island (glyph painting)
//   beam      light from the doorway reveals sandy ground; puddles; plants
//             grow from the seed drops (stem, leaves, a few flowers)
//   camera    after the hold, zooms into the doorway
// ---------------------------------------------------------------------------
import { T, SCENE, clamp01, lerp, smooth, span, easeOutCubic, easeInOutCubic, rand } from './config';
import { g, pack, NONE, type GlyphCanvas, type RGB } from './glyphCanvas';
import { themeColor } from '../theme';

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const back = (a: RGB) => pack(mul(a, 0.45)); // the game's backing: the cell's own colour, darkened
const DARK: RGB = [0x16, 0x21, 0x2d]; // SCENE.bg

// value noise + fbm, for clouds, sand grain and water texture
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => rand(a * 57 + b * 131, 3);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
const fbm = (x: number, y: number) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;
const hash = (a: number, b: number) => rand(a * 12.9898 + b * 78.233, 7);

export interface DropSeed {
  x: number; // px, where the letters' group became a drop (at T.merge[1])
  y: number;
  vy: number; // px / s
}

interface Drop {
  x: number;
  y0: number;
  vy0: number;
  yLand: number;
  tLand: number; // ms
}
interface Drip {
  x: number;
  y0: number;
  t0: number;
  yLand: number;
  tLand: number;
  strip: number; // -1 = to the ground (a plant seed)
}
interface Plant {
  x: number;
  y: number;
  h: number;
  lean: number;
  leaves: number;
  flower: boolean;
  seedFrom: { x: number; y: number; t: number }; // where its seed drop comes from
  seedAt: number; // ms: the seed sits at the base
  growAt: number; // ms: it starts to grow
}
interface Puddle {
  x: number;
  y: number;
  rx: number;
  ry: number;
  at: number;
}

export interface Scene {
  vw: number;
  vh: number;
  R: number; // a drop's radius, px
  horizon: number;
  F: number; // ground projection: focal length, px
  K: number; // ground projection: y - horizon = K / Z
  door: { x0: number; x1: number; y0: number; y1: number; ix0: number; ix1: number; iy0: number; iy1: number; cx: number };
  drops: Drop[];
  drips: Drip[];
  stripLand: number[][]; // per strip: the times its drips land (each adds half the height)
  plants: Plant[];
  puddles: Puddle[];
  arc: { xR: number; xL: number; y: number; apex: number };
  ground: number; // the ground's y where the water gathers / lands
  col: Record<string, RGB>;
}

// ---- the liquid body's path --------------------------------------------------------
// s: 0..1 over T.arc. Slow over the door (the drips pour it), faster at the ends.
function arcU(s: number): number {
  const v = 2 * clamp01(s) - 1;
  return 0.5 + 0.5 * (0.3 * v + 0.7 * Math.sign(v) * Math.abs(v) ** 1.9);
}
function arcPos(sc: Scene, s: number): { x: number; y: number } {
  const u = arcU(s);
  return { x: lerp(sc.arc.xR, sc.arc.xL, u), y: sc.arc.y - sc.arc.apex * 4 * u * (1 - u) };
}
const G = (vh: number) => 2.4 * vh; // drips fall at this gravity, px/s²

// ---- building the scene (once per viewport) ----------------------------------------
export function buildScene(vw: number, vh: number, seeds: DropSeed[]): Scene {
  const R = SCENE.dropR * vh;
  const horizon = SCENE.horizon * vh;
  const H = SCENE.door.h * vh, W = H * SCENE.door.aspect, fw = Math.max(W * SCENE.door.frame, 6);
  const cx = SCENE.door.cx * vw, y1 = SCENE.door.sill * vh, y0 = y1 - H;
  const door = { x0: cx - W / 2, x1: cx + W / 2, y0, y1, ix0: cx - W / 2 + fw, ix1: cx + W / 2 - fw, iy0: y0 + fw * 1.1, iy1: y1, cx };
  const col = {
    deep: hex(themeColor('water.deep')),
    water: hex(themeColor('water.base')),
    shallow: hex(themeColor('water.shallow')),
    foam: hex(themeColor('water.foam')),
    sand: hex(themeColor('sand.base')),
    sandOuter: hex(themeColor('sand.outer')),
    sandGrain: hex(themeColor('sand.glyph')),
    grass: hex(themeColor('grass.base')),
    grassDark: hex(themeColor('bush.dark')),
    bushMid: hex(themeColor('bush.mid')),
    bushLight: hex(themeColor('bush.light')),
    petal: hex(themeColor('flower.petal')),
    centre: hex(themeColor('flower.centre')),
    frame: hex('#ebe2c8'),
    frameShade: hex('#a99f86'),
    leaf: hex('#ddd0ae'),
    skyTop: hex('#4c9fd6'),
    skyLow: hex('#bfe6ee'),
    cloud: hex('#f3f4ee'),
    cloudShade: hex('#c3d3dc'),
    light: hex('#f1d79a'),
  } as Record<string, RGB>;
  const sc: Scene = {
    vw,
    vh,
    R,
    horizon,
    F: vw * 0.55,
    K: vh - horizon,
    door,
    drops: [],
    drips: [],
    stripLand: Array.from({ length: SCENE.strips }, () => []),
    plants: [],
    puddles: [],
    arc: { xR: SCENE.arc.xR * vw, xL: SCENE.arc.xL * vw, y: SCENE.arc.y * vh, apex: SCENE.arc.apex * vh },
    ground: (SCENE.door.sill + 0.06) * vh,
    col,
  };
  // the drops: from the letters' groups to the ground, each at its own depth
  const gD = 1.6 * vh;
  seeds.forEach((s, i) => {
    const yLand = vh * (0.74 + 0.07 * rand(i, 21));
    const dy = Math.max(1, yLand - s.y);
    const tau = (-s.vy + Math.sqrt(s.vy * s.vy + 2 * gD * dy)) / gD;
    sc.drops.push({ x: s.x, y0: s.y, vy0: s.vy, yLand, tLand: T.merge[1] + tau * 1000 });
  });
  // the drips: two per door strip, poured as the body passes over it, plus a
  // few to the ground on either side (the plants' seeds)
  const strips = SCENE.strips;
  const sOfX = (x: number) => {
    let a = 0, b = 1;
    for (let k = 0; k < 30; k++) {
      const m = (a + b) / 2;
      if (arcPos(sc, m).x > x) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const arcMs = T.arc[1] - T.arc[0];
  for (let j = strips - 1; j >= 0; j--) {
    const x = door.x0 + ((j + 0.5) / strips) * W;
    const s = sOfX(x);
    for (let k = 0; k < 2; k++) {
      const t0 = T.arc[0] + (s + k * 0.018) * arcMs;
      const p = arcPos(sc, s + k * 0.018);
      const yLand = y1 - (k * 0.5) * H;
      const y0d = p.y + R * 0.9;
      const tLand = t0 + Math.sqrt((2 * Math.max(1, yLand - y0d)) / G(vh)) * 1000;
      sc.drips.push({ x, y0: y0d, t0, yLand, tLand, strip: j });
      sc.stripLand[j].push(tLand);
    }
  }
  // seeds to the ground: 2 on the right before the door, 2 on the left after it
  const groundDrips = [0.12, 0.24, 0.78, 0.9];
  groundDrips.forEach((s, i) => {
    const p = arcPos(sc, s);
    const yLand = vh * (0.79 + 0.05 * rand(i, 31));
    const t0 = T.arc[0] + s * arcMs;
    const y0d = p.y + R * 0.9;
    sc.drips.push({ x: p.x, y0: y0d, t0, yLand, tLand: t0 + Math.sqrt((2 * (yLand - y0d)) / G(vh)) * 1000, strip: -1 });
  });
  // plants: at the ground seeds, and beside the door (seeds hop there from
  // where the body lands)
  const landing = { x: sc.arc.xL, y: sc.ground, t: T.settle[0] + 260 };
  const near = [
    { x: door.x0 - W * 0.32, y: y1 + vh * 0.012, h: 0.13, lean: -0.25, leaves: 4, flower: false },
    { x: door.x0 - W * 0.85, y: y1 + vh * 0.05, h: 0.1, lean: -0.4, leaves: 3, flower: true },
    { x: door.x1 + W * 0.3, y: y1 + vh * 0.008, h: 0.15, lean: 0.2, leaves: 5, flower: false },
    { x: door.x1 + W * 0.95, y: y1 + vh * 0.045, h: 0.11, lean: 0.45, leaves: 4, flower: true },
    { x: door.x1 + W * 1.6, y: y1 + vh * 0.1, h: 0.09, lean: 0.3, leaves: 3, flower: false },
  ];
  near.forEach((p, i) => {
    sc.plants.push({
      x: p.x,
      y: p.y,
      h: p.h * vh,
      lean: p.lean,
      leaves: p.leaves,
      flower: p.flower,
      seedFrom: landing,
      seedAt: landing.t + 380 + i * 70,
      growAt: lerp(T.plants[0], T.plants[0] + 700, rand(i, 41)),
    });
  });
  sc.drips
    .filter((d) => d.strip < 0)
    .forEach((d, i) => {
      sc.plants.push({
        x: d.x,
        y: d.yLand,
        h: vh * (0.08 + 0.05 * rand(i, 51)),
        lean: (rand(i, 52) - 0.5) * 0.8,
        leaves: 3 + Math.floor(rand(i, 53) * 2),
        flower: i === 1,
        seedFrom: { x: d.x, y: d.yLand, t: d.tLand },
        seedAt: d.tLand,
        growAt: lerp(T.plants[0] + 300, T.plants[0] + 1000, rand(i, 54)),
      });
    });
  // puddles in front of the door
  [
    { dx: -0.3, dy: 0.035, rx: 0.36, ry: 0.024, at: 0 },
    { dx: 0.2, dy: 0.07, rx: 0.42, ry: 0.028, at: 200 },
    { dx: -0.08, dy: 0.13, rx: 0.3, ry: 0.022, at: 400 },
    { dx: 0.42, dy: 0.17, rx: 0.26, ry: 0.02, at: 550 },
  ].forEach((p) =>
    sc.puddles.push({ x: cx + p.dx * W * 2, y: y1 + p.dy * vh, rx: p.rx * W, ry: p.ry * vh, at: T.puddles[0] + p.at }),
  );
  return sc;
}

// ---- camera ---------------------------------------------------------------------------
function camera(sc: Scene, t: number) {
  const k = easeInOutCubic(clamp01((t - T.doorZoom[0]) / (T.doorZoom[1] - T.doorZoom[0])));
  const d = sc.door;
  const iw = d.ix1 - d.ix0, ih = d.iy1 - d.iy0;
  const Smax = Math.max(sc.vw / iw, sc.vh / ih) * SCENE.zoom;
  const S = Math.pow(Smax, k);
  const c = { x: lerp(sc.vw / 2, (d.ix0 + d.ix1) / 2, smooth(k)), y: lerp(sc.vh / 2, (d.iy0 + d.iy1) / 2, smooth(k)) };
  return { S, c, k };
}

// ---- the liquid's balls at time t (screen px, in scene space) -------------------------
interface Ball {
  x: number;
  y: number;
  r: number;
}
function liquidBalls(sc: Scene, t: number): Ball[] {
  const out: Ball[] = [];
  const R = sc.R;
  // falling drops (head + a little tail above, stretched by speed)
  if (t >= T.merge[0]) {
    const grow = span(t, T.merge);
    sc.drops.forEach((d) => {
      if (t >= d.tLand) return;
      const tau = Math.max(0, t - T.merge[1]) / 1000;
      const gD = 1.6 * sc.vh;
      const y = t < T.merge[1] ? d.y0 - d.vy0 * ((T.merge[1] - t) / 1000) : d.y0 + d.vy0 * tau + 0.5 * gD * tau * tau;
      const v = d.vy0 + gD * tau;
      const r = R * (0.35 + 0.65 * grow);
      out.push({ x: d.x, y, r });
      const tail = Math.min(1.6, v / (sc.vh * 0.9));
      out.push({ x: d.x, y: y - r * (0.9 + 0.5 * tail), r: r * 0.55 });
    });
  }
  // the block rising on the right, then travelling the arc
  if (t >= T.rise[0] && t < T.settle[1]) {
    const cols = 5, rows = 2;
    const sArc = clamp01((t - T.arc[0]) / (T.arc[1] - T.arc[0]));
    const shrink = lerp(1, 0.62, sArc);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const ox = (c - (cols - 1) / 2) * R * 1.25, oy = (r - 0.5) * R * 1.15;
        let x: number, y: number, rr = R * 0.78 * shrink;
        if (t < T.arc[0]) {
          // rising out of the ground, ball by ball
          const k = easeOutCubic(clamp01((t - T.rise[0] - i * 40) / (T.rise[1] - T.rise[0] - 300)));
          x = sc.arc.xR + ox;
          y = lerp(sc.ground, sc.arc.y + oy, k);
          rr *= 0.4 + 0.6 * k;
          // wobble as it settles into a block (ref video 2's first frames)
          y += Math.sin(t / 90 + c) * R * 0.18 * (1 - k);
        } else if (t < T.arc[1]) {
          // trailing balls lag: the body stretches and sloshes along the path
          const lag = (cols - 1 - c) * 0.012 + r * 0.004;
          const p = arcPos(sc, sArc - lag);
          const v = Math.abs(2 * sArc - 1);
          const slosh = Math.sin(t / 140 + c * 1.3) * R * 0.32 * (0.4 + 0.6 * v);
          // U shape near the start and landing (decelerating), waves mid-air
          const cup = (1 - 4 * sArc * (1 - sArc)) * Math.abs(c - (cols - 1) / 2) * R * 0.22;
          x = p.x + ox;
          y = p.y + oy + slosh - cup;
        } else {
          // landing on the left: the body slumps and spreads
          const k = easeOutCubic(span(t, T.settle));
          const p = arcPos(sc, 1);
          x = p.x + ox * (1 + 1.4 * k);
          y = lerp(p.y + oy, sc.ground - R * 0.2, k);
          rr *= 1 - 0.75 * k;
        }
        out.push({ x, y, r: rr });
      }
  }
  // drips in flight
  for (const d of sc.drips) {
    if (t < d.t0 || t >= d.tLand) continue;
    const tau = (t - d.t0) / 1000;
    const y = d.y0 + 0.5 * G(sc.vh) * tau * tau;
    const r = R * 0.42;
    out.push({ x: d.x, y, r });
    out.push({ x: d.x, y: y - r * 1.3, r: r * 0.5 });
  }
  // seed drops hopping from the landing to the plants
  for (const p of sc.plants) {
    if (p.seedFrom.t === p.seedAt) continue; // ground-drip seeds just land
    if (t < p.seedFrom.t || t >= p.seedAt) continue;
    const k = (t - p.seedFrom.t) / (p.seedAt - p.seedFrom.t);
    out.push({ x: lerp(p.seedFrom.x, p.x, k), y: lerp(p.seedFrom.y, p.y, k) - Math.sin(k * Math.PI) * sc.vh * 0.08, r: sc.R * 0.38 });
  }
  return out;
}

// splash bits: a short burst at every landing
function splashes(sc: Scene, t: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const burst = (x: number, y: number, t0: number, n: number, seed: number, size: number) => {
    const tau = (t - t0) / 1000;
    if (tau < 0 || tau > 0.45) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (rand(seed, i) - 0.5) * 2.4;
      const v = size * (0.6 + rand(seed, i + 9) * 0.8);
      out.push({ x: x + Math.cos(a) * v * tau, y: y + Math.sin(a) * v * tau + 0.5 * 2.2 * sc.vh * tau * tau });
    }
  };
  sc.drops.forEach((d, i) => burst(d.x, d.yLand, d.tLand, 9, 100 + i, sc.vh * 0.5));
  sc.drips.forEach((d, i) => burst(d.x, d.yLand, d.tLand, 3, 300 + i, sc.vh * 0.18));
  return out;
}

// door strips: how much of each is poured, 0..1 of the door's height
function stripFill(sc: Scene, j: number, t: number): number {
  let f = 0;
  for (const tl of sc.stripLand[j]) f += 0.5 * easeOutCubic(clamp01((t - tl) / 320));
  return f;
}

// ---- the interior painting (u, v in 0..1 of the doorway) ----------------------------
function interior(sc: Scene, u: number, v: number, t: number): { ch: number; c: RGB } {
  const C = sc.col;
  const hz = 0.6; // the sea's horizon
  const ts = t / 1000;
  // island: a soft mound left of centre
  const iu = (u - 0.38) / 0.17;
  const top = hz - 0.085 * Math.pow(Math.max(0, 1 - iu * iu), 0.6) - 0.015 * (vnoise(u * 14, 1) - 0.5);
  if (v < hz + 0.005 && v > top && Math.abs(iu) < 1.05) {
    const depth = (v - top) / Math.max(0.01, hz - top);
    const lightK = clamp01(0.75 - depth * 0.7 - iu * 0.25 + (fbm(u * 14, v * 14) - 0.5) * 0.5);
    const c = lightK > 0.55 ? mixc(C.bushLight, C.grass, (lightK - 0.55) * 1.8) : mixc(C.grassDark, C.bushMid, lightK / 0.55);
    const glyphs = '§&%¤';
    return { ch: g(glyphs[Math.floor(hash(Math.floor(u * 80), Math.floor(v * 80)) * glyphs.length)]), c };
  }
  if (v < hz) {
    // sky, clouds, birds
    const k = v / hz;
    let c = mixc(C.skyTop, C.skyLow, Math.pow(k, 1.3));
    // clouds: a few soft puffs, thickest low in the sky
    const n = fbm(u * 4.2 + ts * 0.02, v * 7) * (0.5 + 0.55 * k);
    if (n > 0.56) {
      const dd = clamp01((n - 0.56) * 7);
      c = mixc(mixc(C.cloudShade, C.cloud, clamp01(1.2 - k * 0.8)), C.cloud, dd * 0.6);
      return { ch: g(dd > 0.7 ? '@' : dd > 0.45 ? 'O' : dd > 0.2 ? 'o' : ':'), c };
    }
    for (const [bu, bv, s] of [
      [0.28, 0.16, 0],
      [0.34, 0.12, 1],
      [0.64, 0.2, 2],
    ] as const) {
      const bx = bu + ts * 0.01 * (s % 2 ? 1 : -1);
      if (Math.abs(u - bx) < 0.018 && Math.abs(v - bv) < 0.012) return { ch: g(Math.sin(ts * 9 + s) > 0 ? 'v' : '^'), c: mul(C.skyTop, 0.45) };
    }
    const hs = hash(Math.floor(u * 90), Math.floor(v * 60));
    return { ch: g(hs > 0.82 ? '·' : hs > 0.5 ? '.' : ' '), c: mixc(c, C.cloud, 0.12) };
  }
  // the sea
  const k = (v - hz) / (1 - hz);
  let c = mixc(mixc(C.shallow, C.foam, 0.25), C.water, Math.pow(k, 0.8));
  c = mixc(c, C.deep, clamp01(k - 0.5) * 0.6);
  const wave = Math.sin(u * 46 + v * 10 - ts * 2.2 + fbm(u * 6, v * 20) * 4);
  const spark = hash(Math.floor(u * 70 + ts * 3), Math.floor(v * 50)) > 0.93 && k < 0.6;
  if (v > 0.94) return { ch: g('≈'), c: mixc(c, C.foam, 0.6) };
  if (spark) return { ch: g('°'), c: mixc(c, C.foam, 0.45) };
  return { ch: g(wave > 0.55 ? '~' : wave < -0.7 ? '-' : '·'), c: mixc(c, C.foam, wave > 0.55 ? 0.35 : 0) };
}

// ---- render one frame into the canvas buffer ------------------------------------------
export function renderScene(sc: Scene, gc: GlyphCanvas, t: number, reduced: boolean) {
  gc.clear();
  const C = sc.col;
  const { S, c: cam } = reduced ? { S: 1, c: { x: sc.vw / 2, y: sc.vh / 2 } } : camera(sc, t);
  const d = sc.door;
  const W = d.x1 - d.x0, H = d.y1 - d.y0;
  const iw = d.ix1 - d.ix0, ih = d.iy1 - d.iy0;
  // door opening: the leaf's swing
  const openK = easeInOutCubic(span(t, T.open));
  const theta = openK * 1.36; // ~78°
  const leafEdge = d.ix0 + iw * Math.cos(theta);
  const leafShrink = ih * 0.16 * Math.sin(theta); // the free edge recedes: shorter
  const beamK = span(t, T.beam) * (reduced ? 1 : Math.min(1, 0.25 + openK));
  const balls = reduced ? [] : liquidBalls(sc, t);
  const bits = reduced ? [] : splashes(sc, t);
  // bounding box of the liquid, for a quick reject
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const b of balls) {
    bx0 = Math.min(bx0, b.x - b.r * 1.6);
    bx1 = Math.max(bx1, b.x + b.r * 1.6);
    by0 = Math.min(by0, b.y - b.r * 1.6);
    by1 = Math.max(by1, b.y + b.r * 1.6);
  }
  const ripK = 1 - span(t, T.ripplesOut);
  const plantsOn = t >= T.arc[0];
  const doorBuilt = t >= T.arc[0];

  const { cols, rows, cw, ch } = gc;
  for (let r = 0, i = 0; r < rows; r++) {
    const sy = (r + 0.5) * ch;
    for (let cIdx = 0; cIdx < cols; cIdx++, i++) {
      const sx = (cIdx + 0.5) * cw;
      // scene point under this cell (the camera zooms into the doorway)
      const x = cam.x + (sx - sc.vw / 2) / S, y = cam.y + (sy - sc.vh / 2) / S;
      const pxCell = cw / S; // one cell, in scene px
      let gi = 0, fg: RGB | null = null, bgc = NONE;

      // -- ground: the beam's sand, puddles, ripples (below the horizon)
      if (y > d.y1 - 1 && beamK > 0) {
        const dy = y - d.y1;
        const half = iw / 2 + dy * 0.62;
        const ax = Math.abs(x - d.cx);
        if (ax < half * 1.3) {
          const I = beamK * (0.3 + 0.7 * Math.exp(-dy / (sc.vh * 0.22))) * smooth(clamp01((half * 1.3 - ax) / (half * 0.6)));
          if (I > 0.05) {
            const gx = Math.floor(x / pxCell), gy = Math.floor(y / (ch / S));
            const n = hash(gx, gy);
            const base = mixc(C.sand, C.sandOuter, vnoise(x / 60, y / 30));
            const cc = mixc(DARK, base, Math.min(1, I * 1.15));
            fg = mixc(cc, C.sandGrain, 0.35 * I);
            gi = g(n > 0.86 ? ':' : n > 0.6 ? '·' : n > 0.45 ? ',' : n > 0.4 ? '°' : '.');
            bgc = pack(mixc(DARK, cc, 0.7));
          }
        }
      }
      // puddles
      if (y > d.y1) {
        for (const p of sc.puddles) {
          const k = easeOutCubic(clamp01((t - p.at) / 700));
          if (k <= 0 || Math.abs(x - p.x) > p.rx * k * 1.2 || Math.abs(y - p.y) > p.ry * k * 1.2) continue;
          const wob = 1 + 0.18 * (vnoise(x / 18 + p.x, y / 10) - 0.5);
          const e = (((x - p.x) / (p.rx * k)) ** 2 + ((y - p.y) / (p.ry * k)) ** 2) * wob;
          if (e < 1) {
            const lit = 0.35 + 0.65 * beamK;
            const glint = Math.sin(x / 9 + t / 260) > 0.75 && e < 0.6;
            fg = glint ? C.foam : mixc(DARK, mixc(C.shallow, C.foam, 0.3 * (1 - e)), lit);
            gi = g(glint ? '°' : e > 0.7 ? '-' : '~');
            bgc = pack(mixc(DARK, mixc(C.water, C.deep, 0.3), 0.75 * lit));
          }
        }
      }
      // ripples on the ground plane, receding into depth: each ring is the
      // projection of a circle whose centre moves away from the camera
      if (ripK > 0 && y > sc.horizon + 2 && !reduced) {
        for (let k = 0; k < sc.drops.length; k++) {
          const dr = sc.drops[k];
          const Z0 = sc.K / (dr.yLand - sc.horizon), X0 = ((dr.x - sc.vw / 2) * Z0) / sc.F;
          for (let ring = 0; ring < 2; ring++) {
            const tau = (t - dr.tLand - ring * 260) / 1000;
            if (tau < 0 || tau > 1.9) continue;
            const Zc = Z0 * (1 + 0.7 * tau);
            const rad = Z0 * (0.05 + 0.3 * easeOutCubic(tau / 1.9));
            const cxs = sc.vw / 2 + (X0 * sc.F) / Zc, cys = sc.horizon + sc.K / Zc;
            const rx = (rad * sc.F) / Zc, ry = (sc.K * rad) / (Zc * Zc);
            if (rx < pxCell * 2 || Math.abs(y - cys) > ry + ch || Math.abs(x - cxs) > rx + pxCell * 2) continue;
            const ex = (x - cxs) / rx, ey = (y - cys) / ry;
            const e = Math.hypot(ex, ey) || 1e-6;
            // distance to the ring in cells (|e - 1| over the gradient of e, per cell)
            const gx = (ex / (e * rx)) * pxCell, gy = (ey / (e * ry)) * (ch / S);
            const dCells = Math.abs(e - 1) / (Math.hypot(gx, gy) || 1);
            if (dCells < 0.5) {
              const fade = (1 - tau / 1.9) * ripK;
              const ang = Math.atan2(ey, ex); // which glyph follows the ring's tangent
              const sn = Math.abs(Math.sin(ang)), cs = Math.cos(ang);
              fg = mul(mixc(C.shallow, C.foam, 0.4), 0.25 + 0.75 * fade);
              gi = g(sn > 0.8 ? (fade > 0.5 ? '~' : '-') : sn < 0.35 ? (cs > 0 ? ')' : '(') : cs * Math.sin(ang) > 0 ? '\\' : '/');
            }
          }
        }
      }

      // -- the door (only where poured)
      if (doorBuilt && x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) {
        const j = Math.min(SCENE.strips - 1, Math.floor(((x - d.x0) / W) * SCENE.strips));
        const fill = stripFill(sc, j, t);
        const hb = (d.y1 - y) / H; // 0 at the sill, 1 at the top
        const surface = fill + 0.012 * Math.sin(x / 7 + t / 80) * (fill < 1 ? 1 : 0);
        if (hb <= surface) {
          // fresh water near the pour line turns into door material; once the
          // strip is full, the last of it dries too
          const lastLand = sc.stripLand[j][sc.stripLand[j].length - 1] ?? 0;
          const wet = Math.max(clamp01((surface - hb) / 0.09), fill >= 0.999 ? clamp01((t - lastLand - 320) / 500) : 0);
          const inOpening = x >= d.ix0 && x < d.ix1 && y >= d.iy0;
          let cc: RGB, gl: number;
          let inside = false; // the bright painting behind the door: a light backing
          if (!inOpening) {
            // frame: pale stone, shaded on its outer edge, lit inside
            const edge = Math.min(x - d.x0, d.x1 - x, y - d.y0) / (W * 0.05);
            const lit = 0.55 + 0.45 * clamp01(edge) + 0.25 * openK * clamp01(1 - Math.min(Math.abs(x - d.ix0), Math.abs(x - d.ix1), Math.abs(y - d.iy0)) / (W * 0.1));
            cc = mul(mixc(C.frameShade, C.frame, clamp01(edge)), Math.min(1.15, lit));
            const tex = hash(Math.floor(x / pxCell), Math.floor(y / (ch / S)));
            gl = g(y < d.iy0 ? (tex > 0.5 ? '=' : '‡') : tex > 0.5 ? '|' : '¦');
          } else {
            // the doorway: the leaf, or (where it has swung away) the island
            const lx = (x - d.ix0) / Math.max(1, leafEdge - d.ix0);
            const shrink = leafShrink * clamp01(lx);
            const onLeaf = x < leafEdge && y >= d.iy0 + shrink / 2 && y < d.iy1 - shrink / 2;
            if (onLeaf) {
              const lu = lx;
              const shade = 1 - 0.5 * Math.sin(theta) * (0.4 + 0.6 * lu);
              cc = mul(C.leaf, shade);
              const plank = Math.abs((lu * 4) % 1 - 0.5) > 0.44;
              const knob = Math.abs(lu - 0.86) < 0.06 && Math.abs((y - d.iy0) / ih - 0.52) < 0.03;
              gl = g(knob ? 'o' : plank ? '|' : hash(Math.floor(x / pxCell), Math.floor(y / (ch / S))) > 0.7 ? ':' : '·');
              if (knob) cc = mul(C.frameShade, 0.8);
            } else {
              const p = interior(sc, (x - d.ix0) / iw, (y - d.iy0) / ih, t);
              cc = p.c;
              gl = p.ch;
              inside = true;
            }
          }
          if (wet < 1) {
            cc = mixc(mixc(C.shallow, C.water, 0.4), cc, wet);
            if (wet < 0.5) gl = g(hash(i, Math.floor(t / 120)) > 0.5 ? '~' : 'o');
          }
          fg = cc;
          gi = gl;
          // the painting behind the door: a lighter backing than the game's,
          // with glyphs lifted off it so it still reads as glyph art
          bgc = inside && wet >= 1 ? pack(mul(cc, 0.72)) : back(cc);
          if (inside && wet >= 1 && gl) fg = mixc(cc, [255, 255, 255], 0.3);
        }
      }

      // -- plants
      if (plantsOn && !reduced) {
        for (const p of sc.plants) {
          if (t < p.seedAt) continue;
          if (Math.abs(x - p.x) > p.h * 0.8 || y > p.y + pxCell * 1.5 || y < p.y - p.h * 1.1) continue;
          const grow = clamp01((t - p.growAt) / 1300);
          const lit = 0.45 + 0.55 * beamK * Math.exp(-Math.abs(p.x - d.cx) / (sc.vw * 0.25));
          if (grow <= 0) {
            // the seed: a water drop at the base, turning green as it wakes
            if (Math.abs(x - p.x) < pxCell * 0.9 && Math.abs(y - p.y) < (ch / S) * 0.7) {
              fg = mixc(C.shallow, C.grass, clamp01((t - p.growAt + 300) / 300));
              gi = g('o');
            }
            continue;
          }
          const s = (p.y - y) / p.h; // 0 at the base, 1 at full height
          const xs = (q: number) => p.x + p.lean * q * q * p.h * 0.5;
          const cellH = ch / S;
          // stem
          if (s >= 0 && s <= grow && Math.abs(x - xs(s)) < pxCell * 0.55) {
            const slope = p.lean * s;
            fg = mul(mixc(C.grassDark, C.bushMid, s), lit);
            gi = g(slope > 0.25 ? '/' : slope < -0.25 ? '\\' : '|');
          }
          // leaves: short strokes angled up and out, unfolding as the stem passes them
          for (let L = 0; L < p.leaves; L++) {
            const at = 0.22 + (L / p.leaves) * 0.62;
            const cells = Math.round(clamp01((grow - at) * 5) * (3.2 - L * 0.4));
            if (cells <= 0) continue;
            const side = L % 2 ? 1 : -1;
            const bxl = xs(at), byl = p.y - at * p.h;
            for (let q = 1; q <= cells; q++) {
              const lx = bxl + side * q * pxCell, ly = byl - q * cellH * 0.55;
              if (Math.abs(x - lx) < pxCell * 0.5 && Math.abs(y - ly) < cellH * 0.5) {
                fg = mul(mixc(C.bushMid, C.grass, q / cells), lit * 1.1);
                gi = g(side > 0 ? '/' : '\\');
              }
            }
          }
          // a bud on the plants without a flower
          if (!p.flower && grow > 0.95 && Math.abs(x - xs(1)) < pxCell * 0.5 && Math.abs(y - (p.y - p.h - cellH * 0.5)) < cellH * 0.5) {
            fg = mul(C.grass, lit * 1.15);
            gi = g('Y');
          }
          // a flower at the top
          if (p.flower && grow > 0.8) {
            const fk = easeOutCubic((grow - 0.8) / 0.2);
            const fx = xs(1), fy = p.y - p.h;
            const dd = Math.hypot((x - fx) / pxCell, (y - fy) / (ch / S));
            if (dd < 1.6 * fk) {
              fg = dd < 0.6 ? C.centre : mul(C.petal, 0.6 + 0.4 * lit);
              gi = g(dd < 0.6 ? '@' : '*');
            }
          }
        }
      }

      // -- water: drops, the travelling block, drips (metaballs)
      if (balls.length && x > bx0 && x < bx1 && y > by0 && y < by1) {
        let f = 0, nx = 0, ny = 0;
        for (const b of balls) {
          const dx = x - b.x, dy = y - b.y;
          const d2 = dx * dx + dy * dy + 1;
          const w = (b.r * b.r) / d2;
          f += w;
          nx += (dx * w) / Math.sqrt(d2);
          ny += (dy * w) / Math.sqrt(d2);
        }
        if (f > 1) {
          const nl = Math.hypot(nx, ny) || 1;
          const light = -(nx / nl) * 0.6 - (ny / nl) * 0.8; // light from the top-left
          const edge = f < 1.35;
          let cc = mixc(C.deep, C.shallow, clamp01(0.5 + light * 0.5));
          let gl = g(edge ? 'o' : f > 2.4 ? '@' : f > 1.7 ? '0' : 'O');
          if (light > 0.7 && f < 1.9) {
            cc = C.foam;
            gl = g('°');
          }
          fg = cc;
          gi = gl;
          bgc = back(mixc(C.deep, C.water, 0.5));
        }
      }
      if (gi || bgc !== NONE) {
        gc.glyph[i] = gi;
        gc.fg[i] = fg ? pack(fg) : 0;
        gc.bg[i] = bgc;
      }
    }
  }
  // splash bits (cells, on top)
  for (const b of bits) {
    const sx = (b.x - cam.x) * S + sc.vw / 2, sy = (b.y - cam.y) * S + sc.vh / 2;
    const ci = Math.floor(sx / cw), ri = Math.floor(sy / ch);
    if (ci < 0 || ri < 0 || ci >= cols || ri >= rows) continue;
    const i = ri * cols + ci;
    gc.glyph[i] = g(rand(ci, ri) > 0.5 ? '·' : '\'');
    gc.fg[i] = pack(C.foam);
  }
}
