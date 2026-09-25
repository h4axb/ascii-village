// ---------------------------------------------------------------------------
// POND ANIMATION — two counter-scrolling noise currents blended by a
// row-based sine bias, giving the water surface a gentle drifting shimmer.
// ---------------------------------------------------------------------------

export interface PondAnim {
  kind: string[]; // 'w' pond cell, ' ' static
  dx: number;
  dy: number;
  cols: number;
  rows: number;
  pondG: string[];
}

export const POND_FRAME_MS = 110;
const POND_SCROLL_RATE = 0.1; // same rate as the waterfall's pond currents

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7 + seed * 13.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const tl = h(xi, yi), tr = h(xi + 1, yi), bl = h(xi, yi + 1), br = h(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}

export function pondFrame(
  sprite: string[],
  colors: string[],
  a: PondAnim,
  t: number,
): { sprite: string[]; colors: string[] } {
  const pondScroll = t * POND_SCROLL_RATE;
  const outG: string[] = [];
  const outC: string[] = [];

  for (let y = 0; y < sprite.length; y++) {
    const kindRow = a.kind[y] ?? '';
    if (!kindRow.includes('w')) {
      outG.push(sprite[y]);
      outC.push(colors[y]);
      continue;
    }
    const g = [...sprite[y]];
    const c = [...colors[y]];
    const gy = y + a.dy;
    const ny = gy / a.rows;
    for (let x = 0; x < g.length; x++) {
      if (kindRow[x] !== 'w') continue;
      const gx = x + a.dx;
      const nx = gx / a.cols;

      const goRight = vnoise(nx * 9 - pondScroll, ny * 16, 30);
      const goLeft = vnoise(nx * 11 + pondScroll * 0.75, ny * 14, 31);
      const bias = 0.5 + 0.42 * Math.sin(ny * 70);
      const v = goRight * bias + goLeft * (1 - bias);

      if (v > 0.74) c[x] = 'W'; // l — highest tone
      else if (v > 0.54) c[x] = 'X'; // m
      else if (v > 0.32) c[x] = 'Y'; // n
      else c[x] = 'Z'; // o — deepest tone

      g[x] = a.pondG[Math.floor(v * a.pondG.length) % a.pondG.length];
    }
    outG.push(g.join(''));
    outC.push(c.join(''));
  }
  return { sprite: outG, colors: outC };
}
