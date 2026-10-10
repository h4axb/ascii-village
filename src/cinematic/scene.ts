// ---------------------------------------------------------------------------
// THE DOOR SCENE (after the letters fall), drawn on the cinematic's glyph
// canvas (glyphCanvas.ts). Everything is a pure function of the clock t
// (config.ts's T), so seeking is exact.
//
//   strings   the falling letters, turned to water: strings of glyphs that
//             drift in toward the door and land on its foot
//   build     the door (door-glyphs.svg via door.ts) grows out of that water
//             (growFrom), slowly, through its own shape like a liquid: each
//             glyph emerges as water, then sets into the drawing's glyph and
//             colour
//   open      the leaf swings open on its left hinge, slowly, to about half
//             its width; it is re-sampled column by column into the grid (no
//             squeezed glyphs), its free edge coming toward the viewer
//   doorway   behind it: sky with clouds and birds, the sea, an island
//   beam      light comes out of the doorway onto sandy ground
// The camera's walk toward the door and the fade to black are in draw()
// (IntroCinematic.tsx), so the glyphs are never re-sampled.
// ---------------------------------------------------------------------------
import { T, SCENE, LETTERS, clamp01, lerp, smooth, span, easeOutCubic, easeInOutCubic, rand } from './config';
import { g, pack, NONE, type GlyphCanvas, type RGB } from './glyphCanvas';
import { DOOR } from './door';
import { themeColor } from '../theme';

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const DARK = hex(SCENE.bg);
const WHITE: RGB = [255, 255, 255];

// value noise + fbm, for clouds, sand grain and water texture
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => rand(a * 57 + b * 131, 3);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
const fbm = (x: number, y: number) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;
const hash = (a: number, b: number) => rand(a * 12.9898 + b * 78.233, 7);

const SCENE_G = LETTERS.gravity; // the strings fall as the letters did (viewport heights / s²)
const EMERGE = 750; // ms: a glyph emerging - water first, then the door's own glyph
const SETTLE = 400; // ms: its brief brighten as it sets

// A letter turned to water: a string of glyphs falling from where the letter
// was (world px: the final framing; the camera pan shifts it on screen),
// drifting in toward its column of the door and landing on the door's foot.
export interface WaterString {
  x0: number; // where it starts (px), with its speed (px/s, down)
  y0: number;
  v0: number;
  t0: number; // ms
  tx: number; // the door column it lands in (px)
  landY: number;
  tLand: number; // ms
  len: number; // tail length, cells
}

export interface Scene {
  vw: number;
  vh: number;
  cell: number; // the grid's square cell, px
  c0: number; // the grid cell of the door's top-left
  r0: number;
  born: Float32Array; // per door cell (r * cols + c): when it emerges, ms
  strings: WaterString[]; // the letters, turned to water, falling onto the door's foot
  focus: { x: number; y: number }; // the open doorway's centre, px (the walk aims here)
  col: Record<string, RGB>;
}

// the grid's cell size for a viewport: the door is SCENE.door.h of the height
export const sceneCell = (vh: number) => Math.max(5, Math.round((SCENE.door.h * vh) / DOOR.rows));

export function buildScene(vw: number, vh: number): Scene {
  const cell = sceneCell(vh);
  const c0 = Math.round(vw / (2 * cell) - DOOR.cols / 2);
  const r0 = Math.round((SCENE.door.cy * vh) / cell - DOOR.rows / 2);
  const n = DOOR.cols * DOOR.rows;
  const born = new Float32Array(n).fill(Infinity);
  const dur = T.build[1] - T.build[0];
  // the door rises from the middle of its foot: each glyph's time is its
  // distance from there (up, and out to the sides)
  const mid = (DOOR.cols - 1) / 2;
  const dist = (k: { c: number; r: number }) => Math.hypot(DOOR.rows - 1 - k.r, Math.abs(k.c - mid) * 2.2);
  const dMax = Math.max(...DOOR.cells.map(dist));
  for (const k of DOOR.cells) {
    const i = k.r * DOOR.cols + k.c;
    born[i] = T.build[0] + (dist(k) / dMax) * (dur - 380) + rand(k.c, k.r) * 380;
  }
  const open = (DOOR.hinge + (DOOR.leafRight + 1 - DOOR.hinge) * SCENE.door.open + DOOR.leafRight + 1) / 2;
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
    skyTop: hex('#4c9fd6'),
    skyLow: hex('#bfe6ee'),
    cloud: hex('#f3f4ee'),
    cloudShade: hex('#c3d3dc'),
    light: hex('#f1d79a'),
  } as Record<string, RGB>;
  return {
    vw,
    vh,
    cell,
    c0,
    r0,
    born,
    strings: [],
    focus: { x: (c0 + open) * cell, y: (r0 + (DOOR.leafTop + DOOR.leafBottom + 1) / 2) * cell },
    col,
  };
}

// The door emerges from the water that lands on its foot: each string lands
// in a cell (a seed) at time t, and the door grows from the seeds through its
// own shape like a liquid finding its way - a flood fill whose every step
// costs a little noise, so the front advances in uneven lobes - slowly, until
// the whole shape is filled by the end of T.build.
export function growFrom(sc: Scene, seeds: { c: number; r: number; t: number }[]) {
  if (!seeds.length) return;
  const { cols, rows } = DOOR;
  const t0 = Math.min(...seeds.map((s) => s.t));
  const guess = (T.build[1] - t0) / (rows * 1.6); // ms per step, to weigh the seeds' times
  const dist = new Float64Array(cols * rows).fill(Infinity);
  // a small binary heap of [cost, index]
  const heap: [number, number][] = [];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let j = heap.length - 1;
    while (j > 0) {
      const p = (j - 1) >> 1;
      if (heap[p][0] <= heap[j][0]) break;
      [heap[p], heap[j]] = [heap[j], heap[p]];
      j = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let j = 0;
      for (;;) {
        const a = 2 * j + 1, b = a + 1;
        let m = j;
        if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
        if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
        if (m === j) break;
        [heap[m], heap[j]] = [heap[j], heap[m]];
        j = m;
      }
    }
    return top;
  };
  for (const s of seeds) {
    const i = s.r * cols + s.c, d = (s.t - t0) / guess;
    if (d < dist[i]) {
      dist[i] = d;
      push(d, i);
    }
  }
  const cost = (c: number, r: number) => 0.35 + 1.9 * Math.pow(fbm(c * 0.22 + 3.1, r * 0.22 + 7.7), 1.6);
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const c = i % cols, r = (i / cols) | 0;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || !DOOR.at[nr * cols + nc]) continue;
        const nd = d + cost(nc, nr) * (dr && dc ? 1.41 : 1);
        if (nd < dist[nr * cols + nc]) {
          dist[nr * cols + nc] = nd;
          push(nd, nr * cols + nc);
        }
      }
  }
  // cells the flood can't reach (stray glyphs): by plain distance to a seed
  for (const k of DOOR.cells) {
    const i = k.r * cols + k.c;
    if (dist[i] === Infinity) dist[i] = Math.min(...seeds.map((s) => Math.hypot(k.r - s.r, k.c - s.c) * 1.2));
  }
  const dMax = Math.max(1, ...DOOR.cells.map((k) => dist[k.r * cols + k.c]));
  const per = (T.build[1] - t0 - EMERGE) / dMax;
  for (const k of DOOR.cells) sc.born[k.r * cols + k.c] = t0 + dist[k.r * cols + k.c] * per;
}

// where a door cell sits on screen (its centre, px)
export const cellAt = (sc: Scene, c: number, r: number) => ({ x: (sc.c0 + c + 0.5) * sc.cell, y: (sc.r0 + r + 0.5) * sc.cell });


// ---- the interior painting (u, v in 0..1 of the doorway) ----------------------------
function interior(sc: Scene, u: number, v: number, t: number): { ch: number; c: RGB } {
  const C = sc.col;
  const hz = 0.6; // the sea's horizon
  const ts = t / 1000;
  // island: a soft mound in the part the open leaf leaves in view
  const iu = (u - 0.76) / 0.15;
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
      [0.66, 0.16, 0],
      [0.72, 0.12, 1],
      [0.88, 0.22, 2],
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
// shift: whole rows the camera's pan moves everything down this frame (the
// rest of the pan, under a cell, is applied when drawing)
export function renderScene(sc: Scene, gc: GlyphCanvas, t: number, reduced: boolean, shift = 0) {
  gc.clear();
  const r0 = sc.r0 + shift;
  const C = sc.col;
  const D = DOOR;
  const { cols, rows } = gc;
  // a cell: glyph, colour and (if given) backing; without one it keeps what
  // is there (the door's foot over the beam's lit sand)
  const put = (c: number, r: number, gi: number, rgb: RGB, bg?: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    gc.glyph[i] = gi;
    gc.fg[i] = pack(rgb);
    if (bg !== undefined) gc.bg[i] = bg;
  };
  // the leaf's swing: its width goes from 1 to SCENE.door.open of itself
  const openK = easeInOutCubic(clamp01((t - T.open[0]) / (T.open[1] - T.open[0])));
  const cosT = lerp(1, SCENE.door.open, openK), sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const openFrac = (1 - cosT) / (1 - SCENE.door.open);
  const beamK = span(t, T.beam) * openFrac;
  const W = D.leafRight + 1 - D.hinge; // the leaf's width, cells
  const sill = r0 + D.leafBottom + 1;

  // a water string at t: a bright head, a tail of thinning water above it;
  // landed, a small splash while the tail drains into the door's foot
  const cellPx = sc.cell, gA = SCENE_G * sc.vh;
  const drawString = (w: WaterString) => {
    if (t < w.t0 || t > w.tLand + 320) return;
    const tau = (Math.min(t, w.tLand) - w.t0) / 1000;
    const y = Math.min(w.landY, w.y0 + w.v0 * tau + 0.5 * gA * tau * tau);
    const prog = clamp01((y - w.y0) / Math.max(1, w.landY - w.y0));
    const x = lerp(w.x0, w.tx, smooth(prog));
    const hc = Math.floor(x / cellPx), hr = Math.floor(y / cellPx) + shift;
    const drain = t > w.tLand ? clamp01((t - w.tLand) / 300) : 0;
    const len = Math.max(0, Math.round(w.len * (1 - drain)));
    const appear = clamp01((t - w.t0) / 160);
    // the tail follows the path it came down (the drift bends it)
    for (let k = len; k >= 1; k--) {
      const yk = y - k * cellPx;
      if (yk < w.y0 - cellPx) continue;
      const pk = clamp01((yk - w.y0) / Math.max(1, w.landY - w.y0));
      const ck = Math.floor(lerp(w.x0, w.tx, smooth(pk)) / cellPx);
      const f = 1 - k / (len + 1);
      const gl = k <= 1 ? '|' : k <= 3 ? '¦' : k <= 5 ? ':' : '.';
      put(ck, Math.floor(yk / cellPx) + shift, g(gl), mixc(DARK, mixc(C.shallow, C.foam, 0.5 * f), (0.35 + 0.65 * f) * appear));
    }
    if (drain < 1) put(hc, hr, g(t > w.tLand ? '°' : 'o'), mixc(DARK, C.foam, appear * (1 - drain)));
    if (t > w.tLand) {
      // the splash
      const sp = clamp01((t - w.tLand) / 320);
      for (const dx of [-2, -1, 1, 2])
        if (hash(hc + dx, Math.floor(w.tLand)) > 0.35) put(hc + dx * (1 + Math.round(sp)), hr - (Math.abs(dx) === 1 ? 1 : 0), g(sp < 0.5 ? '°' : '.'), mixc(C.foam, DARK, sp));
    }
  };

  // ---- 1. the beam: light out of the doorway onto sandy ground
  if (beamK > 0) {
    const x0 = sc.c0 + D.hinge + W * cosT, x1 = sc.c0 + D.leafRight + 1; // the opening now
    const cx = (x0 + x1) / 2, half0 = (x1 - x0) / 2;
    for (let r = sill - 1; r < rows; r++) {
      const dy = r + 0.5 - sill;
      const half = half0 + Math.max(0, dy) * 0.8;
      for (let c = Math.floor(cx - half * 1.4); c <= Math.ceil(cx + half * 1.4); c++) {
        const ax = Math.abs(c + 0.5 - cx);
        const I = beamK * (0.3 + 0.7 * Math.exp(-Math.max(0, dy) / (D.rows * 0.32))) * smooth(clamp01((half * 1.4 - ax) / (half * 0.7)));
        if (I < 0.05) continue;
        const n = hash(c - sc.c0, r - r0);
        const base = mixc(C.sand, C.sandOuter, vnoise(c / 5, r / 3));
        const cc = mixc(DARK, mixc(base, C.light, 0.25), Math.min(1, I * 1.15));
        put(c, r, g(n > 0.86 ? ':' : n > 0.6 ? '·' : n > 0.45 ? ',' : n > 0.4 ? '°' : '.'), mixc(cc, C.sandGrain, 0.3 * I), pack(mixc(DARK, cc, 0.6)));
      }
    }
  }

  // ---- 2. the door: frame and ground (and the leaf, until it opens), built bottom up
  for (const k of D.cells) {
    const i = k.r * D.cols + k.c;
    const born = sc.born[i];
    if (t < born) continue;
    if (k.part === 'leaf' && openK > 0) continue; // the swing draws it
    const c = sc.c0 + k.c, r = r0 + k.r;
    const e = (t - born) / EMERGE;
    if (e < 1) {
      if (reduced) put(c, r, g(k.ch), mixc(DARK, k.rgb, e));
      else if (e < 0.45) {
        // the wet front: water, shimmering, coming up out of the dark
        const w = e / 0.45;
        const gl = hash(k.c + Math.floor(t / 140), k.r) > 0.5 ? '≈' : '~';
        put(c, r, g(gl), mixc(DARK, mixc(C.shallow, C.foam, 0.35 * (1 - w)), easeOutCubic(w)));
      } else {
        // the water sets into the door's own glyph and colour
        const w = smooth((e - 0.45) / 0.55);
        put(c, r, g(k.ch), mixc(mixc(C.shallow, C.foam, 0.2), mixc(k.rgb, WHITE, 0.3), w));
      }
      continue;
    }
    let rgb = mixc(k.rgb, WHITE, 0.3 * clamp01(1 - (t - born - EMERGE) / SETTLE));
    // the light from the doorway on the frame's inner edge
    if (openFrac > 0 && k.part === 'frame' && k.c > D.leafRight && k.c <= D.leafRight + 3 && k.r >= D.leafTop - 1)
      rgb = mixc(rgb, C.light, 0.35 * openFrac * (1 - (k.c - D.leafRight - 1) / 3));
    put(c, r, g(k.ch), rgb);
  }

  // ---- 2b. the water strings, falling onto the door's foot
  if (!reduced) for (const w of sc.strings) drawString(w);

  if (openK <= 0) return;
  // ---- 3. the doorway: the sea and the island, where the leaf was
  const lift = clamp01(openK * 8);
  for (let r = D.leafTop; r <= D.leafBottom; r++)
    for (let c = D.hinge; c <= D.leafRight; c++) {
      if (!D.leaf[r * D.cols + c]) continue;
      const p = interior(sc, (c - D.hinge + 0.5) / W, (r - D.leafTop + 0.5) / (D.leafBottom + 1 - D.leafTop), t);
      const cc = mixc(DARK, p.c, lift);
      put(sc.c0 + c, r0 + r, p.ch, mixc(cc, WHITE, 0.3 * lift), pack(mul(cc, 0.72)));
    }
  // ---- 4. the leaf, swung toward the viewer: narrower, its free edge taller and darker
  const Wn = W * cosT;
  const H = D.leafBottom + 1 - D.leafTop;
  const column = (x: number, srcC: number, k: number, edge: boolean) => {
    const scale = 1 + 0.12 * sinT * k;
    const shade = 1 - 0.38 * sinT * k;
    for (let y = 0; y < Math.ceil(H * scale); y++) {
      const srcR = D.leafTop + Math.floor((y + 0.5) / scale);
      if (srcR > D.leafBottom || !D.leaf[srcR * D.cols + srcC]) continue;
      const cell = D.at[srcR * D.cols + srcC];
      if (edge) put(sc.c0 + D.hinge + x, r0 + D.leafTop + y, g('|'), mul(cell ? cell.rgb : C.grassDark, 0.5), NONE);
      else if (cell) put(sc.c0 + D.hinge + x, r0 + D.leafTop + y, g(cell.ch), mul(cell.rgb, shade), NONE);
    }
  };
  const n = Math.max(1, Math.round(Wn));
  for (let x = 0; x < n; x++) {
    const srcC = Math.min(D.leafRight, D.hinge + Math.floor(((x + 0.5) / n) * W));
    column(x, srcC, (x + 0.5) / n, false);
  }
  // its thickness, seen as it turns
  if (sinT > 0.25) column(n, D.leafRight, 1, true);
}
