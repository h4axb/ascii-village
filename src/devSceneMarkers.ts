// ---------------------------------------------------------------------------
// DEV-ONLY SCENE MARKER TOOL — place/reposition the named world positions
// cinematics (intro, tutorials, quests, ...) will read by stable id, per
// sceneMarkers.ts's MARKER_REGISTRY. Two placement gestures, deliberately
// mirroring conventions already established elsewhere in this codebase
// rather than inventing new ones:
//
//   drag a marker chip out of the editor's Scene Markings tab, drop it onto
//   the map -> INITIAL placement (same drag/drop wiring App.tsx's field
//   already has for worldAssetTool.startGhost, just routed by a
//   'scene-marker:<id>' payload prefix instead of a plain asset slug).
//
//   Alt + left-click + drag an ALREADY-PLACED marker -> reposition it. This
//   is devLayout.ts's own alt+drag structure-move gesture, applied to
//   markers instead of STRUCT_ENTS — same capture-phase pointerdown/
//   pointermove/pointerup listener shape, same "only while altKey is held,
//   so an ordinary click never moves anything" rule.
//
// Persistence mirrors devWorldAssets.ts's postWorldOverrides: every change
// fires a fire-and-forget POST to a Vite dev-only middleware
// (vite.config.ts) that writes straight to src/data/sceneMarkers.json, so a
// placement survives a reload / is shared across the repo without a manual
// export step. Markers are stored SEPARATELY from worldOverrides.json/
// STRUCT_ENTS — they are editor metadata, never game entities (see
// sceneMarkers.ts's own header for why).
//
// Every effect below early-returns unless import.meta.env.DEV — same shape
// as every other dev-only tool in this codebase, so none of this exists in
// a production build.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { screenToTile } from './coords';
import type { CamSnapshot } from './coords';
import markerData from './data/sceneMarkers.json';
import { ALL_MARKER_IDS } from './sceneMarkers';
import type { MarkerPositions } from './sceneMarkers';

export interface SceneMarkerTool {
  positions: MarkerPositions;
  dropMarker(id: string, x: number, y: number): void;
  dragMarkerId: string | null; // the marker currently being alt-dragged, if any
}

function loadInitial(): MarkerPositions {
  const raw = markerData as MarkerPositions;
  const out: MarkerPositions = {};
  // Same staleness guard as loadDrafts/loadRemovedStructIds
  // (devWorldAssets.ts) — a marker id removed/renamed in the registry since
  // this was saved just falls out here rather than sitting around forever.
  for (const [id, p] of Object.entries(raw)) {
    if (ALL_MARKER_IDS.has(id) && p && typeof p.x === 'number' && typeof p.y === 'number') {
      out[id] = p;
    }
  }
  return out;
}

async function postSceneMarkers(positions: MarkerPositions) {
  try {
    await fetch('/__dev/scene-markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(positions),
    });
  } catch {
    // no dev endpoint available (e.g. a production preview server) —
    // silently no-op, same fallback behaviour as postWorldOverrides
  }
}

export function useSceneMarkerTool(opts: {
  fieldRef: React.RefObject<HTMLElement | null>;
  camRef: React.MutableRefObject<CamSnapshot>;
  modalRef: React.MutableRefObject<unknown>;
  // Alt+drag reposition only listens while the dev editor panel is actually
  // open — markers are editor-only overlays (see sceneMarkers.ts), so the
  // gesture that moves them should only be live while that overlay is
  // visible in the first place.
  active: boolean;
}): SceneMarkerTool {
  const { fieldRef, camRef, modalRef, active } = opts;
  const [positions, setPositions] = useState<MarkerPositions>(() => loadInitial());
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const [dragMarkerId, setDragMarkerId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    postSceneMarkers(positions);
  }, [positions]);

  function dropMarker(id: string, x: number, y: number) {
    if (!ALL_MARKER_IDS.has(id)) return; // stray/unknown payload — ignore
    setPositions((p) => ({ ...p, [id]: { x, y } }));
  }

  // ---- Alt + left-click + drag: reposition an already-placed marker ----
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const toTile = (clientX: number, clientY: number) =>
      screenToTile(clientX, clientY, fieldRef.current, camRef.current);

    const onDown = (ev: PointerEvent) => {
      if (!activeRef.current || !ev.altKey || ev.button !== 0 || modalRef.current) return;
      const t = toTile(ev.clientX, ev.clientY);
      if (!t) return;
      // nearest placed marker within a tile of the click; last match (drawn
      // on top) wins on overlap, same tie-break devLayout.ts's hit() uses
      let hitId: string | null = null;
      for (const [id, p] of Object.entries(positionsRef.current)) {
        if (Math.abs(p.x - t.x) <= 1 && Math.abs(p.y - t.y) <= 1) hitId = id;
      }
      if (!hitId) return;
      dragRef.current = { id: hitId };
      setDragMarkerId(hitId);
      // this gesture belongs to the tool now — same as devLayout.ts's own
      // alt+drag, so it can't also trigger a normal click/interact underneath
      ev.preventDefault();
      ev.stopPropagation();
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const t = toTile(ev.clientX, ev.clientY);
      if (!t) return;
      setPositions((p) =>
        p[d.id]?.x === t.x && p[d.id]?.y === t.y ? p : { ...p, [d.id]: { x: t.x, y: t.y } },
      );
      ev.preventDefault();
    };

    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragMarkerId(null);
    };

    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { positions, dropMarker, dragMarkerId };
}
