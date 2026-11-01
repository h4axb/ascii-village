// Frames dashboard screenshots as portfolio images, all in one style: a calm
// #fafafa background, a small light-grey caption ("Neu · Desktop · Standard"),
// rounded corners, a soft shadow, 2× resolution.
//
//   node scripts/portfolio-frame.cjs <in-dir> <out-dir>
//
// <in-dir> holds the raw screenshots, named <version>-<device>-<state>.png:
//   version: aktuell | neu      device: desktop (1300 px) | tablet (834) | mobile (390)
//   state:   any slug, e.g. 1-default, 2-bearbeiten; its caption comes from
//            STATE below, else the slug without its number
// Each one becomes <out-dir>/<version>-<device>-<state>.png.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [, , inDir, outDir] = process.argv;
if (!inDir || !outDir) {
  console.error('usage: node scripts/portfolio-frame.cjs <in-dir> <out-dir>');
  process.exit(1);
}
const DEVICE = { desktop: ['Desktop', 1300], tablet: ['Tablet', 834], mobile: ['Mobile', 390] };
const VERSION = { aktuell: 'Aktuell', neu: 'Neu' };
const STATE = { default: 'Standard', bearbeiten: 'Bearbeiten', 'vor-speichern': 'Vor dem Speichern', 'filter-ungeprueft': 'Filter Ungeprüft', auswahl: 'Auswahl', 'aussagen-karte': 'Aussagen-Karte', 'menue-ohne-auswahl': 'Aktionen ohne Auswahl', 'menue-auswahl': 'Aktionen mit Auswahl', 'nach-ungeprueft': 'Nach „ungeprüft markieren“' };
const font = fs.readFileSync(path.join(__dirname, '../public/fonts/inter-latin-wght-normal.woff2')).toString('base64');

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch();
  for (const f of fs.readdirSync(inDir).filter((x) => x.endsWith('.png'))) {
    const m = /^(aktuell|neu)-(desktop|tablet|mobile)-(.+)\.png$/.exec(f);
    if (!m) continue;
    const [, v, dev, st] = m;
    const [devL, w] = DEVICE[dev];
    const slug = st.replace(/^\d+-/, '');
    const stL = STATE[slug] ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const img = fs.readFileSync(path.join(inDir, f)).toString('base64');
    const pad = dev === 'mobile' ? 48 : 72;
    const html = `<html><head><style>@font-face{font-family:I;src:url(data:font/woff2;base64,${font})}
      body{margin:0;background:#fafafa;font-family:I,sans-serif;padding:${pad}px;display:inline-block}
      .cap{color:#b4b4ba;font-size:${dev === 'mobile' ? 13 : 15}px;letter-spacing:.04em;margin:0 0 18px 2px}
      img{display:block;width:${w}px;border-radius:${dev === 'mobile' ? 22 : 14}px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.06);border:1px solid #ededf0}
      </style></head><body><div class="cap">${VERSION[v]} · ${devL} · ${stL}</div><img src="data:image/png;base64,${img}"></body></html>`;
    const p = await b.newPage({ viewport: { width: w + pad * 2, height: 600 }, deviceScaleFactor: 2 });
    await p.setContent(html);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(outDir, f), fullPage: true });
    await p.close();
  }
  await b.close();
})();
