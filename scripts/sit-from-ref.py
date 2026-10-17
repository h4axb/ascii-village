#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# The player's sitting pose, from its pixel-art reference
# (docs/prototype/player assets/player_sit_ref.webp: 24 x 29 cells on a
# white page, thin white grid lines between the cells) to
#
#   docs/prototype/player assets/player_sit.svg   the glyph SVG, in the same
#       format as player_stand.svg / player_walk_*.svg (viewBox 0 -40 480 600,
#       one <text x y fill>glyph</text> per 20 px cell, limb groups)
#   src/data/sit.json   the game's frames (sprites.ts SIT_ANIM): decoded from
#       that SVG like the walk frames, columns doubled, shirt/shorts masks
#
# Colours snap to the standing player's own palette (src/data/player.json) so
# the seated player matches the standing one; a colour that player.json
# already draws keeps its glyph there, any other one takes the brightness
# ramp's. Background = the page's neutral white (the shirt and shoes are a
# warm white, so they stay).
#
#   python3 -I scripts/sit-from-ref.py
# ---------------------------------------------------------------------------
import json
import os
import re
from collections import Counter, defaultdict

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, 'docs/prototype/player assets/player_sit_ref.webp')
SVG = os.path.join(ROOT, 'docs/prototype/player assets/player_sit.svg')
OUT = os.path.join(ROOT, 'src/data/sit.json')
PLAYER = os.path.join(ROOT, 'src/data/player.json')

# the reference's grid (measured from its grid lines): first cell's corner,
# cell size, cells across / down
X0, CW, Y0, RH, NC, NR = 249.2, 31.3, 194.6, 31.77, 24, 29
RAMP = '·:¬=+†‡*¤§%&¥Ø@'  # craft/materials.ts RAMP_DEFAULT, light -> heavy
SNAP = 48  # how near (RGB distance) a colour must be to take player.json's
# the figure's parts, by row (for the masks and the SVG's groups)
SHIRT_ROWS = range(17, 23)  # the shirt and its sleeves
SHOE_ROWS = range(24, 29)

img = np.array(Image.open(REF).convert('RGB')).astype(int)
cells = []
for j in range(NR):
    row = []
    for i in range(NC):
        cx, cy = int(X0 + CW * (i + 0.5)), int(Y0 + RH * (j + 0.5))
        c = tuple(int(v) for v in np.median(img[cy - 8:cy + 9, cx - 8:cx + 9].reshape(-1, 3), axis=0))
        # the page: neutral white (the shirt's white is warm: blue well below red)
        row.append(None if min(c) > 245 and c[0] - c[2] < 6 else c)
    cells.append(row)

player = json.load(open(PLAYER))
pal = player['palette']
glyph_of = defaultdict(Counter)
for s, k in zip(player['sprite'], player['colors']):
    for ch, key in zip(s, k):
        if ch != ' ':
            glyph_of[key][ch] += 1
hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
pal_rgb = {k: hexrgb(h) for k, h in pal.items()}
free_keys = [c for c in '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%()*+,-./;<=>?@[]^_{|}~' if c not in pal]
sit_pal = {}
new_keys = {}


def key_for(c):
    k, d = min(((k, sum((a - b) ** 2 for a, b in zip(c, rgb)) ** 0.5) for k, rgb in pal_rgb.items()), key=lambda t: t[1])
    if d <= SNAP:
        sit_pal[k] = pal[k]
        return k
    # a colour of its own (the bag strap's brown, the shoes' grey): nearest
    # one already made within SNAP, else a new key
    for nk, rgb in new_keys.items():
        if sum((a - b) ** 2 for a, b in zip(c, rgb)) ** 0.5 <= SNAP / 2:
            return nk
    nk = free_keys.pop(0)
    new_keys[nk] = c
    sit_pal[nk] = '#%02x%02x%02x' % c
    return nk


def glyph_for(key):
    if glyph_of[key]:
        return glyph_of[key].most_common(1)[0][0]
    r, g, b = hexrgb(sit_pal[key])
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return RAMP[round(lum / 255 * (len(RAMP) - 1))]


keys = [[key_for(c) if c else None for c in row] for row in cells]
grid = [[(k, glyph_for(k)) if k else None for k in row] for row in keys]


def is_shirt(j, c):
    return j in SHIRT_ROWS and c is not None and min(c) > 225


def is_shorts(c):
    return c is not None and c[2] > 150 and c[2] > c[0] + 40


def group(j, i):
    c = cells[j][i]
    side = 'L' if i < NC // 2 else 'R'
    if j < 17:
        return 'head'
    if j in SHOE_ROWS:
        return 'shoe' + side
    if is_shirt(j, c) or is_shorts(c) or (j < 23 and 8 <= i <= 15):
        return 'body'
    if j >= 22:
        return 'leg' + side
    return 'arm' + side if (i < 8 or i > 15) else 'head'


# ---- the SVG (player_stand.svg's format) -----------------------------------
ROW0 = 30 - NR  # rows from the viewBox top: feet on the bottom row like the others
groups = defaultdict(list)
for j in range(NR):
    for i in range(NC):
        if not grid[j][i]:
            continue
        k, ch = grid[j][i]
        esc = {'&': '&amp;', '<': '&lt;', '>': '&gt;'}.get(ch, ch)
        groups[group(j, i)].append(f'    <text x="{20 * i + 10}" y="{-40 + 20 * (ROW0 + j) + 10}" fill="{sit_pal[k]}">{esc}</text>')
order = ['head', 'armL', 'armR', 'body', 'legL', 'legR', 'shoeL', 'shoeR']
svg = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -40 480 600" width="240" height="300"',
       '     role="img" aria-label="Player character sitting, facing down (from player_sit_ref.webp, scripts/sit-from-ref.py)">',
       '  <style>', '    text {',
       '      font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace;',
       '      font-size: 15px;', '      text-anchor: middle;', '      dominant-baseline: central;', '    }', '  </style>',
       '  <rect x="0" y="-40" width="480" height="600" fill="#16100d"/>']
for gname in order:
    if groups[gname]:
        svg.append(f'  <g class="{gname}">')
        svg += groups[gname]
        svg.append('  </g>')
svg.append('</svg>')
open(SVG, 'w').write('\n'.join(svg) + '\n')

# ---- the game's frame, decoded back from that SVG --------------------------
src = open(SVG).read()
cellmap = {}
for x, y, fill, ch in re.findall(r'<text x="(\d+)" y="(-?\d+)" fill="(#[0-9a-f]{6})">([^<]+)</text>', src):
    ch = {'&amp;': '&', '&lt;': '<', '&gt;': '>'}.get(ch, ch)
    cellmap[((int(y) + 40 - 10) // 20, (int(x) - 10) // 20)] = (fill, ch)
rows = sorted({r for r, _ in cellmap})
key_of_hex = {h: k for k, h in sit_pal.items()}
sprite, colors, shirt, shorts = [], [], [], []
for r in range(rows[0], rows[-1] + 1):
    s = k = sm = om = ''
    for i in range(NC):
        cell = cellmap.get((r, i))
        j = r - ROW0
        if cell:
            fill, ch = cell
            s += ch * 2
            k += key_of_hex[fill] * 2
            c = cells[j][i]
            sm += 'S' * 2 if is_shirt(j, c) else '  '
            om += 'O' * 2 if is_shorts(c) else '  '
        else:
            s += '  '
            k += '  '
            sm += '  '
            om += '  '
    sprite.append(s.rstrip())
    colors.append(k[:len(s.rstrip())])
    shirt.append(sm.rstrip())
    shorts.append(om.rstrip())
data = {
    'source': 'docs/prototype/player assets/player_sit.svg (scripts/sit-from-ref.py, from player_sit_ref.webp): '
              'glyph + colour per cell from its <text> coordinates, columns doubled; colours from player.json\'s palette; '
              'shirtMask from the shirt cells, shortsMask from the shorts cells.',
    'palette': sit_pal,
    'padTop': 0,
    'frames': [{'sprite': sprite, 'colors': colors, 'shirtMask': shirt, 'shortsMask': shorts}],
}
json.dump(data, open(OUT, 'w'), ensure_ascii=False, indent=1)
open(OUT, 'a').write('\n')
print(f'{os.path.relpath(SVG, ROOT)}: {len(cellmap)} cells; {os.path.relpath(OUT, ROOT)}: {len(sprite)} rows x {max(map(len, sprite))} chars, '
      f'{len(sit_pal)} colours ({len(new_keys)} new: {", ".join(sit_pal[k] for k in new_keys)})')
print('\n'.join(sprite))
