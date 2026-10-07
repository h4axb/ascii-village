// ---------------------------------------------------------------------------
// THE BAKER: a picture (RGBA pixels) -> a grid of glyph cells, no LLM.
//
// Pure: no DOM, so the tool page and any later script can share it. The glyph
// bitmaps it matches against come from glyphAtlas.ts (rendered in the game's
// font), passed in.
//
// Why not just "average colour -> brightness -> ramp glyph" (what the first
// hand conversions did)? That blurs every edge and throws away the shape. Here:
//   1. the background is removed (alpha, or a flood fill from the corners);
//   2. the grid is sized from a target SIGN COUNT (how many glyphs are drawn);
//   3. each cell is sampled at sub-cell resolution: its colour is the dominant
//      colour (not the mean), and where it holds two clearly different colours
//      (an edge) the glyph is chosen by SHAPE, matching the cell's light/dark
//      pattern against every candidate glyph's bitmap;
//   4. flat cells get a density-ramp glyph by their brightness in the object;
//   5. outline, enclosed holes, tone count, contrast, saturation and the lift
//      for the game's dark per-cell backing are applied last.
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];

export interface Img {
  w: number;
  h: number;
  data: Uint8ClampedArray; // RGBA
}

// A glyph's look in the game: the glyph drawn twice side by side (columns are
// doubled in the game) in one 2ch x 1-line cell, as ink coverage per sub-cell.
export interface GlyphShape {
  ch: string;
  bits: Float32Array; // SUB_W x SUB_H, 0..1
  ink: number; // mean coverage
}
export const SUB_W = 8;
export const SUB_H = 6;

export interface BakeOptions {
  signs: number; // target number of drawn glyphs (0 = use cols)
  cols: number; // used when signs = 0
  bg: 'auto' | 'alpha' | 'none';
  bgTolerance: number; // 0..120 colour distance for the corner flood fill
  coverage: number; // 0..1: share of a cell that must be object to draw it
  edgeContrast: number; // colour distance between a cell's two colours that makes it an edge
  shapeMatch: boolean; // edges get a glyph by shape
  ramp: string; // flat cells, sparse -> dense
  edgeGlyphs: string; // extra glyphs allowed on edges
  tones: number; // colours in the result (<= 62)
  contrast: number; // 1 = as is
  saturation: number; // 1 = as is
  lift: number; // 1 = as is; >1 brightens so it reads true over the game's dark backing
  outline: number; // 0..1 darken the outer ring of cells
  fillHoles: boolean;
  aspect: number; // cell width / height of the sheet: 1 = the svg's square cells (the game asset stretches rows itself)
}

export const DEFAULTS: BakeOptions = {
  signs: 600,
  cols: 32,
  bg: 'auto',
  bgTolerance: 40,
  coverage: 0.4,
  edgeContrast: 70,
  shapeMatch: true,
  ramp: '·:¬=+†‡*¤§%&¥Ø@',
  edgeGlyphs: "/\\|_-()^v<>'`,.;!~",
  tones: 48,
  contrast: 1.1,
  saturation: 1.05,
  lift: 1.25,
  outline: 0.25,
  fillHoles: true,
  aspect: 1,
};

export const SIGN_PRESETS: { name: string; signs: number }[] = [
  { name: 'simple', signs: 200 },
  { name: 'middle', signs: 600 },
  { name: 'detailed', signs: 1600 },
];

export interface Cell {
  ch: string;
  rgb: RGB;
}
export interface Baked {
  cols: number;
  rows: number;
  cells: (Cell | null)[]; // row-major
  signs: number;
}

// ---- colour helpers ---------------------------------------------------------
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const clamp = (v: number) => Math.max(0, Math.min(255, v));
export const hex = (c: RGB) => '#' + c.map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('');

// ---- 1. background ------------------------------------------------------------
// A mask of object pixels: alpha, and (auto) a flood fill from the border
// over pixels close to the corner colours — a plain or white backdrop.
export function objectMask(img: Img, o: Pick<BakeOptions, 'bg' | 'bgTolerance'>): Uint8Array {
  const { w, h, data } = img;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  if (o.bg !== 'auto') return m;
  const px = (i: number): RGB => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const seeds = [0, w - 1, (h - 1) * w, h * w - 1].filter((i) => m[i]);
  if (!seeds.length) return m; // already transparent around
  const refs = seeds.map(px);
  const near = (i: number) => refs.some((r) => dist(px(i), r) <= o.bgTolerance);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (!m[i] || !near(i)) continue;
    m[i] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  return m;
}

function bbox(m: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1, n };
}

// ---- 2. grid size from the sign count ----------------------------------------
// cells drawn ~ cols * rows * fill (the share of the box the object covers),
// rows = cols * (box h / box w) * aspect (a drawn cell is wider than tall).
function gridFor(boxW: number, boxH: number, fill: number, o: BakeOptions) {
  if (!o.signs) {
    const cols = Math.max(2, Math.round(o.cols));
    return { cols, rows: Math.max(1, Math.round((cols * boxH * o.aspect) / boxW)) };
  }
  const cols = Math.sqrt((o.signs * boxW) / (boxH * o.aspect * Math.max(0.05, fill)));
  const c = Math.max(2, Math.round(cols));
  return { cols: c, rows: Math.max(1, Math.round((c * boxH * o.aspect) / boxW)) };
}

// ---- 3. sampling ------------------------------------------------------------------
interface Sample {
  cover: number; // share of object sub-samples
  colors: RGB[]; // object sub-sample colours
  pos: number[]; // their sub-cell index (y * SUB_W + x)
}
function sampleCell(img: Img, m: Uint8Array, x0: number, y0: number, cw: number, ch: number): Sample {
  const colors: RGB[] = [];
  const pos: number[] = [];
  for (let sy = 0; sy < SUB_H; sy++)
    for (let sx = 0; sx < SUB_W; sx++) {
      const x = Math.min(img.w - 1, Math.floor(x0 + ((sx + 0.5) * cw) / SUB_W));
      const y = Math.min(img.h - 1, Math.floor(y0 + ((sy + 0.5) * ch) / SUB_H));
      const i = y * img.w + x;
      if (!m[i]) continue;
      colors.push([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]);
      pos.push(sy * SUB_W + sx);
    }
  return { cover: colors.length / (SUB_W * SUB_H), colors, pos };
}

// two colour clusters (k-means, k=2) of a cell's sub-samples
function split2(cs: RGB[]) {
  let a = cs[0], b = cs[0], best = -1;
  for (const c of cs) {
    const d = dist(c, cs[0]);
    if (d > best) {
      best = d;
      b = c;
    }
  }
  best = -1;
  for (const c of cs) {
    const d = dist(c, b);
    if (d > best) {
      best = d;
      a = c;
    }
  }
  let which: number[] = [];
  for (let it = 0; it < 4; it++) {
    which = cs.map((c) => (dist(c, a) <= dist(c, b) ? 0 : 1));
    const mean = (k: number): RGB => {
      const s = [0, 0, 0];
      let n = 0;
      cs.forEach((c, i) => {
        if (which[i] !== k) return;
        s[0] += c[0];
        s[1] += c[1];
        s[2] += c[2];
        n++;
      });
      return n ? [s[0] / n, s[1] / n, s[2] / n] : k ? b : a;
    };
    a = mean(0);
    b = mean(1);
  }
  const na = which.filter((v) => v === 0).length;
  return { a, b, which, na, nb: cs.length - na };
}

// the most common colour (coarse bins), averaged within its bin: crisp, not muddy
function dominant(cs: RGB[]): RGB {
  const bins = new Map<number, { n: number; s: number[] }>();
  for (const c of cs) {
    const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
    const e = bins.get(k) ?? { n: 0, s: [0, 0, 0] };
    e.n++;
    e.s[0] += c[0];
    e.s[1] += c[1];
    e.s[2] += c[2];
    bins.set(k, e);
  }
  let top = { n: 0, s: [0, 0, 0] };
  for (const e of bins.values()) if (e.n > top.n) top = e;
  return [top.s[0] / top.n, top.s[1] / top.n, top.s[2] / top.n];
}

// the glyph whose bitmap best matches a light/dark pattern (Pearson), with
// a nudge toward the pattern's own ink share
// How much a light/dark pattern is a SHAPE (an edge, a stroke) rather than
// noise (dithering, texture): the share of neighbouring sub-cells that agree.
// A clean edge is ~0.85+, a checkerboard dither ~0.3.
function coherence(p: Float32Array): number {
  let same = 0, n = 0;
  for (let y = 0; y < SUB_H; y++)
    for (let x = 0; x < SUB_W; x++) {
      const v = p[y * SUB_W + x] > 0.5;
      if (x + 1 < SUB_W) {
        same += +(v === (p[y * SUB_W + x + 1] > 0.5));
        n++;
      }
      if (y + 1 < SUB_H) {
        same += +(v === (p[(y + 1) * SUB_W + x] > 0.5));
        n++;
      }
    }
  return same / n;
}

function matchShape(pattern: Float32Array, shapes: GlyphShape[]): GlyphShape | null {
  if (coherence(pattern) < 0.78) return null; // texture, not a shape: the ramp handles it
  const n = pattern.length;
  let pm = 0;
  for (let i = 0; i < n; i++) pm += pattern[i];
  pm /= n;
  let pv = 0;
  for (let i = 0; i < n; i++) pv += (pattern[i] - pm) ** 2;
  if (pv < 1e-6) return null;
  let best: GlyphShape | null = null, bestS = -Infinity;
  for (const g of shapes) {
    let cov = 0, gv = 0;
    for (let i = 0; i < n; i++) {
      const d = g.bits[i] - g.ink;
      cov += (pattern[i] - pm) * d;
      gv += d * d;
    }
    if (gv < 1e-6) continue;
    const s = cov / Math.sqrt(pv * gv) - 0.6 * Math.abs(g.ink - pm);
    if (s > bestS) {
      bestS = s;
      best = g;
    }
  }
  return bestS > 0.4 ? best : null;
}

// ---- 5. colour finishing ---------------------------------------------------------
function grade(c: RGB, o: BakeOptions, meanLum: number): RGB {
  let [r, g, b] = c;
  // contrast around the object's own mean brightness
  r = meanLum + (r - meanLum) * o.contrast;
  g = meanLum + (g - meanLum) * o.contrast;
  b = meanLum + (b - meanLum) * o.contrast;
  const l = lum([r, g, b]);
  r = l + (r - l) * o.saturation;
  g = l + (g - l) * o.saturation;
  b = l + (b - l) * o.saturation;
  return [clamp(r * o.lift), clamp(g * o.lift), clamp(b * o.lift)];
}

// median-cut palette of `n` tones; returns a mapper colour -> tone
export function medianCut(colors: RGB[], n: number): (c: RGB) => RGB {
  const uniq = [...new Map(colors.map((c) => [c.map(Math.round).join(','), c.map(Math.round) as RGB])).values()];
  if (uniq.length <= n) return (c) => c.map(Math.round) as RGB;
  let boxes: RGB[][] = [uniq];
  while (boxes.length < n) {
    let bi = -1, bestRange = -1, axis = 0;
    boxes.forEach((bx, i) => {
      if (bx.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255, hi = 0;
        for (const c of bx) {
          lo = Math.min(lo, c[a]);
          hi = Math.max(hi, c[a]);
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          bi = i;
          axis = a;
        }
      }
    });
    if (bi < 0) break;
    const bx = boxes[bi].slice().sort((p, q) => p[axis] - q[axis]);
    const mid = bx.length >> 1;
    boxes.splice(bi, 1, bx.slice(0, mid), bx.slice(mid));
  }
  const pal = boxes.map((bx) => {
    const s = [0, 0, 0];
    for (const c of bx) {
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
    }
    return [s[0] / bx.length, s[1] / bx.length, s[2] / bx.length].map(Math.round) as RGB;
  });
  const cache = new Map<string, RGB>();
  return (c) => {
    const k = c.map(Math.round).join(',');
    let t = cache.get(k);
    if (!t) {
      let bd = Infinity;
      for (const p of pal) {
        const d = dist(p, c);
        if (d < bd) {
          bd = d;
          t = p;
        }
      }
      cache.set(k, t!);
    }
    return t!;
  };
}

// ---- the whole bake ------------------------------------------------------------------
export function bake(img: Img, o: BakeOptions, shapes: GlyphShape[]): Baked {
  const m = objectMask(img, o);
  const box = bbox(m, img.w, img.h);
  if (!box) return { cols: 0, rows: 0, cells: [], signs: 0 };
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const { cols, rows } = gridFor(bw, bh, box.n / (bw * bh), o);
  const cw = bw / cols, chh = bh / rows;

  const rampShapes = [...o.ramp].map((ch) => shapes.find((s) => s.ch === ch)).filter(Boolean) as GlyphShape[];
  const allowed = new Set([...o.ramp, ...o.edgeGlyphs]);
  const edgeShapes = shapes.filter((s) => allowed.has(s.ch));

  // first pass: what each cell holds
  type Raw = { rgb: RGB; edge: GlyphShape | null; lumv: number } | null;
  const raw: Raw[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const s = sampleCell(img, m, box.x0 + c * cw, box.y0 + r * chh, cw, chh);
      if (s.cover < o.coverage || !s.colors.length) {
        raw.push(null);
        continue;
      }
      let rgb = dominant(s.colors);
      let edge: GlyphShape | null = null;
      if (o.shapeMatch && s.colors.length >= 6) {
        const sp = split2(s.colors);
        const minor = Math.min(sp.na, sp.nb) / s.colors.length; // both colours must really be there
        const partial = s.cover < 0.92;
        if ((dist(sp.a, sp.b) >= o.edgeContrast && minor >= 0.2) || partial) {
          // ink = the lighter colour (the game draws a glyph light on its own
          // dark backing); off-object sub-cells count as dark
          const lightA = lum(sp.a) >= lum(sp.b);
          const pattern = new Float32Array(SUB_W * SUB_H);
          s.pos.forEach((p, i) => {
            pattern[p] = partial && dist(sp.a, sp.b) < o.edgeContrast ? 1 : (sp.which[i] === 0) === lightA ? 1 : 0;
          });
          edge = matchShape(pattern, edgeShapes);
          if (edge && !partial) rgb = lightA ? sp.a : sp.b;
        }
      }
      raw.push({ rgb, edge, lumv: lum(rgb) });
    }

  // enclosed holes: empty cells boxed in by the object on all four sides
  if (o.fillHoles) {
    const at = (r: number, c: number) => (r >= 0 && r < rows && c >= 0 && c < cols ? raw[r * cols + c] : null);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (raw[r * cols + c]) continue;
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        let enclosed = true;
        let neighbour: RGB | null = null;
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc, hit = false;
          while (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
            const v = at(rr, cc);
            if (v) {
              hit = true;
              if (!neighbour || lum(v.rgb) < lum(neighbour)) neighbour = v.rgb;
              break;
            }
            rr += dr;
            cc += dc;
          }
          if (!hit) enclosed = false;
        }
        if (enclosed && neighbour) raw[r * cols + c] = { rgb: neighbour.map((v) => v * 0.7) as RGB, edge: null, lumv: lum(neighbour) * 0.7 };
      }
  }

  // brightness range inside the object, for the flat cells' ramp
  const lv = raw.filter(Boolean).map((v) => v!.lumv).sort((a, b) => a - b);
  const lo = lv[Math.floor(lv.length * 0.03)] ?? 0;
  const hi = lv[Math.floor(lv.length * 0.97)] ?? 255;
  const meanLum = lv.reduce((a, b) => a + b, 0) / Math.max(1, lv.length);

  // outline: object cells next to an empty cell
  const empty = (r: number, c: number) => r < 0 || r >= rows || c < 0 || c >= cols || !raw[r * cols + c];
  const graded = raw.map((v, i) => {
    if (!v) return null;
    let g = grade(v.rgb, o, meanLum);
    const r = (i / cols) | 0, c = i % cols;
    if (o.outline > 0 && (empty(r - 1, c) || empty(r + 1, c) || empty(r, c - 1) || empty(r, c + 1)))
      g = g.map((x) => x * (1 - o.outline)) as RGB;
    return g;
  });
  const tone = medianCut(graded.filter(Boolean) as RGB[], Math.max(2, Math.min(62, o.tones)));

  const cells: (Cell | null)[] = raw.map((v, i) => {
    if (!v) return null;
    let ch: string;
    if (v.edge) ch = v.edge.ch;
    else {
      const t = Math.max(0, Math.min(0.999, (v.lumv - lo) / Math.max(1, hi - lo)));
      ch = rampShapes.length ? rampShapes[Math.floor(t * rampShapes.length)].ch : [...o.ramp][Math.floor(t * [...o.ramp].length)];
    }
    return { ch, rgb: tone(graded[i]!) };
  });
  return { cols, rows, cells, signs: cells.filter(Boolean).length };
}

// Auto zones: the drawn cells clustered by colour into `k` groups (k-means on
// RGB, seeded by brightness), as a first guess at the parts.
export function autoZones(b: Baked, k: number): (number | null)[] {
  const idx = b.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return b.cells.map(() => null);
  const cs = idx.map((i) => b.cells[i]!.rgb);
  const sorted = [...cs].sort((a, c) => lum(a) - lum(c));
  let cent: RGB[] = Array.from({ length: k }, (_, j) => sorted[Math.floor(((j + 0.5) / k) * sorted.length)]);
  let asg: number[] = [];
  for (let it = 0; it < 8; it++) {
    asg = cs.map((c) => {
      let bj = 0, bd = Infinity;
      cent.forEach((p, j) => {
        const d = dist(p, c);
        if (d < bd) {
          bd = d;
          bj = j;
        }
      });
      return bj;
    });
    cent = cent.map((p, j) => {
      const mine = cs.filter((_, i) => asg[i] === j);
      if (!mine.length) return p;
      return [0, 1, 2].map((a) => mine.reduce((s, c) => s + c[a], 0) / mine.length) as RGB;
    });
  }
  const out: (number | null)[] = b.cells.map(() => null);
  idx.forEach((i, n) => (out[i] = asg[n]));
  return out;
}
