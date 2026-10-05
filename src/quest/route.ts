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

// The route for a boat whose centre is at `from` (on the water off its
// island) to the shore of the island around `toCentre`. `clearance` is how far
// the boat reaches out from its centre: the ring keeps that much further out.
export function seaRoute(from: Pt, toCentre: Pt, clearance = 0): { path: Pt[]; land: Pt; dock: Pt } {
  const home = nearestIsland(from.x, from.y).isl;
  const margin = 7 + clearance;
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
  const out = 6 + clearance;
  path.push(clampPt({ x: water.x + (dx / len) * out, y: water.y + (dy / len) * out }), dock);
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

// A route for a `wT`×`hT` boat from top-left `from` to top-left `to` on
// which every tile of the boat stays on open water the whole way (A* over
// boat positions), kept off the map's edges where the camera can't centre
// it, then straightened wherever a straight line also floats. null when no
// such route exists.
export function boatRoute(from: Pt, to: Pt, wT: number, hT: number, floats: (x: number, y: number) => boolean): Pt[] | null {
  const W = MAP_W - wT + 1;
  const H = MAP_H - hT + 1;
  if (W <= 0 || H <= 0) return null;
  const fit = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fit[y * W + x] = floats(x, y) ? 1 : 0;
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && fit[y * W + x] === 1;
  const s = { x: Math.round(from.x), y: Math.round(from.y) };
  const g = { x: Math.round(to.x), y: Math.round(to.y) };
  if (!ok(g.x, g.y)) return null;
  // the start may still touch the shore: begin from the nearest floating spot
  if (!ok(s.x, s.y)) return null;
  const EDGE = 5;
  const edgeCost = (x: number, y: number) =>
    x < EDGE || y < EDGE || x + wT > MAP_W - EDGE || y + hT > MAP_H - EDGE ? 4 : 0;
  const dist = new Float32Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const open: { i: number; f: number }[] = [];
  const push = (n: { i: number; f: number }) => {
    open.push(n);
    let k = open.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (open[p].f <= open[k].f) break;
      [open[p], open[k]] = [open[k], open[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < open.length && open[l].f < open[m].f) m = l;
        if (r < open.length && open[r].f < open[m].f) m = r;
        if (m === k) break;
        [open[m], open[k]] = [open[k], open[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (x: number, y: number) => Math.hypot(x - g.x, y - g.y);
  const si = s.y * W + s.x;
  const gi = g.y * W + g.x;
  dist[si] = 0;
  push({ i: si, f: h(s.x, s.y) });
  while (open.length) {
    const { i, f } = pop();
    if (i === gi) break;
    const x = i % W;
    const y = (i / W) | 0;
    if (f - h(x, y) > dist[i] + 1e-3) continue; // stale entry
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!ok(nx, ny)) continue;
        if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue; // no corner cutting
        const ni = ny * W + nx;
        const nd = dist[i] + (dx && dy ? Math.SQRT2 : 1) + edgeCost(nx, ny);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = i;
          push({ i: ni, f: nd + h(nx, ny) });
        }
      }
  }
  if (prev[gi] === -1 && gi !== si) return null;
  const raw: Pt[] = [];
  for (let i = gi; i !== -1; i = prev[i]) raw.push({ x: i % W, y: (i / W) | 0 });
  raw.reverse();
  // straighten: skip ahead while the straight line floats the whole way
  const clear = (a: Pt, b: Pt) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      // a fractional spot covers the tiles of both neighbouring positions
      for (const px of [Math.floor(x), Math.ceil(x)])
        for (const py of [Math.floor(y), Math.ceil(y)]) if (!ok(px, py)) return false;
    }
    return true;
  };
  const path: Pt[] = [raw[0]];
  let a = 0;
  while (a < raw.length - 1) {
    let b = raw.length - 1;
    while (b > a + 1 && !clear(raw[a], raw[b])) b--;
    path.push(raw[b]);
    a = b;
  }
  return path;
}

// Every top-left spot from which a `wT`×`hT` boat can sail to top-left `to`
// with all of it on open water the whole way (a flood fill from `to`)
export function boatReachable(to: Pt, wT: number, hT: number, floats: (x: number, y: number) => boolean): (x: number, y: number) => boolean {
  const W = MAP_W - wT + 1;
  const H = MAP_H - hT + 1;
  const seen = new Uint8Array(Math.max(0, W * H));
  const g = { x: Math.round(to.x), y: Math.round(to.y) };
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  if (inside(g.x, g.y) && floats(g.x, g.y)) {
    seen[g.y * W + g.x] = 1;
    const queue = [g.y * W + g.x];
    for (let q = 0; q < queue.length; q++) {
      const x = queue[q] % W;
      const y = (queue[q] / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny) || seen[ny * W + nx]) continue;
        seen[ny * W + nx] = 2; // looked at
        if (!floats(nx, ny)) continue;
        seen[ny * W + nx] = 1;
        queue.push(ny * W + nx);
      }
    }
  }
  return (x, y) => inside(x, y) && seen[y * W + x] === 1;
}
