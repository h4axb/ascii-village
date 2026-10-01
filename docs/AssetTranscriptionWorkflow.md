# Asset transcription workflow

How a new permanent world asset (a tree, plant, decoration — not a
player-craftable inventory item, see `docs/ArtStyleGuide.md` §11 for that
separate system) gets from a finished reference image to something placeable
in the game. Two stages: transcription (this doc) and placement (the in-game
world editor, see `docs/Editor.md`).

Deliberately **not** an automated script calling a separate billed vision API —
that would be a second LLM bill stacked on top of a Claude Code session that
already reads images natively. This step runs through a Claude Code session
directly instead: zero marginal API cost, and the transcription judgement
(silhouette fidelity, which glyphs need `perCell`, whether a collision-mask
suggestion looks degenerate) benefits from Claude reasoning in context rather
than a script pattern-matching a fixed ruleset.

## 1. Iterate the reference image (external, human)

Find/generate the reference image in ChatGPT (or wherever) and iterate until it
looks right — pixel-art style or an already-ASCII/glyph-styled image both work.
This step stays manual and outside this project; it's creative work, not
mechanical transcription.

## 2. Drop finished images into a folder

```
assets/refs/<batch-name>/
  oak-tree.png
  mushroom-cluster.png
  ...
```

Any raster format is fine (Claude reads images natively). One image per
distinct asset you want.

## 3. Ask a Claude Code session to transcribe them

In this repo, ask Claude to "transcribe the reference images in
`assets/refs/<batch-name>/` into world assets." For **each** image, Claude
should:

1. Read the image directly.
2. Produce **three distinct ASCII/glyph transcription candidates** — not one.
   Real choices, the same "give real choices" reasoning behind this project's
   own `suggestAlternatives` (crafting-failure suggestions, `src/llm.ts`), just
   applied proactively instead of on failure. Each candidate must follow
   `docs/ArtStyleGuide.md`:
   - **Column-doubling** (§1) if the reference looks square-celled (pixel art,
     an SVG with square units) — double every column, glyph and colour key
     both, before transcribing.
   - **Fixed-hex palette** (§2/§6) — a small `palette` (2-5+ `#rrggbb` keys,
     one per visually distinct part) and a `colors` grid the same shape as
     `sprite`, `.` for base-colour cells.
   - **Size tier** (§1's "Unified size tiers") — classify small/medium/large
     against the real anchors (flower/grass/dates small; player/cat medium;
     palm/house/shop large) and suggest a starting `scale` so `authored width
     × scale` lands near that tier's real on-screen width.
   - **Collision mask** (§8) — an advisory `solid` grid, same shape as
     `sprite`, reasoned about "where should this block movement" (the palm's
     trunk-only precedent), not just "where is ink drawn." Mark it advisory —
     it gets a visual red-overlay review in the world editor's Colliders tab
     before it's ever trusted.
   - **Ambiguous-glyph self-check** (§4) — flag any block/geometric character
     used (there's no DOM here to verify single-width against, so this is a
     judgement call, not a measurement) so it can be paired with `perCell` +
     a `.ent.<kind> span{width:1ch}` CSS rule later if kept.
3. Write each candidate to `src/data/assets/<slug>-a.json` / `-b.json` / `-c.json`, in
   the exact shape every baked asset already uses (`src/data/palm.json` /
   `scripts/build-palm.mjs` is the concrete precedent):
   ```js
   { generated: { source: "<imageFilename>", transcribedBy: "claude", promptVersion: 1, generatedAt: "<ISO date>" },
     palette: { ... }, sprite: [...], colors: [...], solid: [...],
     scale: 0.4 }   // optional defaults: scale, label, kind
   ```
   Every file in `src/data/assets/` appears in the world editor's asset list
   automatically (`src/assets.ts`); there is no manifest to update.
   If a slug already exists from a previous run, **ask before overwriting** —
   don't silently clobber a variant that's since been hand-tweaked after
   baking.
4. Also write a matching reference `.svg` per candidate to `assets/svg/
   <slug>-a.svg` etc. — run `node scripts/export-svg.mjs <slug>-a` (repeat per
   variant) once its JSON exists; this is a mechanical, read-only-w.r.t.-the-
   game export from what was just written, not a second transcription pass.
5. Report a short summary: which images were processed, and which (if any)
   Claude couldn't confidently transcribe — skip + say why, don't force a bad
   result through.

## 4. Place it — the world editor

Run `pnpm dev`, press **E**, open the **Assets** tab: the new variants are
under **New**. Click one, click the map, then move/scale it, give it a kind in
the inspector (decor, ground, bridge, collectable, ...) and check its collider
in the **Colliders** tab. **Ctrl+S** writes `src/data/world.json`; commit and
push. Nothing needs pasting into code. Full guide: `docs/Editor.md`.

Only an asset that needs genuinely new behaviour (its own interaction, its own
animation) still needs code: a new `EntityKind`, a `.ent.<kind>` CSS rule and a
case in `src/interact.ts` — see `docs/ArtStyleGuide.md` §10.
