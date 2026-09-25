// Everything the player can hover/click on funnels through this file: what to
// call it, what question to ask, and what happens on "yes". Replaces the old
// proximity-gated `[F]` model (fTarget/gTarget/cropSlot + PRIO + doF()'s
// switch in App.tsx) — see the session plan for why: hover shows a name from
// anywhere on screen, click asks a yes/no question, no walking up required.
import type { Ent, EntityKind } from './world';
import type { PlantedCrop, Doors, DoorId } from './farm';
import { cropStatus } from './farm';
import type { SlotEffect } from './farm';
import { DEFAULT_SHORTS_HEX, DEFAULT_SHIRT_HEX } from './outfit';

export type InteractRef =
  | { kind: 'entity'; id: string }
  | { kind: 'crop'; slot: number }
  | { kind: 'door'; door: DoorId };

export interface InteractionCopy {
  name: string;
  question: string;
}

// What each invisible 'hotspot' entity over the house picture actually is.
// The four garments are a two-way WARDROBE SWAP, not a one-way recolour:
// clicking a hanging garment puts it on, and whatever you were wearing takes
// its place on the line (visually recoloured on the house's own sprite — see
// HOUSE_GARMENT_REGIONS, outfit.ts, and wearFromLine, App.tsx). `bakedHex` is
// what that slot's garment looked like when the house was baked — the
// fallback for "nothing's been hung there yet" — while the CURRENT colour
// actually hanging there lives in runtime state (`lineColors`, App.tsx),
// since it changes as the player swaps things in and out.
//
// bakedHex values are read off the same cells of house_simplified.svg that
// painted them (dominant colour within each named region of
// house_simplified_regions.json, filtered to the garment's own hue family
// since the region boxes also catch a sliver of window/sky between the
// pegs), so the cloth on the line and the outfit you get from it start out
// the same colour.
//
// The front door (house_simplified_regions.json's front_door region) opens
// the same 5-slot home storage menu the old house used — openHouseMenu()
// already existed and worked, it just had nothing pointing at it.
export type HotspotInfo =
  | { act: 'outfit'; region: 'shorts' | 'shirt'; bakedHex: string }
  | { name: string; question: string; act: 'house' }
  // no sit-down animation exists yet — saying yes just acknowledges it rather
  // than silently doing nothing, so the chair doesn't read as broken
  | { name: string; question: string; act: 'sit' };

export const HOTSPOT_INFO: Record<string, HotspotInfo> = {
  'house-cloth-shorts': { act: 'outfit', region: 'shorts', bakedHex: '#fef5e6' },
  'house-cloth-shirt-purple': { act: 'outfit', region: 'shirt', bakedHex: '#cba7cb' },
  'house-cloth-shirt-yellow': { act: 'outfit', region: 'shirt', bakedHex: '#ffd379' },
  'house-cloth-shirt-green': { act: 'outfit', region: 'shirt', bakedHex: '#afb787' },
  'house-chair': {
    name: 'the armchair',
    question: 'Do you want to sit on the armchair?',
    act: 'sit',
  },
  'house-door': {
    name: 'the house',
    question: 'Do you want to check the house?',
    act: 'house',
  },
};

// The closed set of colours that can ever be hanging on the line or worn by
// the player — 2 defaults (what you start in) + the 4 baked clothesline
// colours. Used to name a garment by its CURRENT colour rather than a fixed
// name, since a swap can put any of these on any slot.
const COLOR_LABEL: Record<string, string> = {
  [DEFAULT_SHORTS_HEX]: 'blue',
  [DEFAULT_SHIRT_HEX]: 'white',
  '#fef5e6': 'cream',
  '#cba7cb': 'purple',
  '#ffd379': 'yellow',
  '#afb787': 'green',
};

const COLLECT_NAME: Partial<Record<EntityKind, string>> = {
  flower: 'flower',
  stone: 'stone',
  date: 'date',
  cactus: 'cactus',
  fern: 'fern',
  iceflower: 'ice flower',
  flowerplus: 'flower',
};

export interface InteractCtx {
  ents: Ent[];
  crops: PlantedCrop[];
  wt: number;
  fxFor: (slot: number) => SlotEffect;
  doors: Doors;
  // what's currently hanging on each clothesline hotspot id, keyed by hotspot
  // id — absent means "still whatever it was baked with" (see HOTSPOT_INFO's
  // bakedHex).
  lineColors: Record<string, string>;
}

// Pure — given a ref and read-only world state, what should hover/click show?
// Returns null for anything not actually interactable (hover/click no-ops).
export function describeInteraction(ref: InteractRef, ctx: InteractCtx): InteractionCopy | null {
  if (ref.kind === 'door') {
    // one gate now, so it needs no top/bottom qualifier in its name
    const isOpen = ctx.doors[ref.door];
    return {
      name: 'the garden gate',
      question: isOpen ? 'Do you want to close the garden gate?' : 'Do you want to open the garden gate?',
    };
  }
  if (ref.kind === 'crop') {
    const c = ctx.crops.find((cr) => cr.slot === ref.slot);
    if (!c) return null;
    const st = cropStatus(c, ctx.wt, ctx.fxFor(ref.slot));
    const question =
      c.stage === 'ready'
        ? `Do you want to harvest this ${c.name}?`
        : c.stage === 'failed'
          ? `Do you want to clear this ${c.name}?`
          : st.thirsty
            ? `Do you want to water this ${c.name}?`
            : `Do you want to check on this ${c.name}?`;
    return { name: c.name, question };
  }
  // ref.kind === 'entity'
  const e = ctx.ents.find((x) => x.id === ref.id);
  if (!e || !e.interactable) return null;
  switch (e.kind) {
    case 'flower':
    case 'stone':
    case 'date':
    case 'cactus':
    case 'fern':
    case 'iceflower':
    case 'flowerplus': {
      const name = COLLECT_NAME[e.kind] ?? e.kind;
      return { name, question: `Do you want to collect this ${name}?` };
    }
    case 'palm':
      return { name: 'palm tree', question: 'Do you want to shake this palm tree?' };
    case 'cat':
      return { name: 'Mitchy', question: 'Do you want to talk to Mitchy?' };
    case 'shop':
      return { name: 'the shop', question: 'Do you want to enter the shop?' };
    case 'hotspot': {
      const info = HOTSPOT_INFO[e.id];
      if (!info) return null;
      if (info.act !== 'outfit') return { name: info.name, question: info.question };
      const hangingHex = ctx.lineColors[e.id] ?? info.bakedHex;
      const label = COLOR_LABEL[hangingHex] ?? 'unknown';
      const noun = info.region === 'shorts' ? 'shorts' : 'shirt';
      return {
        name: `the ${label} ${noun}`,
        question: `Do you want to change your clothes to the ${label} ${noun}?`,
      };
    }
    default:
      return null;
  }
}

// The "yes" dispatcher — everything doF()'s switch used to call directly,
// now reachable by ref instead of only through a proximity-computed target.
export interface InteractActions {
  collect: (e: Ent) => void;
  shakeTree: (e: Ent) => void;
  openDialog: () => void;
  openShop: () => void;
  openHouseMenu: () => void;
  openCropPanel: (slot: number) => void;
  toggleDoor: (d: DoorId) => void;
  // Two-way swap: the player wears `hangingHex`, and whatever they were
  // wearing for that region takes its place on the line at `hotspotId`.
  wearFromLine: (hotspotId: string, region: 'shorts' | 'shirt', hangingHex: string) => void;
  say: (text: string) => void;
}

export function runInteraction(ref: InteractRef, ctx: InteractCtx, actions: InteractActions): void {
  if (ref.kind === 'door') {
    actions.toggleDoor(ref.door);
    return;
  }
  if (ref.kind === 'crop') {
    actions.openCropPanel(ref.slot);
    return;
  }
  const e = ctx.ents.find((x) => x.id === ref.id);
  if (!e || !e.interactable) return;
  switch (e.kind) {
    case 'flower':
    case 'stone':
    case 'date':
    case 'cactus':
    case 'fern':
    case 'iceflower':
    case 'flowerplus':
      actions.collect(e);
      break;
    case 'palm':
      actions.shakeTree(e);
      break;
    case 'cat':
      actions.openDialog();
      break;
    case 'shop':
      actions.openShop();
      break;
    case 'hotspot': {
      const info = HOTSPOT_INFO[e.id];
      if (!info) break;
      if (info.act === 'house') actions.openHouseMenu();
      else if (info.act === 'sit') actions.say('you rock back and forth for a while.');
      else {
        const hangingHex = ctx.lineColors[e.id] ?? info.bakedHex;
        actions.wearFromLine(e.id, info.region, hangingHex);
      }
      break;
    }
  }
}
