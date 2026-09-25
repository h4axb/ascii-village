// ---------------------------------------------------------------------------
// BUILD-TIME — bake the date palm into src/data/palm.json
//
//   node scripts/build-palm.mjs [--cols 48] [--rows 45] [--seed 9] [--ascii]
//
// Offline and deterministic (no model call, unlike the other two build scripts)
// — the seed alone decides the tree, so re-running with the same flags gives a
// byte-identical file. Re-roll the look with --seed, resize with --cols/--rows,
// or swap the ambiguous-width glyphs for an ASCII ramp with --ascii.
//
// Defaults are 48x45 (-> 31x23 chars cropped, 8x12 tiles in-game): the size
// the tree had been at, confirmed against `place-palms.mjs` output recorded
// earlier in this session. A plain rebake with no flags had silently drifted
// this back up to a since-abandoned 64x60 (-> 41x32, 11x16 tiles) at some
// point; if you deliberately want that bigger tree back, pass the size
// explicitly rather than relying on the defaults.
// ---------------------------------------------------------------------------

import { writeFile } from 'node:fs/promises';
import { buildModel, render, crop, toSprite, toSolidMask, toAnim, toBunch, PALETTE } from './lib/palm.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const cols = arg('cols', 48);
const rows = arg('rows', 45);
const seed = arg('seed', 9);
const ascii = process.argv.includes('--ascii');

const model = buildModel({ cols, rows, seed, ascii });
const { grid, dx, dy } = crop(render(model, ascii));
const { sprite, colors } = toSprite(grid);
// Per request: the crown's leaves don't block movement, only the trunk and
// the hanging date bundles (fruit) do — see toSolidMask()/render() in
// lib/palm.mjs and entityBlocksTile in world.ts, which reads this instead
// of `sprite` for any entity that ships one.
const solid = toSolidMask(grid);

// The trunk's column range, in the CROPPED sprite's own coordinates. Baked
// for reference/debugging — the actual collision box is `solid` above now,
// not this rectangle (an earlier version of the game used a trunk-only
// collision box; world.ts moved to the precise per-glyph `solid` mask).
const trunk = { x0: model.trunk.x0 - dx, x1: model.trunk.x1 - dx };

// what the runtime needs to redraw frames itself (sway, flicker, falling dates)
const anim = toAnim(model, { dx, dy, w: sprite[0].length, h: sprite.length }, ascii);

// the collectible: one bundle, exactly as the animation drops it
const bunch = toBunch(model, 0, ascii);

// only ship palette entries the grids actually use
const used = new Set(
  [...colors, ...anim.baseColors, ...bunch.colors].flatMap((r) => [...r]).filter((k) => k !== '.'),
);
const palette = Object.fromEntries(Object.entries(PALETTE).filter(([k]) => used.has(k)));

const out = { generated: { cols, rows, seed, ascii }, trunk, palette, sprite, colors, solid, bunch, anim };
const json = JSON.stringify(out, null, 2);
await writeFile(new URL('../src/data/palm.json', import.meta.url), json);

const w = sprite[0].length;
const solidCells = solid.reduce((n, r) => n + [...r].filter((c) => c !== ' ').length, 0);
console.log(
  `Wrote src/data/palm.json — ${w}x${sprite.length} chars ` +
    `= ${Math.ceil(w / 4)}x${Math.ceil(sprite.length / 2)} tiles, ` +
    `trunk cols ${trunk.x0}-${trunk.x1}, ${Object.keys(palette).length} palette keys, ` +
    `${anim.fronds.length} animated fronds, ${anim.bundles.length} date bundles, ` +
    `bunch ${bunch.sprite[0].length}x${bunch.sprite.length}, ${solidCells} solid (trunk+fruit) cells, ` +
    `${(json.length / 1024).toFixed(1)}kB` +
    (ascii ? ', ASCII ramp' : ''),
);
