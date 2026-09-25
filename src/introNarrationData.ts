// Internal-monologue narration for the WHOLE unified intro/onboarding
// experience — not just the former "Intro A" laptop/MYLL prologue. The
// intro itself was already unified into one continuous runtime (see
// App.tsx's Game(): one introDone flag, one finishIntro(), Skip Intro's
// two-phase behavior spanning the whole thing) — this file follows the
// same principle for narration, so later intro/onboarding stages (once
// they exist — after wake-in-ASCIIA-BAY, guided exploration, a Mitchy
// quest, a crafting tutorial, boat travel, arriving at a shop, etc.) add
// their narration HERE, keyed by their own stage id, rather than spawning
// a parallel introBNarration.ts/boatNarration.ts/shopNarration.ts/etc. one
// file per feature. There is exactly one intro narration authoring source.
//
// Named introNarrationData.ts, not the more obvious introNarration.ts —
// Windows' filesystem is case-insensitive, and `introNarration.ts` and the
// presentational component `IntroNarration.tsx` differ only in the first
// letter's case, which TypeScript (correctly) refuses to treat as two
// distinct files (TS1149). Same constraint, same workaround pattern
// already established for introAConfig.ts vs IntroA.tsx.
//
// Centralizes every narration string + its timing in one plain,
// serializable table, the same way src/introPartB.ts centralizes stage
// 15-18's cinematic DIALOGUE/timing constants (see that file's own header
// comment) and DialogueBox.tsx reads its lines from data rather than
// hardcoding them inline. This is deliberately NOT a generic dialogue/scene
// engine — it's per-stage flat, ORDERED lists of narration beats. Whichever
// component owns a given intro stage (today: IntroA.tsx for the six
// 'laptop-off'..'myll-tired' stages below) walks ITS OWN stage's list
// strictly in order via nextBeat(stage, id), called at the exact cinematic
// point each beat belongs to.
//
// Design rules every stage's beat list follows (do not violate when
// editing):
//  - Only one beat is ever visible at a time within a stage (nextBeat()
//    clears the previous one before/while showing the next).
//  - A gap in a stage's script (a cinematic beat with nothing shown) is
//    INTENTIONAL silence — the owning component simply doesn't call
//    nextBeat() at that point. Do not backfill silences with extra lines.
//  - No beats exist for the "mail inbox" or "read the rejection email
//    itself" cinematic beats — narration only starts once the reaction to
//    the email begins (see the 'rejection-email' stage below).

import narrationOverridesData from './data/introNarrationOverrides.json';

// Every intro/onboarding stage that CURRENTLY has narration wired up to it.
// This union only lists stages with real, implemented owning code — it is
// NOT a speculative pre-declaration of every stage the intro might ever
// grow (see the module comment above for examples of what's likely
// coming). When a new intro stage is actually built, add its id here and
// give it an entry below; there's no separate "reserve the name" step.
export type IntroStageId =
  | 'laptop-off'
  | 'laptop-on'
  | 'rejection-email'
  | 'desktop'
  | 'myll-browsing'
  | 'myll-tired';

export interface NarrationBeat {
  /** Stable id, unique within its stage's own list. Referenced by the
   *  owning component's call sites (nextBeat(stage, id)) purely so a
   *  DEV-mode console warning can catch a stage's script and its call
   *  sites drifting out of sync after an edit — it plays no role in
   *  sequencing itself (array order within the stage does). */
  id: string;
  /** The exact on-screen narration text. */
  text: string;
  /** ms of silence after the beat is triggered, before the text appears. */
  delayMs: number;
  /** ms the text stays on screen before clearing. */
  holdMs: number;
}

// Readable name + stable ordering for the DEV Intro Editor's stage list
// (src/DevIntroTab.tsx / src/devIntroNarration.ts). Lives here rather than
// hardcoded in the editor itself, per that feature's own design rule: the
// editor reads its stage list from THIS module, never from a separately
// maintained copy — adding a future stage to IntroStageId above still only
// needs an entry added here (and its own beat list below) to show up in the
// editor too.
export const INTRO_STAGE_ORDER: IntroStageId[] = [
  'laptop-off',
  'laptop-on',
  'rejection-email',
  'desktop',
  'myll-browsing',
  'myll-tired',
];

export const INTRO_STAGE_LABELS: Record<IntroStageId, string> = {
  'laptop-off': 'Laptop Off — Dark Room',
  'laptop-on': 'Laptop On — 1 New Mail',
  'rejection-email': 'Rejection Email',
  desktop: 'Desktop',
  'myll-browsing': 'MYLL — Browsing',
  'myll-tired': 'MYLL — Growing Tired',
};

// Keyed by stage — a stage with no narration yet (or ever) simply has no
// entry here, rather than an empty array. Consumers read
// `INTRO_NARRATION[stage] ?? []`.
//
// HAND-AUTHORED BASE. Never mutated by the DEV Intro Editor — same
// "base file + override file merged at load time" precedent as world.ts's
// STRUCT_ENTS_BASE/worldOverrides.json. The editor writes to
// src/data/introNarrationOverrides.json instead (see INTRO_NARRATION_OVERRIDES
// and the merge below); THIS constant stays exactly what a person typed.
const INTRO_NARRATION_BASE: Partial<Record<IntroStageId, NarrationBeat[]>> = {
  // ---- Laptop off — dark room ----
  'laptop-off': [
    { id: 'laptop-off-1', text: 'Another long day...', delayMs: 300, holdMs: 1700 },
    {
      id: 'laptop-off-2',
      text: 'I should probably check my laptop before I call it a night.',
      delayMs: 500,
      holdMs: 2000,
    },
  ],

  // ---- Laptop on — 1 new mail ----
  'laptop-on': [
    { id: 'laptop-on-1', text: 'Oh, one new email.', delayMs: 400, holdMs: 1500 },
    { id: 'laptop-on-2', text: 'Maybe this time it’s good news.', delayMs: 300, holdMs: 1700 },
  ],

  // ---- Mail inbox: NO narration (see module header) ----

  // ---- Rejection email — after the cursor's own reading pass ----
  'rejection-email': [
    { id: 'rejection-1', text: '...Right.', delayMs: 500, holdMs: 1300 },
    { id: 'rejection-2', text: 'That’s the twelfth rejection this month.', delayMs: 300, holdMs: 2000 },
    {
      id: 'rejection-3',
      text: 'I knew all this AI stuff was changing things, but... I didn’t think I’d feel it this much.',
      delayMs: 900,
      holdMs: 3000,
    },
    {
      id: 'rejection-4',
      text: 'Maybe I should figure out what I could actually do with it.',
      delayMs: 700,
      holdMs: 2400,
    },
    { id: 'rejection-5', text: '...Tomorrow.', delayMs: 500, holdMs: 1300 },
    { id: 'rejection-6', text: 'I’m way too tired to think about this now.', delayMs: 200, holdMs: 1800 },
  ],

  // ---- Desktop ----
  desktop: [
    { id: 'desktop-1', text: 'I should really just go to bed.', delayMs: 700, holdMs: 1800 },
    {
      id: 'desktop-2',
      text: '...But MYLL did just drop their summer collection.',
      delayMs: 500,
      holdMs: 2000,
    },
    { id: 'desktop-3', text: 'Just a quick look.', delayMs: 300, holdMs: 1300 },
  ],

  // ---- MYLL — shopping/browsing ----
  'myll-browsing': [
    { id: 'myll-1', text: 'Okay... just a few minutes.', delayMs: 300, holdMs: 1500 },
    { id: 'myll-2', text: 'Oh, that’s cute.', delayMs: 200, holdMs: 1200 },
    { id: 'myll-3', text: '...That too.', delayMs: 200, holdMs: 1100 },
    { id: 'myll-4', text: 'I could actually use some new shoes...', delayMs: 300, holdMs: 1600 },
    {
      id: 'myll-5',
      text: 'Why do I always find things I want when I’m trying not to spend money?',
      delayMs: 400,
      holdMs: 2600,
    },
    { id: 'myll-6', text: 'I’ll just look.', delayMs: 500, holdMs: 1200 },
    { id: 'myll-7', text: 'Ugh... I want that too.', delayMs: 300, holdMs: 1300 },
    { id: 'myll-8', text: 'Maybe someday.', delayMs: 400, holdMs: 1600 },
  ],

  // ---- Gradually becoming tired ----
  'myll-tired': [
    { id: 'tired-1', text: 'Let’s see what else they have...', delayMs: 300, holdMs: 1400 },
    // (first subtle blink happens between tired-1 and tired-2 — see IntroA.tsx)
    { id: 'tired-2', text: 'Hmm...', delayMs: 400, holdMs: 1100 },
    { id: 'tired-3', text: 'That’s nice too...', delayMs: 400, holdMs: 1400 },
    // (longer blink, then cursor pauses, between tired-3 and tired-4)
    { id: 'tired-4', text: 'I really should stop scrolling.', delayMs: 600, holdMs: 1800 },
    // (pause, then she scrolls again anyway, between tired-4 and tired-5)
    { id: 'tired-5', text: '...Just one more.', delayMs: 500, holdMs: 1500 },
    // (another blink, then an INTENTIONAL silent beat with no narration, then
    // one final small cursor movement, all between tired-5 and tired-6 — see
    // IntroA.tsx. Do not add a beat to fill that silence.)
    { id: 'tired-6', text: '...', delayMs: 500, holdMs: 1400 },
    // (final eyelid closure -> BLACK -> seamless handoff into wake-in-ASCIIA-BAY)
  ],
};

// Dev-authored overrides, written by the DEV Intro Editor (src/devIntroNarration.ts)
// via a Vite dev-only middleware (see vite.config.ts's introNarrationSavePlugin)
// straight to src/data/introNarrationOverrides.json — same shape as
// INTRO_NARRATION_BASE above (stage id -> ordered beat array), same spirit as
// worldOverrides.json mirroring Ent[]'s own shape. A stage present here
// REPLACES that stage's base array wholesale (the editor always saves a
// stage's FULL current beat list, never a partial patch), so there is never
// any per-beat merge ambiguity between base and override. Starts as `{}`.
export const INTRO_NARRATION_OVERRIDES: Partial<Record<IntroStageId, NarrationBeat[]>> =
  narrationOverridesData as Partial<Record<IntroStageId, NarrationBeat[]>>;

// The ACTUAL narration every stage's owning component (IntroA.tsx today)
// reads — base merged with the saved override, computed once at module load
// (both in `vite dev` and in a production build, so a saved override
// genuinely becomes real shipped content, not just a dev-session preview).
// IntroA.tsx imports THIS, never INTRO_NARRATION_BASE directly.
export const INTRO_NARRATION: Partial<Record<IntroStageId, NarrationBeat[]>> = (() => {
  const merged: Partial<Record<IntroStageId, NarrationBeat[]>> = { ...INTRO_NARRATION_BASE };
  for (const stage of Object.keys(INTRO_NARRATION_OVERRIDES) as IntroStageId[]) {
    const beats = INTRO_NARRATION_OVERRIDES[stage];
    if (beats) merged[stage] = beats;
  }
  return merged;
})();

// ---- How a future DEV Intro Editor plugs into this data ----
// - Editing TEXT: change a beat's `text` field. No other file needs to
//   change.
// - Editing TIMING: change `delayMs` (silence before the beat appears) or
//   `holdMs` (how long the fully-typed line stays up) on any beat. Purely
//   data — nextBeat() reads both fields fresh every call, nothing cached.
// - Editing ORDER: reorder entries within a stage's array. Since the
//   owning component consumes each stage's list strictly in sequence (not
//   by id lookup), the new order plays out automatically next run — AS
//   LONG AS the number of beats in that stage stays the same (moving
//   'rejection-3' before 'rejection-2' is safe; deleting or adding a beat
//   is not — see the next bullet).
// - Adding/removing beats or inserting a new SILENT beat: requires a
//   matching change to the nextBeat()/skip-silence call sites in the
//   owning component (IntroA.tsx for the stages above), since call-site
//   placement is what ties a script position to a specific cinematic
//   moment (cursor move, blink, scene transition, etc.) — the editor would
//   need to either (a) only offer retext/retime/reorder of the EXISTING
//   beat count per stage, which needs no code change, or (b) also let the
//   author re-point a specific call site at a different array index for
//   stages with optional/variable beat counts. (b) is out of scope for now;
//   ship (a) first.
// - Adding a NEW STAGE'S narration (e.g. once a 'guided-exploration' or
//   'crafting-tutorial' stage actually exists in code): add its id to
//   IntroStageId above and a new keyed array here — no other stage's data
//   or the owning-component wiring for THIS file's existing stages needs
//   to change.
// - Editing SCENE ASSET (which /intro/*.png a Stage-A scene shows,
//   product/category cursor-target coordinates, cross-fade/scroll/blink
//   durations): lives in introAConfig.ts (INTRO_CONFIG / SHOT2_CONFIG /
//   SHOT3_CONFIG / PRODUCTS / SECTION2_ITEMS / TIRED_ITEMS / the
//   TIRED_BLINK_* constants), not here — also plain exported data, same
//   editability story. Once non-Stage-A stages exist, their own scene-asset
//   config lives wherever THEIR owning component's config does, same
//   convention.
