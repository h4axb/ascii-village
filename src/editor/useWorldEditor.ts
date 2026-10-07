// ---------------------------------------------------------------------------
// THE WORLD EDITOR (dev only) — press E in `pnpm dev`.
//
// One editor for everything about the world's layout:
//   - select any object on the map and move / scale / rotate / delete /
//     duplicate it,
//   - place new objects from the asset list (src/assets.ts),
//   - place scene markers (src/sceneMarkers.ts),
//   - paint colliders per asset.
//
// While it's open the game is frozen: a transparent layer over the map takes
// every click (see App.tsx), and the keyboard drives the editor instead of
// the player — WASD pans the camera.
//
// Nothing is written until you save (Ctrl+S or the Save button): then
// src/data/world.json, src/data/sceneMarkers.json and
// src/data/assets.meta.json are written in one request (vite.config.ts),
// which refuses if one of them changed on disk since this page loaded them.
// Commit + push those files and the deployed game shows the same world.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAP_W,
  MAP_H,
  TILE_CH,
  TILE_LN,
  WORLD_DOC,
  BASE_ENTS,
  STRUCT_ENTS,
  buildStructEnts,
  spriteTiles,
  footprint,
  entityBlocksTile,
  collisionBox,
  setLiveStructEnts,
  fitMask,
  applyMitchyLook,
} from '../world';
import type { Ent, EntityKind, WorldDoc, WorldPose, WorldAdded } from '../world';
import { RAW_ASSETS, FIXED_ASSETS, ASSET_META, assetOf } from '../assets';
import type { AssetDef, AssetMeta } from '../assets';
import { resetTerrainStructs } from '../terrain';
import { beginStroke, endStroke, strokeTo } from '../ground';
import markerData from '../data/sceneMarkers.json';
import { ALL_MARKER_IDS } from '../sceneMarkers';
import type { MarkerPositions } from '../sceneMarkers';
import type { CamSnapshot } from '../coords';
import { docHash } from './docHash';

export type EditorTab = 'objects' | 'assets' | 'markers' | 'colliders' | 'intro' | 'ground';

// The kinds a placed asset can be given in the inspector, with what each
// one does in the game. (Built-in kinds like 'palm' or 'pond' carry
// behaviour tied to their own art, so they aren't offered.)
export const PLACEABLE_KINDS: { kind: EntityKind; label: string }[] = [
  { kind: 'decor', label: 'decor — just drawn' },
  { kind: 'boulder', label: 'boulder — drawn solid (rocks)' },
  { kind: 'grasshalm', label: 'ground — drawn under everything' },
  { kind: 'cliff', label: 'landscape — drawn under everything, even ground' },
  { kind: 'bridge', label: 'bridge — drawn over water' },
  { kind: 'flowerplus', label: 'collectable flower' },
  { kind: 'stone', label: 'collectable stone' },
  { kind: 'cactus', label: 'collectable cactus' },
  { kind: 'fern', label: 'collectable fern' },
  { kind: 'iceflower', label: 'collectable ice flower' },
  { kind: 'date', label: 'collectable dates' },
];

// What the game needs to stay itself: Mitchy and the garden are wired by id
// all over App.tsx, so they can be moved but not removed, and the garden's
// plot size is fixed. The house's hotspots follow it, so it doesn't rotate.
interface Locks {
  remove?: boolean;
  scale?: boolean;
  rotate?: boolean;
  duplicate?: boolean;
}
const LOCKS: Record<string, Locks> = {
  cat: { remove: true, duplicate: true, rotate: true },
  'garden-bed': { remove: true, duplicate: true, scale: true, rotate: true },
  house: { rotate: true },
};
export function locksOf(id: string): Locks {
  return LOCKS[id] ?? {};
}

// Objects the editor lists and can select: not the house's invisible
// hotspots and stair blockers, which follow the house, and not Mitchy — the
// editor changes the world, never the characters (she stays where the game
// has her; see App.tsx's ents).
export function isEditable(e: Ent): boolean {
  return e.kind !== 'hotspot' && e.kind !== 'blocker' && e.kind !== 'cat';
}

export interface EditorStatus {
  kind: 'ok' | 'error' | 'info';
  text: string;
}

export interface EditorGhost {
  slug: string;
  x: number;
  y: number;
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  scale: number;
}

interface Snapshot {
  doc: WorldDoc;
  markers: MarkerPositions;
  meta: Record<string, AssetMeta>;
}

export interface WorldEditor {
  enabled: boolean; // false in a production build: everything below is inert
  open: boolean;
  setOpen(open: boolean): void;
  tab: EditorTab;
  setTab(tab: EditorTab): void;

  doc: WorldDoc;
  markers: MarkerPositions;
  meta: Record<string, AssetMeta>;
  assets: AssetDef[]; // the placeable list, with live meta applied
  structEnts: Ent[]; // the world as edited — what App.tsx draws and collides with
  structKey: number; // bumps (debounced) when the layout changed, for the terrain

  selected: string | null; // an object id, or `marker:<id>`
  select(id: string | null): void;
  armed: { type: 'asset' | 'marker'; id: string } | null;
  arm(type: 'asset' | 'marker', id: string): void;
  disarm(): void;
  ghost: EditorGhost | null;
  cursor: { x: number; y: number } | null;
  // the exact pointer position on the map (ch / em), for the ground brush
  pointerAt: { wx: number; wy: number } | null;
  showIds: boolean;
  setShowIds(v: boolean): void;
  showColliders: boolean;
  setShowColliders(v: boolean): void;

  setPose(id: string, patch: Partial<WorldPose>): void;
  setAdded(id: string, patch: Partial<Pick<WorldAdded, 'kind' | 'interactable'>>): void;
  resetPose(id: string): void;
  remove(id: string): void;
  restore(id: string): void; // bring a removed built-in back
  duplicate(id: string): void;
  setMarker(id: string, pos: { x: number; y: number } | null): void;
  setMeta(slug: string, patch: AssetMeta): void;
  resetCollider(slug: string): void;
  clearBlockedTiles(): void; // remove every painted map tile
  // Mitchy's look: an asset of kind 'cat' ('mitchy' = his original art)
  mitchyLook: string;
  setMitchyLook(slug: string): void;

  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;

  dirty: boolean;
  saving: boolean;
  status: EditorStatus | null;
  recovered: number; // old-editor changes brought in as unsaved edits
  save(): void;
  discard(): void;

  // wiring for App.tsx
  onKey(ev: KeyboardEvent): void; // every keydown while open
  onWheelScale(deltaY: number): boolean; // Alt+wheel; true = consumed
  pointer: {
    onPointerDown(ev: React.PointerEvent): void;
    onPointerMove(ev: React.PointerEvent): void;
    onPointerUp(ev: React.PointerEvent): void;
    onPointerLeave(): void;
  };
}

// ---- the documents as loaded, and their fingerprints for the save check ----
const LOADED_MARKERS = markerData as MarkerPositions;
const LOADED: Snapshot = {
  doc: WORLD_DOC,
  markers: LOADED_MARKERS,
  meta: ASSET_META,
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const round2 = (v: number) => Math.round(v * 100) / 100;
const SCALE_MIN = 0.05;
const SCALE_MAX = 4;

// The assets with the editor's (possibly unsaved) meta applied.
function resolveAssets(meta: Record<string, AssetMeta>): Map<string, AssetDef> {
  const m = new Map<string, AssetDef>();
  for (const a of [...RAW_ASSETS, ...FIXED_ASSETS]) {
    const live = meta[a.slug];
    m.set(a.slug, live ? { ...a, ...live } : a);
  }
  return m;
}

// buildStructEnts resolves assets through the saved meta; re-apply the live
// meta on top so a kind/label change in the inspector shows at once.
function buildLive(doc: WorldDoc, assets: Map<string, AssetDef>): Ent[] {
  const ents = buildStructEnts(doc);
  const addedById = new Map(doc.added.map((a) => [a.id, a]));
  return ents.map((e) => {
    const a = addedById.get(e.id);
    if (!a) return e;
    const def = assets.get(a.asset);
    if (!def) return e;
    return {
      ...e,
      kind: a.kind ?? def.kind,
      interactable: a.interactable ?? def.interactable,
      scale: a.scale ?? def.scale,
    };
  });
}

// The next free `<slug>-N` id: one above the highest N used by anything —
// on the map, removed, or placed — so a new object never takes an id that
// something else has (or had).
function nextId(slug: string, doc: WorldDoc): string {
  const re = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let max = 0;
  for (const id of [...BASE_ENTS.map((e) => e.id), ...doc.added.map((a) => a.id), ...doc.removed]) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${slug}-${max + 1}`;
}

// Same stacking the map uses (App.tsx's entity zIndex), so a click selects
// what's drawn on top.
function stackOf(e: Ent): number {
  const row = Math.round(footprint(e).row);
  if (e.kind === 'bridge') return row + 1000;
  if (e.kind === 'cliff') return 1;
  if (e.kind === 'gardenbed') return e.y;
  if (e.kind === 'grasshalm') return Math.max(2, row - 500);
  if (e.kind === 'cat') return row + 200;
  return row;
}

// Is world point (wx ch, wy em) on a drawn glyph of `e`? Within one cell, so
// thin sprites (a grass blade) are still easy to grab.
function hitsGlyph(e: Ent, wx: number, wy: number): boolean {
  const k = e.scale ?? 1;
  const r = e.rotation ?? 0;
  const { wT, hT } = spriteTiles(e.sprite, k, r);
  const left = e.x * TILE_CH;
  const top = e.y * TILE_LN;
  if (wx < left || wy < top || wx >= left + wT * TILE_CH || wy >= top + hT * TILE_LN) return false;
  if (r % 2 === 1 || r === 2) return true; // rotated: the box is close enough
  const col = Math.floor((wx - left) / k);
  const row = Math.floor((wy - top) / k);
  for (let y = row - 1; y <= row + 1; y++) {
    const line = e.sprite[y];
    if (!line) continue;
    for (let x = col - 1; x <= col + 1; x++) {
      const ch = line[x];
      if (ch !== undefined && ch !== ' ') return true;
    }
  }
  return false;
}

// Old editor state left in this browser's localStorage by the previous tools
// (devLayout.ts's alt+drag moves, devWorldAssets.ts's placements). Brought in
// ONCE as unsaved edits so nothing done with them is lost; the keys are
// cleared after the next save or discard.
const OLD_KEYS = ['ascii-village-dev-layout', 'ascii-village-dev-worldassets', 'ascii-village-dev-removed-structs'];
function recoverOldEdits(doc: WorldDoc): { doc: WorldDoc; count: number } {
  let count = 0;
  const next = clone(doc);
  const known = new Map(buildStructEnts(doc).map((e) => [e.id, e]));
  try {
    const layout = JSON.parse(localStorage.getItem(OLD_KEYS[0]) ?? 'null') as {
      version?: number;
      place?: Record<string, { x: number; y: number }>;
    } | null;
    if (layout?.version === 1) {
      for (const [id, p] of Object.entries(layout.place ?? {})) {
        const e = known.get(id);
        if (!e || (e.x === p.x && e.y === p.y) || id.startsWith('house-')) continue;
        const added = next.added.find((a) => a.id === id);
        if (added) Object.assign(added, { x: p.x, y: p.y });
        else next.moved[id] = { ...next.moved[id], x: p.x, y: p.y };
        count++;
      }
    }
    const drafts = JSON.parse(localStorage.getItem(OLD_KEYS[1]) ?? 'null') as {
      version?: number;
      drafts?: { id: string; slug: string; x: number; y: number; scale: number; rotation: 0 | 1 | 2 | 3 }[];
    } | null;
    if (drafts?.version === 1) {
      for (const d of drafts.drafts ?? []) {
        const slug = d.slug.replace(/^built-/, '');
        if (!assetOf(slug)) continue;
        // already on the map at that spot (it made it into the old file)
        if (next.added.some((a) => a.asset === slug && a.x === d.x && a.y === d.y)) continue;
        next.added.push({ id: nextId(slug, next), asset: slug, x: d.x, y: d.y, scale: d.scale, rotation: d.rotation || undefined });
        count++;
      }
    }
  } catch {
    // unreadable old state: nothing to recover
  }
  return { doc: next, count };
}

function screenToWorld(
  clientX: number,
  clientY: number,
  el: HTMLElement | null,
  cam: CamSnapshot,
): { wx: number; wy: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const fx = (clientX - r.left) / cam.dims.scale / cam.dims.charW;
  const fy = (clientY - r.top) / cam.dims.scale / cam.dims.lineH;
  return { wx: cam.camX + fx / cam.zoom, wy: cam.camY + fy / cam.zoom };
}

type Drag =
  | { type: 'object'; id: string; startX: number; startY: number; wx0: number; wy0: number; moved: boolean }
  | { type: 'marker'; id: string; moved: boolean }
  | { type: 'pan'; px0: number; py0: number; pan0: { x: number; y: number } }
  | { type: 'paint'; solid: boolean; done: Set<string> }
  | { type: 'ground' };

export function useWorldEditor(opts: {
  fieldRef: React.RefObject<HTMLElement | null>;
  camRef: React.MutableRefObject<CamSnapshot>;
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  // true while something else owns the screen (a cinematic, a modal): E
  // doesn't open the editor then
  blocked: () => boolean;
}): WorldEditor {
  const { fieldRef, camRef, setPan } = opts;
  const blockedRef = useRef(opts.blocked);
  blockedRef.current = opts.blocked;

  const [open, setOpenState] = useState(false);
  const [tab, setTab] = useState<EditorTab>('objects');
  const [state, setState] = useState<Snapshot>(() => ({ ...clone(LOADED) }));
  const [saved, setSaved] = useState<Snapshot>(LOADED); // what's on disk, as far as we know
  const [recovered, setRecovered] = useState(0);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [armed, setArmed] = useState<WorldEditor['armed']>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const [showIds, setShowIds] = useState(false);
  const [showColliders, setShowColliders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [structKey, setStructKey] = useState(0);
  const dragRef = useRef<Drag | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  // bring in the old tools' unsaved work, once
  useEffect(() => {
    const { doc, count } = recoverOldEdits(stateRef.current.doc);
    if (count > 0) {
      setState((s) => ({ ...s, doc }));
      setRecovered(count);
    }
  }, []);

  const assetMap = useMemo(() => resolveAssets(state.meta), [state.meta]);
  const structEnts = useMemo(
    () => (state.doc === LOADED.doc && state.meta === LOADED.meta ? STRUCT_ENTS : buildLive(state.doc, assetMap)),
    [state.doc, state.meta, assetMap],
  );
  const structRef = useRef(structEnts);
  structRef.current = structEnts;

  // The terrain keeps its ground glyphs off every structure; repaint it once
  // the layout settles (not on every frame of a drag).
  useEffect(() => {
    if (structEnts === STRUCT_ENTS && structKey === 0) return;
    const t = window.setTimeout(() => {
      if (dragRef.current) return; // the drop re-runs this
      setLiveStructEnts(structEnts);
      resetTerrainStructs();
      setStructKey((k) => k + 1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [structEnts]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(
    () =>
      JSON.stringify(state.doc) !== JSON.stringify(saved.doc) ||
      JSON.stringify(state.markers) !== JSON.stringify(saved.markers) ||
      JSON.stringify(state.meta) !== JSON.stringify(saved.meta),
    [state, saved],
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // closing the tab with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // status toasts fade on their own (errors stay until the next action)
  useEffect(() => {
    if (!status || status.kind === 'error') return;
    const t = window.setTimeout(() => setStatus(null), 3500);
    return () => window.clearTimeout(t);
  }, [status]);

  // Mitchy's look follows the edited doc at once (and back on undo / discard),
  // in the world and in every portrait of him
  const lookSlug = state.doc.mitchyLook;
  useEffect(() => applyMitchyLook(lookSlug), [lookSlug]);

  // ---- editing: every change goes through commit() ----
  const commit = useCallback((fn: (s: Snapshot) => Snapshot, record = true) => {
    const prev = stateRef.current;
    const next = fn(prev);
    if (next === prev) return;
    if (record) {
      setUndoStack((u) => [...u.slice(-199), prev]);
      setRedoStack([]);
    }
    stateRef.current = next;
    setState(next);
  }, []);

  const updateDoc = (fn: (d: WorldDoc) => void, record = true) =>
    commit((s) => {
      const doc = clone(s.doc);
      fn(doc);
      return { ...s, doc };
    }, record);

  const entOf = (id: string) => structRef.current.find((e) => e.id === id);

  function setPoseRaw(doc: WorldDoc, id: string, patch: Partial<WorldPose>) {
    const added = doc.added.find((a) => a.id === id);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<WorldPose>;
    if (clean.rotation === 0) clean.rotation = undefined;
    if (added) {
      Object.assign(added, clean);
      if (added.rotation === undefined) delete added.rotation;
      return;
    }
    const base = BASE_ENTS.find((e) => e.id === id);
    if (!base) return;
    const cur = doc.moved[id] ?? { x: base.x, y: base.y };
    const pose: WorldPose = { ...cur, ...clean };
    if (pose.rotation === undefined) delete pose.rotation;
    if (pose.scale === undefined || pose.scale === base.scale) delete pose.scale;
    // back where it started: no entry at all
    if (pose.x === base.x && pose.y === base.y && pose.scale === undefined && !pose.rotation) delete doc.moved[id];
    else doc.moved[id] = pose;
  }

  function setPose(id: string, patch: Partial<WorldPose>, record = true) {
    const lock = locksOf(id);
    if (lock.scale) delete patch.scale;
    if (lock.rotate) delete patch.rotation;
    if (patch.scale !== undefined) patch.scale = round2(Math.min(SCALE_MAX, Math.max(SCALE_MIN, patch.scale)));
    if (patch.x !== undefined) patch.x = round2(Math.min(MAP_W - 1, Math.max(0, patch.x)));
    if (patch.y !== undefined) patch.y = round2(Math.min(MAP_H - 1, Math.max(0, patch.y)));
    updateDoc((d) => setPoseRaw(d, id, patch), record);
  }

  function setAdded(id: string, patch: Partial<Pick<WorldAdded, 'kind' | 'interactable'>>) {
    updateDoc((d) => {
      const a = d.added.find((x) => x.id === id);
      if (!a) return;
      Object.assign(a, patch);
      const def = assetMap.get(a.asset);
      if (a.kind === undefined || a.kind === def?.kind) delete a.kind;
      if (a.interactable === undefined || a.interactable === def?.interactable) delete a.interactable;
    });
  }

  function resetPose(id: string) {
    updateDoc((d) => {
      const a = d.added.find((x) => x.id === id);
      if (a) {
        delete a.scale;
        delete a.rotation;
      } else delete d.moved[id];
    });
  }

  function remove(id: string) {
    if (id.startsWith('marker:')) {
      setMarker(id.slice(7), null);
      return;
    }
    if (locksOf(id).remove) {
      setStatus({ kind: 'info', text: `${id} can be moved, but the game needs it — it can't be removed.` });
      return;
    }
    updateDoc((d) => {
      if (d.added.some((a) => a.id === id)) {
        d.added = d.added.filter((a) => a.id !== id);
      } else {
        const ids = id === 'house' ? BASE_ENTS.filter((e) => e.id === 'house' || e.id.startsWith('house-')).map((e) => e.id) : [id];
        for (const x of ids) {
          if (!d.removed.includes(x)) d.removed.push(x);
          delete d.moved[x];
        }
      }
    });
    if (selected === id) setSelected(null);
  }

  function restore(id: string) {
    updateDoc((d) => {
      const back = id === 'house' ? (x: string) => x === 'house' || x.startsWith('house-') : (x: string) => x === id;
      d.removed = d.removed.filter((x) => !back(x));
    });
    setSelected(id);
  }

  function duplicate(id: string) {
    const e = entOf(id);
    if (!e || locksOf(id).duplicate || !e.asset || !assetMap.get(e.asset)) {
      setStatus({ kind: 'info', text: `${id} can't be duplicated.` });
      return;
    }
    const slug = e.asset;
    let newId = '';
    updateDoc((d) => {
      newId = nextId(slug, d);
      const src = d.added.find((a) => a.id === id);
      d.added.push({
        ...(src ? clone(src) : {}),
        id: newId,
        asset: slug,
        x: Math.min(MAP_W - 1, e.x + 2),
        y: Math.min(MAP_H - 1, e.y + 1),
        scale: e.scale,
        ...(e.rotation ? { rotation: e.rotation } : {}),
      });
    });
    setSelected(newId);
  }

  function place(slug: string, x: number, y: number) {
    const def = assetMap.get(slug);
    if (!def) return;
    let newId = '';
    updateDoc((d) => {
      newId = nextId(slug, d);
      d.added.push({ id: newId, asset: slug, x, y, scale: def.scale });
    });
    setSelected(newId);
  }

  function setMarker(id: string, pos: { x: number; y: number } | null, record = true) {
    if (!ALL_MARKER_IDS.has(id)) return;
    commit((s) => {
      const markers = { ...s.markers };
      if (pos) markers[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
      else delete markers[id];
      return { ...s, markers };
    }, record);
  }

  function setMeta(slug: string, patch: AssetMeta) {
    commit((s) => {
      const cur = { ...s.meta[slug], ...patch };
      for (const k of Object.keys(cur) as (keyof AssetMeta)[]) if (cur[k] === undefined || cur[k] === '') delete cur[k];
      const meta = { ...s.meta };
      if (Object.keys(cur).length) meta[slug] = cur;
      else delete meta[slug];
      return { ...s, meta };
    });
  }

  // ---- colliders ----
  // Can this object's collider be painted? Mitchy collides by his feet, not
  // his drawn shape, and a rotated object blocks its whole box.
  const paintable = (e: Ent) => !!e.asset && e.kind !== 'cat' && (e.rotation ?? 0) === 0 && assetMap.has(e.asset);

  // Set one tile of an object's collider (stored per asset, so every copy
  // changes) — inside a doc update.
  function paintObjectTile(d: WorldDoc, e: Ent, tx: number, ty: number, solid: boolean) {
    const k = e.scale ?? 1;
    // tile-local -> the sprite cells that tile covers at this object's scale
    const lx = tx - e.x;
    const ly = ty - e.y;
    const c0 = Math.max(0, Math.floor((lx * TILE_CH) / k));
    const c1 = Math.ceil(((lx + 1) * TILE_CH) / k);
    const r0 = Math.max(0, Math.floor((ly * TILE_LN) / k));
    const r1 = Math.ceil(((ly + 1) * TILE_LN) / k);
    const slug = e.asset!;
    // always in the sprite's exact shape, or world.ts's colliderFor would
    // discard it (some baked masks are narrower than their art)
    const start = d.colliders[slug] ?? (e.solidMask ?? e.sprite).map((row) => row.replace(/[^ ]/g, '#'));
    const rows = fitMask(start, e.sprite).map((row) => row.split(''));
    for (let y = r0; y < r1 && y < rows.length; y++) {
      for (let x = c0; x < c1 && x < rows[y].length; x++) rows[y][x] = solid ? '#' : ' ';
    }
    d.colliders[slug] = rows.map((r) => r.join(''));
  }

  // What blocks tile (tx,ty) right now: a painted map tile, and/or objects.
  function blockersAt(tx: number, ty: number) {
    const wall = (stateRef.current.doc.blockedTiles ?? []).includes(`${tx},${ty}`);
    const objects = structRef.current.filter((e) => e.kind !== 'hotspot' && entityBlocksTile(e, tx, ty));
    return { wall, objects };
  }

  // The Colliders tab's click: a tile that blocks stops blocking, an empty
  // one starts. Turning a tile ON paints the SELECTED object's collider when
  // the tile is inside it (so the shape travels with the object), otherwise
  // it becomes a map tile of its own. Turning one OFF clears whatever
  // blocks it: the map tile, and the collider of every object there.
  function toggleTile(tx: number, ty: number, solid: boolean, record: boolean) {
    const { wall, objects } = blockersAt(tx, ty);
    if (solid === (wall || objects.length > 0)) return; // already that way
    const key = `${tx},${ty}`;
    const sel = selected && !selected.startsWith('marker:') ? entOf(selected) : undefined;
    const notes: string[] = [];
    updateDoc((d) => {
      const tiles = new Set(d.blockedTiles ?? []);
      if (solid) {
        const box = sel ? collisionBox(sel) : null;
        // an object that normally blocks here (its default collider) gets
        // the tile back, so off-then-on returns to where it started
        const owner = structRef.current.find(
          (e) => paintable(e) && entityBlocksTile({ ...e, solidMask: assetMap.get(e.asset!)?.solid }, tx, ty),
        );
        if (sel && box && paintable(sel) && tx >= box.x0 && tx <= box.x1 && ty >= box.y0 && ty <= box.y1) {
          paintObjectTile(d, sel, tx, ty, true);
        } else if (owner) {
          paintObjectTile(d, owner, tx, ty, true);
        } else tiles.add(key);
      } else {
        tiles.delete(key);
        for (const e of objects) {
          if (paintable(e)) {
            paintObjectTile(d, e, tx, ty, false);
            notes.push(e.asset!);
          } else notes.push(`!${e.id}`);
        }
      }
      if (tiles.size) d.blockedTiles = [...tiles].sort();
      else delete d.blockedTiles;
    }, record);
    const stuck = notes.filter((n) => n.startsWith('!')).map((n) => n.slice(1));
    const assets = [...new Set(notes.filter((n) => !n.startsWith('!')))];
    if (stuck.length) {
      setStatus({ kind: 'info', text: `${stuck.join(', ')} still blocks here (${stuck.includes('cat') ? 'Mitchy blocks by his feet' : 'rotated objects and the house stairs block as a whole'}).` });
    } else if (assets.length && record) {
      setStatus({ kind: 'info', text: `Changed the collider of every ${assets.join(', ')} — reset it in this tab if that's not what you wanted.` });
    }
  }

  function clearBlockedTiles() {
    updateDoc((d) => {
      delete d.blockedTiles;
    });
  }

  function resetCollider(slug: string) {
    updateDoc((d) => {
      delete d.colliders[slug];
    });
  }

  // ---- undo / redo ----
  function undo() {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, stateRef.current]);
    stateRef.current = prev;
    setState(prev);
  }
  function redo() {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, stateRef.current]);
    stateRef.current = next;
    setState(next);
  }

  // ---- save / discard ----
  async function save() {
    if (saving) return;
    if (!dirtyRef.current) {
      setStatus({ kind: 'info', text: 'Nothing to save.' });
      return;
    }
    setSaving(true);
    const s = stateRef.current;
    try {
      const res = await fetch('/__dev/save-world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docs: { world: s.doc, markers: s.markers, meta: s.meta },
          base: { world: docHash(saved.doc), markers: docHash(saved.markers), meta: docHash(saved.meta) },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; files?: string[]; saved?: string[] };
      if (res.status === 409) {
        setStatus({
          kind: 'error',
          text: `Not saved: ${(body.files ?? []).join(', ')} changed on disk since this page loaded. Reload to get the new version (your unsaved edits here will be lost), or discard.`,
        });
      } else if (!res.ok) {
        setStatus({
          kind: 'error',
          text:
            res.status === 404
              ? 'Not saved: saving only works under `pnpm dev`.'
              : `Not saved: ${body.error ?? res.statusText}`,
        });
      } else {
        setSaved(s);
        setRecovered(0);
        for (const k of OLD_KEYS) localStorage.removeItem(k);
        setStatus({ kind: 'ok', text: `Saved ${(body.saved ?? []).join(', ')} — commit & push to update the game.` });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: `Not saved: ${String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!dirtyRef.current && !recovered) return;
    if (!window.confirm('Throw away every change since the last save?')) return;
    commit(() => clone(saved));
    setRecovered(0);
    for (const k of OLD_KEYS) localStorage.removeItem(k);
    setSelected(null);
    setStatus({ kind: 'info', text: 'Changes discarded.' });
  }

  // ---- open / close ----
  function setOpen(v: boolean) {
    setOpenState(v);
    if (!v) {
      dragRef.current = null;
      setArmed(null);
      setCursor(null);
    }
  }

  // E toggles the editor (not while typing, or while a cinematic/modal owns
  // the screen)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key.toLowerCase() !== 'e' || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)) return;
      if (!openRef.current && blockedRef.current()) return;
      ev.preventDefault();
      setOpen(!openRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openRef = useRef(open);
  openRef.current = open;

  // ---- keyboard, while open (App.tsx forwards every keydown here) ----
  function onKey(ev: KeyboardEvent) {
    const k = ev.key.toLowerCase();
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && k === 's') {
      ev.preventDefault();
      if (!ev.repeat) void save();
      return;
    }
    if (typing) return;
    if (mod && k === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      ev.preventDefault();
      redo();
      return;
    }
    if (mod && k === 'd') {
      ev.preventDefault();
      if (selected && !selected.startsWith('marker:')) duplicate(selected);
      return;
    }
    if (k === 'escape') {
      if (armed) setArmed(null);
      else if (selected) setSelected(null);
      else setOpen(false);
      return;
    }
    if (k === 'delete' || k === 'backspace') {
      ev.preventDefault();
      if (selected) remove(selected);
      return;
    }
    if (k === 'r' && selected && !selected.startsWith('marker:')) {
      const e = entOf(selected);
      if (e) setPose(selected, { rotation: ((((e.rotation ?? 0) + (ev.shiftKey ? 3 : 1)) % 4) as 0 | 1 | 2 | 3) });
      return;
    }
    if ((k === '+' || k === '=' || k === '-') && selected && !selected.startsWith('marker:')) {
      const e = entOf(selected);
      if (e) setPose(selected, { scale: (e.scale ?? 1) * (k === '-' ? 1 / 1.1 : 1.1) });
      return;
    }
    // arrows nudge the selection (Shift: 5 tiles); with nothing selected
    // they pan like WASD
    const arrows: Record<string, [number, number]> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    };
    const wasd: Record<string, [number, number]> = { a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
    if (arrows[k] && selected) {
      ev.preventDefault();
      const [dx, dy] = arrows[k];
      const step = ev.shiftKey ? 5 : 1;
      if (selected.startsWith('marker:')) {
        const id = selected.slice(7);
        const p = stateRef.current.markers[id];
        if (p) setMarker(id, { x: p.x + dx * step, y: p.y + dy * step });
      } else {
        const e = entOf(selected);
        if (e) setPose(selected, { x: e.x + dx * step, y: e.y + dy * step });
      }
      return;
    }
    const pan = wasd[k] ?? arrows[k];
    if (pan) {
      ev.preventDefault();
      const cam = camRef.current;
      const step = (ev.shiftKey ? 40 : 12) / cam.zoom;
      setPan((p) => ({ x: p.x + pan[0] * step * 2, y: p.y + pan[1] * step }));
    }
  }

  function onWheelScale(deltaY: number): boolean {
    if (!selected || selected.startsWith('marker:')) return false;
    const e = entOf(selected);
    if (!e) return false;
    setPose(selected, { scale: (e.scale ?? 1) * Math.exp(-deltaY * 0.0015) });
    return true;
  }

  // ---- mouse on the map (App.tsx's editor layer) ----
  const toWorld = (ev: { clientX: number; clientY: number }) =>
    screenToWorld(ev.clientX, ev.clientY, fieldRef.current, camRef.current);

  function hitMarker(wx: number, wy: number): string | null {
    let hit: string | null = null;
    for (const [id, p] of Object.entries(stateRef.current.markers)) {
      const cx = (p.x + 0.5) * TILE_CH;
      const cy = (p.y + 0.5) * TILE_LN;
      if (Math.abs(wx - cx) <= TILE_CH && Math.abs(wy - cy) <= TILE_LN * 1.5) hit = id;
    }
    return hit;
  }

  function hitObject(wx: number, wy: number): Ent | null {
    let best: Ent | null = null;
    let bestZ = -Infinity;
    for (const e of structRef.current) {
      if (!isEditable(e) || !hitsGlyph(e, wx, wy)) continue;
      const z = stackOf(e);
      if (z >= bestZ) {
        best = e;
        bestZ = z;
      }
    }
    return best;
  }

  function ghostFor(slug: string, wx: number, wy: number): EditorGhost | null {
    const def = assetMap.get(slug);
    if (!def) return null;
    const { wT, hT } = spriteTiles(def.sprite, def.scale);
    // the asset's base sits on the cursor, centred
    return {
      slug,
      x: Math.max(0, Math.round(wx / TILE_CH - wT / 2)),
      y: Math.max(0, Math.round(wy / TILE_LN - hT + 0.5)),
      sprite: def.sprite,
      colors: def.colors,
      palette: def.palette,
      scale: def.scale,
    };
  }

  const pointer: WorldEditor['pointer'] = {
    onPointerDown(ev) {
      if (ev.button !== 0) return;
      const w = toWorld(ev);
      if (!w) return;
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      const tx = Math.floor(w.wx / TILE_CH);
      const ty = Math.floor(w.wy / TILE_LN);

      if (armed?.type === 'asset') {
        const g = ghostFor(armed.id, w.wx, w.wy);
        if (g) place(g.slug, g.x, g.y);
        if (!ev.shiftKey) setArmed(null); // Shift keeps stamping
        return;
      }
      if (armed?.type === 'marker') {
        setMarker(armed.id, { x: tx, y: ty });
        setSelected(`marker:${armed.id}`);
        setArmed(null);
        return;
      }
      // Ground tab: drag paints with the brush (ground.ts)
      if (tab === 'ground') {
        beginStroke(w.wx, w.wy);
        dragRef.current = { type: 'ground' };
        return;
      }
      // Colliders tab: every click toggles the tile under it
      if (tab === 'colliders') {
        const { wall, objects } = blockersAt(tx, ty);
        const solid = !(wall || objects.length > 0);
        dragRef.current = { type: 'paint', solid, done: new Set([`${tx},${ty}`]) };
        toggleTile(tx, ty, solid, true);
        return;
      }
      const m = tab === 'markers' || tab === 'objects' ? hitMarker(w.wx, w.wy) : null;
      if (m) {
        setSelected(`marker:${m}`);
        dragRef.current = { type: 'marker', id: m, moved: false };
        return;
      }
      const e = hitObject(w.wx, w.wy);
      if (e) {
        setSelected(e.id);
        dragRef.current = { type: 'object', id: e.id, startX: e.x, startY: e.y, wx0: w.wx, wy0: w.wy, moved: false };
        return;
      }
      setSelected(null);
      dragRef.current = { type: 'pan', px0: ev.clientX, py0: ev.clientY, pan0: { x: camRef.current.panX, y: camRef.current.panY } };
    },
    onPointerMove(ev) {
      const w = toWorld(ev);
      if (!w) return;
      const tx = Math.floor(w.wx / TILE_CH);
      const ty = Math.floor(w.wy / TILE_LN);
      setCursor((c) =>
        c && c.x === tx && c.y === ty && armed?.type !== 'asset' && tab !== 'ground' ? c : { x: tx, y: ty, wx: w.wx, wy: w.wy },
      );
      const d = dragRef.current;
      if (!d) return;
      if (d.type === 'pan') {
        const cam = camRef.current;
        const k = cam.dims.scale * cam.zoom;
        setPan({
          x: d.pan0.x - (ev.clientX - d.px0) / k / cam.dims.charW,
          y: d.pan0.y - (ev.clientY - d.py0) / k / cam.dims.lineH,
        });
      } else if (d.type === 'object') {
        // whole-tile steps from where it started (keeps a fractional anchor
        // like the house's 27.85); Shift = quarter tiles
        const q = ev.shiftKey ? 4 : 1;
        const dx = Math.round(((w.wx - d.wx0) / TILE_CH) * q) / q;
        const dy = Math.round(((w.wy - d.wy0) / TILE_LN) * q) / q;
        if (!d.moved && dx === 0 && dy === 0) return;
        setPose(d.id, { x: d.startX + dx, y: d.startY + dy }, !d.moved);
        d.moved = true;
      } else if (d.type === 'marker') {
        const p = stateRef.current.markers[d.id];
        if (p && p.x === tx && p.y === ty) return;
        setMarker(d.id, { x: tx, y: ty }, !d.moved);
        d.moved = true;
      } else if (d.type === 'ground') {
        strokeTo(w.wx, w.wy);
      } else if (d.type === 'paint') {
        // a drag keeps doing what its first tile did (adding or clearing)
        const key = `${tx},${ty}`;
        if (d.done.has(key)) return;
        d.done.add(key);
        toggleTile(tx, ty, d.solid, false);
      }
    },
    onPointerUp() {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.type === 'ground') {
        endStroke();
        return;
      }
      if (d && d.type !== 'pan') {
        // the layout settled: let the terrain catch up
        setLiveStructEnts(structRef.current);
        resetTerrainStructs();
        setStructKey((k) => k + 1);
      }
    },
    onPointerLeave() {
      if (!dragRef.current) setCursor(null);
    },
  };

  const ghost = armed?.type === 'asset' && cursor ? ghostFor(armed.id, cursor.wx, cursor.wy) : null;

  const assets = useMemo(
    () => RAW_ASSETS.map((a) => assetMap.get(a.slug) ?? a),
    [assetMap],
  );

  return {
    enabled: true,
    open,
    setOpen,
    tab,
    setTab,
    doc: state.doc,
    markers: state.markers,
    meta: state.meta,
    assets,
    structEnts,
    structKey,
    selected,
    select: setSelected,
    armed,
    arm(type, id) {
      setArmed({ type, id });
      setSelected(null);
    },
    disarm: () => setArmed(null),
    ghost,
    cursor: cursor ? { x: cursor.x, y: cursor.y } : null,
    pointerAt: cursor ? { wx: cursor.wx, wy: cursor.wy } : null,
    showIds,
    setShowIds,
    showColliders,
    setShowColliders,
    setPose: (id, patch) => setPose(id, { ...patch }),
    setAdded,
    resetPose,
    remove,
    restore,
    duplicate,
    setMarker: (id, pos) => setMarker(id, pos),
    setMeta,
    resetCollider,
    clearBlockedTiles,
    mitchyLook: state.doc.mitchyLook ?? 'mitchy',
    setMitchyLook: (slug) =>
      updateDoc((d) => {
        if (slug === 'mitchy') delete d.mitchyLook;
        else d.mitchyLook = slug;
      }),
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    dirty: dirty || recovered > 0,
    saving,
    status,
    recovered,
    save: () => void save(),
    discard,
    onKey,
    onWheelScale,
    pointer,
  };
}
