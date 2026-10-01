// The world editor's on-map layers (dev only): tile grid, the asset being
// placed, the selection box, colliders, ids and scene markers. Rendered as
// children of App.tsx's .world, so they share the camera's pan/zoom with
// the objects they point at.
import { ColoredSprite } from '../ColoredSprite';
import { MARKER_REGISTRY } from '../sceneMarkers';
import { GROUND_W, GROUND_H, TILE_CH, TILE_LN, spriteTiles, collisionBox, entityBlocksTile, footprint } from '../world';
import type { Ent } from '../world';
import { isEditable } from './useWorldEditor';
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

export function EditorWorldLayers({ ed, ents }: { ed: WorldEditor; ents: Ent[] }) {
  const sel = ed.selected && !ed.selected.startsWith('marker:') ? ents.find((e) => e.id === ed.selected) : undefined;
  const g = ed.ghost;
  return (
    <>
      <div className="dev-tile-grid" style={{ width: `${GROUND_W}ch`, height: `${GROUND_H}em` }} />

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
