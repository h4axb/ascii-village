// Which test link opened the game: /0 (and / or /intro), /1, /2 or /3, each
// also as /intro/N. See App.tsx for what each link changes.
//
// All links run on one origin, so they share the browser's storage; every
// per-game key goes through linkKey() so each link keeps its OWN save and
// craft history. /0 keeps the original key names (existing saves stay
// /0's); /intro/N shares N's keys.
export type Link = '0' | '1' | '2' | '3';

const m = /^(?:\/intro)?\/([0-3])\/?$/.exec(window.location.pathname);
export const LINK: Link = (m?.[1] as Link | undefined) ?? '0';

export const linkKey = (base: string) => (LINK === '0' ? base : `${base}-${LINK}`);
// the key `base` has on another link (an uploaded save that belongs there)
export const linkKeyFor = (base: string, link: Link) => (link === '0' ? base : `${base}-${link}`);
