import { chromium } from 'playwright';
import fs from 'node:fs';
// Bakes the bench cut out by scripts/cut-bench.py into an editor asset
// (src/data/assets/bench.json) with the game's own baker, in the browser:
//   pnpm dev   (another terminal; needs the playwright package)
//   python3 scripts/cut-bench.py /tmp/bench && node scripts/bake-bench.mjs /tmp/bench src/data/assets
// The seat (where the player sits) is marked in src/data/seats.json, editable
// in the world editor (E, Markers tab, "Seats").
const D = process.argv[2], OUT = process.argv[3];
const COLS = 60; // glyph cells across: about one per art pixel (each draws two characters)
const SCALE = 0.17; // 120 characters at 0.17: about 5 tiles, two and a half players
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage();
await p.goto('http://127.0.0.1:5173/0');
// the game mounts once its bundled font has loaded (src/main.tsx)
await p.waitForFunction(() => document.documentElement.dataset.font);
const url = 'data:image/png;base64,' + fs.readFileSync(`${D}/bench.png`).toString('base64');
const r = await p.evaluate(async ({ url, cols }) => {
  const B = await import('/src/glyph/bake.ts');
  const A = await import('/src/glyph/atlas.ts');
  const Sp = await import('/src/glyph/sprite.ts');
  const atlas = A.buildAtlas(B.DEFAULTS.ramp + B.DEFAULTS.edgeGlyphs);
  const im = new Image();
  im.src = url;
  await im.decode();
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const baked = B.bake({ w: c.width, h: c.height, data: d.data }, { ...B.DEFAULTS, bg: 'alpha', signs: 0, cols, fillHoles: false, outline: 0.2 }, atlas);
  return Sp.bakedToSprite(baked);
}, { url, cols: COLS });
await b.close();
// it stands on its legs: only the bottom tile's worth of rows blocks, so
// the player walks up to the seat's front
const FOOT_ROWS = Math.round(2 / SCALE);
const solid = r.sprite.map((l, i) => (i >= r.sprite.length - FOOT_ROWS ? l : ' '.repeat(l.length)));
const asset = {
  generated: { source: 'assets/refs/bench/bench.webp (cut by scripts/cut-bench.py, baked by scripts/bake-bench.mjs)', note: `${COLS} glyph cells wide at ${SCALE}: about 5 tiles` },
  label: 'Bench with a blanket',
  kind: 'bench',
  group: 'Furniture',
  scale: SCALE,
  interactable: true,
  palette: r.palette,
  sprite: r.sprite,
  colors: r.colors,
  solid,
};
fs.writeFileSync(`${OUT}/bench.json`, JSON.stringify(asset) + '\n');
console.log('bench', r.sprite.length, 'rows x', Math.max(...r.sprite.map((l) => l.length)), 'chars,', Object.keys(r.palette).length, 'colours');
