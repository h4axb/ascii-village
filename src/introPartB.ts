// Central config for Intro Part B — the "wake up, meet Mitchy" onboarding
// cinematic. Every tunable narrative/timing value used by the cinematic
// (driven from App.tsx) lives here so it's not scattered across the
// implementation, per the feature's own requirement to keep these
// centralized/clearly identifiable.

export const MITCHY_NAME = 'Mitchy';
export const SHOP_NAME = "Mitchy's Shop";

export const PLAYER_NAME_STORAGE_KEY = 'playerName'; // SaveState.playerName
export const DEFAULT_PLAYER_NAME = 'Villager';

// Required Scene Marking IDs (see src/sceneMarkers.ts). Positions are
// authored in-editor — never hardcode fallback coordinates for these.
export const MARKER_PLAYER_START = 'intro.partB.playerStart';
export const MARKER_MITCHY_START = 'intro.partB.mitchyStart';
export const MARKER_MITCHY_EXIT = 'intro.partB.mitchyExit';

// Timing (ms)
export const BLACK_SCREEN_MS = 2500;
export const EYE_OPEN_MS = 700;
export const MITCHY_JUMP_MS = 380;
export const POST_EXIT_DELAY_MS = 1000;
export const LETTERBOX_TRANSITION_MS = 700;

// Movement (world units/sec — same ch/em grid as player movement)
export const MITCHY_ENTRANCE_SPEED = 9;
export const MITCHY_EXIT_SPEED = 9;
export const MITCHY_JUMP_HEIGHT_EM = 1.1;

// How far off-camera (world units, beyond the visible viewport edge) Mitchy's
// derived entrance start position sits before he starts running in.
export const MITCHY_ENTRANCE_OFFSET = 8;

// Letterbox bar size (vh) — the ONE shared size used everywhere the
// letterbox appears: Intro Stage A's prologue (IntroA.tsx, which also
// shrinks its 16:9 stage to fit the space between the bars rather than
// letting them cover/crop it — see that file's stage-sizing comment) and
// the in-world stage-15+ wake-up/Mitchy cinematic (Letterbox.tsx). Sized
// generously enough that Stage A's bottom-bar narration text (see
// IntroNarration.tsx) has real breathing room around it, not just enough
// to fit.
export const LETTERBOX_BAR_VH = 16;

// Dialogue — speaker '???' is used before Mitchy introduces himself.
export const UNKNOWN_SPEAKER = '???';

export const WAKE_LINE = 'Hey! Wake up!';

export const MITCHY_INTRO_LINES: { speaker: string; text: string }[] = [
  { speaker: UNKNOWN_SPEAKER, text: 'Hi! You must be the new villager.' },
  { speaker: UNKNOWN_SPEAKER, text: "Sorry I'm late. I had a little trouble getting here." },
  { speaker: MITCHY_NAME, text: `I'm ${MITCHY_NAME}, the owner of ${SHOP_NAME}.` },
  { speaker: MITCHY_NAME, text: "What's your name?" },
];

// {PLAYER_NAME} is substituted at render time — see substitutePlayerName().
export const MITCHY_POST_NAME_LINES: { speaker: string; text: string }[] = [
  { speaker: MITCHY_NAME, text: 'Nice to meet you, {PLAYER_NAME}.' },
  {
    speaker: MITCHY_NAME,
    text: "Why don't you look around for a bit? You'll find your house on the north side of the island.",
  },
  { speaker: MITCHY_NAME, text: 'If you get lost, press {KEY:M} to open your map.' },
  { speaker: MITCHY_NAME, text: 'Anything else before you head out?' },
];

export const TUTORIAL_CHOICES = ['So, where should I start?', "I think I'm good!"] as const;

export const CHOICE_EXPLORE_LINES: { speaker: string; text: string }[] = [
  {
    speaker: MITCHY_NAME,
    text: 'Why don\'t you explore a little? Collect whatever catches your eye and bring it back to your new house.',
  },
  { speaker: MITCHY_NAME, text: 'Make the place feel like your own!' },
  {
    speaker: MITCHY_NAME,
    text: "Oh, and if you ever forget how something works, you'll find all the controls under {SETTINGS_CONTROLS}.",
  },
];

export const DEPARTURE_LINES: { speaker: string; text: string }[] = [
  { speaker: MITCHY_NAME, text: "Alright! I'll be waiting by the bridge on the east side." },
  { speaker: MITCHY_NAME, text: 'Come find me if you still have questions or when you\'re done looking around.' },
];

export const MAP_KEY = 'm';
export const MAP_CHAR_MARKER_SIZE_PX = 14;
// World TILE units (same grid as player.x/y, Ent.x/y and every scene marker)
// -> map overview px. NOTE: originally authored as a ch/em multiplier
// (0.14); re-derived against actual world TILE units instead, since every
// coordinate GameMap.tsx actually has on hand (player/Mitchy positions,
// STRUCT_ENTS positions, scene markers) is already in tiles, not ch/em — see
// GameMap.tsx's worldToMapPx(). Value picked so the full MAP_W×MAP_H (130×145
// tile) map renders at a comfortably screen-filling ~550×610px.
export const MAP_OVERVIEW_SCALE = 4.2;
export const MAP_OVERVIEW_PADDING_PX = 24;
export const MAP_CHAR_MARKER_SIZE_PX_MITCHY = 14;

// World asset categories drawn on the semi-static map layer. Anything not
// listed here is skipped for map-readability reasons (flowers, grass
// glyphs, tiny decor, particles, collectibles).
export const MAP_VISIBLE_ASSET_KINDS = ['structure', 'water', 'path', 'landmark'] as const;

// The transient "M — Map" contextual hint shown once, right after control is
// restored at the end of Part B — fades on its own, never repeats.
export const MAP_HINT_VISIBLE_MS = 3200;
export const MAP_HINT_FADE_MS = 600;

// How far (world tile units) Mitchy's temporary off-camera entrance spot
// sits beyond the camera's visible right edge, before MITCHY_ENTRANCE_OFFSET
// (also tile units) is added on top — see App.tsx's runIntro (stage 15).
export const MITCHY_OFFCAM_START_MARGIN = 0;

// Dev-only manual retrigger of stages 15-18 (see App.tsx's
// `window.__replayIntro` — a console function, deliberately NOT an
// on-screen button: a visible button in the corner during ordinary gameplay
// turned out to be too easy to click by accident; the separate DEV-only
// on-screen "Skip Intro" button covers stages 1-14 and normal early
// testing instead). Doesn't wipe the rest of the save.
//
// `locked`/auto-advance mode (DialogueBox/NameEntryPanel ignore clicks and
// advance on a timer instead — see AUTO_ADVANCE_MS below) is a separate,
// optional thing a caller of __replayIntro can opt into via a plain
// `window.__introBAuto` flag set just before calling it, for an automated
// test harness that can't reliably deliver real click events. Nothing sets
// this on a normal gameplay session, so it never activates on its own.
export const AUTO_ADVANCE_MS = 2000;

export function substitutePlayerName(text: string, playerName: string): string {
  return text.replace(/\{PLAYER_NAME\}/g, playerName);
}

// Inline keyword-highlight tokens DialogueBox recognizes and renders as a
// yellow key-hint span — `{KEY:M}` becomes a highlighted "M", and
// `{SETTINGS_CONTROLS}` becomes a highlighted "Settings → Controls". Kept
// here (not hardcoded in DialogueBox) so a future line can introduce a new
// token id without touching the component, just this table.
export const DIALOGUE_HIGHLIGHT_LABELS: Record<string, string> = {
  SETTINGS_CONTROLS: 'Settings → Controls',
};
