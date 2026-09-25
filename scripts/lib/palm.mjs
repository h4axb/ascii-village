// ---------------------------------------------------------------------------
// DATE PALM GENERATOR — a port of the reference glyph-palm sketch.
//
// Ported faithfully, including the ORDER of every rnd() call, so a given seed
// reproduces the reference picture exactly. The one deliberate change: the
// original hardcoded several sizes in CELLS (trunk half-width 5, stem length
// 6-8, date spacing 1.7) alongside its normalised 0..1 geometry, so it only
// looked right at exactly 64 columns. Those are scaled by `s = cols/64` here,
// which is what lets the same model be baked at any grid size.
//
// Output is a static frame. The reference animates (per-frond wind sway, edge
// glyphs flickering, bundles falling on shake); the game stores sprites as
// string[], so what gets baked is one frozen moment of that.
// ---------------------------------------------------------------------------

import { mulberry32, vnoise, crop as cropShared } from './genutils.mjs';

export { mulberry32 };

// The density ramp, sparse -> dense. NOTE: `∘ ◦ ◇ ●` (U+2218, U+25E6, U+25C7,
// U+25CF) are East-Asian AMBIGUOUS width. In a CJK-aware monospace font they
// can render double-width and shear every row. They are kept because the
// reference look depends on them; ASCII_DOT below is the safe swap.
export const DOT = ['·', '∘', '◦', 'o', '+', '×', 'O', '◇', 'B', '8'];
export const ASCII_DOT = ['.', ',', ':', 'o', '+', 'x', 'O', '*', 'B', '8'];

const GREEN = ['a', 'b', 'c'];
const CURTAIN = ['d', 'e', 'f'];
const CURTAINLIT = ['g', 'h', 'i'];

// key -> hex, lifted from the reference stylesheet's :root block
export const PALETTE = {
  a: '#a8b894', b: '#7a8f6a', c: '#4f6247', // crown fronds, lit -> shadow
  d: '#a86a38', e: '#7d4a26', f: '#5a3419', // dead-frond curtain, shadow band
  g: '#e0a05a', h: '#c9803c', i: '#9a5f2a', // dead-frond curtain, sunlit band
  j: '#d9c08f', k: '#b89a68', l: '#8a7048', // trunk, lit -> shade
  m: '#f5b731', n: '#ffe07a', // dates, and their lit faces
  p: '#e8c451', // bunch stems
};


// `ascii` reaches in here only for the trunk's bark glyph, which is chosen
// during the build rather than by the ramp in render().
export function buildModel({ cols, rows, seed = 9, ascii = false }) {
  const rnd = mulberry32(seed);
  const s = cols / 64;
  const crown = { x: 0.5, y: 0.11 };

  // HEAD fronds — the green crown, arcing up and outward from one point
  const headFronds = [];
  const nHead = 18;
  for (let i = 0; i < nHead; i++) {
    const t = i / (nHead - 1);
    const angle = -Math.PI * 1.02 + t * Math.PI * 1.6 + (rnd() - 0.5) * 0.06;
    const len = 0.17 + rnd() * 0.07;
    const droop = 0.35 + rnd() * 0.35;
    const width = 3 + Math.floor(rnd() * 2);
    const dir = Math.cos(angle) >= 0 ? 1 : -1;
    const curl = dir * (0.05 + rnd() * 0.05);
    // phase/amp drive the wind sway. They MUST be drawn here even though the
    // static bake ignores them: they are part of the reference's rnd()
    // sequence, and skipping them shifts every later draw — a different tree.
    const phase = rnd() * Math.PI * 2;
    const amp = 0.45 + rnd() * 0.45;
    headFronds.push({ angle, len, droop, width, curl, layer: 'head', phase, amp, id: i });
  }
  // CURTAIN — the long rust skirt of dead fronds, the tree's dominant mass
  const curtainFronds = [];
  const nCurtain = 34;
  for (let i = 0; i < nCurtain; i++) {
    const t = i / (nCurtain - 1);
    const angle = -Math.PI * 0.585 + t * Math.PI * 0.17 + (rnd() - 0.5) * 0.03;
    const len = 0.36 + rnd() * 0.1;
    const droop = 1.75 + rnd() * 0.25;
    const width = 1 + Math.floor(rnd() * 2);
    const lit = t > 0.3 && t < 0.62;
    const phase = rnd() * Math.PI * 2;
    // the sunlit middle band swings noticeably; the shadowed strands barely move
    const amp = lit ? 0.25 + rnd() * 0.25 : 0.05 + rnd() * 0.07;
    curtainFronds.push({ angle, len, droop, width, layer: 'curtain', lit, curl: 0, phase, amp, id: 100 + i });
  }

  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const fr of [...headFronds, ...curtainFronds]) {
    const steps = 60;
    for (let st = 0; st <= steps; st++) {
      const u = st / steps;
      const curve = Math.pow(u, 1.6) * fr.droop;
      const lateral = fr.curl ? Math.pow(u, 1.4) * fr.curl : 0;
      const px = crown.x + Math.cos(fr.angle) * fr.len * u + lateral;
      const py = crown.y + Math.sin(fr.angle) * fr.len * u * (1 - curve * 0.3) + curve * fr.len * 0.6;
      const cx = Math.round(px * cols), cy = Math.round(py * rows);
      const w = Math.max(1, Math.round(fr.width * (1 - u * 0.7) * Math.max(s, 0.35)));
      for (let dw = -w; dw <= w; dw++) {
        const perp = fr.angle + Math.PI / 2;
        const x = cx + Math.round(Math.cos(perp) * dw * 0.5);
        const y = cy + Math.round(Math.sin(perp) * dw * 0.5);
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
        const dens = 1 - Math.abs(dw) / (w + 0.001);
        if (dens <= 0.05) continue;
        const pal = fr.layer === 'head' ? GREEN : fr.lit ? CURTAINLIT : CURTAIN;
        const band = Math.min(pal.length - 1, Math.round((1 - dens) * (pal.length - 1)));
        const ex = cells[y][x];
        const prio = fr.layer === 'head' ? 2 : 1;
        const exPrio = ex && ex.k === 'leaf' ? (ex.layer === 'head' ? 2 : 1) : 0;
        if (!ex || prio > exPrio || (prio === exPrio && dens > ex.dens)) {
          cells[y][x] = {
            k: 'leaf', dens, col: pal[band], layer: fr.layer,
            // frond + edge are what the runtime animation needs: every cell
            // sways with ITS OWN frond, and only edge cells flicker
            frond: fr.id, edge: dens < 0.5,
            gi: Math.floor(vnoise(x * 3, y * 3, seed + fr.id) * DOT.length),
          };
        }
      }
    }
  }

  // TRUNK — short and wide, overlapping up into the curtain so the two connect
  const tcx = Math.floor(cols * crown.x);
  let curtainBottom = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y][x];
      if (c && c.k === 'leaf' && c.layer === 'curtain' && y > curtainBottom) curtainBottom = y;
    }
  }
  const trunkTop = Math.max(0, curtainBottom - Math.round(6 * s));
  const trunkH = Math.max(Math.round(4 * s), Math.round((rows - trunkTop) * 0.25));
  const trunkBottom = Math.min(rows, trunkTop + trunkH);
  let tx0 = cols, tx1 = 0;
  for (let y = trunkTop; y < trunkBottom; y++) {
    const tt = (y - trunkTop) / Math.max(1, trunkBottom - trunkTop);
    const halfW = Math.max(1, Math.round((5 + tt * 2.5) * s));
    const lean = Math.round(Math.sin(tt) * 1.2 * s);
    for (let w = -halfW; w <= halfW; w++) {
      const x = tcx + w + lean;
      if (x < 0 || x >= cols) continue;
      if (y < curtainBottom && cells[y][x]) continue;
      const frac = Math.abs(w) / halfW;
      // `¦` is Latin-1, not ASCII, and shares the double-width risk — so the
      // ascii bake swaps it for a plain pipe.
      const barkG = y % 2 === 0 ? (ascii ? '|' : '¦') : ':';
      cells[y][x] = { k: 'bark', g: barkG, col: frac > 0.72 ? 'l' : w < 0 ? 'j' : 'k' };
      if (x < tx0) tx0 = x;
      if (x > tx1) tx1 = x;
    }
  }

  // DATE BUNDLES — grape-bunch clusters on visible stems from the crown.
  // These are the tree's default attach points and stay put — the left/right
  // spread on drop is done by the FALL itself (palmAnim.ts's palmFrame),
  // which drifts each bundle sideways as it falls rather than straight down,
  // so it lands clear of the trunk without moving where it hangs from.
  const bundles = [];
  for (const [ax, ay] of [[0.41, crown.y + 0.02], [0.52, crown.y + 0.03], [0.61, crown.y + 0.02]]) {
    const stemLen = Math.max(1, Math.round((6 + Math.floor(rnd() * 3)) * s));
    const dates = [];
    const nRows = 6 + Math.floor(rnd() * 2);
    for (let r = 0; r < nRows; r++) {
      const rowT = r / (nRows - 1);
      const perRow = Math.max(1, Math.round((1 - rowT) * 4.5) + 1);
      const rowY = stemLen + (r * 1.6 + rnd() * 0.4) * Math.max(s, 0.4);
      for (let k = 0; k < perRow; k++) {
        const ox = ((k - (perRow - 1) / 2) * 1.7 + (rnd() - 0.5) * 0.5) * Math.max(s, 0.4);
        dates.push({ ox, oy: rowY, g: rnd() < 0.5 ? '●' : 'o', lit: rnd() < 0.4 });
      }
    }
    bundles.push({ ax: Math.floor(ax * cols), ay: Math.floor(ay * rows), stemLen, dates });
  }

  return { cells, rows, cols, bundles, fronds: [...headFronds, ...curtainFronds], trunk: { x0: tx0, x1: tx1 } };
}

// ---------------------------------------------------------------------------
// ANIMATION PAYLOAD — everything the runtime needs to redraw a frame itself.
//
// The static bake is one flattened picture; to sway and flicker, the client has
// to know which frond each cell belongs to, its un-flickered glyph index, and
// whether it's an edge cell. Shipping that as PARALLEL CHARACTER GRIDS (one
// char per cell) keeps it to a few KB instead of an object per cell — and the
// bundles ship separately, because the animation has to lift them off the tree
// and drop them.
// ---------------------------------------------------------------------------
const FROND_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toAnim(M, crops, ascii = false) {
  const ramp = ascii ? ASCII_DOT : DOT;
  const { cells, rows, cols, fronds } = M;
  const { dx, dy, w, h } = crops;
  const order = fronds.map((f) => f.id);
  const at = (x, y) => (cells[y + dy] ? cells[y + dy][x + dx] : null);
  const grid = (fn) =>
    Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(at(x, y), x, y)).join(''));

  return {
    ramp,
    // base (tree only, no date bundles) — the animation overlays bundles itself
    base: grid((c) => (c ? (c.k === 'bark' ? c.g : ramp[c.gi % ramp.length]) : ' ')),
    baseColors: grid((c) => (c ? c.col : '.')),
    gi: grid((c) => (c && c.k === 'leaf' ? String(c.gi % 10) : ' ')),
    frond: grid((c) => {
      if (!c || c.k !== 'leaf') return ' ';
      const i = order.indexOf(c.frond);
      return i >= 0 && i < FROND_KEY.length ? FROND_KEY[i] : ' ';
    }),
    edge: grid((c) => (c && c.k === 'leaf' && c.edge ? '1' : '0')),
    fronds: fronds.map((f) => ({ phase: +f.phase.toFixed(4), amp: +f.amp.toFixed(4) })),
    bundles: M.bundles.map((b) => ({
      ax: b.ax - dx,
      ay: b.ay - dy,
      stemLen: b.stemLen,
      dates: b.dates.map((d) => ({
        ox: +d.ox.toFixed(3), oy: +d.oy.toFixed(3),
        g: ascii && d.g === '●' ? '@' : d.g, lit: d.lit,
      })),
    })),
    frondKey: FROND_KEY,
    rows, cols,
  };
}

// Flatten the model plus its date overlay into a grid of {g, col, solid}.
// `solid` marks the collision mask: trunk bark and the hanging date bundles
// (stem + fruit) are solid, crown leaves are not — see toSolidMask() below
// and world.ts's entityBlocksTile, which reads it so the player can walk
// through the canopy but still bumps the trunk and any dangling bunch.
export function render(M, ascii = false) {
  const ramp = ascii ? ASCII_DOT : DOT;
  const { cells, rows, cols, bundles } = M;
  const out = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y][x];
      if (c) out[y][x] = { g: c.k === 'bark' ? c.g : ramp[c.gi % ramp.length], col: c.col, solid: c.k === 'bark' };
    }
  }
  for (const b of bundles) {
    const bx = b.ax;
    for (let i = 0; i < b.stemLen; i++) {
      const y = b.ay + i;
      if (y >= 0 && y < rows && bx >= 0 && bx < cols) out[y][bx] = { g: '|', col: 'p', solid: true };
    }
    const clusterY = b.ay + b.stemLen;
    const spineBottom = Math.max(...b.dates.map((d) => d.oy));
    for (let i = 0; i <= spineBottom - b.stemLen; i++) {
      const y = Math.round(clusterY + i - 0.5);
      if (y >= 0 && y < rows && bx >= 0 && bx < cols && !out[y][bx]) out[y][bx] = { g: '|', col: 'p', solid: true };
    }
    for (const d of b.dates) {
      const x = Math.round(bx + d.ox), y = Math.round(clusterY + d.oy - b.stemLen);
      if (x >= 0 && x < cols && y >= 0 && y < rows) {
        out[y][x] = { g: ascii && d.g === '●' ? '@' : d.g, col: d.lit ? 'n' : 'm', solid: true };
      }
    }
  }
  return out;
}

// crop() re-exported from genutils.mjs. Trims blank border rows/cols so the
// sprite is only as large as the tree; the trunk range needs the same shift
// it reports.
export const crop = cropShared;

// One date bundle on its own, as a standalone sprite — this is what a shaken
// palm leaves lying on the ground. Generated from the SAME bundle data the
// animation drops, so the thing that lands and the thing you pick up are the
// same object drawn the same way.
export function toBunch(M, idx = 0, ascii = false) {
  const b = M.bundles[idx];
  const W = 32, H = 28, cx = 16, cy = 2;
  const g = Array.from({ length: H }, () => Array(W).fill(null));
  const spineBottom = Math.max(...b.dates.map((d) => d.oy));
  for (let s = 0; s <= spineBottom - b.stemLen; s++) {
    const y = Math.round(cy + s);
    if (g[y]) g[y][cx] = { g: '|', col: 'p' };
  }
  for (const d of b.dates) {
    const x = Math.round(cx + d.ox), y = Math.round(cy + d.oy - b.stemLen);
    if (g[y] && x >= 0 && x < W) {
      g[y][x] = { g: ascii && d.g === '●' ? '@' : d.g, col: d.lit ? 'n' : 'm' };
    }
  }
  return toSprite(crop(g).grid);
}

// Grid -> the two parallel string[] the game's ColoredSprite consumes. Rows are
// padded to one rectangle so every colours row aligns with its art row exactly.
export function toSprite(grid) {
  const w = Math.max(...grid.map((r) => r.length));
  return {
    sprite: grid.map((r) => Array.from({ length: w }, (_, x) => (r[x] ? r[x].g : ' ')).join('')),
    colors: grid.map((r) => Array.from({ length: w }, (_, x) => (r[x] ? r[x].col : '.')).join('')),
  };
}

// Grid -> a collision mask, same shape/crop as sprite: a glyph only where
// render() marked the cell solid (trunk bark + date bundles), blank
// everywhere else (crown leaves) even though the sprite draws something
// there. world.ts's entityBlocksTile reads this instead of the sprite for
// any entity that has one.
export function toSolidMask(grid) {
  const w = Math.max(...grid.map((r) => r.length));
  return grid.map((r) => Array.from({ length: w }, (_, x) => (r[x]?.solid ? '#' : ' ')).join(''));
}
