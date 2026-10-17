import { chromium } from 'playwright';
import fs from 'node:fs';
// Bakes the PNGs from scripts/cut-fence.py into editor assets
// (src/data/assets/picket-*.json) with the game's own baker, in the browser:
//   pnpm dev   (another terminal; needs the playwright package)
//   python3 scripts/cut-fence.py /tmp/fence && node scripts/bake-fence.mjs /tmp/fence src/data/assets
const D = process.argv[2], OUT = process.argv[3];
const P = 498 / 48; // source px per glyph cell: three pickets = 48 cells = 3 tiles
const SCALE = 0.125;
const names = ['front', 'front-left', 'front-right', 'side-left', 'side-right', 'stick-left', 'stick-right', 'gate', 'gate-open'];
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage();
await p.goto('http://127.0.0.1:5173/0');
// the game mounts once its bundled font has loaded (src/main.tsx)
await p.waitForFunction(() => document.documentElement.dataset.font);
const imgs = Object.fromEntries(names.map((n) => [n, 'data:image/png;base64,' + fs.readFileSync(`${D}/${n}.png`).toString('base64')]));
const res = await p.evaluate(async ({ imgs, P }) => {
  const B = await import('/src/glyph/bake.ts');
  const A = await import('/src/glyph/atlas.ts');
  const Sp = await import('/src/glyph/sprite.ts');
  const atlas = A.buildAtlas(B.DEFAULTS.ramp + B.DEFAULTS.edgeGlyphs);
  const out = {};
  for (const [n, url] of Object.entries(imgs)) {
    const im = new Image(); im.src = url; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const img = { w: c.width, h: c.height, data: d.data };
    // the object's box, for the column count
    let x0 = 1e9, x1 = -1, y0 = 1e9;
    for (let i = 0; i < c.width * c.height; i++) if (d.data[i * 4 + 3] > 127) { const xx = i % c.width, yy = (i / c.width) | 0; x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, yy); }
    const cols = Math.round((x1 - x0 + 1) / P);
    const baked = B.bake(img, { ...B.DEFAULTS, bg: 'alpha', signs: 0, cols, fillHoles: false, outline: 0.2 }, atlas);
    const g = Sp.bakedToSprite(baked);
    out[n] = { ...g, cols, top: y0, rowOf: undefined };
  }
  return out;
}, { imgs, P });
await b.close();
// the open gate in the closed gate's palette (same keys for the same colours)
const gate = res['gate'], open = res['gate-open'];
const byHex = new Map(Object.entries(gate.palette).map(([k, h]) => [h, k]));
const KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const openColors = open.colors.map((row) => [...row].map((k) => {
  if (k === ' ') return ' ';
  const h = open.palette[k];
  if (byHex.has(h)) return byHex.get(h);
  // not in the closed gate: its nearest colour
  const rgb = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [r, g, bb] = rgb(h);
  let best = null, bd = 1e9;
  for (const [k, hh] of Object.entries(gate.palette)) {
    const [r2, g2, b2] = rgb(hh);
    const dd = (r - r2) ** 2 + (g - g2) ** 2 + (bb - b2) ** 2;
    if (dd < bd) (bd = dd), (best = k);
  }
  return best;
}).join(''));
// pad the open gate to the closed one's rows (both drop empty rows; same box)
console.log('gate rows', gate.sprite.length, open.sprite.length);
// tall pieces block only at their feet: the bottom tile's worth of rows
const FOOT_ROWS = 12;
const feet = (sprite) => sprite.map((l, i) => (i >= sprite.length - FOOT_ROWS ? l : ' '.repeat(l.length)));
const LABEL = {
  front: 'Picket fence', 'front-left': 'Picket fence, post on the left', 'front-right': 'Picket fence, post on the right',
  'side-left': 'Picket fence, side (left)', 'side-right': 'Picket fence, side (right)', gate: 'Picket fence gate',
  'stick-left': 'Picket fence, left side stick', 'stick-right': 'Picket fence, right side stick',
};
// rows from the source's top line: pieces that sit lower get blank rows on top
const ROW = 1.22 / P;
const ref = res['front-left'].top;
for (const n of Object.keys(LABEL)) {
  const r = res[n];
  const pad = n.startsWith('front') ? Math.max(0, Math.round((r.top - ref) * ROW)) : 0;
  const sprite = [...Array(pad).fill(''), ...r.sprite];
  const colors = [...Array(pad).fill(''), ...r.colors];
  const asset = {
    generated: { source: 'a picket-fence sheet (cut by scripts/cut-fence.py, baked by the Glyph Generator baker)', note: `${r.cols} glyph cells wide at ${SCALE}: three pickets = 3 tiles` },
    label: LABEL[n],
    kind: n === 'gate' ? 'gate' : 'fence',
    group: 'Fences',
    scale: SCALE,
    interactable: n === 'gate',
    palette: r.palette,
    sprite,
    colors,
    solid: feet(sprite),
  };
  if (n === 'gate') {
    const os = open.sprite;
    const ofs = gate.sprite.length - os.length;
    const oSprite = [...Array(Math.max(0, ofs)).fill(''), ...os];
    const oColors = [...Array(Math.max(0, ofs)).fill(''), ...openColors];
    asset.palette = gate.palette;
    // open, the gate blocks nothing (the fence beside it still does), so the
    // player always fits through whatever scale it's placed at
    asset.open = { sprite: oSprite, colors: oColors, solid: oSprite.map((l) => ' '.repeat(l.length)) };
  }
  fs.writeFileSync(`${OUT}/picket-${n}.json`, JSON.stringify(asset) + '\n');
  console.log(n, 'cols', r.cols, 'rows', sprite.length, 'pad', pad, 'w', Math.max(...sprite.map((l) => l.length)) * SCALE / 4, 'tiles');
}
