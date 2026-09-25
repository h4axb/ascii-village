// ---------------------------------------------------------------------------
// Find (and check) positions for the date palms.
//
//   node scripts/place-palms.mjs          # verify the spots in world.ts
//   node scripts/place-palms.mjs --search # propose fresh ones
//
// The palm is 11x16 tiles — nearly 4x the apple tree's footprint — so its
// placement can no longer be eyeballed. This bundles the REAL world.ts and
// tests candidate boxes against the actual isWater / structure / garden rules,
// rather than trusting arithmetic done by hand.
// ---------------------------------------------------------------------------

import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = new URL('../src/', import.meta.url).pathname.replace(/^\//, '');
const out = join(tmpdir(), `world-${Date.now()}.mjs`);
await build({
  stdin: {
    contents: `export * from './world'; export { PALM } from './sprites';`,
    resolveDir: src,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  outfile: out,
  define: { 'import.meta.env.DEV': 'false' },
  logLevel: 'error',
});
const W = await import('file://' + out.replace(/\\/g, '/'));
await rm(out, { force: true });

const { MAP_W, MAP_H, STRUCT_ENTS, spriteTiles, bbox, tileBoxesOverlap, isWater, PALM, PALM_SCALE } = W;
// the palm is DRAWN at PALM_SCALE, so its footprint is the scaled one
const { wT, hT } = spriteTiles(PALM, PALM_SCALE);

// everything a palm must avoid: all non-palm structures, plus the garden plot
const obstacles = STRUCT_ENTS.filter((e) => e.kind !== 'palm').map((e) => bbox(e));
const GARDEN_BOX = { x0: 30, y0: 40, x1: 38, y1: 48 }; // padded; see farm.ts GARDEN

function problems(x, y, others) {
  const bad = [];
  if (x < 0 || y < 0 || x + wT > MAP_W || y + hT > MAP_H) bad.push('off map');
  let wet = 0;
  for (let ty = y; ty < y + hT; ty++) {
    for (let tx = x; tx < x + wT; tx++) if (isWater(tx, ty)) wet++;
  }
  if (wet) bad.push(`${wet} water tiles`);
  const box = { x0: x, y0: y, x1: x + wT - 1, y1: y + hT - 1 };
  for (const o of obstacles) if (tileBoxesOverlap(o, box)) bad.push('hits a structure');
  if (tileBoxesOverlap(GARDEN_BOX, box)) bad.push('hits the garden');
  for (const o of others) if (tileBoxesOverlap(o, box)) bad.push('hits another palm');
  return bad;
}

const current = STRUCT_ENTS.filter((e) => e.kind === 'palm');
console.log(
  `palm: ${PALM[0].length}x${PALM.length} char grid, drawn at ${PALM_SCALE}x ` +
    `=> ${wT}x${hT} tiles  (apple tree was 3x4, house is 5x4)\n`,
);

if (process.argv.includes('--search')) {
  // greedy sweep, spreading the palms around the island's edge regions
  const placed = [];
  const targets = [[14, 20], [56, 20], [58, 46], [10, 52], [34, 70]];
  for (const [tx, ty] of targets) {
    let best = null;
    for (let r = 0; r <= 30 && !best; r++) {
      for (let dy = -r; dy <= r && !best; dy++) {
        for (let dx = -r; dx <= r && !best; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (!problems(x, y, placed).length) best = { x, y };
        }
      }
    }
    if (best) {
      placed.push({ x0: best.x, y0: best.y, x1: best.x + wT - 1, y1: best.y + hT - 1 });
      console.log(`  { id: 'palmN', x: ${best.x}, y: ${best.y} },`);
    } else console.log(`  // no clear spot near ${tx},${ty}`);
  }
} else {
  let ok = true;
  const placed = [];
  for (const e of current) {
    const bad = problems(e.x, e.y, placed);
    placed.push(bbox(e));
    if (bad.length) ok = false;
    console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${e.id} at (${e.x},${e.y})${bad.length ? '  — ' + bad.join(', ') : ''}`);
  }
  console.log(ok ? '\nall palms placed cleanly' : '\nre-run with --search for clear spots');
}
