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
// /2 runs the reversed order.
export const ORDERS: Partial<Record<string, [Cond, Cond]>> = {
  '1': ['pre', 'post'], // order "AB"
  '2': ['post', 'pre'], // order "BA"
};
export const QUEST_ORDER: [Cond, Cond] | null = ORDERS[LINK] ?? null;
export const QUEST_ENABLED = QUEST_ORDER !== null;

// The external survey opened at the very end (Tally), with ?order=…&test_id=…
// added for the run (quest/session.ts surveyUrl)
export const FINAL_SURVEY_URL = 'https://tally.so/r/7R8900';

export type StepId =
  | 'explore'
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

// A step's hint: played only when the player clicks the light bulb in the
// quest panel (App.tsx's runHint). `focus` locks the player and glides the
// camera to the objective (then back); `bubble` leaves a "!" over it until
// the step is done; `sparkles` twinkle around the nearest resources; `blink`
// flashes the Controls bookmark; `card` is a picture hint in a modal - its
// pages describe the picture in [brackets] until the art is drawn.
export type HintTarget = 'resource' | 'house' | 'mitchy' | 'pond' | 'garden' | 'crop';
export interface Hint {
  focus?: HintTarget;
  bubble?: boolean;
  sparkles?: boolean;
  blink?: 'controls';
  card?: { pages: string[] };
}

export interface Objective {
  id: StepId;
  title: string;
  icon?: string;
  task?: string; // the line next to the icon
  target?: number; // a progress counter (gather, explore)
  sub: string; // the goal
  hint: Hint;
}
export interface Questline {
  title: string;
  intro: string; // under the questline title
  steps: Objective[];
  done: { title: string; text: string }; // the QUEST COMPLETE popup
}

export const GATHER_TARGET = 3;
export const EXPLORE_TILES = 10; // YOUR FIRST STEPS: walk this far

export const QUESTLINE_1: Questline = {
  title: 'NEW BEGINNINGS',
  intro: 'Your new life on ASCIIA Bay starts here.',
  steps: [
    {
      id: 'explore',
      title: 'YOUR FIRST STEPS',
      icon: '👣',
      task: 'Walk around a little',
      sub: 'Look around a little to orientate.',
      hint: { blink: 'controls' },
    },
    {
      id: 'gather',
      title: 'LITTLE THINGS ADD UP',
      icon: '🌸',
      task: `Collect ${GATHER_TARGET} resources`,
      target: GATHER_TARGET,
      sub: 'Gather a few useful things to start your new life here.',
      hint: { focus: 'resource', sparkles: true },
    },
    {
      id: 'store',
      title: 'MAKE YOURSELF AT HOME',
      icon: '🏠',
      task: 'Store something at home',
      sub: 'Find a place for the things you’ve gathered.',
      hint: { focus: 'house', bubble: true },
    },
    {
      id: 'mitchy',
      title: 'CHECK IN WITH MITCHY',
      icon: '🐾',
      task: 'Talk to Mitchy',
      sub: 'Let Mitchy know how you’re settling in.',
      hint: { focus: 'mitchy', bubble: true },
    },
    {
      id: 'vehicle',
      title: 'BEYOND THE SHORE',
      icon: '🛶',
      task: 'Craft a way across the water',
      sub: 'Find your own way across the water to Mitchy’s shop.',
      hint: {
        card: {
          pages: [
            '[Picture: a little boat inside a speech bubble]\nUse the crafting token from your inventory to make something that floats, then place it on the water.',
          ],
        },
      },
    },
  ],
  done: { title: 'NEW BEGINNINGS', text: 'Your first adventure brought you all the way across the bay!' },
};

export const QUESTLINE_2: Questline = {
  title: 'GROWING ROOTS',
  intro: 'Time to make this little island feel more like home.',
  steps: [
    {
      id: 'tool',
      title: 'A GARDEN OF YOUR OWN',
      icon: '💧',
      task: 'Craft a watering tool',
      sub: 'Create something to help your first plant grow.',
      hint: {
        card: {
          pages: [
            '[Picture: a watering can inside a speech bubble]\nBuy a crafting token in Mitchy’s shop and create something that can water plants.',
          ],
        },
      },
    },
    {
      id: 'fill',
      title: 'A LITTLE WATER GOES A LONG WAY',
      icon: '💦',
      task: 'Fill it at the pond',
      sub: 'Find some fresh water for your new creation.',
      hint: { focus: 'pond', bubble: true },
    },
    {
      id: 'plant',
      title: 'PUT DOWN ROOTS',
      icon: '🌱',
      task: 'Plant your seed',
      sub: 'Find the perfect little spot for your seed.',
      hint: { focus: 'garden', bubble: true },
    },
    {
      id: 'water',
      title: 'HELP IT FLOURISH',
      icon: '💧',
      task: 'Water your plant',
      sub: 'Give your new plant the care it needs to grow.',
      hint: {
        card: {
          pages: [
            '[Picture: the I key inside a speech bubble]\nPress I to open your inventory.',
            '[Picture: the inventory opens, the watering can is clicked and equipped - equip animation]\nHold your watering tool, then walk up to your plant and press F.',
          ],
        },
      },
    },
    {
      id: 'harvest',
      title: 'THE FIRST HARVEST',
      icon: '🌿',
      task: 'Harvest your plant',
      sub: 'Enjoy the first fruits of your care.',
      hint: { focus: 'crop', bubble: true },
    },
    {
      id: 'companion',
      title: 'A FRIEND OF YOUR OWN',
      icon: '🐾',
      task: 'Craft and equip a companion',
      sub: 'Bring a little companion into your new life.',
      hint: { focus: 'mitchy', bubble: true },
    },
    {
      id: 'report',
      title: 'SOMETHING TO SHOW',
      icon: '🐈',
      task: 'Talk to Mitchy',
      sub: 'Share what you’ve accomplished with Mitchy.',
      hint: { focus: 'mitchy', bubble: true },
    },
  ],
  done: { title: 'GROWING ROOTS', text: 'Little by little, this place is becoming your own.' },
};

export const REPLAY: Questline = {
  title: 'SECOND JOURNEY',
  intro: 'A familiar journey, with another way to bring your ideas to life.',
  steps: [
    {
      id: 'vehicle',
      title: 'ACROSS THE BAY, ONCE MORE',
      icon: '🛶',
      task: 'Craft a way across the water',
      sub: 'Create another way to reach Mitchy’s shop.',
      hint: { card: { pages: ['[Picture: a ship with a ? on it]\nYour crafting token can make something that floats.'] } },
    },
    {
      id: 'tool',
      title: 'A GARDEN OF YOUR OWN',
      icon: '💧',
      task: 'Craft a watering tool',
      sub: 'Create something to help your next plant grow.',
      hint: { card: { pages: ['[Picture: a watering can with a ? above it]\nCreate something that can water plants.'] } },
    },
    {
      id: 'fill',
      title: 'A LITTLE WATER GOES A LONG WAY',
      icon: '💦',
      task: 'Fill it at the pond',
      sub: 'Find some fresh water for your new creation.',
      hint: { focus: 'pond', bubble: true },
    },
    {
      id: 'plant',
      title: 'PUT DOWN ROOTS',
      icon: '🌱',
      task: 'Plant your seed',
      sub: 'Find a little spot for your next seed.',
      hint: { focus: 'garden', bubble: true },
    },
    {
      id: 'water',
      title: 'HELP IT FLOURISH',
      icon: '💧',
      task: 'Water your plant',
      sub: 'Help your plant grow.',
      hint: { card: { pages: ['[Picture: the player walks up to the seed, then the F key]\nWith your watering tool in hand, walk up to your plant and press F.'] } },
    },
    {
      id: 'harvest',
      title: 'THE FIRST HARVEST',
      icon: '🌿',
      task: 'Harvest your plant',
      sub: 'Gather what you’ve grown.',
      hint: { card: { pages: ['[Picture: the player stands next to the grown crop, the F key]\nOnce it has grown, stand next to it and press F.'] } },
    },
    {
      id: 'companion',
      title: 'A FRIEND OF YOUR OWN',
      icon: '🐾',
      task: 'Craft and equip a companion',
      sub: 'Bring another little companion into your world.',
      hint: { focus: 'mitchy' },
    },
    {
      id: 'report',
      title: 'SOMETHING TO SHOW',
      icon: '🐈',
      task: 'Talk to Mitchy',
      sub: 'Share your creations with Mitchy.',
      hint: { focus: 'mitchy', bubble: true },
    },
  ],
  done: { title: 'SECOND JOURNEY', text: 'You’ve explored two different ways to bring your ideas to life!' },
};

// The housewarming gift (after the first trip to the shop, and again in the
// replay): two seeds, named only by a hint so what grows stays a surprise
export type SeedKind = 'strawberry' | 'pumpkin';
export const SEED_CHOICES: { kind: SeedKind; option: string; name: string; desc: string }[] = [
  {
    kind: 'strawberry',
    option: 'Tiny sweet seed',
    name: 'Tiny sweet seed',
    desc: 'Mitchy’s gift. It dreams of something small, red and sweet.',
  },
  {
    kind: 'pumpkin',
    option: 'Round golden seed',
    name: 'Round golden seed',
    desc: 'Mitchy’s gift. It dreams of something big, round and golden.',
  },
];

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
  // the housewarming gift at the shop (SEED_CHOICES)
  giftOffer: 'Welcome to my little shop! Every new villager gets a housewarming gift. Pick one, but I won’t tell you what grows.',
  giftOfferAgain: 'Back again! Here, another seed for your garden. Which one this time?',
  giftThanks: 'Good pick. Plant it somewhere nice and give it a drink.',
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
  // the crafted water vehicle
  launch: 'Place it on the water.',
  board: 'Sail',
  stow: 'Put back in inventory',
  landAsk: 'Go ashore here?',
  landFar: 'get a little closer to the shore first.',
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

// ---- first discoveries: a small toast the first time the player does each
// of these during the quests (App.tsx's discover), playful since there's no
// completion animation ----
export type DiscoveryId = 'resource' | 'settings' | 'controls' | 'map' | 'home';
export const DISCOVERIES: Record<DiscoveryId, { title: string; sub: string }> = {
  resource: { title: 'A Pocketful of Possibilities', sub: 'Collect resources to use, store, or sell later.' },
  settings: { title: 'A Little Know-How', sub: 'You can revisit Settings anytime.' },
  controls: { title: 'You’re Getting the Hang of It', sub: 'You can revisit Controls anytime.' },
  map: { title: 'The Lay of the Land', sub: 'Use your map to find your way around the island.' },
  home: { title: 'A Place to Call Your Own', sub: 'Store your collected items safely here.' },
};
