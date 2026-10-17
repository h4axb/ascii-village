#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# The bench reference (assets/refs/bench/bench.webp: a wooden bench with a
# gingham blanket, on white) cut out as a transparent PNG for
# scripts/bake-bench.mjs: every patch of near-white is background (the
# outside and the gaps between the backrest's slats; the blanket's cream is
# darker than the threshold, so it stays), then cropped to the bench.
#
#   python3 scripts/cut-bench.py <outdir>
# ---------------------------------------------------------------------------
import sys
from collections import deque

import numpy as np
from PIL import Image

OUT = sys.argv[1]
a = np.array(Image.open('assets/refs/bench/bench.webp').convert('RGB')).astype(int)
h, w, _ = a.shape
# background: near-white (and the faint grey fringe the compression left)
light = (a.min(axis=2) > 236) & (a.max(axis=2) - a.min(axis=2) < 24)
# near-white patches of any real size; the few stray light pixels inside the
# art (highlights) are kept
bg = np.zeros((h, w), bool)
seen = np.zeros((h, w), bool)
for sy, sx in zip(*np.nonzero(light)):
    if seen[sy, sx]:
        continue
    comp, q = [], deque([(sy, sx)])
    seen[sy, sx] = True
    while q:
        y, x = q.popleft()
        comp.append((y, x))
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and light[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    if len(comp) > 150:
        ys, xs = zip(*comp)
        bg[list(ys), list(xs)] = True
alpha = np.where(bg, 0, 255).astype(np.uint8)
ys, xs = np.nonzero(alpha)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
rgba = np.dstack([a.astype(np.uint8), alpha])[y0:y1, x0:x1]
Image.fromarray(rgba, 'RGBA').save(f'{OUT}/bench.png')
print('bench', (x1 - x0, y1 - y0), 'box in the reference', (x0, y0, x1, y1))
