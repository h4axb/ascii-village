// The game's live data against the stand the dashboard works with, as
// changes to check (changes.ts): new records (grouped per participant, there
// can be thousands of events), and records that changed or are gone, each a
// conflict to decide. Only what is taken over changes the dashboard.
import type { Change } from './changes';
import type { GameIds } from './store';
import type { GameData } from './types';
import { fmtBerlin } from './match';

type Kind = keyof GameData;
const KEY: Record<Kind, string> = { invites: 'key', events: 'id', feedback: 'id' };
const KIND_NAME: Record<Kind, string> = { invites: 'Link', events: 'Ereignis', feedback: 'Bewertung' };

const idOf = (k: Kind, r: unknown) => String((r as Record<string, unknown>)[KEY[k]]);
const personOf = (k: Kind, r: unknown) => String((k === 'invites' ? (r as { participant_id?: unknown }).participant_id : (r as { participant?: unknown }).participant) || 'ohne P-ID');
const when = (t: unknown) => (typeof t === 'number' && t > 0 ? fmtBerlin(t, true) : '–');
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 500 ? `${s.slice(0, 500)} …` : (s ?? '');
};

// one record as fields (the times in German time)
function fields(k: Kind, r: unknown): [string, string][] {
  const x = r as Record<string, unknown>;
  if (k === 'invites')
    return [
      ['P-ID', String(x.participant_id ?? '–')],
      ['Link', String(x.link ?? '')],
      ['Gestartet', when(x.started)],
      ['Abgeschlossen', when(x.completed)],
      ['Zuletzt gesehen', when(x.last_seen)],
      ['Läuft ab', when(x.expiresAt)],
      ['Crafts', `${x.crafts_used ?? 0} von ${x.crafts_allowed ?? 0}`],
      ['Reihenfolge', String(x.run_order ?? '–')],
    ];
  if (k === 'events') return [['Zeit', when(x.at)], ['Typ', String(x.type ?? '')], ['Abschnitt', String(x.part ?? '')], ['Schritt', String(x.step ?? '')], ['Daten', short(x.data)]];
  return [['Zeit', when(x.at)], ['Ergebnis', String(x.name ?? '')], ['Bewertung', String(x.vote ?? '–')], ['Fragen', short(x.rating ?? '')], ['Kommentar', short(x.comment ?? '')]];
}

// a record's fingerprint, to remember "keep what is accepted" for exactly this version of it
export const fingerprint = (r: unknown) => {
  const t = JSON.stringify(r) ?? '';
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
// decisions to keep the accepted stand: per kind, record id → fingerprint of the declined live version
export type GameKept = Partial<Record<Kind, Record<string, string>>>;

export interface GamePlan {
  changes: Change[];
  ids: Record<string, { kind: Kind; accept?: string[]; drop?: string[] }>;
}

export function planGame(stand: GameData, live: GameData, kept: GameKept = {}): GamePlan {
  const changes: Change[] = [];
  const ids: GamePlan['ids'] = {};
  for (const k of Object.keys(KEY) as Kind[]) {
    const have = new Map((stand[k] as unknown[]).map((r) => [idOf(k, r), r]));
    // (records already declined in exactly this version are not asked again)
    const declined = kept[k] ?? {};
    // a declined change counts as the accepted version, a declined removal as still there
    const now = new Map<string, unknown>();
    for (const r of live[k] as unknown[]) {
      const id = idOf(k, r);
      if (declined[id] === fingerprint(r)) {
        if (have.has(id)) now.set(id, have.get(id));
      } else now.set(id, r);
    }
    for (const [id, old] of have) if (!now.has(id) && declined[id] === 'gone') now.set(id, old);
    // new records: one entry per participant and kind (links one by one)
    const fresh = new Map<string, unknown[]>();
    for (const [id, r] of now) if (!have.has(id)) fresh.set(personOf(k, r), [...(fresh.get(personOf(k, r)) ?? []), r]);
    for (const [person, rs] of fresh) {
      if (k === 'invites') {
        for (const r of rs) {
          const cid = `game-new:${k}:${idOf(k, r)}`;
          ids[cid] = { kind: k, accept: [idOf(k, r)] };
          changes.push({ id: cid, kind: 'neu', group: person, label: 'Neuer Link', incoming: { fields: fields(k, r) }, choice: 'neu', apply: () => undefined });
        }
        continue;
      }
      const ats = rs.map((r) => (r as { at?: number }).at ?? 0).filter(Boolean);
      const types = new Map<string, number>();
      for (const r of rs) {
        const t = k === 'events' ? String((r as { type?: unknown }).type ?? '?') : String((r as { vote?: unknown }).vote ?? 'Antwort');
        types.set(t, (types.get(t) ?? 0) + 1);
      }
      const cid = `game-new:${k}:${person}`;
      ids[cid] = { kind: k, accept: rs.map((r) => idOf(k, r)) };
      changes.push({
        id: cid,
        kind: 'neu',
        group: person,
        label: `${rs.length} neue ${k === 'events' ? 'Ereignisse' : 'Bewertungen'}`,
        incoming: {
          fields: [
            ['Zeitraum', ats.length ? `${when(Math.min(...ats))} – ${when(Math.max(...ats))}` : '–'],
            ['Arten', [...types].map(([t, n]) => `${t} ${n}`).join(', ')],
          ],
        },
        choice: 'neu',
        apply: () => undefined,
      });
    }
    // changed records: each a conflict (the game updated it, e.g. a rating answered later)
    for (const [id, r] of now) {
      const old = have.get(id);
      if (old === undefined || JSON.stringify(old) === JSON.stringify(r)) continue;
      const cid = `game-edit:${k}:${id}`;
      ids[cid] = { kind: k, accept: [id] };
      changes.push({ id: cid, kind: 'konflikt', group: personOf(k, r), label: `${KIND_NAME[k]} im Spiel geändert`, current: { fields: fields(k, old) }, incoming: { fields: fields(k, r) }, choice: 'alt', apply: () => undefined });
    }
    // records the game no longer has
    for (const [id, old] of have)
      if (!now.has(id)) {
        const cid = `game-gone:${k}:${id}`;
        ids[cid] = { kind: k, drop: [id] };
        changes.push({ id: cid, kind: 'konflikt', group: personOf(k, old), label: `${KIND_NAME[k]} nicht mehr in den Spieldaten`, current: { fields: fields(k, old) }, choice: 'alt', apply: () => undefined });
      }
  }
  return { changes, ids };
}

// the chosen changes as the ids to take over and to drop, and the declined
// ones to remember (so they are not asked again until the game changes them)
export function gameChoice(plan: GamePlan, choices: Record<string, string | undefined>, live: GameData, kept: GameKept = {}): { accept: GameIds; drop: GameIds; n: number; kept: GameKept } {
  const accept: GameIds = {};
  const drop: GameIds = {};
  const nextKept: GameKept = Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, { ...v }]));
  let n = 0;
  for (const c of plan.changes) {
    const x = plan.ids[c.id];
    if ((choices[c.id] ?? c.choice) !== 'neu') {
      const into = (nextKept[x.kind] ??= {});
      for (const id of x.accept ?? []) {
        const r = (live[x.kind] as unknown[]).find((y) => idOf(x.kind, y) === id);
        if (r) into[id] = fingerprint(r);
      }
      for (const id of x.drop ?? []) into[id] = 'gone';
      continue;
    }
    if (x.accept) accept[x.kind] = [...(accept[x.kind] ?? []), ...x.accept];
    if (x.drop) drop[x.kind] = [...(drop[x.kind] ?? []), ...x.drop];
    for (const id of [...(x.accept ?? []), ...(x.drop ?? [])]) delete nextKept[x.kind]?.[id];
    n++;
  }
  return { accept, drop, n, kept: nextKept };
}
