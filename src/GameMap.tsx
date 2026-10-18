// The "M" map overlay: the whole island at once as an illustrated map
// (mapArt.ts: parchment, sea, coasts, trees, buildings, compass), drawn from
// the real terrain and entities. The player and Mitchy stand on it as little
// drawn characters, each with a bobbing arrow above so they're easy to spot.
// No panning: the map always fits the panel.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STRUCT_ENTS, PLAYER_T, MITCHY_T } from './world';
import type { Ent } from './world';
import { IconClose } from './ui';
import { paintMapArt, mapPoint, type MapView } from './mapArt';

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
}

// the player, drawn in the map's style: red hair, straw hat, blue top
function PlayerFigure() {
  return (
    <svg viewBox="0 0 24 30" width="34" height="42" aria-hidden>
      <ellipse cx="12" cy="28.5" rx="7" ry="1.8" fill="rgba(47,58,43,.28)" />
      <path d="M7 21h10l1 6H6z" fill="#4f86c6" stroke="#2f3a2b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5 14c0-5 3-8 7-8s7 3 7 8v6c-1 1-2 1-3 0v-3H8v3c-1 1-2 1-3 0z" fill="#d9483b" stroke="#2f3a2b" strokeWidth="1.2" strokeLinejoin="round" />
      <ellipse cx="12" cy="15" rx="5" ry="5.2" fill="#f6d2b5" stroke="#2f3a2b" strokeWidth="1.2" />
      <circle cx="10" cy="15.5" r=".9" fill="#2f3a2b" />
      <circle cx="14" cy="15.5" r=".9" fill="#2f3a2b" />
      <circle cx="9" cy="17.3" r="1" fill="#f4a3a3" />
      <circle cx="15" cy="17.3" r="1" fill="#f4a3a3" />
      <ellipse cx="12" cy="9.5" rx="10" ry="2.6" fill="#e9c46a" stroke="#2f3a2b" strokeWidth="1.2" />
      <path d="M7.5 9.5c0-3 2-5 4.5-5s4.5 2 4.5 5z" fill="#e9c46a" stroke="#2f3a2b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M7.6 8.6h8.8" stroke="#d9483b" strokeWidth="1.3" />
    </svg>
  );
}

// Mitchy: a little brown tabby with round glasses
function MitchyFigure() {
  return (
    <svg viewBox="0 0 24 26" width="34" height="37" aria-hidden>
      <ellipse cx="12" cy="24.5" rx="7" ry="1.6" fill="rgba(47,58,43,.28)" />
      <path d="M19 19c3 0 3-4 1-5" fill="none" stroke="#2f3a2b" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M19 19c3 0 3-4 1-5" fill="none" stroke="#a87449" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 24v-6c0-3 3-5 6-5s6 2 6 5v6z" fill="#a87449" stroke="#2f3a2b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M4.5 7 6 2.5l4 3.2M19.5 7 18 2.5l-4 3.2" fill="#a87449" stroke="#2f3a2b" strokeWidth="1.2" strokeLinejoin="round" />
      <ellipse cx="12" cy="10" rx="7.6" ry="6.4" fill="#a87449" stroke="#2f3a2b" strokeWidth="1.2" />
      <path d="M9 5.2v2M12 4.6v2.2M15 5.2v2" stroke="#7a4f2d" strokeWidth="1" strokeLinecap="round" />
      <circle cx="9" cy="10" r="2.1" fill="#f6ecd6" stroke="#2f3a2b" strokeWidth="1" />
      <circle cx="15" cy="10" r="2.1" fill="#f6ecd6" stroke="#2f3a2b" strokeWidth="1" />
      <path d="M11.1 10h1.8" stroke="#2f3a2b" strokeWidth="1" />
      <circle cx="9" cy="10.2" r=".8" fill="#2f3a2b" />
      <circle cx="15" cy="10.2" r=".8" fill="#2f3a2b" />
      <path d="M11 13.2 12 14l1-.8" fill="none" stroke="#2f3a2b" strokeWidth=".9" strokeLinecap="round" />
    </svg>
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<MapView | null>(null);

  // measure the map area (the panel is responsive)
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

  // draw the map whenever it opens (or the panel changes size); hand the
  // bitmap's memory back as soon as it closes
  useEffect(() => {
    if (!open || !vp.w || !vp.h) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const v = paintMapArt(c, Math.round(vp.w * dpr), Math.round(vp.h * dpr), [
      ...ents,
      ...STRUCT_ENTS.filter((e) => e.kind === 'gardenbed'),
    ]);
    setView({ ...v, ox: v.ox / dpr, oy: v.oy / dpr, sx: v.sx / dpr, sy: v.sy / dpr, w: vp.w, h: vp.h });
    return () => {
      c.width = 0;
      c.height = 0;
    };
  }, [open, ents, vp.w, vp.h]);

  if (!open) return null;

  const people = view
    ? characters
        .map((c) => {
          const pos = c.getPos();
          if (!pos) return null;
          const t = c.id === 'player' ? PLAYER_T : MITCHY_T;
          // their feet: the bottom centre of the character's tile box
          const p = mapPoint(view, pos.x + t.wT / 2, pos.y + t.hT);
          return { c, ...p };
        })
        .filter(Boolean)
    : [];

  return (
    <div className="game-map-overlay" onClick={onClose}>
      <div className="ds-panel game-map-panel" role="dialog" aria-label="Map" onClick={(e) => e.stopPropagation()}>
        <div className="game-map-head">
          <div className="ds-panel-title">Map</div>
          <button className="ds-iconbtn" onClick={onClose} aria-label="close map">
            <IconClose />
          </button>
        </div>
        <div className="game-map-viewport art" ref={vpRef}>
          <canvas ref={canvasRef} className="game-map-canvas" style={{ width: vp.w, height: vp.h }} />
          {people.map((p) => (
            <div key={p!.c.id} className={'map-char ' + p!.c.id} style={{ left: p!.x, top: p!.y }} title={p!.c.name}>
              <div className="map-arrow">
                <span>{p!.c.id === 'player' ? 'You' : p!.c.name}</span>
                <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden>
                  <path d="M2 2h16L10 12z" fill="#f2b53c" stroke="#2f3a2b" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </div>
              {p!.c.id === 'player' ? <PlayerFigure /> : <MitchyFigure />}
            </div>
          ))}
        </div>
        <div className="ds-panel-hint">[M] or [Esc] to close</div>
      </div>
    </div>
  );
}
