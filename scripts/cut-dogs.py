#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# Cut the 39 pixel-art dogs out of assets/refs/dogs-sheet.jpg, each without
# its sticker outline and name label, as clean RGBA art:
#   out/<i>-dog.png    the dog, background transparent
#   out/<i>-label.png  the label under it (to read its name)
# The background and the sticker rings are flood-filled from the sheet's
# border over light, low-saturation pixels; each dog's own dark outline stops
# the fill, so white dogs keep their white inside it.
#
#   python3 scripts/cut-dogs.py [outdir]
# ---------------------------------------------------------------------------
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = 'assets/refs/dogs-sheet.jpg'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/refs/dogs/cut'

im = np.asarray(Image.open(SRC).convert('RGB')).astype(int)
H, W, _ = im.shape
mx = im.max(axis=2)
mn = im.min(axis=2)
light = (mn > 175) & (mx - mn < 40)  # background, sticker white, light-grey ring

# flood the light region connected to the border
lab, n = ndimage.label(light)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(border))
# the thin grey sticker line between the white ring and the background:
# medium-light, desaturated, touching the background
grey = (mn > 120) & (mx - mn < 30) & ~bg
for _ in range(2):
    touch = ndimage.binary_dilation(bg) & grey
    bg |= touch
fg = ~bg

# the shapes: dogs, labels (their pill is light, so the text is separate),
# the title
lab2, n2 = ndimage.label(fg)
objs = ndimage.find_objects(lab2)
sizes = ndimage.sum(np.ones_like(lab2), lab2, index=range(1, n2 + 1))
boxes = []
for i, sl in enumerate(objs):
    if sl is None:
        continue
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    boxes.append(dict(i=i + 1, n=int(sizes[i]), y0=y0, y1=y1, x0=x0, x1=x1))
# dogs: big shapes
dogs = [b for b in boxes if b['n'] > 900 and (b['y1'] - b['y0']) > 30]
dogs.sort(key=lambda b: (b['y0'] + b['y1']) / 2)
# rows by vertical centre
rows, cur = [], []
for d in dogs:
    cy = (d['y0'] + d['y1']) / 2
    if cur and cy - np.mean([(c['y0'] + c['y1']) / 2 for c in cur]) > 45:
        rows.append(cur)
        cur = []
    cur.append(d)
if cur:
    rows.append(cur)
rows = [sorted(r, key=lambda b: b['x0']) for r in rows]
print('rows', [len(r) for r in rows])

import os
os.makedirs(OUT, exist_ok=True)
k = 0
meta = []
for ri, r in enumerate(rows):
    for d in r:
        # skip the title (top-left: the text "Dogs" and its dachshund)
        if ri == 0 and d['x0'] < 200:
            print('skip title', d)
            continue
        k += 1
        y0, y1, x0, x1 = d['y0'], d['y1'], d['x0'], d['x1']
        # the dog plus small bits inside its box (sparkles), not label text
        keep = lab2 == d['i']
        for b in boxes:
            if b['i'] == d['i'] or b['n'] > 900:
                continue
            if b['y0'] >= y0 - 6 and b['y1'] <= y1 + 2 and b['x0'] >= x0 - 6 and b['x1'] <= x1 + 6:
                keep |= lab2 == b['i']
        # fill holes inside the outline (light cells enclosed by the dog);
        # the outline's JPEG gaps are closed first, so a white dog (Maltese)
        # keeps its white inside
        filled = ndimage.binary_fill_holes(keep)
        closed = ndimage.binary_fill_holes(ndimage.binary_closing(keep, structure=np.ones((3, 3)), iterations=3))
        keep = filled | (closed & ~ndimage.binary_dilation(bg & ~closed, iterations=1)) | keep
        ys, xs = np.nonzero(keep[max(0, y0 - 6):y1 + 2, max(0, x0 - 6):x1 + 6])
        oy, ox = max(0, y0 - 6), max(0, x0 - 6)
        cy0, cy1, cx0, cx1 = ys.min() + oy, ys.max() + oy + 1, xs.min() + ox, xs.max() + ox + 1
        crop = im[cy0:cy1, cx0:cx1]
        alpha = keep[cy0:cy1, cx0:cx1]
        rgba = np.zeros((cy1 - cy0, cx1 - cx0, 4), np.uint8)
        rgba[..., :3] = crop
        rgba[..., 3] = alpha * 255
        Image.fromarray(rgba).save(f'{OUT}/{k:02d}-dog.png')
        # the label: the strip under the dog's sticker
        ly0 = cy1 + 4
        ly1 = min(H, ly0 + 34)
        lx0, lx1 = max(0, cx0 - 30), min(W, cx1 + 30)
        Image.fromarray(im[ly0:ly1, lx0:lx1].astype(np.uint8)).save(f'{OUT}/{k:02d}-label.png')
        meta.append((k, ri, cx0, cy0, cx1 - cx0, cy1 - cy0))
print('dogs', k)
for m in meta:
    print(m)

# ---------------------------------------------------------------------------
# 2. each dog as a crafting reference: src/data/refs/pet-dog-<slug>/
#    art.png  the dog on its own pixel grid (the sheet's ~3 px art pixel),
#             its colours snapped to a small palette (the JPEG noise gone)
#    ref.json its names in several languages (names, and as tags), look traits, areas
# ---------------------------------------------------------------------------
import json

# (title, slug, names/aliases in English, German, French, Spanish, Italian,
#  Dutch, ..., look traits, one line)
BREEDS = [
    ('Chihuahua', 'chihuahua', ['chihuahua', 'chiwawa'], ['tiny', 'big ears'], 'A tiny dog with huge ears and an even bigger attitude.'),
    ('Dachshund', 'dachshund', ['dachshund', 'dackel', 'teckel', 'wiener dog', 'sausage dog', 'dachel', 'perro salchicha', 'bassotto', 'tekkel'], ['long', 'short legs'], 'A long little sausage of a dog on very short legs.'),
    ('French Bulldog', 'french-bulldog', ['french bulldog', 'frenchie', 'französische bulldogge', 'franzoesische bulldogge', 'bouledogue français', 'bulldog francés', 'bulldog francese', 'franse bulldog'], ['bat ears', 'stocky'], 'A stocky little Frenchie with big bat ears.'),
    ('Bulldog', 'bulldog', ['bulldog', 'english bulldog', 'englische bulldogge', 'bulldogge', 'bouledogue anglais', 'bulldog inglés', 'bulldog inglese', 'engelse bulldog'], ['stocky', 'wrinkly'], 'A wrinkly, low and sturdy bulldog.'),
    ('Pug', 'pug', ['pug', 'mops', 'carlin', 'carlino', 'doguillo'], ['round', 'flat face'], 'A round pug with a squishy dark face.'),
    ('Yorkshire', 'yorkshire', ['yorkshire', 'yorkshire terrier', 'yorkie', 'york'], ['small', 'silky'], 'A small, silky Yorkie, brave as a lion.'),
    ('Maltese', 'maltese', ['maltese', 'malteser', 'bichon maltais', 'maltés', 'maltese dog', 'maltezer'], ['white', 'fluffy'], 'A snow-white, fluffy little Maltese.'),
    ('Bichon Frise', 'bichon-frise', ['bichon frise', 'bichon frisé', 'bichon', 'bichon a poil frise', 'bichón frisé'], ['white', 'curly'], 'A white cotton cloud of a Bichon.'),
    ('Papillon', 'papillon', ['papillon', 'kontinentaler zwergspaniel', 'butterfly dog', 'epagneul nain'], ['fluffy ears', 'small'], 'A dainty Papillon with butterfly ears.'),
    ('Pomeranian', 'pomeranian', ['pomeranian', 'zwergspitz', 'pomeranian spitz', 'pom', 'spitz nain', 'pomerania', 'volpino di pomerania', 'dwergkees'], ['fluffy', 'round'], 'A round puffball of a Pomeranian.'),
    ('Schnauzer', 'schnauzer', ['schnauzer', 'zwergschnauzer', 'mittelschnauzer', 'riesenschnauzer', 'miniature schnauzer', 'schnautzer'], ['beard', 'grey'], 'A bearded, distinguished Schnauzer.'),
    ('Poodle', 'poodle', ['poodle', 'pudel', 'caniche', 'barboncino', 'barbone', 'poedel', 'toy poodle'], ['curly', 'brown'], 'A curly-coated, clever poodle.'),
    ('Havanese', 'havanese', ['havanese', 'havaneser', 'bichon havanais', 'bichón habanero', 'bichon avanese', 'havanezer'], ['fluffy', 'silky'], 'A cheerful, silky little Havanese.'),
    ('West Highland Terrier', 'west-highland-terrier', ['west highland terrier', 'west highland white terrier', 'westie', 'westy'], ['white', 'scruffy'], 'A scruffy white Westie, always up for mischief.'),
    ('Beagle', 'beagle', ['beagle', 'beagel'], ['tricolor', 'floppy ears'], 'A tri-coloured beagle with floppy ears and a busy nose.'),
    ('Boston Terrier', 'boston-terrier', ['boston terrier', 'boston'], ['tuxedo', 'black and white'], 'A dapper Boston terrier in a little tuxedo.'),
    ('Shiba Inu', 'shiba-inu', ['shiba inu', 'shiba', 'shibe', 'doge'], ['fox-like', 'curly tail'], 'A fox-faced Shiba with a curled-up tail.'),
    ('Border Collie', 'border-collie', ['border collie', 'collie', 'bordercollie'], ['black and white', 'clever'], 'A clever black-and-white Border Collie.'),
    ('Corgi', 'corgi', ['corgi', 'welsh corgi', 'welsh corgi pembroke', 'pembroke'], ['short legs', 'fluffy'], 'A happy corgi on short little legs.'),
    ('Boxer', 'boxer', ['boxer', 'deutscher boxer', 'bóxer'], ['muscular', 'brown'], 'A bouncy, square-jawed boxer.'),
    ('Vizsla', 'vizsla', ['vizsla', 'magyar vizsla', 'ungarischer vorstehhund', 'braque hongrois'], ['golden', 'sleek'], 'A sleek golden-red Vizsla.'),
    ('Aussie', 'aussie', ['aussie', 'australian shepherd', 'australischer schäferhund', 'australischer schaeferhund', 'berger australien', 'pastor australiano', 'pastore australiano'], ['merle', 'fluffy'], 'A fluffy Australian Shepherd with a patchwork coat.'),
    ('Golden Retriever', 'golden-retriever', ['golden retriever', 'golden', 'goldie', 'retriever'], ['golden', 'friendly'], 'A sunny golden retriever, everyone\'s best friend.'),
    ('Labrador', 'labrador', ['labrador', 'labrador retriever', 'lab', 'labi'], ['friendly', 'yellow'], 'A loyal, happy labrador.'),
    ('Husky', 'husky', ['husky', 'siberian husky', 'sibirischer husky', 'husky sibérien', 'husky siberiano'], ['black and white', 'fluffy'], 'A fluffy husky with sky-bright eyes.'),
    ('Pointer', 'pointer', ['pointer', 'english pointer', 'englischer pointer', 'vorstehhund', 'braque'], ['floppy ears', 'sleek'], 'An alert pointer, nose always on a trail.'),
    ('Whippet', 'whippet', ['whippet', 'windhund', 'greyhound', 'lévrier', 'galgo', 'levriero', 'windhond'], ['slim', 'fast'], 'A slender, speedy whippet.'),
    ('Dalmatian', 'dalmatian', ['dalmatian', 'dalmatiner', 'dalmatien', 'dálmata', 'dalmata', 'dalmatiër'], ['spotted', 'white'], 'A spotted Dalmatian, one of 101.'),
    ('Samoyed', 'samoyed', ['samoyed', 'samojede', 'samoyède', 'samoyedo', 'samoiedo', 'samojeed'], ['white', 'fluffy'], 'A smiling, cloud-white Samoyed.'),
    ('Belgian Malinois', 'belgian-malinois', ['belgian malinois', 'malinois', 'belgischer schäferhund', 'belgischer schaeferhund', 'berger belge', 'pastor belga', 'pastore belga', 'mechelse herder'], ['brown', 'alert'], 'An alert, hard-working Malinois.'),
    ('Doberman', 'doberman', ['doberman', 'dobermann', 'dobermann pinscher', 'dobermán', 'pinscher'], ['black and tan', 'sleek'], 'A sleek black-and-tan Doberman.'),
    ('Chow Chow', 'chow-chow', ['chow chow', 'chow-chow', 'chow'], ['fluffy', 'lion-like'], 'A fluffy, lion-maned Chow Chow.'),
    ('Great Dane', 'great-dane', ['great dane', 'deutsche dogge', 'dogge', 'dogue allemand', 'gran danés', 'alano', 'alano tedesco', 'duitse dog'], ['big', 'grey'], 'A huge, gentle Great Dane.'),
    ('German Shepherd', 'german-shepherd', ['german shepherd', 'deutscher schäferhund', 'deutscher schaeferhund', 'schäferhund', 'schaeferhund', 'schäfer', 'berger allemand', 'pastor alemán', 'pastore tedesco', 'duitse herder', 'alsatian'], ['black and tan', 'loyal'], 'A loyal German Shepherd, always on watch.'),
    ('Rottweiler', 'rottweiler', ['rottweiler', 'rotti', 'rottie'], ['black and tan', 'strong'], 'A big-hearted Rottweiler.'),
    ('Bernese Mountain', 'bernese-mountain', ['bernese mountain dog', 'bernese mountain', 'bernese', 'berner sennenhund', 'berner', 'bouvier bernois', 'boyero de berna', 'bovaro del bernese', 'berner sennen'], ['tricolor', 'fluffy'], 'A gentle, tri-coloured Bernese mountain dog.'),
    ('Saint Bernard', 'saint-bernard', ['saint bernard', 'st bernard', 'st. bernard', 'bernhardiner', 'saint-bernard', 'san bernardo', 'sint-bernard'], ['big', 'fluffy'], 'A huge, cuddly Saint Bernard.'),
]
DOG_WORDS = ['dog', 'puppy', 'hund', 'welpe', 'chien', 'chiot', 'perro', 'cachorro', 'cane', 'cucciolo', 'hond', 'pup', 'doggo']
CELL = 3  # the sheet's art pixel, in sheet pixels


def snap_palette(rgb, alpha, k=12):
    """k-means the opaque pixels' colours to k, return the snapped image"""
    px = rgb[alpha].reshape(-1, 3).astype(float)
    rng = np.random.default_rng(1)
    cent = px[rng.choice(len(px), size=min(k, len(px)), replace=False)]
    for _ in range(12):
        d = ((px[:, None, :] - cent[None]) ** 2).sum(-1)
        a = d.argmin(1)
        for j in range(len(cent)):
            if (a == j).any():
                cent[j] = px[a == j].mean(0)
    d = ((px[:, None, :] - cent[None]) ** 2).sum(-1)
    out = rgb.copy()
    out[alpha] = cent[d.argmin(1)].round().astype(int)
    return out


def to_grid(rgb, alpha, cell):
    """down to the art pixel grid: per cell the most common opaque colour"""
    h, w = alpha.shape
    gh, gw = (h + cell - 1) // cell, (w + cell - 1) // cell
    out = np.zeros((gh, gw, 4), np.uint8)
    for gy in range(gh):
        for gx in range(gw):
            a = alpha[gy * cell:(gy + 1) * cell, gx * cell:(gx + 1) * cell]
            if a.mean() < 0.5:
                continue
            c = rgb[gy * cell:(gy + 1) * cell, gx * cell:(gx + 1) * cell][a]
            vals, counts = np.unique(c.reshape(-1, 3), axis=0, return_counts=True)
            out[gy, gx, :3] = vals[counts.argmax()]
            out[gy, gx, 3] = 255
    return out


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


assert k == len(BREEDS), f'{k} dogs cut, {len(BREEDS)} names'
for i, (title, slug, names, traits, desc) in enumerate(BREEDS, start=1):
    dog = np.asarray(Image.open(f'{OUT}/{i:02d}-dog.png')).astype(int)
    alpha = dog[..., 3] > 127
    rgb = snap_palette(dog[..., :3], alpha)
    art = to_grid(rgb, alpha, CELL)
    a = art[..., 3] > 0
    ys, xs = np.nonzero(a)
    art = art[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    # back up to about the other references' size (~120 px wide), each art
    # pixel a clean block, so the baker has room for 600-800 glyphs
    f = max(2, round(120 / art.shape[1]))
    art = np.kron(art, np.ones((f, f, 1), np.uint8))
    a = art[..., 3] > 0
    h, w = a.shape
    rid = f'pet-dog-{slug}'
    d = f'src/data/refs/{rid}'
    os.makedirs(d, exist_ok=True)
    Image.fromarray(art).save(f'{d}/art.png')
    # the head: the highest opaque run, over which a hat or bow sits
    top = np.nonzero(a.any(1))[0][0]
    hx = np.nonzero(a[top:top + max(2, h // 6)].any(0))[0]
    hcx = (hx.min() + hx.max() + 1) / 2 / w
    doc = {
        'version': 1,
        'id': rid,
        'title': title,
        'role': 'body',
        'category': 'pet',
        'gameCategory': 'pets',
        'tags': ['dog'] + names + traits,
        # what it is: the breed's names (the game finds the dog by these)
        'names': list(dict.fromkeys(names)),
        'description': desc,
        'sizeBand': 'medium',
        'w': int(w),
        'h': int(h),
        'parts': [{'name': 'body', 'zone': 'primary'}],
        'mask': rle(a.astype(np.uint8)),
        'anchors': [{'name': 'attach', 'x': 0.5, 'y': 0.95}],
        'areas': [
            {'name': 'head_top', 'type': 'decoration', 'x': round(max(0, min(0.75, hcx - 0.125)), 3), 'y': 0, 'w': 0.25, 'h': 0.18, 'accepts': ['hat', 'bow', 'flower', 'crown', 'star']},
            {'name': 'body_detail', 'type': 'detail', 'x': 0.3, 'y': 0.4, 'w': 0.4, 'h': 0.35, 'accepts': [], 'part': 'body'},
        ],
    }
    with open(f'{d}/ref.json', 'w') as f:
        json.dump(doc, f, ensure_ascii=False)
    print(rid, w, h)
