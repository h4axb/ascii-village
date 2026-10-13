// The "!" bubble Mitchy shows over his head while he's waiting for the player
// (see App.tsx's mitchyWaiting): a small pixel speech bubble (cream body,
// beige border, darker corner pixels, a tail at the bottom, an orange "!"),
// turned into the game's cells like the asset converters do: columns doubled,
// rows stretched 1.22x. '.' is empty.
const PIXELS = [
  '..kbbbbbbbbbbk..',
  '.kcccccccccccck.',
  'bccccccooccccccb',
  'bccccccooccccccb',
  'bccccccooccccccb',
  'bccccccooccccccb',
  'bccccccccccccccb',
  'bccccccooccccccb',
  '.kcccccccccccck.',
  '..kbbbbccbbbbk..',
  '......bccb......',
  '.......cc.......',
];

const STRETCH = 1.22;
const rows = Math.round(PIXELS.length * STRETCH);
const grid = Array.from({ length: rows }, (_, i) => PIXELS[Math.floor((i * PIXELS.length) / rows)]);

export const SPEECH_BUBBLE = grid.map((r) => [...r].map((k) => (k === '.' ? '  ' : '██')).join(''));
export const SPEECH_BUBBLE_COLORS = grid.map((r) => [...r].map((k) => k + k).join(''));
export const SPEECH_BUBBLE_PALETTE: Record<string, string> = {
  c: '#f8efdf',
  b: '#ecdcb8',
  k: '#d8c896',
  o: '#f28c28',
};
