#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# The bench reference (assets/refs/bench/bench.webp: a wooden bench with a
# gingham blanket, on white) cut out as a transparent PNG for
# scripts/bake-bench.mjs: every patch of near-white is background (the
# outside and the gaps between the backrest's slats; the blanket's cream is
# darker than the threshold, so it stays), then cropped to the bench.
# Then made to fit the game's look:
#   - no black outline: the near-black pixels that touch the outside go
#     (the outline round the bench and its legs; dark shading inside stays)
#   - the game's colours: every colour a little less saturated and lifted,
#     so the wood reads like the fences' and the house's weathered browns and
#     the blanket's red like the game's dusty rose
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
a, bg = a[y0:y1, x0:x1], bg[y0:y1, x0:x1]

# down to the art's own pixels (it is pixel art, ~17 px each): one clean
# colour per art pixel, transparent where mostly background
COLS, ROWS = 60, 40
H, W = bg.shape
art = np.zeros((ROWS, COLS, 3), int)
solid = np.zeros((ROWS, COLS), bool)
for r in range(ROWS):
    for c in range(COLS):
        ys0, ys1 = r * H // ROWS, (r + 1) * H // ROWS
        xs0, xs1 = c * W // COLS, (c + 1) * W // COLS
        m = ~bg[ys0:ys1, xs0:xs1]
        if m.mean() > 0.5:
            solid[r, c] = True
            art[r, c] = np.median(a[ys0:ys1, xs0:xs1][m], axis=0)

# no black outline: the near-black art pixels on the outside edge go (two
# rings: the outline is up to two art pixels thick; the bench's own dark
# shading further in stays)
OUTLINE = 60
removed = 0
for _ in range(2):
    edge = np.zeros_like(solid)
    for r in range(ROWS):
        for c in range(COLS):
            if not solid[r, c] or art[r, c].max() >= OUTLINE:
                continue
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if not (0 <= nr < ROWS and 0 <= nc < COLS) or not solid[nr, nc]:
                    edge[r, c] = True
    solid &= ~edge
    removed += int(edge.sum())

# the game's colours: saturation down, value lifted a touch, so the wood
# reads like the fences' and the house's weathered browns and the blanket's
# red like the game's dusty rose
SAT, LIFT = 0.62, 0.08
f = art / 255.0
mx, mn = f.max(axis=2, keepdims=True), f.min(axis=2, keepdims=True)
grey = (mx + mn) / 2
f = grey + (f - grey) * SAT
f = f * (1 - LIFT) + LIFT
art = (f.clip(0, 1) * 255).round().astype(np.uint8)

# back up to a clean bitmap for the baker: CELL px per art pixel
CELL = 8
rgba = np.zeros((ROWS * CELL, COLS * CELL, 4), np.uint8)
for r in range(ROWS):
    for c in range(COLS):
        if solid[r, c]:
            rgba[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = [*art[r, c], 255]
Image.fromarray(rgba, 'RGBA').save(f'{OUT}/bench.png')
print('bench', (COLS, ROWS), 'art pixels;', removed, 'outline pixels removed')
