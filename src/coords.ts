// Shared screen-pixel → world-tile conversion. Extracted from devLayout.ts's
// private `toTile` closure, which was itself a copy of the same inverse
// transform already inline in App.tsx's onWheel zoom-to-cursor handler — one
// piece of math, one place, instead of drifting copies.

import { TILE_CH, TILE_LN } from './world';

// What a caller needs from the camera to turn a screen pixel into a map
// tile. App.tsx keeps this current every render on the same ref the wheel
// handler and the dev layout tool both read.
export interface CamSnapshot {
  zoom: number;
  camX: number; // world chars at the left edge of the view (already clamped)
  camY: number; // world lines at the top edge
  dims: { scale: number; charW: number; lineH: number };
}

// screen pixel → map tile. getBoundingClientRect is POST-transform, so the
// pixel offset is divided back down by the fit scale before it becomes the
// field's own ch/em units.
export function screenToTile(
  clientX: number,
  clientY: number,
  el: HTMLElement | null,
  cam: CamSnapshot,
): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const fx = (clientX - r.left) / cam.dims.scale / cam.dims.charW;
  const fy = (clientY - r.top) / cam.dims.scale / cam.dims.lineH;
  return {
    x: Math.floor((cam.camX + fx / cam.zoom) / TILE_CH),
    y: Math.floor((cam.camY + fy / cam.zoom) / TILE_LN),
  };
}
