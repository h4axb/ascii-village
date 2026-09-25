// The "M" map overlay — new, from scratch (see introPartB feature spec).
//
// Two layers:
//   1. A semi-static WORLD layer: coastline/island silhouette (from the same
//      isWater()/regionAt() world.ts uses for the real game) plus major
//      structures (house/shop). Generated ONCE into an offscreen <canvas> at
//      one pixel per world TILE (130x145 — MAP_W x MAP_H), cached at module
//      scope (not per-mount, not per-render) since the world itself is fully
//      static/deterministic — there is nothing to invalidate the cache on.
//      The canvas is then scaled up with CSS (image-rendering: pixelated) to
//      the overview's on-screen size — this is NOT a second live game
//      renderer, it is one cheap one-time draw reused forever.
//   2. A DYNAMIC character overlay: small absolutely-positioned "head"
//      markers (the .hud-avatar technique — a small circular overflow:hidden
//      div with a full character sprite rendered small inside it, cropped to
//      a portrait rather than a separate face asset) for the player and any
//      other registered character, repositioned every render from each
//      entry's own `getPos()`.
//
// Registry: MapCharacterEntry[] — App.tsx builds this array (today: player +
// Mitchy). A future NPC is added there with no changes needed in this file.
import { useEffect, useMemo, useRef } from 'react';
import { ColoredSprite } from './ColoredSprite';
import { MAP_W, MAP_H, isWater, regionAt, STRUCT_ENTS } from './world';
import { MAP_OVERVIEW_SCALE, MAP_OVERVIEW_PADDING_PX, MAP_CHAR_MARKER_SIZE_PX } from './introPartB';
import { worldToMapPx } from './mapCoords';

export interface MapCharacterEntry {
  id: string;
  name: string;
  getPos: () => { x: number; y: number } | null; // null = not currently on the map (hidden)
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string; // base colour for mono sprites (e.g. Mitchy's — see .ent.cat)
  ringColor?: string; // border accent so the player/Mitchy read as distinct dots
}

const MAP_W_PX = MAP_W * MAP_OVERVIEW_SCALE;
const MAP_H_PX = MAP_H * MAP_OVERVIEW_SCALE;

const WATER_COLOR = '#1c3a4a';
const BEACH_COLOR = '#cbb27a';
const LAND_COLOR = '#3c6b3f';
const STRUCT_COLOR = '#d98c7e'; // --ui-accent-hi, structures read as landmarks

// Built once, first time the map is ever opened — cached at module scope so
// re-opening the map (or mounting a second Game instance in dev/HMR) never
// redraws it. Nothing in the world this reads from (isWater/regionAt/
// STRUCT_ENTS) changes at runtime, so there's no dependency to key a cache
// off of — nothing to keep in sync, just build once and reuse.
let terrainCanvasCache: HTMLCanvasElement | null = null;

function getTerrainCanvas(): HTMLCanvasElement {
  if (terrainCanvasCache) return terrainCanvasCache;
  const c = document.createElement('canvas');
  c.width = MAP_W;
  c.height = MAP_H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(MAP_W, MAP_H);
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const i = (ty * MAP_W + tx) * 4;
      const hex = isWater(tx, ty) ? WATER_COLOR : regionAt(tx, ty) === 'beach' ? BEACH_COLOR : LAND_COLOR;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Major structures (house/shop) — visually simplified to a single flagged
  // square each, per the "recognizable landmark, not the actual picture"
  // simplification the map is allowed (skip flowers/grass/decor/particles).
  for (const e of STRUCT_ENTS) {
    if (e.kind !== 'house' && e.kind !== 'shop') continue;
    ctx.fillStyle = STRUCT_COLOR;
    ctx.fillRect(Math.round(e.x) - 1, Math.round(e.y) - 1, 3, 3);
  }
  terrainCanvasCache = c;
  return c;
}

export default function GameMap({
  open,
  onClose,
  characters,
}: {
  open: boolean;
  onClose: () => void;
  characters: MapCharacterEntry[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(getTerrainCanvas(), 0, 0);
  }, [open]);

  // Cheap to recompute every render (a handful of entries) — no need to
  // memoize against anything, unlike the terrain canvas above.
  const heads = useMemo(
    () => (open ? characters.map((c) => ({ c, pos: c.getPos() })).filter((h) => h.pos) : []),
    [open, characters],
  );

  if (!open) return null;

  return (
    <div className="game-map-overlay" onClick={onClose}>
      <div
        className="panel game-map-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: MAP_W_PX + MAP_OVERVIEW_PADDING_PX * 2 }}
      >
        <div className="panel-title">Map</div>
        <button className="panel-close" onClick={onClose} aria-label="close map">
          &#215;
        </button>
        <div
          className="game-map-viewport"
          style={{
            width: MAP_W_PX + MAP_OVERVIEW_PADDING_PX * 2,
            height: MAP_H_PX + MAP_OVERVIEW_PADDING_PX * 2,
          }}
        >
          <canvas
            ref={canvasRef}
            width={MAP_W}
            height={MAP_H}
            className="game-map-canvas"
            style={{
              left: 0,
              top: 0,
              width: MAP_W_PX,
              height: MAP_H_PX,
              transform: `translate(${MAP_OVERVIEW_PADDING_PX}px, ${MAP_OVERVIEW_PADDING_PX}px)`,
            }}
          />
          {heads.map(({ c, pos }) => {
            const { left, top } = worldToMapPx(pos!.x, pos!.y);
            return (
              <div
                key={c.id}
                className="map-head"
                title={c.name}
                style={{
                  left,
                  top,
                  width: MAP_CHAR_MARKER_SIZE_PX,
                  height: MAP_CHAR_MARKER_SIZE_PX,
                  borderColor: c.ringColor ?? 'var(--ui-accent)',
                }}
              >
                <ColoredSprite sprite={c.sprite} colors={c.colors} palette={c.palette} color={c.color} />
              </div>
            );
          })}
        </div>
        <div className="hint">[M] or [Esc] to close</div>
      </div>
    </div>
  );
}
