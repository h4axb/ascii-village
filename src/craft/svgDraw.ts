// ---------------------------------------------------------------------------
// The test link /4: the AI draws the asset itself. One call to the smart
// model returns a small SVG picture of the item; it is cleaned (only drawing
// elements and attributes survive), drawn onto a canvas and baked into the
// game's glyphs exactly like a reference picture (refCraft.ts bakeImage).
// Anything that fails returns null and the usual shape planner takes over.
// ---------------------------------------------------------------------------
import type { Img } from '../glyph/bake';
import { gameColourHint } from './colours';

export interface SvgDrawing {
  name: string;
  category: string;
  description: string;
  svg: string; // cleaned, safe to show
}

export const SVG_PROMPT = `You are the pixel artist of Asciia Bay, a cozy island game. Draw the item the player asks for as ONE small SVG picture; it is turned into the game's glyph art afterwards.
Reply with JSON only: {"name": a short charming item name, "category": one of "plant" | "pets" | "clothing" | "vehicle" | "food" | "utensils", "description": one or two cozy sentences under 30 words, "svg": the SVG markup}
The SVG:
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">, transparent background (no background rect), the item centred and filling most of the box.
- One item, seen from the side like a game sprite (a ship sideways, an animal in profile or 3/4, a can with its spout to one side).
- Bold, readable silhouette; big simple shapes first, then a few details. Flat colours with 1-2 darker shades for depth, light from the top left. A darker outline colour around the main shapes helps.
- Use only <g>, <path>, <rect>, <circle>, <ellipse>, <polygon>, <polyline>, <line>, and <linearGradient>/<radialGradient>/<stop> inside <defs>. No text, no images, no filters, no CSS, no scripts. At most 60 shapes.
- Show style words through their typical features (a viking ship: a dragon-head prow, round shields along the hull, a striped square sail).
${gameColourHint()}`;

// ---- cleaning ----
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'defs', 'lineargradient', 'radialgradient', 'stop']);
const ATTRS = new Set([
  'viewbox', 'xmlns', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'transform', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'fx', 'fy',
]);
const MAX_SVG = 24_000;

// Only drawing elements and attributes survive; paint may point at a
// gradient of the picture itself (url(#id)), nothing else.
export function sanitizeSvg(raw: string): string | null {
  if (!raw || raw.length > MAX_SVG) return null;
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  let shapes = 0;
  const clean = (el: Element) => {
    for (const child of [...el.children]) {
      if (!ELEMENTS.has(child.nodeName.toLowerCase())) {
        child.remove();
        continue;
      }
      clean(child);
    }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      const v = a.value;
      const urlOk = !/url\(/i.test(v) || /^\s*url\(\s*#[\w-]+\s*\)\s*$/.test(v);
      if (!ATTRS.has(n) || !urlOk || /javascript:|expression\(|@import/i.test(v)) el.removeAttribute(a.name);
    }
    // no text inside drawing elements
    for (const node of [...el.childNodes]) if (node.nodeType === 3 && node.textContent?.trim()) node.remove();
    if (!['svg', 'g', 'defs', 'lineargradient', 'radialgradient', 'stop'].includes(el.nodeName.toLowerCase())) shapes++;
  };
  clean(root);
  if (shapes === 0 || shapes > 200) return null;
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', '0 0 128 128');
  root.setAttribute('width', '256');
  root.setAttribute('height', '256');
  return new XMLSerializer().serializeToString(root);
}

// the cleaned picture drawn onto a canvas, as the baker's image
export function rasterSvg(svg: string, size = 256): Promise<Img> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = size;
      cv.height = size;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(im, 0, 0, size, size);
      resolve({ w: size, h: size, data: ctx.getImageData(0, 0, size, size).data });
    };
    im.onerror = () => reject(new Error('the drawing could not be drawn'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

// share of the canvas the drawing covers (an empty or tiny drawing is a failure)
export function coverage(img: Img): number {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 128) n++;
  return n / (img.w * img.h);
}

export function parseDrawing(raw: Record<string, unknown> | null | undefined): SvgDrawing | null {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const svg = sanitizeSvg(str(raw.svg));
  if (!svg) return null;
  return { name: str(raw.name).slice(0, 40), category: str(raw.category), description: str(raw.description).slice(0, 240), svg };
}
