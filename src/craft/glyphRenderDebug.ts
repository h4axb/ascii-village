// ---------------------------------------------------------------------------
// DEBUG-ONLY solid-mask renderer — see the plan at
// C:\Users\hanah\.claude\plans\greedy-orbiting-dream.md, Stage 1 (original)
// / Stage 2 (12-primitive update).
//
// Renders the exact same region geometry glyphRender.ts's renderRegions
// paints, but with all texture/material/shading/noise disabled: every ink
// cell (from every region, SURFACE or FEATURE alike) becomes one flat glyph
// and one flat palette colour. This isolates SILHOUETTE — is the base
// composition recognizable by shape alone? — from everything glyphRender.ts
// does to make it visually rich, which is a separate concern this debug
// mode deliberately does not touch.
//
// Reuses glyphRender.ts's own shared local-space transform/dispatch
// (toLocal/inPrimitive/scanBounds/lineCells/pointCenter) rather than
// re-deriving geometry, so the mask can never drift from what renderRegions
// would actually paint — mask and textured output always agree on WHERE
// ink is, only differ in HOW it's drawn. renderRegions itself is untouched
// by this file.
//
// Not wired into the production craft pipeline (spritePipeline.ts/llm.ts/
// CraftModal.tsx) — see scripts/craft-mask-eval.mjs for how this gets used.
// ---------------------------------------------------------------------------

import type { RasterRegion } from './spriteConfig';
import { FEATURE_PRIMITIVES } from './spriteConfig';
import { toLocal, inPrimitive, scanBounds, lineCells, pointCenter, type RenderedSprite } from './glyphRender';

const MASK_GLYPH = '#';
const MASK_COLOR_KEY = 'a';
const MASK_COLOR_HEX = '#ffffff';

export function renderMask(width: number, height: number, regions: RasterRegion[], seedKey: string): RenderedSprite {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const grid: boolean[][] = Array.from({ length: h }, () => Array<boolean>(w).fill(false));

  regions.forEach((region, regionIdx) => {
    const b = region.bounds;
    if (FEATURE_PRIMITIVES.has(region.primitive)) {
      if (region.primitive === 'point') {
        const { x: cx, y: cy } = pointCenter(b);
        if (cx >= 0 && cx < w && cy >= 0 && cy < h) grid[cy][cx] = true;
      } else if (region.primitive === 'line') {
        for (const { x, y } of lineCells(b)) {
          if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x] = true;
        }
      } else if (region.primitive === 'arc') {
        const { x0, y0, x1, y1 } = scanBounds(b, region.rotation, w, h);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const { u, v } = toLocal(x, y, b, region.rotation);
            if (inPrimitive('arc', u, v, region, seedKey, regionIdx)) grid[y][x] = true;
          }
        }
      }
      return;
    }
    const { x0, y0, x1, y1 } = scanBounds(b, region.rotation, w, h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const { u, v } = toLocal(x, y, b, region.rotation);
        if (inPrimitive(region.primitive, u, v, region, seedKey, regionIdx)) grid[y][x] = true;
      }
    }
  });

  // face marks are deliberately omitted — 1-cell dots don't inform
  // silhouette readability and would just add noise to the comparison.
  const lines: string[] = [];
  const colors: string[] = [];
  for (let y = 0; y < h; y++) {
    let lineRow = '';
    let colorRow = '';
    for (let x = 0; x < w; x++) {
      if (grid[y][x]) {
        lineRow += MASK_GLYPH;
        colorRow += MASK_COLOR_KEY;
      } else {
        lineRow += ' ';
        colorRow += '.';
      }
    }
    lines.push(lineRow);
    colors.push(colorRow);
  }

  return { lines, colors, palette: { [MASK_COLOR_KEY]: MASK_COLOR_HEX } };
}
