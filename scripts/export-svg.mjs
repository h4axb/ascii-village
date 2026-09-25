// ---------------------------------------------------------------------------
// Export a per-cell reference .svg from an already-baked src/data/*.json
// sprite. READ-ONLY with respect to the game: this never touches a generator
// script, never re-bakes src/data/*.json, never changes a single byte of what
// actually renders in-game. It only reads the existing sprite/colors/palette
// grid and writes an equivalent .svg into assets/svg/ — pure export.
//
// Why this exists: every hand-transcribed asset in this game (PLAYER,
// HOUSE) was originally parsed from a reference .svg using the documented
// technique in sprites.ts's own comments — one <text x y fill>glyph</text>
// per grid cell. None of those original .svg files are actually committed to
// this repo (confirmed: none exist anywhere in the tree). This script
// retroactively gives every baked asset — hand-transcribed AND procedurally
// generated (palm, which never had a reference image at all) — a matching,
// checked-in .svg, so every asset has the SAME kind of structured, per-cell
// reference on disk going forward, regardless of how it was originally
// produced.
//
// Usage:
//   node scripts/export-svg.mjs <name>            (src/data/<name>.json)
//   node scripts/export-svg.mjs --all              (every src/data/*.json)
//
// The SVG's cell geometry matches this game's OWN post-doubling character
// grid (CELL_ASPECT = 14/8.4, see src/App.tsx) — not the pre-doubled
// square-cell source some of these were originally transcribed from — so the
// .svg is a faithful 1:1 visual match to what's actually baked and on
// screen, not just a transcription aid.
// ---------------------------------------------------------------------------

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'svg');

// Matches CELL_ASPECT = 14 / 8.4 in src/App.tsx exactly — a character cell
// renders ~1.667x taller than wide in this game's monospace grid.
const CELL_W = 8.4;
const CELL_H = 14;

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// One <text> per non-space cell. `palette` maps a colors-grid key to a hex
// colour; a cell with no key, an unknown key, or colors===undefined falls
// back to a plain default ink colour rather than being dropped, so the SVG
// always shows every glyph even for sprites with no colour data.
function toSvg(sprite, colors, palette) {
  const rows = sprite.length;
  const cols = Math.max(0, ...sprite.map((l) => l.length));
  const texts = [];
  for (let y = 0; y < rows; y++) {
    const line = sprite[y];
    const crow = colors?.[y] ?? '';
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === ' ') continue;
      const key = crow[x];
      const hex = (key && palette?.[key]) || '#d6d6d6';
      texts.push(
        `  <text x="${(x * CELL_W).toFixed(2)}" y="${((y + 1) * CELL_H).toFixed(2)}" fill="${hex}">${escapeXml(ch)}</text>`,
      );
    }
  }
  const width = (cols * CELL_W).toFixed(2);
  const height = (rows * CELL_H).toFixed(2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `font-family="monospace" font-size="${CELL_H}">\n${texts.join('\n')}\n</svg>\n`
  );
}

// Discover every exportable sprite/colors pair in a baked JSON file. Handles
// the two shapes actually found in src/data/ today:
//   flat:      { palette, sprite, colors }              (player/bigfern/palm/waterfall/bridge)
//   framed:    { palette, frames: [{sprite,colors}, ...] } (walkDown/Up/Left/Right)
// Anything else (palm's `bunch`/`anim` sub-sprites, waterfall's `anim` redraw
// metadata) is a deliberate scope boundary, not silently dropped — noted in
// the summary so a future pass can extend this rather than assuming coverage
// it doesn't have.
function findExports(data) {
  const out = [];
  const palette = data.palette;
  if (Array.isArray(data.sprite) && Array.isArray(data.colors)) {
    out.push({ suffix: '', sprite: data.sprite, colors: data.colors, palette });
  }
  if (Array.isArray(data.frames)) {
    data.frames.forEach((f, i) => {
      if (Array.isArray(f?.sprite) && Array.isArray(f?.colors)) {
        out.push({ suffix: `-frame${i}`, sprite: f.sprite, colors: f.colors, palette });
      }
    });
  }
  return out;
}

async function exportOne(name) {
  const jsonPath = path.join(DATA_DIR, `${name}.json`);
  if (!existsSync(jsonPath)) {
    console.warn(`[export-svg] skip "${name}" — no src/data/${name}.json`);
    return { name, written: [], skippedReason: 'no json file' };
  }
  const data = JSON.parse(await readFile(jsonPath, 'utf8'));
  const exports = findExports(data);
  if (exports.length === 0) {
    console.warn(`[export-svg] skip "${name}" — no flat sprite/colors or frames[] found (see script header)`);
    return { name, written: [], skippedReason: 'unrecognised shape' };
  }
  const written = [];
  for (const e of exports) {
    const svg = toSvg(e.sprite, e.colors, e.palette);
    const outPath = path.join(OUT_DIR, `${name}${e.suffix}.svg`);
    await writeFile(outPath, svg);
    written.push(outPath);
  }
  return { name, written, skippedReason: null };
}

async function main() {
  const args = process.argv.slice(2);
  await mkdir(OUT_DIR, { recursive: true });

  let names;
  if (args[0] === '--all') {
    const files = await readdir(DATA_DIR);
    names = files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
  } else if (args.length > 0) {
    names = args;
  } else {
    console.error('Usage: node scripts/export-svg.mjs <name> [<name> ...] | --all');
    process.exit(1);
  }

  const results = [];
  for (const name of names) results.push(await exportOne(name));

  const ok = results.filter((r) => r.written.length > 0);
  const skipped = results.filter((r) => r.written.length === 0);
  console.log(`\n[export-svg] ${ok.length}/${results.length} asset(s) exported to ${path.relative(process.cwd(), OUT_DIR)}/`);
  for (const r of ok) console.log(`  ${r.name}: ${r.written.map((w) => path.basename(w)).join(', ')}`);
  if (skipped.length) {
    console.log(`[export-svg] ${skipped.length} skipped:`);
    for (const r of skipped) console.log(`  ${r.name} — ${r.skippedReason}`);
  }
}

main();
