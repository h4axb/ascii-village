// The "M" map overlay: a still, zoomed-out picture of the ACTUAL world.
//
//   1. TERRAIN: the same colour mosaic + glyphs the game draws (terrain.ts)
//      — no caustics, foam or other animation.
//   2. ENTITIES: every world sprite — house, shop, palms, pond, garden, flora,
//      placed items — drawn with its own glyphs and colours, exactly as in
//      game, so the map shows the island as it is now.
//   Both are painted each time the map opens, at the resolution the screen
//   shows them, and freed again when it closes.
//   3. MARKERS: head portraits for the player and Mitchy (the HUD avatar
//      technique: a circular crop of the character sprite), icons for the
//      house and the shop, and a legend in the bottom-left corner.
//
// The view is zoomed in a little past "whole map fits", so the panel can be
// wide; WASD / arrow keys pan the map camera (App.tsx already blocks world
// movement while the map is open).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ColoredSprite, darken } from './ColoredSprite';
import { GROUND_W, GROUND_H, TILE_CH, TILE_LN, STRUCT_ENTS, PLAYER_T, MITCHY_T, grassKeepOut, footprint } from './world';
import type { Ent } from './world';
import { terrainField, GLYPHS, KIND_WATER } from './terrain';
import { IconClose } from './ui';

export interface MapCharacterEntry {
  id: string;
  name: string;
  getPos: () => { x: number; y: number } | null; // tile units; null = hidden
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string; // base colour for mono sprites
  solid?: boolean; // per-cell backing, as the character is drawn in the world
  ringColor?: string; // border accent so the player/Mitchy read as distinct
}

// Map drawing resolution: px per character cell, picked to match what the
// screen shows (see pickCell) so glyphs stay crisp. A cell is 8.4 x 14 in
// game, so the height follows the width.
const cellH = (cw: number) => (cw * 14) / 8.4;
const pickCell = (pxPerCell: number) =>
  Math.max(4, Math.min(6, Math.ceil(pxPerCell * (window.devicePixelRatio || 1))));
const ZOOM = 1.6; // how far past "whole width fits" the map is zoomed in
const PAN_SPEED = 900; // map px per second while a key is held
const HEAD_PX = 34;
const ICON_PX = 26;

// Sprites the game draws with an opaque darkened backing behind each cell
// (ColoredSprite's solidCells, and the pond canvas).
const SOLID_KINDS = new Set(['house', 'bridge', 'pond']);
const SKIP_KINDS = new Set(['hotspot', 'blocker', 'cat', 'ghost']);

const hexOf = (c: number) => '#' + c.toString(16).padStart(6, '0');

// Each kind's base colour straight from its .ent.<kind> CSS rule, so the map
// can't drift from the game's own styling.
const kindColor = new Map<string, string>();
function colorOf(kind: string): string {
  let c = kindColor.get(kind);
  if (!c) {
    const probe = document.createElement('pre');
    probe.className = `ent ${kind}`;
    probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px';
    document.body.appendChild(probe);
    c = getComputedStyle(probe).color || '#d6d6d6';
    probe.remove();
    kindColor.set(kind, c);
  }
  return c;
}

// The still world: colour mosaic + ground glyphs (terrain.ts, no caustics or
// foam), then every entity drawn as its own glyphs and colours, in the same
// back-to-front order the game stacks them.
function paintMap(c: HTMLCanvasElement, cw: number, font: string, ents: Ent[]) {
  const ch = cellH(cw);
  const f = terrainField();
  c.width = Math.round(GROUND_W * cw);
  c.height = Math.round(GROUND_H * ch);
  const ctx = c.getContext('2d');
  if (!ctx) return;
  // colour mosaic: one pixel per cell, scaled up without smoothing
  const small = document.createElement('canvas');
  small.width = f.bgW;
  small.height = f.bgH;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(f.bgW, f.bgH);
  img.data.set(f.bg);
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, c.width, c.height);
  small.width = small.height = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // ground glyphs (window 0's keep-out mask is close enough for a still map)
  const keep = grassKeepOut(0);
  ctx.font = `${ch}px ${font}`;
  let last = -1;
  for (let y = 0; y < GROUND_H; y++) {
    for (let x = 0; x < GROUND_W; x++) {
      const i = y * GROUND_W + x;
      const g = f.glyph[i];
      if (!g) continue;
      if (f.kind[i] !== KIND_WATER && keep[i]) continue;
      if (f.color[i] !== last) {
        last = f.color[i];
        ctx.fillStyle = hexOf(last);
      }
      ctx.fillText(GLYPHS[g], (x + 0.5) * cw, (y + 0.5) * ch);
    }
  }

  // entities, back to front like the game's z-index
  const z = (e: Ent) => (e.kind === 'cliff' ? -1 : e.kind === 'bridge' ? 1e6 : footprint(e).row);
  const list = ents.filter((e) => !SKIP_KINDS.has(e.kind)).sort((a, b) => z(a) - z(b));
  for (const e of list) {
    // a sprite drawn at scale k covers (cols*k x rows*k) cells from its
    // tile's top-left — the visual box App.tsx gives it
    const k = e.scale ?? 1;
    const w = k * cw;
    const h = k * ch;
    const ox = e.x * TILE_CH * cw;
    const oy = e.y * TILE_LN * ch;
    const base = colorOf(e.kind);
    const solid = SOLID_KINDS.has(e.kind);
    ctx.font = `${h}px ${font}`;
    for (let r = 0; r < e.sprite.length; r++) {
      const line = e.sprite[r];
      const crow = e.colors?.[r] ?? '';
      const y0 = Math.floor(oy + r * h);
      const y1 = Math.floor(oy + (r + 1) * h);
      for (let col = 0; col < line.length; col++) {
        const g = line[col];
        if (g === ' ') continue;
        const hex = e.palette?.[crow[col]];
        const x0 = Math.floor(ox + col * w);
        const x1 = Math.floor(ox + (col + 1) * w);
        if (solid) {
          ctx.fillStyle = darken(hex ?? rgbHex(base), 0.55);
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
        ctx.fillStyle = hex ?? base;
        ctx.fillText(g, (x0 + x1) / 2, (y0 + y1) / 2);
      }
    }
  }
}

// computed styles come back as rgb(); darken() wants #rrggbb
function rgbHex(c: string): string {
  const m = c.match(/\d+/g);
  if (!c.startsWith('rgb') || !m) return c;
  return '#' + m.slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('');
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
      <ColoredSprite sprite={c.sprite} colors={c.colors} palette={c.palette} color={c.color} solidCells={c.solid} />
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

  // draw the world whenever the map opens; hand the (large) bitmap's memory
  // back as soon as it closes
  const cell = pxPerCell ? pickCell(pxPerCell) : 0;
  useEffect(() => {
    if (!open || !cell) return;
    const c = canvasRef.current;
    if (!c) return;
    const font = getComputedStyle(c).fontFamily || 'monospace';
    paintMap(c, cell, font, [...ents, ...STRUCT_ENTS.filter((e) => e.kind === 'gardenbed')]);
    return () => {
      c.width = 0;
      c.height = 0;
    };
  }, [open, ents, cell]);

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
      // the centre of the character's tile box (getPos returns Mitchy's entity)
      const t = c.id === 'player' ? PLAYER_T : MITCHY_T;
      const cx = (pos.x + t.wT / 2) * TILE_CH;
      const cy = (pos.y + t.hT / 2) * TILE_LN;
      return { c, left: cx * pxPerCell, top: cy * pxPerLine };
    })
    .filter(Boolean) as { c: MapCharacterEntry; left: number; top: number }[];

  return (
    <div className="game-map-overlay" onClick={onClose}>
      <div className="ds-panel game-map-panel" role="dialog" aria-label="Map" onClick={(e) => e.stopPropagation()}>
        <div className="game-map-head">
          <div className="ds-panel-title">Map</div>
          <button className="ds-iconbtn" onClick={onClose} aria-label="close map">
            <IconClose />
          </button>
        </div>
        <div className="game-map-viewport" ref={vpRef}>
          <div className="game-map-world" ref={worldRef} style={{ width: mapW, height: mapH }}>
            <canvas ref={canvasRef} className="game-map-canvas" />
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
        <div className="ds-panel-hint">[WASD] move the map · [M] or [Esc] to close</div>
      </div>
    </div>
  );
}
