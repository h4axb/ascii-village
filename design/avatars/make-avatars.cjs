// the chat avatars as pixel SVGs: one square per sprite pixel (the sprites draw
// each pixel as two glyphs), colours lifted into the UI's pastel range, on a
// rounded pastel square
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('sprites.json', 'utf8'));
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hsl = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l]; const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; return [h / 6, s, l]; };
const hsl2hex = ([h, s, l]) => { const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join(''); };
const pastel = (hex, P) => { const [h, s, l] = rgb2hsl(hex2rgb(hex)); return hsl2hex([h, Math.min(P.smax, s * P.sk + P.sa), P.l0 + P.lk * l]); };
function build(who, rowsUsed, bg, P, name) {
  const s = d[who], rows = s.sprite.slice(0, rowsUsed), cols = s.colors.slice(0, rowsUsed);
  const w = Math.max(...rows.map((l) => l.length)) / 2, h = rows.length;
  const box = 100, top = P.top, side = P.side;
  // a sprite pixel is two glyphs wide and one line high: in the game about 1.2 times as wide as high
  const A = P.aspect ?? 1.2;
  const ph = Math.min((box - top) / h, (box - 2 * side) / (w * A)), pw = ph * A;
  const x0 = (box - pw * w) / 2, y0 = box - ph * h; // anchored to the bottom: the body runs out of the frame
  let cells = '';
  const used = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][2 * x] ?? ' ', ch2 = rows[y][2 * x + 1] ?? ' ';
    if (ch === ' ' && ch2 === ' ') continue;
    const key = cols[y]?.[ch !== ' ' ? 2 * x : 2 * x + 1];
    const base = s.palette[key];
    if (!base) continue;
    const c = pastel(base, P);
    used[c] = (used[c] || 0) + 1;
    cells += `<rect x="${(x0 + x * pw).toFixed(2)}" y="${(y0 + y * ph).toFixed(2)}" width="${(pw + 0.06).toFixed(2)}" height="${(ph + 0.06).toFixed(2)}" fill="${c}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200" shape-rendering="crispEdges">
<!-- ${name}: the chat avatar as pixel art (from the game sprite, one square per pixel, in-game sprite colours) -->
<defs><clipPath id="r"><rect width="100" height="100" rx="22"/></clipPath></defs>
<g clip-path="url(#r)"><rect width="100" height="100" fill="${bg}"/>${cells}</g>
</svg>
`;
  return svg;
}
const P = JSON.parse(process.argv[2] || '{}');
const def = { l0: 0.3, lk: 0.66, sk: 1.0, sa: 0.12, smax: 0.85, top: 8, side: 6 };
const p = { ...def, ...P };
const out = process.argv[3] || '/home/user/ascii-village/design/avatars';
fs.writeFileSync(`${out}/mitchy.svg`, build('mitchy', 24, p.bgM || '#fbc08f', { ...p, sa: p.saM ?? 0.24, l0: p.l0M ?? 0.27, top: 7, aspect: 1 }, 'Mitchy'));
fs.writeFileSync(`${out}/player.svg`, build('player', 22, p.bgP || '#fbb7cc', { ...p, top: 10 }, 'Player'));
