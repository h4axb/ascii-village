import { chromium } from 'playwright';
import fs from 'node:fs';
// Bakes the crop art cut out by scripts/cut-crops.py into src/data/crops.json
// (farm.ts cropLook draws it in the garden bed; App.tsx's inventory the
// strawberry and the pumpkin) with the game's own baker, in the browser:
//   pnpm dev   (another terminal; needs the playwright package)
//   python3 scripts/cut-crops.py /tmp/crops && node scripts/bake-crops.mjs /tmp/crops src/data/crops.json
const D = process.argv[2], OUT = process.argv[3];
// glyph cells across: one per pixel of the art, so it keeps its pixel look
const COLS = { sprout: 17, strawberryPlant: 30, pumpkin: 18, strawberry: 16 };
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage();
await p.goto('http://127.0.0.1:5173/0');
// the game mounts once its bundled font has loaded (src/main.tsx)
await p.waitForFunction(() => document.documentElement.dataset.font);
const imgs = Object.fromEntries(Object.keys(COLS).map((n) => [n, 'data:image/png;base64,' + fs.readFileSync(`${D}/${n}.png`).toString('base64')]));
const res = await p.evaluate(async ({ imgs, COLS }) => {
  const B = await import('/src/glyph/bake.ts');
  const A = await import('/src/glyph/atlas.ts');
  const Sp = await import('/src/glyph/sprite.ts');
  const atlas = A.buildAtlas(B.DEFAULTS.ramp + B.DEFAULTS.edgeGlyphs);
  const out = {};
  for (const [n, url] of Object.entries(imgs)) {
    const im = new Image();
    im.src = url;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const baked = B.bake({ w: c.width, h: c.height, data: d.data }, { ...B.DEFAULTS, bg: 'alpha', signs: 0, cols: COLS[n], fillHoles: false, outline: 0 }, atlas);
    const g = Sp.bakedToSprite(baked);
    out[n] = { sprite: g.sprite, colors: g.colors, palette: g.palette };
  }
  return out;
}, { imgs, COLS });
await b.close();
fs.writeFileSync(OUT, JSON.stringify({ generated: 'assets/refs/crops (scripts/cut-crops.py, scripts/bake-crops.mjs)', ...res }) + '\n');
for (const [n, r] of Object.entries(res)) console.log(n, r.sprite.length, 'rows x', Math.max(...r.sprite.map((l) => l.length)), 'chars,', Object.keys(r.palette).length, 'colours');
