#!/usr/bin/env python3
"""Cut Sarasa Mono SC down to the characters the game uses -> src/fonts/*.woff2.

Run when new characters show up in the game (the build doesn't need it):

    pip install fonttools brotli
    python3 -I scripts/subset-font.py            # downloads the font itself
    python3 -I scripts/subset-font.py <dir>      # or: a folder with the two .ttf

The font is NOT a package dependency: the npm tarball of
@fontpkg/sarasa-mono-sc is fetched into a temp folder, only Regular and Bold
are used, and only the small woff2 files are committed.

Checks:
  - fails if a character crafting or the terrain can emit (crafting's
    ALLOWED_CHARS, terrain GLYPHS, the reference baker's ramp and edge
    glyphs) is missing or isn't ONE column wide
    (500 / 1000 em), so the grid can't drift whatever the AI crafts;
  - warns about sprite rows in src/data that use a wide or missing character
    (canvas sprites centre each glyph in its cell, so the grid holds, but the
    glyph spills into its neighbours).
Ligatures are left out of the subset, so '->' or '==' in a sprite stay two
characters.

Widened: Sarasa's characters are 0.5em wide, but the game was drawn and
tuned for a 0.6em cell (every sprite, the terrain grid, the camera). So every
glyph keeps its shape and gets a 0.6em-wide cell, centred in it (WIDEN): the
grid comes out exactly as the art was made for, in Sarasa's letters.
"""
import glob
import io
import json
import os
import re
import sys
import tarfile
import tempfile
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'fonts')
PKG = '@fontpkg/sarasa-mono-sc'
VERSION = '0.36.0'
FACES = {'regular': 'sarasa-mono-sc-regular.ttf', 'bold': 'sarasa-mono-sc-bold.ttf'}
# a column's width after widening: 0.6em (src/font.ts CH_EM)
WIDEN = 1.2

# always in, whatever the source says today: Basic Latin, Latin-1, general
# punctuation, arrows, maths operators, box drawing, block elements, geometric
# shapes, misc symbols, dingbats, Greek
RANGES = [
    (0x20, 0x7E), (0xA0, 0xFF), (0x370, 0x3FF), (0x2000, 0x206F), (0x20A0, 0x20BF),
    (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x23FF),
    (0x2500, 0x257F), (0x2580, 0x259F), (0x25A0, 0x25FF), (0x2600, 0x26FF), (0x2700, 0x27BF),
]
# JSON keys whose string rows are sprite grids
GRID_KEYS = {'sprite', 'solid', 'grid', 'base', 'frond'}


def fetch(tmp):
    meta = json.load(urllib.request.urlopen(f'https://registry.npmjs.org/{PKG}/{VERSION}'))
    print('downloading', meta['dist']['tarball'], '(~130 MB, once)')
    data = urllib.request.urlopen(meta['dist']['tarball']).read()
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for f in FACES.values():
            m = tar.getmember('package/' + f)
            with open(os.path.join(tmp, f), 'wb') as out:
                out.write(tar.extractfile(m).read())
    return tmp


def source_chars():
    pats = ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.json', 'src/**/*.css', 'index.html',
            'tools/glyph-ref/**/*.ts', 'tools/glyph-ref/**/*.tsx', 'tools/glyph-ref/**/*.html', 'tools/glyph-ref/**/*.css']
    where = {}
    for p in pats:
        for f in glob.glob(os.path.join(ROOT, p), recursive=True):
            if '.bak' in f:
                continue
            for ch in open(f, encoding='utf-8').read():
                if ord(ch) >= 0x20:
                    where.setdefault(ch, os.path.relpath(f, ROOT))
    return where


def data_chars():
    out = {}

    def walk(o, key=None, f=''):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, k, f)
        elif isinstance(o, list):
            for v in o:
                walk(v, key, f)
        elif isinstance(o, str) and key in GRID_KEYS:
            for ch in o:
                out.setdefault(ch, f)

    for f in glob.glob(os.path.join(ROOT, 'src/data/**/*.json'), recursive=True):
        if '.bak' in f:
            continue
        walk(json.load(open(f, encoding='utf-8')), None, os.path.relpath(f, ROOT))
    out.pop(' ', None)
    return out


def emit_chars():
    out = {}
    # crafting's ALLOWED_CHARS (craft/spriteConfig.ts) and the terrain's
    # GLYPHS (terrain.ts): the string literals that build them
    cfg = open(os.path.join(ROOT, 'src/craft/spriteConfig.ts'), encoding='utf-8').read()
    for name in ('FACE_SET', 'BODY_SET', 'RAMP_DEFAULT_LOCAL'):
        m = re.search(name + r"\s*=\s*(\[[^\]]*\]|\"[^\"]*\"|'[^']*')", cfg)
        if not m:
            sys.exit(f'subset-font: {name} not found in spriteConfig.ts')
        for ch in re.sub(r"[\[\]',\s]", '', m.group(1)) if m.group(1).startswith('[') else m.group(1)[1:-1]:
            out.setdefault(ch, 'craft/spriteConfig.ts ' + name)
    ter = open(os.path.join(ROOT, 'src/terrain.ts'), encoding='utf-8').read()
    m = re.search(r"export const GLYPHS = \[([^\]]*)\]", ter)
    for lit in re.findall(r"'([^']*)'|\"([^\"]*)\"", m.group(1)):
        for ch in lit[0] or lit[1]:
            out.setdefault(ch, 'terrain.ts GLYPHS')
    # the reference baker's glyphs (refCraft's in-game crafts use them)
    bake = open(os.path.join(ROOT, 'src/glyph/bake.ts'), encoding='utf-8').read()
    for name in ('ramp', 'edgeGlyphs'):
        lit = re.search(r"^  " + name + r": ('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"),", bake, re.M).group(1)
        for ch in re.sub(r'\\(.)', r'\1', lit[1:-1]):  # unescape the TS literal
            out.setdefault(ch, 'glyph/bake.ts DEFAULTS.' + name)
    mat = open(os.path.join(ROOT, 'src/craft/materials.ts'), encoding='utf-8').read()
    for ch in re.search(r"RAMP_DEFAULT = '([^']*)'", mat).group(1):
        out.setdefault(ch, 'craft/materials.ts RAMP_DEFAULT')
    out.pop(' ', None)
    return out


def widen(font):
    """Every glyph's advance x WIDEN, its outline centred in the wider cell."""
    glyf, hmtx = font['glyf'], font['hmtx']
    shift = {}
    for name in font.getGlyphOrder():
        adv, _ = hmtx[name]
        new = round(adv * WIDEN)
        shift[name] = (new - adv) // 2
        hmtx[name] = (new, hmtx[name][1])
    # simple glyphs move by their own shift; a composite's parts were already
    # moved with their own glyphs, so they only take the difference
    for name in font.getGlyphOrder():
        g = glyf[name]
        if g.isComposite():
            for c in g.components:
                c.x += shift[name] - shift.get(c.glyphName, 0)
        elif g.numberOfContours > 0:
            g.coordinates.translate((shift[name], 0))
    for name in font.getGlyphOrder():
        g = glyf[name]
        if g.numberOfContours != 0:
            g.recalcBounds(glyf)
            hmtx[name] = (hmtx[name][0], g.xMin)
    font['hhea'].advanceWidthMax = max(a for a, _ in hmtx.metrics.values())
    font['OS/2'].xAvgCharWidth = round(font['OS/2'].xAvgCharWidth * WIDEN)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else fetch(tempfile.mkdtemp(prefix='sarasa-'))
    used = source_chars()
    data = data_chars()
    grid = emit_chars()
    wanted = {ord(c) for c in used} | {ord(c) for c in data} | {ord(c) for c in grid}
    for a, b in RANGES:
        wanted.update(range(a, b + 1))

    bad = []
    for face, fname in FACES.items():
        font = TTFont(os.path.join(src, fname), lazy=True)
        cmap = font.getBestCmap()
        hmtx = font['hmtx']
        upm = font['head'].unitsPerEm
        for ch, f in sorted(grid.items()):
            if ord(ch) not in cmap:
                bad.append(f'{face}: sprite char {ch!r} (U+{ord(ch):04X}, {f}) is not in the font')
            elif hmtx[cmap[ord(ch)]][0] * 2 != upm:
                bad.append(f'{face}: sprite char {ch!r} (U+{ord(ch):04X}, {f}) is not one column wide')
        if face == 'regular':
            for ch, f in sorted(data.items()):
                if ch not in grid and (ord(ch) not in cmap or hmtx[cmap[ord(ch)]][0] * 2 != upm):
                    print(f'warning: sprite char {ch!r} (U+{ord(ch):04X}, {f}) is '
                          + ('not in the font' if ord(ch) not in cmap else 'two columns wide'))
        for ch, f in sorted(used.items()):
            # emoji and other symbols the UI draws are fine from a system font;
            # private-use characters are colour keys, never drawn
            if ord(ch) not in cmap and ord(ch) < 0x1F000 and ord(ch) not in (0xFE0F, 0x200D, 0xFEFF) and not 0xE000 <= ord(ch) <= 0xF8FF:
                print(f'note: {ch!r} (U+{ord(ch):04X}, {f}) is not in Sarasa; a system font draws it')
        if face == 'regular':
            os2 = font['OS/2']
            print(f'metrics: upm {upm}, typo ascender {os2.sTypoAscender}, descender {os2.sTypoDescender}, '
                  f'line gap {os2.sTypoLineGap} (fallback overrides in styles.css)')
        font.close()
    if bad:
        print('\n'.join(bad))
        sys.exit('subset-font: fix the characters above (or pick ones the font draws one column wide)')

    os.makedirs(OUT, exist_ok=True)
    for face, fname in FACES.items():
        opts = subset.Options()
        opts.flavor = 'woff2'
        # no ligatures or contextual alternates: a sprite's '->' stays two cells
        opts.layout_features = ['ccmp', 'locl', 'kern', 'mark', 'mkmk']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        opts.hinting = False
        font = TTFont(os.path.join(src, fname))
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=wanted)
        sub.subset(font)
        widen(font)
        dest = os.path.join(OUT, f'sarasa-mono-{face}.woff2')
        font.flavor = 'woff2'
        font.save(dest)
        print(f'{os.path.relpath(dest, ROOT)}: {len(font.getBestCmap())} chars, {os.path.getsize(dest) // 1024} KB')


if __name__ == '__main__':
    main()
