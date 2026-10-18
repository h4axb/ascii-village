// ---------------------------------------------------------------------------
// The surprise library: small pictures (a flower, a fish, a bird, …) one of
// which is added to a crafted item when the player asked for a surprise
// (design A's "Yes, surprise me", design B's surprise preference). Any
// library item can get any fitting one; where it goes and how big it is is
// worked out from the item's own silhouette, so the library stays modular:
// a new decoration is one picture plus where it likes to sit.
//
//   top     sits on the item's upper surface (a flower on a can's lid, a
//           bird on a ship's deck rail, a crown on a dog's head)
//   float   floats just off an upper corner (a butterfly, a star)
//   side    sits on the item's body near one edge (a ladybug)
//   beside  next to a lower corner, partly outside (a fish jumping by the hull)
//
// Pictures are pixel maps ('.' = clear), drawn into the composed picture
// before it is baked into glyphs (refCraft.ts buildFromMatch), so they get
// the same glyph treatment as the item.
// ---------------------------------------------------------------------------
import type { Img } from '../glyph/bake';

export type Anchor = 'top' | 'float' | 'side' | 'beside';
export type SurpriseFit = 'ships' | 'watering' | 'pets';
export interface Surprise {
  id: string;
  name: string; // as Mitchy says it ("a little fish")
  anchor: Anchor;
  size: number; // height as a share of the item's height
  fits: SurpriseFit[];
  map: string[];
}

const C: Record<string, [number, number, number]> = {
  O: [58, 36, 24], // outline
  P: [242, 154, 184], // pink
  R: [214, 90, 78], // red
  Y: [239, 203, 92], // yellow
  G: [79, 138, 60], // green
  L: [124, 195, 90], // light green
  B: [90, 160, 216], // blue
  W: [244, 241, 230], // white
  C: [232, 214, 160], // cream
  K: [43, 43, 51], // black
  A: [233, 149, 79], // orange
  U: [154, 108, 201], // purple
};

export const SURPRISES: Surprise[] = [
  {
    id: 'flower', name: 'a little flower', anchor: 'top', size: 0.34, fits: ['ships', 'watering', 'pets'],
    map: [
      '..OO.OO..',
      '.OPPOPPO.',
      'OPPPPPPPO',
      'OPPOYOPPO',
      '.OPYYYPO.',
      'OPPOYOPPO',
      'OPPPPPPPO',
      '.OPPOPPO.',
      '..OOGOO..',
      '.LL.G....',
      '..LLG.LL.',
      '....GLL..',
    ],
  },
  {
    id: 'mushroom', name: 'a tiny mushroom', anchor: 'top', size: 0.28, fits: ['watering', 'pets'],
    map: [
      '..OOOOO..',
      '.ORRWRRO.',
      'ORWRRRWRO',
      'ORRRRRRRO',
      'OOOOOOOOO',
      '..OCCCO..',
      '..OCCCO..',
      '..OOOOO..',
    ],
  },
  {
    id: 'bird', name: 'a little bird', anchor: 'top', size: 0.3, fits: ['ships', 'watering', 'pets'],
    map: [
      '...OOOO...',
      '..OBBBBO..',
      '.OBWKBBBO.',
      'OYOBBBBBBO',
      '.OBBBBLBBO',
      '..OBBLLBO.',
      '...OOOOO..',
      '....Y..Y..',
    ],
  },
  {
    id: 'crown', name: 'a tiny crown', anchor: 'top', size: 0.22, fits: ['ships', 'pets'],
    map: [
      'O...O...O',
      'OO.OYO.OO',
      'OYOYYYOYO',
      'OYYYRYYYO',
      'OYYYYYYYO',
      'OOOOOOOOO',
    ],
  },
  {
    id: 'sprout', name: 'a little sprout', anchor: 'top', size: 0.28, fits: ['watering', 'pets'],
    map: [
      '.OO...OO.',
      'OLLO.OLLO',
      'OLLLOLLLO',
      '.OLLGLLO.',
      '..OOGOO..',
      '....G....',
      '....G....',
    ],
  },
  {
    id: 'butterfly', name: 'a butterfly', anchor: 'float', size: 0.28, fits: ['ships', 'watering', 'pets'],
    map: [
      'OO.......OO',
      'OUUO...OUUO',
      'OUYUO.OUYUO',
      '.OUUUOUUUO.',
      '..OOUKUOO..',
      '.OUUOKOUUO.',
      '.OUUO.OUUO.',
      '..OO...OO..',
    ],
  },
  {
    id: 'heart', name: 'a little heart', anchor: 'float', size: 0.26, fits: ['watering', 'pets'],
    map: [
      '.OO...OO.',
      'ORRO.ORRO',
      'ORWRORRRO',
      'ORRRRRRRO',
      '.ORRRRRO.',
      '..ORRRO..',
      '...ORO...',
      '....O....',
    ],
  },
  {
    id: 'star', name: 'a shining star', anchor: 'float', size: 0.28, fits: ['ships', 'watering', 'pets'],
    map: [
      '....O....',
      '...OYO...',
      '...OYO...',
      'OOOOYOOOO',
      '.OYYWYYO.',
      '..OYYYO..',
      '.OYYOYYO.',
      '.OYO.OYO.',
      '.OO...OO.',
    ],
  },
  {
    id: 'ladybug', name: 'a ladybug', anchor: 'side', size: 0.22, fits: ['watering', 'pets'],
    map: [
      '..OOO..',
      '.OKKKO.',
      'ORRKRRO',
      'ORKRKRO',
      'ORRKRRO',
      '.ORRRO.',
      '..OOO..',
    ],
  },
  {
    id: 'fish', name: 'a little fish', anchor: 'beside', size: 0.3, fits: ['ships', 'watering'],
    map: [
      '....OOOO....',
      '..OOBBBBO..O',
      '.OBWBBBBBOOB',
      'OBKBBBBBBBBO',
      '.OBBBBBBBOOB',
      '..OOBBBBO..O',
      '....OOOO....',
    ],
  },
];

// a small seeded random (the same prompt gets the same surprise)
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickSurprise(fit: SurpriseFit | null, seed: string): Surprise {
  const list = SURPRISES.filter((s) => !fit || s.fits.includes(fit));
  return list[Math.floor(rng(seed)() * list.length)] ?? SURPRISES[0];
}

// Where the decoration goes on this picture, and how big: from the item's
// opaque pixels (its box, its upper surface, its edges).
export function placeSurprise(img: Img, s: Surprise, seed: string): { x: number; y: number; scale: number } | null {
  const { w, h, data } = img;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 127;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (solid(x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  const rows = s.map.length, cols = Math.max(...s.map.map((r) => r.length));
  // the decoration's height in picture pixels: a share of the item, never so
  // small it can't be read once baked
  const scale = Math.max(1, Math.max(H * s.size, 16) / rows);
  const dw = cols * scale, dh = rows * scale;
  const r = rng(seed + s.id);
  const right = r() < 0.5;
  const surface = (x: number) => {
    for (let y = y0; y <= y1; y++) if (solid(x, y)) return y;
    return -1;
  };
  let x: number, y: number;
  switch (s.anchor) {
    case 'top': {
      // a flat-ish spot on the upper surface, away from the very edges and
      // from thin tall bits (masts, handles): the lower half of the surface
      const from = Math.round(x0 + W * 0.2), to = Math.round(x0 + W * 0.8);
      const spots: { x: number; y: number }[] = [];
      for (let cx = from; cx <= to; cx++) {
        const sy = surface(cx);
        if (sy < 0) continue;
        const flat = Math.abs(surface(cx - 2) - sy) <= 2 && Math.abs(surface(cx + 2) - sy) <= 2;
        if (flat) spots.push({ x: cx, y: sy });
      }
      if (!spots.length) return null;
      const ys = spots.map((p) => p.y).sort((a, b) => a - b);
      const mid = ys[Math.floor(ys.length * 0.5)];
      const low = spots.filter((p) => p.y >= mid - H * 0.05);
      const at = (low.length ? low : spots)[Math.floor(r() * (low.length || spots.length))];
      x = at.x - dw / 2;
      y = at.y - dh * 0.85; // sits on it, a little sunk in
      break;
    }
    case 'float':
      x = right ? x1 - dw * 0.3 : x0 - dw * 0.7;
      y = y0 - dh * 0.35;
      break;
    case 'side': {
      const ry = Math.round(y0 + H * (0.45 + r() * 0.25));
      let ex = right ? x1 : x0;
      if (right) while (ex > x0 && !solid(ex, ry)) ex--;
      else while (ex < x1 && !solid(ex, ry)) ex++;
      x = right ? ex - dw * 1.2 : ex + dw * 0.2;
      y = ry - dh / 2;
      break;
    }
    case 'beside':
      x = right ? x1 - dw * 0.15 : x0 - dw * 0.85;
      y = y1 - dh * 1.1;
      break;
  }
  return { x: Math.round(Math.max(0, Math.min(w - dw, x))), y: Math.round(Math.max(0, Math.min(h - dh, y))), scale };
}

// The picture with the decoration drawn in (a copy; nearest-neighbour, so
// its pixels stay crisp before the bake). Returns the drawn part's pixels so
// the caller can mark them.
export function drawSurprise(img: Img, s: Surprise, at: { x: number; y: number; scale: number }): { img: Img; pixels: number[] } {
  const data = new Uint8ClampedArray(img.data);
  const pixels: number[] = [];
  const rows = s.map.length, cols = Math.max(...s.map.map((r) => r.length));
  const dw = Math.round(cols * at.scale), dh = Math.round(rows * at.scale);
  for (let py = 0; py < dh; py++)
    for (let px = 0; px < dw; px++) {
      const k = s.map[Math.floor(py / at.scale)]?.[Math.floor(px / at.scale)];
      const rgb = k && C[k];
      if (!rgb) continue;
      const x = at.x + px, y = at.y + py;
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const i = y * img.w + x;
      data[i * 4] = rgb[0];
      data[i * 4 + 1] = rgb[1];
      data[i * 4 + 2] = rgb[2];
      data[i * 4 + 3] = 255;
      pixels.push(i);
    }
  return { img: { w: img.w, h: img.h, data }, pixels };
}
