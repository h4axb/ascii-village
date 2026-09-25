// Recolors the player's shorts/shirt to a chosen colour, triggered by
// interacting with one of the 4 laundry-line garments (see interact.ts).
//
// The player's sprites are baked with a shirtMask/shortsMask alongside their
// sprite/colors — a per-cell "is this the shirt/shorts" flag marked directly
// at BAKE TIME from the source SVG's own group structure (which body part
// each glyph belongs to) and colour (neutral-white / denim-blue), not
// guessed afterwards from which palette key looks right. See sprites.ts's
// `WalkFrame`/`PLAYER_SHIRT_MASK`/`PLAYER_SHORTS_MASK` and the bake note in
// each src/data/walk*.json's "source" field for how the mask was derived.
// This sidesteps the whole class of bug the old key+row-range table had:
// every direction's palette is an independently k-means-clustered set of
// keys, so the same letter means a different body part in every direction,
// AND per-frame re-clustering could assign the SAME garment a different key
// in different frames — recolouring by mask instead of by key is immune to
// both, since the mask is derived fresh per frame from the source art.
export interface GarmentRegion {
  keys: string[];
  rowMin: number;
  rowMax: number;
}

export interface Outfit {
  shortsColor?: string; // hex
  shirtColor?: string; // hex
}

// The player's baseline garment colours before any clothesline swap — sampled
// from walkDown.json frame 0 (its most common shorts/shirt key: 'S' for
// shorts, the only key 'F' for shirt). Used as the "what you're currently
// wearing" fallback when outfit.shortsColor/shirtColor is unset, so the
// wardrobe swap (wearFromLine, App.tsx) has something concrete to hang back
// on the line.
export const DEFAULT_SHORTS_HEX = '#669CB2';
// '#ffe6cf' (the baked shirt's own warm-cream tone) was tried here earlier,
// but it has a real hue (~29°, orange/yellow family) — using it as a
// recolour TARGET made the clothesline garment it gets hung on read as
// yellow instead of white after a swap (shiftHue targets its hue exactly).
// True white (h/s = 0) is what "white shirt" actually needs to mean here.
export const DEFAULT_SHIRT_HEX = '#ffffff';

// Row bands for recolouring the HOUSE's own baked sprite when a clothesline
// garment gets swapped (see wearFromLine, App.tsx / interact.ts). Derived
// like OUTFIT_REGIONS above, but with an extra constraint: recolorGarment
// scans a full sprite ROW across every column, not just the garment's own
// box, so any key+row combination that also occurs elsewhere on the house's
// wide facade would bleed into unrelated parts of the picture. Every entry
// below was verified (via this session's _tmp_house_key_leak_check.mjs) to
// occur ONLY inside its own garment's column box, nowhere else in the house.
// 'house-cloth-shorts' is narrower than its bake region's full row span
// (26-27, not 25-29, and only key '9') because its most common cream key
// ('8') is reused broadly across other window/highlight areas of the house
// at the same rows — including it would have recoloured those too.
export const HOUSE_GARMENT_REGIONS: Record<string, GarmentRegion> = {
  'house-cloth-shorts': { keys: ['9'], rowMin: 26, rowMax: 27 },
  'house-cloth-shirt-purple': { keys: ['X', 'U', 'Z'], rowMin: 26, rowMax: 29 },
  'house-cloth-shirt-yellow': { keys: ['Y'], rowMin: 26, rowMax: 29 },
  'house-cloth-shirt-green': { keys: ['N'], rowMin: 26, rowMax: 29 },
};

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
  return '#' + to255(r) + to255(g) + to255(b);
}

// Recolors origHex toward targetHex's hue/saturation while keeping (a
// clamped version of) origHex's own lightness — this is what preserves the
// light/dark shading gradient a garment region already has instead of
// flattening it to one flat colour. The clamp matters: the new player bake's
// shirt is mostly the key 'e' = #fffffe, essentially pure white (l≈0.999) —
// at that lightness, hue/saturation barely affect the rendered RGB at all
// (everything converges toward white), so recolouring "properly" (exact
// original lightness) left the shirt looking almost completely unchanged
// when worn — confirmed by diffing the live DOM cell-by-cell against
// player.json's shirtMask: 20 of 24 masked cells (all the #fffffe ones)
// rendered IDENTICALLY before/after wearing a colour. Clamping into
// [0.18, 0.82] keeps cells in relative order (a highlight cell still ends
// up lighter than a shadow cell) while guaranteeing the target hue is
// actually visible everywhere, including on near-white/near-black cells.
function shiftHue(origHex: string, targetHex: string): string {
  const orig = hexToHsl(origHex);
  const target = hexToHsl(targetHex);
  const l = Math.min(0.82, Math.max(0.18, orig.l));
  return hslToHex(target.h, target.s, l);
}

// Some baked sprites (the house: k-means++'d to exactly 62 keys, no spares)
// leave recolorGarment zero room in the plain alnum pool to allocate a new
// synthetic key. Unicode Private Use Area code points are guaranteed never
// to appear in any baked palette (bake pipelines only ever emit a-zA-Z0-9),
// so appending a block of them keeps a free slot available regardless of
// how full the sprite's own palette already is. These are palette KEYS
// only — indices into `colors`/`palette`, never drawn as glyphs, since
// recolorGarment never touches `sprite`.
const KEY_POOL = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ...Array.from({ length: 64 }, (_, i) => String.fromCodePoint(0xe000 + i)),
];

// Recolors one garment region (shorts OR shirt) of a sprite/colors/palette
// triple. Returns the SAME objects back, untouched, if targetHex is unset or
// the region has no keys (e.g. static's shorts) — no-op, not a copy.
export function recolorGarment(
  sprite: string[],
  colors: string[],
  palette: Record<string, string>,
  region: GarmentRegion,
  targetHex: string | undefined,
): { colors: string[]; palette: Record<string, string> } {
  if (!targetHex || region.keys.length === 0) return { colors, palette };
  const used = new Set(Object.keys(palette));
  const nextFreeKey = () => {
    for (const k of KEY_POOL) if (!used.has(k)) return k;
    return null; // palette exhausted (shouldn't happen: 40 keys used, 62 available)
  };
  const keySet = new Set(region.keys);
  const remap = new Map<string, string>(); // original key -> synthetic key
  const newPalette = { ...palette };
  const newColors = colors.map((line, row) => {
    if (row < region.rowMin || row > region.rowMax) return line;
    const sRow = sprite[row] ?? '';
    let out = '';
    for (let col = 0; col < line.length; col++) {
      const origKey = line[col];
      if (sRow[col] && sRow[col] !== ' ' && keySet.has(origKey)) {
        let synth = remap.get(origKey);
        if (!synth) {
          const picked = nextFreeKey();
          if (!picked) { out += origKey; continue; } // out of keys: leave uncoloured rather than crash
          synth = picked;
          used.add(synth);
          remap.set(origKey, synth);
          newPalette[synth] = shiftHue(palette[origKey], targetHex);
        }
        out += synth;
      } else {
        out += origKey;
      }
    }
    return out;
  });
  return { colors: newColors, palette: newPalette };
}

// Recolors one garment by MASK instead of key+row-range: `mask` is a grid
// the same shape as sprite/colors, where a non-space cell marks "this is
// the garment" (see sprites.ts's WalkFrame/PLAYER_SHIRT_MASK/
// PLAYER_SHORTS_MASK). Returns the SAME objects back, untouched, if
// targetHex or mask is unset — no-op, not a copy.
export function recolorGarmentMask(
  sprite: string[],
  colors: string[],
  palette: Record<string, string>,
  mask: string[] | undefined,
  targetHex: string | undefined,
): { colors: string[]; palette: Record<string, string> } {
  if (!targetHex || !mask) return { colors, palette };
  const used = new Set(Object.keys(palette));
  const nextFreeKey = () => {
    for (const k of KEY_POOL) if (!used.has(k)) return k;
    return null; // palette exhausted (shouldn't happen: 40 keys used, 62 available)
  };
  const remap = new Map<string, string>(); // original key -> synthetic key
  const newPalette = { ...palette };
  const newColors = colors.map((line, row) => {
    const mRow = mask[row] ?? '';
    if (!mRow.trim()) return line;
    const sRow = sprite[row] ?? '';
    let out = '';
    for (let col = 0; col < line.length; col++) {
      const origKey = line[col];
      if (sRow[col] && sRow[col] !== ' ' && mRow[col] && mRow[col] !== ' ') {
        let synth = remap.get(origKey);
        if (!synth) {
          const picked = nextFreeKey();
          if (!picked) { out += origKey; continue; } // out of keys: leave uncoloured rather than crash
          synth = picked;
          used.add(synth);
          remap.set(origKey, synth);
          newPalette[synth] = shiftHue(palette[origKey], targetHex);
        }
        out += synth;
      } else {
        out += origKey;
      }
    }
    return out;
  });
  return { colors: newColors, palette: newPalette };
}

// Applies both garments (shorts then shirt) for whatever's currently shown.
// Returns the original sprite/colors/palette untouched (no new objects) if
// the outfit has nothing set — cheap to call every render.
export function applyOutfit(
  sprite: string[],
  colors: string[],
  palette: Record<string, string>,
  shirtMask: string[] | undefined,
  shortsMask: string[] | undefined,
  outfit: Outfit,
): { sprite: string[]; colors: string[]; palette: Record<string, string> } {
  if (!outfit.shortsColor && !outfit.shirtColor) return { sprite, colors, palette };
  const a = recolorGarmentMask(sprite, colors, palette, shortsMask, outfit.shortsColor);
  const b = recolorGarmentMask(sprite, a.colors, a.palette, shirtMask, outfit.shirtColor);
  return { sprite, colors: b.colors, palette: b.palette };
}
