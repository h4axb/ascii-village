// ---------------------------------------------------------------------------
// THE INTRO CINEMATIC (about 23 s): six rejection emails pile up on the
// laptop -> three phrases are left in the dark -> their letters fall apart
// and gather into four water drops -> the drops land and ripple -> the water
// pours a glyph door, which opens onto the island -> into the door -> the
// wake-up scene (App.tsx's runIntro) takes over.
//
// One clock drives everything: `apply(t)` puts every layer where it belongs
// at time t (ms), from config.ts's timeline. No scattered timers, so the dev
// timeline can jump to a shot, scrub, pause, slow down or replay one shot,
// and Skip just stops the clock. The per-frame work only writes transforms,
// opacities and a few colours on elements rendered once.
//
// Layers, back to front:
//   stage    the reference photo (scaled to cover), the room glow, a black
//            fade, and the laptop screen with the HTML email windows
//   scene    the glyph canvas (scene.ts): drops, ripples, the liquid that
//            pours the door, the door opening onto the island, sand, puddles,
//            plants, and the zoom into the doorway
//   overlay  the falling letters (copies placed exactly over the email's own
//            letters at the moment they come loose), until they become drops
// The real game already runs underneath with the player at PLAYER START: the
// canvas fades out at the end of the zoom and hands straight over to it.
// ---------------------------------------------------------------------------
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CINEMATIC_BG,
  STAGE_W,
  STAGE_H,
  SCREEN,
  T,
  ENTER_MS,
  ZOOM,
  LETTERS,
  SCENE,
  SHOT_LIST,
  clamp01,
  lerp,
  span,
  easeOutCubic,
  easeInOutCubic,
  rand,
} from './config';
import { EMAILS, WINDOWS, FLASH, type WindowShot } from './emails';
import { GlyphCanvas } from './glyphCanvas';
import { buildScene, renderScene, type DropSeed, type Scene } from './scene';
import './cinematic.css';

export type IntroCinematicHandle = { skip: () => void };

// ---- the surviving phrases, parsed from the last email -----------------------------
interface Letter {
  ch: string;
  dot: boolean; // one of the "..." added to "Unfortunately"
}
const FINAL = WINDOWS.findIndex((w) => w.final);
const LETTER_LIST: Letter[] = (() => {
  const out: Letter[] = [];
  const e = EMAILS[WINDOWS[FINAL].email];
  for (const s of [e.subject, ...e.body])
    for (const m of s.matchAll(/\[([^\]]+)\]/g)) {
      for (const ch of m[1]) if (ch !== ' ') out.push({ ch, dot: false });
      if (m[1] === 'Unfortunately') for (let i = 0; i < 3; i++) out.push({ ch: '.', dot: true });
    }
  return out;
})();
const N = LETTER_LIST.length;

// the rich text of a line: *emphasis*, [phrase] (final window only)
function Rich({ text, final, next }: { text: string; final: boolean; next: () => number }) {
  const parts: ReactNode[] = [];
  const re = /(\*[^*]+\*|\[[^\]]+\])/g;
  let last = 0, key = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(<span key={key++} className="cin-fade">{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok[0] === '*') parts.push(<mark key={key++} className="cin-em cin-fade">{tok.slice(1, -1)}</mark>);
    else if (final) {
      const word = tok.slice(1, -1);
      parts.push(
        <span key={key++} className="cin-kw">
          {[...word].map((ch, i) => (ch === ' ' ? ' ' : <span key={i} className="cin-ch" data-k={next()}>{ch}</span>))}
          {word === 'Unfortunately' && (
            <span className="cin-dots">
              {[0, 1, 2].map((i) => (
                <span key={i} className="cin-ch" data-k={next()}>.</span>
              ))}
            </span>
          )}
        </span>,
      );
    } else parts.push(<span key={key++}>{tok.slice(1, -1)}</span>);
    last = m.index! + tok.length;
  }
  if (last < text.length) parts.push(<span key={key++} className="cin-fade">{text.slice(last)}</span>);
  return <>{parts}</>;
}

const APP_NAME = { standard: 'Mail', portal: 'Careers Portal · Application Status', stacked: 'Inbox — 1 new message' } as const;

function EmailWindow({ w, final, next, winRef }: { w: WindowShot; final: boolean; next: () => number; winRef: (el: HTMLDivElement | null) => void }) {
  const e = EMAILS[w.email];
  return (
    <div ref={winRef} className={`cin-win cin-${w.variant}${final ? ' final' : ''}`} style={{ left: `${w.left}%`, top: `${w.top}%`, width: `${w.width}%` }}>
      <div className="cin-win-bg" />
      <div className="cin-win-in">
        <div className="cin-titlebar cin-fade">
          <i />
          <i />
          <i />
          <span>{APP_NAME[w.variant]}</span>
        </div>
        <div className="cin-head">
          <div className="cin-from cin-fade">
            <span>From</span> {e.from}
          </div>
          <div className="cin-subject">
            {!final && <span className="cin-fade">Subject: </span>}
            <Rich text={e.subject} final={final} next={next} />
          </div>
        </div>
        <div className="cin-text">
          {e.body.map((p, i) => (
            <p key={i}>
              <Rich text={p} final={final} next={next} />
            </p>
          ))}
          <p className="cin-sign cin-fade">
            {e.sign.map((l, i) => (
              <span key={i}>
                {l}
                <br />
              </span>
            ))}
          </p>
        </div>
        <div className="cin-actions cin-fade">
          <span>Reply</span>
          <span>Archive</span>
        </div>
      </div>
      <div className="cin-win-dim" />
    </div>
  );
}

// ---- colour helpers ------------------------------------------------------------------------
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, k: number) => {
  const x = hexRgb(a), y = hexRgb(b);
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], k))).join(',')})`;
};

// ---- the per-letter plan, fixed once the letters have been measured --------------------
interface Plan {
  x0: number; // centre where the letter came loose (viewport px)
  y0: number;
  w: number;
  h: number;
  delay: number;
  vx: number;
  spin: number;
  phase: number;
  group: number; // which of the drops it joins
  ox: number; // its place in the gathering group, px
  oy: number;
}
interface Measured {
  vw: number;
  vh: number;
  font: { size: number; family: string; weight: string; spacing: string }[];
  plan: Plan[];
  scene: Scene;
}

export default forwardRef<
  IntroCinematicHandle,
  { onComplete: () => void; devTimeline?: boolean; startAt?: number }
>(function IntroCinematic({ onComplete, devTimeline = false, startAt = 0 }, ref) {
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glyphs = useRef<GlyphCanvas | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const winRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cloneRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const timeRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const clock = useRef({ t: startAt, playing: false, speed: 1, stopAt: null as number | null, holdEnd: false, done: false, dirty: true });
  const measured = useRef<Measured | null>(null);
  const [playing, setPlaying] = useState(false);
  const [shot, setShot] = useState(SHOT_LIST[0].id);
  const [speed, setSpeed] = useState(1);
  const [holdEnd, setHoldEnd] = useState(false);
  const [shotOnly, setShotOnly] = useState(false);
  const [barOpen, setBarOpen] = useState(true);
  const shotRef = useRef(shot);


  // ---- geometry -------------------------------------------------------------------------
  const cover = (vw: number, vh: number) => {
    const s = Math.max(vw / STAGE_W, vh / STAGE_H);
    return { s, ox: (vw - STAGE_W * s) / 2, oy: (vh - STAGE_H * s) / 2 };
  };
  // the stage transform at time t: cover, then the push-in on the last email
  const finalWin = WINDOWS[FINAL];
  const focus = { x: SCREEN.x + (SCREEN.w * (finalWin.left + finalWin.width / 2)) / 100, y: SCREEN.y + SCREEN.h * ((finalWin.top + 26) / 100) };
  function stageTransform(t: number, vw: number, vh: number) {
    const { s, ox, oy } = cover(vw, vh);
    const k = reduced ? 0 : easeInOutCubic(clamp01((t - T.zoom[0]) / (T.zoom[1] - T.zoom[0])));
    const S = s * lerp(1, ZOOM, k);
    const q0 = { x: (vw / 2 - ox) / s, y: (vh / 2 - oy) / s };
    const q = { x: lerp(q0.x, focus.x, k), y: lerp(q0.y, focus.y, k) };
    return { S, x: vw / 2 - q.x * S, y: vh / 2 - q.y * S };
  }

  // ---- measuring the letters where they come loose ------------------------------------------
  function measure(): Measured {
    const vw = window.innerWidth, vh = window.innerHeight;
    applyStage(T.fall - 1, vw, vh); // the layout the letters leave from
    const root = rootRef.current!;
    const plan: Plan[] = [];
    const font: Measured['font'] = [];
    const { S } = stageTransform(T.fall - 1, vw, vh);
    for (let k = 0; k < N; k++) {
      const el = root.querySelector<HTMLElement>(`.cin-ch[data-k="${k}"]`)!;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      font.push({
        size: parseFloat(cs.fontSize) * S,
        family: cs.fontFamily,
        weight: cs.fontWeight,
        spacing: cs.letterSpacing === 'normal' ? 'normal' : `${parseFloat(cs.letterSpacing) * S}px`,
      });
      plan.push({
        x0: r.left + r.width / 2,
        y0: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        delay: rand(k, 1) * LETTERS.staggerMs * 0.6,
        vx: (rand(k, 2) * 2 - 1) * LETTERS.driftPx,
        spin: (rand(k, 3) * 2 - 1) * LETTERS.spinDeg,
        phase: rand(k, 4) * 6.28,
        group: 0,
        ox: (rand(k, 5) * 2 - 1) * vh * 0.02,
        oy: (rand(k, 6) * 2 - 1) * vh * 0.02,
      });
    }
    // four groups, left to right: each becomes one drop
    const order = plan.map((p, k) => ({ k, x: p.x0 })).sort((a, b) => a.x - b.x);
    order.forEach((o, j) => (plan[o.k].group = Math.min(SCENE.drops - 1, Math.floor((j / N) * SCENE.drops))));
    const seeds: DropSeed[] = [];
    for (let gIdx = 0; gIdx < SCENE.drops; gIdx++) {
      const a = groupCentre(plan, gIdx, T.merge[1], vh), b = groupCentre(plan, gIdx, T.merge[1] - 50, vh);
      seeds.push({ x: a.x, y: a.y, vy: Math.max(0, (a.y - b.y) / 0.05) });
    }
    return { vw, vh, font, plan, scene: buildScene(vw, vh, seeds) };
  }

  // the centre of a group of falling letters (where its drop forms)
  function groupCentre(plan: Plan[], gIdx: number, t: number, vh: number) {
    let x = 0, y = 0, n = 0;
    plan.forEach((p) => {
      if (p.group !== gIdx) return;
      const f = fallPos(p, t, vh);
      x += f.x;
      y += f.y;
      n++;
    });
    return { x: x / Math.max(1, n), y: y / Math.max(1, n) };
  }

  // where a falling letter would be under gravity alone
  function fallPos(p: Plan, t: number, vh: number) {
    const tau = Math.max(0, t - T.fall - p.delay) / 1000;
    return {
      x: p.x0 + p.vx * tau + 7 * Math.sin(tau * 1.7 + p.phase) * Math.min(1, tau),
      y: p.y0 + 0.5 * LETTERS.gravity * vh * tau * tau,
      rot: p.spin * tau,
    };
  }

  // ---- apply: everything at time t ----------------------------------------------------------
  function applyStage(t: number, vw: number, vh: number) {
    const st = stageTransform(t, vw, vh);
    stageRef.current!.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.S})`;
    stageRef.current!.style.visibility = t >= T.fall && t >= 0 && measured.current ? 'hidden' : 'visible';
    // lighting: a flash at every new window, the screen dims as they pile up
    let flash = 0;
    T.shots.forEach((s0, i) => {
      if (t >= s0 && t < T.montageEnd) flash += FLASH[i] * Math.exp(-(t - s0) / 110);
    });
    if (reduced) flash *= 0.3;
    flashRef.current!.style.opacity = String(Math.min(0.5, flash));
    tintRef.current!.style.opacity = String(0.06 + 0.3 * span(t, [0, T.montageEnd]));
    const quiet = 1 - span(t, T.othersOut);
    glowRef.current!.style.opacity = String((0.55 + 0.9 * flash) * quiet);
    blackRef.current!.style.opacity = String(span(t, T.blackIn));
    // the windows
    WINDOWS.forEach((w, i) => {
      const el = winRefs.current[i];
      if (!el) return;
      const shown = t >= w.appear && (w.hide === undefined || t < w.hide);
      if (!shown) {
        el.style.opacity = '0';
        return;
      }
      const e = clamp01((t - w.appear) / ENTER_MS);
      const ee = easeOutCubic(e);
      const dx = reduced ? 0 : w.from.x * (1 - ee), dy = reduced ? 0 : w.from.y * (1 - ee);
      let op = w.email === 0 && i === 0 ? ee : Math.min(1, e * 2.5);
      if (!w.final) op *= 1 - span(t, T.othersOut);
      el.style.opacity = String(op);
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // older windows darken as new ones land on top
      const newer = WINDOWS.filter((o) => o.appear > w.appear && t >= o.appear && (o.hide === undefined || t < o.hide)).length;
      el.style.setProperty('--dim', String(Math.min(0.5, newer * 0.15)));
      el.style.setProperty('--em', String(span(t, [w.appear + 260, w.appear + 560])));
      if (w.final) {
        el.style.setProperty('--frame', String(1 - span(t, T.frameOut)));
        el.style.setProperty('--fade', String(1 - span(t, T.frameOut)));
        el.style.setProperty('--kw', mix('#23272f', '#e9eef6', span(t, T.frameOut)));
        el.style.setProperty('--dots', String(span(t, T.dotsIn)));
      }
    });
  }

  function apply(t: number) {
    const root = rootRef.current;
    if (!root) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (t >= T.fall && (!measured.current || measured.current.vw !== vw || measured.current.vh !== vh)) {
      measured.current = null;
      measured.current = measure();
      const mm = measured.current;
      mm.plan.forEach((p, k) => {
        const el = cloneRefs.current[k];
        if (!el) return;
        const f = mm.font[k];
        Object.assign(el.style, {
          fontSize: `${f.size}px`,
          fontWeight: f.weight,
          letterSpacing: f.spacing,
          width: `${p.w}px`,
          height: `${p.h}px`,
          lineHeight: `${p.h}px`,
        });
      });
    }
    applyStage(t, vw, vh);
    // the darkness lifts into the real game at the end of the zoom
    root.style.background = t >= T.fadeOut[0] ? 'transparent' : '#000';
    root.style.pointerEvents = t >= T.fadeOut[0] ? 'none' : 'auto';
    // originals until the letters come loose, the copies after
    const loose = t >= T.fall;
    root.querySelectorAll<HTMLElement>('.cin-win.final .cin-ch').forEach((el) => (el.style.visibility = loose ? 'hidden' : 'visible'));
    overlayRef.current!.style.display = loose && t < T.merge[1] ? 'block' : 'none';
    const m = measured.current;
    const cv = canvasRef.current!;
    if (!m || !loose) {
      cv.style.display = 'none';
      return;
    }

    // ---- the letters: falling, drifting into four groups, becoming drops ----
    const gather = reduced ? 0 : span(t, T.cluster);
    const merge = span(t, T.merge);
    const centres = Array.from({ length: SCENE.drops }, (_, gi) => groupCentre(m.plan, gi, t, m.vh));
    m.plan.forEach((p, k) => {
      const el = cloneRefs.current[k];
      if (!el) return;
      const f = fallPos(p, t, m.vh);
      const c = centres[p.group];
      const x = lerp(f.x, c.x + p.ox * (1 - merge), gather);
      const y = lerp(f.y, c.y + p.oy * (1 - merge), gather);
      const sc = 1 - 0.75 * merge;
      el.style.transform = `translate(${x - p.w / 2}px, ${y - p.h / 2}px) rotate(${f.rot * (1 - gather)}deg) scale(${sc})`;
      el.style.opacity = String(1 - merge);
      el.style.color = `rgb(${Math.round(lerp(233, 143, gather))},${Math.round(lerp(238, 215, gather))},${Math.round(lerp(246, 216, gather))})`;
    });

    // ---- the glyph scene ----
    cv.style.display = 'block';
    const gc = (glyphs.current ??= new GlyphCanvas(cv));
    gc.resize(vw, vh);
    renderScene(m.scene, gc, t, reduced);
    const bgK = span(t, [T.fall, T.fall + 1500]);
    const base = `rgb(${Math.round(lerp(0, 0x16, bgK))},${Math.round(lerp(0, 0x21, bgK))},${Math.round(lerp(0, 0x2d, bgK))})`;
    gc.draw(base, 1 - span(t, T.fadeOut));
  }

  // ---- the clock ----------------------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const c = clock.current;
      if (c.done) return;
      if (c.playing) {
        c.t += dt * c.speed;
        if (c.stopAt !== null && c.t >= c.stopAt) {
          c.t = c.stopAt;
          c.stopAt = null;
          c.playing = false;
          setPlaying(false);
        }
        if (c.t >= T.end) {
          c.t = T.end;
          if (!c.holdEnd) {
            c.done = true;
            apply(c.t);
            onCompleteRef.current();
            return;
          }
          c.playing = false;
          setPlaying(false);
        }
        c.dirty = true;
      }
      if (c.dirty) {
        c.dirty = false;
        apply(c.t);
        if (timeRef.current) timeRef.current.textContent = `${(c.t / 1000).toFixed(2)}s`;
        if (scrubRef.current) scrubRef.current.value = String(Math.round(c.t));
        const cur = [...SHOT_LIST].reverse().find((s) => c.t >= s.at)?.id ?? SHOT_LIST[0].id;
        if (cur !== shotRef.current) {
          shotRef.current = cur;
          setShot(cur);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => (clock.current.dirty = true);
    window.addEventListener('resize', onResize);
    // start once the reference picture is in (or after a short wait)
    const img = new Image();
    let started = false;
    const start = () => {
      if (started || clock.current.done) return;
      started = true;
      clock.current.playing = true;
      setPlaying(true);
    };
    img.onload = start;
    img.onerror = start;
    img.src = CINEMATIC_BG;
    const fallback = window.setTimeout(start, 2500);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function skip() {
    const c = clock.current;
    if (c.done) return;
    c.done = true;
    c.playing = false;
    onCompleteRef.current();
  }
  useImperativeHandle(ref, () => ({ skip }));

  // ---- dev timeline ----
  const seek = (t: number, play = clock.current.playing) => {
    const c = clock.current;
    c.t = Math.max(0, Math.min(T.end, t));
    c.dirty = true;
    c.playing = play;
    setPlaying(play);
  };
  const playShot = (i: number) => {
    const s = SHOT_LIST[i];
    clock.current.stopAt = shotOnly ? s.end : null;
    seek(s.at, true);
  };
  const shotIndex = SHOT_LIST.findIndex((s) => s.id === shot);
  useEffect(() => {
    if (!devTimeline) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (e.code === 'Space') {
        const c = clock.current;
        if (c.t >= T.end) seek(0, true);
        else seek(c.t, !c.playing);
      } else if (e.key === 'ArrowRight') playShot(Math.min(SHOT_LIST.length - 1, shotIndex + 1));
      else if (e.key === 'ArrowLeft') playShot(Math.max(0, clock.current.t - SHOT_LIST[shotIndex].at > 400 ? shotIndex : shotIndex - 1));
      else if (e.key.toLowerCase() === 't') setBarOpen((v) => !v);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // the scene, rendered once: the clock styles it from here on (the keyword
  // letters are numbered in render order)
  const scene = useMemo(() => {
    let counter = 0;
    const next = () => counter++;
    return (
      <>
      <div ref={stageRef} className="cin-stage" style={{ width: STAGE_W, height: STAGE_H }}>
        <img className="cin-bg" src={CINEMATIC_BG} alt="" draggable={false} />
        <div ref={glowRef} className="cin-glow" />
        <div ref={blackRef} className="cin-black" />
        <div className="cin-screen" style={{ left: SCREEN.x, top: SCREEN.y, width: SCREEN.w, height: SCREEN.h }}>
          <div ref={tintRef} className="cin-tint" />
          {WINDOWS.map((w, i) => (
            <EmailWindow key={i} w={w} final={i === FINAL} next={next} winRef={(el) => (winRefs.current[i] = el)} />
          ))}
          <div ref={flashRef} className="cin-flash" />
        </div>
      </div>
      <canvas ref={canvasRef} className="cin-scene" />
      <div ref={overlayRef} className="cin-overlay">
        {/* a loose letter: a copy of the email's own letter, given its font
            when the letters are measured, so it can fall past the screen */}
        {LETTER_LIST.map((l, k) => (
          <span key={k} ref={(el) => (cloneRefs.current[k] = el)} className="cin-clone">
            {l.ch}
          </span>
        ))}
      </div>
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={rootRef} className="cin-root">
      {scene}
      {devTimeline && (
        <div className={'cin-dev' + (barOpen ? '' : ' closed')} onPointerDown={(e) => e.stopPropagation()}>
          <div className="cin-dev-row">
            <button onClick={() => (clock.current.t >= T.end ? seek(0, true) : seek(clock.current.t, !playing))} title="Space">
              {playing ? '❚❚ pause' : '▶ play'}
            </button>
            <button onClick={() => seek(0, true)} title="from the start">⟲ restart</button>
            <span ref={timeRef} className="cin-dev-time">0.00s</span>
            <input
              ref={scrubRef}
              className="cin-dev-scrub"
              type="range"
              min={0}
              max={T.end}
              step={10}
              defaultValue={startAt}
              onInput={(e) => seek(Number((e.target as HTMLInputElement).value), false)}
            />
            <span className="cin-dev-time">{(T.end / 1000).toFixed(0)}s</span>
            <select
              value={speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                clock.current.speed = v;
              }}
            >
              {[0.25, 0.5, 1, 2].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
            <label title="pause at the end of the shot you pick">
              <input type="checkbox" checked={shotOnly} onChange={(e) => setShotOnly(e.target.checked)} /> shot only
            </label>
            <label title="stay at the end instead of handing over to the wake-up scene">
              <input
                type="checkbox"
                checked={holdEnd}
                onChange={(e) => {
                  setHoldEnd(e.target.checked);
                  clock.current.holdEnd = e.target.checked;
                }}
              />{' '}
              hold at end
            </label>
            <button onClick={skip} title="end the cinematic now (like Skip Intro)">skip → game</button>
            <button onClick={() => setBarOpen(false)} title="hide (T)">×</button>
          </div>
          <div className="cin-dev-shots">
            {SHOT_LIST.map((s, i) => (
              <button
                key={s.id}
                className={s.id === shot ? 'on' : ''}
                style={{ flexGrow: s.end - s.at }}
                onClick={() => playShot(i)}
                title={`${(s.at / 1000).toFixed(1)}–${(s.end / 1000).toFixed(1)}s · ←/→ for the previous / next shot`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {devTimeline && !barOpen && (
        <button className="cin-dev-open" onClick={() => setBarOpen(true)} title="show the timeline (T)">
          timeline
        </button>
      )}
    </div>
  );
});
