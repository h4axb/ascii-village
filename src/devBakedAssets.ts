// ---------------------------------------------------------------------------
// DEV-ONLY: every world sprite that's ALREADY baked/hand-authored and shipped
// in the game (src/sprites.ts), exposed to the world-asset editor as a
// separate, always-available browse/drag source — distinct from the
// manifest-driven Stage-A "freshly transcribed" assets in
// src/data/worldAssets.manifest.json (see devWorldAssets.ts).
//
// Read-only reference data, not a pipeline: nothing here is generated or
// written to. `kind` is the REAL EntityKind these already use in world.ts —
// dropping a `<built>` draft in already has a valid kind and existing sprite/
// palette/colors exports, so dump()'s "new kind, needs wiring" checklist does
// NOT apply to these (see the `origin: 'baked'` branch in devWorldAssets.ts's
// dump()). `varRef` records the exact `S.<NAME>` identifiers so dump() can
// print a paste-ready Ent literal that references the existing sprites.ts
// exports directly, instead of inventing new ones.
//
// Deliberately excludes the ocean (procedural, not a placeable sprite/entity)
// and PLAYER/walk-cycle frames (the controlled character, not a world decor
// entity) and TITLE (a UI banner, not a world entity).
// ---------------------------------------------------------------------------
import * as S from './sprites';
import type { EntityKind } from './world';

export interface BakedAssetEntry {
  slug: string; // editor-only id, prefixed so it can never collide with a manifest slug
  label: string;
  kind: EntityKind;
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string; // mono items with no per-cell palette — CSS .ent.<kind> base colour
  scale: number;
  varRef: { sprite: string; palette?: string; colors?: string }; // exact sprites.ts export names, for dump()
}

export const BAKED_ASSETS: BakedAssetEntry[] = [
  {
    slug: 'built-palm',
    label: 'Date palm',
    kind: 'palm',
    sprite: S.PALM,
    colors: S.PALM_COLORS,
    palette: S.PALM_PALETTE,
    scale: 1,
    varRef: { sprite: 'S.PALM', palette: 'S.PALM_PALETTE', colors: 'S.PALM_COLORS' },
  },
  {
    slug: 'built-house',
    label: 'House',
    kind: 'house',
    sprite: S.HOUSE,
    colors: S.HOUSE_COLORS,
    palette: S.HOUSE_PALETTE,
    scale: 0.36, // matches HOUSE_SCALE (world.ts)
    varRef: { sprite: 'S.HOUSE', palette: 'S.HOUSE_PALETTE', colors: 'S.HOUSE_COLORS' },
  },
  {
    slug: 'built-shop',
    label: 'Shop',
    kind: 'shop',
    sprite: S.SHOP,
    colors: S.SHOP_COLORS,
    palette: S.ARCH_PALETTE,
    scale: 1,
    varRef: { sprite: 'S.SHOP', palette: 'S.ARCH_PALETTE', colors: 'S.SHOP_COLORS' },
  },
  {
    slug: 'built-grasshalm',
    label: 'Grass halm',
    kind: 'grasshalm',
    sprite: S.GRASS_HALM,
    colors: S.GRASS_HALM_COLORS,
    palette: S.GRASS_HALM_PALETTE,
    scale: 0.2,
    varRef: { sprite: 'S.GRASS_HALM', palette: 'S.GRASS_HALM_PALETTE', colors: 'S.GRASS_HALM_COLORS' },
  },
  {
    slug: 'built-flowerplus',
    label: 'Flower plus',
    kind: 'flowerplus',
    sprite: S.FLOWER_PLUS,
    colors: S.FLOWER_PLUS_COLORS,
    palette: S.FLOWER_PLUS_PALETTE,
    scale: 0.5,
    varRef: { sprite: 'S.FLOWER_PLUS', palette: 'S.FLOWER_PLUS_PALETTE', colors: 'S.FLOWER_PLUS_COLORS' },
  },
  {
    slug: 'built-cat',
    label: 'Cat (Mitchy)',
    kind: 'cat',
    sprite: S.CAT,
    color: '#e9dcc1',
    scale: 1,
    varRef: { sprite: 'S.CAT' },
  },
  {
    slug: 'built-stone',
    label: 'Stone',
    kind: 'stone',
    sprite: S.STONE,
    color: '#8a8a8a',
    scale: 1,
    varRef: { sprite: 'S.STONE' },
  },
  {
    slug: 'built-cactus',
    label: 'Cactus',
    kind: 'cactus',
    sprite: S.CACTUS,
    color: '#6a9a4e',
    scale: 1,
    varRef: { sprite: 'S.CACTUS' },
  },
  {
    slug: 'built-fern',
    label: 'Fern',
    kind: 'fern',
    sprite: S.FERN,
    color: '#6a9a4e',
    scale: 1,
    varRef: { sprite: 'S.FERN' },
  },
  {
    slug: 'built-iceflower',
    label: 'Ice flower',
    kind: 'iceflower',
    sprite: S.ICEFLOWER,
    color: '#6a9a4e',
    scale: 1,
    varRef: { sprite: 'S.ICEFLOWER' },
  },
  {
    slug: 'built-date',
    label: 'Date fruit (dropped)',
    kind: 'date',
    sprite: S.DATE_FRUIT,
    colors: S.DATE_COLORS,
    palette: S.DATE_PALETTE,
    scale: 1,
    varRef: { sprite: 'S.DATE_FRUIT', palette: 'S.DATE_PALETTE', colors: 'S.DATE_COLORS' },
  },
];

export function findBakedAsset(slug: string): BakedAssetEntry | undefined {
  return BAKED_ASSETS.find((a) => a.slug === slug);
}
