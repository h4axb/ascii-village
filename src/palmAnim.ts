// ---------------------------------------------------------------------------
// PALM SHAKE ANIMATION — the reference sketch's motion, at runtime.
//
// The baked sprite in palm.json is one frozen frame. This redraws it per frame
// from the animation payload the generator ships alongside it, reproducing the
// three motions the reference had:
//
//   sway     every frond drifts sideways on its own phase and amplitude, so
//            the crown moves as many separate leaves rather than one block
//   flicker  only EDGE cells step along the glyph ramp, which reads as light
//            catching the moving leaf tips
//   fall     the three date bundles detach from the crown, drop, and LAND at
//            the foot of the tree — where the collectible bunches then appear,
//            so what lands and what you pick up are the same picture
//
// Deliberately PURE: `palmFrame(frame)` depends on nothing but the frame
// number, so there is no physics state to keep in sync with React, and the
// same frame always draws the same picture. Bundle fall uses the closed form
// of the reference's step integration (vy += g; fy += vy) rather than stepping,
// which is what makes that possible.
// ---------------------------------------------------------------------------

export interface PalmAnim {
  ramp: string[]; // the generator's glyph ramp, so --ascii bakes flicker in ASCII
  base: string[];
  baseColors: string[];
  gi: string[];
  frond: string[];
  edge: string[];
  fronds: { phase: number; amp: number }[];
  bundles: {
    ax: number;
    ay: number;
    stemLen: number;
    dates: { ox: number; oy: number; g: string; lit: boolean }[];
  }[];
  frondKey: string;
}

// The reference's integration: vy starts at v0 and gains G each step, fy
// accumulates vy. Summed rather than stepped so any frame can be drawn directly.
const G = 0.05;
const v0 = (i: number) => 0.1 + i * 0.05; // was Math.random(); staggered so the
//                                            three bundles don't fall in lockstep
const fallY = (i: number, n: number) => (n <= 0 ? 0 : n * v0(i) + (G * n * (n + 1)) / 2);

// How long the shake runs — enough for every bundle to reach the ground and
// settle. Read by App.tsx so the timer and the animation can't drift apart.
export const SHAKE_FRAMES = 22;
export const SHAKE_FRAME_MS = 70;
export const SHAKE_MS = SHAKE_FRAMES * SHAKE_FRAME_MS;

// Per request: on shake, each bundle just falls STRAIGHT DOWN — no sideways
// swing/reposition beat first. It still falls at a fixed column, though, not
// its own hanging attach point: two bundles left of the trunk, one right,
// so dates land clear of the trunk and of each other instead of piling up
// on top of it (which is what falling from the bundles' own attach columns
// did — they're only 0.41/0.52/0.61 of the sprite's width apart, well
// within the trunk's own footprint). Fractions of the sprite's own width,
// tuned against this tree's actual baked geometry (bundle index order is
// fixed — see the hardcoded ax list in scripts/lib/palm.mjs — so index 0/1
// are the left-of-centre/centre bundles and land further left, index 2 is
// the right-of-centre bundle and lands right) — verified by measuring the
// actual rendered date positions, not guessed.
const DRIFT_X_FRAC = [0.02, 0.24, 0.8];

// Where bundle `i` ends up once fully landed, in the sprite's own char grid.
// Exported so App.tsx's dropDates() can place the collectible bunch at
// EXACTLY this spot — the animation already showed it fall and land there,
// so the pickup must not appear anywhere else or it visibly pops/relocates.
export function bundleLandingX(a: PalmAnim, i: number): number {
  const w = a.base[0].length;
  const frac = DRIFT_X_FRAC[i];
  return frac !== undefined ? Math.round(frac * w) : a.bundles[i].ax;
}

export function palmFrame(a: PalmAnim, frame: number): { sprite: string[]; colors: string[] } {
  const h = a.base.length;
  const w = a.base[0].length;

  // ---- sway: shift each cell by its own frond's offset --------------------
  const sway = a.fronds.map((f) => Math.round(Math.sin(frame * 0.05 + f.phase) * f.amp));
  const g: (string | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));
  const c: (string | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = a.base[y][x];
      if (ch === ' ') continue;
      const fk = a.frond[y][x];
      const fi = fk === ' ' ? -1 : a.frondKey.indexOf(fk);
      // bark doesn't sway — a trunk that slid sideways would tear off its base
      const nx = x + (fi >= 0 ? sway[fi] ?? 0 : 0);
      if (nx < 0 || nx >= w || g[y][nx]) continue;
      let out = ch;
      if (fi >= 0 && a.edge[y][x] === '1') {
        // edge cells step along the ramp — the leaf-tip shimmer
        const base = a.gi[y][x] === ' ' ? 0 : +a.gi[y][x];
        const step = Math.round(Math.sin(frame * 0.32 + nx * 0.6 + y * 0.4) + 1);
        out = a.ramp[(base + step) % a.ramp.length];
      }
      g[y][nx] = out;
      c[y][nx] = a.baseColors[y][x];
    }
  }

  // ---- date bundles: just fall straight down, at their fixed landing column ---
  a.bundles.forEach((b, i) => {
    // No swing/reposition beat — the falling cluster is at its landing
    // column (see the DRIFT_X_FRAC note above) from frame 0, and the only
    // motion is the vertical drop.
    const clusterBx = bundleLandingX(a, i);
    const spineBottom = Math.max(...b.dates.map((d) => d.oy));
    // The bunch stops when its lowest date reaches the base of the tree, so it
    // comes to rest ON the ground (the same row for every bundle, since this
    // is solved for that exact row) rather than sliding out of frame.
    const maxDrop = Math.max(0, h - 1 - b.ay - spineBottom);
    const drop = Math.min(fallY(i, frame), maxDrop);
    const put = (x: number, y: number, ch: string, col: string, over = false) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      if (!over && g[y][x]) return;
      g[y][x] = ch;
      c[y][x] = col;
    };
    // the crown attachment point never moves — only the bunch below it does
    for (let s = 0; s < b.stemLen; s++) put(b.ax, b.ay + s, '|', 'p');
    const clusterY = b.ay + b.stemLen + drop;
    for (let s = 0; s <= spineBottom - b.stemLen; s++) put(clusterBx, Math.round(clusterY + s - 0.5), '|', 'p');
    for (const d of b.dates) {
      put(Math.round(clusterBx + d.ox), Math.round(clusterY + d.oy - b.stemLen), d.g, d.lit ? 'n' : 'm', true);
    }
  });

  return {
    sprite: g.map((r) => r.map((v) => v ?? ' ').join('')),
    colors: c.map((r) => r.map((v) => v ?? '.').join('')),
  };
}
