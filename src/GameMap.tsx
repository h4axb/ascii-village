// The "M" map overlay: a still, zoomed-out picture of the ACTUAL world.
//
//   1. TERRAIN (cached once per session): the same colour mosaic + glyphs the
//      game draws (terrain.ts), rendered at a fixed small cell size — no
//      caustics, foam or other animation.
//   2. ENTITIES (redrawn each time the map opens): every world sprite — house,
//      shop, palms, pond, garden, flora, placed items — painted as its own
//      coloured cells at map scale, so the map shows the island as it is now.
//   3. MARKERS: head portraits for the player and Mitchy (the HUD avatar
//      technique: a circular crop of the character sprite), icons for the
//      house and the shop, and a legend in the bottom-left corner.
//
// The view is zoomed in a little past "whole map fits", so the panel can be
// wide; WASD / arrow keys pan the map camera (App.tsx already blocks world
// movement while the map is open).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ColoredSprite } from './ColoredSprite';
import { GROUND_W, GROUND_H, TILE_CH, TILE_LN, MAP_W, STRUCT_ENTS, PLAYER_T, grassKeepOut } from './world';
import type { Ent } from './world';
import { terrainField, GLYPHS, KIND_WATER } from './terrain';

export interface MapCharacterEntry {
  id: string;
  name: string;
  getPos: () => { x: number; y: number } | null; // tile units; null = hidden
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string; // base colour for mono sprites (e.g. Mitchy's — see .ent.cat)
  ringColor?: string; // border accent so the player/Mitchy read as distinct
}

// Internal map resolution: px per character cell (a cell is 8.4 x 14 in game)
const CELL_W = 4;
const CELL_H = (CELL_W * 14) / 8.4;
const IMG_W = Math.round(GROUND_W * CELL_W);
const IMG_H = Math.round(GROUND_H * CELL_H);
const ZOOM = 1.6; // how far past "whole width fits" the map is zoomed in
const PAN_SPEED = 900; // map px per second while a key is held
const HEAD_PX = 34;
const ICON_PX = 26;

// Base colours for sprite cells without their own palette colour — the same
// values the .ent.<kind> CSS rules use in the game.
const KIND_COLOR: Record<string, string> = {
  cat: '#e9dcc1',
  palm: '#9BB86B',
  flower: '#9BB86B',
  cactus: '#9BB86B',
  fern: '#9BB86B',
  iceflower: '#9BB86B',
  grasshalm: '#9BB86B',
  flowerplus: '#9BB86B',
  pond: '#6a7078',
  cliff: '#6f7a52',
  house: '#E4D6B5',
  shop: '#E4D6B5',
  stone: '#8a8a8a',
  date: '#f5b731',
};

const hexOf = (c: number) => '#' + c.toString(16).padStart(6, '0');

let terrainCache: HTMLCanvasElement | null = null;

function terrainImage(font: string): HTMLCanvasElement {
  if (terrainCache) return terrainCache;
  const f = terrainField();
  // colour mosaic: one pixel per cell, scaled up without smoothing
  const small = document.createElement('canvas');
  small.width = f.bgW;
  small.height = f.bgH;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(f.bgW, f.bgH);
  img.data.set(f.bg);
  sctx.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = IMG_W;
  c.height = IMG_H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, IMG_W, IMG_H);
  // glyph texture, same glyphs and colours as the game (window 0's keep-out
  // mask is close enough for a still overview)
  const keep = grassKeepOut(0);
  ctx.font = `${CELL_H}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let last = -1;
  for (let y = 0; y < GROUND_H; y++) {
    const kt = Math.floor(y / TILE_LN) * MAP_W;
    for (let x = 0; x < GROUND_W; x++) {
      const i = y * GROUND_W + x;
      const g = f.glyph[i];
      if (!g) continue;
      if (f.kind[i] !== KIND_WATER && keep[kt + Math.floor(x / TILE_CH)]) continue;
      if (f.color[i] !== last) {
        last = f.color[i];
        ctx.fillStyle = hexOf(last);
      }
      ctx.fillText(GLYPHS[g], (x + 0.5) * CELL_W, (y + 0.5) * CELL_H);
    }
  }
  return (terrainCache = c);
}

// Entity sprites as coloured cells. A sprite drawn with `scale` k covers
// (cols*k x rows*k) cells starting at its tile's top-left — the same visual
// box App.tsx gives it (scaled about its bottom-centre, offsets cancelling).
function drawEntities(ctx: CanvasRenderingContext2D, ents: Ent[]) {
  for (const e of ents) {
    if (e.kind === 'hotspot' || e.kind === 'blocker' || e.kind === 'cat') continue;
    const k = e.scale ?? 1;
    const w = Math.max(1, k * CELL_W);
    const h = Math.max(1, k * CELL_H);
    const ox = e.x * TILE_CH * CELL_W;
    const oy = e.y * TILE_LN * CELL_H;
    const base = KIND_COLOR[e.kind] ?? '#d6d6d6';
    for (let r = 0; r < e.sprite.length; r++) {
      const line = e.sprite[r];
      const crow = e.colors?.[r] ?? '';
      for (let col = 0; col < line.length; col++) {
        if (line[col] === ' ') continue;
        ctx.fillStyle = (e.palette && e.palette[crow[col]]) || base;
        ctx.fillRect(ox + col * w, oy + r * h, Math.ceil(w), Math.ceil(h));
      }
    }
  }
}

// centre of an entity's visual box, in character cells
function entCentre(e: Ent): { cx: number; cy: number } {
  const k = e.scale ?? 1;
  const cols = Math.max(...e.sprite.map((l) => l.length));
  return { cx: e.x * TILE_CH + (cols * k) / 2, cy: e.y * TILE_LN + (e.sprite.length * k) / 2 };
}

function HouseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden>
      <path d="M3 11.5 12 4l9 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="10.2" y="14" width="3.6" height="6" fill="currentColor" />
    </svg>
  );
}

function ShopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden>
      <path d="M3.5 9 5 4h14l1.5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M3.5 9c0 1.7 1.3 2.8 2.9 2.8S9.2 10.7 9.2 9c0 1.7 1.3 2.8 2.8 2.8s2.8-1.1 2.8-2.8c0 1.7 1.2 2.8 2.8 2.8S20.5 10.7 20.5 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M5.5 12v8h13v-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

function Head({ c, size }: { c: MapCharacterEntry; size: number }) {
  // Big sprites (the player's face crop) use the HUD avatar's text scale
  // (6px per 104px circle) so the circle shows the face; small ones (Mitchy,
  // ~10 chars wide) are scaled to fit the circle instead of vanishing.
  const cols = Math.max(...c.sprite.map((l) => l.length));
  const fontSize = Math.max((size * 6) / 104, (size * 0.8) / (cols * 0.6));
  return (
    <div
      className="map-head"
      style={{ width: size, height: size, borderColor: c.ringColor ?? 'var(--ui-accent)', fontSize }}
    >
      <ColoredSprite sprite={c.sprite} colors={c.colors} palette={c.palette} color={c.color} />
    </div>
  );
}

export default function GameMap({
  open,
  onClose,
  characters,
  ents,
}: {
  open: boolean;
  onClose: () => void;
  characters: MapCharacterEntry[];
  ents: Ent[];
}) {
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const cam = useRef({ x: 0, y: 0 });

  // measure the viewport (the panel is responsive)
  useLayoutEffect(() => {
    if (!open) return;
    const el = vpRef.current;
    if (!el) return;
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const pxPerCell = vp.w ? (ZOOM * vp.w) / GROUND_W : 0; // horizontal
  const pxPerLine = (pxPerCell * 14) / 8.4;
  const mapW = GROUND_W * pxPerCell;
  const mapH = GROUND_H * pxPerLine;

  // draw terrain + entities whenever the map opens
  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const font = getComputedStyle(c).fontFamily || 'monospace';
    ctx.drawImage(terrainImage(font), 0, 0);
    drawEntities(ctx, [...ents, ...STRUCT_ENTS.filter((e) => e.kind === 'gardenbed')]);
  }, [open, ents]);

  const player = characters.find((c) => c.id === 'player');
  const playerPos = open && player ? player.getPos() : null;

  const clampCam = (x: number, y: number) => ({
    x: Math.max(0, Math.min(Math.max(0, mapW - vp.w), x)),
    y: Math.max(0, Math.min(Math.max(0, mapH - vp.h), y)),
  });
  const applyCam = () => {
    if (worldRef.current) worldRef.current.style.transform = `translate(${-cam.current.x}px, ${-cam.current.y}px)`;
  };

  // centre on the player when the map opens (or the panel is resized)
  useLayoutEffect(() => {
    if (!open || !pxPerCell) return;
    const p = playerPos ?? { x: GROUND_W / TILE_CH / 2, y: GROUND_H / TILE_LN / 2 };
    const cx = (p.x + PLAYER_T.wT / 2) * TILE_CH * pxPerCell;
    const cy = (p.y + PLAYER_T.hT / 2) * TILE_LN * pxPerLine;
    cam.current = clampCam(cx - vp.w / 2, cy - vp.h / 2);
    applyCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pxPerCell, vp.h]);

  // WASD / arrows pan the map camera
  useEffect(() => {
    if (!open) return;
    const held = new Set<string>();
    const dirOf: Record<string, [number, number]> = {
      w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1],
      a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (dirOf[k]) {
        e.preventDefault();
        held.add(k);
      }
    };
    const up = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (held.size) {
        let dx = 0;
        let dy = 0;
        for (const k of held) {
          dx += dirOf[k][0];
          dy += dirOf[k][1];
        }
        const len = Math.hypot(dx, dy) || 1;
        cam.current = clampCam(
          cam.current.x + (dx / len) * PAN_SPEED * dt,
          cam.current.y + (dy / len) * PAN_SPEED * dt,
        );
        applyCam();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapW, mapH, vp.w, vp.h]);

  const landmarks = useMemo(() => {
    const house = ents.find((e) => e.kind === 'house' && e.id === 'house');
    const shop = ents.find((e) => e.kind === 'shop');
    return { house: house && entCentre(house), shop: shop && entCentre(shop) };
  }, [ents]);

  if (!open) return null;

  const mitchy = characters.find((c) => c.id === 'cat');
  const heads = characters
    .map((c) => {
      const pos = c.getPos();
      if (!pos) return null;
      // player: its tile box; Mitchy: his sprite (getPos returns his entity)
      const cx = c.id === 'player' ? (pos.x + PLAYER_T.wT / 2) * TILE_CH : pos.x * TILE_CH + 5;
      const cy = c.id === 'player' ? (pos.y + PLAYER_T.hT / 2) * TILE_LN : pos.y * TILE_LN + 2;
      return { c, left: cx * pxPerCell, top: cy * pxPerLine };
    })
    .filter(Boolean) as { c: MapCharacterEntry; left: number; top: number }[];

  return (
    <div className="game-map-overlay" onClick={onClose}>
      <div className="panel game-map-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">Map</div>
        <button className="panel-close" onClick={onClose} aria-label="close map">
          &#215;
        </button>
        <div className="game-map-viewport" ref={vpRef}>
          <div className="game-map-world" ref={worldRef} style={{ width: mapW, height: mapH }}>
            <canvas ref={canvasRef} width={IMG_W} height={IMG_H} className="game-map-canvas" />
            {landmarks.house && (
              <div
                className="map-icon house"
                title="House"
                style={{ left: landmarks.house.cx * pxPerCell, top: landmarks.house.cy * pxPerLine, width: ICON_PX, height: ICON_PX }}
              >
                <HouseIcon />
              </div>
            )}
            {landmarks.shop && (
              <div
                className="map-icon shop"
                title="Shop"
                style={{ left: landmarks.shop.cx * pxPerCell, top: landmarks.shop.cy * pxPerLine, width: ICON_PX, height: ICON_PX }}
              >
                <ShopIcon />
              </div>
            )}
            {heads.map(({ c, left, top }) => (
              <div key={c.id} className="map-marker" title={c.name} style={{ left, top }}>
                <Head c={c} size={c.id === 'player' ? HEAD_PX + 8 : HEAD_PX} />
              </div>
            ))}
          </div>

          <div className="game-map-legend" onClick={(e) => e.stopPropagation()}>
            {player && (
              <div className="legend-row">
                <Head c={player} size={24} />
                <span>{player.name}</span>
              </div>
            )}
            {mitchy && (
              <div className="legend-row">
                <Head c={mitchy} size={24} />
                <span>{mitchy.name}</span>
              </div>
            )}
            <div className="legend-row">
              <div className="map-icon house legend" style={{ width: 24, height: 24 }}>
                <HouseIcon />
              </div>
              <span>House</span>
            </div>
            <div className="legend-row">
              <div className="map-icon shop legend" style={{ width: 24, height: 24 }}>
                <ShopIcon />
              </div>
              <span>Shop</span>
            </div>
          </div>
        </div>
        <div className="hint">[WASD] move the map · [M] or [Esc] to close</div>
      </div>
    </div>
  );
}
