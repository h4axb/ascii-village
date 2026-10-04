// The sea route of the quest's boat trips (the travel cinematics and the
// ferry): out from the launch point to a ring around the home island, along
// that ring to the side facing the other island, then in to its shore.
// Never across land, whichever coast the boat was launched from.
import { isWater, MAP_H, MAP_W, nearestIsland } from '../world';

export type Pt = { x: number; y: number };

const clampPt = (p: Pt): Pt => ({
  x: Math.max(1, Math.min(MAP_W - 2, p.x)),
  y: Math.max(1, Math.min(MAP_H - 2, p.y)),
});

// Where an island meets the sea when walking out from its centre toward
// `toward`: the last land tile and the first water tile.
export function shoreToward(island: Pt, toward: Pt): { land: Pt; water: Pt } {
  const dx = toward.x - island.x;
  const dy = toward.y - island.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let land = { x: Math.round(island.x), y: Math.round(island.y) };
  for (let d = 0; d < len; d += 0.5) {
    const p = { x: Math.round(island.x + ux * d), y: Math.round(island.y + uy * d) };
    if (isWater(p.x, p.y)) return { land, water: p };
    land = p;
  }
  return { land, water: land };
}

// The route for a boat at `from` (on the water off `fromIsland`) to the shore
// of the island around `toCentre`.
export function seaRoute(from: Pt, toCentre: Pt): { path: Pt[]; land: Pt; dock: Pt } {
  const home = nearestIsland(from.x, from.y).isl;
  const margin = 7;
  const rx = home.rx + margin;
  const ry = home.ry + margin;
  const ring = (a: number): Pt => clampPt({ x: home.cx + Math.cos(a) * rx, y: home.cy + Math.sin(a) * ry });
  const a0 = Math.atan2((from.y - home.cy) / ry, (from.x - home.cx) / rx);
  const a1 = Math.atan2((toCentre.y - home.cy) / ry, (toCentre.x - home.cx) / rx);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const path: Pt[] = [from, ring(a0)];
  const steps = Math.ceil(Math.abs(da) / 0.25);
  for (let i = 1; i <= steps; i++) path.push(ring(a0 + (da * i) / steps));

  const { land, water } = shoreToward(toCentre, { x: home.cx, y: home.cy });
  const dx = water.x - land.x;
  const dy = water.y - land.y;
  const len = Math.hypot(dx, dy) || 1;
  const dock = clampPt({ x: water.x + (dx / len) * 1.5, y: water.y + (dy / len) * 1.5 });
  path.push(clampPt({ x: water.x + (dx / len) * 6, y: water.y + (dy / len) * 6 }), dock);
  return { path, land, dock };
}

// Total length and a point at distance `d` along a polyline
export function pathLength(path: Pt[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return n;
}
export function pointAt(path: Pt[], d: number): Pt {
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (d <= seg) {
      const t = seg ? d / seg : 1;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
    }
    d -= seg;
  }
  return path[path.length - 1];
}
