// ---------------------------------------------------------------------------
// Transcribe a square-celled reference .svg (one <text x y fill>glyph</text>
// per cell, text-anchor:middle + dominant-baseline:central, viewBox divided
// evenly into cols x rows -- the format these two reference files use) into
// a baked src/data/<slug>.json, per docs/AssetTranscriptionWorkflow.md.
//
// This is a MECHANICAL decode + column-double, not a creative transcription
// pass -- the glyph/colour choice was already made by whatever produced the
// reference svg. Column-doubling (ArtStyleGuide §1) compensates for the
// source being square-celled while this game's own character grid is not
// (TILE_CH/TILE_LN = 4/2 = exactly 2, so doubling every source column lines
// the sprite up 1:1 with the game's tile aspect).
//
//   node scripts/svg-glyph-to-asset.mjs <svgPath> <slug>
// ---------------------------------------------------------------------------
import { readFile, writeFile } from 'node:fs/promises';

const [, , svgPath, slug] = process.argv;
if (!svgPath || !slug) {
  console.error('Usage: node scripts/svg-glyph-to-asset.mjs <svgPath> <slug>');
  process.exit(1);
}

const svg = await readFile(svgPath, 'utf8');

const viewBoxMatch = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
if (!viewBoxMatch) throw new Error('no viewBox found');
const vbW = Number(viewBoxMatch[1]);
const vbH = Number(viewBoxMatch[2]);

const gridMatch = svg.match(/(\d+)\s*(?:by|&#215;|x|×)\s*(\d+) glyphs/i);
if (!gridMatch) throw new Error('no "NN by MM glyphs" label found (aria-label/title)');
const cols = Number(gridMatch[1]);
const rows = Number(gridMatch[2]);

const cellW = vbW / cols;
const cellH = vbH / rows;

const sprite = Array.from({ length: rows }, () => Array(cols).fill(' '));
const colorGrid = Array.from({ length: rows }, () => Array(cols).fill('.'));
const paletteByHex = new Map(); // hex -> key
let nextKey = 0;
function keyFor(hex) {
  if (paletteByHex.has(hex)) return paletteByHex.get(hex);
  // base-36 short keys: a, b, ... z, 10, 11, ... -- plenty for a few hundred
  // unique tones without colliding with '.' (the "no override" sentinel).
  const key = nextKey.toString(36);
  nextKey += 1;
  paletteByHex.set(hex, key);
  return key;
}

const textRe = /<text x="([\d.]+)" y="([\d.]+)" fill="(#[0-9a-fA-F]{6})">(.*?)<\/text>/g;
let m;
let count = 0;
while ((m = textRe.exec(svg))) {
  const x = Number(m[1]);
  const y = Number(m[2]);
  const hex = m[3];
  // XML-unescape the handful of entities export/reference tools use.
  const ch = m[4].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  const col = Math.round((x - cellW / 2) / cellW);
  const row = Math.round((y - cellH / 2) / cellH);
  if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
  sprite[row][col] = ch;
  colorGrid[row][col] = keyFor(hex);
  count += 1;
}

// Column-double: each source column c becomes output columns 2c and 2c+1,
// identical glyph+colour, so a square source cell reads as one "tile-square"
// in this game's 4ch x 2ln tile grid.
const doubledSprite = sprite.map((row) => row.flatMap((ch) => [ch, ch]).join(''));
const doubledColors = colorGrid.map((row) => row.flatMap((k) => [k, k]).join(''));

const palette = {};
for (const [hex, key] of paletteByHex) palette[key] = hex;

const out = {
  generated: {
    source: svgPath.split(/[\\/]/).pop(),
    transcribedBy: 'claude',
    promptVersion: 1,
    generatedAt: new Date().toISOString(),
    note: 'Mechanically decoded from a pre-rendered square-celled glyph SVG, then column-doubled (ArtStyleGuide §1) -- not a from-scratch palette transcription, so the palette is per-source-tone (many keys) rather than the usual small curated set. solid mask omitted (advisory only, add in the placement editor after eyeballing collision needs).',
  },
  palette,
  sprite: doubledSprite,
  colors: doubledColors,
};

const outPath = new URL(`../src/data/${slug}.json`, import.meta.url);
await writeFile(outPath, JSON.stringify(out, null, 2) + '\n');

console.log(
  `Wrote src/data/${slug}.json -- ${doubledSprite[0].length}x${doubledSprite.length} chars ` +
    `(source ${cols}x${rows}, doubled), ${Object.keys(palette).length} palette keys, ${count} glyphs decoded.`,
);
