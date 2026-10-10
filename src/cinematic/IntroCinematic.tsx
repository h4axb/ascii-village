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
  fitFrame,
  screenFit,
  CLOCK_GAP,
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
import { EMAILS, WINDOWS, FLASH, INBOX, TOAST, type WindowShot } from './emails';
import { GlyphCanvas } from './glyphCanvas';
import { buildScene, renderScene, cellAt, growFrom, sceneCell, DOOR_PAD, type Scene } from './scene';
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

// the door's boil: the turbulence's baseFrequency, stepping every 0.225 s
const BOIL = ['0.01', '0.025', '0.015', '0.03'];

// ---- the stills ----------------------------------------------------------------------------
// which still is showing at t, and how far it has faded in over the one before
function frameAt(t: number) {
  let i = 0;
  FRAMES.forEach((f, k) => {
    if (t >= f.at) i = k;
  });
  return { i, fade: i ? clamp01((t - FRAMES[i].at) / FRAME_FADE) : 1 };
}
// the laptop screen's place (every still is fitted to put its screen there)
function screenAt() {
  return screenFit();
}
// the inbox, latest arrival on top (among mails arriving together, the later one)
const ORDER = INBOX.map((it, i) => ({ it, i })).sort((a, b) => b.it.at - a.it.at || b.i - a.i);
const ROW_H = 13; // a list row, stage px
const PULL_EXP = 3.2; // how sharply the camera's pull back speeds up

// ---- the per-letter plan, fixed once the letters have been measured --------------------
interface Plan {
  x0: number; // centre where the letter came loose (viewport px)
  y0: number;
  w: number;
  h: number;
  delay: number; // ms after T.fall that it lets go
  g: number; // its gravity, px/s²
  tMorph: number; // ms: it turns to water (a string in the scene takes over)
  landY: number; // world px: where its water lands
}
interface Measured {
  vw: number;
  vh: number;
  font: { size: number; family: string; weight: string; spacing: string }[];
  plan: Plan[];
  scene: Scene;
  P: number; // px: how far above the final framing the letters hang (world)
  pan: Float32Array; // the camera's pan (px), every PAN_DT ms from T.fall (see panTable)
}
const PAN_DT = 1000 / 120;

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
  // the door on a layer of its own, boiling (the SVG filter below)
  const doorCanvasRef = useRef<HTMLCanvasElement>(null);
  const doorGlyphs = useRef<GlyphCanvas | null>(null);
  const boilRef = useRef<SVGFEDisplacementMapElement>(null);
  const turbRef = useRef<SVGFETurbulenceElement>(null);
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
  const first = screenFit();
  const focus = { x: first.x + first.w / 2, y: first.y + first.h / 2 };
  function stageTransform(t: number, vw: number, vh: number) {
    const { s, ox, oy } = cover(vw, vh);
    // it holds on the first mail, then pulls back - slowly at first, faster
    // and faster (exponential)
    const u = clamp01((t - T.pullBack[0]) / (T.pullBack[1] - T.pullBack[0]));
    const k = reduced ? 0 : 1 - (Math.exp(PULL_EXP * u) - 1) / (Math.exp(PULL_EXP) - 1);
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
        delay: 0,
        g: 0,
        tMorph: 0,
        landY: 0,
      });
    }
    // the letters let go in a few waves and fall (the camera follows them,
    // keeping them at the centre, down to the door's place); on the way each
    // turns into a string of water that drifts in to its column of the door
    // and lands on its foot; the door grows out of that water. The falling
    // final mail is placed so its keywords are right above the door: they
    // fall straight down onto it.
    const scene = buildScene(vw, vh);
    const P = LETTERS.pan.dist * vh; // world = the final framing; the letters start P above it
    const seeds: { c: number; r: number; t: number }[] = [];
    const mid = cellAt(scene, (DOOR.cols - 1) / 2, 0).x;
    const { n, gap, jitter } = LETTERS.waves;
    scene.strings = plan.map((p, k) => {
      p.delay = Math.min(n - 1, Math.floor(rand(k, 7) * n)) * gap + rand(k, 8) * jitter;
      p.g = LETTERS.gravity * vh * (1 + LETTERS.speed * (2 * rand(k, 9) - 1));
      const g = p.g;
      const tm = lerp(LETTERS.morphAt[0], LETTERS.morphAt[1], rand(k, 5)); // s into its fall
      p.tMorph = T.fall + p.delay + tm * 1000;
      // the strings drift only a little toward the door's middle (mostly
      // they fall straight); where one lands on the door's foot the door
      // starts there - one landing beside the door seeds its nearest edge
      const x0 = p.x0;
      const tx = lerp(x0, mid, LETTERS.converge);
      const c = Math.max(0, Math.min(DOOR.cols - 1, Math.round(tx / scene.cell - 0.5 - scene.c0)));
      let r = DOOR.rows - 2;
      while (r > 0 && !DOOR.at[r * DOOR.cols + c]) r--;
      const land = { x: tx, y: cellAt(scene, c, r).y };
      p.landY = land.y;
      const y0 = p.y0 - P + 0.5 * g * tm * tm, v0 = g * tm;
      const tau = (-v0 + Math.sqrt(v0 * v0 + 2 * g * Math.max(1, land.y - y0))) / g;
      const tLand = p.tMorph + tau * 1000;
      seeds.push({ c, r, t: tLand });
      return { x0, y0, v0, t0: p.tMorph, tx: land.x, landY: land.y, tLand, len: Math.round(lerp(LETTERS.tail[0], LETTERS.tail[1], rand(k, 6))), g };
    });
    growFrom(scene, seeds);
    return { vw, vh, font, plan, scene, P, pan: panTable(plan, P, vh) };
  }

  // a letter's height in the world at t (px): hanging, falling, then (as
  // water) landed on the door's foot
  const fallY = (p: Plan, P: number, t: number) => {
    const tau = Math.max(0, t - T.fall - p.delay) / 1000;
    return p.y0 - P + 0.5 * p.g * tau * tau;
  };
  // the camera after the falling letters: it holds while they drop toward
  // the frame's centre, then keeps their middle (letters and water alike)
  // there all the way down, until it rests on the door's framing. It only
  // ever moves down, and the follow is smoothed with a gaussian around each
  // moment, so it eases in and out of the motion; computed once (a table,
  // still a pure function of t, so scrubbing and recording stay exact).
  function panTable(plan: Plan[], P: number, vh: number) {
    const span = 14000, n = Math.ceil(span / PAN_DT) + 1;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = T.fall + i * PAN_DT;
      let y = 0;
      for (const p of plan) y += Math.min(p.landY, fallY(p, P, t));
      raw[i] = Math.max(0, Math.min(P, vh / 2 - y / plan.length));
    }
    const sg = LETTERS.pan.smooth / PAN_DT, R = Math.ceil(sg * 3);
    const w = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-((k - R) ** 2) / (2 * sg * sg)));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0, ws = 0;
      for (let k = -R; k <= R; k++) {
        const j = i + k, v = j < 0 ? P : j >= n ? raw[n - 1] : raw[j];
        a += v * w[k + R];
        ws += w[k + R];
      }
      out[i] = a / ws;
    }
    return out;
  }
  // the pan: how far below its final framing the world still is (px)
  function panAt(m: Measured, t: number) {
    if (reduced) return 0;
    const f = Math.max(0, (t - T.fall) / PAN_DT), i = Math.floor(f);
    if (i >= m.pan.length - 1) return m.pan[m.pan.length - 1];
    return lerp(m.pan[i], m.pan[i + 1], f - i);
  }
  // a letter at time t (screen px): falling under gravity, stretched; then
  // it stretches into a streak and fades as its water string takes over
  function letterAt(m: Measured, p: Plan, t: number, pan: number) {
    const [fx, fy] = LETTERS.fallScale, [qx, qy] = LETTERS.streak;
    const tau = Math.max(0, t - T.fall - p.delay) / 1000;
    const k = clamp01(tau / 0.12); // it stretches as it gets going
    const mk = smooth(clamp01((t - p.tMorph) / LETTERS.morphMs));
    return { x: p.x0, y: fallY(p, m.P, t) + pan, sx: lerp(lerp(1, fx, k), qx, mk), sy: lerp(lerp(1, fy, k), qy, mk), m: mk };
  }

  // ---- the desktop: clock, mail app, inbox, notification ------------------------------------
  function applyDesktop(t: number, fi: number, fade: number, quiet: number) {
    const f = FRAMES[fi];
    // the clock: beside each still's own battery icon (stage px within the
    // screen), so it is on the same spot of the laptop in every still
    const scr = screenAt();
    const at = (k: number) => {
      const ff = fitFrame(k), tr = FRAMES[k].tray;
      return { x: ff.x + ff.s * (tr.x + CLOCK_GAP) - scr.x, y: ff.y + ff.s * tr.y - scr.y };
    };
    const a = at(Math.max(0, fi - 1)), b = at(fi);
    Object.assign(clockRef.current!.style, { left: `${lerp(a.x, b.x, fade)}px`, top: `${lerp(a.y, b.y, fade)}px` });
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
    const view = appRef.current!.clientHeight || 1;
    const total = Math.max(view, shown * ROW_H + 24);
    thumbRef.current!.style.height = `${(100 * view) / total}%`;
    thumbRef.current!.style.top = '0%';
    // the thank-you's notification
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
    const scr = screenAt();
    Object.assign(screenRef.current!.style, { left: `${scr.x}px`, top: `${scr.y}px`, width: `${scr.w}px`, height: `${scr.h}px` });
    // lighting: a flash as each mail opens; the screen's glow in the room grows toward night
    let flash = 0;
    WINDOWS.forEach((w) => {
      if (!w.open && t >= w.appear && t < T.montageEnd) flash += FLASH * Math.exp(-(t - w.appear) / 110);
    });
    if (reduced) flash *= 0.3;
    flashRef.current!.style.opacity = String(Math.min(0.5, flash));
    const quiet = 1 - span(t, T.othersOut);
    const glow = lerp(FRAMES[Math.max(0, fr.i - 1)].glow, FRAMES[fr.i].glow, fr.fade);
    glowRef.current!.style.opacity = String((glow + 0.9 * flash) * quiet);
    blackRef.current!.style.opacity = String(span(t, T.blackIn));
    applyDesktop(t, fr.i, fr.fade, quiet);
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
      // already open: it comes in with its still's crossfade
      let op = w.open ? clamp01((t - w.appear) / FRAME_FADE) : i === 0 ? ee : Math.min(1, e * 2.5);
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
    const m0 = measured.current && { lastLand: Math.max(...measured.current.plan.map((p) => p.tMorph + LETTERS.morphMs)) };
    root.querySelectorAll<HTMLElement>('.cin-win.final .cin-ch').forEach((el) => (el.style.visibility = loose ? 'hidden' : 'visible'));
    overlayRef.current!.style.display = loose && t < (m0?.lastLand ?? Infinity) + 50 ? 'block' : 'none';
    const m = measured.current;
    const cv = canvasRef.current!;
    const dcv = doorCanvasRef.current!;
    if (!m || !loose) {
      cv.style.display = 'none';
      dcv.style.display = 'none';
      return;
    }

    // ---- the letters: falling (the camera after them), turning to water ----
    const water = m.scene.col.shallow;
    const pan = panAt(m, t);
    m.plan.forEach((p, k) => {
      const el = cloneRefs.current[k];
      if (!el) return;
      if (reduced) {
        // no falling: they fade where they hang, and the door emerges
        el.style.transform = `translate(${p.x0 - p.w / 2}px, ${p.y0 - p.h / 2}px)`;
        el.style.opacity = String(1 - clamp01((t - T.fall) / 600));
        return;
      }
      const f = letterAt(m, p, t, pan);
      el.style.transformOrigin = '50% 50%';
      el.style.transform = `translate(${f.x - p.w / 2}px, ${f.y - p.h / 2}px) scale(${f.sx}, ${f.sy})`;
      el.style.opacity = String(1 - f.m);
      el.style.color = `rgb(${Math.round(lerp(233, water[0], f.m))},${Math.round(lerp(238, water[1], f.m))},${Math.round(lerp(246, water[2], f.m))})`;
    });

    // ---- the glyph scene ----
    cv.style.display = 'block';
    const gc = (glyphs.current ??= new GlyphCanvas(cv));
    gc.resize(vw, vh, sceneCell(vh), 0.85);
    // the pan moves the world down by whole cells in the scene, the rest when drawing
    const shift = Math.floor(pan / m.scene.cell);
    // the door's own layer: door-sized, with room for the leaf's swing
    const cellPx = m.scene.cell;
    const dgc = (doorGlyphs.current ??= new GlyphCanvas(dcv));
    dgc.resize((DOOR.cols + 2 * DOOR_PAD.c) * cellPx, (DOOR.rows + 2 * DOOR_PAD.r) * cellPx, cellPx, 0.85);
    boilRef.current?.setAttribute('scale', String(Math.max(3, Math.round(cellPx * 0.55))));
    // the noise's grain jumps between four sizes, 0.9 s round (on the cinematic's clock, so it scrubs)
    const grain = BOIL[Math.floor(t / 225) % BOIL.length];
    if (turbRef.current && turbRef.current.getAttribute('baseFrequency') !== grain) turbRef.current.setAttribute('baseFrequency', grain);
    renderScene(m.scene, gc, t, reduced, shift, dgc);
    const bgK = span(t, [T.fall, T.fall + 1500]);
    const bg = [1, 3, 5].map((i) => parseInt(SCENE.bg.slice(i, i + 2), 16));
    const base = `rgb(${bg.map((v) => Math.round(lerp(0, v, bgK))).join(',')})`;
    // after the hold, the camera moves in toward the doorway: a steady,
    // linear push in, no bob
    const wk = reduced ? 0 : clamp01((t - T.walk[0]) / (T.walk[1] - T.walk[0]));
    const cam = { s: lerp(1, SCENE.walk.zoom, wk), fx: m.scene.focus.x, fy: m.scene.focus.y, dx: 0, dy: 0 };
    const opacity = 1 - span(t, T.fadeOut);
    gc.draw(base, opacity, { ...cam, dy: cam.dy + (pan - shift * cellPx) });
    // the door's layer: transparent, placed over its cells, moved with the same camera
    dgc.draw('', 1, { s: 1, fx: 0, fy: 0, dx: 0, dy: 0 });
    const L = (m.scene.c0 - DOOR_PAD.c) * cellPx, Tp = (m.scene.r0 - DOOR_PAD.r) * cellPx;
    Object.assign(dcv.style, {
      display: 'block',
      left: `${L}px`,
      top: `${Tp}px`,
      opacity: String(opacity),
      transformOrigin: `${cam.fx - L}px ${cam.fy - Tp}px`,
      transform: `translate(${cam.dx}px, ${cam.dy + pan}px) scale(${cam.s})`,
      filter: reduced ? 'none' : 'url(#cin-boil)',
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
          <img
            key={k}
            ref={(el) => (frameRefs.current[k] = el)}
            className="cin-bg"
            src={f.src}
            alt=""
            draggable={false}
            style={{ opacity: k ? 0 : 1, transformOrigin: '0 0', transform: `translate(${fitFrame(k).x}px, ${fitFrame(k).y}px) scale(${fitFrame(k).s})` }}
          />
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
      {/* the door's boil: noise displacing it a few px, its grain jumping
          between four sizes (the reference SVG filter) */}
      <svg className="cin-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <filter id="cin-boil">
            <feTurbulence ref={turbRef} type="turbulence" baseFrequency="0.01" numOctaves={2} seed={1} result="noise" />
            <feDisplacementMap ref={boilRef} in="SourceGraphic" in2="noise" scale={5} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <canvas ref={doorCanvasRef} className="cin-door" />
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
