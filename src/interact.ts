// Everything the player can hover/click on funnels through this file: what to
// call it, what question to ask, and what happens on "yes". Replaces the old
// proximity-gated `[F]` model (fTarget/gTarget/cropSlot + PRIO + doF()'s
// switch in App.tsx) — see the session plan for why: hover shows a name from
// anywhere on screen, click asks a yes/no question, no walking up required.
import type { Ent, EntityKind } from './world';
import type { PlantedCrop, Doors, DoorId } from './farm';
import { cropStatus } from './farm';
import type { SlotEffect } from './farm';

export type InteractRef =
  | { kind: 'entity'; id: string }
  | { kind: 'crop'; slot: number }
  | { kind: 'door'; door: DoorId };

export interface InteractionCopy {
  name: string;
  question: string;
}

// What each invisible 'hotspot' entity over the house picture is: the front
// door (house_simplified_regions.json's front_door region) opens the 5-slot
// home storage menu.
export type HotspotInfo = { name: string; question: string; act: 'house' };

export const HOTSPOT_INFO: Record<string, HotspotInfo> = {
  'house-door': {
    name: 'the house',
    question: 'Do you want to check the house?',
    act: 'house',
  },
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
  // the fence gates standing open (by entity id)
  openGates: ReadonlySet<string>;
  // the bench the player is sitting on (by entity id), if any
  sittingOn?: string | null;
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
          ? `Do you want to pluck out this dried ${c.name}?`
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
    case 'gate': {
      const open = ctx.openGates.has(e.id);
      return { name: open ? 'close the gate' : 'open the gate', question: open ? 'Do you want to close the gate?' : 'Do you want to open the gate?' };
    }
    case 'bench':
      return ctx.sittingOn === e.id
        ? { name: 'stand up', question: 'Do you want to stand up?' }
        : { name: 'the bench', question: 'Do you want to sit down?' };
    case 'cat':
      return { name: 'Mitchy', question: 'Do you want to talk to Mitchy?' };
    case 'shop':
      return { name: 'the shop', question: 'Do you want to enter the shop?' };
    case 'hotspot': {
      const info = HOTSPOT_INFO[e.id];
      if (!info) return null;
      return { name: info.name, question: info.question };
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
  toggleGate: (id: string) => void; // a fence gate (src/fence.ts)
  sit: (e: Ent) => void; // sit down on a bench, or stand up from it
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
    case 'gate':
      actions.toggleGate(e.id);
      break;
    case 'bench':
      actions.sit(e);
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
      break;
    }
  }
}
