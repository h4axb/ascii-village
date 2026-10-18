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
import { terrainField, GLYPHS, KIND_WATER } from './terrain';
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

  // fully zoomed out: the whole world fits the viewport, centred
  const pxPerCell = vp.w && vp.h ? Math.min(vp.w / GROUND_W, vp.h / (GROUND_H * WORLD_ASPECT)) : 0;
  const pxPerLine = pxPerCell * WORLD_ASPECT;
  const mapW = GROUND_W * pxPerCell;
  const mapH = GROUND_H * pxPerLine;
  const offX = (vp.w - mapW) / 2;
  const offY = (vp.h - mapH) / 2;

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
          style={{ background: sea ?? themeColor('water.mapBackdrop'), aspectRatio: `${GROUND_W} / ${GROUND_H * WORLD_ASPECT}` }}
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
