// The dashboard's "Save all participants": one JSON file per participant
// with everything about them (their links, a summary, and the whole run as
// one timeline: quest steps, hints, crafts with the whole conversation,
// ratings, errors, the survey), packed into one ZIP. Unfiltered: every
// participant, all time. Records without a participant id (the open test
// links) go into no-participant.json.
import { conditionOf, designOf, type FeedbackRecord } from './schema';
import type { RunEvent } from '../quest/runlog';

// the fields of a personal link this needs (Dashboard.tsx Invite)
export interface ExportInvite {
  key: string;
  link: string;
  note: string;
  created: number;
  started: number | null;
  completed: number | null;
  participant_id: string | null;
  crafts_allowed: number;
  crafts_used: number;
  bonus_tokens: number;
  consented?: number | null;
  last_seen?: number | null;
  expiresAt: number | null;
}

// how a link's run ended: the survey; or, its time over without the
// survey, when the game was last open ('closed': left before the survey;
// 'expired' only when the game never told); or not yet
export function endOf(i: ExportInvite): { at: number; how: 'finished' | 'closed' | 'expired' } | null {
  if (i.completed) return { at: i.completed, how: 'finished' };
  if (i.started && i.expiresAt && Date.now() > i.expiresAt)
    return i.last_seen ? { at: Math.min(i.last_seen, i.expiresAt), how: 'closed' } : { at: i.expiresAt, how: 'expired' };
  return null;
}

// ---- several links of one person: P009.1, P009.2, … ----
// by start order (unstarted ones last); a person with one link keeps "P009"
export function linkLabels(invites: ExportInvite[]): Map<string, string> {
  const out = new Map<string, string>();
  const by = new Map<string, ExportInvite[]>();
  for (const i of invites) if (i.participant_id) by.set(i.participant_id, [...(by.get(i.participant_id) ?? []), i]);
  for (const [id, list] of by) {
    const sorted = [...list].sort((a, b) => (a.started ?? Infinity) - (b.started ?? Infinity) || a.created - b.created);
    sorted.forEach((i, n) => out.set(i.key, list.length > 1 ? `${id}.${n + 1}` : id));
  }
  return out;
}
// which of a person's links a record belongs to: the link it came from
// (newer run-log events carry its key), else the link of that person that
// had started last by then
export function linkOfRecord<T extends ExportInvite>(r: { participant?: string; at: number; key?: string }, invites: T[]): T | null {
  if (r.key) return invites.find((i) => i.key === r.key) ?? null;
  const mine = invites.filter((i) => i.participant_id === r.participant && i.started && i.started <= r.at + 60000);
  return mine.sort((a, b) => (b.started ?? 0) - (a.started ?? 0))[0] ?? null;
}
// a record's sub-id (P009.2), or its participant id
export function subIdOf(r: { participant?: string; at: number; key?: string }, invites: ExportInvite[], labels: Map<string, string>): string {
  const l = r.participant ? linkOfRecord(r, invites) : null;
  return (l && labels.get(l.key)) || r.participant || '';
}

const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);
const minutes = (ms: number) => Math.round((ms / 60000) * 10) / 10;
const usedFallback = (e: RunEvent) =>
  (e.type === 'error' && e.data.kind === 'fallback-craft') ||
  (e.type === 'craft' && ((e.data.results as { fallback?: unknown }[] | undefined) ?? []).some((r) => !!r?.fallback));

export function participantFile(id: string | null, events: RunEvent[], feedback: FeedbackRecord[], invites: ExportInvite[]) {
  const evs = events.filter((e) => (id ? e.participant === id : !e.participant)).sort((a, b) => a.at - b.at);
  const fbs = feedback.filter((r) => (id ? r.participant === id : !r.participant)).sort((a, b) => a.at - b.at);
  const labels = linkLabels(invites);
  const links = (id ? invites.filter((i) => i.participant_id === id) : []).sort((a, b) =>
    (labels.get(a.key) ?? '').localeCompare(labels.get(b.key) ?? '', undefined, { numeric: true }),
  );
  const sub = (r: { participant?: string; at: number; key?: string }) => (id ? subIdOf(r, invites, labels) : null);
  const order = evs[0]?.order || fbs.find((r) => r.order)?.order || null;

  const survey = evs.find((e) => e.type === 'session' && e.data.what === 'survey');
  const starts = [...links.map((i) => i.started ?? 0), evs[0]?.at ?? 0, fbs[0]?.at ?? 0].filter(Boolean);
  const start = starts.length ? Math.min(...starts) : null;
  const ends = links.map(endOf);
  const running = links.length ? ends.some((e) => !e) && !survey : !survey;
  const lastAt = Math.max(...[survey?.at ?? 0, ...ends.map((e) => e?.at ?? 0), evs[evs.length - 1]?.at ?? 0, fbs[fbs.length - 1]?.at ?? 0]);
  const end = running ? null : lastAt || null;
  const crafts = evs.filter((e) => e.type === 'craft');
  const ratings: Record<string, Record<string, unknown>> = {};
  for (const r of fbs.filter((x) => x.rating)) {
    const c = conditionOf(r.order, r.cond);
    ratings[String(c ?? r.cond ?? '?')] = { design: designOf(r.cond), ...r.rating };
  }

  const timeline = [
    ...evs.map((e) => {
      const { ms, design, ...data } = e.data as Record<string, unknown> & { ms?: number; design?: unknown };
      const d = designOf(design ?? e.cond);
      return {
        at: e.at,
        type: e.type,
        ...(links.length > 1 ? { linkId: sub(e) } : {}),
        link: e.link,
        part: e.part ?? null,
        step: e.step ?? null,
        ...(d ? { design: d, condition: conditionOf(e.order, design ?? e.cond) } : {}),
        ...(typeof ms === 'number' ? { minutes: minutes(ms) } : {}),
        ...data,
      };
    }),
    ...fbs.map((r) => {
      const { at, rating, ...rest } = r;
      const d = designOf(r.cond);
      return {
        at,
        type: rating ? 'rating' : 'feedback',
        ...(links.length > 1 ? { linkId: sub({ participant: r.participant, at }) } : {}),
        ...(d ? { design: d, condition: conditionOf(r.order, r.cond) } : {}),
        ...rest,
        // (a condition rating's 5 answers; a craft rating keeps its tuned
        // preferences under `answers`)
        ...(rating ? { answers: rating } : {}),
      };
    }),
  ]
    .sort((a, b) => a.at - b.at)
    .map((t) => ({ ...t, at: iso(t.at) }));

  return {
    participant: id ?? 'no-participant',
    exportedAt: new Date().toISOString(),
    order,
    links: links.map((i) => {
      const e = endOf(i);
      return {
        id: labels.get(i.key) ?? i.participant_id,
        key: i.key,
        link: i.link,
        note: i.note,
        created: iso(i.created),
        consent: iso(i.consented),
        started: iso(i.started),
        end: iso(e?.at),
        endedBy: e ? (e.how === 'finished' ? 'survey' : e.how) : i.started ? 'running' : 'not opened',
        lastSeen: iso(i.last_seen),
        crafts: `${i.crafts_used} of ${i.crafts_allowed}`,
        bonusTokens: i.bonus_tokens,
        expires: iso(i.expiresAt),
      };
    }),
    summary: {
      start: iso(start),
      end: iso(end),
      endedBy: running ? 'running' : survey || ends.some((e) => e?.how === 'finished') ? 'survey' : ends.some((e) => e?.how === 'closed') ? 'closed' : 'expired',
      totalMinutes: start ? minutes((end ?? Date.now()) - start) : null,
      crafts: {
        A: crafts.filter((c) => !c.data.recraftOf && designOf(c.data.design ?? c.cond) === 'A').length,
        B: crafts.filter((c) => !c.data.recraftOf && designOf(c.data.design ?? c.cond) === 'B').length,
      },
      reworks: crafts.reduce((a, c) => a + (Number(c.data.reworks) || 0), 0),
      hints: evs.filter((e) => e.type === 'hint').length,
      errors: evs.filter((e) => e.type === 'error').length,
      fallbackCrafts: evs.filter(usedFallback).length,
      surveyOpened: !!survey,
      ratings,
    },
    timeline,
  };
}

// every participant (and the records without one), unfiltered
export function studyFiles(events: RunEvent[], feedback: FeedbackRecord[], invites: ExportInvite[]): { name: string; text: string }[] {
  const ids = [...new Set([...events.map((e) => e.participant), ...feedback.map((r) => r.participant ?? ''), ...invites.map((i) => i.participant_id ?? '')])]
    .filter(Boolean)
    .sort();
  const files = ids.map((id) => ({ name: `${id}.json`, text: JSON.stringify(participantFile(id, events, feedback, invites), null, 1) }));
  if (events.some((e) => !e.participant) || feedback.some((r) => !r.participant))
    files.push({ name: 'no-participant.json', text: JSON.stringify(participantFile(null, events, feedback, invites), null, 1) });
  return files;
}

// ---- a minimal ZIP (stored, no compression) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zip(files: { name: string; text: string }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const endRec = new DataView(new ArrayBuffer(22));
  endRec.setUint32(0, 0x06054b50, true);
  endRec.setUint16(8, files.length, true);
  endRec.setUint16(10, files.length, true);
  endRec.setUint32(12, size, true);
  endRec.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(endRec.buffer)] as BlobPart[], { type: 'application/zip' });
}
