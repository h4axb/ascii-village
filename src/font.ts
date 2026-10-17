// The game's one font and the ratios that come with it. Everything that draws
// glyphs or turns ch / em into on-screen proportions takes them from here.
//
// The font ships with the game (src/fonts, cut down by
// scripts/subset-font.py), so every player draws with the same glyphs.
// Sizes in px are never fixed here: the game measures a real cell at runtime
// (App.tsx's dims probe) and follows zoom and scale from that.
import regularUrl from './fonts/sarasa-mono-regular.woff2';
import boldUrl from './fonts/sarasa-mono-bold.woff2';

export const FONT_FAMILY = 'Sarasa Mono';

// The bundled face first; then a locally installed Sarasa; then the
// emergency faces (styles.css "Sarasa Fallback …"), each a system monospace
// scaled to Sarasa's 0.5em width and given Sarasa's line metrics, so the grid
// holds even if only the glyph shapes differ. Keep the CSS default for
// --game-font (styles.css :root) the same.
export const GAME_FONT = [
  `'${FONT_FAMILY}'`,
  "'Sarasa Mono SC'",
  "'Sarasa Fixed SC'",
  "'Sarasa Term SC'",
  "'Sarasa Fallback Iosevka'",
  "'Sarasa Fallback Cascadia'",
  "'Sarasa Fallback Consolas'",
  "'Sarasa Fallback Menlo'",
  "'Sarasa Fallback DejaVu'",
  "'Sarasa Fallback Courier'",
  'monospace',
].join(', ');

// a character's width in em: an invariant of the bundled font (checked by
// scripts/subset-font.py for every sprite glyph), not a stand-in for
// measuring
export const CH_EM = 0.5;

// How much taller a text line is than a character is wide (1 / CH_EM): a
// line is this many ground rows tall, so the terrain's blocks are true 1:1
// squares, and the shapes built on that (ocean noise, bush clumps, minimap
// cells, the diagonal walk speed, the player's and fences' shadows) use the
// same number. (It was 14 / 8.4, from a 0.6em font, until the game bundled
// its 0.5em one.)
export const WORLD_ASPECT = 1 / CH_EM;

// --game-font for the CSS, from the one copy above
if (typeof document !== 'undefined') document.documentElement.style.setProperty('--game-font', GAME_FONT);

export type FontLoad = 'ok' | 'failed' | 'timeout';

// Loads both bundled faces; 'ok' only when both actually loaded (FontFace
// .load() rejects on a network or decode error). document.fonts.check() is
// no proof: it says true when no face of that name exists at all.
export async function loadGameFont(timeoutMs = 5000): Promise<FontLoad> {
  const faces = [
    new FontFace(FONT_FAMILY, `url(${regularUrl}) format('woff2')`, { weight: '1 550', style: 'normal' }),
    new FontFace(FONT_FAMILY, `url(${boldUrl}) format('woff2')`, { weight: '551 1000', style: 'normal' }),
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
