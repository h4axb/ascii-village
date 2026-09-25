// ---------------------------------------------------------------------------
// SCENE MARKER REGISTRY — the semantic-id catalogue of every world position
// a future cinematic/tutorial/quest sequence needs. This module defines WHAT
// markers exist and how they're organized in the dev editor's collapsible
// tree; it does NOT own their placed positions — that's devSceneMarkers.ts's
// job (the editor hook) and src/data/sceneMarkers.json (the persisted disk
// file), kept separate from this static catalogue the same way
// STRUCT_ENTS_BASE (world.ts) is kept separate from worldOverrides.json.
//
// To add a future sequence, extend MARKER_REGISTRY below — nothing else
// needs to change: the editor tree, the drag/drop placement, persistence and
// getMarkerPosition() are all driven off this one array.
// ---------------------------------------------------------------------------
import markerData from './data/sceneMarkers.json';

export interface MarkerDef {
  id: string; // stable semantic id, e.g. 'intro.partB.playerStart' — cinematic
  //             code looks markers up by THIS, never by label or coordinates
  label: string; // shown in the editor tree and on the in-world red marker
}
export interface MarkerGroup {
  id: string;
  label: string;
  markers: MarkerDef[];
}
export interface MarkerCategory {
  id: string;
  label: string;
  groups: MarkerGroup[];
}

// Intro > Part B — Wake Up > PLAYER START / MITCHY START / MITCHY EXIT, per
// the current request. Later sequences (Intro Part A/C, Tutorial, Quests,
// ...) are added as additional entries in this same array — the tree in
// DevAssetPanel/SceneMarkingsPanel renders whatever's here, it doesn't need
// to know about any specific category.
export const MARKER_REGISTRY: MarkerCategory[] = [
  {
    id: 'intro',
    label: 'Intro',
    groups: [
      {
        id: 'partB',
        label: 'Part B — Wake Up',
        markers: [
          { id: 'intro.partB.playerStart', label: 'PLAYER START' },
          { id: 'intro.partB.mitchyStart', label: 'MITCHY START' },
          { id: 'intro.partB.mitchyExit', label: 'MITCHY EXIT' },
        ],
      },
    ],
  },
];

// Every marker id the registry currently knows about — used both by the
// editor hook (to drop stale/renamed ids from persisted data, same
// staleness-guard convention devWorldAssets.ts's loadDrafts/
// loadRemovedStructIds already use) and available here for anything that
// wants to validate an id before looking it up.
export const ALL_MARKER_IDS: ReadonlySet<string> = new Set(
  MARKER_REGISTRY.flatMap((cat) => cat.groups.flatMap((g) => g.markers.map((m) => m.id))),
);

export type MarkerPositions = Record<string, { x: number; y: number }>;

// The disk file IS the source of truth for "where is this marker" outside
// the editor's own React state — devSceneMarkers.ts's hook reads the same
// file to seed its live state, and this reads it directly so cinematic code
// (which has no reason to mount the dev editor's hook) can ask for a
// position without any editor machinery in the loop.
const PERSISTED_MARKERS = markerData as MarkerPositions;

export interface MarkerLookupResult {
  found: boolean;
  x?: number;
  y?: number;
}

// Later cinematic/tutorial/quest code's entry point: ask for a marker by its
// stable id, get back either a real position or an EXPLICIT "not found" —
// never a guessed/fallback coordinate. Callers must handle `found: false`
// themselves (e.g. skip the sequence, warn, wait) rather than this module
// inventing a stand-in position.
export function getMarkerPosition(id: string): MarkerLookupResult {
  const p = PERSISTED_MARKERS[id];
  if (!p) return { found: false };
  return { found: true, x: p.x, y: p.y };
}
