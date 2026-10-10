// ---------------------------------------------------------------------------
// THE INTRO CINEMATIC (about 26 s): six rejection emails pile up on the
// laptop -> three phrases are left in the dark -> their letters fall into
// the foot of a glyph door, which builds itself up from there -> it opens
// onto the sea and an island, light pours out -> a slow walk toward it, into
// black -> 3 s of black -> the wake-up scene (App.tsx's runIntro) takes over.
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
//   scene    the glyph canvas (scene.ts): the door (door-glyphs.svg, door.ts)
//            building bottom up, opening onto the island, the beam; the walk
//            toward it is a camera move in the canvas's draw
//   overlay  the falling letters (copies placed exactly over the email's own
//            letters at the moment they come loose), until they land
// The canvas fades to black during the walk; after 3 s of black the wake-up
// scene starts from black.
// ---------------------------------------------------------------------------
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  STAGE_W,
  STAGE_H,
  FRAMES,
  FRAME_FADE,
  TASKBAR,
  T,
  ENTER_MS,
  ZOOM_START,
  LETTERS,
  SCENE,
  SHOT_LIST,
  clamp01,
  lerp,
  smooth,
  span,
  easeOutCubic,
  rand,
} from './config';
import { EMAILS, WINDOWS, FLASH, INBOX, TOAST, SCROLL, type WindowShot } from './emails';
import { GlyphCanvas } from './glyphCanvas';
import { buildScene, renderScene, cellAt, landIn, sceneCell, type Scene } from './scene';
import { DOOR } from './door';
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

// ---- the stills ----------------------------------------------------------------------------
// which still is showing at t, and how far it has faded in over the one before
function frameAt(t: number) {
  let i = 0;
  FRAMES.forEach((f, k) => {
    if (t >= f.at) i = k;
  });
  return { i, fade: i ? clamp01((t - FRAMES[i].at) / FRAME_FADE) : 1 };
}
// the laptop screen's place at t (it moves a little between stills)
function screenAt(t: number) {
  const { i, fade } = frameAt(t);
  const a = FRAMES[Math.max(0, i - 1)].screen, b = FRAMES[i].screen;
  const k = smooth(fade);
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) };
}
// the inbox, latest arrival on top (among mails arriving together, the later one)
const ORDER = INBOX.map((it, i) => ({ it, i })).sort((a, b) => b.it.at - a.it.at || b.i - a.i);
const ROW_H = 13; // a list row, stage px
// Phase 3's scroll: a few wheel ticks, each eased
function scrollRows(t: number) {
  const k = clamp01((t - SCROLL.at[0]) / (SCROLL.at[1] - SCROLL.at[0]));
  const ticks = 6, p = k * ticks, n = Math.floor(p);
  return (SCROLL.rows * Math.min(ticks, n + smooth(clamp01((p - n) * 2.5)))) / ticks;
}

// ---- the per-letter plan, fixed once the letters have been measured --------------------
interface Plan {
  x0: number; // centre where the letter came loose (viewport px)
  y0: number;
  w: number;
  h: number;
  delay: number;
  spin: number;
  phase: number;
  landX: number; // where it lands: its cell in the door's foot (it drifts there as it falls)
  landY: number;
  tLand: number; // ms
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
  const frameRefs = useRef<(HTMLImageElement | null)[]>([]);
  const screenRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const unreadRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const toastRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const clockTimeRef = useRef<HTMLSpanElement>(null);
  const clockDateRef = useRef<HTMLSpanElement>(null);
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
  // the stage transform at time t: cover, starting close on the laptop's
  // screen and slowly pulling back to the whole desk through all the stills;
  // after them the camera stays
  const first = FRAMES[0].screen;
  const focus = { x: first.x + first.w / 2, y: first.y + first.h / 2 };
  function stageTransform(t: number, vw: number, vh: number) {
    const { s, ox, oy } = cover(vw, vh);
    const k = reduced ? 0 : 1 - smooth(clamp01((t - T.pullBack[0]) / (T.pullBack[1] - T.pullBack[0])));
    const S = s * lerp(1, ZOOM_START, k);
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
        spin: (rand(k, 3) * 2 - 1) * LETTERS.spinDeg,
        phase: rand(k, 4) * 6.28,
        landX: 0,
        landY: 0,
        tLand: 0,
      });
    }
    // each letter lands in a cell of the door's foot (left to right, as they
    // hang), and the door builds itself up from there
    const scene = buildScene(vw, vh);
    const foot = DOOR.cells.filter((k) => k.part === 'ground' && k.r < DOOR.rows - 1).sort((a, b) => a.c - b.c || b.r - a.r);
    const order = plan.map((p, k) => ({ k, x: p.x0 })).sort((a, b) => a.x - b.x);
    order.forEach((o, j) => {
      const p = plan[o.k];
      const cell = foot[Math.min(foot.length - 1, Math.floor(((j + 0.5) / order.length) * foot.length))];
      const at = cellAt(scene, cell.c, cell.r);
      p.landX = at.x;
      p.landY = at.y;
      // ballistic: a small hop up, then gravity down to the cell
      const g = LETTERS.gravity * vh, v0 = -LETTERS.hop * vh;
      p.tLand = T.fall + p.delay + ((-v0 + Math.sqrt(v0 * v0 + 2 * g * Math.max(1, at.y - p.y0))) / g) * 1000;
      landIn(scene, cell.c, cell.r, p.tLand + LETTERS.settleMs);
    });
    return { vw, vh, font, plan, scene };
  }

  // a falling letter: dropped under gravity (a small hop as it comes loose,
  // then accelerating, spinning, stretched by its speed) onto its cell in the
  // door's foot; there it hits (squash), bounces once and settles
  function fallPos(p: Plan, t: number, vh: number) {
    const g = LETTERS.gravity * vh, v0 = -LETTERS.hop * vh;
    const tl = Math.max(0.001, (p.tLand - T.fall - p.delay) / 1000);
    const tau = Math.max(0, Math.min((t - T.fall - p.delay) / 1000, tl));
    const after = (t - p.tLand) / 1000; // > 0 once it has landed
    if (after <= 0) {
      const v = v0 + g * tau; // px/s, down
      const k = Math.min(1, Math.max(0, v) / (2.4 * vh));
      return {
        x: lerp(p.x0, p.landX, tau / tl), // a straight sideways speed
        y: p.y0 + v0 * tau + 0.5 * g * tau * tau,
        rot: p.spin * tau,
        sx: 1 - 0.35 * LETTERS.stretch * k,
        sy: 1 + LETTERS.stretch * k,
      };
    }
    // impact: squash flat, spring back up in one short bounce, settle
    const ms = after * 1000;
    const imp = LETTERS.impactMs, rest = LETTERS.settleMs;
    const squash = ms < imp ? Math.sin((ms / imp) * Math.PI) : 0;
    const b = ms >= imp && ms < rest ? Math.sin(((ms - imp) / (rest - imp)) * Math.PI) : 0;
    const rot0 = p.spin * tl;
    return {
      x: p.landX,
      y: p.landY - LETTERS.bounce * vh * b,
      rot: rot0 * Math.max(0, 1 - ms / imp) * 0.4, // knocked upright by the hit
      sx: 1 + 0.4 * squash - 0.08 * b,
      sy: 1 - 0.45 * squash + 0.1 * b,
    };
  }

  // ---- the desktop: clock, mail app, inbox, notification ------------------------------------
  function applyDesktop(t: number, fi: number, quiet: number) {
    const f = FRAMES[fi];
    // the desktop and taskbar clock fade with everything but the keywords
    deskRef.current!.style.opacity = String(quiet);
    clockRef.current!.style.opacity = String(quiet);
    if (clockTimeRef.current!.textContent !== f.time) {
      clockTimeRef.current!.textContent = f.time;
      clockDateRef.current!.textContent = f.date;
    }
    // the mail app: a little elsewhere each shot
    Object.assign(appRef.current!.style, { left: `${f.app.left}%`, top: `${f.app.top}%`, width: `${f.app.width}%`, height: `${f.app.height}%` });
    // the inbox: mails arrive on top, unread ones bold until read
    let unread = 0, shown = 0;
    ORDER.forEach(({ it }, k) => {
      const el = rowRefs.current[k];
      if (!el) return;
      const here = it.at <= t;
      el.style.display = here ? '' : 'none';
      if (!here) return;
      shown++;
      const isUnread = !!it.unread && !(it.readAt !== undefined && t >= it.readAt);
      if (isUnread) unread++;
      el.classList.toggle('unread', isUnread);
      el.style.setProperty('--new', String(it.at > 0 ? clamp01(1 - (t - it.at) / 1200) : 0));
    });
    unreadRef.current!.textContent = String(unread + 2);
    // Phase 3: the scroll wheel, down past the status updates
    const rows = fi === 3 ? (reduced ? (t >= SCROLL.at[0] ? SCROLL.rows : 0) : scrollRows(t)) : 0;
    listRef.current!.style.transform = `translateY(${-rows * ROW_H}px)`;
    const view = appRef.current!.clientHeight || 1;
    const total = Math.max(view, shown * ROW_H + 24);
    thumbRef.current!.style.height = `${(100 * view) / total}%`;
    thumbRef.current!.style.top = `${(100 * rows * ROW_H) / total}%`;
    // Phase 1's notification
    const tin = easeOutCubic(clamp01((t - TOAST.at) / 320)), tout = clamp01((TOAST.hide - t) / 320);
    toastRef.current!.style.opacity = String(t >= TOAST.at && t < TOAST.hide ? Math.min(tin, tout) : 0);
    toastRef.current!.style.transform = `translateY(${reduced ? 0 : (1 - tin) * 14}px)`;
  }

  // ---- apply: everything at time t ----------------------------------------------------------
  function applyStage(t: number, vw: number, vh: number) {
    const st = stageTransform(t, vw, vh);
    stageRef.current!.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.S})`;
    stageRef.current!.style.visibility = t >= T.fall && t >= 0 && measured.current ? 'hidden' : 'visible';
    // the stills, crossfading; the screen overlay follows the laptop's screen
    const fr = frameAt(t);
    FRAMES.forEach((f, k) => {
      const el = frameRefs.current[k];
      if (el) el.style.opacity = String(k < fr.i ? 1 : k === fr.i ? fr.fade : 0);
    });
    const scr = screenAt(t);
    Object.assign(screenRef.current!.style, { left: `${scr.x}px`, top: `${scr.y}px`, width: `${scr.w}px`, height: `${scr.h}px` });
    // lighting: a flash as each mail opens; the screen's glow in the room grows toward night
    let flash = 0;
    WINDOWS.forEach((w, i) => {
      if (t >= w.appear && t < T.montageEnd) flash += FLASH[i] * Math.exp(-(t - w.appear) / 110);
    });
    if (reduced) flash *= 0.3;
    flashRef.current!.style.opacity = String(Math.min(0.5, flash));
    const quiet = 1 - span(t, T.othersOut);
    const glow = lerp(FRAMES[Math.max(0, fr.i - 1)].glow, FRAMES[fr.i].glow, fr.fade);
    glowRef.current!.style.opacity = String((glow + 0.9 * flash) * quiet);
    blackRef.current!.style.opacity = String(span(t, T.blackIn));
    applyDesktop(t, fr.i, quiet);
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
    // the zoom ends in black; the wake-up scene starts from black
    root.style.background = '#000';
    // originals until the letters come loose, the copies after
    const loose = t >= T.fall;
    const m0 = measured.current && { lastLand: Math.max(...measured.current.plan.map((p) => p.tLand)) };
    root.querySelectorAll<HTMLElement>('.cin-win.final .cin-ch').forEach((el) => (el.style.visibility = loose ? 'hidden' : 'visible'));
    overlayRef.current!.style.display = loose && t < (m0?.lastLand ?? Infinity) + LETTERS.settleMs + 200 ? 'block' : 'none';
    const m = measured.current;
    const cv = canvasRef.current!;
    if (!m || !loose) {
      cv.style.display = 'none';
      return;
    }

    // ---- the letters: falling into the door's foot, shrinking into its cells ----
    const cell = m.scene.cell;
    m.plan.forEach((p, k) => {
      const el = cloneRefs.current[k];
      if (!el) return;
      const f = fallPos(p, t, m.vh);
      // after the bounce it shrinks into its cell and the cell's glyph takes over
      const settle = clamp01((t - p.tLand - LETTERS.settleMs) / 160);
      const sc = lerp(1, Math.min(1, cell / p.h), settle);
      // squash and stretch about the letter's foot, so it stands on the ground
      el.style.transformOrigin = '50% 100%';
      el.style.transform = `translate(${f.x - p.w / 2}px, ${f.y - p.h / 2}px) rotate(${f.rot}deg) scale(${sc * f.sx}, ${sc * f.sy})`;
      el.style.opacity = String(1 - settle);
    });

    // ---- the glyph scene ----
    cv.style.display = 'block';
    const gc = (glyphs.current ??= new GlyphCanvas(cv));
    gc.resize(vw, vh, sceneCell(vh), 0.85);
    renderScene(m.scene, gc, t, reduced);
    const bgK = span(t, [T.fall, T.fall + 1500]);
    const bg = [1, 3, 5].map((i) => parseInt(SCENE.bg.slice(i, i + 2), 16));
    const base = `rgb(${bg.map((v) => Math.round(lerp(0, v, bgK))).join(',')})`;
    // after the hold, walk toward the doorway: a slow push in with a step's bob
    const wk = reduced ? 0 : clamp01((t - T.walk[0]) / (T.walk[1] - T.walk[0]));
    const tau = Math.max(0, t - T.walk[0]) / 1000;
    const bob = SCENE.walk.bob * m.vh * Math.min(1, wk * 4);
    gc.draw(base, 1 - span(t, T.fadeOut), {
      s: lerp(1, SCENE.walk.zoom, wk * wk * (3 - 2 * wk) * 0.4 + wk * wk * 0.6),
      fx: m.scene.focus.x,
      fy: m.scene.focus.y,
      dx: Math.sin(tau * Math.PI * SCENE.walk.steps) * bob * 0.6,
      dy: -Math.abs(Math.sin(tau * Math.PI * SCENE.walk.steps)) * bob * 2,
    });
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
    img.src = FRAMES[0].src;
    FRAMES.slice(1).forEach((f) => (new Image().src = f.src));
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
        {FRAMES.map((f, k) => (
          <img key={k} ref={(el) => (frameRefs.current[k] = el)} className="cin-bg" src={f.src} alt="" draggable={false} style={{ opacity: k ? 0 : 1 }} />
        ))}
        <div ref={glowRef} className="cin-glow" />
        <div ref={blackRef} className="cin-black" />
        <div ref={screenRef} className="cin-screen">
          <div ref={deskRef} className="cin-desk" style={{ height: `${100 * (1 - TASKBAR)}%` }}>
            <div ref={appRef} className="cin-app">
              <div className="cin-app-bar">
                <i />
                <i />
                <i />
                <span>Mail — Inbox</span>
                <em>Search mail</em>
              </div>
              <div className="cin-app-body">
                <div className="cin-app-side">
                  <b>
                    Inbox <span ref={unreadRef}>2</span>
                  </b>
                  <span>Starred</span>
                  <span>Sent</span>
                  <span>Drafts</span>
                  <span>Archive</span>
                  <span>Trash</span>
                </div>
                <div className="cin-app-list">
                  <div ref={listRef} className="cin-app-rows">
                    {ORDER.map(({ it }, k) => (
                      <div key={k} ref={(el) => (rowRefs.current[k] = el)} className="cin-row" style={{ height: ROW_H }}>
                        <span className="cin-row-from">{it.from}</span>
                        <span className="cin-row-subj">{it.subject}</span>
                        <span className="cin-row-time">{it.time}</span>
                      </div>
                    ))}
                  </div>
                  <div className="cin-app-track">
                    <div ref={thumbRef} className="cin-app-thumb" />
                  </div>
                </div>
              </div>
            </div>
            <div ref={toastRef} className="cin-toast">
              <b>{TOAST.from}</b>
              <span>{TOAST.text}</span>
            </div>
          </div>
          {WINDOWS.map((w, i) => (
            <EmailWindow key={i} w={w} final={i === FINAL} next={next} winRef={(el) => (winRefs.current[i] = el)} />
          ))}
          <div ref={clockRef} className="cin-clock" style={{ height: `${100 * TASKBAR}%` }}>
            <span ref={clockTimeRef}>{FRAMES[0].time}</span>
            <span ref={clockDateRef}>{FRAMES[0].date}</span>
          </div>
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
