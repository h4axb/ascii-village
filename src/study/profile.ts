// A participant's profile on the Qualitatives Feedback page: the notes header
// (NotesMeta) read as named fields. The header's "Gruppe" held either the
// order (A→B) or a group of players (e.g. Hobby Gamer); both are told apart
// here. Date and time live together in the free-text slot
// ("18:00-19:30 (20.10.26)") and are split for showing and editing.
import type { NotesMeta } from './types';

// "AB", "A→B", "a - b", "B/A" … → the order; anything else is not one
export function orderOfText(v: string | undefined | null): 'AB' | 'BA' | null {
  const t = (v ?? '').toUpperCase().replace(/[\s→\-–>/]/g, '');
  return t === 'AB' || t === 'BA' ? t : null;
}
export const orderOf = (m?: NotesMeta) => orderOfText(m?.group);

// an all-caps value (the parser used to store groups that way) in title case
const titleCase = (v: string) => (v === v.toUpperCase() && /[A-ZÄÖÜ]{2}/.test(v) ? v.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (x) => x.toUpperCase()) : v);
export function testgroupOf(m?: NotesMeta): string {
  if (!m) return '';
  if (m.testgroup?.trim()) return m.testgroup.trim();
  const g = m.group?.trim();
  return g && !orderOfText(g) ? titleCase(g) : '';
}

// ---- date and time from the slot ----
const DATE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/;
export function parseSlot(slot: string | undefined): { date: string | null; time: string } {
  const s = (slot ?? '').trim();
  const m = DATE.exec(s);
  let date: string | null = null;
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
    date = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const time = (m ? s.replace(m[0], '') : s)
    .replace(/[()]/g, ' ')
    .replace(/\s*[-–]\s*/g, '–')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,–]+|[\s,–]+$/g, '')
    .trim();
  return { date, time };
}
// back into one slot, in the notes' own form: "18:00-19:30 (20.10.26)"
export function composeSlot(time: string, date: string | null): string {
  const t = time.trim().replace(/\s*–\s*/g, '-');
  const d = date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}` : '';
  return t && d ? `${t} (${d})` : t || d;
}
export const fmtIsoDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
// a tracked moment (UTC ms) as an ISO date in Berlin
export const isoOfMs = (ms: number | null) => (ms == null ? null : new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }));

// a test link, short: "intro/1 · 7f3a…9c21"
export function shortLink(url: string): string {
  try {
    const u = new URL(url.trim(), 'https://x.invalid');
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    const k = u.searchParams.get('k');
    const key = k ? (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k) : '';
    return [path, key].filter(Boolean).join(' · ') || url;
  } catch {
    return url;
  }
}
