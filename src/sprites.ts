// All sprites are arrays of strings (one per line) so whitespace and
// backslashes are preserved exactly. Render with .join('\n') in a <pre>.

export const PLAYER = [
  ' ,***,',
  '( ^-^ )',
  ' /|_|\\',
];

export const CAT = [
  ' /\\_/\\',
  '( o.o )',
  ' > ^ <',
];

export const FLOWER = [
  '__)',
  '.-(  (=:',
  '     \\)',
  '(\\__       |',
  ':=)  )-|    __)',
  ' (/     |-(  (=:',
  '____      |   \\)',
];

export const STONE = [
  ' .--.',
  '(    )',
  " '--'",
];

export const APPLE_TREE = [
  ' .@@@@@.',
  '@(o)@(o)@@',
  '@(o)@@@(o)@@',
  '@@(o)@(o)@@@',
  ' @@(o)(o)@@',
  "  '@@@@@'",
  '     ||',
  '     ||',
];

export const TREE2 = [
  'o   |   o',
  ' \\  |  /',
  'o--\\ | /--o',
  '    \\|/',
  ' o---|---o',
  '  \\  |  /',
  '   \\ | /',
  '     |',
  '     |',
];

export const TREE3 = [
  '    o',
  '   /|',
  'o-/ | \\-o',
  '   /|\\',
  'o--/ | \\--o',
  '  / | \\',
  'o-/  |  \\-o',
  '     |',
  '     |',
];

export const APPLE = [
  '   ,/',
  ' .@@@.',
  '@o@@@@',
  '@@@@@@',
  " '@@'",
];

export const SHOP = [
  '  +------------------+',
  '  |+----------------+|',
  '  ||    S H O P     ||',
  '  |+----------------+|',
  '  |   +--+    +--+   |',
  '  |   |  |    |()|   |',
  '  |   |  |    |  |   |',
  '  +---+--+----+--+---+',
];

export const CACTUS = [
  ' _|_',
  '( | )',
  ' |_|',
];

export const FERN = [
  '\\\\|//',
  ' \\|/',
  '  |',
];

export const ICEFLOWER = [
  '\\*/',
  '-*-',
  '/ \\',
];

export const HOUSE = [
  '   .---------.',
  '  /           \\',
  ' /             \\',
  '+---------------+',
  '|  +--+   +--+  |',
  '|  |##|   |()|  |',
  '|  |##|   |  |  |',
  '+--+--+---+--+--+',
];

// Landing banner: "ASCIIA" over "BAY", in the same figlet "standard"
// letterforms as before. Letters carry their own padding and are simply
// concatenated (no smushing), so every row of a block is the same length.
export const TITLE = [
  '    _     ____    ____  ___  ___     _    ',
  '   / \\   / ___|  / ___||_ _||_ _|   / \\   ',
  '  / _ \\  \\___ \\ | |     | |  | |   / _ \\  ',
  ' / ___ \\  ___) || |___  | |  | |  / ___ \\ ',
  '/_/   \\_\\|____/  \\____||___||___|/_/   \\_\\',
  '',
  ' ____      _    __   __',
  '| __ )    / \\   \\ \\ / /',
  '|  _ \\   / _ \\   \\ V / ',
  '| |_) | / ___ \\   | |  ',
  '|____/ /_/   \\_\\  |_|  ',
];

// Builds an ASCII speech bubble with a tail pointing down-left, in the style:
// .--------------------.
// |    hello there!    |
// '--.  .--------------'
//    | /
//    |/
export function makeBubble(text: string, width = 26): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  const inner = Math.max(8, ...lines.map((l) => l.length));
  const out: string[] = [];
  out.push('.' + '-'.repeat(inner + 2) + '.');
  for (const l of lines) out.push('| ' + l.padEnd(inner) + ' |');
  out.push("'--.  ." + '-'.repeat(inner - 4) + "'");
  out.push('   | /');
  out.push('   |/');
  return out.join('\n');
}
