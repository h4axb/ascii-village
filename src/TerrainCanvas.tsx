// Draws terrain.ts's field — replaces the old stack of full-map <pre> text
// layers (land bands, ocean lattice, caustics, shore foam), which made the
// browser re-rasterise ~400k characters on every animation tick.
//
// Three layers, all inside .world so they share the camera transform:
//   1. COLOUR: one small canvas, one pixel per square block (terrain.ts
//      samples the colour on a grid of square blocks), stretched so every
//      block is solid (the mosaic look) — crisp blocks when
//      zoomed in, smoothed when zoomed far out so it doesn't shimmer.
//   2. GLYPHS: canvas tiles (TW x TH chars) drawn lazily for what's near the
//      viewport, at the resolution the screen actually shows them (field
//      scale x zoom x devicePixelRatio), and dropped again once far away.
//   3. MOTION: one overlay canvas covering just the visible area, redrawn
//      every OCEAN_CFG.driftMs with the caustics and shore foam in view.
import { useEffect, useRef } from 'react';
import { GROUND_W, GROUND_H, grassKeepOut, OCEAN_CFG } from './world';
import {
  terrainField,
  GLYPHS,
  KIND_WATER,
  forEachCaustic,
  forEachFoam,
  onTerrainRegion,
  CAUSTIC_ALPHA,
  SHORE_PHASES,
} from './terrain';
import { themeColor } from './theme';

const TW = 64; // tile width, chars
const TH = 32; // tile height, lines
const TILES_X = Math.ceil(GROUND_W / TW);
const TILES_Y = Math.ceil(GROUND_H / TH);
// Capped at 2x: a 3x tile is ~2.3x the memory for no visible gain on ground
// texture, and GPU memory pressure is what makes browsers drop canvases.
const RES_STEPS = [0.5, 0.75, 1, 1.5, 2];
const bucket = (r: number) => RES_STEPS.find((s) => s >= r * 0.92) ?? 2;

// Browsers may silently wipe a canvas's pixels under GPU memory pressure
// ("context lost"). Chrome 99+ exposes it on the 2D context; older engines
// just never report it.
const isLost = (ctx: CanvasRenderingContext2D | null) =>
  !ctx || !!(ctx as unknown as { isContextLost?: () => boolean }).isContextLost?.();

// Detach a tile AND hand its pixel memory back now. A removed canvas keeps
// its backing store until garbage collection; Safari (and Chrome under GPU
// pressure) counts that against a total canvas budget and, once over it,
// renders new canvases blank — glyphs "vanish" after a minute of walking.
const freeCanvas = (el: HTMLCanvasElement) => {
  el.remove();
  el.width = 0;
  el.height = 0;
};
const FOAM_TICKS = 2; // foam advances one phase every 2 caustic ticks
const MAX_CAUSTIC_CELLS = 90_000; // zoomed far out the shimmer is invisible anyway

const cssCache = new Map<number, string>();
const css = (c: number) => {
  let s = cssCache.get(c);
  if (!s) cssCache.set(c, (s = '#' + c.toString(16).padStart(6, '0')));
  return s;
};

interface Props {
  camX: number;
  camY: number;
  viewW: number;
  viewH: number;
  zoom: number;
  scale: number; // the field's CSS scale (see dims in App.tsx)
  charW: number;
  lineH: number;
  growthWindow: number;
  // Bumped by the world editor after it moves structures: the ground glyphs
  // around them are repainted (see resetTerrainStructs in terrain.ts).
  structKey?: number;
}

export default function TerrainCanvas(props: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const st = useRef({
    props,
    tiles: new Map<number, { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D; res: number }>(),
    queue: [] as number[],
    raf: 0,
    keep: null as Uint8Array | null,
    font: 'monospace',
    tick: 0,
  });
  st.current.props = props;

  // 1. colour layer — painted once, and again if the browser ever wipes it
  function paintBg() {
    const c = bgRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const f = terrainField();
    c.width = f.bgW;
    c.height = f.bgH;
    const img = ctx.createImageData(f.bgW, f.bgH);
    img.data.set(f.bg);
    ctx.putImageData(img, 0, 0);
  }
  useEffect(() => {
    paintBg();
    const c = bgRef.current;
    c?.addEventListener('contextrestored', paintBg);
    return () => c?.removeEventListener('contextrestored', paintBg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a ground-paint stroke (terrain.ts onTerrainRegion): repaint that part of
  // the colour layer and redraw the glyph tiles it touches
  useEffect(
    () =>
      onTerrainRegion((x0, y0, x1, y1) => {
        const c = bgRef.current;
        const ctx = c?.getContext('2d');
        const f = terrainField();
        if (c && ctx && c.width === f.bgW) {
          const by0 = Math.max(0, Math.floor((y0 * f.bgH) / GROUND_H) - 2);
          const by1 = Math.min(f.bgH - 1, Math.ceil(((y1 + 1) * f.bgH) / GROUND_H) + 2);
          const w = x1 - x0 + 1;
          const h = by1 - by0 + 1;
          const img = ctx.createImageData(w, h);
          for (let r = 0; r < h; r++) {
            const from = ((by0 + r) * f.bgW + x0) * 4;
            img.data.set(f.bg.subarray(from, from + w * 4), r * w * 4);
          }
          ctx.putImageData(img, x0, by0);
        }
        const s = st.current;
        for (const [ti, t] of s.tiles) {
          const tx = (ti % TILES_X) * TW;
          const ty = ((ti / TILES_X) | 0) * TH;
          if (tx <= x1 && tx + TW > x0 && ty <= y1 && ty + TH > y0) t.res = -1;
        }
        schedule();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // font of the world text, so canvas glyphs match the DOM sprites
  useEffect(() => {
    if (rootRef.current) st.current.font = getComputedStyle(rootRef.current).fontFamily || 'monospace';
  }, []);

  // grass must stay clear of the wild flora, which moves every growth window
  // (and of the structures, which move while the world editor is open)
  const firstStructKey = useRef(props.structKey);
  useEffect(() => {
    const s = st.current;
    if (props.structKey !== firstStructKey.current) paintBg();
    s.keep = grassKeepOut(props.growthWindow);
    for (const t of s.tiles.values()) freeCanvas(t.el);
    s.tiles.clear();
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.growthWindow, props.structKey]);

  function drawTile(ti: number, res: number) {
    const s = st.current;
    const { charW, lineH } = s.props;
    const f = terrainField();
    const tx = ti % TILES_X;
    const ty = (ti / TILES_X) | 0;
    const x0 = tx * TW;
    const y0 = ty * TH;
    const x1 = Math.min(GROUND_W, x0 + TW);
    const y1 = Math.min(GROUND_H, y0 + TH);
    const el = document.createElement('canvas');
    el.width = Math.ceil((x1 - x0) * charW * res);
    el.height = Math.ceil((y1 - y0) * lineH * res);
    el.style.cssText = `position:absolute;left:${x0}ch;top:${y0}em;width:${x1 - x0}ch;height:${y1 - y0}em;pointer-events:none`;
    const ctx = el.getContext('2d');
    if (!ctx) {
      el.width = el.height = 0;
      return;
    }
    ctx.scale(res, res);
    ctx.font = `${lineH}px ${s.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const keep = s.keep;
    let last = -1;
    for (let y = y0; y < y1; y++) {
      const row = y * GROUND_W;
      for (let x = x0; x < x1; x++) {
        const i = row + x;
        const g = f.glyph[i];
        if (!g) continue;
        if (keep && f.kind[i] !== KIND_WATER && keep[i]) continue;
        const c = f.color[i];
        if (c !== last) {
          ctx.fillStyle = css(c);
          last = c;
        }
        ctx.fillText(GLYPHS[g], (x - x0 + 0.5) * charW, (y - y0 + 0.5) * lineH);
      }
    }
    // a wiped tile gets redrawn (res -1 forces it back into the queue)
    const onLost = () => {
      const t = st.current.tiles.get(ti);
      if (t && t.el === el) t.res = -1;
    };
    el.addEventListener('contextlost', onLost);
    el.addEventListener('contextrestored', () => {
      onLost();
      schedule();
    });
    const old = s.tiles.get(ti);
    if (old) {
      old.el.replaceWith(el);
      old.el.width = 0;
      old.el.height = 0;
    } else tilesRef.current?.appendChild(el);
    s.tiles.set(ti, { el, ctx, res });
  }

  function currentRes() {
    const p = st.current.props;
    return bucket(p.scale * p.zoom * (window.devicePixelRatio || 1));
  }

  function schedule() {
    const s = st.current;
    const { camX, camY, viewW, viewH } = s.props;
    const res = currentRes();
    const cx = camX + viewW / 2;
    const cy = camY + viewH / 2;
    const tx0 = Math.max(0, Math.floor((camX - TW / 2) / TW));
    const tx1 = Math.min(TILES_X - 1, Math.floor((camX + viewW + TW / 2) / TW));
    const ty0 = Math.max(0, Math.floor((camY - TH / 2) / TH));
    const ty1 = Math.min(TILES_Y - 1, Math.floor((camY + viewH + TH / 2) / TH));
    const want: number[] = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const ti = ty * TILES_X + tx;
        const t = s.tiles.get(ti);
        if (!t || t.res !== res || isLost(t.ctx)) want.push(ti);
      }
    }
    // nearest to the screen centre first
    const dist = (ti: number) => {
      const x = ((ti % TILES_X) + 0.5) * TW - cx;
      const y = (((ti / TILES_X) | 0) + 0.5) * TH - cy;
      return x * x + y * y * 2.8;
    };
    s.queue = want.sort((a, b) => dist(a) - dist(b));
    // free tiles well outside the view
    for (const [ti, t] of s.tiles) {
      const tx = ti % TILES_X;
      const ty = (ti / TILES_X) | 0;
      // one ring of slack only: kept tiles are what fills GPU memory
      if (tx < tx0 - 1 || tx > tx1 + 1 || ty < ty0 - 1 || ty > ty1 + 1) {
        freeCanvas(t.el);
        s.tiles.delete(ti);
      }
    }
    if (!s.raf && s.queue.length) s.raf = requestAnimationFrame(work);
  }

  function work() {
    const s = st.current;
    s.raf = 0;
    const res = currentRes();
    const start = performance.now();
    while (s.queue.length && performance.now() - start < 8) drawTile(s.queue.shift()!, res);
    if (s.queue.length) s.raf = requestAnimationFrame(work);
  }

  // 2. glyph tiles follow the camera
  useEffect(() => {
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.camX, props.camY, props.viewW, props.viewH, props.zoom, props.scale, props.charW, props.lineH]);

  // Watchdog: not every engine fires 'contextlost', so every 2s re-check
  // that the colour layer and the visible tiles still have their pixels.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (isLost(bgRef.current?.getContext('2d') ?? null)) paintBg();
      schedule();
    }, 2000);
    return () => {
      window.clearInterval(iv);
      if (st.current.raf) cancelAnimationFrame(st.current.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. motion overlay
  useEffect(() => {
    const draw = () => {
      const s = st.current;
      const c = ovRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const { camX, camY, viewW, viewH, charW, lineH } = s.props;
      const m = 0.15; // slack so the edge never pops in while the camera glides
      const x0 = Math.max(0, Math.floor(camX - viewW * m));
      const y0 = Math.max(0, Math.floor(camY - viewH * m));
      const x1 = Math.min(GROUND_W, Math.ceil(camX + viewW * (1 + m)));
      const y1 = Math.min(GROUND_H, Math.ceil(camY + viewH * (1 + m)));
      const res = Math.min(2, currentRes());
      const w = Math.ceil((x1 - x0) * charW * res);
      const h = Math.ceil((y1 - y0) * lineH * res);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      } else ctx.clearRect(0, 0, w, h);
      // positioned by transform on its own layer, and only restyled when
      // the box actually moves: left/top changes re-ran layout and repainted
      // the world around it on every redraw
      const box = `${x0},${y0},${x1},${y1}`;
      if (c.dataset.box !== box) {
        c.dataset.box = box;
        c.style.transform = `translate(${x0}ch, ${y0}em)`;
        c.style.width = `${x1 - x0}ch`;
        c.style.height = `${y1 - y0}em`;
      }
      ctx.setTransform(res, 0, 0, res, -x0 * charW * res, -y0 * lineH * res);
      ctx.font = `${lineH}px ${s.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if ((x1 - x0) * (y1 - y0) <= MAX_CAUSTIC_CELLS) {
        ctx.fillStyle = themeColor('water.sparkle');
        forEachCaustic(s.tick, x0, y0, x1, y1, (x, y, tier, g) => {
          ctx.globalAlpha = CAUSTIC_ALPHA[tier];
          ctx.fillText(g, (x + 0.5) * charW, (y + 0.5) * lineH);
        });
      }
      const phase = Math.floor(s.tick / FOAM_TICKS) % SHORE_PHASES;
      forEachFoam(phase, x0, y0, x1, y1, (x, y, g, a, wet) => {
        if (wet > 0) {
          ctx.globalAlpha = Math.min(1, wet * 4);
          ctx.fillStyle = themeColor('sand.wetGrain');
          ctx.fillText(y % 2 ? ',' : '.', (x + 0.5) * charW, (y + 0.5) * lineH);
        } else {
          ctx.globalAlpha = a;
          ctx.fillStyle = themeColor('water.foam');
          ctx.fillText(g, (x + 0.5) * charW, (y + 0.5) * lineH);
        }
      });
      ctx.globalAlpha = 1;
    };
    draw();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const iv = window.setInterval(() => {
      st.current.tick++;
      draw();
    }, OCEAN_CFG.driftMs);
    return () => window.clearInterval(iv);
  }, []);

  return (
    <div ref={rootRef} className="terrain" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <canvas
        ref={bgRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${GROUND_W}ch`,
          height: `${GROUND_H}em`,
          // a cell wider than ~3 screen px reads as a block; below that,
          // nearest-neighbour sampling would shimmer while the camera moves
          imageRendering: props.charW * props.scale * props.zoom > 3 ? 'pixelated' : 'auto',
        }}
      />
      <div ref={tilesRef} style={{ position: 'absolute', inset: 0 }} />
      <canvas ref={ovRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', willChange: 'transform' }} />
    </div>
  );
}
