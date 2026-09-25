// ---------------------------------------------------------------------------
// DEV-ONLY WORLD ASSET EDITOR — click a transcribed asset, drag/scale/rotate
// it into place, dump paste-ready STRUCT_ENTS source. The placement half of
// docs/AssetTranscriptionWorkflow.md (transcription is the other half, done
// in a Claude Code session — see that doc).
//
// Deliberately NOT built on src/placement.ts's PlacedItem/placedItems: that
// system is persisted into the PLAYER'S SAVE FILE and tightly coupled to
// OwnedItem/bag/equip mechanics — permanent dev-authored content must never
// touch either. This hook reuses only the *patterns* (ghost cursor, rotation,
// collision-aware tint) plus devLayout.ts's own localStorage/console-API/
// dump() conventions, with its own separate storage and its own collision
// policy (see below).
//
// Every effect below early-returns unless import.meta.env.DEV — same shape as
// devLayout.ts and the window.time clock scrubber, so none of this exists in
// a production build.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import {
  MAP_W,
  MAP_H,
  spriteTiles,
  collisionBox,
  tileBoxesOverlap,
  isWater,
  isFoamZone,
  STRUCT_ENTS,
  STRUCT_ENTS_BASE_IDS,
  PERSISTED_REMOVED_IDS,
  PERSISTED_ADDED,
} from './world';
import type { Ent } from './world';
import { inGarden, GARDEN_PLOT } from './farm';
import type { GardenPlot } from './farm';
import { screenToTile } from './coords';
import type { CamSnapshot } from './coords';
import manifestData from './data/worldAssets.manifest.json';
import { BAKED_ASSETS, findBakedAsset } from './devBakedAssets';
import type { BakedAssetEntry } from './devBakedAssets';

export interface WorldAssetVariant {
  slug: string;
  dataFile: string;
  suggestedKind: string;
  sizeTier: 'small' | 'medium' | 'large';
  suggestedScale: number;
  spriteDims: { w: number; h: number };
  warnings: string[];
}
export interface WorldAssetManifestGroup {
  group: string;
  sourceImage: string;
  variants: WorldAssetVariant[];
}

type SpriteData = {
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string; // mono baked items with no per-cell palette (see devBakedAssets.ts)
  solid?: string[];
};

export interface DraftAsset {
  id: string; // `${slug}-${n}`, stamped like PALM_SPOTS/GRASS_SPOTS
  slug: string;
  kind: string; // suggestedKind, editable before dump
  origin: 'baked' | 'transcribed'; // baked = already shipped, real kind, no wiring needed; see dump()
  x: number;
  y: number;
  scale: number;
  rotation: 0 | 1 | 2 | 3;
}
export interface GhostState {
  slug: string;
  x: number;
  y: number;
  scale: number;
  rotation: 0 | 1 | 2 | 3;
  // computed live each move — drives the ghost's tint and gates commit
  legality: 'ok' | 'warn' | 'blocked';
  warnReason?: string;
}

interface EditorSnapshot {
  drafts: DraftAsset[];
  removedStructIds: Set<string>;
}

export interface WorldAssetTool {
  manifest: WorldAssetManifestGroup[];
  baked: BakedAssetEntry[]; // already-shipped sprites, browsable/draggable alongside transcribed ones
  sprites: Record<string, SpriteData>;
  drafts: DraftAsset[];
  ghost: GhostState | null;
  panelOpen: boolean;
  togglePanel(): void;
  startGhost(slug: string, atX?: number, atY?: number): void; // atX/atY: drag-and-drop drop point
  cancelGhost(): void;
  adjustGhostScale(delta: number): void; // slider + Alt+scroll both call this
  rotateGhost(): void;
  commitGhost(): void; // pushes ghost -> drafts, stays armed to stamp more instances
  removeDraft(id: string): void;
  flushDrafts(): void; // explicit re-persist, called by App.tsx's Ctrl+S in DEV
  dump(): void; // console.info: paste-ready Ent[] + wiring checklist
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;

  // Hand-authored STRUCT_ENTS content (house, shop, cat, palms, garden-bed,
  // cliff, ...) — the permanent world, as opposed to `drafts` above (things
  // stamped in through THIS tool). Listed here so it's ALSO browsable/
  // removable from the same panel, not just newly-placed decoration.
  // 'hotspot'/'blocker' kinds are excluded: they're wiring details riding
  // along with something else (the house's clickable garments, its staircase
  // colliders), not independent assets a person would browse or delete on
  // their own — removing the house already takes them with it once you
  // actually edit world.ts, per the checklist dump() prints.
  structEnts: Ent[];
  // Which STRUCT_ENTS ids are marked removed THIS SESSION. Toggling one only
  // hides it from rendering here in dev — see toggleStructRemoved for why
  // this can't safely also touch collision/wildspawn without much deeper
  // plumbing, and dump()'s printed instructions for how to make a removal
  // permanent (delete the entry from world.ts yourself).
  removedStructIds: Set<string>;
  toggleStructRemoved(id: string): void;
}

const manifest = (manifestData as { groups: WorldAssetManifestGroup[] }).groups;

// Every baked sprite file, eagerly bundled — cheap, this is a dev-only tool
// and the data files are tiny. Cross-referenced against the manifest's own
// `dataFile` entries so only Stage-A-produced assets are ever offered, not
// every baked asset already shipped in the game (palm.json etc. would also
// match this glob otherwise).
const allData = import.meta.glob<{ default: SpriteData }>('./data/*.json', { eager: true });
function spriteFor(dataFile: string): SpriteData | null {
  const mod = allData[`./data/${dataFile}`];
  return mod ? mod.default : null;
}

const STORAGE_KEY = 'ascii-village-dev-worldassets';

function loadDrafts(): DraftAsset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: { version: number; drafts: DraftAsset[] } = JSON.parse(raw);
    if (parsed.version !== 1) return [];
    // drop drafts referencing a slug neither the manifest nor the baked
    // registry knows about — same staleness guard devLayout.ts's own
    // loadLayout() applies
    const knownSlugs = new Set([
      ...manifest.flatMap((g) => g.variants.map((v) => v.slug)),
      ...BAKED_ASSETS.map((a) => a.slug),
    ]);
    // origin may be missing on drafts saved before this field existed —
    // backfill from the slug so old localStorage state doesn't get dropped.
    // Also drop anything whose id already appears in STRUCT_ENTS: since
    // commitGhost now writes straight through to disk (see postWorldOverrides
    // below), a draft that made it into a previous save is already a REAL
    // entity by the next load — keeping it in `drafts` too would render it
    // twice (once as a struct ent, once as a draft).
    const structIds = new Set(STRUCT_ENTS.map((e) => e.id));
    return (parsed.drafts ?? [])
      .filter((d) => knownSlugs.has(d.slug) && !structIds.has(d.id))
      .map((d) => ({ ...d, origin: d.origin ?? (findBakedAsset(d.slug) ? 'baked' : 'transcribed') }));
  } catch {
    return [];
  }
}

function saveDrafts(drafts: DraftAsset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts }));
  } catch {
    // storage full/blocked — the tool still works in-memory for this session
  }
}

// Same shape/convention as drafts' own storage, one key over: a plain id
// list, version-guarded, staleness-filtered against STRUCT_ENTS's actual ids
// on load (an id renamed or deleted in world.ts since just falls out, same
// as loadDrafts() dropping a draft whose slug no longer exists).
const STORAGE_KEY_REMOVED = 'ascii-village-dev-removed-structs';

function loadRemovedStructIds(): Set<string> {
  // PERSISTED_REMOVED_IDS (straight from worldOverrides.json on disk) is the
  // authoritative record — always start from it, unioned with whatever this
  // browser's localStorage has, in case something was removed by a session
  // the dev-save endpoint couldn't reach. Both are then staleness-filtered
  // against STRUCT_ENTS_BASE_IDS — the hand-authored id list BEFORE removal —
  // not the post-removal STRUCT_ENTS, which by definition never contains an
  // id that's actually removed (checking against it discarded every real
  // deletion and re-posted an empty removedIds back to disk on every reload,
  // which is why deleted entities kept reappearing).
  const known = new Set(STRUCT_ENTS_BASE_IDS);
  const ids = new Set(PERSISTED_REMOVED_IDS.filter((id) => known.has(id)));
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REMOVED);
    if (raw) {
      const parsed: { version: number; ids: string[] } = JSON.parse(raw);
      if (parsed.version === 1) {
        for (const id of parsed.ids ?? []) {
          if (known.has(id)) ids.add(id);
        }
      }
    }
  } catch {
    // localStorage copy unreadable — PERSISTED_REMOVED_IDS alone is still correct
  }
  return ids;
}

function saveRemovedStructIds(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY_REMOVED, JSON.stringify({ version: 1, ids: [...ids] }));
  } catch {
    // storage full/blocked — the tool still works in-memory for this session
  }
}

// Real, disk-level persistence — this is what makes placing/deleting stick
// for good, not just for this browser/session. Handled by a Vite dev-only
// middleware (vite.config.ts) that writes the body straight to
// src/data/worldOverrides.json; world.ts merges that file into STRUCT_ENTS
// at module load, so the very next dev-server start (this browser, another
// machine, doesn't matter) already reflects it — no manual dump()-and-paste
// step. Drafts are sent with their sprite/colors/palette DATA inlined
// (not an `S.xxx` source reference) specifically so world.ts never has to
// import anything from the dev-tool side (devBakedAssets.ts, the manifest)
// to consume them — that would pull the whole dev editor into the
// production bundle. Fire-and-forget: if the endpoint isn't there (e.g. a
// production preview server with no such middleware), this just silently
// no-ops and the in-session/localStorage copy remains the only record.
async function postWorldOverrides(drafts: DraftAsset[], removedStructIds: Set<string>, spriteOf: (slug: string) => SpriteData | null) {
  try {
    // A draft whose id has ALSO been marked removed (deleting something that
    // hasn't round-tripped through a reload yet still looks like a draft to
    // this session, so a click-to-delete can go through toggleStructRemoved
    // instead of removeDraft) must not be written to `added` at all — world.ts
    // only strips `removed` ids from the hand-authored base, not from
    // `added`, so a stale entry here would keep reappearing forever.
    const draftsAdded = drafts.filter((d) => !removedStructIds.has(d.id)).map((d) => {
      const sd = spriteOf(d.slug);
      return {
        id: d.id,
        kind: d.kind,
        x: d.x,
        y: d.y,
        scale: d.scale,
        rotation: d.rotation,
        interactable: false,
        // No `color` field: `Ent` (world.ts) has no such property — a flat,
        // no-palette baked asset instead falls back to its `.ent.<kind>`
        // CSS rule, same as dump()'s own paste-ready output already does.
        ...(sd
          ? {
              sprite: sd.sprite,
              ...(sd.colors ? { colors: sd.colors } : {}),
              ...(sd.palette ? { palette: sd.palette } : {}),
            }
          : {}),
      };
    });
    // MERGE, don't replace: `drafts` deliberately excludes anything already
    // merged into STRUCT_ENTS (loadDrafts's own staleness dedup, so an
    // already-real entity never renders twice as a draft too) — which means
    // `drafts` alone is never a complete picture of what `added` should
    // contain. Every already-persisted placement (PERSISTED_ADDED, read
    // straight from disk at module load) has to be carried forward on every
    // write, or the very next POST from ANY browser tab (even just mounting
    // this hook re-runs this effect once) would silently wipe every past
    // placement down to whatever this session's own drafts happen to be —
    // this is exactly what deleted a previously-placed pond/bridge entirely
    // during an unrelated cleanup pass. `draftsAdded` wins on id collision
    // (it's the fresher, in-session copy of anything still being edited).
    const draftIds = new Set(draftsAdded.map((d) => d.id));
    const carriedForward = PERSISTED_ADDED.filter(
      (e) => !removedStructIds.has(e.id) && !draftIds.has(e.id),
    );
    const added = [...carriedForward, ...draftsAdded];
    await fetch('/__dev/world-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removedIds: [...removedStructIds], added }),
    });
  } catch {
    // No dev endpoint available (or request failed) — silently fall back to
    // the localStorage/in-session copy already saved above.
  }
}

// Two-tier collision, deliberately looser than placement.ts's placementFits()
// (which hard-rejects any water/foam/garden tile) — the pond and the bridge
// sit legitimately ON water in STRUCT_ENTS today, so a dev tool for authoring
// exactly that kind of content can't hard-block it. Only a genuine off-map
// position or overlapping another entity/draft is a hard block; water/foam/
// garden are surfaced as a warning instead, both in the ghost tint and in
// dump()'s output.
function checkLegality(
  candidate: { x: number; y: number; sprite: string[]; scale?: number; rotation: 0 | 1 | 2 | 3 },
  ents: Ent[],
  drafts: DraftAsset[],
  plot: GardenPlot,
  excludeDraftId?: string,
): { legality: 'ok' | 'warn' | 'blocked'; warnReason?: string } {
  const { wT, hT } = spriteTiles(candidate.sprite, candidate.scale, candidate.rotation);
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + wT > MAP_W || candidate.y + hT > MAP_H) {
    return { legality: 'blocked', warnReason: 'runs off the map' };
  }
  const cbox = collisionBox(candidate);
  for (const e of ents) {
    if (tileBoxesOverlap(cbox, collisionBox(e))) return { legality: 'blocked', warnReason: `overlaps "${e.id}"` };
  }
  for (const d of drafts) {
    if (d.id === excludeDraftId) continue;
    const dbox = collisionBox({ x: d.x, y: d.y, sprite: candidate.sprite, scale: d.scale, rotation: d.rotation });
    if (tileBoxesOverlap(cbox, dbox)) return { legality: 'blocked', warnReason: `overlaps draft "${d.id}"` };
  }
  let wet = false;
  let foam = false;
  let garden = false;
  for (let ty = candidate.y; ty < candidate.y + hT; ty++) {
    for (let tx = candidate.x; tx < candidate.x + wT; tx++) {
      if (isWater(tx, ty)) wet = true;
      else if (isFoamZone(tx, ty)) foam = true;
      if (inGarden(tx, ty, plot)) garden = true;
    }
  }
  if (wet || foam || garden) {
    const reasons = [wet && 'water', foam && 'shoreline foam', garden && 'garden'].filter(Boolean).join(', ');
    return { legality: 'warn', warnReason: `overlaps ${reasons}` };
  }
  // explicit `warnReason: undefined` (not just omitted) — every caller spreads
  // this return value over the previous ghost state, and spreading a key that
  // isn't present at all does NOT clear a stale value already there.
  return { legality: 'ok', warnReason: undefined };
}

export function useWorldAssetTool(opts: {
  fieldRef: React.RefObject<HTMLElement | null>;
  camRef: React.MutableRefObject<CamSnapshot>;
  ents: Ent[]; // current world ents, for collision checking
  // The garden plot is passed in rather than read from its constant because the
  // bed itself is draggable — the "overlaps garden" warning has to follow it.
  plot?: GardenPlot;
}): WorldAssetTool {
  const { fieldRef, camRef, ents } = opts;
  const [drafts, setDrafts] = useState<DraftAsset[]>(() => loadDrafts());
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [removedStructIds, setRemovedStructIds] = useState<Set<string>>(() => loadRemovedStructIds());

  // Undo/redo: a stack of {drafts, removedStructIds} snapshots taken right
  // before each mutating action (commitGhost/removeDraft/toggleStructRemoved).
  // undo()/redo() just restore a snapshot via the SAME setDrafts/
  // setRemovedStructIds setters everything else uses, so the existing
  // localStorage + disk-save effects fire automatically — no separate
  // persistence path to keep in sync.
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const removedStructIdsRef = useRef(removedStructIds);
  removedStructIdsRef.current = removedStructIds;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const entsRef = useRef(ents);
  entsRef.current = ents;
  const plotRef = useRef(opts.plot ?? GARDEN_PLOT);
  plotRef.current = opts.plot ?? GARDEN_PLOT;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    saveDrafts(drafts);
  }, [drafts]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    saveRemovedStructIds(removedStructIds);
  }, [removedStructIds]);

  // Real disk persistence (see postWorldOverrides above) — fires on every
  // drafts/removedStructIds change, which covers commit/remove/toggle AND
  // undo/redo uniformly, since all of them go through the same setDrafts/
  // setRemovedStructIds setters. `spriteOf` is declared further down this
  // function but that's fine — this callback only runs later (after render),
  // by which point it's already assigned.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    postWorldOverrides(drafts, removedStructIds, spriteOf);
  }, [drafts, removedStructIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Defense-in-depth: the effect above already writes synchronously and
  // undebounced on every drafts change, so this is only insurance against a
  // React-effect commit-timing edge case around a reload — mirrors save.ts's
  // own visibilitychange/beforeunload flush pattern exactly.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const flush = () => {
      saveDrafts(draftsRef.current);
      saveRemovedStructIds(removedStructIdsRef.current);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', flush);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Explicit re-persist, called by App.tsx's Ctrl+S handler in DEV so one
  // keystroke covers both the real save AND the editor's scratch drafts.
  // Deliberately does not touch an in-progress `ghost` — an aimed-but-not-yet
  // committed placement was never "placed," so this shouldn't retroactively
  // commit it.
  function flushDrafts() {
    saveDrafts(draftsRef.current);
  }

  const spriteOf = (slug: string): SpriteData | null => {
    const baked = findBakedAsset(slug);
    if (baked) return { sprite: baked.sprite, colors: baked.colors, palette: baked.palette, color: baked.color };
    for (const g of manifest) {
      const v = g.variants.find((v) => v.slug === slug);
      if (v) return spriteFor(v.dataFile);
    }
    return null;
  };

  function startGhost(slug: string, atX?: number, atY?: number) {
    const sd = spriteOf(slug);
    if (!sd) {
      console.warn(`[worldAssets] no sprite data for "${slug}"`);
      return;
    }
    const baked = findBakedAsset(slug);
    const variant = manifest.flatMap((g) => g.variants).find((v) => v.slug === slug);
    // atX/atY: where a drag-and-drop landed. Omitted (click-to-arm): fall
    // back to the map centre.
    const x = atX ?? Math.floor(MAP_W / 2);
    const y = atY ?? Math.floor(MAP_H / 2);
    const scale = baked?.scale ?? variant?.suggestedScale ?? 1;
    const legality = checkLegality({ x, y, sprite: sd.sprite, scale, rotation: 0 }, entsRef.current, draftsRef.current, plotRef.current);
    setGhost({ slug, x, y, scale, rotation: 0, ...legality });
  }

  function cancelGhost() {
    setGhost(null);
  }

  function togglePanel() {
    setPanelOpen((o) => !o);
  }

  function adjustGhostScale(delta: number) {
    setGhost((g) => {
      if (!g) return g;
      const sd = spriteOf(g.slug);
      if (!sd) return g;
      const scale = Math.max(0.05, Math.min(4, +(g.scale + delta).toFixed(2)));
      const legality = checkLegality({ x: g.x, y: g.y, sprite: sd.sprite, scale, rotation: g.rotation }, entsRef.current, draftsRef.current, plotRef.current);
      return { ...g, scale, ...legality };
    });
  }

  function rotateGhost() {
    setGhost((g) => {
      if (!g) return g;
      const sd = spriteOf(g.slug);
      if (!sd) return g;
      const rotation = (((g.rotation + 1) % 4) as 0 | 1 | 2 | 3);
      const legality = checkLegality({ x: g.x, y: g.y, sprite: sd.sprite, scale: g.scale, rotation }, entsRef.current, draftsRef.current, plotRef.current);
      return { ...g, rotation, ...legality };
    });
  }

  // Snapshots the state BEFORE a mutation and pushes it onto the undo
  // stack, clearing redo (a fresh action invalidates whatever was undone
  // before it) — call at the top of every mutating action, before applying
  // the change itself.
  function pushHistory() {
    setUndoStack((s) => [...s, { drafts: draftsRef.current, removedStructIds: new Set(removedStructIdsRef.current) }]);
    setRedoStack([]);
  }

  function commitGhost() {
    const g = ghostRef.current;
    if (!g || g.legality === 'blocked') return;
    pushHistory();
    const baked = findBakedAsset(g.slug);
    const n = draftsRef.current.filter((d) => d.slug === g.slug).length + 1;
    const draft: DraftAsset = {
      id: `${g.slug}-${n}`,
      slug: g.slug,
      kind: baked?.kind ?? manifest.flatMap((gr) => gr.variants).find((v) => v.slug === g.slug)?.suggestedKind ?? g.slug,
      origin: baked ? 'baked' : 'transcribed',
      x: g.x,
      y: g.y,
      scale: g.scale,
      rotation: g.rotation,
    };
    setDrafts((ds) => [...ds, draft]);
    console.info(`[worldAssets] stamped "${draft.id}" at (${draft.x},${draft.y}) — pick the same asset again to stamp another`);
  }

  function removeDraft(id: string) {
    pushHistory();
    setDrafts((ds) => ds.filter((d) => d.id !== id));
  }

  function undo() {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setRedoStack((r) => [...r, { drafts: draftsRef.current, removedStructIds: new Set(removedStructIdsRef.current) }]);
      setDrafts(prev.drafts);
      setRemovedStructIds(prev.removedStructIds);
      return stack.slice(0, -1);
    });
  }

  function redo() {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((u) => [...u, { drafts: draftsRef.current, removedStructIds: new Set(removedStructIdsRef.current) }]);
      setDrafts(next.drafts);
      setRemovedStructIds(next.removedStructIds);
      return stack.slice(0, -1);
    });
  }

  // Toggles a STRUCT_ENTS id in/out of the removed set. Genuinely persisted
  // now (see postWorldOverrides — this write-through to
  // src/data/worldOverrides.json is what world.ts merges into STRUCT_ENTS
  // at module load), so the removal survives a reload and applies for
  // everyone on the repo, not just this browser. What it CANNOT do
  // mid-session, without reloading, is retroactively change collision/
  // wildSpawn reservation/etc. for the CURRENT page load — those already
  // captured the original STRUCT_ENTS at startup. Only the shared
  // ents.map() render block in App.tsx checks this set live, so a removed
  // entity disappears from view immediately even before that reload.
  function toggleStructRemoved(id: string) {
    pushHistory();
    setRemovedStructIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function dump() {
    if (removedStructIdsRef.current.size > 0) {
      const removed = [...removedStructIdsRef.current];
      console.info(
        `[worldAssets] ${removed.length} STRUCT_ENTS entr${removed.length === 1 ? 'y' : 'ies'} marked removed — ` +
          'already written through to src/data/worldOverrides.json (see postWorldOverrides), so this is real ' +
          `and will still be gone after a reload:\n` +
          removed.map((id) => `  - '${id}'`).join('\n'),
      );
    }
    if (draftsRef.current.length === 0) {
      console.info('[worldAssets] no drafts placed yet');
      return;
    }
    let anyTranscribed = false;
    const lines = draftsRef.current.map((d) => {
      // baked = already shipped in sprites.ts under this exact kind — dump
      // its REAL S.<NAME> refs directly, no placeholder/wiring needed at all.
      const baked = d.origin === 'baked' ? findBakedAsset(d.slug) : undefined;
      const refs = baked
        ? baked.varRef
        : {
            sprite: `S.${d.slug.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`,
            palette: `S.${d.slug.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_PALETTE`,
            colors: `S.${d.slug.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_COLORS`,
          };
      if (d.origin === 'transcribed') anyTranscribed = true;
      const colourLine = refs.palette && refs.colors ? `    sprite: ${refs.sprite}, palette: ${refs.palette}, colors: ${refs.colors},\n` : `    sprite: ${refs.sprite},\n`;
      return (
        `  {\n` +
        `    id: '${d.id}', kind: '${d.kind}',\n` +
        `    x: ${d.x}, y: ${d.y},\n` +
        colourLine +
        `    scale: ${d.scale}, rotation: ${d.rotation},\n` +
        `    interactable: false, // set true + wire describeInteraction/runInteraction (interact.ts) if it should be\n` +
        `  },` +
        (d.origin === 'baked' ? ' // already-shipped kind — no new wiring needed' : '')
      );
    });
    console.info(
      `[worldAssets] ${draftsRef.current.length} draft(s) — already saved live to src/data/worldOverrides.json ` +
        `(no manual paste needed to keep them). Shown below for reference/review:\n` +
        lines.join('\n') +
        (anyTranscribed
          ? '\n\n[worldAssets] remaining hand-wiring checklist per NEW (transcribed) kind used above:\n' +
            '  1. Add the kind string to EntityKind (world.ts).\n' +
            '  2. Import + re-export the sprite/palette/colors triple in sprites.ts (from src/data/<slug>.json).\n' +
            '  3. Add a `.ent.<kind> { color: ... }` rule in styles.css — falls back to generic grey otherwise.\n' +
            '  4. If interactable: add a case to describeInteraction/runInteraction (interact.ts), and to COLLECT_AS (App.tsx) if it is a plain collectible.\n' +
            '  5. If any glyph was flagged ambiguous-width: pair with perCell + a `.ent.<kind> span{width:1ch}` rule.'
          : '\n\n[worldAssets] every draft above is an already-shipped kind — nothing else to wire.'),
    );
  }

  // ---- E toggles the asset side-panel open/closed ----
  // Self-contained (not routed through App.tsx's shared handlerRef switch),
  // matching devLayout.ts's own independent-listener convention for this
  // dev-only tool. Skips while focus is inside a text input so a normal "e"
  // keystroke elsewhere isn't hijacked.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key.toLowerCase() !== 'e' || ev.repeat) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      setPanelOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- ghost mouse-tracking ----
  useEffect(() => {
    if (!import.meta.env.DEV || !ghost) return;
    const onMove = (ev: PointerEvent) => {
      const t = screenToTile(ev.clientX, ev.clientY, fieldRef.current, camRef.current);
      if (!t) return;
      setGhost((g) => {
        if (!g || (g.x === t.x && g.y === t.y)) return g;
        const sd = spriteOf(g.slug);
        if (!sd) return g;
        const legality = checkLegality({ x: t.x, y: t.y, sprite: sd.sprite, scale: g.scale, rotation: g.rotation }, entsRef.current, draftsRef.current, plotRef.current);
        return { ...g, x: t.x, y: t.y, ...legality };
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [ghost !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- console API parity with devLayout.ts's `layout` ----
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { worldAssets: unknown }).worldAssets = { dump, start: startGhost, cancel: cancelGhost };
    return () => {
      delete (window as unknown as { worldAssets?: unknown }).worldAssets;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recomputed each render off the (static) STRUCT_ENTS module export — cheap
  // filter over a small hand-authored array, not worth memoizing.
  const structEnts = STRUCT_ENTS.filter((e) => e.kind !== 'hotspot' && e.kind !== 'blocker');

  const sprites: Record<string, SpriteData> = {};
  for (const g of manifest) {
    for (const v of g.variants) {
      const sd = spriteFor(v.dataFile);
      if (sd) sprites[v.slug] = sd;
    }
  }
  for (const a of BAKED_ASSETS) {
    sprites[a.slug] = { sprite: a.sprite, colors: a.colors, palette: a.palette, color: a.color };
  }

  return {
    manifest,
    baked: BAKED_ASSETS,
    sprites,
    drafts,
    ghost,
    panelOpen,
    togglePanel,
    startGhost,
    cancelGhost,
    adjustGhostScale,
    rotateGhost,
    commitGhost,
    removeDraft,
    flushDrafts,
    dump,
    structEnts,
    removedStructIds,
    toggleStructRemoved,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
