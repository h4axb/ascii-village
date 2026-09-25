// ---------------------------------------------------------------------------
// DEV-ONLY INTRO NARRATION EDITOR — the "INTRO" tab's logic half (presentation
// is src/DevIntroTab.tsx). Same shape as devWorldAssets.ts/devSceneMarkers.ts:
// this hook owns all state, the component just renders it.
//
// Reads/writes the SAME data the runtime consumes — src/introNarrationData.ts's
// INTRO_NARRATION (base merged with src/data/introNarrationOverrides.json) —
// never a parallel copy. Editing here works in-memory against a per-session
// working copy (`beatsByStage`), seeded from INTRO_NARRATION at mount; "Save
// Changes" POSTs the WHOLE working copy to the dev-only /__dev/intro-narration
// endpoint (vite.config.ts's introNarrationSavePlugin), which writes it
// straight to src/data/introNarrationOverrides.json. introNarrationData.ts
// merges that file into INTRO_NARRATION at module load — both in `vite dev`
// and in a production build — so a saved beat is real shipped content, not
// just a live-session preview. "Revert" just re-seeds the working copy from
// INTRO_NARRATION again, discarding any not-yet-saved edits.
//
// Every effect/handler below is meant to be used only from DEV — the hook
// itself doesn't gate on import.meta.env.DEV because its only call site
// (DevAssetPanel, via App.tsx) is already import.meta.env.DEV-gated, same
// convention as useSceneMarkerTool.
// ---------------------------------------------------------------------------
import { useMemo, useRef, useState } from 'react';
import {
  INTRO_NARRATION,
  INTRO_STAGE_ORDER,
  INTRO_STAGE_LABELS,
  type IntroStageId,
  type NarrationBeat,
} from './introNarrationData';

export type StageBeats = Partial<Record<IntroStageId, NarrationBeat[]>>;

// Short id prefixes already established per-stage in introNarrationData.ts
// (e.g. 'rejection-email' stage uses 'rejection-N' ids, not 'rejection-email-N';
// 'myll-tired' uses 'tired-N'). New beats follow the SAME convention rather
// than inventing a longer one, so a stage's ids stay visually consistent
// whether hand-authored or editor-added.
const STAGE_ID_PREFIX: Record<IntroStageId, string> = {
  'laptop-off': 'laptop-off',
  'laptop-on': 'laptop-on',
  'rejection-email': 'rejection',
  desktop: 'desktop',
  'myll-browsing': 'myll',
  'myll-tired': 'tired',
};

function cloneBeats(src: StageBeats): StageBeats {
  const out: StageBeats = {};
  for (const stage of Object.keys(src) as IntroStageId[]) {
    out[stage] = (src[stage] ?? []).map((b) => ({ ...b }));
  }
  return out;
}

function nextBeatId(stage: IntroStageId, list: NarrationBeat[]): string {
  const prefix = STAGE_ID_PREFIX[stage];
  let max = 0;
  for (const b of list) {
    const m = b.id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${max + 1}`;
}

export interface PlayState {
  stage: IntroStageId;
  stopAfter: boolean; // true = "Play Scene" (stop once the NEXT stage would start), false = "Play From Here"
}

export interface IntroNarrationTool {
  stages: IntroStageId[];
  labels: Record<IntroStageId, string>;
  beatsByStage: StageBeats;
  selectedStage: IntroStageId | null;
  selectStage(stage: IntroStageId | null): void;

  addBeat(stage: IntroStageId): void;
  updateBeat(stage: IntroStageId, id: string, patch: Partial<Pick<NarrationBeat, 'text' | 'delayMs' | 'holdMs'>>): void;
  deleteBeat(stage: IntroStageId, id: string): void;
  moveBeat(stage: IntroStageId, id: string, dir: -1 | 1): void;

  dirty: boolean;
  save(): void;
  revert(): void;
  saving: boolean;
  lastSaveError: string | null;

  // Static preview: renders the real <IntroNarration/> component with this
  // text (see DevIntroTab.tsx) rather than an editor-only imitation.
  previewText: string | null;
  previewBeat(stage: IntroStageId, id: string): void;

  // Cinematic preview: mounts a real <IntroA/> with devStartStage/
  // devStopAfterStage (see IntroA.tsx's own module comment).
  playState: PlayState | null;
  playScene(stage: IntroStageId): void;
  playFromHere(stage: IntroStageId): void;
  stopPlaying(): void;
  onPlaybackComplete(): void;
}

export function useIntroNarrationTool(): IntroNarrationTool {
  const [beatsByStage, setBeatsByStage] = useState<StageBeats>(() => cloneBeats(INTRO_NARRATION));
  const [selectedStage, setSelectedStage] = useState<IntroStageId | null>(INTRO_STAGE_ORDER[0] ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [playState, setPlayState] = useState<PlayState | null>(null);
  const previewTimers = useRef<number[]>([]);

  function mutate(fn: (draft: StageBeats) => void) {
    setBeatsByStage((prev) => {
      const next = cloneBeats(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  }

  function addBeat(stage: IntroStageId) {
    mutate((draft) => {
      const list = draft[stage] ?? (draft[stage] = []);
      list.push({ id: nextBeatId(stage, list), text: 'New line...', delayMs: 300, holdMs: 1500 });
    });
  }

  function updateBeat(stage: IntroStageId, id: string, patch: Partial<Pick<NarrationBeat, 'text' | 'delayMs' | 'holdMs'>>) {
    mutate((draft) => {
      const list = draft[stage];
      if (!list) return;
      const beat = list.find((b) => b.id === id);
      if (beat) Object.assign(beat, patch);
    });
  }

  function deleteBeat(stage: IntroStageId, id: string) {
    mutate((draft) => {
      const list = draft[stage];
      if (!list) return;
      draft[stage] = list.filter((b) => b.id !== id);
    });
  }

  function moveBeat(stage: IntroStageId, id: string, dir: -1 | 1) {
    mutate((draft) => {
      const list = draft[stage];
      if (!list) return;
      const i = list.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    });
  }

  async function save() {
    setSaving(true);
    setLastSaveError(null);
    try {
      const res = await fetch('/__dev/intro-narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(beatsByStage),
      });
      if (!res.ok) throw new Error(`save endpoint responded ${res.status}`);
      setDirty(false);
    } catch (err) {
      // No dev endpoint (e.g. a production preview server) or the request
      // failed — surface it rather than silently pretending it saved, since
      // (unlike devWorldAssets' localStorage fallback) there is no secondary
      // persistence layer here to fall back on.
      setLastSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    setBeatsByStage(cloneBeats(INTRO_NARRATION));
    setDirty(false);
    setLastSaveError(null);
  }

  function previewBeat(stage: IntroStageId, id: string) {
    const beat = (beatsByStage[stage] ?? []).find((b) => b.id === id);
    if (!beat) return;
    for (const t of previewTimers.current) window.clearTimeout(t);
    previewTimers.current = [];
    setPreviewText(null);
    const t1 = window.setTimeout(() => {
      setPreviewText(beat.text);
      const t2 = window.setTimeout(() => setPreviewText(null), beat.holdMs);
      previewTimers.current.push(t2);
    }, Math.min(beat.delayMs, 600)); // capped — this is a UI preview, not a full cinematic wait
    previewTimers.current.push(t1);
  }

  function playScene(stage: IntroStageId) {
    setPlayState({ stage, stopAfter: true });
  }
  function playFromHere(stage: IntroStageId) {
    setPlayState({ stage, stopAfter: false });
  }
  function stopPlaying() {
    // The actual imperative stop happens via IntroAHandle.skip() in
    // DevIntroTab.tsx (it holds the ref); this just clears state once that's
    // called onComplete. Exposed separately so DevIntroTab can call skip()
    // THEN this, in the right order.
    setPlayState(null);
  }
  function onPlaybackComplete() {
    setPlayState(null);
  }

  return useMemo(
    () => ({
      stages: INTRO_STAGE_ORDER,
      labels: INTRO_STAGE_LABELS,
      beatsByStage,
      selectedStage,
      selectStage: setSelectedStage,
      addBeat,
      updateBeat,
      deleteBeat,
      moveBeat,
      dirty,
      save,
      revert,
      saving,
      lastSaveError,
      previewText,
      previewBeat,
      playState,
      playScene,
      playFromHere,
      stopPlaying,
      onPlaybackComplete,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beatsByStage, selectedStage, dirty, saving, lastSaveError, previewText, playState],
  );
}
