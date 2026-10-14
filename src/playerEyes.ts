// The eyes of the player's walk frames, drawn dark like the standing
// portrait's (its eyeRow 14) wherever the player is shown: the game, the
// start screen, the world editor. They're the frame's '·' cells where the
// eyes are - facing down, the face row's warm-brown ones (the same cells as
// standing, a row lower on some frames); side-on, the one pair in front of
// the face; walking up there are none. Returned as "x,y" keys, space-
// separated, for the sprite renderers' `eyes` prop.
import * as S from './sprites';
import { isWarmBrown } from './ColoredSprite';

type Dir = 'up' | 'down' | 'left' | 'right';
const PALETTES: Record<Dir, Record<string, string>> = {
  up: S.WALK_UP_PALETTE,
  down: S.WALK_DOWN_PALETTE,
  left: S.WALK_LEFT_PALETTE,
  right: S.WALK_RIGHT_PALETTE,
};
const EYE_ZONES: Partial<Record<Dir, { rows: [number, number]; cols: [number, number]; warm?: true }>> = {
  down: { rows: [12, 16], cols: [0, 99], warm: true },
  left: { rows: [11, 14], cols: [12, 17] },
  right: { rows: [11, 14], cols: [26, 31] },
};
const cache = new WeakMap<object, string>();
export function eyesOf(dir: Dir, frame: { sprite: string[]; colors: string[] }): string {
  let eyes = cache.get(frame);
  if (eyes !== undefined) return eyes;
  const z = EYE_ZONES[dir];
  const pal = PALETTES[dir];
  const out: string[] = [];
  if (z)
    for (let y = z.rows[0]; y <= z.rows[1] && y < frame.sprite.length; y++)
      for (let x = z.cols[0]; x <= z.cols[1] && x < frame.sprite[y].length; x++) {
        const hex = pal[frame.colors[y]?.[x] ?? ''];
        if (frame.sprite[y][x] === '·' && hex && (!z.warm || isWarmBrown(hex))) out.push(`${x},${y}`);
      }
  eyes = out.join(' ');
  cache.set(frame, eyes);
  return eyes;
}
