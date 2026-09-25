// ---------------------------------------------------------------------------
// The deterministic, LLM-free glyph renderer. Takes a validated/normalized
// list of RegionSpec placements (see spriteConfig.ts) and renders them into
// glyph/colour grids. Ported from two Python reference tools shown this
// session:
//   - craft_glyph.py: Item._shade/_place (3-band shading, fixed upper-left
//     light source, per-cell jitter), rect()/blob() shape primitives.
//   - glyphify.py: cells_to_signs' luminance -> ramp-index mapping.
//
// Two glyph-selection modes, chosen by PRIMITIVE (not role — role is purely
// a budget/compression hint, see spriteValidate.ts):
//   SURFACE (rect/ellipse/blob): filled volume shapes. Per-cell luminance
//     (after 3-band shading) maps through the ramp, with jitter applied to
//     the ramp-index lookup ONLY (never the stored/palette colour), so flat
//     regions don't collapse to one repeated glyph without growing the
//     palette.
//   FEATURE (line/point/arc): sparse marks. No luminance ramp at all — one
//     flat resolved colour plus a glyph chosen by concrete geometric rule
//     (never by the LLM, never by luminance).
//
// No percentile-stretch (unlike glyphify.py): t_light is already a
// well-scaled 0..1 value by construction (computed from a cell's position
// within its OWN region's bounds), and the ramp-index formula runs per-cell
// from that cell's own absolute luminance, not a sprite-wide min/max — a
// `fire` region reads bright and a `metal` region reads mid-tone independent
// of what else is in the sprite, which is the correct/intended behaviour.
// ---------------------------------------------------------------------------

import type { FaceMark, RasterRegion, RegionBounds, ShapePrimitive } from './spriteConfig';
import { FEATURE_PRIMITIVES } from './spriteConfig';
import { FEATURE_GLYPHS, MATERIALS, RAMP_GAMMA, RAMP_LIFT } from './materials';

export interface RenderedSprite {
  lines: string[];
  colors: string[];
  palette: Record<string, string>;
}

// ---- deterministic per-item noise (mulberry32-style, matching llm.ts's own
// seededRand PATTERN — duplicated, not imported: craft/ cannot import from
// llm.ts, see spriteConfig.ts's own note on the circular-import boundary) ----

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function cellNoise(seedKey: string, a: number, b: number): number {
  let h = (hashStr(seedKey) ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 1 | h);
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
  const u = ((h ^ (h >>> 14)) >>> 0) / 4294967296; // [0, 1)
  return u * 2 - 1; // [-1, 1)
}

function hash01(seedKey: string, a: number, b: number): number {
  return (cellNoise(seedKey, a, b) + 1) / 2; // [0, 1)
}

// Smooth bilinear-interpolated value noise (same shape as bridge.mjs/
// genutils.mjs's vnoise, duplicated locally — craft/ can't import the
// Node-only scripts/ tree). Used to bias GLYPH TEXTURE choice, kept fully
// separate from the shading/luminance computation below (see the module
// header note on why that separation is the point).
function vnoise(seedKey: string, x: number, y: number, freq: number): number {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const h00 = hash01(seedKey, x0, y0);
  const h10 = hash01(seedKey, x0 + 1, y0);
  const h01 = hash01(seedKey, x0, y0 + 1);
  const h11 = hash01(seedKey, x0 + 1, y0 + 1);
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const top = h00 + (h10 - h00) * sx;
  const bot = h01 + (h11 - h01) * sx;
  return top + (bot - top) * sy; // [0, 1)
}

// ---- material resolution ----

const HEX_RE = /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i;

function parseHex(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function resolveMaterial(spec: string): [number, number, number] {
  const named = (MATERIALS as Record<string, [number, number, number]>)[spec];
  if (named) return named;
  if (HEX_RE.test(spec)) return parseHex(spec);
  return MATERIALS.stone; // never throws — same "clamp/default, don't crash" philosophy as functions.ts
}

// ---- craft_glyph.py's Item._shade, exact 3-band logic ----

type Band = 'lo' | 'mid' | 'hi';

function shadeBand(tLight: number): Band {
  if (tLight < 0.33) return 'lo';
  if (tLight > 0.66) return 'hi';
  return 'mid';
}

function shade(base: [number, number, number], band: Band): [number, number, number] {
  if (band === 'lo') return base.map((c) => c * 0.62) as [number, number, number];
  if (band === 'hi') return base.map((c) => c + (255 - c) * 0.38) as [number, number, number];
  return base;
}

// ---- texture: glyph choice decoupled from shading (see bridge.mjs's
// stoneGlyph()/stoneBand() split — colour carries depth, a small per-band
// glyph SET carries texture, chosen independently) ----
//
// Ordered subtle-interior -> high-contrast-edge within each band, so the
// same edge-proximity/noise bias below can pick position-in-array rather
// than needing a separate edge-only glyph set.
const BAND_GLYPHS: Record<Band, string[]> = {
  lo: ['·', ':', '¬'],
  mid: ['=', '+', '†', '‡'],
  hi: ['*', '¤', '§', '%', '&'],
};

// ---------------------------------------------------------------------------
// SHARED LOCAL-SPACE TRANSFORM (Stage 2) — every primitive's hit-test,
// lightAt (shading), and edge-proximity (texture bias) runs against this
// ONE transform instead of bespoke per-shape formulas: translate by
// -center, rotate by -rotation (undoing the shape's own rotation), scale by
// 1/(width/2), 1/(height/2). Every primitive becomes a real inequality
// against a unit-ish square/circle in the resulting (u,v) local frame —
// rotation-aware by construction (one place to get right, not twelve), and
// mathematically equivalent to the pre-Stage-2 formulas at rotation=0 (see
// glyphRenderDebug.ts's parity test, which still expects byte-identical ink
// cells for unrotated regions).
// ---------------------------------------------------------------------------

export function toLocal(px: number, py: number, b: RegionBounds, rotation = 0): { u: number; v: number } {
  const cxc = b.x + b.width / 2;
  const cyc = b.y + b.height / 2;
  const dx = px + 0.5 - cxc;
  const dy = py + 0.5 - cyc;
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const hw = Math.max(b.width / 2, 0.5);
  const hh = Math.max(b.height / 2, 0.5);
  return { u: rx / hw, v: ry / hh };
}

// craft_glyph.py's Item._place light formula — fixed upper-left source, no
// simulation — now expressed purely in the shared local frame, so shading
// rotates WITH a rotated shape (the correct/expected visual result).
function lightAt(u: number, v: number): number {
  const rx = (u + 1) / 2;
  const ry = (v + 1) / 2;
  return 1 - (ry + rx) / 2;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// A genuinely organic shape (berries, clouds, rocks) — the boundary radius
// is perturbed per-angle-sector by seeded noise, so it reads as irregular/
// lumpy rather than a precise geometric oval. Computed in LOCAL space so
// the wobble rotates with the shape. 0 = centre, 1 = (wobbled) boundary.
function blobLocalDist(u: number, v: number, seedKey: string, regionIdx: number): number {
  const dist = Math.sqrt(u * u + v * v);
  const angle = Math.atan2(v, u); // -PI..PI
  const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 10) % 10;
  const wobble = 1 + cellNoise(seedKey, regionIdx * 100 + sector, 7) * 0.28; // ±28% radius
  return dist / wobble;
}

// 0..1+ "how deep inside" metric per primitive, feeding edgeProximity below
// — approximate for the polygon primitives (triangle/trapezoid/diamond use
// the cheap rect-style max(|u|,|v|) rather than their own exact SDF), since
// this only biases which glyph a cell picks from its band's texture set,
// not the hit-test itself (which IS exact — see inPrimitive).
function localDist(primitive: ShapePrimitive, u: number, v: number): number {
  if (primitive === 'circle' || primitive === 'ellipse' || primitive === 'semicircle' || primitive === 'arc') {
    return Math.sqrt(u * u + v * v);
  }
  return Math.max(Math.abs(u), Math.abs(v));
}

// 0 = deep interior, 1 = at the region's boundary — same "computed from a
// cell's own region" locality as before, unified across all 12 primitives.
function edgeProximity(primitive: ShapePrimitive, u: number, v: number, seedKey: string, regionIdx: number): number {
  if (primitive === 'blob') return Math.min(1, blobLocalDist(u, v, seedKey, regionIdx));
  return Math.min(1, localDist(primitive, u, v));
}

// ---------------------------------------------------------------------------
// PER-PRIMITIVE HIT-TESTS — each a real inequality in the shared (u,v) local
// frame (see toLocal above), not a renamed bounding box. `region`/`seedKey`/
// `regionIdx` are only used by primitives that need extra params (trapezoid,
// arc) or per-region noise (blob); every other primitive ignores them.
// ---------------------------------------------------------------------------

export function inPrimitive(
  primitive: ShapePrimitive,
  u: number,
  v: number,
  region: RasterRegion,
  seedKey: string,
  regionIdx: number,
): boolean {
  switch (primitive) {
    case 'rectangle':
      return Math.abs(u) <= 1 && Math.abs(v) <= 1;
    case 'rounded_rectangle': {
      const radius = Math.min(0.5, Math.max(0, region.cornerRadius ?? 0.2));
      if (radius <= 0) return Math.abs(u) <= 1 && Math.abs(v) <= 1;
      if (Math.abs(u) <= 1 - radius && Math.abs(v) <= 1) return true;
      if (Math.abs(u) <= 1 && Math.abs(v) <= 1 - radius) return true;
      const ccx = Math.sign(u) * (1 - radius);
      const ccy = Math.sign(v) * (1 - radius);
      return (u - ccx) ** 2 + (v - ccy) ** 2 <= radius * radius;
    }
    case 'circle':
    case 'ellipse':
      return u * u + v * v <= 1;
    case 'diamond':
      return Math.abs(u) + Math.abs(v) <= 1;
    case 'triangle':
      // apex at local (0,-1), base along v=1 from u=-1 to u=1
      return v >= -1 && v <= 1 && Math.abs(u) <= (v + 1) / 2;
    case 'trapezoid': {
      const top = clamp01(region.topWidth ?? 1);
      const bottom = clamp01(region.bottomWidth ?? 1);
      const halfWidthAt = top + (bottom - top) * ((v + 1) / 2);
      return v >= -1 && v <= 1 && Math.abs(u) <= halfWidthAt;
    }
    case 'semicircle':
      // dome faces "up" (negative v) at rotation 0 — rotation handles the rest
      return u * u + v * v <= 1 && v <= 0;
    case 'arc': {
      const dist = Math.sqrt(u * u + v * v);
      if (dist < 0.55 || dist > 1) return false;
      let angle = (Math.atan2(v, u) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      const start = ((region.startAngle ?? 0) % 360 + 360) % 360;
      const end = ((region.endAngle ?? 360) % 360 + 360) % 360;
      if (start <= end) return angle >= start && angle <= end;
      return angle >= start || angle <= end; // wraps through 0
    }
    case 'blob':
      return blobLocalDist(u, v, seedKey, regionIdx) <= 1;
    default:
      return false;
  }
}

// Expand the scan box to cover a rotated shape's true screen-space extent
// (a rotated square's bbox is bigger than its own unrotated width/height) —
// only needed when rotation is actually set, so unrotated regions keep the
// EXACT tight loop bounds used before Stage 2 (byte-identical results).
export function scanBounds(b: RegionBounds, rotation: number | undefined, w: number, h: number) {
  if (!rotation) {
    return {
      x0: Math.max(0, b.x),
      y0: Math.max(0, b.y),
      x1: Math.min(w, b.x + b.width),
      y1: Math.min(h, b.y + b.height),
    };
  }
  const cxc = b.x + b.width / 2;
  const cyc = b.y + b.height / 2;
  const r = Math.sqrt((b.width / 2) ** 2 + (b.height / 2) ** 2);
  return {
    x0: Math.max(0, Math.floor(cxc - r)),
    y0: Math.max(0, Math.floor(cyc - r)),
    x1: Math.min(w, Math.ceil(cxc + r)),
    y1: Math.min(h, Math.ceil(cyc + r)),
  };
}

// Rasterize a thin single-cell-wide stroke across `bounds` — horizontal if
// height<=1, vertical if width<=1, otherwise a diagonal from corner to
// corner (simple Bresenham-style stepping, not a filled rect).
export function pointCenter(b: RegionBounds): { x: number; y: number } {
  return { x: Math.round(b.x + b.width / 2 - 0.5), y: Math.round(b.y + b.height / 2 - 0.5) };
}

export function lineCells(b: RegionBounds): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (b.height <= 1) {
    for (let x = b.x; x < b.x + b.width; x++) out.push({ x, y: b.y });
    return out;
  }
  if (b.width <= 1) {
    for (let y = b.y; y < b.y + b.height; y++) out.push({ x: b.x, y });
    return out;
  }
  const steps = Math.max(b.width, b.height) - 1;
  for (let i = 0; i <= steps; i++) {
    const x = b.x + Math.round((i * (b.width - 1)) / steps);
    const y = b.y + Math.round((i * (b.height - 1)) / steps);
    if (!out.some((p) => p.x === x && p.y === y)) out.push({ x, y });
  }
  return out;
}

function lineGlyph(b: RegionBounds): string {
  if (b.height <= 1) return FEATURE_GLYPHS.lineH;
  if (b.width <= 1) return FEATURE_GLYPHS.lineV;
  // diagonal direction: width/height growing the same way (top-left to
  // bottom-right) reads as '\', the mirrored case as '/'
  return b.width >= b.height ? FEATURE_GLYPHS.lineDiag : FEATURE_GLYPHS.lineDiagAlt;
}

function pointGlyph(b: RegionBounds): string {
  const size = Math.min(b.width, b.height);
  if (size <= 1) return FEATURE_GLYPHS.point;
  if (size <= 2) return FEATURE_GLYPHS.pointLarge;
  return FEATURE_GLYPHS.pointRadial;
}

// ---- palette key assignment ----

const KEY_POOL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

function toHex(rgb: [number, number, number]): string {
  const lift = (v: number) => Math.min(255, Math.round(255 * (v / 255) ** RAMP_GAMMA) + RAMP_LIFT);
  return '#' + rgb.map((v) => lift(v).toString(16).padStart(2, '0')).join('');
}

interface CellPaint {
  mode: 'surface' | 'feature';
  rgb: [number, number, number]; // shaded (surface) or flat (feature), UNJITTERED
  band?: Band; // surface only
  edge?: number; // surface only: 0 (interior) .. 1 (boundary), see edgeProximity
  material: string;
  glyph?: string; // feature cells: fixed at paint time. surface cells: chosen in the texture pass.
}

export function renderRegions(
  width: number,
  height: number,
  regions: RasterRegion[],
  seedKey: string,
  face?: FaceMark[],
): RenderedSprite {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const grid: (CellPaint | null)[][] = Array.from({ length: h }, () => Array<CellPaint | null>(w).fill(null));

  regions.forEach((region, regionIdx) => {
    const b = region.bounds;
    const rgb = resolveMaterial(region.material);
    if (FEATURE_PRIMITIVES.has(region.primitive)) {
      // FEATURE mode: flat colour, glyph fixed once per region (or per-cell
      // for arc's angular-range test), no shading, no ramp. line/point keep
      // their pre-Stage-2 path-based geometry as-is — rotation is deferred
      // for these two (see the Stage 2 plan's scoping note).
      if (region.primitive === 'point') {
        const { x: cx, y: cy } = pointCenter(b);
        if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
          grid[cy][cx] = { mode: 'feature', rgb, material: region.material, glyph: pointGlyph(b) };
        }
      } else if (region.primitive === 'line') {
        const glyph = lineGlyph(b);
        for (const { x, y } of lineCells(b)) {
          if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x] = { mode: 'feature', rgb, material: region.material, glyph };
        }
      } else if (region.primitive === 'arc') {
        const { x0, y0, x1, y1 } = scanBounds(b, region.rotation, w, h);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const { u, v } = toLocal(x, y, b, region.rotation);
            if (inPrimitive('arc', u, v, region, seedKey, regionIdx)) {
              grid[y][x] = { mode: 'feature', rgb, material: region.material, glyph: FEATURE_GLYPHS.arc };
            }
          }
        }
      }
      return;
    }
    // SURFACE mode: filled, shaded — every primitive dispatches through the
    // shared local-space transform (see toLocal/inPrimitive above).
    const { x0, y0, x1, y1 } = scanBounds(b, region.rotation, w, h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const { u, v } = toLocal(x, y, b, region.rotation);
        if (!inPrimitive(region.primitive, u, v, region, seedKey, regionIdx)) continue;
        const tLight = lightAt(u, v);
        const band = shadeBand(tLight);
        const edge = edgeProximity(region.primitive, u, v, seedKey, regionIdx);
        grid[y][x] = { mode: 'surface', rgb: shade(rgb, band), band, edge, material: region.material };
      }
    }
  });

  // Texture pass for SURFACE cells: glyph choice is fully decoupled from the
  // shading/colour computed above (see the module header + BAND_GLYPHS
  // note). Two layered noise fields — a coarse one for localized clumping
  // and a fine one for per-cell variation — combine with the cell's
  // edge-proximity to pick a position within its band's glyph set, so
  // boundary cells trend toward the set's higher-contrast members and deep
  // interior cells trend toward its subtler ones, without either being a
  // hard rule.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      if (!cell || cell.mode !== 'surface' || !cell.band) continue;
      const coarse = vnoise(seedKey, x, y, 0.25);
      const fine = vnoise(seedKey, x + 100, y + 100, 0.9);
      const bias = Math.min(1, Math.max(0, (cell.edge ?? 0) * 0.55 + coarse * 0.25 + fine * 0.2));
      const set = BAND_GLYPHS[cell.band];
      const idx = Math.min(set.length - 1, Math.floor(bias * set.length));
      cell.glyph = set[idx];
    }
  }

  // Face overlay: overwrite the GLYPH only, on top of whatever shading
  // already landed there — colour underneath is left alone.
  if (face) {
    for (const f of face) {
      if (f.x < 0 || f.x >= w || f.y < 0 || f.y >= h) continue;
      const existing = grid[f.y][f.x];
      grid[f.y][f.x] = existing
        ? { ...existing, glyph: f.glyph }
        : { mode: 'feature', rgb: [255, 255, 255], material: '#ffffff', glyph: f.glyph };
    }
  }

  // Palette + output grids. Surface keys: `${material}_${band}`. Feature
  // keys: `${material}_flat`. First-occurrence order onto a-zA-Z0-9.
  const palette: Record<string, string> = {};
  const keyOf = new Map<string, string>();
  let nextKeyIdx = 0;
  function paletteKeyFor(cell: CellPaint): string | null {
    const composite = cell.mode === 'surface' ? `${cell.material}_${cell.band}` : `${cell.material}_flat`;
    let key = keyOf.get(composite);
    if (!key) {
      if (nextKeyIdx >= KEY_POOL.length) return null; // exhausted — extremely unlikely (60+ distinct bands)
      key = KEY_POOL[nextKeyIdx++];
      keyOf.set(composite, key);
      palette[key] = toHex(cell.rgb);
    }
    return key;
  }

  const lines: string[] = [];
  const colors: string[] = [];
  for (let y = 0; y < h; y++) {
    let lineRow = '';
    let colorRow = '';
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      if (!cell || !cell.glyph) {
        lineRow += ' ';
        colorRow += '.';
        continue;
      }
      lineRow += cell.glyph;
      colorRow += paletteKeyFor(cell) ?? '.';
    }
    lines.push(lineRow);
    colors.push(colorRow);
  }

  return { lines, colors, palette };
}
