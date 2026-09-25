// ---------------------------------------------------------------------------
// DEV-ONLY UI for useWorldAssetTool (src/devWorldAssets.ts). Presentational —
// all state/logic lives in the hook, this just renders it. Mounted only when
// import.meta.env.DEV (see the call site in App.tsx), so none of this exists
// in a production build.
//
// [E] toggles the asset library open/closed (see the hook's own keydown
// effect) — but the ghost-controls block stays visible whenever a ghost is
// active REGARDLESS of that toggle, so closing the library to see more of
// the map doesn't also hide the scale/rotate/commit controls for whatever
// you're mid-placing.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { ColoredSprite } from './ColoredSprite';
import type { WorldAssetTool } from './devWorldAssets';
import type { SceneMarkerTool } from './devSceneMarkers';
import type { IntroNarrationTool } from './devIntroNarration';
import { MARKER_REGISTRY } from './sceneMarkers';
import { DevImageTab } from './DevImageTab';
import { DevIntroTab } from './DevIntroTab';

// The thumb box is 60x44px (see .dev-asset-variant-thumb, styles.css) at this
// panel's own 11px font — a fixed 0.4 scale (the old behaviour) works for
// every small/medium sprite, but a sprite with a very large row count leaves
// its actual content scrolled off past the thumb's clipped edge, rendering
// as blank. Scale each thumbnail down only as far as it actually needs, so
// small sprites keep their old (larger, clearer) look and only the oversized
// ones shrink further to fit. 6.6/11 are this font-stack's per-character
// width/height AT THIS PANEL'S 11px font-size (same 0.6 width:height ratio
// the game's own 14px field grid uses — CELL_CH=8.4/CELL_LN=14 in world.ts).
const THUMB_CELL_W = 6.6;
const THUMB_CELL_H = 11;
const THUMB_BOX_W = 56; // small margin inside the 60px box
const THUMB_BOX_H = 40; // small margin inside the 44px box
function thumbScale(sprite: string[]): number {
  const cols = Math.max(1, ...sprite.map((l) => l.length));
  const rows = Math.max(1, sprite.length);
  return Math.min(0.4, THUMB_BOX_W / (cols * THUMB_CELL_W), THUMB_BOX_H / (rows * THUMB_CELL_H));
}

export function DevAssetPanel({
  tool,
  markerTool,
  introTool,
}: {
  tool: WorldAssetTool;
  markerTool: SceneMarkerTool;
  introTool: IntroNarrationTool;
}) {
  const [showSolid, setShowSolid] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'assets' | 'image'>('assets');
  // Three top-level sections: the pre-existing asset library (unchanged
  // below, just nested one level deeper), the Scene Markings tree, and the
  // INTRO narration/timing editor (src/DevIntroTab.tsx).
  const [outerTab, setOuterTab] = useState<'world' | 'markers' | 'intro'>('world');
  const {
    manifest,
    baked,
    sprites,
    drafts,
    ghost,
    panelOpen,
    structEnts,
    removedStructIds,
    toggleStructRemoved,
  } = tool;

  const toggleSolid = (slug: string) => {
    setShowSolid((s) => {
      const n = new Set(s);
      if (n.has(slug)) n.delete(slug);
      else n.add(slug);
      return n;
    });
  };

  // Nothing at all — not even the panel's own background/border, and not
  // the "[E]" hint — until the editor has actually been opened once (or a
  // ghost is mid-placement, which can't happen before that anyway). Was
  // previously always-mounted with a visible corner box even when closed.
  if (!panelOpen && !ghost) return null;

  return (
    <div className="dev-asset-panel">
      {panelOpen && (
        <div className="dev-asset-head">
          world assets
          <span className="dev-asset-hint">[E]</span>
          {ghost && <span className="dev-asset-ghost-tag">{ghost.legality}</span>}
        </div>
      )}

      {ghost && (
        <div className="dev-asset-ghost-controls">
          <div>
            {ghost.slug} @ ({ghost.x},{ghost.y}) {ghost.warnReason ? `— ${ghost.warnReason}` : ''}
          </div>
          <label>
            scale
            <input
              type="range"
              min={0.05}
              max={4}
              step={0.05}
              value={ghost.scale}
              onChange={(e) => tool.adjustGhostScale(+e.target.value - ghost.scale)}
            />
            <span>{ghost.scale.toFixed(2)}x</span>
          </label>
          <div className="dev-asset-ghost-btns">
            <button onClick={tool.rotateGhost}>rotate ({ghost.rotation * 90}°)</button>
            <button
              onClick={tool.commitGhost}
              disabled={ghost.legality === 'blocked'}
              className={ghost.legality === 'blocked' ? 'dev-asset-btn-disabled' : ''}
            >
              commit
            </button>
            <button onClick={tool.cancelGhost}>cancel</button>
          </div>
        </div>
      )}

      {panelOpen && (
        <>
          <div className="dev-asset-outer-tabs">
            <button
              className={outerTab === 'world' ? 'dev-asset-tab-active' : ''}
              onClick={() => setOuterTab('world')}
            >
              WORLD ASSETS
            </button>
            <button
              className={outerTab === 'markers' ? 'dev-asset-tab-active' : ''}
              onClick={() => setOuterTab('markers')}
            >
              SCENE MARKINGS
            </button>
            <button
              className={outerTab === 'intro' ? 'dev-asset-tab-active' : ''}
              onClick={() => setOuterTab('intro')}
            >
              INTRO
            </button>
          </div>

          {outerTab === 'markers' && <SceneMarkingsPanel markerTool={markerTool} />}
          {outerTab === 'intro' && <DevIntroTab tool={introTool} />}

          {outerTab === 'world' && (
          <>
          <div className="dev-asset-tabs">
            <button
              className={tab === 'assets' ? 'dev-asset-tab-active' : ''}
              onClick={() => setTab('assets')}
            >
              assets
            </button>
            <button
              className={tab === 'image' ? 'dev-asset-tab-active' : ''}
              onClick={() => setTab('image')}
            >
              insert image
            </button>
          </div>

          {tab === 'image' && <DevImageTab />}

          {tab === 'assets' && (
          <>
          <div className="dev-asset-group">
            <div className="dev-asset-group-name">already in game</div>
            <div className="dev-asset-variants">
              {baked.map((a) => {
                const sd = sprites[a.slug];
                if (!sd) return null;
                return (
                  <div key={a.slug} className="dev-asset-variant">
                    <button
                      className="dev-asset-variant-thumb"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', a.slug);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => tool.startGhost(a.slug)}
                      title="drag onto the map, or click to arm at map centre"
                    >
                      <ColoredSprite
                        sprite={sd.sprite}
                        colors={sd.colors}
                        palette={sd.palette}
                        color={sd.color}
                        style={{ transform: `scale(${thumbScale(sd.sprite)})` }}
                      />
                    </button>
                    <div className="dev-asset-variant-meta">
                      <span>{a.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dev-asset-groups">
            {manifest.length === 0 && (
              <div className="dev-asset-empty">
                nothing transcribed yet — see docs/AssetTranscriptionWorkflow.md
              </div>
            )}
            {manifest.map((g) => (
              <div key={g.group} className="dev-asset-group">
                <div className="dev-asset-group-name">{g.group}</div>
                <div className="dev-asset-variants">
                  {g.variants.map((v) => {
                    const sd = sprites[v.slug];
                    if (!sd) return null;
                    return (
                      <div key={v.slug} className="dev-asset-variant">
                        <button
                          className="dev-asset-variant-thumb"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', v.slug);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          onClick={() => tool.startGhost(v.slug)}
                          title="drag onto the map, or click to arm at map centre"
                        >
                          <ColoredSprite
                            sprite={sd.sprite}
                            colors={sd.colors}
                            palette={sd.palette}
                            color={sd.color}
                            style={{ transform: `scale(${thumbScale(sd.sprite)})` }}
                          />
                          {sd.solid && showSolid.has(v.slug) && (
                            <ColoredSprite
                              className="dev-asset-solid-overlay"
                              sprite={sd.solid}
                              color="#e2726b"
                              style={{ transform: `scale(${thumbScale(sd.sprite)})` }}
                            />
                          )}
                        </button>
                        <div className="dev-asset-variant-meta">
                          <span>{v.sizeTier}</span>
                          {sd.solid && (
                            <button className="dev-asset-solid-toggle" onClick={() => toggleSolid(v.slug)}>
                              mask
                            </button>
                          )}
                        </div>
                        {v.warnings.length > 0 && (
                          <div className="dev-asset-warnings">{v.warnings.join(', ')}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {structEnts.length > 0 && (
            <div className="dev-asset-drafts">
              <div className="dev-asset-group-name">
                already in world ({structEnts.length}
                {removedStructIds.size > 0 ? `, ${removedStructIds.size} hidden` : ''})
              </div>
              {structEnts.map((e) => {
                const isRemoved = removedStructIds.has(e.id);
                return (
                  <div
                    key={e.id}
                    className="dev-asset-draft-row"
                    style={isRemoved ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}
                  >
                    <span>
                      {e.id} ({e.kind}) @ ({e.x},{e.y})
                    </span>
                    <button
                      onClick={() => toggleStructRemoved(e.id)}
                      title={
                        isRemoved
                          ? 'restore — undoes the preview hide'
                          : 'hide from preview — does NOT edit world.ts; dump() prints what to delete there yourself'
                      }
                    >
                      {isRemoved ? '↺' : '×'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {drafts.length > 0 && (
            <div className="dev-asset-drafts">
              <div className="dev-asset-group-name">placed ({drafts.length})</div>
              {drafts.map((d) => (
                <div key={d.id} className="dev-asset-draft-row">
                  <span>
                    {d.id} @ ({d.x},{d.y}) {d.scale}x r{d.rotation}
                  </span>
                  <button onClick={() => tool.removeDraft(d.id)}>×</button>
                </div>
              ))}
            </div>
          )}

          <div className="dev-asset-undo-row">
            <button onClick={tool.undo} disabled={!tool.canUndo} title="undo last place/delete">
              ↶ undo
            </button>
            <button onClick={tool.redo} disabled={!tool.canRedo} title="redo">
              ↷ redo
            </button>
          </div>

          {(drafts.length > 0 || removedStructIds.size > 0) && (
            <button className="dev-asset-dump-btn" onClick={tool.dump}>
              dump to console
            </button>
          )}
          </>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCENE MARKINGS — the collapsible category > group > marker tree, driven
// entirely off sceneMarkers.ts's MARKER_REGISTRY (adding a future category/
// group/marker there is the only change needed to extend this tree — no
// changes needed here). A marker chip is dragged out onto the map for its
// INITIAL placement (devSceneMarkers.ts's dropMarker, routed through
// App.tsx's field onDrop via a 'scene-marker:<id>' payload prefix);
// repositioning an already-placed one is Alt+left-click+drag directly on
// its in-world red marker (see App.tsx's marker overlay + devSceneMarkers.ts
// for that gesture) — nothing here handles that half, this is placement-
// source + status display only.
// ---------------------------------------------------------------------------
function SceneMarkingsPanel({ markerTool }: { markerTool: SceneMarkerTool }) {
  // Both levels start expanded so the one category/group this ships with is
  // immediately visible — collapsing is for when there are many.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(MARKER_REGISTRY.flatMap((c) => [c.id, ...c.groups.map((g) => `${c.id}.${g.id}`)])),
  );
  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className="dev-marker-tree">
      {MARKER_REGISTRY.length === 0 && (
        <div className="dev-asset-empty">no marker categories registered yet — see sceneMarkers.ts</div>
      )}
      {MARKER_REGISTRY.map((cat) => {
        const catOpen = expanded.has(cat.id);
        return (
          <div key={cat.id} className="dev-marker-category">
            <button className="dev-marker-node-toggle" onClick={() => toggle(cat.id)}>
              {catOpen ? '▾' : '▸'} {cat.label}
            </button>
            {catOpen &&
              cat.groups.map((g) => {
                const groupKey = `${cat.id}.${g.id}`;
                const groupOpen = expanded.has(groupKey);
                return (
                  <div key={g.id} className="dev-marker-group">
                    <button className="dev-marker-node-toggle dev-marker-node-toggle-group" onClick={() => toggle(groupKey)}>
                      {groupOpen ? '▾' : '▸'} {g.label}
                    </button>
                    {groupOpen && (
                      <div className="dev-marker-list">
                        {g.markers.map((m) => {
                          const placed = markerTool.positions[m.id];
                          return (
                            <div key={m.id} className="dev-marker-row">
                              <span
                                className="dev-marker-chip"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('text/plain', `scene-marker:${m.id}`);
                                  e.dataTransfer.effectAllowed = 'copy';
                                }}
                                title={
                                  placed
                                    ? 'drag onto the map to move here, or Alt+drag its red in-world marker instead'
                                    : 'drag onto the map to place'
                                }
                              >
                                ● {m.label}
                              </span>
                              <span className="dev-marker-status">
                                {placed ? `(${placed.x}, ${placed.y})` : 'not placed'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
