#!/usr/bin/env python3
"""The game's two bundled fonts, cut down to the characters it uses:

  Cascadia Code  the main font (src/fonts/asciia-mono-<weight>.woff2): the
                 look the game was made in (Windows 11's own coding font).
                 Its licence reserves the name "Cascadia Code" for the
                 original, so this cut-down, widened copy is renamed
                 "Asciia Mono" (OFL 1.1 condition 3)
  Sarasa Mono    ONLY the fallback (src/fonts/sarasa-mono-<face>.woff2): it
                 draws what Cascadia lacks (the ramp's ‡, the terrain's ∘, the
                 sprites' ◆◇●◯※ …)

Run when new characters show up in the game (the build doesn't need it):

    pip install fonttools brotli
    python3 -I scripts/subset-font.py                   # downloads both itself
    python3 -I scripts/subset-font.py <sarasa> <cascadia>
        # or: a folder with Sarasa's two .ttf, and an unpacked
        # @fontsource/cascadia-code package

Neither font is a package dependency: their npm tarballs
(@fontpkg/sarasa-mono-sc, @fontsource/cascadia-code) are fetched into a temp
folder and only the small woff2 files are committed.

Both are put on the game's 0.6em cell (src/font.ts CH_EM, the cell every
sprite, the terrain grid and the camera were made for): every glyph keeps its
shape and is centred in a cell that wide (Cascadia's own is 0.586em, Sarasa's
0.5em), so a character from either font fills exactly one column.

Checks:
  - fails if a character crafting or the terrain can emit (crafting's
    ALLOWED_CHARS, terrain GLYPHS, the reference baker's ramp and edge
    glyphs) is in neither font one column wide, so the grid can't drift
    whatever the AI crafts;
  - warns about sprite rows in src/data that use a wide or missing character
    (canvas sprites centre each glyph in its cell, so the grid holds, but the
    glyph spills into its neighbours).
Ligatures and contextual alternates are left out (Cascadia Code is full of
them), so '->' or '==' in a sprite stay two characters.
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
from fontTools.merge import Merger, Options as MergeOptions
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'fonts')
CELL = 0.6  # a column, in em (src/font.ts CH_EM)

SARASA = ('@fontpkg/sarasa-mono-sc', '0.36.0')
SARASA_FACES = {'regular': 'sarasa-mono-sc-regular.ttf', 'bold': 'sarasa-mono-sc-bold.ttf'}
CASCADIA = ('@fontsource/cascadia-code', '5.3.0')
CASCADIA_WEIGHTS = (400, 500, 600, 700)  # the weights the game's CSS uses
# fontsource splits the font by script; these hold the game's characters
CASCADIA_PARTS = ('latin', 'latin-ext', 'greek', 'symbols2')

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


def tarball(pkg):
    name, version = pkg
    meta = json.load(urllib.request.urlopen(f'https://registry.npmjs.org/{name}/{version}'))
    print('downloading', meta['dist']['tarball'])
    return tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen(meta['dist']['tarball']).read()))


def fetch_sarasa(tmp):
    with tarball(SARASA) as tar:
        for f in SARASA_FACES.values():
            with open(os.path.join(tmp, f), 'wb') as out:
                out.write(tar.extractfile(tar.getmember('package/' + f)).read())
    return tmp


def fetch_cascadia(tmp):
    with tarball(CASCADIA) as tar:
        tar.extractall(tmp, members=[m for m in tar.getmembers() if m.name.startswith('package/files/') and m.name.endswith('-normal.woff2')])
    return os.path.join(tmp, 'package')


def cascadia(pkgdir, weight):
    """One Cascadia Code weight, its script parts merged into one font."""
    tmp = tempfile.mkdtemp(prefix='cascadia-')
    paths = []
    for part in CASCADIA_PARTS:
        f = TTFont(os.path.join(pkgdir, 'files', f'cascadia-code-{part}-{weight}-normal.woff2'))
        # no ligatures / alternates, no hinting: the merge can't join those
        for t in ('GSUB', 'GPOS', 'GDEF', 'STAT', 'fpgm', 'prep', 'cvt ', 'gasp'):
            if t in f:
                del f[t]
        f.flavor = None
        paths.append(os.path.join(tmp, f'{part}.ttf'))
        f.save(paths[-1])
    return Merger(options=MergeOptions(drop_tables=['vhea', 'vmtx'])).merge(paths)


def one_column(font, ch):
    cmap = font.getBestCmap()
    return ord(ch) in cmap and font['hmtx'][cmap[ord(ch)]][0] == base_width(font)


def base_width(font):
    """The font's own column width (its 'M')."""
    return font['hmtx'][font.getBestCmap()[ord('M')]][0]


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
    """Every glyph centred in a cell CELL em wide (a two-column glyph in two)."""
    glyf, hmtx = font['glyf'], font['hmtx']
    k = CELL * font['head'].unitsPerEm / base_width(font)
    shift = {}
    for name in font.getGlyphOrder():
        adv, _ = hmtx[name]
        new = round(adv * k)
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
    font['OS/2'].xAvgCharWidth = round(font['OS/2'].xAvgCharWidth * k)


def rename(font, old, new):
    """The font's own names (family, full, PostScript) from `old` to `new`."""
    for rec in font['name'].names:
        if rec.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
            s = rec.toUnicode()
            rec.string = s.replace(old, new).replace(old.replace(' ', ''), new.replace(' ', ''))


def cut(font, wanted, dest):
    opts = subset.Options()
    # no ligatures or contextual alternates: a sprite's '->' stays two cells
    opts.layout_features = ['ccmp', 'locl', 'kern', 'mark', 'mkmk']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.hinting = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=wanted & set(font.getBestCmap()))
    sub.subset(font)
    widen(font)
    font.flavor = 'woff2'
    font.save(dest)
    print(f'{os.path.relpath(dest, ROOT)}: {len(font.getBestCmap())} chars, {os.path.getsize(dest) // 1024} KB')


def main():
    sarasa_dir = sys.argv[1] if len(sys.argv) > 1 else fetch_sarasa(tempfile.mkdtemp(prefix='sarasa-'))
    cascadia_dir = sys.argv[2] if len(sys.argv) > 2 else fetch_cascadia(tempfile.mkdtemp(prefix='cascadia-'))
    used = source_chars()
    data = data_chars()
    grid = emit_chars()
    wanted = {ord(c) for c in used} | {ord(c) for c in data} | {ord(c) for c in grid}
    for a, b in RANGES:
        wanted.update(range(a, b + 1))

    casc = {w: cascadia(cascadia_dir, w) for w in CASCADIA_WEIGHTS}
    sara = {face: TTFont(os.path.join(sarasa_dir, f)) for face, f in SARASA_FACES.items()}
    main_font, fallback = casc[400], sara['regular']
    bad = []
    for ch, f in sorted(grid.items()):
        if not (one_column(main_font, ch) or (ord(ch) not in main_font.getBestCmap() and one_column(fallback, ch))):
            bad.append(f'sprite char {ch!r} (U+{ord(ch):04X}, {f}) is in neither font one column wide')
    for ch, f in sorted(data.items()):
        if ch in grid:
            continue
        drawn_by = main_font if ord(ch) in main_font.getBestCmap() else fallback
        if not one_column(drawn_by, ch):
            print(f'warning: sprite char {ch!r} (U+{ord(ch):04X}, {f}) is '
                  + ('in neither font' if ord(ch) not in drawn_by.getBestCmap() else 'two columns wide'))
    for ch, f in sorted(used.items()):
        # emoji and other symbols the UI draws are fine from a system font;
        # private-use characters are colour keys, never drawn
        if (ord(ch) not in main_font.getBestCmap() and ord(ch) not in fallback.getBestCmap() and ord(ch) < 0x1F000
                and ord(ch) not in (0xFE0F, 0x200D, 0xFEFF) and not 0xE000 <= ord(ch) <= 0xF8FF):
            print(f'note: {ch!r} (U+{ord(ch):04X}, {f}) is in neither font; a system font draws it')
    if bad:
        print('\n'.join(bad))
        sys.exit('subset-font: fix the characters above (or pick ones a font draws one column wide)')
    os2 = main_font['OS/2']
    print(f'Cascadia metrics: upm {main_font["head"].unitsPerEm}, typo ascender {os2.sTypoAscender}, '
          f'descender {os2.sTypoDescender}, line gap {os2.sTypoLineGap} (fallback overrides in styles.css)')

    os.makedirs(OUT, exist_ok=True)
    for w, font in casc.items():
        rename(font, 'Cascadia Code', 'Asciia Mono')
        cut(font, wanted, os.path.join(OUT, f'asciia-mono-{w}.woff2'))
    for face, font in sara.items():
        cut(font, wanted, os.path.join(OUT, f'sarasa-mono-{face}.woff2'))


if __name__ == '__main__':
    main()
