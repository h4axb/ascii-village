# Character sprite part manifests (reference data, not derived from the repo)

These two files are reference data the user supplied for reworking the
player outfit-recolor regions in `src/outfit.ts`:

- `parts_manifest_full.json` — per-source-SVG part breakdown (hair, eyes,
  bag, tshirt, shorts, leg, shoes) for `walk-down-cycle.svg`,
  `stand-static.svg`, `walk-right-cycle.svg`, `walk-left-cycle.svg`, plus the
  colour predicates and row-band rules used to classify each part.
- `stand-static_parts.json` — the same breakdown for `stand-static-marked.svg`
  specifically, with full per-cell coordinate lists (not just row/col
  ranges).

## Important: this is SOURCE-SVG coordinate space, not the shipped JSON's

These row/col numbers describe the ORIGINAL reference SVGs' own glyph grid
(20-unit cells, viewBox starting around `y=-40`), not `src/data/walkDown.json`
etc. as currently baked into the game. Earlier attempts to paste these row
numbers directly into `OUTFIT_REGIONS` (`src/outfit.ts`) produced wrong
regions, because the shipped JSON's row numbering doesn't line up 1:1 with
this source numbering (different crop/padding per direction — see
`src/outfit.ts`'s own header comment for the known per-direction bake
differences, e.g. `walkUp.json`'s hybrid old-reference/new-per-frame rows).

**Do not paste these ranges straight into `OUTFIT_REGIONS`.** Instead, use
the colour predicates in `parts_manifest_full.json.classification_rules` to
classify the ACTUAL shipped palette (`src/data/walkDown.json` etc.) by hex
value, then find which rows those classified keys actually occupy in the
real baked data — the same empirical-scan technique already used this
session (see git history for `_tmp_outfit_region_scan.mjs`-style scripts).
This sidesteps the coordinate mismatch entirely: colour classification
doesn't care what row-numbering scheme the source SVG used.

The main new information these manifests add beyond what was already known:
a **bag** part (rows overlapping tshirt/shorts in both bands) and **leg**
(skin) rows, neither of which `OUTFIT_REGIONS` previously accounted for —
worth cross-checking against so a recolor region doesn't accidentally spill
onto bag straps or bare leg skin that happens to share a nearby row.
