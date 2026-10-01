// The world editor is a dev tool: in a production build useWorldEditor is a
// stub that edits nothing and reports the world exactly as saved, so none of
// the editor (or its panel, gated on `enabled` in App.tsx) ships.
import { STRUCT_ENTS, WORLD_DOC } from '../world';
import markerData from '../data/sceneMarkers.json';
import { useWorldEditor as useWorldEditorDev } from './useWorldEditor';
import type { WorldEditor } from './useWorldEditor';

export type { WorldEditor, EditorTab } from './useWorldEditor';

const noop = () => {};
const OFF: WorldEditor = {
  enabled: false,
  open: false,
  setOpen: noop,
  tab: 'objects',
  setTab: noop,
  doc: WORLD_DOC,
  markers: markerData,
  meta: {},
  assets: [],
  structEnts: STRUCT_ENTS,
  structKey: 0,
  selected: null,
  select: noop,
  armed: null,
  arm: noop,
  disarm: noop,
  ghost: null,
  cursor: null,
  showIds: false,
  setShowIds: noop,
  showColliders: false,
  setShowColliders: noop,
  setPose: noop,
  setAdded: noop,
  resetPose: noop,
  remove: noop,
  restore: noop,
  duplicate: noop,
  setMarker: noop,
  setMeta: noop,
  resetCollider: noop,
  undo: noop,
  redo: noop,
  canUndo: false,
  canRedo: false,
  dirty: false,
  saving: false,
  status: null,
  recovered: 0,
  save: noop,
  discard: noop,
  onKey: noop,
  onWheelScale: () => false,
  pointer: { onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerLeave: noop },
};

function useWorldEditorOff(_opts: Parameters<typeof useWorldEditorDev>[0]): WorldEditor {
  return OFF;
}

export const useWorldEditor = import.meta.env.DEV ? useWorldEditorDev : useWorldEditorOff;
