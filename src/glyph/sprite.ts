// A baked grid -> the game's sprite format (sprite / colors / palette, as in
// src/data/assets/*.json and crafted items): every column doubled (a game
// cell is 2 chars wide), rows stretched by `stretch` (a drawn game cell is
// ~1.22x wider than tall, the sheet's cells are square), one key per tone.
import { hex, type Baked } from './bake';

const KEYS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const GAME_ROW_STRETCH = 1.22;

export interface GameSprite {
  sprite: string[];
  colors: string[];
  palette: Record<string, string>;
  rowOf: number[]; // game row -> baked row
}

export function bakedToSprite(b: Baked, stretch = GAME_ROW_STRETCH): GameSprite {
  const tones = [...new Set(b.cells.filter(Boolean).map((c) => hex(c!.rgb)))].slice(0, KEYS.length);
  const key = new Map(tones.map((t, i) => [t, KEYS[i]]));
  const NR = Math.max(1, Math.round(b.rows * stretch));
  const rowOf = Array.from({ length: NR }, (_, i) => Math.floor((i * b.rows) / NR));
  const sprite: string[] = [], colors: string[] = [];
  for (const r of rowOf) {
    let s = '', k = '';
    for (let c = 0; c < b.cols; c++) {
      const cell = b.cells[r * b.cols + c];
      const kk = cell ? key.get(hex(cell.rgb)) : undefined;
      s += cell && kk ? cell.ch + cell.ch : '  ';
      k += cell && kk ? kk + kk : '  ';
    }
    const n = s.trimEnd().length;
    sprite.push(s.slice(0, n));
    colors.push(k.slice(0, n));
  }
  // drop empty rows at the top and bottom
  while (sprite.length && !sprite[0].trim()) {
    sprite.shift();
    colors.shift();
    rowOf.shift();
  }
  while (sprite.length && !sprite[sprite.length - 1].trim()) {
    sprite.pop();
    colors.pop();
    rowOf.pop();
  }
  return { sprite, colors, palette: Object.fromEntries(tones.map((t) => [key.get(t)!, t])), rowOf };
}

// Which part every baked cell shows: the most common part name among the
// source pixels the cell covers ('' = none). `part` is per source pixel.
export function cellParts(b: Baked, part: string[], w: number, h: number): string[] {
  return b.cells.map((c, i) => {
    if (!c) return '';
    const col = i % b.cols, row = (i / b.cols) | 0;
    const x0 = Math.floor(b.box.x0 + col * b.box.cw), x1 = Math.max(x0 + 1, Math.floor(b.box.x0 + (col + 1) * b.box.cw));
    const y0 = Math.floor(b.box.y0 + row * b.box.ch), y1 = Math.max(y0 + 1, Math.floor(b.box.y0 + (row + 1) * b.box.ch));
    const count = new Map<string, number>();
    for (let y = y0; y < Math.min(h, y1); y++)
      for (let x = x0; x < Math.min(w, x1); x++) {
        const p = part[y * w + x];
        if (p) count.set(p, (count.get(p) ?? 0) + 1);
      }
    let best = '', bn = 0;
    for (const [p, n] of count) if (n > bn) {
      bn = n;
      best = p;
    }
    return best;
  });
}
