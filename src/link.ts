// Which test link opened the game: /0 (and / or /intro), /1, /2, /3 or /4,
// each also as /intro/N. See App.tsx for what each link changes. /4 is the
// test of the AI drawing the asset (craft/svgDraw.ts), not a study link.
//
// All links run on one origin, so they share the browser's storage; every
// per-game key goes through linkKey() so each link keeps its OWN save and
// craft history. /0 keeps the original key names (existing saves stay
// /0's); /intro/N shares N's keys.
// /test is the testing link: the /1 quests plus free tokens of both
// crafting variants (App.tsx TEST_LINK), never part of the study data.
export type Link = '0' | '1' | '2' | '3' | '4' | 'test';

const m = /^(?:\/intro)?\/([0-4]|test)\/?$/.exec(window.location.pathname);
// (the review build plays the study flow, as /1, on every path: review.ts)
export const LINK: Link = import.meta.env.VITE_APP_MODE === 'review' ? '1' : ((m?.[1] as Link | undefined) ?? '0');

export const linkKey = (base: string) => (LINK === '0' ? base : `${base}-${LINK}`);
// the key `base` has on another link (an uploaded save that belongs there)
export const linkKeyFor = (base: string, link: Link) => (link === '0' ? base : `${base}-${link}`);
