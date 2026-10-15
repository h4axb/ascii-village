"""Bake the main island from the reference map (assets/refs/island-map-ref.webp)
into src/data/mainIsland.json: a grid of the ground's character cells (one
per ch x line), each one of
    .  water      g  grass (everything on the land that isn't sand or cliff:
                     trees, ponds, paths, buildings are all just ground here)
    s  sand       c  cliff face (grey rock, blocks walking)
    r  stone in the water (the little rocky islets)
plus where the grid sits on the map. world.ts turns it into the island's
coast field; terrain.ts draws the classes.

    python3 scripts/bake-island.py   (needs numpy, scipy, Pillow)
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

REF = 'assets/refs/island-map-ref.webp'
OUT = 'src/data/mainIsland.json'
CROP_X1 = 940          # the main island only: the shop island starts right of this
PX_PER_IMG = 2.0       # world px per picture px (a cell is 8.4 x 14 world px)
CELL_W, CELL_H = 8.4, 14.0
ORIGIN = (6, 5)        # the picture's top-left island bound lands on this tile

im = np.asarray(Image.open(REF).convert('RGB')).astype(np.int32)[:, :CROP_X1]
R, G, B = im[..., 0], im[..., 1], im[..., 2]
mx, mn = im.max(-1), im.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)

water = (B > R + 25) & (B >= G - 10)
land = ~water
land = ndi.binary_opening(land, iterations=2)
lab, n = ndi.label(land)
sizes = ndi.sum(land, lab, range(1, n + 1))
main_id = int(np.argmax(sizes)) + 1
main = ndi.binary_fill_holes(lab == main_id)  # the ponds are ground here
islets = np.zeros_like(main)
for i, s in enumerate(sizes, 1):
    if i != main_id and s > 600:
        islets |= lab == i
islets = ndi.binary_fill_holes(islets)

# sand: warm, light, low-ish saturation; the beaches touch the water (a path
# of the same colour inland doesn't)
sandish = (R > 185) & (G > 150) & (R - B > 25) & (R >= G) & (R - G < 60) & (mx > 185)
sandish &= main
# a thin strip (the dirt path) is cut off the beaches before telling them apart
broad = ndi.binary_opening(sandish, iterations=7)
sea = ~(main | islets)  # the ocean only: the ponds don't count
near_sea = ndi.binary_dilation(sea, iterations=14)
lab_s, ns = ndi.label(broad)
keep = set(np.unique(lab_s[broad & near_sea])) - {0}
sand = ndi.binary_dilation(np.isin(lab_s, list(keep)), iterations=7) & sandish
sand = ndi.binary_closing(sand, iterations=3) & main
# beaches reach inland a little; the path running on up the island is ground
sand &= ndi.distance_transform_edt(~sea) < 120

# cliff: grey rock (low saturation, mid value), big pieces only
ponds = main & water  # the ponds' stone rims aren't cliffs
grey = (sat < 0.16) & (mx > 70) & (mx < 215) & main & ~sand & ~ndi.binary_dilation(ponds, iterations=14)
grey = ndi.binary_closing(grey, iterations=2)
grey = ndi.binary_opening(grey, iterations=1)
lab_c, nc = ndi.label(grey)
csz = ndi.sum(grey, lab_c, range(1, nc + 1))
cliff = np.isin(lab_c, [i + 1 for i, s in enumerate(csz) if s > 400]) & main
# objects in the picture that aren't cliffs: the house (its stone base) and
# the fire pit on the beach (x0, y0, x1, y1 in picture px)
for x0, y0, x1, y1 in [(380, 100, 545, 290), (715, 645, 825, 745)]:
    cliff[y0:y1, x0:x1] = False

cls = np.full(main.shape, '.', dtype='<U1')
cls[islets] = 'r'
cls[main] = 'g'
cls[sand] = 's'
cls[cliff] = 'c'

# the island's bounds in the picture, then down to cells (majority vote)
ys, xs = np.nonzero(main | islets)
px0, py0, px1, py1 = xs.min() - 30, ys.min() - 30, xs.max() + 30, ys.max() + 30
sx = CELL_W / PX_PER_IMG  # picture px per cell, across
sy = CELL_H / PX_PER_IMG
cols = int((px1 - px0) / sx)
rows = int((py1 - py0) / sy)
order = ['.', 'g', 's', 'c', 'r']
grid = []
for r in range(rows):
    y0, y1 = int(py0 + r * sy), int(py0 + (r + 1) * sy)
    line = []
    for c in range(cols):
        x0, x1 = int(px0 + c * sx), int(px0 + (c + 1) * sx)
        block = cls[max(0, y0):y1, max(0, x0):x1].ravel()
        if block.size == 0:
            line.append('.')
            continue
        counts = {k: int((block == k).sum()) for k in order}
        land_n = block.size - counts['.']
        if land_n * 2 < block.size:
            line.append('.')
        else:
            # cliff wins a cell it fills a third of (so thin faces survive)
            if counts['c'] * 3 >= block.size:
                line.append('c')
            else:
                line.append(max(['g', 's', 'r'], key=lambda k: counts[k]))
    grid.append(''.join(line))

out = {
    'source': REF,
    'x0': ORIGIN[0] * 4,  # in cells (ch); a tile is 4 ch x 2 lines
    'y0': ORIGIN[1] * 2,
    'cols': cols,
    'rows': rows,
    # picture px -> cell: (px - px0) / sx + x0, (py - py0) / sy + y0
    'pic': {'px0': int(px0), 'py0': int(py0), 'sx': sx, 'sy': sy},
    'grid': grid,
}
json.dump(out, open(OUT, 'w'), indent=0)
print(f'{OUT}: {cols} x {rows} cells = {cols / 4:.1f} x {rows / 2:.1f} tiles at tile {ORIGIN}')

if '--preview' in sys.argv:
    pal = {'.': (40, 120, 200), 'g': (110, 180, 80), 's': (235, 215, 160), 'c': (120, 120, 125), 'r': (90, 90, 95)}
    img = Image.new('RGB', (cols, rows))
    img.putdata([pal[ch] for line in grid for ch in line])
    img.resize((cols * 3, int(rows * 3 * CELL_H / CELL_W / 1.0 * 0.6)), Image.NEAREST).save(sys.argv[sys.argv.index('--preview') + 1])
