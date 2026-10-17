#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# The garden crops' pixel art (assets/refs/crops: the sprout, the strawberry
# plant, the pumpkin, one strawberry) cut out as transparent PNGs for
# scripts/bake-crops.mjs: the background is the corner's colour (white, or
# the plant picture's beige), flood-filled away from the border, so colours
# inside the art that happen to match it stay; then cropped tight.
#
#   python3 scripts/cut-crops.py <outdir>
# ---------------------------------------------------------------------------
import sys
from collections import deque

import numpy as np
from PIL import Image

OUT = sys.argv[1]
SRC = {
    'sprout': 'sprout.jpg',
    'strawberryPlant': 'strawberry-plant.png',
    'pumpkin': 'pumpkin.jpg',
    'strawberry': 'strawberry.png',
}
# how far from the corner colour still counts as background (jpeg noise;
# the plant picture's leaves carry a light fringe of the beige)
TOL = {'strawberryPlant': 90}
HOLE = 40  # a patch of background colour this big inside the art is a hole too

for name, file in SRC.items():
    a = np.array(Image.open(f'assets/refs/crops/{file}').convert('RGB')).astype(int)
    h, w, _ = a.shape
    bgc = np.median(np.array([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]]), axis=0)
    near = np.abs(a - bgc).sum(axis=2) < TOL.get(name, 40)
    bg = np.zeros((h, w), bool)
    q = deque([(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)])
    while q:
        y, x = q.popleft()
        if bg[y, x] or not near[y, x]:
            continue
        bg[y, x] = True
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                q.append((ny, nx))
    # enclosed patches of the background (between a vine and the pumpkin)
    seen = bg.copy()
    for sy, sx in zip(*np.nonzero(near & ~bg)):
        if seen[sy, sx]:
            continue
        comp, q = [], deque([(sy, sx)])
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(comp) >= HOLE:
            ys, xs = zip(*comp)
            bg[list(ys), list(xs)] = True
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    ys, xs = np.nonzero(alpha)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([a.astype(np.uint8), alpha])[y0:y1, x0:x1]
    Image.fromarray(rgba, 'RGBA').save(f'{OUT}/{name}.png')
    print(name, (int(x1 - x0), int(y1 - y0)))
