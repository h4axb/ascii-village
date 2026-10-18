// The "M" map overlay: a still picture of the ACTUAL world, fully zoomed
// out so the whole map shows at once (no panning).
//
//   1. TERRAIN: the same colour mosaic + glyphs the game draws (terrain.ts)
//      - no caustics, foam or other animation.
//   2. ENTITIES: every world sprite - house, shop, palms, pond, garden, flora,
//      placed items - drawn with its own glyphs and colours, exactly as in
//      game, and the player and Mitchy in their in-world look.
//   Both are painted each time the map opens, at the resolution the screen
//   shows them, and freed again when it closes.
//   3. ARROWS: a bobbing arrow with the name above the player and Mitchy, so
//      they're easy to find on the zoomed-out picture.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { darken } from './ColoredSprite';
import { GROUND_W, GROUND_H, TILE_CH, TILE_LN, STRUCT_ENTS, grassKeepOut, footprint } from './world';
import type { Ent } from './world';
import { terrainField, GLYPHS, KIND_WATER, KIND_ROCK } from './terrain';
import { IconClose } from './ui';
import { themeColor } from './theme';
import { WORLD_ASPECT } from './font';

export interface MapCharacterEntry {
  id: string;
  name: string;
  getPos: () => { x: number; y: number } | null; // tile units; null = hidden
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string; // base colour for mono sprites
  solid?: boolean; // per-cell backing, as the character is drawn in the world
  eyeRow?: number; // the face's eye row, drawn dark (with solid)
  ringColor?: string; // border accent so the player/Mitchy read as distinct
  // the character as drawn in the world (full body), for the map picture
  body?: { sprite: string[]; colors?: string[]; palette?: Record<string, string>; scale: number; solid?: boolean };
}

// Map drawing resolution: px per character cell, picked to match what the
// screen shows (see pickCell) so glyphs stay crisp. The height follows the
// width in the world's proportions (font.ts WORLD_ASPECT).
const cellH = (cw: number) => cw * WORLD_ASPECT;
const pickCell = (pxPerCell: number) =>
  Math.max(4, Math.min(6, Math.ceil(pxPerCell * (window.devicePixelRatio || 1))));

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
function paintMap(c: HTMLCanvasElement, cw: number, font: string, ents: Ent[], solidIds: Set<string>) {
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
    const solid = SOLID_KINDS.has(e.kind) || solidIds.has(e.id);
    ctx.font = `${h}px ${font}`;
    for (let r = 0; r < e.sprite.length; r++) {
      const line = e.sprite[r];
      const crow = e.colors?.[r] ?? '';
      const y0 = oy + r * h;
      for (let col = 0; col < line.length; col++) {
        const g = line[col];
        if (g === ' ') continue;
        const hex = e.palette?.[crow[col]];
        const x0 = ox + col * w;
        // Zoomed out, a sprite cell is only a few pixels: a glyph that small
        // covers little of it and the sprite looks faded, so the cell is
        // filled with its colour; big cells keep their glyph
        if (w < 5) {
          ctx.fillStyle = hex ?? base;
          ctx.fillRect(x0, y0, w + 0.35, h + 0.35);
          continue;
        }
        if (solid) {
          ctx.fillStyle = darken(hex ?? rgbHex(base), 0.55);
          ctx.fillRect(x0, y0, w, h);
        }
        ctx.fillStyle = hex ?? base;
        ctx.fillText(g, x0 + w / 2, y0 + h / 2);
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

// The map's shot, in cells: the two biggest islands with a margin of sea
// (land = not water, not rocks; islands = connected land)
let HOME: { x: number; y: number; w: number; h: number } | null = null;
function homeIslands() {
  if (HOME) return HOME;
  const f = terrainField();
  const seen = new Uint8Array(GROUND_W * GROUND_H);
  const land = (i: number) => f.kind[i] !== KIND_WATER && f.kind[i] !== KIND_ROCK;
  const isles: { n: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !land(i)) continue;
    const b = { n: 0, x0: GROUND_W, y0: GROUND_H, x1: 0, y1: 0 };
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % GROUND_W, y = (j / GROUND_W) | 0;
      b.n++;
      b.x0 = Math.min(b.x0, x);
      b.x1 = Math.max(b.x1, x);
      b.y0 = Math.min(b.y0, y);
      b.y1 = Math.max(b.y1, y);
      for (const k of [j - 1, j + 1, j - GROUND_W, j + GROUND_W])
        if (k >= 0 && k < seen.length && !seen[k] && land(k) && Math.abs((k % GROUND_W) - x) <= 1) {
          seen[k] = 1;
          stack.push(k);
        }
    }
    isles.push(b);
  }
  isles.sort((a, b) => b.n - a.n);
  const top = isles.slice(0, 2);
  if (!top.length) return (HOME = { x: 0, y: 0, w: GROUND_W, h: GROUND_H });
  const x0 = Math.min(...top.map((b) => b.x0)), x1 = Math.max(...top.map((b) => b.x1));
  const y0 = Math.min(...top.map((b) => b.y0)), y1 = Math.max(...top.map((b) => b.y1));
  const mx = (x1 - x0) * 0.1, my = (y1 - y0) * 0.1;
  return (HOME = { x: x0 - mx, y: y0 - my, w: x1 - x0 + 2 * mx, h: y1 - y0 + 2 * my });
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [sea, setSea] = useState<string | null>(null); // the picture's own sea, around it

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

  // the shot: the home islands (the two biggest), framed in the viewport
  // with some sea around; the rest of the world fills what's left over
  const shot = homeIslands();
  const pxPerCell = vp.w && vp.h ? Math.min(vp.w / shot.w, vp.h / (shot.h * WORLD_ASPECT)) : 0;
  const pxPerLine = pxPerCell * WORLD_ASPECT;
  const mapW = GROUND_W * pxPerCell;
  const mapH = GROUND_H * pxPerLine;
  // centred on the shot, but never past the world's edges (no empty strip)
  const clampOff = (o: number, view: number, size: number) => (size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, o)));
  const offX = clampOff(vp.w / 2 - (shot.x + shot.w / 2) * pxPerCell, vp.w, mapW);
  const offY = clampOff(vp.h / 2 - (shot.y + shot.h / 2) * pxPerLine, vp.h, mapH);

  // the player and Mitchy as entities of the picture, in their world look
  const people = characters
    .map((c) => {
      const pos = open ? c.getPos() : null;
      return pos && c.body ? { c, pos, body: c.body } : null;
    })
    .filter(Boolean) as { c: MapCharacterEntry; pos: { x: number; y: number }; body: NonNullable<MapCharacterEntry['body']> }[];

  // draw the world whenever the map opens; hand the (large) bitmap's memory
  // back as soon as it closes
  const cell = pxPerCell ? pickCell(pxPerCell) : 0;
  useEffect(() => {
    if (!open || !cell) return;
    const c = canvasRef.current;
    if (!c) return;
    const font = getComputedStyle(c).fontFamily || 'monospace';
    const chars: Ent[] = people.map(({ c: ch, pos, body }) => ({
      id: 'map-' + ch.id,
      kind: 'decor',
      x: pos.x,
      y: pos.y,
      sprite: body.sprite,
      colors: body.colors,
      palette: body.palette,
      scale: body.scale,
      interactable: false,
    }));
    const solid = new Set(people.filter((p) => p.body.solid).map((p) => 'map-' + p.c.id));
    paintMap(c, cell, font, [...ents, ...STRUCT_ENTS.filter((e) => e.kind === 'gardenbed'), ...chars], solid);
    const px = c.getContext('2d')?.getImageData(1, Math.floor(c.height / 2), 1, 1).data;
    if (px) setSea(`rgb(${px[0]}, ${px[1]}, ${px[2]})`);
    return () => {
      c.width = 0;
      c.height = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ents, cell]);

  if (!open) return null;

  // an arrow above each character's head (the top centre of its sprite)
  const arrows = people.map(({ c, pos, body }) => {
    const cols = Math.max(...body.sprite.map((l) => l.length));
    const cx = pos.x * TILE_CH + (cols * body.scale) / 2;
    return { c, left: offX + cx * pxPerCell, top: offY + pos.y * TILE_LN * pxPerLine };
  });

  return (
    <div className="game-map-overlay" onClick={onClose}>
      <div className="ds-panel game-map-panel" role="dialog" aria-label="Map" onClick={(e) => e.stopPropagation()}>
        <div className="game-map-head">
          <div className="ds-panel-title">Map</div>
          <button className="ds-iconbtn" onClick={onClose} aria-label="close map">
            <IconClose />
          </button>
        </div>
        <div
          className="game-map-viewport"
          ref={vpRef}
          style={{ background: sea ?? themeColor('water.mapBackdrop') }}
        >
          <canvas ref={canvasRef} className="game-map-canvas" style={{ left: offX, top: offY, width: mapW, height: mapH }} />
          {arrows.map(({ c, left, top }) => (
            <div key={c.id} className="map-pin" style={{ left, top }} title={c.name}>
              <div className="map-arrow">
                <span>{c.id === 'player' ? 'You' : c.name}</span>
                <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden>
                  <path d="M2 2h16L10 12z" fill="#f2b53c" stroke="#2f3a2b" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          ))}
        </div>
        <div className="ds-panel-hint">[M] or [Esc] to close</div>
      </div>
    </div>
  );
}
