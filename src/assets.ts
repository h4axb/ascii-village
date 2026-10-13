// ---------------------------------------------------------------------------
// ASSET REGISTRY — every sprite the world editor can place, by slug.
//
// Two sources:
//   1. Every JSON file in src/data/assets/ with a `sprite` grid (plus
//      optional `colors`/`palette`/`solid`). Picked up automatically: drop a
//      new file in (e.g. from scripts/svg-glyph-to-asset.mjs) and it is in
//      the editor's list on the next reload, no code change. Its slug is the
//      file name.
//   2. The sprites that live in code (sprites.ts), registered once below.
//
// Per-asset settings (kind, default scale, label, clickable) come from
// src/data/assets.meta.json, which the editor's inspector writes. Anything
// not set there falls back to the defaults below.
//
// world.ts resolves the `asset` slug of every placed object in
// src/data/world.json through this table, so this ships in production. It
// must not import VALUES from world.ts (world.ts imports this module), only
// types — hence the scale numbers written out here.
// ---------------------------------------------------------------------------
import * as S from './sprites';
import type { EntityKind } from './world';
import type { SignLayers } from './wayfinder';
import metaData from './data/assets.meta.json';
import { onThemeChange, stoneLook, themeSwatch, pondLook, themeColor } from './theme';

export interface AssetDef {
  slug: string;
  label: string;
  kind: EntityKind;
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  // Collision mask in the sprite's own shape: a cell blocks where this has a
  // non-space character. Absent = blocks wherever a glyph is drawn.
  solid?: string[];
  scale: number;
  interactable: boolean;
  group: 'Buildings' | 'Nature' | 'Items' | 'Water' | 'New';
  file?: string; // src/data/assets/<file> for file assets
  // kind 'cat' only: a look for Mitchy, never placed on its own (see
  // applyMitchyLook in world.ts); the rows of his head, for portraits
  headRows?: number;
  // palette keys whose glyphs sway left and right (an animated pond's water)
  sway?: string;
  // palette keys drawn without a backing and tinted toward the ground's
  // grass (a pond's outer grass, so its edge melts into the ground)
  blend?: string;
  // a sign made of parts (the wayfinder): its boards turn and tilt per
  // placement (src/wayfinder.ts)
  layers?: SignLayers;
}

export interface AssetMeta {
  kind?: EntityKind;
  scale?: number;
  label?: string;
  interactable?: boolean;
}

export const ASSET_META: Record<string, AssetMeta> = metaData as Record<string, AssetMeta>;

const blank = (sprite: string[]) => sprite.map((l) => ' '.repeat(l.length));

// The sprites that live in code. Scales match the constants in world.ts
// (HOUSE_SCALE, SHOP_SCALE, ...).
const CODE_ASSETS: AssetDef[] = [
  { slug: 'house', label: 'House', kind: 'house', group: 'Buildings', sprite: S.HOUSE, colors: S.HOUSE_COLORS, palette: S.HOUSE_PALETTE, solid: S.HOUSE_SOLID, scale: 0.36, interactable: false },
  { slug: 'shop', label: 'Shop', kind: 'shop', group: 'Buildings', sprite: S.SHOP, colors: S.SHOP_COLORS, palette: S.SHOP_PALETTE, solid: S.SHOP_SOLID, scale: 0.4, interactable: true },
  { slug: 'palm', label: 'Date palm', kind: 'palm', group: 'Nature', sprite: S.PALM, colors: S.PALM_COLORS, palette: S.PALM_PALETTE, solid: S.PALM_SOLID, scale: 1, interactable: true },
  { slug: 'grasshalm', label: 'Grass tuft', kind: 'grasshalm', group: 'Nature', sprite: S.GRASS_HALM, colors: S.GRASS_HALM_COLORS, palette: S.GRASS_HALM_PALETTE, solid: blank(S.GRASS_HALM), scale: 0.2, interactable: false },
  { slug: 'flowerplus', label: 'Flower (collectable)', kind: 'flowerplus', group: 'Nature', sprite: S.FLOWER_PLUS, colors: S.FLOWER_PLUS_COLORS, palette: S.FLOWER_PLUS_PALETTE, solid: blank(S.FLOWER_PLUS), scale: 0.5, interactable: true },
  { slug: 'flowerplus-white', label: 'White flower (collectable)', kind: 'flowerplus', group: 'Nature', sprite: S.FLOWER_PLUS, colors: S.FLOWER_PLUS_COLORS, palette: S.FLOWER_PLUS_WHITE_PALETTE, solid: blank(S.FLOWER_PLUS), scale: 0.5, interactable: true },
  { slug: 'flowerplus-purple', label: 'Purple flower (collectable)', kind: 'flowerplus', group: 'Nature', sprite: S.FLOWER_PLUS, colors: S.FLOWER_PLUS_COLORS, palette: S.FLOWER_PLUS_PURPLE_PALETTE, solid: blank(S.FLOWER_PLUS), scale: 0.5, interactable: true },
  { slug: 'flowerplus-orange', label: 'Orange flower (collectable)', kind: 'flowerplus', group: 'Nature', sprite: S.FLOWER_PLUS, colors: S.FLOWER_PLUS_COLORS, palette: S.FLOWER_PLUS_ORANGE_PALETTE, solid: blank(S.FLOWER_PLUS), scale: 0.5, interactable: true },
  { slug: 'cliff', label: 'Cliff', kind: 'cliff', group: 'Nature', sprite: S.CLIFF, colors: S.CLIFF_COLORS, palette: S.CLIFF_PALETTE, solid: blank(S.CLIFF), scale: 1, interactable: false },
  { slug: 'pond-a', label: 'Pond', kind: 'pond', group: 'Water', sprite: S.POND, colors: S.POND_COLORS, palette: S.POND_PALETTE, scale: 0.35, interactable: false },
  { slug: 'stone', label: 'Stone (collectable)', kind: 'stone', group: 'Items', sprite: S.STONE, scale: 1, interactable: true },
  { slug: 'cactus', label: 'Cactus (collectable)', kind: 'cactus', group: 'Items', sprite: S.CACTUS, scale: 1, interactable: true },
  { slug: 'fern', label: 'Fern (collectable)', kind: 'fern', group: 'Items', sprite: S.FERN, scale: 1, interactable: true },
  { slug: 'iceflower', label: 'Ice flower (collectable)', kind: 'iceflower', group: 'Items', sprite: S.ICEFLOWER, scale: 1, interactable: true },
  { slug: 'date', label: 'Dates (collectable)', kind: 'date', group: 'Items', sprite: S.DATE_FRUIT, colors: S.DATE_COLORS, palette: S.DATE_PALETTE, scale: 1, interactable: true },
];

// Not placeable (there is only one of each and the game wires them by id),
// but registered so their collider can be painted like any other asset.
export const FIXED_ASSETS: AssetDef[] = [
  { slug: 'mitchy', label: 'Mitchy', kind: 'cat', group: 'Buildings', sprite: S.MITCHY, colors: S.MITCHY_COLORS, palette: S.MITCHY_PALETTE, scale: 1, interactable: true },
  { slug: 'garden-bed', label: 'Garden', kind: 'gardenbed', group: 'Buildings', sprite: S.GARDEN_BED, colors: S.GARDEN_BED_COLORS, palette: S.GARDEN_BED_PALETTE, solid: blank(S.GARDEN_BED), scale: 0.5, interactable: false },
];

interface AssetFile extends AssetMeta {
  sprite?: string[];
  colors?: string[];
  palette?: Record<string, string>;
  solid?: string[];
  headRows?: number;
  sway?: string;
  blend?: string;
  layers?: SignLayers;
}
const FILES = import.meta.glob<{ default: AssetFile }>('./data/assets/*.json', { eager: true });

// a palette's water: the clearly blue colours
function waterKeys(palette: Record<string, string>): string | undefined {
  const keys = Object.entries(palette)
    .filter(([, h]) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      return b > r + 30 && b >= g - 8;
    })
    .map(([k]) => k)
    .join('');
  return keys || undefined;
}

function fileAssets(): AssetDef[] {
  const out: AssetDef[] = [];
  for (const [path, mod] of Object.entries(FILES)) {
    const d = mod.default;
    if (!Array.isArray(d.sprite) || d.sprite.length === 0) continue;
    const file = path.slice(path.lastIndexOf('/') + 1);
    const slug = file.replace(/\.json$/, '');
    out.push({
      slug,
      // a file may carry its own defaults; assets.meta.json still wins
      label: d.label ?? slug,
      kind: d.kind ?? 'decor',
      group: 'New',
      sprite: d.sprite,
      colors: d.colors,
      palette: d.palette,
      solid: d.solid,
      scale: d.scale ?? 1,
      interactable: d.interactable ?? false,
      file,
      headRows: d.headRows,
      // a pond without its own sway keys: its blue colours are its water
      sway: d.sway ?? (/^pond/.test(slug) && d.palette ? waterKeys(d.palette) : undefined),
      blend: d.blend,
      layers: d.layers,
    });
  }
  return out;
}

function withMeta(a: AssetDef): AssetDef {
  const m = ASSET_META[a.slug];
  return m ? { ...a, ...m } : a;
}

// Before assets.meta.json is applied — the editor layers its own unsaved
// meta over these.
export const RAW_ASSETS: AssetDef[] = [...CODE_ASSETS, ...fileAssets()];
export const ASSETS: AssetDef[] = RAW_ASSETS.map(withMeta);
const BY_SLUG = new Map([...ASSETS, ...FIXED_ASSETS.map(withMeta)].map((a) => [a.slug, a]));

// ---- the stones' colours (the editor's Theme tab, "Stones") ------------------
// Every colour of a stone asset's drawing (src/data/assets/*stone-*.json) is
// one of five kinds: lit stone, stone, stone in shadow, moss, grass at its
// foot. It moves with its kind's theme swatch (stoneAsset.*: the shift from
// the swatch's default is added to it), then the stones' saturation and
// brightness apply. At the defaults every colour is exactly as drawn. The
// palettes are refilled in place, like the palm's (sprites.ts): every placed
// stone shares its asset's palette object.
type StoneKind = 'light' | 'mid' | 'shadow' | 'moss' | 'grass';
// the swatches' defaults: the mean colour of each kind over all the stones
const STONE_DEFAULT: Record<StoneKind, string> = { light: '#e1c8a8', mid: '#9b8b73', shadow: '#553f43', moss: '#3c6b50', grass: '#84b068' };
const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function stoneKind(hex: string): StoneKind {
  const [r, g, b] = rgbOf(hex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (g > r + 12 && g >= b - 8) return lum >= 130 ? 'grass' : 'moss';
  return lum >= 165 ? 'light' : lum >= 110 ? 'mid' : 'shadow';
}
const STONES = [...ASSETS, ...RAW_ASSETS]
  .filter((a) => /^(standing-)?stone-/.test(a.slug) && a.palette)
  .map((a) => a.palette!)
  .filter((p, i, all) => all.indexOf(p) === i)
  .map((palette) => ({ palette, orig: Object.entries(palette).map(([k, hex]) => ({ k, rgb: rgbOf(hex), kind: stoneKind(hex) })) }));
function themeStones() {
  const look = stoneLook();
  const shift = {} as Record<StoneKind, number[]>;
  for (const kind of Object.keys(STONE_DEFAULT) as StoneKind[]) {
    const to = rgbOf(themeSwatch(`stoneAsset.${kind}`)), from = rgbOf(STONE_DEFAULT[kind]);
    shift[kind] = to.map((v, i) => v - from[i]);
  }
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  for (const { palette, orig } of STONES)
    for (const { k, rgb, kind } of orig) {
      const c = rgb.map((v, i) => v + shift[kind][i]);
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      palette[k] = '#' + c.map((v) => ch((lum + (v - lum) * look.saturation) * look.brightness)).join('');
    }
}
themeStones();
onThemeChange(themeStones);

// ---- the ponds' look (the editor's Theme tab, "Pond") -----------------------
// Every pond asset's colours go through the pond's saturation, brightness and
// tint; its outer grass ('blend' keys) is pulled halfway toward the ground's
// own grass glyphs first, so its edge melts into the ground. Refilled in
// place on a theme change, like the stones.
const PONDS = [...ASSETS, ...RAW_ASSETS]
  .filter((a) => /^pond/.test(a.slug) && a.palette)
  .filter((a, i, all) => all.findIndex((b) => b.palette === a.palette) === i)
  .map((a) => ({ palette: a.palette!, blend: a.blend ?? '', orig: Object.entries(a.palette!).map(([k, hex]) => ({ k, rgb: rgbOf(hex) })) }));
function themePonds() {
  const look = pondLook();
  const tint = rgbOf(look.tint);
  const grass = rgbOf(themeColor('grass.glyph'));
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  for (const { palette, blend, orig } of PONDS)
    for (const { k, rgb } of orig) {
      let c = blend.includes(k) ? rgb.map((v, i) => v + (grass[i] - v) * 0.5) : rgb;
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      c = c.map((v, i) => ((lum + (v - lum) * look.saturation) * look.brightness) * (1 - look.tintAmount) + tint[i] * look.tintAmount * (lum / 160));
      palette[k] = '#' + c.map(ch).join('');
    }
}
themePonds();
onThemeChange(themePonds);

export function assetOf(slug: string | undefined): AssetDef | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

// The asset a built-in (world.ts) object draws, by its kind — so the
// inspector can name it and a painted collider applies to it too.
export const ASSET_OF_KIND: Partial<Record<EntityKind, string>> = {
  house: 'house',
  shop: 'shop',
  palm: 'palm',
  grasshalm: 'grasshalm',
  flowerplus: 'flowerplus',
  cliff: 'cliff',
  cat: 'mitchy',
  gardenbed: 'garden-bed',
};
