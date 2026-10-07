// ---------------------------------------------------------------------------
// One crafting-feedback record (crafting panel 2, the /2 link) — the shape
// the game sends, the Worker stores (functions/api/feedback.ts, Cloudflare
// D1) and the /2/feedback dashboard reads. Pure data + validation, no DOM:
// shared by the browser, the Worker and the dev server (vite.config.ts), so
// all three accept exactly the same thing.
// ---------------------------------------------------------------------------
import { checkPolicy } from '../craft/policy';

export const FEEDBACK_REASONS = [
  "Didn't match my idea",
  'Wrong shape',
  'Important details missing',
  "Didn't like the style",
  'Too simple',
  'Unexpected / strange result',
  'Other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

// what "I like it" can say (crafting panel 1, the /1 link)
export const POSITIVE_REASONS = [
  'Matches my idea',
  'Nice colours',
  'Cute shape',
  'Fun details',
  'Great size',
  'Surprising in a good way',
] as const;
export type PositiveReason = (typeof POSITIVE_REASONS)[number];

export const COMMENT_MAX = 120;
// a player's own tag (the /1 link): short, shown to other /1 players
export const TAG_MAX = 30;

// The pre-clarification step before a /1 craft: each question asked, the
// answer picked (null = "You decide"), and whether the player skipped.
export interface ClarifyLog {
  questions: { topic: string; q: string; options: string[]; pick: string | null }[];
  skipped: boolean; // Esc before or during the questions
  ms: number; // time spent answering
  outcome: 'crafted' | 'failed' | 'left'; // what followed
  error?: string; // outcome 'failed': the technical reason the drawing failed
}
const PROMPT_MAX = 120;

type P = Partial<Record<'detail' | 'color' | 'interpretation' | 'surprise', -1 | 0 | 1>>;

export interface FeedbackRecord {
  v: 1;
  id: string; // one per rated result; tuning answers later update the same id
  at: number; // ms since epoch
  player: string; // anonymous random id kept in the browser
  session: string; // one page load
  link: string; // which test link, e.g. "/2"
  prompt: string; // what was crafted (what the player typed, or prompt + change)
  name: string; // the item's name
  kind: string; // plant | pets | clothing | vehicle | food | utensils | ''
  adjusted: boolean; // a paid rework of an earlier result
  vote: 'up' | 'down' | null; // null only on a /1 record that never reached a result (`clarify` set)
  reasons: FeedbackReason[]; // "Not quite" only, max 3
  positive: PositiveReason[]; // "I like it" only (the /1 link), max 3
  tags: string[]; // own or other players' tags (the /1 link), max 3 together with the reasons
  clarify: ClarifyLog | null; // the /1 pre-clarification behind this result
  comment: string; // one sentence, max COMMENT_MAX, may be ''
  applied: P; // the preferences this result was crafted with
  answers: P | null; // "Tune future crafts" answers (null = not tuned)
  scope: 'kind' | 'all' | 'session' | null;
  sprite: { lines: string[]; colors?: string[]; palette?: Record<string, string> };
  // The quest user test (src/quest/): which crafting panel was active —
  // pre-clarification or post-reflection — when this was crafted or rated.
  cond?: 'pre' | 'post';
  // the user test's participant id ("P001") and design order (quest/session.ts)
  participant?: string;
  order?: 'AB' | 'BA';
  // Mitchy's rating questions after a condition (one record per condition):
  // question id → 1-5, or null for a skip
  rating?: Record<string, number | null>;
  // crafting from the reference library (craft/refCraft.ts): how a craft was
  // built when the library fell short — 'planner' = no reference body fit,
  // `miss` = words it could not place. Records with this carry no vote.
  ref?: { via: 'match' | 'model' | 'planner'; body: string; miss: string[] };
}

const KINDS = new Set(['plant', 'pets', 'clothing', 'vehicle', 'food', 'utensils', '']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

// a player's own tag, cleaned — or null when it can't be shown to others
export function cleanTag(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, TAG_MAX);
  return t.length >= 2 && checkPolicy(t).allowed ? t : null;
}

function clarifyLog(v: unknown): ClarifyLog | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const questions = (Array.isArray(c.questions) ? c.questions : []).slice(0, 2).map((q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    const options = (Array.isArray(o.options) ? o.options : []).filter((x): x is string => typeof x === 'string').slice(0, 3).map((x) => x.slice(0, 30));
    const pick = typeof o.pick === 'string' && options.includes(o.pick) ? o.pick : null;
    return { topic: str(o.topic, 30), q: str(o.q, 100), options, pick };
  });
  const outcome = c.outcome === 'crafted' || c.outcome === 'failed' || c.outcome === 'left' ? c.outcome : 'crafted';
  const ms = Number(c.ms);
  const error = outcome === 'failed' && typeof c.error === 'string' && c.error ? c.error.slice(0, 200) : undefined;
  return {
    questions,
    skipped: c.skipped === true,
    ms: Number.isFinite(ms) ? Math.max(0, Math.min(3_600_000, Math.round(ms))) : 0,
    outcome,
    ...(error ? { error } : {}),
  };
}

function prefs(v: unknown): P {
  const out: P = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of ['detail', 'color', 'interpretation', 'surprise'] as const) {
    const x = (v as Record<string, unknown>)[k];
    if (x === -1 || x === 0 || x === 1) out[k] = x;
  }
  return out;
}

// A record from an untrusted source, cleaned to the schema — or the reason
// it can't be.
export function normalizeFeedback(raw: unknown): FeedbackRecord | string {
  if (!raw || typeof raw !== 'object') return 'expected an object';
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const player = str(r.player, 64);
  if (!/^[\w-]{6,64}$/.test(id)) return 'bad id';
  if (!/^[\w-]{6,64}$/.test(player)) return 'bad player';
  const clarify = clarifyLog(r.clarify);
  const vote = r.vote === 'up' || r.vote === 'down' ? r.vote : null;
  const cond = r.cond === 'pre' || r.cond === 'post' ? r.cond : undefined;
  const participant = typeof r.participant === 'string' && /^(P\d{1,6}|L-[A-Z0-9]{5})$/.test(r.participant) ? r.participant : undefined;
  const order = r.order === 'AB' || r.order === 'BA' ? r.order : undefined;
  let rating: Record<string, number | null> | undefined;
  if (r.rating && typeof r.rating === 'object') {
    rating = {};
    for (const [k, v] of Object.entries(r.rating as Record<string, unknown>).slice(0, 20)) {
      if (!/^[\w-]{1,32}$/.test(k)) continue;
      rating[k] = typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
    }
  }
  let ref: FeedbackRecord['ref'];
  if (r.ref && typeof r.ref === 'object') {
    const x = r.ref as Record<string, unknown>;
    if (x.via === 'match' || x.via === 'model' || x.via === 'planner')
      ref = {
        via: x.via,
        body: str(x.body, 64),
        miss: Array.isArray(x.miss) ? x.miss.filter((w): w is string => typeof w === 'string').slice(0, 12).map((w) => w.slice(0, 24)) : [],
      };
  }
  if (!vote && !clarify && !rating && !ref) return 'vote must be up or down';
  const kind = str(r.kind, 16);
  const reasons = Array.isArray(r.reasons)
    ? [...new Set(r.reasons.filter((x): x is FeedbackReason => (FEEDBACK_REASONS as readonly unknown[]).includes(x)))].slice(0, 3)
    : [];
  const s = (r.sprite ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(s.lines) ? s.lines.filter((l): l is string => typeof l === 'string').slice(0, 80).map((l) => l.slice(0, 200)) : [];
  const colors = Array.isArray(s.colors) ? s.colors.filter((l): l is string => typeof l === 'string').slice(0, 80).map((l) => l.slice(0, 200)) : undefined;
  let palette: Record<string, string> | undefined;
  if (s.palette && typeof s.palette === 'object') {
    palette = {};
    for (const [k, hex] of Object.entries(s.palette as Record<string, unknown>).slice(0, 80)) {
      if (k.length <= 2 && typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) palette[k] = hex;
    }
  }
  const positive = Array.isArray(r.positive)
    ? [...new Set(r.positive.filter((x): x is PositiveReason => (POSITIVE_REASONS as readonly unknown[]).includes(x)))].slice(0, 3)
    : [];
  const tags = Array.isArray(r.tags)
    ? [...new Map(r.tags.map(cleanTag).filter((t): t is string => !!t).map((t) => [t.toLowerCase(), t])).values()]
    : [];
  const picked = vote === 'down' ? reasons : vote === 'up' ? positive : [];
  const scope = r.scope === 'kind' || r.scope === 'all' || r.scope === 'session' ? r.scope : null;
  return {
    v: 1,
    id,
    at: Number.isFinite(Number(r.at)) ? Math.round(Number(r.at)) : Date.now(),
    player,
    session: str(r.session, 64),
    link: str(r.link, 32),
    prompt: str(r.prompt, PROMPT_MAX),
    name: str(r.name, 40),
    kind: KINDS.has(kind) ? kind : '',
    adjusted: r.adjusted === true,
    vote,
    reasons: vote === 'down' ? reasons : [],
    positive: vote === 'up' ? positive : [],
    tags: vote ? tags.slice(0, Math.max(0, 3 - picked.length)) : [],
    clarify,
    comment: vote === 'down' ? str(r.comment, COMMENT_MAX).trim() : '',
    applied: prefs(r.applied),
    answers: r.answers ? prefs(r.answers) : null,
    scope,
    sprite: { lines, ...(colors ? { colors } : {}), ...(palette ? { palette } : {}) },
    ...(cond ? { cond } : {}),
    ...(participant ? { participant } : {}),
    ...(order ? { order } : {}),
    ...(rating ? { rating } : {}),
    ...(ref ? { ref } : {}),
  };
}
