// ---------------------------------------------------------------------------
// The surprise library: when the player asks for a surprise (design A's
// "Yes, surprise me", design B's surprise preference), one small extra is
// added to a library item before it is baked into glyphs. Each kind of item
// has its own category, placed from the picture's own marks so it sits
// where it belongs:
//
//   pets     accessories on the head (the dogs' marked "head_top" area):
//            a flower pin on the right side of the head (no stem), a bow on
//            top, a party hat on top; or a butterfly / heart floating by the
//            head. They sit on the head's upper edge, found pixel by pixel.
//   ships    a new motif on the sail (the "sail" part; a pirate ship's skull
//            is painted over first): red-white stripes, a flower pattern,
//            polka dots, stars, hearts or one big flower. A ship without a
//            sail gets a fish jumping by the hull or a bird on the deck.
//   cans     a flower where a flower fits: painted on the body, or standing
//            on the lid; polka dots on the body, a bird on the lid, or a
//            butterfly floating by.
//
// No crown: a crown only comes when the player asks for one. A new extra is
// one picture or pattern plus where it goes (an `apply` below).
// ---------------------------------------------------------------------------
import type { Layer } from '../glyph/refs';
import { blankPart, partBox } from '../glyph/refs';

export type SurpriseFit = 'ships' | 'watering' | 'pets';
type Box = { x: number; y: number; w: number; h: number };
export interface SurpriseCtx {
  layer: Layer;
  areaOf: (name: string) => Box | null;
}
interface SurpriseDef {
  id: string;
  name: string; // as Mitchy says it ("a flower pin on its head")
  fits: SurpriseFit;
  apply: (c: SurpriseCtx) => boolean; // false: this item has no place for it
}

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  O: [58, 36, 24], // outline
  P: [242, 154, 184], // pink
  R: [214, 90, 78], // red
  Y: [239, 203, 92], // yellow
  G: [79, 138, 60], // green
  L: [124, 195, 90], // light green
  B: [90, 160, 216], // blue
  W: [244, 241, 230], // white
  K: [43, 43, 51], // black
  U: [154, 108, 201], // purple
};

// ---- pictures ('.' = clear) ----
const FLOWER_PIN = ['..OO.OO..', '.OPPOPPO.', 'OPPPPPPPO', 'OPPOYOPPO', '.OPYYYPO.', 'OPPOYOPPO', 'OPPPPPPPO', '.OPPOPPO.', '..OO.OO..'];
const FLOWER_STEM = [...FLOWER_PIN.slice(0, 8), '..OOGOO..', '.LL.G....', '..LLG.LL.', '....GLL..', '....G....'];
const BOW = ['OO.....OO', 'ORRO.ORRO', 'ORRRORRRO', 'ORRROORRO', 'ORRRORRRO', 'ORRO.ORRO', 'OO.....OO'];
const PARTY_HAT = ['....Y....', '...OYO...', '...OBO...', '..OBRBO..', '..OBBBO..', '.OBRBRBO.', '.OBBBBBO.', 'OBRBRBRBO', 'OOOOOOOOO'];
const BIRD = ['...OOOO...', '..OBBBBO..', '.OBWKBBBO.', 'OYOBBBBBBO', '.OBBBBLBBO', '..OBBLLBO.', '...OOOOO..', '....Y..Y..'];
const BUTTERFLY = ['OO.......OO', 'OUUO...OUUO', 'OUYUO.OUYUO', '.OUUUOUUUO.', '..OOUKUOO..', '.OUUOKOUUO.', '.OUUO.OUUO.', '..OO...OO..'];
const HEART = ['.OO...OO.', 'ORRO.ORRO', 'ORWRORRRO', 'ORRRRRRRO', '.ORRRRRO.', '..ORRRO..', '...ORO...', '....O....'];
const FISH = ['....OOOO....', '..OOBBBBO..O', '.OBWBBBBBOOB', 'OBKBBBBBBBBO', '.OBBBBBBBOOB', '..OOBBBBO..O', '....OOOO....'];
// small stamps for the patterns (no outline: they're painted on cloth)
const STAMP_FLOWER = ['.P.', 'PYP', '.P.'];
const STAMP_STAR = ['..Y..', '.YYY.', 'YYYYY', '.Y.Y.'];
const STAMP_HEART = ['RR.RR', 'RRRRR', '.RRR.', '..R..'];
const STAMP_DOT = ['.WW.', 'WWWW', 'WWWW', '.WW.'];

const cols = (m: string[]) => Math.max(...m.map((r) => r.length));

// Draw a picture at (x, y), `scale` picture pixels per pixel. `clip`: only
// on that part's pixels (a pattern painted on the sail); else it is added
// on top as its own opaque pixels.
function stamp(l: Layer, map: string[], x: number, y: number, scale: number, clip?: string) {
  const d = l.img.data;
  const dw = Math.round(cols(map) * scale), dh = Math.round(map.length * scale);
  for (let py = 0; py < dh; py++)
    for (let px = 0; px < dw; px++) {
      const k = map[Math.floor(py / scale)]?.[Math.floor(px / scale)];
      const rgb = k && C[k];
      if (!rgb) continue;
      const X = Math.round(x) + px, Y = Math.round(y) + py;
      if (X < 0 || Y < 0 || X >= l.img.w || Y >= l.img.h) continue;
      const i = Y * l.img.w + X;
      if (clip && l.part[i] !== clip) continue;
      d[i * 4] = rgb[0];
      d[i * 4 + 1] = rgb[1];
      d[i * 4 + 2] = rgb[2];
      d[i * 4 + 3] = 255;
      if (!clip) l.part[i] = 'detail';
    }
}
const solid = (l: Layer, x: number, y: number) => x >= 0 && y >= 0 && x < l.img.w && y < l.img.h && l.img.data[(y * l.img.w + x) * 4 + 3] > 127;
// the topmost solid pixel of a column, from `y0` down
function surface(l: Layer, x: number, y0 = 0): number {
  for (let y = Math.max(0, y0); y < l.img.h; y++) if (solid(l, x, y)) return y;
  return -1;
}
// a picture sitting on the upper edge inside `box`, at `at` (0..1 across it),
// sunk in by `sink` of its height; it is `share` of the box's WIDTH wide (a
// marked head or lid is a wide, flat box)
function sitOn(l: Layer, box: Box, map: string[], at: number, share: number, sink = 0.25): boolean {
  const scale = Math.max(1, (box.w * share) / cols(map));
  const dw = cols(map) * scale, dh = map.length * scale;
  const cx = Math.round(box.x + box.w * at);
  const sy = surface(l, cx, box.y - Math.round(box.h * 0.5));
  if (sy < 0 || sy > box.y + box.h * 1.5) return false;
  stamp(l, map, cx - dw / 2, sy - dh * (1 - sink), scale);
  return true;
}
// the biggest connected patch of a part (one sail of two)
function biggestPatch(l: Layer, part: string): Box | null {
  const seen = new Uint8Array(l.part.length);
  let best: { n: number; box: Box } | null = null;
  for (let i = 0; i < l.part.length; i++) {
    if (seen[i] || l.part[i] !== part) continue;
    const stack = [i];
    seen[i] = 1;
    let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const x = j % l.img.w, y = (j / l.img.w) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const k of [j - 1, j + 1, j - l.img.w, j + l.img.w])
        if (k >= 0 && k < l.part.length && !seen[k] && l.part[k] === part && Math.abs((k % l.img.w) - x) <= 1) {
          seen[k] = 1;
          stack.push(k);
        }
    }
    if (!best || n > best.n) best = { n, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
  }
  return best?.box ?? null;
}
// the whole picture's solid box
function solidBox(l: Layer): Box | null {
  let x0 = l.img.w, y0 = l.img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < l.img.h; y++)
    for (let x = 0; x < l.img.w; x++)
      if (solid(l, x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// a pattern over a whole part, its stamps on a staggered grid
function pattern(l: Layer, part: string, map: string[], perRow: number) {
  const b = partBox(l, part);
  if (!b || b.w < 6 || b.h < 6) return false;
  const step = b.w / perRow;
  const scale = Math.max(1, (step * 0.62) / cols(map));
  let row = 0;
  for (let y = b.y + step * 0.3; y < b.y + b.h; y += step * 0.85, row++)
    for (let x = b.x + (row % 2 ? step * 0.5 : 0) + step * 0.25; x < b.x + b.w; x += step) stamp(l, map, x, y, scale, part);
  return true;
}
function stripes(l: Layer, part: string, a: RGB, b: RGB, bands: number) {
  const box = partBox(l, part);
  if (!box || box.h < 6) return false;
  const d = l.img.data;
  const band = box.h / bands;
  for (let i = 0; i < l.part.length; i++) {
    if (l.part[i] !== part) continue;
    const y = (i / l.img.w) | 0;
    const rgb = Math.floor((y - box.y) / band) % 2 ? b : a;
    // keep the cloth's own light and shade: scale by the pixel's brightness
    const lum = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 200;
    const k = Math.max(0.6, Math.min(1.1, lum));
    for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.min(255, rgb[c] * k);
  }
  return true;
}
// a pirate ship's skull goes first, painted over in the sail's colour
function clearMotif(l: Layer) {
  if (l.part.includes('motif')) blankPart(l, 'motif', 'sail');
}
const hasSail = (l: Layer) => l.part.includes('sail');
const onSail = (l: Layer, paint: () => boolean) => {
  if (!hasSail(l)) return false;
  clearMotif(l);
  return paint();
};

// ---- the library ----
const SURPRISES: SurpriseDef[] = [
  // pets: on the head
  {
    id: 'flower-pin', name: 'a flower pin on its head', fits: 'pets',
    apply: ({ layer, areaOf }) => {
      const head = areaOf('head_top');
      return !!head && sitOn(layer, head, FLOWER_PIN, 0.82, 0.95, 0.5);
    },
  },
  {
    id: 'bow', name: 'a little bow on its head', fits: 'pets',
    apply: ({ layer, areaOf }) => {
      const head = areaOf('head_top');
      return !!head && sitOn(layer, head, BOW, 0.5, 1.1, 0.4);
    },
  },
  {
    id: 'party-hat', name: 'a party hat', fits: 'pets',
    apply: ({ layer, areaOf }) => {
      const head = areaOf('head_top');
      return !!head && sitOn(layer, head, PARTY_HAT, 0.5, 0.95, 0.15);
    },
  },
  {
    id: 'butterfly', name: 'a butterfly friend', fits: 'pets',
    apply: ({ layer, areaOf }) => {
      const head = areaOf('head_top') ?? solidBox(layer);
      if (!head) return false;
      const scale = Math.max(1, (head.w * 0.95) / cols(BUTTERFLY));
      stamp(layer, BUTTERFLY, head.x + head.w * 1.1, head.y - head.h * 0.6, scale);
      return true;
    },
  },
  {
    id: 'heart', name: 'a little heart', fits: 'pets',
    apply: ({ layer, areaOf }) => {
      const head = areaOf('head_top') ?? solidBox(layer);
      if (!head) return false;
      const scale = Math.max(1, (head.w * 0.8) / cols(HEART));
      stamp(layer, HEART, head.x - cols(HEART) * scale * 0.9, head.y - head.h * 0.5, scale);
      return true;
    },
  },
  // ships: a new motif on the sail
  {
    id: 'sail-stripes', name: 'red and white stripes on the sail', fits: 'ships',
    apply: ({ layer }) => onSail(layer, () => stripes(layer, 'sail', [196, 70, 58], [240, 232, 214], 6)),
  },
  {
    id: 'sail-flowers', name: 'a flower pattern on the sail', fits: 'ships',
    apply: ({ layer }) => onSail(layer, () => pattern(layer, 'sail', STAMP_FLOWER, 4)),
  },
  {
    id: 'sail-dots', name: 'polka dots on the sail', fits: 'ships',
    apply: ({ layer }) => onSail(layer, () => pattern(layer, 'sail', STAMP_DOT, 4)),
  },
  {
    id: 'sail-stars', name: 'stars on the sail', fits: 'ships',
    apply: ({ layer }) => onSail(layer, () => pattern(layer, 'sail', STAMP_STAR, 3)),
  },
  {
    id: 'sail-hearts', name: 'hearts on the sail', fits: 'ships',
    apply: ({ layer }) => onSail(layer, () => pattern(layer, 'sail', STAMP_HEART, 3)),
  },
  {
    id: 'sail-flower', name: 'a big flower on the sail', fits: 'ships',
    apply: ({ layer }) =>
      onSail(layer, () => {
        const b = biggestPatch(layer, 'sail');
        if (!b) return false;
        const scale = Math.max(1, (Math.min(b.w, b.h) * 0.7) / FLOWER_PIN.length);
        stamp(layer, FLOWER_PIN, b.x + b.w / 2 - (cols(FLOWER_PIN) * scale) / 2, b.y + b.h / 2 - (FLOWER_PIN.length * scale) / 2, scale, 'sail');
        return true;
      }),
  },
  // ships without a sail: by the hull, or on the deck
  {
    id: 'fish', name: 'a fish jumping by the hull', fits: 'ships',
    apply: ({ layer }) => {
      if (hasSail(layer)) return false;
      const b = solidBox(layer);
      if (!b) return false;
      const scale = Math.max(1, (b.h * 0.3) / FISH.length);
      stamp(layer, FISH, b.x + b.w - cols(FISH) * scale * 0.2, b.y + b.h - FISH.length * scale * 1.2, scale);
      return true;
    },
  },
  {
    id: 'deck-bird', name: 'a little bird on the deck', fits: 'ships',
    apply: ({ layer }) => {
      if (hasSail(layer)) return false;
      const b = solidBox(layer);
      return !!b && sitOn(layer, { x: b.x, y: b.y + b.h * 0.3, w: b.w, h: b.h * 0.7 }, BIRD, 0.4, 0.22, 0.2);
    },
  },
  // watering cans: a flower where a flower fits, and friends
  {
    id: 'body-flower', name: 'a flower painted on the side', fits: 'watering',
    apply: ({ layer, areaOf }) => {
      const a = areaOf('body_detail') ?? areaOf('body_front') ?? partBox(layer, 'body');
      if (!a) return false;
      const scale = Math.max(1, (Math.min(a.w, a.h) * 0.75) / FLOWER_PIN.length);
      stamp(layer, FLOWER_PIN, a.x + a.w / 2 - (cols(FLOWER_PIN) * scale) / 2, a.y + a.h / 2 - (FLOWER_PIN.length * scale) / 2, scale, 'body');
      return true;
    },
  },
  {
    id: 'lid-flower', name: 'a flower on the lid', fits: 'watering',
    apply: ({ layer, areaOf }) => {
      const lid = areaOf('lid_top');
      return !!lid && sitOn(layer, lid, FLOWER_STEM, 0.5, 0.8, 0.1);
    },
  },
  {
    id: 'can-dots', name: 'polka dots', fits: 'watering',
    apply: ({ layer }) => pattern(layer, 'body', STAMP_DOT, 4),
  },
  {
    id: 'lid-bird', name: 'a little bird on the lid', fits: 'watering',
    apply: ({ layer, areaOf }) => {
      const lid = areaOf('lid_top');
      return !!lid && sitOn(layer, lid, BIRD, 0.5, 0.9, 0.15);
    },
  },
  {
    id: 'can-butterfly', name: 'a butterfly', fits: 'watering',
    apply: ({ layer }) => {
      const b = solidBox(layer);
      if (!b) return false;
      const scale = Math.max(1, (b.h * 0.24) / BUTTERFLY.length);
      stamp(layer, BUTTERFLY, b.x + b.w * 0.75, b.y - BUTTERFLY.length * scale * 0.4, scale);
      return true;
    },
  },
];

// a small seeded random (the same prompt gets the same surprise)
function seeded(seed: string) {
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

// Add one fitting surprise to the composed picture; its name, or null when
// none fits this item. Tries the category's extras in a seeded order until
// one finds its place; `only` forces one (by id), for testing.
export function applySurprise(fit: SurpriseFit | null, layer: Layer, areaOf: SurpriseCtx['areaOf'], seed: string, only?: string): string | null {
  if (!fit) return null;
  const rand = seeded(seed);
  const list = SURPRISES.filter((s) => s.fits === fit && (!only || s.id === only))
    .map((s) => ({ s, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.s);
  for (const s of list) {
    // each try on a copy: a failed one leaves nothing behind
    const trial: Layer = { img: { w: layer.img.w, h: layer.img.h, data: new Uint8ClampedArray(layer.img.data) }, part: [...layer.part] };
    if (s.apply({ layer: trial, areaOf })) {
      layer.img.data.set(trial.img.data);
      for (let i = 0; i < trial.part.length; i++) layer.part[i] = trial.part[i];
      return s.name;
    }
  }
  return null;
}
export const SURPRISE_IDS = (fit: SurpriseFit) => SURPRISES.filter((s) => s.fits === fit).map((s) => s.id);
