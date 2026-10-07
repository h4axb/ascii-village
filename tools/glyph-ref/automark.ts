// Auto-marking a reference.
//
// With an LLM key (.env VITE_LLM_API_KEY, read by this tool's dev server):
// one vision call per image names the object (role, category, tags, a
// description) and outlines its parts as rough polygons, using the
// category's part names from vocab.json, plus anchors and decoration /
// detail areas. The rough polygons are then SNAPPED to the art itself: the
// art is split into flat colour segments, and each segment takes the part
// most of it was outlined as — so part borders follow the drawing's own
// edges, cell-accurate, however loose the model's polygons were.
//
// Without a key (or when the call fails): colour zones only (the art's main
// colour groups), to be named in the marker editor.
import { medianCut, type Img, type RGB } from '../../src/glyph/bake';
import type { RefAnchor, RefArea, RefPart, RefRole, GameCategory } from '../../src/glyph/refs';
import vocabData from './vocab.json';
import { imgToDataUrl } from './clean';

export interface Vocab {
  categories: Record<string, { gameCategory: GameCategory; parts: string[]; tags?: string[] }>;
}
export const VOCAB = vocabData as unknown as Vocab;

export interface Marks {
  role: RefRole;
  category: string;
  gameCategory: GameCategory;
  partType: string;
  title: string;
  tags: string[];
  description: string;
  sizeBand: 'small' | 'medium' | 'large';
  parts: RefPart[];
  mask: Uint8Array; // per art pixel: 0 = none, i + 1 = parts[i]
  anchors: RefAnchor[];
  areas: RefArea[];
}

export const emptyMarks = (w: number, h: number, title: string, hint: Hint): Marks => ({
  role: hint.role ?? 'body',
  category: hint.category ?? '',
  gameCategory: (hint.category && VOCAB.categories[hint.category]?.gameCategory) || 'utensils',
  partType: hint.partType ?? '',
  title,
  tags: hint.tags ?? [],
  description: '',
  sizeBand: 'small',
  parts: [],
  mask: new Uint8Array(w * h),
  anchors: [],
  areas: [],
});

// What the file's path tells us: refs/boat/sails/red.png -> category boat,
// part sail; refs/decorations/flag.png -> a decoration tagged flag.
export interface Hint {
  category?: string;
  role?: RefRole;
  partType?: string;
  tags?: string[];
}
export function hintFromPath(path: string): Hint {
  const segs = path.toLowerCase().split('/').slice(0, -1).map((s) => s.replace(/[^a-z0-9-]+/g, '-'));
  const sing = (s: string) => s.replace(/(ies)$/, 'y').replace(/(s)$/, '');
  const h: Hint = { tags: [] };
  for (const s0 of segs) {
    const s = sing(s0);
    if (s === 'decoration' || s === 'deco') {
      h.role = 'decoration';
      h.category = 'decoration';
    } else if (VOCAB.categories[s]) h.category = s;
    else if (h.category && VOCAB.categories[h.category].parts.includes(s)) {
      h.role = 'part';
      h.partType = s;
    } else if (s) h.tags!.push(s);
  }
  return h;
}

// ---- colour segments ----------------------------------------------------------------------
// Flat-colour connected regions of the art (after reducing it to `tones`).
export function segments(art: Img, tones = 14): Int32Array {
  const n = art.w * art.h;
  const cols: RGB[] = [];
  for (let i = 0; i < n; i++) if (art.data[i * 4 + 3]) cols.push([art.data[i * 4], art.data[i * 4 + 1], art.data[i * 4 + 2]]);
  const tone = medianCut(cols, tones);
  const key = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!art.data[i * 4 + 3]) continue;
    const t = tone([art.data[i * 4], art.data[i * 4 + 1], art.data[i * 4 + 2]]);
    key[i] = (t[0] << 16) | (t[1] << 8) | t[2];
  }
  const seg = new Int32Array(n).fill(-1);
  let id = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (key[s] < 0 || seg[s] >= 0) continue;
    seg[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % art.w, y = (i / art.w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < art.w - 1 ? i + 1 : -1, y > 0 ? i - art.w : -1, y < art.h - 1 ? i + art.w : -1]) {
        if (j < 0 || seg[j] >= 0 || key[j] !== key[i]) continue;
        seg[j] = id;
        stack.push(j);
      }
    }
    id++;
  }
  return seg;
}

// every segment takes the label most of its pixels have (when a clear
// majority); unlabelled object pixels take their segment's label
export function snap(art: Img, mask: Uint8Array): Uint8Array {
  const seg = segments(art);
  const votes = new Map<number, Map<number, number>>();
  const size = new Map<number, number>();
  for (let i = 0; i < mask.length; i++) {
    const s = seg[i];
    if (s < 0) continue;
    size.set(s, (size.get(s) ?? 0) + 1);
    if (!mask[i]) continue;
    const v = votes.get(s) ?? new Map<number, number>();
    v.set(mask[i], (v.get(mask[i]) ?? 0) + 1);
    votes.set(s, v);
  }
  const winner = new Map<number, number>();
  for (const [s, v] of votes) {
    let best = 0, bn = 0, tot = 0;
    for (const [l, n] of v) {
      tot += n;
      if (n > bn) {
        bn = n;
        best = l;
      }
    }
    if (bn / Math.max(1, size.get(s)!) >= 0.35 || bn / tot >= 0.7) winner.set(s, best);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (seg[i] < 0) continue;
    out[i] = winner.get(seg[i]) ?? mask[i];
  }
  // object pixels still unlabelled: the nearest label in a small window
  for (let i = 0; i < out.length; i++) {
    if (seg[i] < 0 || out[i]) continue;
    const x = i % art.w, y = (i / art.w) | 0;
    let best = 0, bd = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= art.w || yy >= art.h) continue;
        const l = out[yy * art.w + xx];
        const d = dx * dx + dy * dy;
        if (l && d < bd) {
          bd = d;
          best = l;
        }
      }
    out[i] = best;
  }
  return out;
}

// ---- polygons -> mask ------------------------------------------------------------------------
function inPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) inside = !inside;
  }
  return inside;
}
const polyArea = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;

export function polygonsToMask(art: Img, parts: { polygon: [number, number][] }[]): Uint8Array {
  const m = new Uint8Array(art.w * art.h);
  // big parts first, so small ones (a flag on a mast) end up on top
  const order = parts.map((p, i) => ({ p, i })).sort((a, b) => polyArea(b.p.polygon) - polyArea(a.p.polygon));
  for (const { p, i } of order) {
    if (!p.polygon || p.polygon.length < 3) continue;
    for (let y = 0; y < art.h; y++)
      for (let x = 0; x < art.w; x++) {
        const k = y * art.w + x;
        if (!art.data[k * 4 + 3]) continue;
        if (inPoly((x + 0.5) / art.w, (y + 0.5) / art.h, p.polygon)) m[k] = i + 1;
      }
  }
  return m;
}

// ---- fallback: colour areas ---------------------------------------------------------------
// Without a model: the art's connected flat-colour areas, the biggest ones as
// parts (a hull, each sail, the mast, the flag), small specks merged into the
// neighbour they share the longest border with. Named part1…, to be renamed.
export function colourZones(art: Img, maxParts = 8): { parts: RefPart[]; mask: Uint8Array } {
  const seg = segments(art, 10);
  const n = art.w * art.h;
  const size = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < n; i++)
    if (seg[i] >= 0) {
      size.set(seg[i], (size.get(seg[i]) ?? 0) + 1);
      total++;
    }
  const minSize = Math.max(12, total * 0.02);
  const big = [...size.entries()].filter(([, c]) => c >= minSize).sort((a, b) => b[1] - a[1]).slice(0, maxParts).map(([s]) => s);
  const label = new Map<number, number>(big.map((s, k) => [s, k + 1]));
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = seg[i] >= 0 ? label.get(seg[i]) ?? 0 : 0;
  // grow the labelled parts into the unlabelled specks, a ring at a time
  for (let pass = 0; pass < 64; pass++) {
    let changed = 0;
    const next = mask.slice();
    for (let i = 0; i < n; i++) {
      if (seg[i] < 0 || mask[i]) continue;
      const x = i % art.w, y = (i / art.w) | 0;
      const votes = new Map<number, number>();
      for (const j of [x > 0 ? i - 1 : -1, x < art.w - 1 ? i + 1 : -1, y > 0 ? i - art.w : -1, y < art.h - 1 ? i + art.w : -1])
        if (j >= 0 && mask[j]) votes.set(mask[j], (votes.get(mask[j]) ?? 0) + 1);
      let best = 0, bn = 0;
      for (const [l, c] of votes) if (c > bn) { bn = c; best = l; }
      if (best) {
        next[i] = best;
        changed++;
      }
    }
    mask.set(next);
    if (!changed) break;
  }
  return { parts: big.map((_, k) => ({ name: `part${k + 1}`, zone: 'primary' as const })), mask };
}

// ---- the vision call (through the tool's dev server, which holds the key) ------------
interface AiPart {
  name: string;
  zone?: string;
  polygon: [number, number][];
}
interface AiReply {
  role?: string;
  category?: string;
  partType?: string;
  title?: string;
  tags?: string[];
  description?: string;
  sizeBand?: string;
  parts?: AiPart[];
  anchors?: RefAnchor[];
  areas?: RefArea[];
}

export async function aiAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/__ref/ai');
    return ((await r.json()) as { ok: boolean }).ok;
  } catch {
    return false;
  }
}

const clamp01 = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));

export async function autoMark(art: Img, base: Marks, hint: Hint, useAi: boolean): Promise<{ marks: Marks; source: 'ai' | 'zones'; note?: string }> {
  if (useAi) {
    try {
      const scale = Math.max(1, Math.floor(512 / Math.max(art.w, art.h)));
      const r = await fetch('/__ref/automark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imgToDataUrl(art, scale), hint, vocab: VOCAB.categories }),
      });
      const d = (await r.json()) as AiReply & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error || r.statusText);
      const parts = (d.parts ?? []).filter((p) => p && typeof p.name === 'string' && Array.isArray(p.polygon));
      const polys = parts.map((p) => ({ polygon: p.polygon.map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number]) }));
      const raw = polygonsToMask(art, polys);
      const category = d.category && VOCAB.categories[d.category] ? d.category : hint.category ?? base.category;
      const role = (['body', 'part', 'decoration'] as const).includes(d.role as RefRole) ? (d.role as RefRole) : hint.role ?? 'body';
      const marks: Marks = {
        ...base,
        role,
        category,
        gameCategory: VOCAB.categories[category]?.gameCategory ?? base.gameCategory,
        partType: hint.partType ?? d.partType ?? '',
        title: d.title?.trim() || base.title,
        tags: [...new Set([...(hint.tags ?? []), ...(d.tags ?? []).map(String)])].slice(0, 8),
        description: d.description?.trim() ?? '',
        sizeBand: (['small', 'medium', 'large'] as const).includes(d.sizeBand as 'small') ? (d.sizeBand as Marks['sizeBand']) : 'small',
        parts: parts.map((p) => ({ name: p.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), zone: (['primary', 'secondary', 'trim', 'fixed'] as const).includes(p.zone as 'trim') ? (p.zone as RefPart['zone']) : 'primary' })),
        mask: snap(art, raw),
        anchors: (d.anchors ?? []).filter((a) => a?.name).map((a) => ({ name: String(a.name), x: clamp01(a.x), y: clamp01(a.y) })),
        areas: (d.areas ?? [])
          .filter((a) => a?.name)
          .map((a) => ({
            name: String(a.name),
            type: a.type === 'detail' ? 'detail' : 'decoration',
            x: clamp01(a.x),
            y: clamp01(a.y),
            w: clamp01(a.w),
            h: clamp01(a.h),
            accepts: Array.isArray(a.accepts) ? a.accepts.map(String) : [],
            ...(a.part ? { part: String(a.part) } : {}),
          })),
      };
      if (marks.parts.length) return { marks, source: 'ai' };
      throw new Error('the model found no parts');
    } catch (err) {
      const z = colourZones(art);
      return { marks: { ...base, ...z }, source: 'zones', note: `AI marking failed, colour zones instead: ${String(err).slice(0, 160)}` };
    }
  }
  const z = colourZones(art);
  return { marks: { ...base, ...z }, source: 'zones' };
}
