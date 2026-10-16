#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# The picket fence sheet (assets/refs/fence/picket-fence-sheet.webp) cut into
# its modular pieces, as transparent PNGs for scripts/bake-fence.mjs:
#   front        three pickets and their rails, no post: repeats seamlessly
#                (cut at the picket spacing: 3 x 166 px)
#   front-left   the same with the corner post on its left
#   front-right  front-left mirrored: the post on its right
#   side-left    the short side piece going back to the right
#   side-right   the short side piece going back to the left
#   gate         the arched gate between its two posts
#   gate-open    the gate with its door taken out (only the posts)
# (The sheet's crossed-out corner piece is not used.)
#
#   python3 scripts/cut-fence.py <outdir>
# ---------------------------------------------------------------------------
import sys
import numpy as np
from PIL import Image, ImageOps

OUT = sys.argv[1]
src = Image.open('assets/refs/fence/picket-fence-sheet.webp').convert('RGBA')
crop = lambda x0, y0, x1, y1: src.crop((x0, y0, x1, y1))
pieces = {
    'front': crop(184, 200, 682, 512),
    'front-left': crop(60, 200, 682, 512),
    'side-left': crop(745, 158, 982, 530),
    'side-right': crop(1074, 158, 1310, 534),
    'gate': crop(720, 578, 1366, 952),
}
pieces['front-right'] = ImageOps.mirror(pieces['front-left'])
g = np.array(pieces['gate'])
g[:, 838 - 720:1249 - 720, 3] = 0  # the door, between the posts
pieces['gate-open'] = Image.fromarray(g)
for name, im in pieces.items():
    im.save(f'{OUT}/{name}.png')
    print(name, im.size)
