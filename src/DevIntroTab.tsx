// ---------------------------------------------------------------------------
// DEV-ONLY UI for the "INTRO" tab of the E editor (src/DevAssetPanel.tsx) —
// authoring layer on top of the already-complete unified intro/narration
// architecture. Presentational: all state/logic lives in
// src/devIntroNarration.ts's useIntroNarrationTool, this just renders it.
//
// Reads stage ids/labels from introNarrationData.ts's INTRO_STAGE_ORDER/
// INTRO_STAGE_LABELS (not hardcoded here) and edits its INTRO_NARRATION
// (via the hook's working copy) — the ONE narration source, same file the
// runtime IntroA.tsx consumes. Play Scene/Play From Here mount the REAL
// <IntroA/> with its devStartStage/devStopAfterStage dev props (see that
// component's own module comment) rather than a mock cinematic. Preview
// Beat renders the REAL <IntroNarration/> component.
//
// Asset preview is READ-ONLY (see STAGE_ASSET_PREVIEW below) — actual image
// replacement (upload -> write to public/intro/) was scoped out; see this
// file's own note near STAGE_ASSET_PREVIEW.
// ---------------------------------------------------------------------------
import { useRef } from 'react';
import type { IntroNarrationTool } from './devIntroNarration';
import type { IntroStageId } from './introNarrationData';
import IntroA, { type IntroAHandle } from './IntroA';
import IntroNarration from './IntroNarration';

// Which /intro/*.png files a stage's own IntroA.tsx section actually shows —
// hand-mapped once here since the runtime doesn't key its <img> tags by
// stage id anywhere (img1..img6/myllApp are plain refs, not data-driven).
// Read-only preview only; see this file's module comment for why replacement
// isn't implemented.
const STAGE_ASSET_PREVIEW: Partial<Record<IntroStageId, string[]>> = {
  'laptop-off': ['/intro/state1-screen-off.png'],
  'laptop-on': ['/intro/state2-laptop-scene.png', '/intro/state3-desktop.png'],
  'rejection-email': ['/intro/state4-mail-inbox.png', '/intro/state5-rejection-mail.png'],
  desktop: ['/intro/state6-desktop-reopened.png'],
  'myll-browsing': ['/intro/state7-myll-header.png', '/intro/state8-myll-summer.png', '/intro/state9-myll-shopping.png'],
  'myll-tired': ['/intro/state8-myll-summer.png', '/intro/state9-myll-shopping.png'],
};

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const btn: React.CSSProperties = {
  font: '10px ui-monospace, monospace',
  background: '#2a2a38',
  color: '#e4e6f0',
  border: '1px solid #3d3d4d',
  borderRadius: 3,
  padding: '3px 6px',
  cursor: 'pointer',
};
const input: React.CSSProperties = {
  font: '11px ui-monospace, monospace',
  background: '#1a1a24',
  color: '#e4e6f0',
  border: '1px solid #3d3d4d',
  borderRadius: 3,
  padding: '3px 5px',
  flex: 1,
};
const numInput: React.CSSProperties = { ...input, flex: 'none', width: 56 };

export function DevIntroTab({ tool }: { tool: IntroNarrationTool }) {
  const previewRef = useRef<IntroAHandle>(null);

  function handleStop() {
    previewRef.current?.skip();
    tool.stopPlaying();
  }

  const stage = tool.selectedStage;
  const beats = stage ? tool.beatsByStage[stage] ?? [] : [];

  return (
    <div className="dev-intro-tab" style={{ fontSize: 11 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {tool.stages.map((s, i) => (
          <button
            key={s}
            style={{
              ...btn,
              background: s === stage ? '#3d3d5c' : '#2a2a38',
              borderColor: s === stage ? '#6a6ac0' : '#3d3d4d',
            }}
            onClick={() => tool.selectStage(s)}
            title={s}
          >
            {i + 1}. {tool.labels[s] ?? s}
          </button>
        ))}
      </div>

      {!stage && <div style={{ opacity: 0.7 }}>select a stage above</div>}

      {stage && (
        <>
          <div style={row}>
            <strong style={{ flex: 1 }}>
              {tool.labels[stage]} <span style={{ opacity: 0.5 }}>({stage})</span>
            </strong>
          </div>

          <div style={{ ...row, gap: 8 }}>
            <button style={btn} onClick={() => tool.playScene(stage)} disabled={!!tool.playState}>
              ▶ Play Scene
            </button>
            <button style={btn} onClick={() => tool.playFromHere(stage)} disabled={!!tool.playState}>
              ▶▶ Play From Here
            </button>
            {tool.playState && (
              <button style={{ ...btn, background: '#5c2a2a' }} onClick={handleStop}>
                ■ Stop
              </button>
            )}
          </div>

          {tool.playState && (
            <IntroA
              ref={previewRef}
              onComplete={() => {
                tool.onPlaybackComplete();
              }}
              devStartStage={tool.playState.stage}
              devStopAfterStage={tool.playState.stopAfter ? tool.playState.stage : undefined}
            />
          )}

          <div style={{ margin: '8px 0', borderTop: '1px solid #3d3d4d', paddingTop: 6 }}>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>narration beats ({beats.length})</div>
            {beats.length === 0 && <div style={{ opacity: 0.5, marginBottom: 6 }}>no beats — stage plays silently</div>}
            {beats.map((b, i) => (
              <div key={b.id} style={{ border: '1px solid #33333f', borderRadius: 4, padding: 5, marginBottom: 5 }}>
                <div style={{ ...row, marginBottom: 4 }}>
                  <span style={{ opacity: 0.5, width: 16 }}>{i + 1}</span>
                  <input
                    style={input}
                    value={b.text}
                    onChange={(e) => tool.updateBeat(stage, b.id, { text: e.target.value })}
                  />
                </div>
                <div style={row}>
                  <span style={{ opacity: 0.5, width: 16 }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    delay
                    <input
                      type="number"
                      style={numInput}
                      value={b.delayMs}
                      onChange={(e) => tool.updateBeat(stage, b.id, { delayMs: +e.target.value || 0 })}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    hold
                    <input
                      type="number"
                      style={numInput}
                      value={b.holdMs}
                      onChange={(e) => tool.updateBeat(stage, b.id, { holdMs: +e.target.value || 0 })}
                    />
                  </label>
                  <button style={btn} onClick={() => tool.previewBeat(stage, b.id)} title="preview via the real IntroNarration component">
                    preview
                  </button>
                  <button style={btn} disabled={i === 0} onClick={() => tool.moveBeat(stage, b.id, -1)}>
                    ↑
                  </button>
                  <button style={btn} disabled={i === beats.length - 1} onClick={() => tool.moveBeat(stage, b.id, 1)}>
                    ↓
                  </button>
                  <button style={{ ...btn, background: '#5c2a2a' }} onClick={() => tool.deleteBeat(stage, b.id)}>
                    ×
                  </button>
                </div>
                <div style={{ opacity: 0.4, marginTop: 2 }}>{b.id}</div>
              </div>
            ))}
            <button style={btn} onClick={() => tool.addBeat(stage)}>
              + Add Narration
            </button>
          </div>

          {STAGE_ASSET_PREVIEW[stage] && (
            <div style={{ margin: '8px 0', borderTop: '1px solid #3d3d4d', paddingTop: 6 }}>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>scene assets (read-only preview)</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {STAGE_ASSET_PREVIEW[stage]!.map((src) => (
                  <div key={src} title={src} style={{ width: 72 }}>
                    <img src={src} alt="" style={{ width: '100%', border: '1px solid #3d3d4d', borderRadius: 3, display: 'block' }} />
                    <div style={{ opacity: 0.4, fontSize: 9, wordBreak: 'break-all' }}>{src.split('/').pop()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ margin: '8px 0', borderTop: '1px solid #3d3d4d', paddingTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button style={{ ...btn, background: tool.dirty ? '#2a5c3a' : '#2a2a38' }} onClick={tool.save} disabled={tool.saving || !tool.dirty}>
          {tool.saving ? 'saving…' : 'Save Changes'}
        </button>
        <button style={btn} onClick={tool.revert} disabled={!tool.dirty}>
          Revert
        </button>
        {tool.dirty && !tool.saving && <span style={{ opacity: 0.6 }}>unsaved changes</span>}
        {tool.lastSaveError && <span style={{ color: '#e0827a' }}>save failed: {tool.lastSaveError}</span>}
      </div>

      {/* Real <IntroNarration/> — same presentational component the runtime
          uses, per this feature's "no editor-only imitation" requirement. */}
      <IntroNarration text={tool.previewText} />
    </div>
  );
}
