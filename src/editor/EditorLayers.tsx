// The world editor's on-map layers (dev only): tile grid, the asset being
// placed, the selection box, colliders, ids and scene markers. Rendered as
// children of App.tsx's .world, so they share the camera's pan/zoom with
// the objects they point at.
import { ColoredSprite } from '../ColoredSprite';
import { MARKER_REGISTRY } from '../sceneMarkers';
import { GROUND_W, GROUND_H, TILE_CH, TILE_LN, spriteTiles, collisionBox, entityBlocksTile, footprint, startFrame, startTitleUrl, START_PLAYER_FRAME, START_PLAYER_K, START_PLAYER_BOX } from '../world';
import { PlayerShadow } from '../PlayerShadow';
import * as S from '../sprites';
import type { Ent } from '../world';
import { isEditable } from './useWorldEditor';
import { brushRadiusCells } from '../ground';
import type { WorldEditor } from './useWorldEditor';

const MARKER_LABELS = new Map(
  MARKER_REGISTRY.flatMap((c) => c.groups.flatMap((g) => g.markers)).map((m) => [m.id, m.label]),
);

// The box an object's art covers on screen, in ch / em.
function artBox(e: Ent) {
  const k = e.scale ?? 1;
  const r = e.rotation ?? 0;
  if (r === 0) {
    const cw = Math.max(...e.sprite.map((l) => l.length));
    return { left: e.x * TILE_CH, top: e.y * TILE_LN, w: cw * k, h: e.sprite.length * k };
  }
  const { wT, hT } = spriteTiles(e.sprite, k, r);
  return { left: e.x * TILE_CH, top: e.y * TILE_LN, w: wT * TILE_CH, h: hT * TILE_LN };
}

function Colliders({ e, withEmpty }: { e: Ent; withEmpty: boolean }) {
  const b = collisionBox(e);
  // Mitchy blocks by his feet row (see blocked() in App.tsx), not his shape
  const feet = e.kind === 'cat' ? footprint(e) : null;
  const cells = [];
  for (let ty = b.y0; ty <= b.y1; ty++) {
    for (let tx = b.x0; tx <= b.x1; tx++) {
      const solid = feet ? ty === feet.row && tx >= feet.x0 && tx <= feet.x1 : entityBlocksTile(e, tx, ty);
      if (!solid && !withEmpty) continue;
      cells.push(
        <div
          key={`${tx},${ty}`}
          className={'wed-col-tile' + (solid ? ' solid' : '')}
          style={{ left: `${tx * TILE_CH}ch`, top: `${ty * TILE_LN}em` }}
        />,
      );
    }
  }
  return <>{cells}</>;
}

// The Start screen tab: what the start screen shows, as a frame on the map
// (a 1920 x 1080 screen), the map around it dimmed. Its handle (top-left)
// moves it, its corner zooms it; the title + buttons box and the player
// inside it are dragged where they should stand. See useWorldEditor's
// hitStart for the hit areas, which match these boxes.
function StartLayer({ ed }: { ed: WorldEditor }) {
  const ss = ed.startScreen;
  const f = startFrame(ss);
  const p = ss.player;
  const k = START_PLAYER_K;
  const fr = START_PLAYER_FRAME;
  const cols = Math.max(...fr.sprite.map((l) => l.length));
  const box = (x: number, y: number, w: number, h: number) => ({ left: `${x}ch`, top: `${y}em`, width: `${w}ch`, height: `${h}em` });
  return (
    <>
      {/* the map outside the frame, dimmed: four bands round it */}
      <div className="wed-start-dim" style={box(0, 0, GROUND_W, f.y)} />
      <div className="wed-start-dim" style={box(0, f.y + f.h, GROUND_W, GROUND_H - f.y - f.h)} />
      <div className="wed-start-dim" style={box(0, f.y, f.x, f.h)} />
      <div className="wed-start-dim" style={box(f.x + f.w, f.y, GROUND_W - f.x - f.w, f.h)} />
      <div className="wed-start-frame" style={box(f.x, f.y, f.w, f.h)}>
        <div className="wed-start-handle">⤧ START SCREEN · drag to move</div>
        <div className="wed-start-corner" title="drag to zoom" />
      </div>
      <img
        className="wed-start-logo"
        src={startTitleUrl(ss.title)}
        alt=""
        draggable={false}
        style={{
          left: `${f.title.cx - f.title.w / 2}ch`,
          top: `${f.title.cy - f.title.h / 2}em`,
          width: `${f.title.w}ch`,
          height: `${f.title.h}em`,
          rotate: `${ss.title.rotation}deg`,
        }}
      />
      <div className="wed-start-ui" style={box(f.ui.x, f.ui.y, f.ui.w, f.ui.h)}>
        <div className="wed-start-sub" style={{ fontSize: `${f.ui.w / 30}em` }}>
          a tiny monochrome bay
        </div>
        <div className="wed-start-btn go" />
        <div className="wed-start-btn" />
        <div className="wed-start-btn" />
      </div>
      <div className="wed-start-player" style={{ left: `${p.x * TILE_CH}ch`, top: `${p.y * TILE_LN}em` }}>
        <PlayerShadow x={p.x} y={p.y} cx={START_PLAYER_BOX.w / 2} footEm={START_PLAYER_BOX.h} />
        <ColoredSprite
          className="player-sprite"
          style={{ position: 'absolute', left: `${-((1 - k) * cols) / 2}ch`, top: `${-(1 - k) * fr.sprite.length}em`, scale: `${k}` }}
          sprite={fr.sprite}
          colors={fr.colors}
          palette={S.WALK_DOWN_PALETTE}
          solidCells
        />
      </div>
    </>
  );
}

export function EditorWorldLayers({ ed, ents }: { ed: WorldEditor; ents: Ent[] }) {
  const sel = ed.selected && !ed.selected.startsWith('marker:') ? ents.find((e) => e.id === ed.selected) : undefined;
  const g = ed.ghost;
  return (
    <>
      <div className="dev-tile-grid" style={{ width: `${GROUND_W}ch`, height: `${GROUND_H}em` }} />
      {ed.tab === 'start' && <StartLayer ed={ed} />}

      {/* the Ground tab's brush */}
      {ed.tab === 'ground' && ed.pointerAt && (
        <div
          className="wed-brush"
          style={{
            left: `${ed.pointerAt.wx}ch`,
            top: `${ed.pointerAt.wy}em`,
            width: `${brushRadiusCells().rx * 2}ch`,
            height: `${brushRadiusCells().ry * 2}em`,
          }}
        />
      )}

      {/* every collider: in the Colliders tab, or with "show every collider" */}
      {(ed.showColliders || ed.tab === 'colliders') && (
        <>
          {ents
            .filter((e) => isEditable(e) || e.kind === 'blocker')
            .map((e) => (
              <Colliders key={e.id} e={e} withEmpty={false} />
            ))}
          {(ed.doc.blockedTiles ?? []).map((k) => {
            const [tx, ty] = k.split(',').map(Number);
            return (
              <div
                key={`wall-${k}`}
                className="wed-col-tile solid wall"
                style={{ left: `${tx * TILE_CH}ch`, top: `${ty * TILE_LN}em` }}
              />
            );
          })}
        </>
      )}
      {sel && ed.tab === 'colliders' && <Colliders e={sel} withEmpty />}

      {sel &&
        (() => {
          const b = artBox(sel);
          return (
            <div
              className="wed-sel"
              style={{ left: `${b.left}ch`, top: `${b.top}em`, width: `${b.w}ch`, height: `${b.h}em` }}
            >
              <span className="wed-sel-label">{sel.id}</span>
            </div>
          );
        })()}

      {ed.showIds &&
        ents.filter(isEditable).map((e) => (
          <div key={e.id} className="wed-id" style={{ left: `${e.x * TILE_CH}ch`, top: `${e.y * TILE_LN}em` }}>
            <span>{e.id}</span>
          </div>
        ))}

      {g &&
        (() => {
          const cw = Math.max(...g.sprite.map((l) => l.length));
          const offX = ((1 - g.scale) * cw) / 2;
          const offY = (1 - g.scale) * g.sprite.length;
          return (
            <ColoredSprite
              className="ent wed-ghost"
              style={{
                left: `${g.x * TILE_CH - offX}ch`,
                top: `${g.y * TILE_LN - offY}em`,
                scale: `${g.scale}`,
              }}
              sprite={g.sprite}
              colors={g.colors}
              palette={g.palette}
              color={g.colors ? undefined : '#c9c2b0'}
            />
          );
        })()}

      {Object.entries(ed.markers).map(([id, p]) => (
        <div
          key={id}
          className={'dev-marker-dot' + (ed.selected === `marker:${id}` ? ' wed-marker-on' : '')}
          style={{ left: `${(p.x + 0.5) * TILE_CH}ch`, top: `${(p.y + 0.5) * TILE_LN}em` }}
        >
          <span className="dev-marker-dot-circle" />
          <span className="dev-marker-dot-label">[ {MARKER_LABELS.get(id) ?? id} ]</span>
        </div>
      ))}
    </>
  );
}
