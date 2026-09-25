// All sprites are arrays of strings (one per line) so whitespace and
// backslashes are preserved exactly. Render with .join('\n') in a <pre>.

import playerData from './data/player.json';
import walkDownData from './data/walkDown.json';
import walkUpData from './data/walkUp.json';
import walkLeftData from './data/walkLeft.json';
import walkRightData from './data/walkRight.json';
import palmData from './data/palm.json';
import houseData from './data/house.json';
import gardenBedData from './data/gardenBed.json';
import cliffData from './data/cliff.json';
import pondData from './data/pond-a.json';
import type { PalmAnim } from './palmAnim';
import type { PondAnim } from './pondAnim';

// ---------------------------------------------------------------------------
// PLAYER — a girl in a straw hat.
//
// Parsed exactly from a reference SVG (straw-hat-still (1).svg — supersedes
// straw-hat-still.svg, the same standing-still pose re-baked; earlier still
// straw-hat-v6[-dark].svg / -glyphs.svg / -v2 / -v4 are differently-sized
// superseded passes at the same "girl in a straw hat" character), the same
// <text x y fill>glyph</text>-per-cell technique as HOUSE, but with a
// twist: instead of a small shared class palette, this reference gives every
// one of its 423 cells its OWN inline fill — 286 near-unique hexes, a
// photo-like gradient rather than a flat-colour "paint by number." Storing
// that many raw keys would bloat the palette for no visual gain, so the
// colours were k-means-clustered down to 40 (a small deterministic JS
// k-means++, no deps) — glyphs themselves are kept exact, only colour is
// approximated. As with HOUSE, this SVG's cells are square (20x20,
// centre-anchored), so every column is doubled to correct for this game's
// own non-square ~1.667:1 (tall:wide) character cell.
//
// At 48x28 characters (post-doubling) it's still too big to draw at native
// size (see PLAYER_SCALE, world.ts) — every place that draws the player (the
// world sprite, the HUD avatar, the crafting-chat portrait) goes through
// ColoredSprite, not a bare <pre>.
export const PLAYER: string[] = playerData.sprite;
export const PLAYER_COLORS: string[] = playerData.colors;
export const PLAYER_PALETTE: Record<string, string> = playerData.palette;
// Which cells are the shirt/shorts — see WalkFrame's own comment below.
export const PLAYER_SHIRT_MASK: string[] | undefined = (playerData as { shirtMask?: string[] }).shirtMask;
export const PLAYER_SHORTS_MASK: string[] | undefined = (playerData as { shortsMask?: string[] }).shortsMask;

// ---------------------------------------------------------------------------
// WALK CYCLES — four-directional walking animation, played while W/A/S/D is
// held (see App.tsx). All four bake down to the same shape (4 discrete
// frames + one shared palette per direction), but the source SVGs used two
// different animation techniques, so they're parsed differently:
//
//   walk-left/-right-cycle (3).svg   FOUR whole <g style="animation:...">
//                              frame blocks, opacity-toggled — each is just
//                              its own complete glyph+colour cell list,
//                              transcribed as-is. (Superseded earlier passes:
//                              walk-left/-right-cycle (1).svg and (2).svg —
//                              same technique, different art each time. Both
//                              directions have since moved off this technique
//                              entirely — see below.)
//
//   walk-left, current bake — the filenames have been reused across passes,
//   so listed by upload order rather than name (all superseding walk-left-
//   cycle (3).svg's old whole-frame technique above):
//     1. walk-left-cycle.svg        introduced the head+body split technique
//     2. walk-left-cycle (1).svg    new art pass, same technique, renamed
//                                   groups (body0..3/head -> leftb0..3/
//                                   lefthead)
//     3. walk-left-cycle.svg        another new art pass (2nd file with this
//                                   name), same leftb/lefthead technique
//     4. walk-left-cycle (1).svg    eye-position fix inside lefthead only
//                                   (2nd file with this name), per an
//                                   explicit "essentially the eye position"
//                                   note; not a new pose/technique
//     5. walk-left-cycle (1).svg    CURRENT (3rd file with this name) — new
//                                   art pass; lefthead's own @keyframes bob
//                                   -20,0,-20,0px this time, the OPPOSITE
//                                   phase from every earlier pass (0,-20,0,
//                                   -20px) — read straight off the file's own
//                                   keyframe rule, not hand-corrected
//   All five use the same two-part technique: a single always-visible
//                              <g class="lefthead"> (hat down through the
//                              shoulders/upper torso) that bobs via its own
//                              @keyframes translateY, painted OVER four
//                              opacity-toggled
//                              <g style="animation: leftb0..3 ..."> frame
//                              blocks (legs + lower torso, fixed position,
//                              never translate — only which one is visible
//                              changes per quarter). Unlike walk-down-cycle
//                              (4).svg's 8-way limb split, "lefthead" here
//                              already covers the WHOLE upper figure rather
//                              than a head-only stub, so bobbing it as one
//                              piece keeps head and torso moving together
//                              with no seam — no "body follows head" override
//                              needed. Both lefthead's own bottom row and the
//                              top row of each leftb group draw an identical
//                              duplicate collar line, so that seam has valid
//                              content whether or not the head is bobbed up
//                              out of the way. No ground-normalization
//                              needed either: the legs never change vertical
//                              position, only which pre-drawn pose is
//                              showing. Carries PAD_TOP: 1 for the head's
//                              one-row upward bob (see walkLeft.json's own
//                              "source" field for this pass's exact colour
//                              count and every other per-bake detail).
//
//   walk-right-cycle (1).svg  Current walk-right bake — the SECOND file with
//                              this name; supersedes walk-right-cycle.svg
//                              (the first righthead/rightb bake, which itself
//                              replaced walk-right-cycle (3).svg's old
//                              whole-frame technique). New art pass; like
//                              walk-left's own latest update, righthead's
//                              @keyframes now bob -20,0,-20,0px — the
//                              OPPOSITE phase from the first walk-right-
//                              cycle.svg bake (0,-20,0,-20px), read straight
//                              off this file's own keyframe rule. Otherwise
//                              the SAME two-part technique walk-left uses,
//                              mirrored group names: <g class="righthead">
//                              (bobs, whole upper figure) painted over four
//                              opacity-toggled
//                              <g style="animation: rightb0..3 ..."> leg
//                              frames. Same reasoning throughout as walk-
//                              left's current bake above (no ground-
//                              normalization needed, collar seam duplicated
//                              in both righthead and every rightb group).
//                              Carries PAD_TOP: 1 for the head's one-row
//                              upward bob (see walkRight.json's own "source"
//                              field).
//
//   walk-up-cycle.svg (HYBRID) — a HYBRID bake, unlike every other direction.
//                              The head/hat (rows 0-11) is kept from the
//                              ORIGINAL walk-up-cycle.svg (the plain
//                              4-whole-frame, opacity-toggle technique above)
//                              — untouched by the newer reference. Only the
//                              body (rows 12-19: legs + lower torso) was
//                              replaced, per an explicit "replace only the
//                              body part" request, with a NEWER walk-up-
//                              cycle.svg that uses a different, mixed
//                              technique of its own: FOUR opacity-toggled
//                              <g style="animation: upbody0..3 ..."> frame
//                              blocks for the legs (read the same way as the
//                              left/right technique above), plus a separate,
//                              always-visible <g class="uphead"> with its own
//                              translateY @keyframes bob — that uphead group
//                              was deliberately NOT used, so the character's
//                              head keeps its original non-bobbing motion and
//                              only the legs actually animate. The newer
//                              file's body groups draw a brown bag strap
//                              diagonally across the back at the same columns
//                              in all four frames — reproduced verbatim, so it
//                              stays on one consistent side through the whole
//                              cycle rather than drifting or flipping.
//                              Row 12 (the collar) is identical across all
//                              four of the newer file's body groups (and
//                              matches its own uphead group's own duplicate of
//                              that row), so it acts as a static, non-animated
//                              seam between the kept head and the new body.
//                              Because the colour source changed (old head
//                              pixels + new body pixels), the palette was
//                              re-clustered from scratch across both — its 40
//                              keys do NOT correspond to the previous
//                              walkUp.json's palette letter-for-letter. See
//                              walkUp.json's own "source" field for the full
//                              detail.
//
//   walk-down-cycle (4).svg   ONE picture split into EIGHT
//                          <g class="body|head|armL|armR|legL|legR|
//                          shoeL|shoeR"> groups — head finally split out from
//                          body (and bobs on its own), plus a dedicated shoe
//                          layer per foot. Each group is independently
//                          translateY-shifted per quarter-step via its own
//                          @keyframes block (animation-name equals the class
//                          name, so the parser reads offsets straight out of
//                          each group's own keyframe rule rather than
//                          hand-transcribing them), and shoeL/shoeR ALSO
//                          toggle opacity per quarter — a shoe sits at a
//                          FIXED position (0px, never translates) and simply
//                          disappears for the one quarter its own leg is
//                          lifted, which is how this reference avoids ever
//                          drawing a shoe floating disconnected below a
//                          shortened leg. The parser reads both the
//                          translateY AND opacity keyframe values directly,
//                          skipping a group's cells entirely for any frame
//                          its opacity is 0. Baked into the same 4-frame
//                          shape by sampling every group at t=0/25/50/75% and
//                          compositing in the SVG's own paint order (body ->
//                          head -> armL -> armR -> legL -> legR -> shoeL ->
//                          shoeR) into one grid per frame, padded at the top
//                          for the biggest upward shift. Still
//                          ground-normalized for consistency with every
//                          walk-down bake so far, though this reference never
//                          actually needs the correction: only one leg lifts
//                          at a time, so a foot (or its still-visible
//                          opposite shoe) is always on the ground row —
//                          unlike (2)/(3), which both required it. Like (1),
//                          frames 0 and 2 are full-rest poses with both feet
//                          down (head/arms still move a little in between,
//                          unlike (1)'s dead-flat rest frames); (3) remains
//                          the only walk-down bake where every one of the 4
//                          frames has leg motion. Three even earlier
//                          references — walk-down-cycle.svg (opacity-frame
//                          style, like the other three directions),
//                          walk-down-cycle (1).svg's original bake, and (3)
//                          — are also superseded.
//
// All four are cross-frame k-means-clustered to one shared 40-key palette per
// direction (so a given body part keeps the same hue frame-to-frame instead
// of each frame quantising its colours separately), then column-doubled for
// this game's non-square character cell exactly like PLAYER. All four are
// also a different reference pass from PLAYER's own straw-hat art — grid
// size and proportions don't match it exactly (left/right's 23x28 comes
// close to PLAYER's own 24x28, row-for-row, but isn't identical) — so
// App.tsx rescales whichever walk frame is showing to match PLAYER's
// on-screen height rather than sharing PLAYER_SCALE directly, regardless of
// how close a given direction's grid happens to already be.
//
// WALK_DOWN's frames carry PAD_TOP: blank rows reserved at the top of every
// frame's grid so the legL/legR groups have headroom to translate upward
// into (see the walkDown.json "source" field) — they're real rows in the
// array, just empty ones, not part of the drawn character. The height-match
// rescale above has to divide those back out (App.tsx's `contentRows`), or
// it would size the CHARACTER as if it were taller than it actually is and
// visibly shrink it relative to the static portrait. The other three
// directions predate this padding scheme, so their PAD_TOP is 0 — every one
// of their rows is real content, and the plain height-match already handles
// it correctly.
export interface WalkFrame {
  sprite: string[];
  colors: string[];
  // Which cells are the shirt/shorts, marked directly at bake time from the
  // source SVG's own group membership + colour (not guessed from palette
  // keys afterwards) — see outfit.ts's recolorGarment. Same shape as
  // sprite/colors, non-space = that garment.
  shirtMask?: string[];
  shortsMask?: string[];
}
export const WALK_DOWN_FRAMES: WalkFrame[] = walkDownData.frames;
export const WALK_DOWN_PALETTE: Record<string, string> = walkDownData.palette;
export const WALK_DOWN_PAD_TOP: number = walkDownData.padTop ?? 0;
export const WALK_UP_FRAMES: WalkFrame[] = walkUpData.frames;
export const WALK_UP_PALETTE: Record<string, string> = walkUpData.palette;
export const WALK_UP_PAD_TOP: number = (walkUpData as { padTop?: number }).padTop ?? 0;
export const WALK_LEFT_FRAMES: WalkFrame[] = walkLeftData.frames;
export const WALK_LEFT_PALETTE: Record<string, string> = walkLeftData.palette;
export const WALK_LEFT_PAD_TOP: number = (walkLeftData as { padTop?: number }).padTop ?? 0;
export const WALK_RIGHT_FRAMES: WalkFrame[] = walkRightData.frames;
export const WALK_RIGHT_PALETTE: Record<string, string> = walkRightData.palette;
export const WALK_RIGHT_PAD_TOP: number = (walkRightData as { padTop?: number }).padTop ?? 0;

export const CAT = [
 '   /\\_/\\',
 '  ( -.- )',
 ' / > ^ < \\',
 '~   ~   ~',
];

// ---------------------------------------------------------------------------
// THE CAT'S SLOW BLINK
//
// Cats slow-blink at people they trust, so Mitchy does it when you sell him
// something. Row 1 of CAT is "  ( -.- )"; the animated part is the three-cell
// FACE between the cheeks, at indices 4-6. Two states, alternating:
//
//   -.-   rest    neutral, eyes open
//   ^-^   happy   eyes squeezed shut in a smile
//
// It's the whole triplet and not just the eyes, because `^-^` moves the middle
// cell too — a smiling cat's muzzle flattens from `.` to `-` as the cheeks come
// up. Both glyphs are plain ASCII, so unlike a block character there's no
// ambiguous-width risk in any font on the stack.
// ---------------------------------------------------------------------------
const CAT_FACE_ROW = 1;
const CAT_FACE_X = 4; // first of the three face cells

// The resting face — matches the `-.-` already drawn into CAT above, so the
// idle sprite and the animated one are the same picture.
export const CAT_FACE_REST = '-.-';
export const CAT_FACE_HAPPY = '^-^';

// One frame per tick. A single squint, held, then back to rest — the hold is
// what makes it read as a deliberate slow blink rather than a twitch. Edit this
// array to change the beat; anything referencing it follows.
export const CAT_HAPPY_BLINK: string[] = [
  CAT_FACE_HAPPY, // eyes squeeze shut — the thank-you, then back to rest
];

// CAT redrawn with a given three-character face. Pure — returns a new array,
// so it's safe to call straight from render.
export function catWithFace(face: string): string[] {
  return CAT.map((line, y) => {
    if (y !== CAT_FACE_ROW) return line;
    const cells = [...line];
    for (let i = 0; i < face.length; i++) cells[CAT_FACE_X + i] = face[i];
    return cells.join('');
  });
}

export const FLOWER = [
  '__)',
  '.-(  (=:',
  '     \\)',
  '(\\__       |',
  ':=)  )-|    __)',
  ' (/     |-(  (=:',
  '____      |   \\)',
];

export const STONE = [
  ' .--.',
  '(    )',
  " '--'",
];

// ---------------------------------------------------------------------------
// FLOWER PLUS — a tiny pixel-art flower: four pink petal blocks in a plus
// shape around a single yellow '@' centre. Hand-transcribed from a
// fully-specified pixel-art reference image (a 3x3 grid — the four petal
// cells are flat colour squares, the centre cell is specifically an '@'
// glyph, not just another coloured square), not the same bouquet as FLOWER
// above — a second, much simpler flower motif for ground dressing.
//
// Each conceptual cell is drawn 2 CHARACTERS WIDE, not 1: a single glyph is
// half as wide as it is tall (the same 2:1 char aspect TILE_CH/TILE_LN uses
// everywhere else), so one character per petal read as a thin bar, not the
// reference's flat square. Doubling the width per cell (and doubling every
// glyph so a petal/centre is solid across both of its own characters, no
// gap) is what makes the petals actual squares, equal to each other and to
// the centre, with no empty space inside the flower's own plus shape — the
// remaining blanks are the four OUTER corners, which are genuinely outside
// the flower (background), matching the reference exactly.
//
// Petal glyph is '█' (a genuinely SOLID filled square, U+2588 FULL BLOCK) —
// '#' was a step up from the round 'o' but is still a hollow/hashed glyph,
// not a filled one. Block characters are East-Asian ambiguous width, so
// without help this font would render them double-width and shear the row
// (see the GLYPH STYLE note above and the waterfall's own block glyphs) —
// this entity is rendered with ColoredSprite's `perCell` prop (App.tsx) plus
// a matching `.ent.flowerplus span` CSS rule (styles.css) that pins every
// glyph to exactly 1ch, the same fix the waterfall tile uses.
export const FLOWER_PLUS = [
  '  ██  ',
  '██████',
  '  ██  ',
];
export const FLOWER_PLUS_COLORS = [
  '..aa..',
  'aabbaa',
  '..aa..',
];
export const FLOWER_PLUS_PALETTE: Record<string, string> = {
  a: '#F47F9D', // petals, pink
  b: '#FFD166', // centre '@', yellow
};

// ---------------------------------------------------------------------------
// GRASS HALM — a pair of grass blades, each drawn as a diagonal run of leaf
// nodes ('o' pairs) leaning away from a central gap. Hand-transcribed
// cell-for-cell from a fully-specified glyph-art reference (exact glyphs and
// per-cell colours were given, not a photo needing interpretation) — same
// situation as HOUSE. Decorative only, drawn small (see GRASS_SCALE, world.ts).
export const GRASS_HALM = [
  '             o   ',
  '             o   ',
  '   o         oo  ',
  '   o        oo   ',
  '     oo   oo      ',
  '     oo  oo    o ',
  '     oo  oo   o  ',
];
export const GRASS_HALM_COLORS = [
  '.............a...',
  '.............b...',
  '...c.........de..',
  '...f........gh...',
  '.....ij...kl......',
  '.....mn..op....q.',
  '.....rs..tu...v..',
];

export const GRASS_HALM_PALETTE: Record<string, string> = {
  a: '#a6ba95', b: '#9eaf8e', c: '#a6ba95', d: '#9eaf8e',
  e: '#95a885', f: '#9eaf8e', g: '#95a885', h: '#8b9d7b',
  i: '#95a885', j: '#8b9d7b', k: '#8b9d7b', l: '#809171',
  m: '#8b9d7b', n: '#809171', o: '#809171', p: '#768568',
  q: '#809171', r: '#768568', s: '#768568', t: '#6b7a5f',
  u: '#768568', v: '#6b7a5f',
};

// ---------------------------------------------------------------------------
// GLYPH STYLE — depth from a DENSITY RAMP, not from more outline.
//
// The line-art sprites carry shape but no weight: every glyph is worth the same
// amount of ink, so a canopy reads as flat as a fence. The glyph style borrows
// the trick a stippled drawing uses — pick the character by how much ink that
// cell should hold, and let colour tier on top of it:
//
//   .  :  o  *  8  @      sparse ....................... dense
//
// So a frond's lit edge is `.`/`o` and its shadowed core is `8`/`@`, and the
// same shape gains a near side and a far side without a single extra stroke.
// All ASCII, deliberately: the block and geometric-shape characters that would
// give a smoother ramp are East-Asian ambiguous width and shear in a CJK-aware
// monospace font (the same trap documented in craft/spriteConfig.ts).
// ---------------------------------------------------------------------------

// The date palm is GENERATED, not hand-drawn — it is far too dense to author
// by hand (31x23 = 713 cells, each with its own glyph and palette key). The
// model lives in scripts/lib/palm.mjs and is baked to src/data/palm.json by:
//
//   node scripts/build-palm.mjs            # or --seed N / --cols N / --ascii
//
// It is deterministic: same flags, byte-identical file. Edit the generator and
// re-bake; do not hand-edit palm.json.
//
// Unlike the buildings, the palm's colours are FIXED HEX rather than derived
// from --c-plant. The reference look is built on a specific olive-to-rust
// gradient, and re-deriving ten tiers from one themed hue would flatten exactly
// the thing that gives it depth. The trade is that the palm does not shift
// through the day/night cycle the way the other plants do.
export const PALM: string[] = palmData.sprite;
export const PALM_COLORS: string[] = palmData.colors;
export const PALM_PALETTE: Record<string, string> = palmData.palette;
// Collision mask, same shape/crop as PALM: a glyph only over the trunk and
// the hanging date bundles — the crown's leaves are left blank here even
// though PALM draws them, so the player can walk through the canopy but
// still bumps the trunk or a dangling bunch. See entityBlocksTile (world.ts)
// and toSolidMask (scripts/lib/palm.mjs).
export const PALM_SOLID: string[] = palmData.solid;
// Everything needed to redraw the palm per frame while it's being shaken —
// see palmAnim.ts. Baked alongside the static frame by the same generator.
export const PALM_ANIM = palmData.anim as unknown as PalmAnim;

// The tree WITHOUT its date bundles. The animation's base layer doubles as the
// picked-clean palm: once you've shaken a tree this growth window its dates are
// on the ground, so returning to the full static sprite would grow them back
// instantly in front of you.
export const PALM_BARE: string[] = palmData.anim.base;
export const PALM_BARE_COLORS: string[] = palmData.anim.baseColors;

// ---------------------------------------------------------------------------
// POND — a standalone glyph-transcribed garden pond (shore/reed glyphs
// mechanically decoded from a reference SVG; the water body is a fitted
// ellipse, animated at runtime by its own pondFrame() formula — see
// scripts/build-pond.mjs and src/pondAnim.ts). Do not hand-edit pond-a.json;
// re-run the build script against the reference SVG instead.
export const POND: string[] = pondData.sprite;
export const POND_COLORS: string[] = pondData.colors;
export const POND_PALETTE: Record<string, string> = pondData.palette;
export const POND_SOLID: string[] = pondData.solid;
export const POND_ANIM = pondData.anim as unknown as PondAnim;

// What the palm drops — GENERATED, not hand-drawn. It is one of the tree's own
// date bundles, lifted straight out of the same model, so the bunch that falls
// during the shake and the bunch lying on the ground are the same picture. It
// shares the palm's palette (the gold `m`/`n` and stem `p` keys), and is drawn
// at PALM_SCALE so it matches the size it landed at.
export const DATE_FRUIT: string[] = palmData.bunch.sprite;
export const DATE_COLORS: string[] = palmData.bunch.colors;
export const DATE_PALETTE: Record<string, string> = palmData.palette;

// ---------------------------------------------------------------------------
// ARCHITECTURE — buildings are drawn as MASS + SIGNS, not outlines.
//
// The village's other sprites are pure contour, which is right for a tree but
// makes a building read as a wireframe: nothing has weight, so nothing sits in
// front of or behind anything else. Buildings instead get a three-step value
// ramp — the classic ASCII one — carried BOTH by the glyph and by the colour:
//
//   `.`  roof fill   sparse → the lightest plane, it faces the sky
//   `:`  wall fill   mid    → the shaded mass; recedes from the outline
//   `#` `[]` `()` `*` `O`   dense → windows, doors, lenses, signage: the
//                             "signs" punched into the mass, and the only
//                             thing lit from inside
//
// Glyphs alone keep it readable if the colours never load; the ARCH_PALETTE
// below does the rest. Every fill character replaces a SPACE the outline
// already enclosed, so silhouettes — and therefore collision boxes — are
// byte-for-byte what they were before the fill was added.
// ---------------------------------------------------------------------------

// Paint-by-number palette for SHOP (HOUSE has its own fixed-hex HOUSE_PALETTE
// below, same reasoning as the palm/pond/bridge: an exotic design reads
// best in specific colours, not ones derived from a shared day/night base).
//
// The three tiers are all mixed from ONE base colour (#cfb08a, matching
// .ent.shop), so they keep their spacing relative to each other: change the
// base and the roof/wall/lit relationship survives. These used to derive
// from a --c-arch day/night var; that palette is gone, so the base is
// written out directly.
const ARCH_BASE = '#cfb08a';
export const ARCH_PALETTE: Record<string, string> = {
  // roof: lifted toward white — the plane catching the sky
  r: `color-mix(in srgb, ${ARCH_BASE} 70%, #ffffff 30%)`,
  // wall: dropped in alpha so the mass sits BACK from the crisp outline
  w: `color-mix(in srgb, ${ARCH_BASE} 55%, transparent)`,
  // lit: windows/doors/signage, warm and near-white — the brightest note
  L: `color-mix(in srgb, ${ARCH_BASE} 35%, #fff6d8 65%)`,
};

// THE PLAYER'S COTTAGE — a porch scene: an upholstered armchair, a laundry
// line (cream shorts + purple/yellow/green shirts), white porch railings and
// the wooden deck+stairs below. GENERATED, like the palm: parsed straight
// from a glyph-grid reference SVG (house_simplified.svg — one
// <text x y fill>glyph</text> per grid cell, same technique as PLAYER),
// then k-means-clustered to 62 colours with pinned centroids for
// rare-but-real hue families (same technique as CLIFF) — this reference gives
// near-unique colour per cell, like PLAYER's own photo-like gradient.
//
// REPLACES the earlier house_taller.svg-derived house — a different source
// image, same role. Baked at FULL fidelity (not downsampled the way this
// session's cliff/garden-bed were): the accompanying
// house_simplified_regions.json marks every hotspot/collider box in this
// source's own raw col/row units, and world.ts's anchor formula depends on
// those units matching this sprite 1:1.
//
// The WHOLE reference is one sprite: roof, walls, windows, the clothesline,
// the chair, the deck and its stairs. The parts you can interact with get
// invisible 'hotspot' entities instead (see STRUCT_ENTS in world.ts).
export const HOUSE: string[] = houseData.sprite;
export const HOUSE_COLORS: string[] = houseData.colors;
export const HOUSE_PALETTE: Record<string, string> = houseData.palette;
// Collision mask over that same grid, per house_simplified_regions.json's
// own wooden_floor_and_stairs region:
//   rows  0-41  roof, walls, windows, clothesline, chair, railings — solid,
//               blocks the whole body
//   rows 42-51  the deck + stairs — walkable, feet-only (paired with the
//               feet-only check in App.tsx's blocked()), the same treatment
//               the old house's deck got. No separate solid flanking piers
//               this time — the region spans the full width uniformly.
export const HOUSE_SOLID: string[] = houseData.solid;

// THE CLIFF — a grass-topped bluff, baked the same way as the house from a
// glyph-grid reference (cliff.svg, 107x55, columns doubled to 214 for the
// non-square character cell). It sits below the cottage, so the house reads as
// standing at the top of a drop.
export const CLIFF: string[] = cliffData.sprite;
export const CLIFF_COLORS: string[] = cliffData.colors;
export const CLIFF_PALETTE: Record<string, string> = cliffData.palette;
// Collision mask over that same grid, and NOT a crop of the art:
//   rows  0-18  the green crown and the crumbling lip below it — NO collider,
//               this is the walkable ledge
//   rows 19-54  the rock face — solid, classified per cell from the source
//               hues so the odd grass tuft growing out of the face is skipped
//
// Row 19 is where the bake measured rock first passing 90% of the row (the
// profile runs 0, 4, 6, 22, 53, 76, 97%), and the lip above it is deliberately
// left walkable rather than classified per cell. Collision resolves per TILE
// and a tile blocks if any single cell in it is solid, so honouring every rock
// speck in that interleaved band walled off a whole tile-row of visible green —
// the player stopped about a tile short of the edge they could see. Letting the
// lip count as ledge puts the brink where the eye puts it.
//
// Paired with the feet-only check in App.tsx's blocked() — the same treatment
// the house's deck gets — this is what lets you walk the green right up to the
// brink and no further, while the rock face stays a wall.
export const CLIFF_SOLID: string[] = cliffData.solid;

// THE GARDEN BED — a fenced plot of bare soil, baked from a glyph-grid
// reference (garden-fence.svg, 157x115) but DOWNSAMPLED to the 44x16 grid it is
// actually drawn on rather than traced cell-for-cell and shrunk with CSS. See
// GARDEN_BED_SCALE in world.ts for why, and gardenBed.json's `generated.note`
// for how. Replaces the old procedurally drawn `+=|.` fence from farm.ts.
export const GARDEN_BED: string[] = gardenBedData.sprite;
export const GARDEN_BED_COLORS: string[] = gardenBedData.colors;
export const GARDEN_BED_PALETTE: Record<string, string> = gardenBedData.palette;

// The reference draws the gate OPEN — a hole in the near fence — so the shut
// state has to be synthesised.
//
// The opening is FOUND in the art rather than written down as row/column
// constants. It used to be six hardcoded indices into the old 314x115 bake, and
// those silently became meaningless the moment the asset was re-baked at a
// different resolution: nothing would have failed, the gate would just have
// stopped closing. Detecting it means the shut state keeps working across
// re-bakes. A gate reads as a run of BLANK cells in the lower part of the
// picture with drawn fence on both sides of it — a hole in an otherwise solid
// near rail — so that is exactly what this looks for, ignoring runs shorter
// than MIN_GAP so ordinary gaps between pickets aren't mistaken for the gate.
const MIN_GAP = 3;

function findGate(rows: string[]): { r: number; c0: number; c1: number }[] {
  const found: { r: number; c0: number; c1: number }[] = [];
  for (let r = Math.floor(rows.length * 0.7); r < rows.length; r++) {
    const line = rows[r];
    const first = line.search(/\S/);
    const last = line.replace(/\s+$/, '').length - 1;
    if (first < 0) continue;
    for (let c = first; c <= last; ) {
      if (line[c] !== ' ') { c++; continue; }
      let end = c;
      while (end <= last && line[end] === ' ') end++;
      if (end - c >= MIN_GAP) found.push({ r, c0: c, c1: end - 1 });
      c = end;
    }
  }
  return found;
}

// Fill the opening by continuing the fence's own run from immediately left of
// it — copy the cell one opening-width back, which repeats whatever rhythm the
// near rail already has without inventing pickets. Falls back to the nearest
// drawn cell to the left when that lands on another blank.
function shutGate(rows: string[], gate = findGate(rows)): string[] {
  const out = rows.slice();
  for (const { r, c0, c1 } of gate) {
    const line = out[r];
    const cells = line.padEnd(c1 + 1, ' ').split('');
    const width = c1 - c0 + 1;
    for (let c = c0; c <= c1; c++) {
      let src = c - width;
      while (src >= 0 && (cells[src] ?? ' ') === ' ') src--;
      if (src >= 0) cells[c] = cells[src];
    }
    out[r] = cells.join('').replace(/\s+$/, '');
  }
  return out;
}

// Detected once off the ART, then applied to the colour grid at the SAME cells —
// the two grids share a shape, and running the detector separately on the
// palette keys would find different holes and tint the wrong cells.
const GATE_GAP = findGate(gardenBedData.sprite);

export const GARDEN_BED_SHUT: string[] = shutGate(GARDEN_BED, GATE_GAP);
export const GARDEN_BED_SHUT_COLORS: string[] = shutGate(GARDEN_BED_COLORS, GATE_GAP);

// "Mitchy's Odds & Ends" — a tall, wonky, stacked tower shop (a cat napping on
// the antenna, a domed observatory window, the MITCHY sign, awning wings, a
// cluttered storefront on stilts) with a SHOP sandwich-board chalkboard beside
// it on the floor. Hand-authored, so it can be taller than the small sprites.
export const SHOP = [
  '    _______',
  '   /..___..\\',
  '  /|..`_`..|\\',
  '   |.(***).|',
  '   |:::-:::|',
  '   |=[]====|_',
  '  /|_________|\\',
  ' //|:[]:[]:|\\\\',
  '   |:|__|__|:|',
  '   |_________|',
  '  _|___:::___|_',
  ' /  |:|[]|:O:| \\',
  '   |:|__|_|__|:|',
  '   |___________|     .------.',
  '   |__|_____|__|     | SHOP |',
  '     |       |       |______|',
  '     |_|   |_|        /|  |\\',
];

// Cell-for-cell with SHOP. The stilt gap on the second-to-last row stays blank
// on purpose — it's open air under the shop, not wall.
export const SHOP_COLORS = [
  '...........',
  '....rr...rr.',
  '....rr...rr..',
  '....r.LLL.r.',
  '....www.www.',
  '.....LL......',
  '...............',
  '....wLLwLLw...',
  '....w.......w.',
  '..............',
  '.......www.....',
  '.....w.LL.wLw...',
  '....w.........w.',
  '.............................',
  '.......................LLLL..',
  '.............................',
  '............................',
];

export const CACTUS = [
  ' _|_',
  '( | )',
  ' |_|',
];

export const FERN = [
  '\\\\|//',
  ' \\|/',
  '  |',
];

export const ICEFLOWER = [
  '\\*/',
  '-*-',
  '/ \\',
];

// Landing banner: "ASCIIA" over "BAY", in the same figlet "standard"
// letterforms as before. Letters carry their own padding and are simply
// concatenated (no smushing), so every row of a block is the same length.
export const TITLE = [
  '    _     ____    ____  ___  ___     _    ',
  '   / \\   / ___|  / ___||_ _||_ _|   / \\   ',
  '  / _ \\  \\___ \\ | |     | |  | |   / _ \\  ',
  ' / ___ \\  ___) || |___  | |  | |  / ___ \\ ',
  '/_/   \\_\\|____/  \\____||___||___|/_/   \\_\\',
  '',
  ' ____      _    __   __',
  '| __ )    / \\   \\ \\ / /',
  '|  _ \\   / _ \\   \\ V / ',
  '| |_) | / ___ \\   | |  ',
  '|____/ /_/   \\_\\  |_|  ',
];

// Builds an ASCII speech bubble with a tail pointing down-left, in the style:
// .--------------------.
// |    hello there!    |
// '--.  .--------------'
//    | /
//    |/
export function makeBubble(text: string, width = 26): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  const inner = Math.max(8, ...lines.map((l) => l.length));
  const out: string[] = [];
  out.push('.' + '-'.repeat(inner + 2) + '.');
  for (const l of lines) out.push('| ' + l.padEnd(inner) + ' |');
  out.push("'--.  ." + '-'.repeat(inner - 4) + "'");
  out.push('   | /');
  out.push('   |/');
  return out.join('\n');
}
