// ---------------------------------------------------------------------------
// FENCES — a modular glyph fence for the world editor (Assets → Fences): rail
// pieces, upright pieces, posts and a gate, in two woods (red-brown and
// light), plus the wooden sign board. Every piece is drawn at FENCE_SCALE so
// it fills whole tiles: a rail, upright or post piece is exactly one tile, so
// a row of them (Shift-drag in the editor) joins up seamlessly.
//
// The gate is 4 tiles wide (a post at each end, two leaves between) so the
// player (2 tiles wide) fits through once it's open. In the game F opens and
// closes it (interact.ts 'gate'): open, it's drawn with its leaves swung
// inward and only its posts block.
//
// Keys: a lit wood (tops, upper rails), b wood, c shadowed wood (lower rails,
// braces), w the notice paper.
// ---------------------------------------------------------------------------

export const FENCE_SCALE = 0.5; // 8 glyphs x 4 rows = one tile

export interface FenceArt {
  sprite: string[];
  colors: string[];
}

const WOODS = {
  red: { a: '#d98a6c', b: '#a6533c', c: '#6c3124', w: '#f2ead9' },
  light: { a: '#ecd29e', b: '#c4955a', c: '#7f5a32', w: '#f2ead9' },
} as const;
export type FenceWood = keyof typeof WOODS;
export const fencePalette = (wood: FenceWood): Record<string, string> => ({ ...WOODS[wood] });

// glyphs and their colour keys, row by row
const art = (rows: [string, string][]): FenceArt => ({ sprite: rows.map((r) => r[0]), colors: rows.map((r) => r[1]) });

// a rail piece, seen from the front: a post and two rails
export const FENCE_RAIL = art([
  ['nn  nn  ', 'aa..aa..'],
  ['##==##==', 'bbaabbaa'],
  ['##  ##  ', 'bc..bc..'],
  ['##==##==', 'bcccbccc'],
]);
// an upright piece: the fence running down the screen, seen from above
export const FENCE_UPRIGHT = art([
  ['   ##   ', '...ab...'],
  ['   ||   ', '...bc...'],
  ['   ##   ', '...ab...'],
  ['   ||   ', '...bc...'],
]);
// a lone post: a row's end or a corner
export const FENCE_POST = art([
  ['   nn   ', '...aa...'],
  ['   ##   ', '...bb...'],
  ['   ##   ', '...bc...'],
  ['   ##   ', '...cc...'],
]);

// The gate (4 tiles: 32 glyphs). Its leaves span columns 2-29.
function gateArt(open: boolean): FenceArt {
  const W = 32;
  const rows: [string[], string[]][] = Array.from({ length: 4 }, () => [Array(W).fill(' '), Array(W).fill('.')]);
  const put = (r: number, c: number, ch: string, k: string) => {
    rows[r][0][c] = ch;
    rows[r][1][c] = k;
  };
  // the posts
  for (const c0 of [0, W - 2]) {
    put(0, c0, 'n', 'a');
    put(0, c0 + 1, 'n', 'a');
    for (let r = 1; r < 4; r++) {
      put(r, c0, '#', 'b');
      put(r, c0 + 1, '#', r === 3 ? 'c' : 'b');
    }
  }
  if (!open) {
    // two leaves: rails top and bottom, planks between, a diagonal brace each
    for (let c = 2; c < W - 2; c++) {
      put(1, c, '=', 'a');
      put(3, c, '=', 'c');
      put(2, c, c % 2 ? '|' : ' ', 'b');
    }
    put(0, 15, 'n', 'a');
    put(0, 16, 'n', 'a');
    for (const [c, ch] of [[6, '\\'], [8, '\\'], [23, '/'], [25, '/']] as const) put(2, c, ch, 'c');
  } else {
    // the leaves swung in: short angled panels against each post
    const leaf = [
      [1, 2, '\\'], [1, 3, '='], [2, 3, '\\'], [2, 4, '|'], [3, 4, '\\'], [3, 5, '='],
      [1, W - 3, '/'], [1, W - 4, '='], [2, W - 4, '/'], [2, W - 5, '|'], [3, W - 5, '/'], [3, W - 6, '='],
    ] as const;
    for (const [r, c, ch] of leaf) put(r, c, ch, ch === '=' ? 'a' : 'c');
  }
  return { sprite: rows.map((r) => r[0].join('')), colors: rows.map((r) => r[1].join('')) };
}
export const GATE_CLOSED = gateArt(false);
export const GATE_OPEN = gateArt(true);
// what blocks while it's open: the posts only (the leaves swing aside)
export const GATE_OPEN_SOLID = GATE_OPEN.sprite.map((l) =>
  l
    .split('')
    .map((ch, i) => (i < 2 || i >= l.length - 2 ? ch : ' '))
    .join(''),
);

// the wooden sign board on its post (1 tile wide, 2 tall)
export const SIGN_BOARD = art([
  [' .----. ', '.abbbba.'],
  [' |====| ', '.baaaab.'],
  [" '----' ", '.cbbbbc.'],
  ['   ||   ', '...bc...'],
  ['   ||   ', '...bc...'],
]);
// the same with a notice pinned on
export const SIGN_NOTICE = art([
  [' .----. ', '.abbbba.'],
  [' |=[]=| ', '.bawwab.'],
  [" '----' ", '.cbbbbc.'],
  ['   ||   ', '...bc...'],
  ['   ||   ', '...bc...'],
]);
