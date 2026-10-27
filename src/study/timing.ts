// Durations per participant, when one person may have played several test
// links (P005.1, P005.2, …): each link is an attempt of that participant,
// never a participant of its own. Three separate measures:
//   elapsed   first start → last end (the whole session, pauses included)
//   active    all attempts' active play added up (repeated parts included)
//   clean     a valid, uninterrupted first-time completion – else null, never 0
// Everything comes from the tracking and can be set by hand per attempt and
// per participant (the person's `attempts` / `timing`); null set by hand
// means "no valid value". Statistics are taken over participants only.
import type { AttemptDoc, AttemptOutcome, PersonDoc, TimingDoc, TimingPrecision, TimingSource } from './types';
import { GAP_MIN, type LinkInfo } from './model';
import { describe, mean } from './stats';

export const OUTCOMES: AttemptOutcome[] = ['abgeschlossen', 'unterbrochen', 'neu gestartet', 'technisch abgebrochen', 'abgebrochen'];
export const SOURCE_LABEL: Record<TimingSource, string> = { event_log: 'Spiel-Tracking', observation: 'Beobachtung', estimate: 'Schätzung' };
export const PRECISION_LABEL: Record<TimingPrecision, string> = { exact: 'exakt', approximate: 'ungefähr', unavailable: 'nicht verfügbar' };

// a value with where it came from
export interface Val<T> {
  value: T;
  manual: boolean;
}
const pick = <T>(manual: T | undefined, auto: T): Val<T> => (manual !== undefined ? { value: manual, manual: true } : { value: auto, manual: false });

export interface Attempt {
  key: string; // the link (invite key)
  label: string; // P005.2
  n: Val<number>;
  start: Val<number | null>;
  end: Val<number | null>;
  active: Val<number | null>;
  outcome: Val<AttemptOutcome>;
  source: Val<TimingSource>;
  precision: Val<TimingPrecision>;
  note: string;
  link: LinkInfo;
}

export type TimingStatus = 'exakt' | 'geschätzt' | 'wiederholt' | 'unterbrochen' | 'unvollständig';
export interface Timing {
  attempts: Attempt[];
  attemptCount: number;
  restartCount: number;
  elapsed: Val<number | null>;
  active: Val<number | null>;
  activeEstimated: boolean; // some part is approximate, estimated or set by hand from observation
  interruption: Val<number | null>;
  technical: Val<boolean>;
  completed: boolean;
  clean: Val<number | null>;
  eligible: Val<boolean>;
  exclusionReason: Val<string>;
  source: Val<TimingSource>;
  precision: Val<TimingPrecision>;
  status: TimingStatus;
}

const min = (ms: number) => ms / 60000;
const round1 = (x: number) => Math.round(x * 10) / 10;

// one link's active play, measured: the game's run clock, else the quest steps,
// else first to last event without the pauses (the link's open time only on request)
function measured(l: LinkInfo, by: string): { v: number | null; precision: TimingPrecision } {
  if (by === 'link') return { v: l.linkMinutes, precision: l.linkMinutes != null ? 'approximate' : 'unavailable' };
  if (by !== 'steps' && l.clockMinutes != null) return { v: l.clockMinutes, precision: 'exact' };
  if (l.stepMinutes != null) return { v: l.stepMinutes, precision: 'approximate' };
  if (l.firstAt != null && l.lastAt != null && l.lastAt > l.firstAt) return { v: round1(Math.max(0, min(l.lastAt - l.firstAt) - l.gaps.minutes)), precision: 'approximate' };
  return { v: null, precision: 'unavailable' };
}

export function timingOf(doc: PersonDoc, links: LinkInfo[], durationBy: string): Timing {
  const ad = doc.attempts ?? {};
  const td: TimingDoc = { ...(doc.timing ?? {}) };
  // (older docs: one duration set by hand = the active time)
  if (td.activeMin === undefined && doc.minutes != null) td.activeMin = doc.minutes;
  const ordered = [...links].sort((a, b) => (a.firstAt ?? a.started ?? Infinity) - (b.firstAt ?? b.started ?? Infinity) || a.label.localeCompare(b.label, undefined, { numeric: true }));
  const attempts: Attempt[] = ordered.map((l, i) => {
    const d: AttemptDoc = ad[l.key] ?? {};
    const m = measured(l, durationBy);
    const later = i < ordered.length - 1;
    const autoOutcome: AttemptOutcome = l.endedBy === 'Umfrage' ? 'abgeschlossen' : later ? 'neu gestartet' : l.endedBy === 'läuft' ? 'unterbrochen' : 'abgebrochen';
    return {
      key: l.key,
      label: l.label,
      n: pick(d.n, i + 1),
      start: pick(d.start, l.firstAt ?? l.started),
      end: pick(d.end, l.lastAt ?? l.end),
      active: pick(d.activeMin, m.v),
      outcome: pick(d.outcome, autoOutcome),
      source: pick(d.source, 'event_log' as TimingSource),
      precision: pick(d.precision, m.precision),
      note: d.note ?? '',
      link: l,
    };
  });
  attempts.sort((a, b) => a.n.value - b.n.value);
  const starts = attempts.map((a) => a.start.value).filter((x): x is number => x != null);
  const ends = attempts.map((a) => a.end.value).filter((x): x is number => x != null);
  const autoElapsed = starts.length && ends.length ? round1(min(Math.max(...ends) - Math.min(...starts))) : null;
  // (an attempt without any time counts as nothing; the total is then estimated)
  const actives = attempts.map((a) => a.active.value).filter((x): x is number => x != null);
  const autoActive = actives.length ? round1(actives.reduce((s, x) => s + x, 0)) : null;
  // the time between attempts, and pauses of more than GAP_MIN within them
  let between = 0;
  for (let i = 1; i < attempts.length; i++) {
    const e = attempts[i - 1].end.value;
    const s = attempts[i].start.value;
    if (e != null && s != null && s > e) between += min(s - e);
  }
  const within = attempts.reduce((s, a) => s + a.link.gaps.minutes, 0);
  const autoInterruption = attempts.length ? round1(between + within) : null;
  const technical = pick(td.technical, attempts.some((a) => a.outcome.value === 'technisch abgebrochen'));
  const completed = attempts.some((a) => a.outcome.value === 'abgeschlossen');
  const active = pick(td.activeMin, autoActive);
  const interruption = pick(td.interruptionMin, autoInterruption);
  // (times entered by hand: elapsed = active + interruption; else first start → last end)
  const byHand = active.manual || interruption.manual || attempts.some((a) => a.active.manual);
  const handElapsed = byHand && active.value != null ? round1(active.value + (interruption.value ?? 0)) : null;
  const elapsed = pick(td.elapsedMin, handElapsed ?? autoElapsed);
  const estimated = attempts.some((a) => a.precision.value !== 'exact' || a.source.value !== 'event_log' || a.active.value == null) || active.manual || td.source === 'estimate' || td.source === 'observation';
  const precision = pick<TimingPrecision>(td.precision, attempts.every((a) => a.precision.value === 'exact') ? 'exact' : attempts.some((a) => a.precision.value === 'unavailable') && !active.manual ? 'unavailable' : 'approximate');
  const source = pick<TimingSource>(td.source, attempts.every((a) => a.source.value === 'event_log') && !active.manual ? 'event_log' : 'estimate');
  return finish({ attempts, elapsed, active, interruption, technical, completed, estimated, precision, source }, td);
}

// clean time, eligibility and status from the measures (shared by a person and a single link)
function finish(
  m: { attempts: Attempt[]; elapsed: Val<number | null>; active: Val<number | null>; interruption: Val<number | null>; technical: Val<boolean>; completed: boolean; estimated: boolean; precision: Val<TimingPrecision>; source: Val<TimingSource> },
  td: TimingDoc,
): Timing {
  const { attempts, active, interruption, technical, completed, precision } = m;
  // a clean first-time completion: one attempt, completed, not interrupted, timed exactly
  const reasons = [
    attempts.length > 1 ? 'Neustarts / Lerneffekte' : '',
    !completed ? 'nicht abgeschlossen' : '',
    (interruption.value ?? 0) > GAP_MIN || technical.value ? 'Unterbrechung' : '',
    precision.value !== 'exact' ? 'Zeit nicht exakt' : '',
    active.value == null ? 'keine aktive Zeit' : '',
  ].filter(Boolean);
  const eligible = pick(td.eligible, !reasons.length);
  const clean = pick(td.cleanMin, eligible.value ? active.value : null);
  const exclusionReason = pick(td.exclusionReason, eligible.value ? '' : reasons.join(', '));
  const status: TimingStatus = !completed ? 'unvollständig' : attempts.length > 1 ? 'wiederholt' : (interruption.value ?? 0) > GAP_MIN || technical.value ? 'unterbrochen' : m.estimated ? 'geschätzt' : 'exakt';
  return {
    attempts,
    attemptCount: attempts.length,
    restartCount: Math.max(0, attempts.length - 1),
    elapsed: m.elapsed,
    active,
    activeEstimated: m.estimated,
    interruption,
    technical,
    completed,
    clean,
    eligible,
    exclusionReason,
    source: m.source,
    precision,
    status,
  };
}

// one link of a participant on its own (the top menu set to P005.1): that attempt's times only
export function attemptTiming(t: Timing, key: string): Timing {
  const a = t.attempts.find((x) => x.key === key);
  if (!a) return t;
  const s = a.start.value;
  const e = a.end.value;
  const elapsed = { value: s != null && e != null && e > s ? round1(min(e - s)) : null, manual: a.start.manual || a.end.manual };
  const estimated = a.precision.value !== 'exact' || a.source.value !== 'event_log' || a.active.value == null;
  return finish(
    {
      attempts: [a],
      elapsed,
      active: a.active,
      interruption: { value: round1(a.link.gaps.minutes), manual: false },
      technical: { value: a.outcome.value === 'technisch abgebrochen', manual: a.outcome.manual },
      completed: a.outcome.value === 'abgeschlossen',
      estimated,
      precision: a.precision,
      source: a.source,
    },
    // (one of several attempts is never a clean first-time completion)
    t.attemptCount > 1 ? { eligible: false, exclusionReason: `Versuch ${a.n.value} von ${t.attemptCount} (Neustarts / Lerneffekte)` } : {},
  );
}

// ---- statistics over participants (one value per participant, never per link) ----
export interface TimingStat {
  mean: number;
  sd: number;
  median: number;
  n: number; // participants with a value
  N: number; // participants
}
const stat = (xs: (number | null)[], N: number): TimingStat => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  const d = describe(v);
  return { mean: d.mean, sd: d.sd, median: d.median, n: v.length, N };
};
export interface TimingSummary {
  elapsed: TimingStat;
  active: TimingStat;
  clean: TimingStat; // eligible participants only
  attemptsMean: number;
  withRestart: number; // participants with ≥ 1 restart
  technical: number; // participants with a technical interruption
  estimated: number; // participants whose active time is estimated
  N: number;
}
export function timingSummary(ts: Timing[]): TimingSummary {
  const N = ts.length;
  return {
    elapsed: stat(
      ts.map((t) => t.elapsed.value),
      N,
    ),
    active: stat(
      ts.map((t) => t.active.value),
      N,
    ),
    clean: stat(
      ts.map((t) => (t.eligible.value ? t.clean.value : null)),
      N,
    ),
    attemptsMean: N ? mean(ts.map((t) => t.attemptCount)) : NaN,
    withRestart: ts.filter((t) => t.restartCount > 0).length,
    technical: ts.filter((t) => t.technical.value).length,
    estimated: ts.filter((t) => t.activeEstimated).length,
    N,
  };
}
