// ---------------------------------------------------------------------------
// Shared helpers for the baked-asset generators (palm.mjs, waterfall.mjs).
// Each used to define its own byte-identical copy of these three functions —
// harmless until the next bugfix lands in one copy and silently misses the
// other. One definition here instead.
//
// toSprite() is NOT here: palm.mjs's cell objects use a `col` property while
// waterfall.mjs uses `c` — a real, stable difference (not drift), so unifying
// it would mean either renaming palm's cell shape throughout for no
// behavioural gain, or parameterizing the field name for one three-line
// function. Left as each file's own small function.
// ---------------------------------------------------------------------------

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => {
    const n = Math.sin(a * 127.1 + b * 311.7 + seed * 13.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const tl = h(xi, yi), tr = h(xi + 1, yi), bl = h(xi, yi + 1), br = h(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}

// Trim blank border rows/cols so the sprite is only as large as the drawing.
// Returns the offset it trimmed by (some callers need to add it back before
// resampling noise fields that were evaluated at full-grid coordinates).
export function crop(grid) {
  let y0 = 0, y1 = grid.length - 1, x0 = grid[0].length, x1 = -1;
  while (y0 <= y1 && grid[y0].every((c) => !c)) y0++;
  while (y1 >= y0 && grid[y1].every((c) => !c)) y1--;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < grid[y].length; x++) if (grid[y][x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  return { grid: grid.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1)), dx: x0, dy: y0 };
}
