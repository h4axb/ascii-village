// ---------------------------------------------------------------------------
// DEV-ONLY LAYOUT TOOL — alt+drag the village into place.
//
// Placing buildings by editing x/y in STRUCT_ENTS is a guessing game: you can
// see where a thing IS, but choosing where it should GO means picking numbers
// blind, reloading, and looking again. This makes placement direct — wheel out
// until the island fits, alt+drag a structure, drop it, repeat — and then hands
// the result back as source you paste into world.ts.
//
// STRUCT_ENTS stays the single source of truth. Dragging only fills a
// `Placement` override that SHADOWS it in memory, which is what makes moves
// instant (a setState, not a file write). The override auto-saves to
// localStorage on every change, so it survives a reload on this browser —
// `layout.dump()` is still the separate, explicit step that turns a move
// into paste-ready source for world.ts, for when you want it to stick for
// good instead of just for this machine.
//
// Every effect below early-returns unless import.meta.env.DEV, the same shape
// as the `window.time` clock scrubber in App.tsx — in a production build the
// listeners are never bound and window.layout is never defined.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { STRUCT_ENTS, MAP_W, MAP_H, spriteTiles, bbox, collisionBox, tileBoxesOverlap, isWater } from './world';
import type { Ent } from './world';
import { screenToTile } from './coords';
import type { CamSnapshot } from './coords';

// id → the tile position it has been dragged to. Absent = wherever world.ts says.
export type Placement = Record<string, { x: number; y: number }>;

export interface LayoutTool {
  place: Placement;
  // kind -> render scale, while you're dialling one in with layout.scale()
  scale: Record<string, number>;
  dragId: string | null;
  cursor: { x: number; y: number } | null;
}

// Only STRUCT_ENTS is draggable. Wild flora is regenerated from a seed every
// growth window, so a move would be undone on the next tick — and there's
// nothing to paste back, since those positions aren't written down anywhere.

// One versioned JSON blob, same convention as save.ts's own localStorage
// save — a separate key so this dev-only convenience never collides with the
// player's actual save data.
const LAYOUT_KEY = 'ascii-village-dev-layout';

function loadLayout(): { place: Placement; scale: Record<string, number> } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { place: {}, scale: {} };
    const parsed: any = JSON.parse(raw); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (parsed.version !== 1) return { place: {}, scale: {} };
    // Drop overrides for ids/kinds that no longer exist — structures in this
    // project get renamed/redesigned often, and a stale override for a dead
    // id would otherwise sit in localStorage forever, silently doing nothing.
    const ids = new Set<string>(STRUCT_ENTS.map((e) => e.id));
    const kinds = new Set<string>(STRUCT_ENTS.map((e) => e.kind));
    const rawPlace: Record<string, { x: number; y: number }> = parsed.place ?? {};
    const rawScale: Record<string, number> = parsed.scale ?? {};
    const place: Placement = {};
    for (const [id, p] of Object.entries(rawPlace)) if (ids.has(id)) place[id] = p;
    const scale: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawScale)) if (kinds.has(k)) scale[k] = v;
    return { place, scale };
  } catch {
    return { place: {}, scale: {} };
  }
}

function saveLayout(place: Placement, scale: Record<string, number>) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: 1, place, scale }));
  } catch {
    // storage full/blocked — the tool still works in-memory for this session
  }
}

export function useLayoutTool(opts: {
  fieldRef: React.RefObject<HTMLElement | null>;
  camRef: React.MutableRefObject<CamSnapshot>;
  modalRef: React.MutableRefObject<unknown>;
}): LayoutTool {
  const { fieldRef, camRef, modalRef } = opts;
  const [place, setPlace] = useState<Placement>(() => loadLayout().place);
  const [scale, setScale] = useState<Record<string, number>>(() => loadLayout().scale);
  const [dragId, setDragId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // the listeners bind once, so everything they read lives on a ref
  const placeRef = useRef(place);
  placeRef.current = place;
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

  const posOf = (e: Ent) => placeRef.current[e.id] ?? { x: e.x, y: e.y };
  const at = (e: Ent) => ({ ...e, ...posOf(e) });

  // Auto-save on every change — the drag handler already dedupes to the same
  // object reference when a move doesn't cross a tile boundary (see onMove
  // below), so this fires once per tile moved, not once per pointer event.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    saveLayout(place, scale);
  }, [place, scale]);

  const toTile = (clientX: number, clientY: number) =>
    screenToTile(clientX, clientY, fieldRef.current, camRef.current);

  // topmost structure covering a tile — reverse order so the one drawn last
  // (visually on top) is the one you grab when footprints overlap
  const hit = (tx: number, ty: number): Ent | null => {
    for (let i = STRUCT_ENTS.length - 1; i >= 0; i--) {
      const e = STRUCT_ENTS[i];
      const b = bbox(at(e));
      if (tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1) return e;
    }
    return null;
  };

  // The same three rules validateLayout() applies on startup, run at drop time
  // so a bad placement says so immediately instead of on the next reload.
  const checkDrop = (id: string) => {
    const src = STRUCT_ENTS.find((s) => s.id === id);
    if (!src) return;
    const moved = at(src);
    const { wT, hT } = spriteTiles(src.sprite, src.scale);
    const bad: string[] = [];
    if (moved.x < 0 || moved.y < 0 || moved.x + wT > MAP_W || moved.y + hT > MAP_H) {
      bad.push('runs off the map');
    }
    let wet = false;
    for (let ty = moved.y; ty < moved.y + hT && !wet; ty++) {
      for (let tx = moved.x; tx < moved.x + wT; tx++) {
        if (isWater(tx, ty)) {
          wet = true;
          break;
        }
      }
    }
    if (wet) bad.push('overlaps water');
    // 'gardenbed' joins the buildings here: nothing else in STRUCT_ENTS is
    // meant to sit inside the fenced plot (wild spawns are already excluded
    // from it), so dropping it onto the cottage should say so at drop time.
    // 'cliff' deliberately stays OUT of this set even though it is the biggest
    // piece on the map — it's landscape, and things overlapping it (the cottage
    // standing on its crown, most of all) is the point, not a mistake to warn
    // about.
    const BULKY = new Set(['house', 'shop', 'gardenbed']);
    if (BULKY.has(moved.kind)) {
      for (const o of STRUCT_ENTS) {
        if (o.id === id || !BULKY.has(o.kind)) continue;
        if (tileBoxesOverlap(collisionBox(moved), collisionBox(at(o)))) {
          bad.push(`overlaps "${o.id}"`);
        }
      }
    }
    if (bad.length) console.warn(`[layout] "${id}" at (${moved.x},${moved.y}) ${bad.join(', ')}`);
    else console.info(`[layout] "${id}" -> x: ${moved.x}, y: ${moved.y}`);
  };

  // ---- alt+drag ----
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const onDown = (ev: PointerEvent) => {
      if (!ev.altKey || ev.button !== 0 || modalRef.current) return;
      const t = toTile(ev.clientX, ev.clientY);
      if (!t) return;
      const e = hit(t.x, t.y);
      if (!e) return;
      const p = posOf(e);
      // grab OFFSET, so the building keeps its position under the cursor
      // instead of snapping its top-left corner to the pointer
      dragRef.current = { id: e.id, offX: t.x - p.x, offY: t.y - p.y };
      setDragId(e.id);
      // this gesture belongs to the tool now — no click-to-move, no [F] popup
      ev.preventDefault();
      ev.stopPropagation();
    };

    const onMove = (ev: PointerEvent) => {
      const t = toTile(ev.clientX, ev.clientY);
      if (t) setCursor(t);
      const d = dragRef.current;
      if (!d || !t) return;
      const src = STRUCT_ENTS.find((s) => s.id === d.id);
      if (!src) return;
      const { wT, hT } = spriteTiles(src.sprite, src.scale);
      // clamped so a structure can never be dragged off the edge of the map
      const x = Math.max(0, Math.min(MAP_W - wT, t.x - d.offX));
      const y = Math.max(0, Math.min(MAP_H - hT, t.y - d.offY));
      setPlace((p) => (p[d.id]?.x === x && p[d.id]?.y === y ? p : { ...p, [d.id]: { x, y } }));
      ev.preventDefault();
    };

    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDragId(null);
      checkDrop(d.id);
    };

    // capture phase: the tool sees an alt+drag before the field's own click and
    // interaction handlers get a chance to act on it
    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- console API (open the browser console) --------------------------------
  //   layout.move('house', 26, 41)  place by exact tile
  //   layout.dump()                 print the moves as paste-ready source
  //   layout.reset()                drop every override, back to world.ts
  //   layout.list()                 every structure's current position
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const api = {
      move(id: string, x: number, y: number) {
        if (!STRUCT_ENTS.some((e) => e.id === id)) {
          console.warn(`[layout] no structure with id "${id}"`);
          return;
        }
        setPlace((p) => ({ ...p, [id]: { x, y } }));
        // checkDrop reads placeRef, which React hasn't updated yet — defer
        setTimeout(() => checkDrop(id), 0);
      },
      dump() {
        const moved = STRUCT_ENTS.filter((e) => {
          const p = placeRef.current[e.id];
          return p && (p.x !== e.x || p.y !== e.y);
        });
        if (!moved.length) {
          console.info('[layout] nothing moved yet');
          return;
        }
        const w = Math.max(...moved.map((e) => e.id.length));
        const lines = moved.map((e) => {
          const p = placeRef.current[e.id];
          const coords = `x: ${p.x}, y: ${p.y}`;
          return `  ${e.id.padEnd(w)}   ${coords.padEnd(14)}// was ${e.x}, ${e.y}`;
        });
        // The garden bed is the one entry whose STRUCT_ENTS x/y is DERIVED
        // (from farm.ts's GARDEN_HOME, so the fence art and the fence collider
        // can't drift apart). Pasting it into world.ts would be edited straight
        // back out by the next render, so say where it actually goes.
        const bed = moved.find((e) => e.id === 'garden-bed');
        const note = bed
          ? `\n  NOTE: garden-bed's position lives in farm.ts —` +
            ` set GARDEN_HOME = { x: ${placeRef.current['garden-bed'].x},` +
            ` y: ${placeRef.current['garden-bed'].y} } there, not in world.ts.`
          : '';
        console.info(
          `[layout] ${moved.length} moved — update these in STRUCT_ENTS (world.ts):\n` +
            lines.join('\n') + note,
        );
      },
      // Dial a kind's render scale live — the fastest way to judge how big a
      // sprite should be is to watch it change in the world, not to rebuild.
      // Whatever value you settle on goes into world.ts (PALM_SCALE).
      scale(kind: string, k: number) {
        if (!STRUCT_ENTS.some((e) => e.kind === kind)) {
          console.warn(`[layout] no structure of kind "${kind}"`);
          return;
        }
        setScale((s) => ({ ...s, [kind]: k }));
        console.info(`[layout] ${kind} drawn at ${k}x — put it in world.ts to keep it`);
      },
      reset(id?: string) {
        setPlace((p) => {
          if (!id) return {};
          const n = { ...p };
          delete n[id];
          return n;
        });
        if (!id) setScale({});
        console.info(id ? `[layout] "${id}" back to its world.ts position` : '[layout] all reset');
      },
      list() {
        console.table(
          STRUCT_ENTS.map((e) => {
            const p = placeRef.current[e.id] ?? { x: e.x, y: e.y };
            return { id: e.id, kind: e.kind, x: p.x, y: p.y, moved: p.x !== e.x || p.y !== e.y };
          }),
        );
      },
    };
    (window as unknown as { layout: unknown }).layout = api;
    console.info(
      '[layout] alt+drag a structure to place it — moves auto-save to this browser, ' +
        'layout.dump() when ready to bake a position into world.ts',
    );
    return () => {
      delete (window as unknown as { layout?: unknown }).layout;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { place, scale, dragId, cursor };
}
