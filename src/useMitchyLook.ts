// Re-render when Mitchy's look changes (the world editor's Assets tab, see
// applyMitchyLook in world.ts). Returns a number that changes with the look;
// read the art itself from sprites.ts (S.MITCHY_FACE_LOOK, …) as usual.
import { useSyncExternalStore } from 'react';
import { mitchyRevision, onMitchyLook } from './sprites';

export const useMitchyLook = (): number => useSyncExternalStore(onMitchyLook, mitchyRevision);
