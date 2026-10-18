#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# The fallback reader's three themed word lists (the playtest's crafting
# themes: ships, watering tools, pets) from scripts/lexicon/*.py to
# src/data/lexicon/<theme>.json: [{"word": ..., "kind": ...}], kinds
# object / part / detail / style / material. Read by src/craft/lexicon.ts.
#
#   python3 -I -B scripts/build-lexicon.py
# ---------------------------------------------------------------------------
import importlib.util
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'scripts', 'lexicon')
OUT = os.path.join(ROOT, 'src', 'data', 'lexicon')


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SRC, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # (run with -B: no __pycache__ next to the lists)
    return mod


def items(block):
    for raw in re.split(r'[,\n]', block):
        w = re.sub(r'\s+', ' ', raw.strip().lower())
        if w:
            yield w


# which module attribute holds which kind
KINDS = {
    'OBJECT': 'object', 'DOGS': 'object', 'CATS': 'object', 'SMALL': 'object', 'BIRDS': 'object', 'FISH': 'object',
    'REPTILES': 'object', 'FARM': 'object', 'WILD': 'object', 'BUGS': 'object', 'SEA': 'object', 'FANTASY': 'object',
    'PART': 'part', 'DETAIL': 'detail', 'ACCESSORY': 'detail', 'STYLE': 'style', 'MATERIAL': 'material',
}

os.makedirs(OUT, exist_ok=True)
for theme in ('ships', 'watering', 'pets'):
    mod = load(theme)
    seen = {}
    for attr, kind in KINDS.items():
        for w in items(getattr(mod, attr, '')):
            seen.setdefault(w, kind)  # the first kind a word is listed under wins
    for kind, block in getattr(mod, 'TRANSLATIONS', {}).items():
        for w in items(block):
            seen.setdefault(w, kind)
    entries = [{'word': w, 'kind': k} for w, k in sorted(seen.items())]
    with open(os.path.join(OUT, theme + '.json'), 'w') as f:
        json.dump(entries, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    counts = {}
    for e in entries:
        counts[e['kind']] = counts.get(e['kind'], 0) + 1
    print(f'{theme}: {len(entries)} words', counts)
