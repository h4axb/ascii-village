// The player's pixel shadow, shared by the game's player rig, the start
// screen and the editor's Start screen tab.
import { TILE_CH, TILE_LN } from './world';
import { themeSwatch } from './theme';

const CELL_ASPECT = 14 / 8.4; // ground blocks per text line

// The player's shadow: a flat pixel oval on the ground under the feet, in
// pixels of half a ground square (the terrain's background blocks are 1ch x
// 1ch from the world's origin: each holds 2 x 2 of them), so it sits exactly
// on the ground's pixel grid and still steps round at its ends. A
// slightly transparent dark grey: over grass it reads as darker grass, over
// the path as darker earth. Colour: the theme's player.shadow.
const PLAYER_SHADOW = { opacity: 0.3 };
const SHADOW_ROWS: [number, number][] = [
  [3, 6], // row: first pixel, width (of 12 half-squares)
  [1, 10],
  [1, 10],
  [3, 6],
];
// x, y: the rig's place (tiles); cx, footEm: the feet in the rig (ch, em)
export function PlayerShadow({ x, y, cx, footEm }: { x: number; y: number; cx: number; footEm: number }) {
  const rigX = x * TILE_CH, rigY = y * TILE_LN * CELL_ASPECT; // the rig, in ground blocks
  // centred on the feet, the feet about two thirds of the way down it,
  // snapped to the half-square grid
  const half = (v: number) => Math.round(v * 2) / 2;
  const bx0 = half(rigX + cx - 3);
  const by0 = half(rigY + footEm * CELL_ASPECT - 1.35);
  return (
    <svg
      className="player-shadow"
      viewBox="0 0 12 4"
      shapeRendering="crispEdges"
      aria-hidden="true"
      // ground rows are a fixed 1/CELL_ASPECT em tall (1ch only when the
      // font's ch is 0.6em), so the vertical goes in em
      preserveAspectRatio="none"
      style={{ left: `${bx0 - rigX}ch`, top: `${(by0 - rigY) / CELL_ASPECT}em`, width: '6ch', height: `${2 / CELL_ASPECT}em`, opacity: PLAYER_SHADOW.opacity }}
    >
      {SHADOW_ROWS.map(([x0, n], row) => (
        <rect key={row} x={x0} y={row} width={n} height={1} fill={themeSwatch('player.shadow')} />
      ))}
    </svg>
  );
}

