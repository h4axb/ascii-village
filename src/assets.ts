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
import metaData from './data/assets.meta.json';

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
}
const FILES = import.meta.glob<{ default: AssetFile }>('./data/assets/*.json', { eager: true });

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
