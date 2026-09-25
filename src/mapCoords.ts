// Split out of GameMap.tsx: a plain function export living alongside a
// React component export makes a file permanently ineligible for Vite Fast
// Refresh ("Could not Fast Refresh — export is incompatible"), which
// degrades every unrelated edit anywhere in the module graph into a full
// page reload — disruptive mid-development, and especially disruptive to
// Intro Part B, which restarts its whole cinematic from a fresh page load.
// A file that exports ONLY this helper (no component) never triggers that
// warning, so it's kept here instead of in GameMap.tsx.
import { MAP_OVERVIEW_SCALE, MAP_OVERVIEW_PADDING_PX } from './introPartB';

export function worldToMapPx(x: number, y: number): { left: number; top: number } {
  return {
    left: MAP_OVERVIEW_PADDING_PX + x * MAP_OVERVIEW_SCALE,
    top: MAP_OVERVIEW_PADDING_PX + y * MAP_OVERVIEW_SCALE,
  };
}
