// Which Tally row belongs to which participant, when the survey's id column
// is empty. In this order, each step only for what is still open:
//   1. a row chosen by hand (Teilnehmende & Sessions)
//   2. the id the game sent to the survey (tallyid / test_id)
//   3. time (only when switched on): the submission 10 min before to 120 min
//      after the participant's tracked survey start, nearest first
//   4. order: the remaining participants in the order of the notes, paired
//      with the remaining rows in the order they were submitted
// A pairing by order is checked against the AB/BA value the survey got.
export type MatchVia = 'manuell' | 'id' | 'zeit' | 'reihenfolge';
export interface MatchPerson {
  id: string;
  manual?: number | null; // undefined: automatic
  surveyAt: number | null;
}
export interface MatchRow {
  row: number;
  id: string | null; // from the id column
  submitted: number | null;
}

export const SUBMIT_BEFORE = 10 * 60000;
export const SUBMIT_AFTER = 120 * 60000;

// a wall-clock time in Germany (summer and winter time) as a moment
export function berlinTime(y: number, mo: number, d: number, h = 0, mi = 0, sec = 0): number {
  const guess = Date.UTC(y, mo, d, h, mi, sec);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, Number(p.value)]),
  );
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return guess - (shown - guess);
}
// a moment shown in German time (whatever the browser's zone)
export const fmtBerlin = (t: number, withSeconds = false) =>
  new Date(t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' as const } : {}) });

// ---- the survey's submit times ----
// Stored as they are in the file; read as moments (UTC ms) in the zone the
// file is in, shown in German time, and only then compared with the game's
// tracking (UTC ms too).
export type TallyZone = 'UTC' | 'Europe/Berlin';
export const ZONE_LABEL: Record<TallyZone, string> = { UTC: 'UTC', 'Europe/Berlin': 'deutsche Zeit' };

// a time without a zone in the text is read in `zone` (without one: dotted
// German dates as German time, everything else as UTC, Tally's export);
// slash dates are day first (European) unless that cannot be (26/10 vs 10/26)
export function parseTallyTime(v: string, zone?: TallyZone): number | null {
  const s = v.trim();
  if (!s) return null;
  const at = (z: TallyZone, y: number, mo: number, d: number, h: number, mi: number, sec: number) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    return z === 'UTC' ? Date.UTC(y, mo, d, h, mi, sec) : berlinTime(y, mo, d, h, mi, sec);
  };
  const year = (y: string) => (Number(y) < 100 ? 2000 + Number(y) : Number(y));
  const clock = (h?: string, mi?: string, sec?: string, ampm?: string) => {
    let hh = Number(h ?? 0);
    if (ampm) hh = (hh % 12) + (/p/i.test(ampm) ? 12 : 0);
    return [hh, Number(mi ?? 0), Number(sec ?? 0)] as const;
  };
  const TIME = '(?:[,T\\s]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\.\\d+)?\\s*([ap]\\.?m\\.?)?)?';
  // an explicit zone (Z, +01:00): taken as it is
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s.replace(' ', 'T'));
    return Number.isFinite(t) ? t : null;
  }
  const iso = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME}$`, 'i').exec(s);
  if (iso) return at(zone ?? 'UTC', Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), ...clock(iso[4], iso[5], iso[6], iso[7]));
  const dot = new RegExp(`^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})${TIME}$`, 'i').exec(s);
  if (dot) return at(zone ?? 'Europe/Berlin', year(dot[3]), Number(dot[2]) - 1, Number(dot[1]), ...clock(dot[4], dot[5], dot[6], dot[7]));
  const slash = new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{2,4})${TIME}$`, 'i').exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    // (European day/month; month/day only when the second can't be a month)
    const [d, mo] = b > 12 && a <= 12 ? [b, a] : [a, b];
    return at(zone ?? 'UTC', year(slash[3]), mo - 1, d, ...clock(slash[4], slash[5], slash[6], slash[7]));
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
export const timeOf = (v: string, zone?: TallyZone) => parseTallyTime(v, zone);

// which zone the file's times are in: the submissions of participants with a
// test id against when the game opened their survey; the reading whose
// typical gap fits (10 min before to 120 min after) wins, else UTC
export interface ZoneGuess {
  zone: TallyZone;
  n: number; // submissions compared
  gapMin: number | null; // median gap (min) in the chosen reading
  sure: boolean;
}
export function detectZone(pairs: { raw: string; surveyAt: number }[]): ZoneGuess {
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
  };
  const gaps = (z: TallyZone) => pairs.map((p) => parseTallyTime(p.raw, z)).map((t, i) => (t == null ? NaN : (t - pairs[i].surveyAt) / 60000)).filter(Number.isFinite);
  const fits = (m: number) => m >= -SUBMIT_BEFORE / 60000 && m <= SUBMIT_AFTER / 60000;
  const u = gaps('UTC');
  const b = gaps('Europe/Berlin');
  if (!u.length) return { zone: 'UTC', n: 0, gapMin: null, sure: false };
  const mu = median(u);
  const mb = median(b);
  if (fits(mb) && !fits(mu)) return { zone: 'Europe/Berlin', n: b.length, gapMin: mb, sure: true };
  if (fits(mu) && !fits(mb)) return { zone: 'UTC', n: u.length, gapMin: mu, sure: true };
  // (both or neither fit: the smaller gap, still to check)
  return Math.abs(mb) < Math.abs(mu) ? { zone: 'Europe/Berlin', n: b.length, gapMin: mb, sure: false } : { zone: 'UTC', n: u.length, gapMin: mu, sure: false };
}

// the pairing rules after "by hand", in the order they run (settings, editable)
export type MatchStep = 'id' | 'zeit' | 'reihenfolge';
export const MATCH_STEPS: MatchStep[] = ['id', 'zeit', 'reihenfolge'];
export const STEP_LABEL: Record<MatchStep, string> = { id: 'Test-ID aus der Umfrage', zeit: 'Zeitabgleich (Abgabe ↔ Öffnen der Umfrage im Spiel)', reihenfolge: 'Reihenfolge (Abgabezeit ↔ Teilnehmende)' };
export interface MatchOptions {
  steps?: MatchStep[]; // default: test id, time, order
  useTime?: boolean; // the time step runs only when on
  before?: number; // time window around the tracked survey start (ms)
  after?: number;
}

export function matchRows(rows: MatchRow[], persons: MatchPerson[], opt: MatchOptions | boolean = {}): Map<string, { row: number; via: MatchVia }> {
  const o: MatchOptions = typeof opt === 'boolean' ? { useTime: opt } : opt;
  const steps = (o.steps?.length ? o.steps : MATCH_STEPS).filter((s, i, a) => MATCH_STEPS.includes(s) && a.indexOf(s) === i);
  const before = o.before ?? SUBMIT_BEFORE;
  const after = o.after ?? SUBMIT_AFTER;
  const out = new Map<string, { row: number; via: MatchVia }>();
  const taken = new Set<number>();
  const set = (p: string, row: number, via: MatchVia) => {
    out.set(p, { row, via });
    taken.add(row);
  };
  // 1. by hand (null = "no row"), always first
  for (const p of persons) if (p.manual !== undefined && p.manual !== null && rows.some((r) => r.row === p.manual)) set(p.id, p.manual, 'manuell');
  const open = () => persons.filter((p) => p.manual === undefined && !out.has(p.id));
  // rows with a test id: when the test id step ran before, time and order leave
  // them alone (an id naming nobody here is no answer to hand out by order);
  // when it comes later or not at all, they take any row
  const takesIdRows = (k: number) => !steps.includes('id') || steps.indexOf('id') > k;
  steps.forEach((step, k) => {
    const free = (r: MatchRow) => !taken.has(r.row) && (!r.id || takesIdRows(k));
    if (step === 'id') {
      for (const p of open()) {
        const r = rows.find((x) => x.id === p.id && !taken.has(x.row));
        if (r) set(p.id, r.row, 'id');
      }
    } else if (step === 'zeit') {
      if (!o.useTime) return;
      // nearest pairs first
      const pairs: { p: string; row: number; gap: number }[] = [];
      for (const p of open())
        for (const r of rows)
          if (free(r) && p.surveyAt && r.submitted && r.submitted >= p.surveyAt - before && r.submitted <= p.surveyAt + after) pairs.push({ p: p.id, row: r.row, gap: Math.abs(r.submitted - p.surveyAt) });
      for (const x of pairs.sort((a, b) => a.gap - b.gap)) if (!out.has(x.p) && !taken.has(x.row)) set(x.p, x.row, 'zeit');
    } else {
      // order: the open participants in their order ↔ the free rows by submit time
      const rest = rows.filter(free).sort((a, b) => (a.submitted != null && b.submitted != null ? a.submitted - b.submitted : a.row - b.row));
      open().forEach((p, i) => rest[i] && set(p.id, rest[i].row, 'reihenfolge'));
    }
  });
  return out;
}
