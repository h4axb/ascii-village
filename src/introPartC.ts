// Intro Part C — the script and constants for returning to Mitchy after the
// guided exploration, paying for a crafting token, and receiving it.
// Driven by App.tsx's Part C controller (runPartC* functions), on the same
// DialogueBox + cinematic-lock machinery as Part B (introPartB.ts).
//
// Part C runs in three implementation steps; this file holds step 1:
//   return to Mitchy → reminder / explanation → pay or collect more →
//   payment Inventory → token handoff.  (Step 2: the quest craft. Step 3:
//   boarding, travel, the shop.)
//
// Mitchy's voice: mysterious, enthusiastic, slightly odd, but always
// understandable. Short boxes, the occasional "Hmm..." or "Ah!", and a pause
// (`pause: true`, a short beat before the line) instead of long monologues.
// No em dashes in his lines.
import { MITCHY_NAME } from './introPartB';

// Progression through the unified intro. 'partB' covers everything up to
// Mitchy walking off to the east coast; Part C's stages follow. `introDone`
// stays false through all of them (see App.tsx).
//   partC:explore     free exploration; talking to Mitchy offers the reminder
//                     or the crafting-token explanation
//   partC:payment     token explained; talking to Mitchy resumes at paying
//   partC:questCraft  token paid for and handed over, unused. Step 2 (the
//                     quest craft) starts here.
export type IntroStage = 'partB' | 'partC:explore' | 'partC:payment' | 'partC:questCraft';
export const isPartC = (s: IntroStage | undefined) => !!s && s.startsWith('partC');

export interface PartCLine {
  text: string;
  pause?: boolean; // a short beat of silence before this line
}
const m = (text: string, pause = false): PartCLine => ({ text, pause });

export const PART_C_SPEAKER = MITCHY_NAME;
export const PART_C_PAUSE_MS = 900;

// ---- walking up to Mitchy during guided exploration ----
// (Not in the brief: the box needs a line to hold the two choices.)
export const RETURN_GREETING = m('Oh? Back so soon.');
export const RETURN_CHOICES = ['Wait, what was I supposed to do again?', "I think I'm done looking around."] as const;

export const OBJECTIVE_REMINDER: PartCLine[] = [
  m('Hmm? Lost your way already?'),
  m('Your house is on the north side. Have a look around, and gather anything interesting you find along the way.'),
  m('You can store your findings at the house. Best not to let useful things go to waste.'),
];

export const TOKEN_EXPLANATION: PartCLine[] = [
  m("Ah, finished looking around? Good. Then there's one more thing you'll need."),
  m('A way across the water.'),
  m('Everyone ought to have something that floats around here. You never know when another shore might start looking interesting.'),
  m('And that brings us to one of my favorite little things.', true),
  m('Crafting tokens.'),
  m('You give one of these a good idea, and... well, interesting things tend to happen.'),
  m('They usually cost 20 gold.'),
  m('But for you? Hmm... 10 will do.', true),
  m("And don't worry if your pockets are suspiciously coinless."),
  m("The things you collect have value too. Bring me enough, and we'll call it a trade."),
];

// ---- the payment choice (after the explanation, and when coming back) ----
// (Not in the brief: the line that holds the choices on a return visit.)
export const PAYMENT_RESUME = m('Ah, there you are. Ready to make that trade?');
export const PAYMENT_CHOICES = ["Okay, I'll pay the 10 gold.", "I'll go collect some more."] as const;

export const COLLECT_MORE: PartCLine[] = [
  m('Of course. Go see what the island is willing to give you.'),
  m("I'll be right here."),
];

// ---- the trade ----
export const TOKEN_PRICE_PART_C = 10;

// "What am I buying again?" — the compact reminder inside the payment
// Inventory. Deliberately never says the craft must describe a boat: the
// quest craft (step 2) turns whatever the player imagines into something
// that floats.
export const PAYMENT_REMINDER = {
  title: 'Crafting Token',
  price: '10 gold',
  goal: 'Get a crafting token from Mitchy. You will use it to craft something that will take you and Mitchy across the water.',
  payment: 'Resources count toward the price based on their coin value.',
};

// ---- token handoff ----
export const HANDOFF_BEFORE: PartCLine[] = [m('Ah! Perfect.')];
export const HANDOFF_AFTER: PartCLine[] = [
  m('There we are. One crafting token.'),
  m('Now... this is where things get interesting.', true),
];
