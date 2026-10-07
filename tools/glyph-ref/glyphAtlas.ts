// Every candidate glyph as it looks in the game: drawn twice side by side
// (the game doubles columns) in one 2ch x 1-line cell, in the game's font,
// reduced to SUB_W x SUB_H ink coverage. bake.ts matches cell patterns
// against these.
import { SUB_H, SUB_W, type GlyphShape } from './bake';

export const GAME_FONT = "'Sarasa Mono', 'Cascadia Code', 'Courier New', ui-monospace, Menlo, Consolas, monospace";

export function buildAtlas(glyphs: string): GlyphShape[] {
  const px = 48;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `${px}px ${GAME_FONT}`;
  const charW = ctx.measureText('M').width;
  const W = Math.ceil(charW * 2), H = px;
  cv.width = W;
  cv.height = H;
  const out: GlyphShape[] = [];
  for (const ch of new Set([...glyphs])) {
    if (ch === ' ') continue;
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${px}px ${GAME_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(ch, charW / 2, H / 2);
    ctx.fillText(ch, charW * 1.5, H / 2);
    const d = ctx.getImageData(0, 0, W, H).data;
    const bits = new Float32Array(SUB_W * SUB_H);
    let ink = 0;
    for (let sy = 0; sy < SUB_H; sy++)
      for (let sx = 0; sx < SUB_W; sx++) {
        let s = 0, n = 0;
        const x0 = Math.floor((sx * W) / SUB_W), x1 = Math.floor(((sx + 1) * W) / SUB_W);
        const y0 = Math.floor((sy * H) / SUB_H), y1 = Math.floor(((sy + 1) * H) / SUB_H);
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            s += d[(y * W + x) * 4 + 3] / 255;
            n++;
          }
        const v = n ? Math.min(1, (s / n) * 2.5) : 0; // thin strokes still count
        bits[sy * SUB_W + sx] = v;
        ink += v;
      }
    out.push({ ch, bits, ink: ink / (SUB_W * SUB_H) });
  }
  return out;
}
