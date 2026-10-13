// A signpost made of parts (the wayfinder): a post and boards that each point
// left or right and tilt on it, the whole sign flippable too - and the picture
// on each board (house, shop, pond) always the right way round.
//
// The asset file (src/data/assets/wayfinder.json) carries the parts as
// `layers`, on the source drawing's square glyph grid: the post, and per board
// its cells, its picture's cells and its pivot (on the post's centre line).
// composeSign() draws them for one placement's settings (world.json's
// `sign` on the placed object, set in the world editor's inspector) and
// converts the result to the game's cells like the asset converters do:
// columns doubled, rows stretched 1.22x.

export type SignCell = [x: number, y: number, glyph: string, key: string];
export interface SignBoard {
  pivot: [number, number];
  cells: SignCell[];
  icon: SignCell[];
}
export interface SignLayers {
  w: number;
  h: number;
  axis: number; // the post's centre line (x.5 for a post of even width)
  post: SignCell[];
  boards: SignBoard[];
  empty?: string; // the colour key of an empty cell ('.', or ' ' from the Glyph Generator)
}
export interface SignPanel {
  flip?: boolean; // points the other way (left, for a board drawn pointing right)
  tilt?: number; // degrees, clockwise
}
export interface SignSettings {
  flip?: boolean; // the whole sign mirrored (the pictures still not)
  panels?: SignPanel[];
}

export const SIGN_TILT_MAX = 30;
const STRETCH = 1.22; // like the asset converters
const TOP = 8; // rows of room above the drawing, for a tilted top board
const SIDE = 3; // columns of room either side, past the widest board

// glyphs that face a way, and their mirror images
const MIRROR: Record<string, string> = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«', '◄': '►', '►': '◄', '▌': '▐', '▐': '▌' };
const mirrorGlyph = (g: string) => MIRROR[g] ?? g;

// the canvas: symmetric about the post, so a board pointing either way fits,
// and the same whatever the settings (the object's size and foot never move)
function canvasOf(L: SignLayers) {
  let reach = 0;
  for (const c of [...L.post, ...L.boards.flatMap((b) => [...b.cells, ...b.icon])]) reach = Math.max(reach, Math.abs(c[0] - L.axis));
  const half = Math.ceil(reach) + SIDE;
  // a post of even width centres on a column edge: one column more, so the
  // canvas stays symmetric about it on whole columns
  const odd = L.axis % 1 !== 0;
  return { w: half * 2 + (odd ? 2 : 1), h: L.h + TOP, ox: Math.floor(half - L.axis + (odd ? 0.5 : 0)), oy: TOP };
}

const isDefault = (s?: SignSettings) => !s || (!s.flip && !(s.panels ?? []).some((p) => p && (p.flip || p.tilt)));

export function composeSign(L: SignLayers, s?: SignSettings): { sprite: string[]; colors: string[] } {
  const cv = canvasOf(L);
  const glyph: string[][] = Array.from({ length: cv.h }, () => Array(cv.w).fill(' '));
  const key: string[][] = Array.from({ length: cv.h }, () => Array(cv.w).fill(L.empty ?? '.'));
  const put = (x: number, y: number, g: string, k: string) => {
    const cx = x + cv.ox;
    const cy = y + cv.oy;
    if (cx < 0 || cy < 0 || cx >= cv.w || cy >= cv.h) return;
    glyph[cy][cx] = g;
    key[cy][cx] = k;
  };
  const signFlip = !!s?.flip;
  const mx = (x: number) => 2 * L.axis - x;

  // the post (mirrored with the sign)
  for (const [x, y, g, k] of L.post) put(signFlip ? mx(x) : x, y, signFlip ? mirrorGlyph(g) : g, k);

  // each board: mirrored if it points the other way, its picture only moved
  // along (never mirrored); then turned about its pivot
  L.boards.forEach((b, i) => {
    const p = s?.panels?.[i];
    const flip = !!p?.flip !== signFlip;
    const tilt = Math.max(-SIGN_TILT_MAX, Math.min(SIGN_TILT_MAX, p?.tilt ?? 0)) * (signFlip ? -1 : 1);
    const cells: SignCell[] = [];
    for (const [x, y, g, k] of b.cells) cells.push(flip ? [mx(x), y, mirrorGlyph(g), k] : [x, y, g, k]);
    if (b.icon.length) {
      let dx = 0;
      if (flip) {
        const xs = b.icon.map((c) => c[0]);
        const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
        dx = Math.round(mx(mid) - mid);
      }
      for (const [x, y, g, k] of b.icon) cells.push([x + dx, y, g, k]);
    }
    if (!tilt) {
      for (const [x, y, g, k] of cells) put(x, y, g, k);
      return;
    }
    // turned: every cell of the board's turned box takes the nearest cell of
    // the board, by the inverse turn (on the square grid)
    const src = new Map<string, SignCell>();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of cells) {
      src.set(`${c[0]},${c[1]}`, c);
      x0 = Math.min(x0, c[0]);
      x1 = Math.max(x1, c[0]);
      y0 = Math.min(y0, c[1]);
      y1 = Math.max(y1, c[1]);
    }
    const [px, py] = b.pivot;
    const a = (tilt * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const r = Math.ceil(Math.hypot(Math.max(px - x0, x1 - px), Math.max(py - y0, y1 - py))) + 1;
    for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++)
      for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
        const dx = x - px;
        const dy = y - py;
        const sx = Math.round(px + cos * dx + sin * dy);
        const sy = Math.round(py - sin * dx + cos * dy);
        const c = src.get(`${sx},${sy}`);
        if (c) put(x, y, c[2], c[3]);
      }
  });

  // to the game's cells: columns doubled, rows stretched
  const rows = Math.round(cv.h * STRETCH);
  const sprite: string[] = [];
  const colors: string[] = [];
  for (let i = 0; i < rows; i++) {
    // spread evenly, like the Glyph Generator (src/glyph/sprite.ts): every
    // row of the drawing shows, the last one too
    const r = Math.floor((i * cv.h) / rows);
    sprite.push(glyph[r].map((g) => g + g).join(''));
    colors.push(key[r].map((k) => k + k).join(''));
  }
  return { sprite, colors };
}

// one composition per distinct setting (the editor recomposes as you drag)
const cache = new WeakMap<SignLayers, Map<string, { sprite: string[]; colors: string[] }>>();
export function signArt(L: SignLayers, s?: SignSettings): { sprite: string[]; colors: string[] } {
  let m = cache.get(L);
  if (!m) cache.set(L, (m = new Map()));
  const k = isDefault(s) ? '' : JSON.stringify(s);
  let art = m.get(k);
  if (!art) {
    art = composeSign(L, isDefault(s) ? undefined : s);
    if (m.size > 200) m.clear();
    m.set(k, art);
  }
  return art;
}
