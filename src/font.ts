// The game's fonts and the ratios that come with them. Everything that draws
// glyphs or turns ch / em into on-screen proportions takes them from here.
//
// Two fonts ship with the game (src/fonts, cut down by
// scripts/subset-font.py), so every player draws with the same glyphs:
//   Asciia Mono  the main font: Cascadia Code (the look the game was made
//                in), renamed as its licence asks of a modified copy
//   Sarasa Mono  ONLY the fallback, for what Cascadia lacks (‡ ∘ ◆ ◇ ● ◯ ※ …)
// Sizes in px are never fixed here: the game measures a real cell at runtime
// (App.tsx's dims probe) and follows zoom and scale from that.
import main400 from './fonts/asciia-mono-400.woff2';
import main500 from './fonts/asciia-mono-500.woff2';
import main600 from './fonts/asciia-mono-600.woff2';
import main700 from './fonts/asciia-mono-700.woff2';
import fallbackRegular from './fonts/sarasa-mono-regular.woff2';
import fallbackBold from './fonts/sarasa-mono-bold.woff2';

export const FONT_FAMILY = 'Asciia Mono';
export const FALLBACK_FAMILY = 'Sarasa Mono';

// The bundled main font, then the bundled fallback for the characters it
// lacks; then the emergency faces (styles.css "Game Fallback …"), each a
// system monospace scaled to the 0.6em cell and given the main font's line
// metrics, so the grid holds even if only the glyph shapes differ. (A locally
// installed Sarasa isn't listed: its 0.5em cells would squeeze the grid.)
// Keep the CSS default for --game-font (styles.css :root) the same.
export const GAME_FONT = [
  `'${FONT_FAMILY}'`,
  `'${FALLBACK_FAMILY}'`,
  "'Game Fallback Cascadia'",
  "'Game Fallback Consolas'",
  "'Game Fallback Menlo'",
  "'Game Fallback DejaVu'",
  "'Game Fallback Courier'",
  'monospace',
].join(', ');

// a character's width in em: an invariant of the bundled fonts (both centred
// in 0.6em cells by scripts/subset-font.py, the cell every sprite and the
// terrain were drawn for), not a stand-in for measuring
export const CH_EM = 0.6;

// How much taller a text line is than a character is wide (1 / CH_EM, 5/3):
// a line is this many ground rows tall, so the terrain's blocks are true 1:1
// squares (8.4 px at the 14 px font), and the shapes built on that (ocean
// noise, bush clumps, minimap cells, the diagonal walk speed, the player's
// and fences' shadows) use the same number.
export const WORLD_ASPECT = 1 / CH_EM;

// --game-font for the CSS, from the one copy above
if (typeof document !== 'undefined') document.documentElement.style.setProperty('--game-font', GAME_FONT);

export type FontLoad = 'ok' | 'failed' | 'timeout';

// Loads every bundled face; 'ok' only when all actually loaded (FontFace
// .load() rejects on a network or decode error). document.fonts.check() is
// no proof: it says true when no face of that name exists at all.
export async function loadGameFont(timeoutMs = 5000): Promise<FontLoad> {
  const face = (family: string, url: string, weight: string) =>
    new FontFace(family, `url(${url}) format('woff2')`, { weight, style: 'normal' });
  const faces = [
    face(FONT_FAMILY, main400, '1 450'),
    face(FONT_FAMILY, main500, '451 550'),
    face(FONT_FAMILY, main600, '551 650'),
    face(FONT_FAMILY, main700, '651 1000'),
    face(FALLBACK_FAMILY, fallbackRegular, '1 550'),
    face(FALLBACK_FAMILY, fallbackBold, '551 1000'),
  ];
  let timer = 0;
  let late = false;
  const timeout = new Promise<FontLoad>(
    (res) =>
      (timer = window.setTimeout(() => {
        late = true;
        res('timeout');
      }, timeoutMs)),
  );
  const load = Promise.all(faces.map((f) => f.load())).then(
    (loaded): FontLoad => {
      // after a timeout the game may already be drawing with a fallback: a
      // late font would swap glyphs under cached sprites, so it stays out
      if (late) return 'timeout';
      for (const f of loaded) document.fonts.add(f);
      return loaded.every((f) => f.status === 'loaded') ? 'ok' : 'failed';
    },
    (): FontLoad => 'failed',
  );
  const out = await Promise.race([load, timeout]);
  window.clearTimeout(timer);
  return out;
}

// The width of a character in em in the font that actually draws: 0.5 for
// Sarasa and every working fallback. Off by more than 1 % means the grid
// ratios above don't hold on this machine.
export function measureChEm(): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return CH_EM;
  ctx.font = `100px ${GAME_FONT}`;
  return ctx.measureText('MMMMMMMMMM').width / 1000;
}
export const fontMetricsOk = () => Math.abs(measureChEm() - CH_EM) <= CH_EM * 0.01;
