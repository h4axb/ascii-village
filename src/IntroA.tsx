// Intro Stage A — the laptop/MYLL prologue: stages 1-14 of the unified
// intro ('screen-off' through 'falling-asleep'). A React port of the
// standalone prototype `intro-shots-1-2-3.html` (same asset paths, same
// timing constants from ./introAConfig, same cursor bezier/wobble math,
// same eyelid-blink easing) for shots 1-2 (laptop + mail). Shot 3 (MYLL)
// was reworked: the Virtual Try-On stage/customizer is gone — MYLL is now
// pure product browsing that gradually gives way to a tiredness/blink
// sequence — and an internal-monologue narration track (see
// ./introNarrationData.ts, the ONE authoritative narration source for the
// whole unified intro, not just this component's stages) is now synced
// throughout the whole prologue. The
// prototype drove its timeline with plain setTimeout/rAF + direct DOM
// writes; this component does the same thing via refs (rather than React
// state) for the per-frame cursor/scroll/blink animation, for the same
// reason the original did it that way — a smooth 60fps tween has no
// business going through React's render cycle every frame. Narration TEXT
// changes are infrequent (at most a couple of times a second) and use
// ordinary React state instead, same as stage 15+'s DialogueBox lines.
//
// Calls `onComplete()` once instead of the prototype's
// `startWakeInAsciiaBay()` iframe reveal — at that exact point (screen
// fully black, held) the caller (App.tsx's Game()) switches straight into
// stage 15's own cinematic blackout, which starts already opaque, so
// there is no visible seam. See Game()'s `introAActive` state.
//
// DEV-only Skip Intro (App.tsx) calls the imperative `skip()` handle
// exposed via ref: it flips `skipRef`, clears every pending timer, and
// calls onComplete() directly — every in-flight animation helper
// (sleep/animateCursor/animateScroll/animateBlink/nextBeat) checks
// `skipRef` first and, if set, resolves immediately after snapping
// straight to its final value, so nothing is left half-animated (or
// half-narrated) on screen once this component unmounts. This also means
// Skip Intro always lands on the exact same "right before wake in ASCIIA
// BAY" point regardless of which of the stages above it's used from —
// there's no stage-number branching to keep in sync when this file's
// internal stage structure changes.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  INTRO_CONFIG,
  SHOT2_CONFIG,
  SHOT3_CONFIG,
  CURSOR_WIDTH_PCT_STATE2,
  CURSOR_WIDTH_PCT_STATE3,
  CLOSE_BUTTON_PX,
  MYLL_ICON_PX,
  PRODUCTS,
  SECTION2_ITEMS,
  TIRED_ITEMS,
  TIRED_BLINK_1,
  TIRED_BLINK_2,
  TIRED_BLINK_3,
  FINAL_BLINK_MS,
  FINAL_BLACK_HOLD_MS,
  FREEZE_BEFORE_FINAL_BLINK_MS,
  pxToPct,
  bezierPoint,
  easeInQuad,
  easeOutQuad,
  easeInOutCubic,
  type Pct,
  type BlinkStep,
} from './introAConfig';
import { INTRO_NARRATION, INTRO_STAGE_ORDER, type IntroStageId } from './introNarrationData';
import IntroNarration from './IntroNarration';

export type IntroAHandle = { skip: () => void };

// devStartStage/devStopAfterStage: DEV-only preview hooks for the "INTRO"
// editor tab's Play Scene / Play From Here (src/devIntroNarration.ts,
// src/DevIntroTab.tsx). Both are optional and undefined in every normal
// gameplay render (App.tsx's own <IntroA/> never passes them) — this is the
// SAME component/sequencing code either way, not a parallel preview
// implementation. When devStartStage is set, playSequence() below fast-
// forwards (every sleep/animate helper resolves instantly, no narration
// shown, exactly like Skip Intro's existing skipRef fast path) through
// every stage BEFORE it, then plays devStartStage onward at normal speed.
// When devStopAfterStage is also set, playback stops (calls onComplete)
// the moment a LATER stage would start — i.e. only devStartStage's own
// beats play. See enterStage() below, called once per stage boundary.
export default forwardRef<
  IntroAHandle,
  { onComplete: () => void; devStartStage?: IntroStageId; devStopAfterStage?: IntroStageId }
>(function IntroA({ onComplete, devStartStage, devStopAfterStage }, ref) {
  const img1 = useRef<HTMLImageElement>(null);
  const img2 = useRef<HTMLImageElement>(null);
  const img3 = useRef<HTMLImageElement>(null);
  const img4 = useRef<HTMLImageElement>(null);
  const img5 = useRef<HTMLImageElement>(null);
  const img6 = useRef<HTMLImageElement>(null);
  const myllApp = useRef<HTMLDivElement>(null);
  const myllScroll = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const eyelidTop = useRef<HTMLDivElement>(null);
  const eyelidBottom = useRef<HTMLDivElement>(null);
  const eyelidFill = useRef<HTMLDivElement>(null);

  const skipRef = useRef(false);
  const timers = useRef<Set<number>>(new Set());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const doneRef = useRef(false);

  // Narration text is the one piece of this component's runtime state that
  // isn't a per-frame animation, so — unlike cursor/scroll/blink — it's
  // ordinary React state instead of a ref, same as stage 15+'s DialogueBox
  // line. See introNarrationData.ts for the data this reads.
  const [narrationText, setNarrationText] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    skip() {
      if (doneRef.current) return;
      skipRef.current = true;
      for (const id of timers.current) window.clearTimeout(id);
      timers.current.clear();
      doneRef.current = true;
      onCompleteRef.current();
    },
  }));

  useEffect(() => {
    let cancelled = false;
    // Per-stage cursor, not one global index — introNarrationData.ts keys
    // narration by intro stage id now (it's the ONE authoritative
    // narration source for the whole intro, not just this component's
    // stages — see that file's header), so each stage's beat list is
    // walked independently.
    const stageIdx: Partial<Record<IntroStageId, number>> = {};

    // DEV preview fast-forward flag — see this component's own module
    // comment. Starts true whenever a start stage was requested (we haven't
    // reached it yet) and flips permanently false the moment enterStage()
    // sees we've reached it. Checked everywhere skipRef already is, for the
    // exact same "resolve immediately, snap to final value" behavior.
    const ffRef = { current: !!devStartStage };

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => {
        if (skipRef.current || ffRef.current) {
          resolve();
          return;
        }
        const id = window.setTimeout(() => {
          timers.current.delete(id);
          resolve();
        }, ms);
        timers.current.add(id);
      });
    }

    // Called once at the start of each of the 6 stages' sections below.
    // Returns true if playback should stop NOW (devStopAfterStage reached) —
    // callers do `if (enterStage('x')) return;` right after. See this
    // component's module comment for the full contract.
    function enterStage(stage: IntroStageId): boolean {
      if (devStartStage && ffRef.current && INTRO_STAGE_ORDER.indexOf(stage) >= INTRO_STAGE_ORDER.indexOf(devStartStage)) {
        ffRef.current = false;
      }
      if (devStopAfterStage && INTRO_STAGE_ORDER.indexOf(stage) > INTRO_STAGE_ORDER.indexOf(devStopAfterStage)) {
        if (!doneRef.current) {
          doneRef.current = true;
          onCompleteRef.current();
        }
        return true;
      }
      return false;
    }

    // Walks INTRO_NARRATION[stage] strictly in order (see that file's
    // header for why array order — not id lookup — is what actually drives
    // sequence within a stage). `expectedId` is a DEV-only safety net: if a
    // call site here and the script have drifted out of sync (a beat was
    // added/removed on one side but not the other), this warns loudly
    // instead of silently showing the wrong line. Skipping (skipRef) still
    // consumes the beat (so the index stays correct if skip is somehow
    // released mid-sequence) but shows nothing and waits for nothing.
    async function nextBeat(stage: IntroStageId, expectedId: string): Promise<void> {
      const list = INTRO_NARRATION[stage] ?? [];
      const idx = stageIdx[stage] ?? 0;
      stageIdx[stage] = idx + 1;
      const beat = list[idx];
      if (!beat) return;
      if (import.meta.env.DEV && beat.id !== expectedId) {
        console.warn(
          `[intro narration] script/call-site order mismatch in stage "${stage}": call site expected ` +
            `"${expectedId}", next beat in INTRO_NARRATION["${stage}"] is "${beat.id}". Narration ` +
            `text/timing edits are safe; adding/removing/reordering beats must be mirrored in ` +
            `IntroA.tsx's playSequence().`,
        );
      }
      if (skipRef.current || ffRef.current || cancelled) return;
      if (beat.delayMs) await sleep(beat.delayMs);
      if (skipRef.current || ffRef.current || cancelled) return;
      setNarrationText(beat.text);
      await sleep(beat.holdMs);
      if (cancelled) return;
      setNarrationText(null);
    }

    function cursorPos(): Pct {
      const el = cursor.current;
      return { xPct: parseFloat(el?.style.left || '0'), yPct: parseFloat(el?.style.top || '0') };
    }
    function setCursorPos(p: Pct) {
      const el = cursor.current;
      if (!el) return;
      el.style.left = p.xPct + '%';
      el.style.top = p.yPct + '%';
    }
    function setCursorAt(p: Pct, widthPct: number) {
      const el = cursor.current;
      if (!el) return;
      el.style.transition = 'none';
      el.style.width = widthPct + '%';
      el.style.opacity = '1';
      setCursorPos(p);
    }
    function animateCursor(
      to: Pct,
      duration: number,
      curveStrength = 0.18,
      wobble?: { amplitude: number; cycles: number; phase: number } | null,
    ): Promise<void> {
      if (skipRef.current || ffRef.current) {
        setCursorPos(to);
        return Promise.resolve();
      }
      const from = cursorPos();
      const start = performance.now();
      return new Promise((resolve) => {
        function tick() {
          if (skipRef.current || ffRef.current || cancelled) {
            setCursorPos(to);
            resolve();
            return;
          }
          const t = Math.min(1, (performance.now() - start) / duration);
          setCursorPos(bezierPoint(from, to, t, curveStrength, wobble ?? null));
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
    }
    async function clickPulse(settlePause: number, pulseMs: number) {
      if (settlePause) await sleep(settlePause);
      cursor.current?.classList.add('clicking');
      await sleep(pulseMs);
      cursor.current?.classList.remove('clicking');
    }
    function crossFade(from: HTMLImageElement | null, to: HTMLImageElement | null, ms: number) {
      if (from) {
        from.style.transition = `opacity ${ms}ms linear`;
        from.style.opacity = '0';
      }
      if (to) {
        to.style.transition = `opacity ${ms}ms linear`;
        to.style.opacity = '1';
      }
    }
    function instantSwap(from: HTMLElement | null, to: HTMLElement | null) {
      if (from) {
        from.style.transition = 'none';
        from.style.opacity = '0';
      }
      if (to) {
        to.style.transition = 'none';
        to.style.opacity = '1';
      }
    }
    // MYLL now scrolls between exactly two sections: state8-myll-summer
    // (top) and state9-myll-shopping (bottom) — see introAConfig.ts's
    // module comment for why (VTO's middle section was removed).
    function setScroll(sections: number) {
      if (myllScroll.current) myllScroll.current.style.transform = `translateY(-${sections * 50}%)`;
    }
    function animateScroll(from: number, to: number, duration: number): Promise<void> {
      if (skipRef.current || ffRef.current) {
        setScroll(to);
        return Promise.resolve();
      }
      const start = performance.now();
      return new Promise((resolve) => {
        function tick() {
          if (skipRef.current || ffRef.current || cancelled) {
            setScroll(to);
            resolve();
            return;
          }
          const t = Math.min(1, (performance.now() - start) / duration);
          setScroll(from + (to - from) * easeInOutCubic(t));
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
    }
    function setBlink(amount: number) {
      if (eyelidTop.current) eyelidTop.current.style.transform = `translateY(${-100 + amount * 100}%)`;
      if (eyelidBottom.current) eyelidBottom.current.style.transform = `translateY(${100 - amount * 100}%)`;
      if (eyelidFill.current) eyelidFill.current.style.opacity = String(Math.max(0, (amount - 0.8) / 0.2));
    }
    function animateBlink(from: number, to: number, duration: number, easingFn: (t: number) => number): Promise<void> {
      if (skipRef.current || ffRef.current) {
        setBlink(to);
        return Promise.resolve();
      }
      const start = performance.now();
      return new Promise((resolve) => {
        function tick() {
          if (skipRef.current || ffRef.current || cancelled) {
            setBlink(to);
            resolve();
            return;
          }
          const t = Math.min(1, (performance.now() - start) / duration);
          setBlink(from + (to - from) * easingFn(t));
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
    }
    // One quick close-eyes-then-open blink beat, per the TIRED_BLINK_* table
    // in introAConfig.ts.
    async function blink(step: BlinkStep): Promise<void> {
      await animateBlink(0, step.amount, step.inMs, easeInQuad);
      await animateBlink(step.amount, 0, step.outMs, easeOutQuad);
      await sleep(step.holdAfterMs);
    }

    async function playSequence() {
      // ---- Laptop off — dark room ----
      if (enterStage('laptop-off')) return;
      if (img1.current) img1.current.style.opacity = '1';
      await nextBeat('laptop-off', 'laptop-off-1'); // "Another long day..."
      if (cancelled) return;
      await nextBeat('laptop-off', 'laptop-off-2'); // "I should probably check my laptop before I call it a night."
      if (cancelled) return;

      // (laptop turns on)
      crossFade(img1.current, img2.current, 120);
      setCursorAt(INTRO_CONFIG.cursorStartState2Pct, CURSOR_WIDTH_PCT_STATE2);
      await sleep(INTRO_CONFIG.state2Duration);
      if (cancelled) return;

      // blackout
      if (img2.current) {
        img2.current.style.transition = `opacity ${INTRO_CONFIG.blackoutFadeMs}ms linear`;
        img2.current.style.opacity = '0';
      }
      if (cursor.current) {
        cursor.current.style.transition = `opacity ${INTRO_CONFIG.blackoutFadeMs}ms linear`;
        cursor.current.style.opacity = '0';
      }
      await sleep(INTRO_CONFIG.blackoutFadeMs + INTRO_CONFIG.blackoutHoldMs);
      if (cancelled) return;

      // ---- Laptop on — 1 new mail (desktop, state3) ----
      if (enterStage('laptop-on')) return;
      setCursorAt(INTRO_CONFIG.cursorStartState3Pct, CURSOR_WIDTH_PCT_STATE3);
      if (img3.current) {
        img3.current.style.transition = `opacity ${INTRO_CONFIG.state3FadeMs}ms linear`;
        img3.current.style.opacity = '1';
      }
      if (cursor.current) {
        cursor.current.style.transition = `opacity ${INTRO_CONFIG.state3FadeMs}ms linear`;
        cursor.current.style.opacity = '1';
      }
      await nextBeat('laptop-on', 'laptop-on-1'); // "Oh, one new email."
      if (cancelled) return;
      await nextBeat('laptop-on', 'laptop-on-2'); // "Maybe this time it's good news."
      if (cancelled) return;

      // (cursor moves toward Mail)
      await animateCursor(INTRO_CONFIG.mailTargetState3Pct, INTRO_CONFIG.cursorMoveDuration);
      await clickPulse(INTRO_CONFIG.cursorSettlePause, 140);
      instantSwap(img3.current, img4.current);
      await sleep(SHOT2_CONFIG.holdBeforeMove);
      if (cancelled) return;

      // ---- Mail inbox: NO narration — find the unread email, open it ----
      await animateCursor(pxToPct(SHOT2_CONFIG.subjectTarget), SHOT2_CONFIG.moveToSubjectDuration);
      await sleep(SHOT2_CONFIG.holdAtSubject);
      await clickPulse(SHOT2_CONFIG.clickSettlePause, SHOT2_CONFIG.clickPulseMs);
      instantSwap(img4.current, img5.current);
      await sleep(SHOT2_CONFIG.holdAfterSwitch);
      if (cancelled) return;

      // ---- Rejection email: the cursor/visual attention follows the
      // email's own text FIRST — no narration overlays this pass. ----
      for (const seg of SHOT2_CONFIG.readSegments) {
        await animateCursor(pxToPct(seg.to), seg.duration, 0.1, seg.wobble ?? null);
        if (seg.pauseAfter) await sleep(seg.pauseAfter);
        if (cancelled) return;
      }

      if (enterStage('rejection-email')) return;
      await nextBeat('rejection-email', 'rejection-1'); // "...Right."
      if (cancelled) return;
      await nextBeat('rejection-email', 'rejection-2'); // "That's the twelfth rejection this month."
      if (cancelled) return;
      await nextBeat('rejection-email', 'rejection-3'); // "I knew all this AI stuff was changing things, but..."
      if (cancelled) return;
      await nextBeat('rejection-email', 'rejection-4'); // "Maybe I should figure out what I could actually do with it."
      if (cancelled) return;
      await nextBeat('rejection-email', 'rejection-5'); // "...Tomorrow."
      if (cancelled) return;

      // (cursor moves toward close)
      await animateCursor(pxToPct(CLOSE_BUTTON_PX), SHOT2_CONFIG.moveToCloseDuration);
      await nextBeat('rejection-email', 'rejection-6'); // "I'm way too tired to think about this now."
      if (cancelled) return;

      // (mail closes)
      await clickPulse(SHOT2_CONFIG.clickSettlePause, SHOT2_CONFIG.clickPulseMs);
      instantSwap(img5.current, img6.current);
      await sleep(SHOT3_CONFIG.holdBeforeMove);
      if (cancelled) return;

      // ---- Desktop ----
      if (enterStage('desktop')) return;
      await sleep(600); // (pause)
      await nextBeat('desktop', 'desktop-1'); // "I should really just go to bed."
      if (cancelled) return;
      await sleep(500); // (cursor stays still briefly)
      await nextBeat('desktop', 'desktop-2'); // "...But MYLL did just drop their summer collection."
      if (cancelled) return;

      // (cursor slowly moves toward MYLL)
      await animateCursor(pxToPct(MYLL_ICON_PX), SHOT3_CONFIG.moveToMyllDuration);
      await nextBeat('desktop', 'desktop-3'); // "Just a quick look."
      if (cancelled) return;

      // (click MYLL)
      await clickPulse(SHOT3_CONFIG.clickSettlePause, SHOT3_CONFIG.clickPulseMs);
      instantSwap(img6.current, myllApp.current);
      setScroll(0);
      await sleep(SHOT3_CONFIG.holdAfterAppOpen);
      if (cancelled) return;

      // ---- MYLL — shopping/browsing (pure browsing, no VTO) ----
      if (enterStage('myll-browsing')) return;
      await nextBeat('myll-browsing', 'myll-1'); // "Okay... just a few minutes."
      if (cancelled) return;

      // (begin browsing)
      await animateCursor(pxToPct(PRODUCTS[0]), SHOT3_CONFIG.productMoveDuration, 0.1, {
        amplitude: 0.18,
        cycles: 1,
        phase: 0,
      });
      await sleep(SHOT3_CONFIG.productHoverPause);
      await nextBeat('myll-browsing', 'myll-2'); // "Oh, that's cute."
      if (cancelled) return;

      // (move to another item)
      await animateCursor(pxToPct(PRODUCTS[1]), SHOT3_CONFIG.productMoveDuration, 0.1, {
        amplitude: 0.18,
        cycles: 1,
        phase: 0.6,
      });
      await sleep(SHOT3_CONFIG.productHoverPause);
      await nextBeat('myll-browsing', 'myll-3'); // "...That too."
      if (cancelled) return;

      // (scroll — a little further down the same product row) ... "I could
      // actually use some new shoes..."
      await animateCursor(pxToPct(PRODUCTS[3]), SHOT3_CONFIG.productMoveDuration, 0.1, {
        amplitude: 0.18,
        cycles: 1,
        phase: 1.2,
      });
      await sleep(SHOT3_CONFIG.productHoverPause);
      await nextBeat('myll-browsing', 'myll-4'); // "I could actually use some new shoes..."
      if (cancelled) return;

      // (another item catches attention)
      await animateCursor(pxToPct(PRODUCTS[2]), SHOT3_CONFIG.productMoveDuration, 0.1, {
        amplitude: 0.18,
        cycles: 1,
        phase: 1.8,
      });
      await sleep(SHOT3_CONFIG.productHoverPause);
      await nextBeat('myll-browsing', 'myll-5'); // "Why do I always find things I want when I'm trying not to spend money?"
      if (cancelled) return;

      await sleep(300); // (brief pause)
      await nextBeat('myll-browsing', 'myll-6'); // "I'll just look."
      if (cancelled) return;

      // (continue browsing — scroll down into the broader category/
      // lifestyle range: state9's Clothing/Bottoms/Shoes/Accessories/Bags/
      // Home & Living/Beauty/Stationery/Electronics/Sale + lifestyle
      // banners. The wider range than just clothing is intentional — see
      // introAConfig.ts's module comment.)
      await animateScroll(0, 1, SHOT3_CONFIG.scrollToSection2Duration);
      await sleep(SHOT3_CONFIG.holdAtSection2Arrival);
      if (cancelled) return;

      // (at another appealing item)
      await animateCursor(pxToPct(SECTION2_ITEMS[0]), SHOT3_CONFIG.productMoveDuration, 0.1, {
        amplitude: 0.15,
        cycles: 1,
        phase: 0.3,
      });
      await sleep(SHOT3_CONFIG.productHoverPause);
      await nextBeat('myll-browsing', 'myll-7'); // "Ugh... I want that too."
      if (cancelled) return;

      // (continue)
      await animateCursor(pxToPct(SECTION2_ITEMS[1]), SHOT3_CONFIG.productMoveDuration, 0.1, {
        amplitude: 0.15,
        cycles: 1,
        phase: 0.9,
      });
      await sleep(SHOT3_CONFIG.productHoverPause);
      await nextBeat('myll-browsing', 'myll-8'); // "Maybe someday."
      if (cancelled) return;

      // ---- Gradually becoming tired: cursor movement gets progressively
      // slower/less active, interrupted by blinks that get progressively
      // heavier, until the final closure carries the screen to black. ----
      if (enterStage('myll-tired')) return;
      await animateCursor(pxToPct(TIRED_ITEMS[0]), SHOT3_CONFIG.tiredMoveDuration, 0.08, null);
      await sleep(SHOT3_CONFIG.tiredHoverPause);
      await nextBeat('myll-tired', 'tired-1'); // "Let's see what else they have..."
      if (cancelled) return;

      await sleep(400); // (scroll)
      await blink(TIRED_BLINK_1); // (first subtle blink)
      if (cancelled) return;
      await nextBeat('myll-tired', 'tired-2'); // "Hmm..."
      if (cancelled) return;

      // (continue) -> (another product)
      await animateCursor(pxToPct(TIRED_ITEMS[1]), SHOT3_CONFIG.tiredMoveDuration, 0.08, null);
      await sleep(SHOT3_CONFIG.tiredHoverPause);
      await nextBeat('myll-tired', 'tired-3'); // "That's nice too..."
      if (cancelled) return;

      await blink(TIRED_BLINK_2); // (longer blink)
      if (cancelled) return;
      await sleep(500); // (cursor pauses)
      await nextBeat('myll-tired', 'tired-4'); // "I really should stop scrolling."
      if (cancelled) return;

      await sleep(700); // (pause)
      // (she scrolls again anyway)
      await animateCursor(pxToPct(TIRED_ITEMS[2]), SHOT3_CONFIG.tiredMoveDuration, 0.06, null);
      await nextBeat('myll-tired', 'tired-5'); // "...Just one more."
      if (cancelled) return;

      await blink(TIRED_BLINK_3); // (another blink)
      if (cancelled) return;

      // (intentionally leave a period with NO narration — do not add a
      // beat here, see introNarrationData.ts's file header.)
      await sleep(700);
      if (cancelled) return;

      // (cursor makes one final small movement)
      await animateCursor(pxToPct(TIRED_ITEMS[3]), 900, 0.05, null);
      if (cancelled) return;

      await nextBeat('myll-tired', 'tired-6'); // "..."
      if (cancelled) return;

      // (final eyelid closure) -> BLACK
      await sleep(FREEZE_BEFORE_FINAL_BLINK_MS);
      if (cancelled) return;
      await animateBlink(0, 1, FINAL_BLINK_MS, easeInQuad);
      await sleep(FINAL_BLACK_HOLD_MS); // hold black
      if (cancelled) return;

      if (!doneRef.current) {
        doneRef.current = true;
        onCompleteRef.current();
      }
    }

    playSequence();
    return () => {
      cancelled = true;
      for (const id of timers.current) window.clearTimeout(id);
      timers.current.clear();
    };
  }, []);

  const imgStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0 };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        // Must sit above EVERY other overlay this component's caller may
        // already have mounted before stage 15 even starts — in
        // particular .cinematic-blackout (z-index 9985, styles.css),
        // which starts opaque from Game()'s very first render and is
        // exactly what stage 15 hands off into once this unmounts (see
        // this component's own module comment for why that handoff is
        // seamless).
        zIndex: 10000,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '16 / 9',
          // Fills the viewport normally (contain-fit, no crop, no
          // pillarbox) — Stage A has no letterbox bars at all (see
          // App.tsx's <Letterbox/> render, gated on letterboxVisible only,
          // not introAActive), so there's nothing to make room for or hide
          // behind here.
          width: 'min(100vw, 100vh * 16 / 9)',
          height: 'min(100vh, 100vw * 9 / 16)',
          background: '#000',
          overflow: 'hidden',
        }}
      >
        <img ref={img1} src="/intro/state1-screen-off.png" alt="" style={imgStyle} />
        <img ref={img2} src="/intro/state2-laptop-scene.png" alt="" style={imgStyle} />
        <img ref={img3} src="/intro/state3-desktop.png" alt="" style={imgStyle} />
        <img ref={img4} src="/intro/state4-mail-inbox.png" alt="" style={imgStyle} />
        <img ref={img5} src="/intro/state5-rejection-mail.png" alt="" style={imgStyle} />
        <img ref={img6} src="/intro/state6-desktop-reopened.png" alt="" style={imgStyle} />

        {/* MYLL — pure product browsing, two scroll sections (see
            introAConfig.ts's module comment for why VTO's old middle
            section is gone). */}
        <div ref={myllApp} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#f8f3ef', opacity: 0 }}>
          <div ref={myllScroll} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '200%' }}>
            <img
              src="/intro/state8-myll-summer.png"
              alt=""
              style={{ position: 'absolute', left: 0, top: '0%', width: '100%', height: '50%' }}
            />
            <img
              src="/intro/state9-myll-shopping.png"
              alt=""
              style={{ position: 'absolute', left: 0, top: '50%', width: '100%', height: '50%' }}
            />
          </div>
          <img
            src="/intro/state7-myll-header.png"
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 5, pointerEvents: 'none' }}
          />
        </div>

        <div ref={eyelidTop} style={eyelidStyle('top')} />
        <div ref={eyelidBottom} style={eyelidStyle('bottom')} />
        <div ref={eyelidFill} style={{ position: 'absolute', inset: 0, zIndex: 41, pointerEvents: 'none', background: '#000', opacity: 0 }} />

        <div
          ref={cursor}
          data-introa-cursor
          style={{
            position: 'absolute',
            aspectRatio: '1 / 1',
            opacity: 0,
            transform: 'translate(0,0) scale(1)',
            transition: 'transform 120ms ease-out',
            filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.5))',
            zIndex: 10,
            width: '0.9%',
            left: '0%',
            top: '0%',
          }}
        >
          <svg viewBox="-6 -6 112 112" style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}>
            <path
              d="M0,0 L0,82 L24,68 L40,96 L56,90 L40,60 L68,58 Z"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth={9}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* Internal-monologue narration — rendered in the BOTTOM letterbox
          bar. Portaled straight to document.body (escaping this
          component's OWN root div, which is position:fixed + z-index —
          i.e. it creates its own stacking context) rather than just being
          a sibling further up this JSX tree: App.tsx's <Letterbox/> is a
          SIBLING of <IntroA/> with a higher z-index (10001 vs this root's
          10000), so the letterbox bars paint over IntroA's ENTIRE subtree
          regardless of any z-index assigned to something nested inside it
          — no in-tree z-index here could ever out-rank that from the
          outside. Portaling out of the subtree entirely sidesteps the
          rule. See IntroNarration.tsx/introNarrationData.ts for the
          presentation and styles.css's .introa-narration-wrap (still
          position:fixed + z-index 10002, now meaningfully compared
          against Letterbox/dialogue/skip-button since it's no longer
          trapped inside this component's own stacking context). */}
      {createPortal(<IntroNarration text={narrationText} />, document.body)}
      <style>{`
        div[data-introa-cursor].clicking { transform: translate(0,0) scale(0.72) !important; }
      `}</style>
    </div>
  );
});

function eyelidStyle(edge: 'top' | 'bottom'): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '52%',
    zIndex: 40,
    pointerEvents: 'none',
  };
  if (edge === 'top') {
    return {
      ...base,
      top: 0,
      background: 'linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,0.85) 55%, rgba(0,0,0,0) 100%)',
      transform: 'translateY(-100%)',
    };
  }
  return {
    ...base,
    bottom: 0,
    background: 'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0.85) 55%, rgba(0,0,0,0) 100%)',
    transform: 'translateY(100%)',
  };
}
