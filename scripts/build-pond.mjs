// ---------------------------------------------------------------------------
// Bake the pond asset from assets/refs/pond_animated.svg's "static" (shore/
// grass/reed) glyph group into src/data/pond-a.json.
//
// The reference SVG also ships "water-a"/"water-b" groups (a two-frame CSS
// ripple flicker over the water body), but per request the water is instead
// driven at runtime by a counter-scrolling-current formula (src/pondAnim.ts)
// rather than replaying those two baked frames — so this script only needs
// the water body's SHAPE, not its two colour states. That shape is baked
// here as a static ellipse test fitted to the reference image's own water
// extent, rather than transcribing several thousand near-duplicate ripple
// glyphs by hand.
//
//   node scripts/build-pond.mjs
// ---------------------------------------------------------------------------
import { readFile, writeFile } from 'node:fs/promises';

const svgPath = new URL('../assets/refs/pond_animated.svg', import.meta.url);
const svg = await readFile(svgPath, 'utf8');

const viewBoxMatch = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
const vbW = Number(viewBoxMatch[1]);
const vbH = Number(viewBoxMatch[2]);
const CELL = 20; // confirmed from the reference's own x/y step (font-size 15, 20x20 cells)
const cols = Math.round(vbW / CELL); // 90
const rows = Math.round(vbH / CELL); // 65

// ---- 1. decode the "static" group (shore/grass/reed glyphs) --------------
const staticMatch = svg.match(/<g id="static">([\s\S]*?)<\/g>/);
const staticSvg = staticMatch[1];

const sprite = Array.from({ length: rows }, () => Array(cols).fill(' '));
const colorGrid = Array.from({ length: rows }, () => Array(cols).fill('.'));

// Reserve 4 single-char keys for the animated water ramp (never assigned by
// the quantizer below) -- same hex ramp as the waterfall's pond cells
// (scripts/lib/waterfall.mjs PALETTE l/m/n/o), so the pond reads as the same
// "family" of water as the waterfall.
const ANIM_KEYS = ['W', 'X', 'Y', 'Z'];
const ANIM_HEX = { W: '#7fe8e0', X: '#3fb8c8', Y: '#1f7f96', Z: '#12505f' };

// Quantize each decoded hex to a coarse bucket (round each channel), then
// assign single-char keys from a safe alphabet -- ArtStyleGuide's small
// curated palette isn't realistic for a photographic reference at this
// density, but *unbounded* per-pixel keys silently break ColoredSprite (it
// indexes colors[y][x] as exactly one character; anything base36-encoded
// past index 35 becomes a 2-char key and mis-renders). Quantizing keeps keys
// single-char and caps the palette at a sane size.
const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV'
  .split('')
  .filter((c) => !ANIM_KEYS.includes(c));
const QUANT_STEP = 48;
function quantize(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const q = (v) => Math.round(v / QUANT_STEP) * QUANT_STEP;
  return `#${q(r).toString(16).padStart(2, '0')}${q(g).toString(16).padStart(2, '0')}${q(b).toString(16).padStart(2, '0')}`;
}
const paletteByHex = new Map(); // quantized hex -> key
let nextKey = 0;
function keyFor(hex) {
  const qh = quantize(hex);
  if (paletteByHex.has(qh)) return paletteByHex.get(qh);
  if (nextKey >= KEY_ALPHABET.length) throw new Error('palette overflow -- increase QUANT_STEP');
  const key = KEY_ALPHABET[nextKey++];
  paletteByHex.set(qh, key);
  return key;
}

const textRe = /<text x="([\d.]+)" y="([\d.]+)" fill="(#[0-9a-fA-F]{6})">(.*?)<\/text>/g;
let m;
while ((m = textRe.exec(staticSvg))) {
  const x = Number(m[1]), y = Number(m[2]), hex = m[3];
  const ch = m[4].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  const col = Math.round((x - CELL / 2) / CELL);
  const row = Math.round((y - CELL / 2) / CELL);
  if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
  sprite[row][col] = ch;
  colorGrid[row][col] = keyFor(hex);
}

// ---- 2. water body: ellipse fit to the reference's own water extent ------
// Fitted to the water-a/water-b groups' combined bounding box in the
// reference (x ~130-1630, y ~410-1190 in viewBox units): centre (44, 40),
// radii (37, 19) in CELL units.
const WCX = 44, WCY = 40, WRX = 37, WRY = 19;
const kind = Array.from({ length: rows }, () => Array(cols).fill(' '));
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    if (sprite[row][col] !== ' ') continue; // never overwrite a shore/reed glyph
    const d = ((col - WCX) / WRX) ** 2 + ((row - WCY) / WRY) ** 2;
    if (d > 1) continue;
    sprite[row][col] = '·';
    colorGrid[row][col] = ANIM_KEYS[(col + row) % ANIM_KEYS.length]; // baked default; overwritten every frame at runtime
    kind[row][col] = 'w';
  }
}

// ---- 3. solid mask: collider on the "sign" (shore/reed) glyphs only ------
// Water ('·', kind 'w') and true empty space both stay open; every other
// glyph -- the land/shore/reed symbols -- blocks.
const solid = Array.from({ length: rows }, (_, row) =>
  Array.from({ length: cols }, (_, col) => (sprite[row][col] !== ' ' && kind[row][col] !== 'w' ? '#' : ' ')),
);

// ---- 4. column-double everything (ArtStyleGuide §1 -- square source cells) ----
const dbl = (row) => row.flatMap((v) => [v, v]);
const doubledSprite = sprite.map((r) => dbl(r).join(''));
const doubledColors = colorGrid.map((r) => dbl(r).join(''));
const doubledKind = kind.map((r) => dbl(r).join(''));
const doubledSolid = solid.map((r) => dbl(r).join(''));

const palette = { ...ANIM_HEX };
for (const [hex, key] of paletteByHex) palette[key] = hex;

const out = {
  generated: {
    source: 'pond_animated.svg',
    transcribedBy: 'claude',
    promptVersion: 2,
    generatedAt: new Date().toISOString(),
    note:
      'Shore/reed glyphs mechanically decoded from the "static" group, quantized to a ' +
      `${paletteByHex.size}-key palette (ColoredSprite requires single-char ` +
      'colour keys, so per-pixel unbounded keys were not an option), then column-doubled. ' +
      'The water body itself is a fitted ellipse (WCX/WCY/WRX/WRY below), not a transcription ' +
      'of the reference\'s water-a/water-b ripple glyphs -- water is animated at runtime by ' +
      'pondFrame() (src/pondAnim.ts), the waterfall\'s own pond-cell formula reused standalone.',
    waterEllipse: { cx: WCX, cy: WCY, rx: WRX, ry: WRY },
  },
  palette,
  sprite: doubledSprite,
  colors: doubledColors,
  solid: doubledSolid,
  anim: {
    kind: doubledKind,
    dx: 0,
    dy: 0,
    cols: cols * 2,
    rows,
    pondG: ['-', '−', '=', '~', '_'],
  },
};

const outPath = new URL('../src/data/pond-a.json', import.meta.url);
await writeFile(outPath, JSON.stringify(out, null, 2) + '\n');

const waterCount = kind.flat().filter((k) => k === 'w').length;
const signCount = solid.flat().filter((s) => s === '#').length;
console.log(
  `Wrote src/data/pond-a.json -- ${doubledSprite[0].length}x${doubledSprite.length} chars, ` +
    `${Object.keys(palette).length} palette keys, ${waterCount} water cells, ${signCount} solid "sign" cells.`,
);
