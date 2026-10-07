// ---------------------------------------------------------------------------
// REFERENCES — marked pixel art the crafting generator builds items from.
//
// A reference is a small cleaned picture (art.png) plus ref.json: which pixel
// belongs to which named PART (hull, sail, flag …, each with a material zone),
// ANCHORS (named points) and AREAS (boxes where decorations may go, or where
// a detail with no reference may be drawn). Made with the Glyph Generator
// (tools/glyph-ref/), stored in src/data/refs/<id>/.
//
// Roles:
//   body        a whole object (a boat): the base of a craft
//   part        a swappable part (a sail): replaces the body's part with the
//               same name, fitted into where that part was
//   decoration  a small extra (a flag, a gem): drawn into a decoration area
//
// Everything here is pure (pixels in, pixels out), so the tool's preview and
// the game's crafting compose exactly the same way; bake.ts turns the result
// into glyphs.
// ---------------------------------------------------------------------------
import { lum, type Img, type RGB } from './bake';

export type Zone = 'primary' | 'secondary' | 'trim' | 'fixed';
export const ZONES: Zone[] = ['primary', 'secondary', 'trim', 'fixed'];
export type RefRole = 'body' | 'part' | 'decoration';
export type GameCategory = 'plant' | 'pets' | 'clothing' | 'vehicle' | 'food' | 'utensils';
export const GAME_CATEGORIES: GameCategory[] = ['vehicle', 'pets', 'utensils', 'plant', 'clothing', 'food'];

export interface RefPart {
  name: string; // from the category vocabulary: hull, sail, mast …
  zone: Zone; // fixed = never recoloured
}
export interface RefAnchor {
  name: string;
  x: number; // 0..1 of the art
  y: number;
}
export interface RefArea {
  name: string;
  type: 'decoration' | 'detail';
  x: number; // top-left, 0..1 of the art
  y: number;
  w: number;
  h: number;
  accepts: string[]; // decoration tags (decoration areas)
  part?: string; // detail drawn only on this part's pixels (clip)
}
export interface RefDoc {
  version: 1;
  id: string;
  title: string;
  role: RefRole;
  category: string; // vocabulary category: boat, watering-can, pet …
  gameCategory: GameCategory;
  partType?: string; // role part: the body part it replaces
  tags: string[];
  description: string;
  sizeBand: 'small' | 'medium' | 'large';
  w: number; // art size in pixels
  h: number;
  parts: RefPart[];
  mask: number[]; // run-length: [partIndex + 1 (0 = none), count, …] over w*h pixels
  anchors: RefAnchor[];
  areas: RefArea[];
}

// ---- mask run-length ---------------------------------------------------------------
export function encodeMask(m: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < m.length) {
    const v = m[i];
    let n = 1;
    while (i + n < m.length && m[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}
export function decodeMask(rle: number[], size: number): Uint8Array {
  const m = new Uint8Array(size);
  let p = 0;
  for (let i = 0; i + 1 < rle.length && p < size; i += 2) {
    m.fill(rle[i], p, Math.min(size, p + rle[i + 1]));
    p += rle[i + 1];
  }
  return m;
}

// ---- a working picture: pixels + which named part every pixel is --------------------
export interface Layer {
  img: Img;
  part: string[]; // per pixel: part name ('' = none / transparent)
}

export function layerOf(img: Img, ref: RefDoc): Layer {
  const m = decodeMask(ref.mask, img.w * img.h);
  const part = Array.from(m, (v, i) => (img.data[i * 4 + 3] > 127 && v ? ref.parts[v - 1]?.name ?? '' : img.data[i * 4 + 3] > 127 ? 'other' : ''));
  return { img, part };
}

const newImg = (w: number, h: number): Img => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });

export function partBox(l: Layer, name: string) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < l.part.length; i++)
    if (l.part[i] === name) {
      const x = i % l.img.w, y = (i / l.img.w) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---- recolour a part to a material, keeping the art's shading ----------------------
// Each pixel keeps its brightness relative to the part's mean; the hue and
// saturation come from the target. strength < 1 keeps a little of the
// original colour so materials don't look flat.
export function recolour(l: Layer, name: string, target: RGB, strength = 0.85): void {
  const d = l.img.data;
  let sum = 0, n = 0;
  for (let i = 0; i < l.part.length; i++)
    if (l.part[i] === name) {
      sum += lum([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
      n++;
    }
  if (!n) return;
  const mean = Math.max(1, sum / n);
  for (let i = 0; i < l.part.length; i++) {
    if (l.part[i] !== name) continue;
    const k = lum([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]) / mean;
    for (let c = 0; c < 3; c++) {
      const v = Math.min(255, target[c] * k);
      d[i * 4 + c] = d[i * 4 + c] * (1 - strength) + v * strength;
    }
  }
}

// draw `src` scaled into box (contain, centred horizontally, bottom-aligned,
// or with its `attach` anchor on `at`), onto a layer; pixels take `as` as
// their part name (or the source's own names when `as` is undefined)
function drawInto(
  dst: Layer,
  src: Layer,
  box: { x: number; y: number; w: number; h: number },
  opts: { as?: string; clip?: (i: number) => boolean; attach?: { sx: number; sy: number; dx: number; dy: number }; stretch?: boolean } = {},
) {
  // contain (keep proportions, centred, bottom-aligned) or stretch to the box
  const kx = opts.stretch ? box.w / src.img.w : Math.min(box.w / src.img.w, box.h / src.img.h);
  const ky = opts.stretch ? box.h / src.img.h : kx;
  const w = Math.max(1, Math.round(src.img.w * kx)), h = Math.max(1, Math.round(src.img.h * ky));
  let ox = box.x + Math.round((box.w - w) / 2), oy = box.y + box.h - h;
  if (opts.attach) {
    ox = Math.round(opts.attach.dx - opts.attach.sx * w);
    oy = Math.round(opts.attach.dy - opts.attach.sy * h);
  }
  const D = dst.img, S = src.img;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const tx = ox + x, ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= D.w || ty >= D.h) continue;
      const sx = Math.min(S.w - 1, Math.floor(x / kx)), sy = Math.min(S.h - 1, Math.floor(y / ky));
      const si = sy * S.w + sx, di = ty * D.w + tx;
      if (S.data[si * 4 + 3] < 128) continue;
      if (opts.clip && !opts.clip(di)) continue;
      for (let c = 0; c < 4; c++) D.data[di * 4 + c] = S.data[si * 4 + c];
      D.data[di * 4 + 3] = 255;
      dst.part[di] = opts.as ?? (src.part[si] || 'other');
    }
}

// a copy of a layer on a bigger canvas (room for parts that are larger than
// what they replace)
function padded(l: Layer, pad: number): Layer {
  const w = l.img.w + pad * 2, h = l.img.h + pad * 2;
  const img = newImg(w, h);
  const part = new Array<string>(w * h).fill('');
  for (let y = 0; y < l.img.h; y++)
    for (let x = 0; x < l.img.w; x++) {
      const si = y * l.img.w + x, di = (y + pad) * w + x + pad;
      for (let c = 0; c < 4; c++) img.data[di * 4 + c] = l.img.data[si * 4 + c];
      part[di] = l.part[si];
    }
  return { img, part };
}

// crop to the drawn pixels
export function trim(l: Layer): Layer {
  let x0 = l.img.w, y0 = l.img.h, x1 = -1, y1 = -1;
  for (let i = 0; i < l.part.length; i++)
    if (l.img.data[i * 4 + 3] > 127) {
      const x = i % l.img.w, y = (i / l.img.w) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (x1 < 0) return l;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const img = newImg(w, h);
  const part = new Array<string>(w * h).fill('');
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (y + y0) * l.img.w + x + x0, di = y * w + x;
      for (let c = 0; c < 4; c++) img.data[di * 4 + c] = l.img.data[si * 4 + c];
      part[di] = l.part[si];
    }
  return { img, part };
}

export function mirror(l: Layer): Layer {
  const { w, h } = l.img;
  const img = newImg(w, h);
  const part = new Array<string>(w * h).fill('');
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = y * w + x, di = y * w + (w - 1 - x);
      for (let c = 0; c < 4; c++) img.data[di * 4 + c] = l.img.data[si * 4 + c];
      part[di] = l.part[si];
    }
  return { img, part };
}

// ---- the recipe a craft is built from, step by step ----------------------------------
export interface DetailRegion {
  // the crafting planner's shape vocabulary (craft/spriteConfig.ts), in 0..1
  // of the detail area
  primitive: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation?: number;
  rgb: RGB;
}
export interface Recipe {
  body: { ref: RefDoc; img: Img };
  colours: Record<string, RGB>; // part name -> new colour (the body's and swapped parts')
  swaps: { part: string; ref: RefDoc; img: Img }[]; // a part ref replaces the body's part of that name
  decorations: { ref: RefDoc; img: Img; area: string }[];
  details: { area: string; regions: DetailRegion[] }[];
  mirror?: boolean;
}

// Point-in-shape for the detail painter: the same primitives as the crafting
// planner, in the shape's own local frame (u, v in -1..1).
function inShape(p: string, u: number, v: number): boolean {
  switch (p) {
    case 'rectangle':
    case 'rounded_rectangle':
      return Math.abs(u) <= 1 && Math.abs(v) <= 1 && (p === 'rectangle' || !(Math.abs(u) > 0.7 && Math.abs(v) > 0.7 && (Math.abs(u) - 0.7) ** 2 + (Math.abs(v) - 0.7) ** 2 > 0.09));
    case 'circle':
    case 'ellipse':
    case 'blob':
      return u * u + v * v <= 1;
    case 'diamond':
      return Math.abs(u) + Math.abs(v) <= 1;
    case 'triangle':
      return v >= -1 && v <= 1 && Math.abs(u) <= (v + 1) / 2;
    case 'trapezoid':
      return v >= -1 && v <= 1 && Math.abs(u) <= 0.6 + 0.4 * ((v + 1) / 2);
    case 'semicircle':
      return u * u + v * v <= 1 && v <= 0;
    case 'arc': {
      const r = Math.hypot(u, v);
      return r >= 0.6 && r <= 1 && v <= 0;
    }
    case 'line':
      return Math.abs(v) <= 0.35 && Math.abs(u) <= 1;
    case 'point':
      return u * u + v * v <= 0.6;
    default:
      return Math.abs(u) <= 1 && Math.abs(v) <= 1;
  }
}

function paintDetail(l: Layer, box: { x: number; y: number; w: number; h: number }, regions: DetailRegion[], clipPart?: string) {
  const d = l.img.data;
  for (let py = box.y; py < box.y + box.h; py++)
    for (let px = box.x; px < box.x + box.w; px++) {
      if (px < 0 || py < 0 || px >= l.img.w || py >= l.img.h) continue;
      const i = py * l.img.w + px;
      if (d[i * 4 + 3] < 128) continue; // only on the object
      if (clipPart && l.part[i] !== clipPart) continue;
      const fx = (px + 0.5 - box.x) / box.w, fy = (py + 0.5 - box.y) / box.h;
      for (const r of regions) {
        const rad = (-(r.rotation ?? 0) * Math.PI) / 180;
        const dx = fx - r.cx, dy = fy - r.cy;
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad), ry = dx * Math.sin(rad) + dy * Math.cos(rad);
        const u = rx / Math.max(0.02, r.width / 2), v = ry / Math.max(0.02, r.height / 2);
        if (!inShape(r.primitive, u, v)) continue;
        const light = 1 - ((u + 1) / 2 + (v + 1) / 2) / 4; // light from the top-left
        for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.min(255, r.rgb[c] * (0.75 + light * 0.4));
        l.part[i] = 'detail';
      }
    }
}

const areaBox = (a: RefArea, w: number, h: number, ox = 0, oy = 0) => ({
  x: ox + Math.round(a.x * w),
  y: oy + Math.round(a.y * h),
  w: Math.max(1, Math.round(a.w * w)),
  h: Math.max(1, Math.round(a.h * h)),
});

// Build the craft's picture: body -> colours -> swapped parts (fitted where
// the body's own part was, recoloured too) -> decorations in their areas ->
// details with no reference painted inside their areas -> mirror -> trim.
export function compose(r: Recipe): Layer {
  const base = layerOf(r.body.img, r.body.ref);
  const pad = Math.round(Math.max(base.img.w, base.img.h) * 0.25);
  let l = padded(base, pad);
  const W0 = r.body.ref.w, H0 = r.body.ref.h;

  for (const s of r.swaps) {
    const box = partBox(l, s.part);
    if (!box) continue;
    // remove the body's own part, then fit the new one into its box
    for (let i = 0; i < l.part.length; i++)
      if (l.part[i] === s.part) {
        l.img.data[i * 4 + 3] = 0;
        l.part[i] = '';
      }
    const src = trim(layerOf(s.img, s.ref));
    // the new part takes the old part's place and size, BEHIND the body's
    // other parts (a new sail stays behind the mast)
    drawInto(l, src, box, { as: s.part, stretch: true, clip: (i) => l.img.data[i * 4 + 3] < 128 });
  }
  for (const [name, rgb] of Object.entries(r.colours)) {
    const z = r.body.ref.parts.find((p) => p.name === name)?.zone ?? r.swaps.find((s) => s.part === name)?.ref.parts[0]?.zone;
    if (z === 'fixed') continue;
    recolour(l, name, rgb);
  }
  for (const dcr of r.decorations) {
    const a = r.body.ref.areas.find((x) => x.name === dcr.area);
    if (!a) continue;
    drawInto(l, layerOf(dcr.img, dcr.ref), areaBox(a, W0, H0, pad, pad), { as: `decoration:${dcr.ref.id}` });
  }
  for (const dt of r.details) {
    const a = r.body.ref.areas.find((x) => x.name === dt.area);
    if (!a) continue;
    paintDetail(l, areaBox(a, W0, H0, pad, pad), dt.regions, a.part);
  }
  if (r.mirror) l = mirror(l);
  return trim(l);
}

// The art as an Img with every part kept (no recipe): for previews
export function plainLayer(img: Img, ref: RefDoc): Layer {
  return layerOf(img, ref);
}
