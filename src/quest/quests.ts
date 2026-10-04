// The guided quest flow and the two-condition user test (the /1 link; /2
// will run the same flow with the conditions reversed). Data only: the
// questlines, Mitchy's lines, the rating questions and the survey link.
// Progress lives in SaveState.quest (state.ts); App.tsx drives it.
//
//   Questline 1  NEW BEGINNINGS   controls → gather → store → Mitchy
//                                 (cinematic A: token) → water vehicle
//                                 (cinematic B: sail to the shop)
//   Questline 2  GROWING ROOTS    watering tool → fill → plant → water →
//                                 harvest → companion → report back
//   rating questions (condition 1) → test transition (black screen)
//   SECOND JOURNEY                the crafting part again, condition 2
//                                 (cinematic C after the vehicle)
//   rating questions (condition 2) → final survey
import { LINK } from '../link';

// The two crafting panels under test
export type Cond = 'pre' | 'post'; // pre-clarification (CraftClarify) / post-reflection (CraftFeedback)

// Which link runs the quest flow, and in which order the conditions come.
// /2 gets the reversed order once the user switches it on.
const ORDERS: Partial<Record<string, [Cond, Cond]>> = {
  '1': ['pre', 'post'],
  // '2': ['post', 'pre'],
};
export const QUEST_ORDER: [Cond, Cond] | null = ORDERS[LINK] ?? null;
export const QUEST_ENABLED = QUEST_ORDER !== null;

// The external survey opened at the very end. Paste the link here.
export const FINAL_SURVEY_URL = '';

export type StepId =
  | 'controls'
  | 'gather'
  | 'store'
  | 'mitchy'
  | 'vehicle'
  | 'tool'
  | 'fill'
  | 'plant'
  | 'water'
  | 'harvest'
  | 'companion'
  | 'report';

export interface Objective {
  id: StepId;
  title: string;
  icon?: string;
  task?: string; // the line next to the icon
  target?: number; // a progress counter (gather)
  sub: string;
}
export interface Questline {
  title: string;
  steps: Objective[];
  done: { title: string; text: string }; // the QUEST COMPLETE popup
}

export const GATHER_TARGET = 12;

export const QUESTLINE_1: Questline = {
  title: 'NEW BEGINNINGS',
  steps: [
    {
      id: 'controls',
      title: 'LEARN THE CONTROLS',
      task: 'Open the Controls panel',
      sub: 'Take a moment to see how to move, interact, and explore the island.',
    },
    {
      id: 'gather',
      title: 'FIELD GATHERING',
      icon: '🌸',
      task: `Collect ${GATHER_TARGET} resources`,
      target: GATHER_TARGET,
      sub: 'Look around the island and gather materials growing in the field.',
    },
    {
      id: 'store',
      title: 'A PLACE TO KEEP THINGS',
      icon: '🏠',
      task: 'Find your house and store one item',
      sub: 'Your house is to the north. Open the map if you need help finding it, then store one gathered item there.',
    },
    {
      id: 'mitchy',
      title: 'FIND MITCHY',
      icon: '🐾',
      task: 'Return to Mitchy',
      sub: 'You have the basics down. Mitchy should be waiting for you.',
    },
    {
      id: 'vehicle',
      title: 'BUILD A WAY ACROSS',
      icon: '🛶',
      task: 'Craft a water vehicle',
      sub: 'Use Mitchy’s crafting token to create something that can carry you across the water.',
    },
  ],
  done: { title: 'NEW BEGINNINGS', text: 'You found your footing on ASCIIA Bay.' },
};

// Questline 2 and the replay share these steps (the replay's texts differ
// only where the user's spec words them differently)
const growing = (replay: boolean): Objective[] => [
  {
    id: 'tool',
    title: 'PREPARE YOUR GARDEN',
    icon: '💧',
    task: 'Craft a watering tool',
    sub: replay
      ? 'Buy a crafting token and create something you can use to water plants.'
      : 'Buy a crafting token from Mitchy’s shop and create something you can use to water plants.',
  },
  {
    id: 'fill',
    title: 'FILL YOUR WATERING TOOL',
    icon: '💦',
    task: 'Fill the watering tool',
    sub: 'Head to the pond in the south of the main island and fill your watering tool.',
  },
  {
    id: 'plant',
    title: 'PLANT SOMETHING',
    icon: '🌱',
    task: 'Plant a seed',
    sub: replay
      ? 'Choose a planting spot and plant a seed.'
      : 'Choose a planting spot and plant a seed. You can find seeds while gathering plants.',
  },
  {
    id: 'water',
    title: 'HELP IT GROW',
    icon: '💧',
    task: 'Water the plant',
    sub: 'Use your filled watering tool on the planted seed.',
  },
  {
    id: 'harvest',
    title: 'FIRST HARVEST',
    icon: '🌿',
    task: 'Harvest the plant',
    sub: replay
      ? 'Harvest the crop and sell it for the money you need.'
      : 'Your crop is ready. Harvest it and see what it is worth.',
  },
  {
    id: 'companion',
    title: 'A SMALL COMPANION',
    icon: '🐾',
    task: 'Craft and equip a companion',
    sub: replay
      ? 'Sell your harvest, buy another crafting token, and create a little companion.'
      : 'Sell your harvest, buy another crafting token, and create a little companion for your journey.',
  },
  {
    id: 'report',
    title: 'REPORT BACK',
    icon: '🐈',
    task: 'Return to Mitchy',
    sub: replay ? 'Return to Mitchy when you’re finished.' : 'Show Mitchy what you’ve learned.',
  },
];

export const QUESTLINE_2: Questline = {
  title: 'GROWING ROOTS',
  steps: growing(false),
  done: { title: 'GROWING ROOTS', text: 'You’ve learned the basics of life on ASCIIA Bay.' },
};

export const REPLAY: Questline = {
  title: 'SECOND JOURNEY',
  steps: [
    {
      id: 'vehicle',
      title: 'CROSS THE WATER',
      icon: '🛶',
      task: 'Craft a water vehicle',
      sub: 'Use your crafting token to create something that can carry you across the water.',
    },
    ...growing(true),
  ],
  done: { title: 'SECOND JOURNEY', text: 'You’ve completed the second journey.' },
};

// ---- Mitchy's lines (mysterious, enthusiastic, a little odd, warm) ----
export const LINES = {
  // Cinematic A: the token hand-over when the player comes back
  handoverBefore: [
    'Ah. You found your way back. Good. I was beginning to suspect the flowers had adopted you.',
    'You’ve earned something a little special. Hold out your hand.',
  ],
  handoverAfter: [
    'A crafting token. Describe anything to it and it becomes real. Well, mostly.',
    'My shop is across the water. Make us something that floats, and we’ll go together.',
  ],
  // Cinematic B and C: arriving at the shop island (equivalent in length)
  arrive1: 'There it is. My little shop. Come by when you’ve got a moment, I may have something useful for you.',
  arrive2: 'There it is again. My little shop. Come by when you’ve got a moment, I may have something useful.',
  // the temporary option when reporting back
  doneOption: 'I’m done.',
  doneReply: 'Hm. Not bad at all. You’ve picked things up quickly.',
  // before the rating questions (one line, identical for both conditions)
  ratingIntro: 'Before you run off, tell me honestly how that went. A few quick questions.',
  // the very end
  end: [
    'That should do it. You’ve given me quite enough to think about for one day.',
    'There’s one last short survey outside the game. It should take about five minutes.',
  ],
  // the boat, once docked: a short ferry between the islands
  ferry: 'Sail across',
  needFill: 'Your watering tool is empty. Fill it at the pond in the south first.',
};

// ---- the rating questions, identical for both conditions ----
// PLACEHOLDER wording (the user will replace it): neutral, one per area the
// test measures, all on the same 1-5 scale.
export interface RatingQuestion {
  id: string; // stored with the answer; keep stable once testing starts
  text: string;
  low: string; // label under 1
  high: string; // label under 5
}
export const RATING_SCALE = [1, 2, 3, 4, 5] as const;
export const RATING_QUESTIONS: RatingQuestion[] = [
  { id: 'control', text: 'How much control did you feel you had over what was crafted?', low: 'none', high: 'a lot' },
  { id: 'match', text: 'How closely did the crafted results match what you expected?', low: 'not at all', high: 'exactly' },
  { id: 'frustration', text: 'How frustrating was crafting?', low: 'not at all', high: 'very' },
  { id: 'ease', text: 'How easy was it to understand how crafting works?', low: 'very hard', high: 'very easy' },
  { id: 'overall', text: 'How would you rate the crafting experience overall?', low: 'very poor', high: 'very good' },
];

// ---- the test transition screen ----
export const TRANSITION_TEXT = [
  'Thank you for playing the first half of the prototype.',
  'The next section will return you to an earlier point in the tutorial.',
  'You will repeat the crafting-related quests using a different crafting interface. This is intentional and part of the user test.',
  'Your previous progress has not been lost.',
  'Continue whenever you’re ready.',
];
