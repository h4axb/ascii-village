#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# The four modular ships (assets/refs/ships/*) as crafting references
# (src/data/refs/boat-<name>/art.png + ref.json), their parts marked so the
# crafting bench can recolour and swap them:
#   pirate-ship  hull, sail, mast, flag, motif (the skull on the big sail:
#                the place for any motif asked on a sail -> area sail_motif)
#   shark-ship   hull, sail, mast, figurehead (the shark: the place for any
#                bow decoration -> area bow_head)
#   galleon      hull, sail, mast (the plain ship)
#   turtle-ship  hull, mast, animal (the giant turtle under it: the surprise)
# Every ship also has hull_detail, the middle of its hull.
#
#   python3 scripts/cut-ships.py [previewdir]
# ---------------------------------------------------------------------------
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

PREVIEW = sys.argv[1] if len(sys.argv) > 1 else None


def load(path, keep_white=()):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(int)
    rgb, alpha = a[..., :3], a[..., 3] > 127
    if (~alpha).sum() < 10:
        # a JPEG on white: flood the near-white connected to the border
        mn, mx = rgb.min(2), rgb.max(2)
        white = (mn > 238) & (mx - mn < 18)
        lab, _ = ndimage.label(white)
        border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        alpha = ~np.isin(lab, list(border))
        # white background trapped between ropes and sails (not a part's own
        # white: those boxes are kept)
        if keep_white is not None and path.endswith('.jpg') and keep_white != 'off':
            for i in range(1, lab.max() + 1):
                if i in border:
                    continue
                ys, xs = np.nonzero(lab == i)
                if len(ys) < 150:
                    continue
                cx, cy = xs.mean(), ys.mean()
                # (a box with a 5th value keeps only white smaller than it)
                if any(b[0] <= cx < b[2] and b[1] <= cy < b[3] and (len(b) < 5 or len(ys) < b[4]) for b in keep_white):
                    continue
                alpha[lab == i] = False
        # specks of JPEG noise left in the background
        lab2, n2 = ndimage.label(alpha)
        sizes = ndimage.sum(np.ones_like(lab2), lab2, index=range(1, n2 + 1))
        for i, s in enumerate(sizes):
            if s < 6:
                alpha[lab2 == i + 1] = False
    return rgb, alpha


def to_grid(rgb, alpha, cell):
    """per cell: the most common opaque colour (cell = the art's pixel)"""
    h, w = alpha.shape
    gh, gw = h // cell, w // cell
    out = np.zeros((gh, gw, 4), np.uint8)
    for gy in range(gh):
        for gx in range(gw):
            a = alpha[gy * cell:(gy + 1) * cell, gx * cell:(gx + 1) * cell]
            if a.mean() < 0.5:
                continue
            c = rgb[gy * cell:(gy + 1) * cell, gx * cell:(gx + 1) * cell][a] // 6 * 6
            vals, counts = np.unique(c.reshape(-1, 3), axis=0, return_counts=True)
            out[gy, gx, :3] = np.clip(vals[counts.argmax()] + 3, 0, 255)
            out[gy, gx, 3] = 255
    return out


def hsv(c):
    r, g, b = [v / 255 for v in c]
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        h = 0
    elif mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60, (d / mx if mx else 0), mx


def inb(x, y, b):
    return b[0] <= x < b[2] and b[1] <= y < b[3]


# per ship: the source, its art pixel, the parts and how each source pixel
# (x, y in the source image, its colour) is assigned to one
def pirate(x, y, c):
    h, s, v = hsv(c)
    if inb(x, y, (400, 232, 532, 352)) and v > 0.78 and s < 0.25:
        return 'motif'
    if inb(x, y, (285, 118, 400, 186)):
        return 'flag'
    if y >= 390:
        return 'hull'
    if inb(x, y, (200, 188, 356, 386)) and not (290 <= x <= 310):
        return 'sail'
    if inb(x, y, (365, 218, 602, 382)):
        return 'sail'
    return 'mast'


def shark(x, y, c):
    h, s, v = hsv(c)
    if inb(x, y, (0, 212, 102, 306)):
        return 'figurehead'
    if y < 215 and v > 0.7 and s < 0.3 and inb(x, y, (175, 10, 335, 175)):
        return 'sail'
    if y >= 188 and x >= 90 and not inb(x, y, (250, 0, 282, 300)):
        return 'hull'
    if y >= 300:
        return 'hull'
    return 'mast'


def galleon(x, y, c):
    h, s, v = hsv(c)
    if y < 262 and ((v > 0.66 and s < 0.35) or (255 <= h <= 345 and s < 0.5 and v > 0.55)):
        return 'sail'
    if y < 205 or any(inb(x, y, b) for b in [(228, 200, 262, 302), (436, 200, 472, 302), (612, 200, 648, 292)]):
        return 'mast'
    return 'hull'


def turtle(x, y, c):
    h, s, v = hsv(c)
    if inb(x, y, (92, 60, 397, 186)) and not (180 <= h <= 250 and s > 0.15):
        if 195 <= x <= 300 and y < 100:
            return 'mast'
        return 'hull'
    return 'animal'


SHIPS = [
    dict(
        id='boat-pirate-ship', src='assets/refs/ships/pirate-ship.jpg', cell=9, up=2, keep_white=[(400, 232, 532, 352), (0, 388, 720, 720, 250)], title='Pirate Ship', fn=pirate,
        parts=[('hull', 'primary'), ('sail', 'primary'), ('mast', 'secondary'), ('flag', 'trim'), ('motif', 'trim')],
        tags=['pirate', 'ship', 'jolly roger', 'skull', 'sails', 'wooden', 'galleon', 'piratenschiff', 'bateau pirate', 'barco pirata', 'nave pirata', 'piratenschip'],
        desc='A wooden pirate ship with patched sails and a skull flying on the mainsail.',
        areas=lambda b: [
            dict(name='sail_motif', type='detail', **b('motif', pad=0.02), accepts=[], part='sail'),
            dict(name='hull_detail', type='detail', x=0.3, y=0.78, w=0.35, h=0.14, accepts=[], part='hull'),
        ],
    ),
    dict(
        id='boat-shark-ship', src='assets/refs/ships/shark-ship.png', cell=2, up=1, title='Shark Ship', fn=shark,
        parts=[('hull', 'primary'), ('sail', 'primary'), ('mast', 'secondary'), ('figurehead', 'secondary')],
        tags=['shark', 'figurehead', 'ship', 'sails', 'wooden', 'deck', 'hai', 'haischiff', 'requin', 'tiburon', 'squalo', 'haai'],
        desc='A sturdy deck ship with billowing sails and a grinning shark on its bow.',
        areas=lambda b: [
            dict(name='bow_head', type='detail', **b('figurehead', pad=0.0), accepts=[]),
            dict(name='hull_detail', type='detail', x=0.4, y=0.72, w=0.3, h=0.16, accepts=[], part='hull'),
        ],
    ),
    dict(
        id='boat-galleon', src='assets/refs/ships/galleon.jpg', cell=3, up=1, keep_white=[], title='Galleon', fn=galleon,
        parts=[('hull', 'primary'), ('sail', 'primary'), ('mast', 'secondary')],
        tags=['galleon', 'ship', 'three masts', 'deck', 'wooden', 'grand', 'galeone', 'galion', 'galeón', 'schiff', 'navire', 'barco', 'nave', 'schip'],
        desc='A grand three-masted galleon with a long deck and furled sails.',
        areas=lambda b: [
            dict(name='hull_detail', type='detail', x=0.4, y=0.82, w=0.3, h=0.12, accepts=[], part='hull'),
        ],
    ),
    dict(
        id='boat-turtle-ship', src='assets/refs/ships/turtle-ship.jpg', cell=2, up=1, keep_white='off', title='Turtle Ship', fn=turtle,
        parts=[('hull', 'primary'), ('animal', 'primary'), ('mast', 'secondary')],
        tags=['turtle', 'sea turtle', 'animal', 'ship', 'creature', 'giant', 'schildkröte', 'schildkroete', 'tortue', 'tortuga', 'tartaruga', 'schildpad'],
        desc='A little ship riding on the back of a gentle giant sea turtle.',
        areas=lambda b: [
            dict(name='hull_detail', type='detail', x=0.45, y=0.35, w=0.3, h=0.14, accepts=[], part='hull'),
        ],
    ),
]


def rle(mask):
    flat = mask.reshape(-1)
    out, cur, n = [], int(flat[0]), 0
    for v in flat:
        v = int(v)
        if v == cur:
            n += 1
        else:
            out += [cur, n]
            cur, n = v, 1
    out += [cur, n]
    return out


for sh in SHIPS:
    rgb, alpha = load(sh['src'], sh.get('keep_white'))
    art = to_grid(rgb, alpha, sh['cell'])
    names = [p[0] for p in sh['parts']]
    gh, gw = art.shape[:2]
    mask = np.zeros((gh, gw), np.uint8)
    for gy in range(gh):
        for gx in range(gw):
            if art[gy, gx, 3]:
                p = sh['fn'](gx * sh['cell'] + sh['cell'] // 2, gy * sh['cell'] + sh['cell'] // 2, art[gy, gx, :3])
                mask[gy, gx] = names.index(p) + 1
    ys, xs = np.nonzero(art[..., 3])
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    art, mask = art[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    if sh['up'] > 1:
        art = np.kron(art, np.ones((sh['up'], sh['up'], 1), np.uint8))
        mask = np.kron(mask, np.ones((sh['up'], sh['up']), np.uint8))
    h, w = mask.shape

    def box(part, pad=0.0):
        ys, xs = np.nonzero(mask == names.index(part) + 1)
        bx0, by0 = max(0, xs.min() / w - pad), max(0, ys.min() / h - pad)
        bx1, by1 = min(1, (xs.max() + 1) / w + pad), min(1, (ys.max() + 1) / h + pad)
        return dict(x=round(bx0, 3), y=round(by0, 3), w=round(bx1 - bx0, 3), h=round(by1 - by0, 3))

    d = f"src/data/refs/{sh['id']}"
    os.makedirs(d, exist_ok=True)
    Image.fromarray(art).save(f'{d}/art.png')
    doc = dict(
        version=1, id=sh['id'], title=sh['title'], role='body', category='boat', gameCategory='vehicle',
        tags=sh['tags'], description=sh['desc'], sizeBand='medium', w=int(w), h=int(h),
        parts=[dict(name=n, zone=z) for n, z in sh['parts']], mask=rle(mask),
        anchors=[dict(name='attach', x=0.5, y=0.9)], areas=sh['areas'](box),
    )
    with open(f'{d}/ref.json', 'w') as f:
        json.dump(doc, f, ensure_ascii=False)
    print(sh['id'], w, h, {n: int((mask == i + 1).sum()) for i, n in enumerate(names)})
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        cols = np.array([[0, 0, 0], [200, 120, 60], [240, 240, 250], [120, 70, 40], [230, 60, 60], [250, 220, 0], [80, 160, 240]], np.uint8)
        pv = np.zeros((h, w, 3), np.uint8) + 40
        for i in range(len(names)):
            pv[mask == i + 1] = cols[i + 1]
        Image.fromarray(np.concatenate([art[..., :3], pv], 1)).resize((w * 2 * 3, h * 3), Image.NEAREST).save(f"{PREVIEW}/{sh['id']}.png")
