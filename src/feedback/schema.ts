// ---------------------------------------------------------------------------
// One crafting-feedback record (crafting panel 2, the /2 link) — the shape
// the game sends, the Worker stores (functions/api/feedback.ts, Cloudflare
// D1) and the /2/feedback dashboard reads. Pure data + validation, no DOM:
// shared by the browser, the Worker and the dev server (vite.config.ts), so
// all three accept exactly the same thing.
// ---------------------------------------------------------------------------

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

export const COMMENT_MAX = 120;
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
  vote: 'up' | 'down';
  reasons: FeedbackReason[]; // "Not quite" only, max 3
  comment: string; // one sentence, max COMMENT_MAX, may be ''
  applied: P; // the preferences this result was crafted with
  answers: P | null; // "Tune future crafts" answers (null = not tuned)
  scope: 'kind' | 'all' | 'session' | null;
  sprite: { lines: string[]; colors?: string[]; palette?: Record<string, string> };
}

const KINDS = new Set(['plant', 'pets', 'clothing', 'vehicle', 'food', 'utensils', '']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

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
  if (r.vote !== 'up' && r.vote !== 'down') return 'vote must be up or down';
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
    vote: r.vote,
    reasons: r.vote === 'down' ? reasons : [],
    comment: r.vote === 'down' ? str(r.comment, COMMENT_MAX).trim() : '',
    applied: prefs(r.applied),
    answers: r.answers ? prefs(r.answers) : null,
    scope,
    sprite: { lines, ...(colors ? { colors } : {}), ...(palette ? { palette } : {}) },
  };
}
