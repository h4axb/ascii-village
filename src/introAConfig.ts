// Config + pure math for Intro Stage A — the laptop/MYLL prologue (stages
// 1-14 of the unified intro: 'screen-off' through 'falling-asleep'). Ported
// VERBATIM (same constants, same derived math, same timings) from the
// standalone prototype `intro-shots-1-2-3.html` at the project root for the
// shot 1/2 (laptop + mail) portion; shot 3 (MYLL) was reworked to drop the
// Virtual Try-On stage and extend product browsing + a tiredness/blink
// sequence instead — see IntroA.tsx for the React port of the animation
// logic and src/introNarrationData.ts for the internal-monologue narration
// script synced to these beats (the ONE authoritative narration source for
// the whole unified intro, not specific to Stage A).
//
// Every image referenced here already lives at `/intro/*.png` (same Vite
// public/ dir the prototype used), so no asset migration was needed.

export type Pct = { xPct: number; yPct: number };
export type Px = { x: number; y: number };

export function pxToPct(px: Px): Pct {
  return { xPct: (px.x / 1920) * 100, yPct: (px.y / 1080) * 100 };
}

// ---- Shot 1 config (verbatim from intro-shot1.html) ----
const HEAD2 = { x: 1041.92, y: 564.58 };
const HEAD3 = { x: 1115.84, y: 641.4 };
const SCREEN_BOUNDS_IN_STATE2 = { x: 544.176, y: 247.892, width: 817.647, height: 489.216 };
const CURSOR_STATE2_PX = { x: 1010.24, y: 492.5 };

const offsetFracX = (CURSOR_STATE2_PX.x - HEAD2.x) / SCREEN_BOUNDS_IN_STATE2.width;
const offsetFracY = (CURSOR_STATE2_PX.y - HEAD2.y) / SCREEN_BOUNDS_IN_STATE2.height;
const CURSOR_STATE3_PX = { x: HEAD3.x + offsetFracX * 1920, y: HEAD3.y + offsetFracY * 1080 };

export const CURSOR_WIDTH_PCT_STATE2 = 0.9;
const SIZE_RATIO = 1920 / SCREEN_BOUNDS_IN_STATE2.width; // ~2.35
export const CURSOR_WIDTH_PCT_STATE3 = CURSOR_WIDTH_PCT_STATE2 * SIZE_RATIO;

export const INTRO_CONFIG = {
  state1Duration: 2500,
  state2Duration: 2800,
  blackoutFadeMs: 220,
  blackoutHoldMs: 260,
  state3FadeMs: 160,
  cursorMoveDuration: 2000,
  cursorSettlePause: 150,
  cursorStartState2Pct: pxToPct(CURSOR_STATE2_PX),
  cursorStartState3Pct: pxToPct(CURSOR_STATE3_PX),
  mailTargetState3Pct: pxToPct({ x: 111, y: 396.5 }),
};

// ---- Shot 2 config (verbatim from intro-shot2.html) ----
export const SHOT1_STATE3_CURSOR_WIDTH_PCT = CURSOR_WIDTH_PCT_STATE3;

const SUBJECT_TARGET_PX = { x: 1268, y: 205 };
export const CLOSE_BUTTON_PX = { x: 1865, y: 38 };
const READ_HI_THERE_PX = { x: 476, y: 408 };
const READ_THANK_YOU_PX = { x: 474, y: 470 };
const READ_INTEREST_JOINING_PX = { x: 1118, y: 470 };
const READ_TAKING_TIME_PX = { x: 1497, y: 470 };
const READ_PARA1_LINE2_PX = { x: 700, y: 504 };
const READ_AFTER_CAREFUL_PX = { x: 580, y: 566 };
const READ_MOVE_FORWARD_PX = { x: 1144, y: 566 };
const READ_WHOSE_EXPERIENCE_PX = { x: 1600, y: 566 };
const READ_MORE_CLOSELY_PX = { x: 480, y: 601 };
const READ_MATCHES_CURRENT_PX = { x: 700, y: 601 };
const READ_NEEDS_PX = { x: 855, y: 601 };

type Wobble = { amplitude: number; cycles: number; phase: number };
type ReadSegment = { to: Px; duration: number; pauseAfter?: number; wobble?: Wobble };

// The cursor's visual "reading" pass over the email body (Hi.../after
// careful consideration.../move forward with other candidates) happens
// here, entirely BEFORE any rejection narration beat is shown — see
// IntroA.tsx's playSequence, which doesn't narrate until this whole pass
// has finished (per the authoritative script's "let the cursor/visual
// attention follow the important parts of the email itself... do not cover
// these with narration prematurely").
export const SHOT2_CONFIG = {
  holdBeforeMove: 2000,
  moveToSubjectDuration: 1200,
  holdAtSubject: 1500,
  clickSettlePause: 150,
  clickPulseMs: 140,
  holdAfterSwitch: 1000,
  subjectTarget: SUBJECT_TARGET_PX,
  readSegments: [
    { to: READ_HI_THERE_PX, duration: 1600, wobble: { amplitude: 0.25, cycles: 1, phase: 0.0 } },
    { to: READ_THANK_YOU_PX, duration: 1600, wobble: { amplitude: 0.3, cycles: 1.5, phase: 0.5 } },
    { to: READ_INTEREST_JOINING_PX, duration: 1600, wobble: { amplitude: 0.25, cycles: 1.5, phase: 1.1 } },
    { to: READ_TAKING_TIME_PX, duration: 1600, wobble: { amplitude: 0.25, cycles: 1, phase: 0.4 } },
    { to: READ_PARA1_LINE2_PX, duration: 1400, wobble: { amplitude: 0.2, cycles: 1, phase: 1.2 } },
    { to: READ_AFTER_CAREFUL_PX, duration: 1800, pauseAfter: 900, wobble: { amplitude: 0.3, cycles: 1.5, phase: 0.3 } },
    { to: READ_MOVE_FORWARD_PX, duration: 2000, pauseAfter: 700, wobble: { amplitude: 0.3, cycles: 2, phase: 1.0 } },
    { to: READ_WHOSE_EXPERIENCE_PX, duration: 1600, wobble: { amplitude: 0.25, cycles: 1, phase: 0.7 } },
    { to: READ_MORE_CLOSELY_PX, duration: 1600, wobble: { amplitude: 0.25, cycles: 1.5, phase: 1.5 } },
    { to: READ_MATCHES_CURRENT_PX, duration: 1600, wobble: { amplitude: 0.3, cycles: 1, phase: 0.2 } },
    { to: READ_NEEDS_PX, duration: 1500, wobble: { amplitude: 0.25, cycles: 1.5, phase: 0.9 } },
  ] as ReadSegment[],
  moveToCloseDuration: 1300,
};

// ---- Shot 3 config: MYLL browsing (reworked — no Virtual Try-On) ----
// MYLL is now pure product browsing across two scroll sections:
// state8-myll-summer (summer collection banner + a "Trending This Summer"
// product row: Palm Tee, Pixel Tank, Denim Shorts, Retro Sneakers) and
// state9-myll-shopping (category icons — Clothing/Bottoms/Shoes/
// Accessories/Bags/Home & Living/Beauty/Stationery/Electronics/Sale — plus
// three lifestyle banners). The broader range (not just clothing) is
// intentional — see the authoritative script's note in the task brief:
// it sets up ASCIIA BAY's crafting later not being limited to clothing
// either. state10-myll-vto.png (the old "Virtual Try-On / Try It" promo
// banner) and everything VTO-specific has been removed — see the cleanup
// notes at the bottom of this file.
export const MYLL_ICON_PX = { x: 115, y: 277 };

const PALM_TEE_PX = { x: 270, y: 750 };
const PIXEL_TANK_PX = { x: 730, y: 750 };
const DENIM_SHORTS_PX = { x: 1170, y: 750 };
const RETRO_SNEAKERS_PX = { x: 1610, y: 750 };
export const PRODUCTS: Px[] = [PALM_TEE_PX, PIXEL_TANK_PX, DENIM_SHORTS_PX, RETRO_SNEAKERS_PX];

// state9 (second scroll section) — category icon row + lifestyle banners,
// coordinates in the same 1920x1080 reference frame as state9's own image.
const CAT_BAGS_PX = { x: 800, y: 610 };
const CAT_HOME_LIVING_PX = { x: 980, y: 610 };
const CAT_ELECTRONICS_PX = { x: 1520, y: 610 };
const CAT_SALE_PX = { x: 1700, y: 610 };
const CAT_CLOTHING_PX = { x: 120, y: 610 };
const BANNER_GETAWAYS_PX = { x: 1580, y: 870 };
export const SECTION2_ITEMS: Px[] = [CAT_BAGS_PX, BANNER_GETAWAYS_PX];
export const TIRED_ITEMS: Px[] = [CAT_CLOTHING_PX, CAT_ELECTRONICS_PX, CAT_SALE_PX, CAT_HOME_LIVING_PX];

export const SHOT3_CONFIG = {
  holdBeforeMove: 1000,
  moveToMyllDuration: 1300,
  clickSettlePause: 150,
  clickPulseMs: 140,
  holdAfterAppOpen: 500,
  productMoveDuration: 950,
  productHoverPause: 550,
  scrollToSection2Duration: 1600,
  holdAtSection2Arrival: 700,
  // Once tiredness sets in, cursor movement is deliberately slower/less
  // decisive than the earlier browsing pass (see the authoritative script's
  // "cursor movement progressively slower/less active").
  tiredMoveDuration: 1500,
  tiredHoverPause: 950,
};

// ---- easing / bezier math (verbatim) ----
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function easeInQuad(t: number): number {
  return t * t;
}
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function quadBezier(p0: Pct, p1: Pct, p2: Pct, t: number): Pct {
  const mt = 1 - t;
  return {
    xPct: mt * mt * p0.xPct + 2 * mt * t * p1.xPct + t * t * p2.xPct,
    yPct: mt * mt * p0.yPct + 2 * mt * t * p1.yPct + t * t * p2.yPct,
  };
}
export function bezierPoint(from: Pct, to: Pct, t: number, curveStrength: number, wobble?: Wobble | null): Pct {
  const dx = to.xPct - from.xPct;
  const dy = to.yPct - from.yPct;
  const ctrl: Pct = {
    xPct: (from.xPct + to.xPct) / 2 - dy * curveStrength,
    yPct: (from.yPct + to.yPct) / 2 + dx * curveStrength,
  };
  const eased = easeInOutCubic(t);
  const p = quadBezier(from, ctrl, to, eased);
  if (wobble) {
    const envelope = Math.sin(t * Math.PI);
    p.yPct += envelope * wobble.amplitude * Math.sin(t * Math.PI * 2 * wobble.cycles + wobble.phase * Math.PI);
  }
  return p;
}
export type { Wobble };

// ---- blink table for the tiredness scene (see IntroA.tsx's playSequence
// and introNarrationData.ts's 'myll-tired' stage) ----
// Four progressively heavier eyelid closures: three narrative "blinks"
// (subtle / longer / another) synced between tiredness narration beats,
// then the final full closure that carries the screen to black and hands
// off to stage 15 (wake in ASCIIA BAY). Amounts are the same eyelid-close
// fraction (0-1) animateBlink already used pre-rework.
export type BlinkStep = { amount: number; inMs: number; outMs: number; holdAfterMs: number };
export const TIRED_BLINK_1: BlinkStep = { amount: 0.38, inMs: 220, outMs: 220, holdAfterMs: 900 };
export const TIRED_BLINK_2: BlinkStep = { amount: 0.58, inMs: 320, outMs: 320, holdAfterMs: 1000 };
export const TIRED_BLINK_3: BlinkStep = { amount: 0.75, inMs: 380, outMs: 380, holdAfterMs: 900 };
export const FINAL_BLINK_MS = 3000;
export const FINAL_BLACK_HOLD_MS = 3000;
export const FREEZE_BEFORE_FINAL_BLINK_MS = 1000;

// ---- cleanup notes (task: "remove Virtual Try-On from the narrative
// entirely") ----
// Removed from this file: VTO_TITLE_START/END, VTO_BULLETS, VTO_BUTTON_PX,
// VTO_COMPLETE_LOOK_PX, VTO_CATEGORIES/VtoSwatch/VtoCategoryKey, and the
// vto*-prefixed SHOT3_CONFIG timing fields (vtoTitleDuration,
// vtoBulletDuration, pauseAfterBullets, moveToButtonDuration,
// pauseAtButton, vtoStatusStep, vtoLoadingDuration). The matching runtime
// markup/state/refs were removed from IntroA.tsx in the same change. VTO-
// only image assets (state10-myll-vto.png, state11-vto-loading-clean.png,
// state12-vto-*.png, state13-vto-tops-bg.png) were confirmed unreferenced
// anywhere else in src/ before deletion from public/intro/.
