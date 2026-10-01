// Crafting panel 2 (the /2 link): the feedback after a craft and the "Tune
// future crafts" questions, built on the UI design system (src/ui). The
// workshop (CraftModal.tsx) owns the state; these are presentational.
//
//   FeedbackVote    ▲ I like it / ▼ Not quite — required before taking the
//                   item; "Not quite" opens up to 3 reason tags and an
//                   optional one-sentence comment. Pure feedback: nothing
//                   here changes the game (src/feedback/).
//   TuneQuestions   one question at a time (detail, colour, interpretation,
//                   surprise), then where to remember the answers, then a
//                   summary. These DO shape future crafts (craft/prefs.ts).
import { useState } from 'react';
import { FEEDBACK_REASONS, COMMENT_MAX, type FeedbackReason } from './feedback/schema';
import {
  PREF_INFO,
  PREF_KEYS,
  KIND_LABEL,
  KINDS,
  loadPrefs,
  sessionPrefs,
  setPref,
  resetPrefs,
  type Kind,
  type PrefKey,
  type Prefs,
  type PrefValue,
  type Scope,
} from './craft/prefs';

// ---- the vote ----------------------------------------------------------------

const COMMENT_CHIP = '+ Add one-sentence comment';

// One sentence only: stop at the first sentence-ending mark.
export function oneSentence(v: string): string {
  const t = v.replace(/\s+/g, ' ').trimStart().slice(0, COMMENT_MAX);
  const m = /^(.{1,119}?[.!?])(?:\s|$)/.exec(t);
  return m && t.length > m[1].length ? m[1] : t;
}

export function FeedbackVote({
  vote,
  reasons,
  commentOpen,
  comment,
  onVote,
  onReasons,
  onCommentOpen,
  onComment,
}: {
  vote: 'up' | 'down' | null;
  reasons: FeedbackReason[];
  commentOpen: boolean;
  comment: string;
  onVote: (v: 'up' | 'down') => void;
  onReasons: (r: FeedbackReason[]) => void;
  onCommentOpen: (open: boolean) => void;
  onComment: (c: string) => void;
}) {
  // the comment chip counts toward the 3, like a reason
  const picked = reasons.length + (commentOpen ? 1 : 0);
  const toggle = (r: FeedbackReason) => {
    if (reasons.includes(r)) {
      onReasons(reasons.filter((x) => x !== r));
      if (r === 'Other' && !reasons.some((x) => x !== 'Other')) onCommentOpen(false);
    } else if (picked < 3) {
      onReasons([...reasons, r]);
      if (r === 'Other') onCommentOpen(true);
    }
  };
  return (
    <div className="fb-vote">
      <div className="fb-vote-title">How did this craft turn out?</div>
      {!vote && <div className="ds-muted fb-vote-sub">Choose one before continuing.</div>}
      <div className="fb-vote-row">
        <button className={'fb-vote-btn up' + (vote === 'up' ? ' on' : '')} onClick={() => onVote('up')} aria-pressed={vote === 'up'}>
          ▲ I like it
        </button>
        <button className={'fb-vote-btn down' + (vote === 'down' ? ' on' : '')} onClick={() => onVote('down')} aria-pressed={vote === 'down'}>
          ▼ Not quite
        </button>
      </div>
      {vote === 'down' && (
        <div className="fb-reasons">
          <div className="fb-reasons-title">What didn’t work for you?</div>
          <div className="ds-muted fb-reasons-hint">Choose up to 3 · optional</div>
          <div className="fb-chips">
            {FEEDBACK_REASONS.map((r) => {
              const on = reasons.includes(r);
              return (
                <button key={r} className={'fb-chip' + (on ? ' on' : '')} disabled={!on && picked >= 3} onClick={() => toggle(r)}>
                  {r}
                </button>
              );
            })}
            <button
              className={'fb-chip' + (commentOpen ? ' on' : '')}
              disabled={!commentOpen && picked >= 3}
              onClick={() => onCommentOpen(!commentOpen)}
            >
              {COMMENT_CHIP}
            </button>
          </div>
          {commentOpen && (
            <label className="fb-comment">
              <span>Anything specific?</span>
              <input
                value={comment}
                maxLength={COMMENT_MAX}
                placeholder="The sail should have been much larger."
                autoComplete="off"
                onChange={(e) => onComment(oneSentence(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') e.stopPropagation(); // typing stays out of the world and the menus
                }}
              />
              <span className="ds-muted">One sentence only · optional</span>
            </label>
          )}
          <div className="ds-muted fb-count">{picked} / 3 selected</div>
        </div>
      )}
    </div>
  );
}

// ---- answer icons: small glyph drawings in the game's own style ------------------

type Tone = 'ink' | 'soft' | 'gold' | 'p1' | 'p2' | 'p3' | 'v1' | 'v2' | 'v3' | 'n1' | 'n2' | 'n3';
// each icon: rows of [text, tone] runs
type Glyph = [string, Tone][][];
const G = (rows: (string | [string, Tone][])[]): Glyph =>
  rows.map((r) => (typeof r === 'string' ? [[r, 'ink'] as [string, Tone]] : r));

const ICONS: Record<PrefKey | 'scope', Record<string, Glyph>> = {
  // the same diamond drawn with fewer / more glyphs
  detail: {
    '-1': G(['   ', ' /\\ ', ' \\/ ', '   ']),
    '0': G(['  /\\  ', ' /::\\ ', ' \\::/ ', '  \\/  ']),
    '1': G(['   /\\   ', [['  /', 'ink'], ['§§', 'gold'], ['\\  ', 'ink']], [[' /', 'ink'], ['§@@§', 'gold'], ['\\ ', 'ink']], [[' \\', 'ink'], ['§@@§', 'gold'], ['/ ', 'ink']], [['  \\', 'ink'], ['§§', 'gold'], ['/  ', 'ink']], '   \\/   ']),
  },
  // a colour swatch, softer / normal / stronger
  color: {
    '-1': [[['¤¤¤', 'p1'], ['§§§', 'p2'], ['@@@', 'p3']], [['¤¤¤', 'p1'], ['§§§', 'p2'], ['@@@', 'p3']]],
    '0': [[['¤¤¤', 'n1'], ['§§§', 'n2'], ['@@@', 'n3']], [['¤¤¤', 'n1'], ['§§§', 'n2'], ['@@@', 'n3']]],
    '1': [[['¤¤¤', 'v1'], ['§§§', 'v2'], ['@@@', 'v3']], [['¤¤¤', 'v1'], ['§§§', 'v2'], ['@@@', 'v3']]],
  },
  // how much of your description makes it in: a note → a few / all marks
  interpretation: {
    '-1': G(['┌──┐     ', '│≡≡│ →  o', '└──┘     ']),
    '0': G(['┌──┐   o ', '│≡≡│ → o~', '└──┘   o ']),
    '1': [[['┌──┐  ', 'ink'], ['*', 'gold'], ['o', 'ink'], ['*', 'gold']], [['│≡≡│ → ', 'ink'], ['o~o', 'ink']], [['└──┘  ', 'ink'], ['*', 'gold'], ['o', 'ink'], ['*', 'gold']]],
  },
  // a box: shut / ajar / open with sparks
  surprise: {
    '-1': G(['        ', ' ______ ', '|______|', '|      |', '|______|']),
    '0': G(['   ___  ', ' _/   \\ ', '|______|', '|      |', '|______|']),
    '1': [[[' ', 'ink'], ['*', 'gold'], ['  ', 'ink'], ['+', 'gold'], ['  ', 'ink'], ['*', 'gold'], [' ', 'ink']], G([' \\    / '])[0], G(['|______|'])[0], G(['|  ??  |'])[0], G(['|______|'])[0]],
  },
  scope: {
    kind: G(['{ o }', '{ o }']),
    all: G(['     ', ' oo  ', 'o  oo', ' oo  ']),
    session: G([' ___ ', ' \\ / ', ' / \\ ', ' ‾‾‾ ']),
  },
};

function GlyphIcon({ g }: { g: Glyph }) {
  return (
    <pre className="fb-glyph" aria-hidden>
      {g.map((row, i) => (
        <div key={i}>
          {row.map(([t, tone], j) => (
            <span key={j} className={'t-' + tone}>
              {t}
            </span>
          ))}
        </div>
      ))}
    </pre>
  );
}

// ---- the questions --------------------------------------------------------

interface Option<V> {
  value: V;
  name: string;
  desc: string;
  tip: string;
}
interface Question<K extends string, V> {
  key: K;
  eyebrow: string;
  title: string;
  help: string;
  options: Option<V>[];
}

const PREF_QUESTIONS: Question<PrefKey, PrefValue>[] = [
  {
    key: 'detail',
    eyebrow: 'Detail',
    title: 'How finely should I draw it?',
    help: 'The same shapes, drawn with fewer or more glyphs. The item stays the same size in the world.',
    options: [
      { value: -1, name: 'Less', desc: 'Fewer, bolder glyphs', tip: 'Draws the craft with fewer glyphs: bolder and simpler to read.' },
      { value: 0, name: 'Keep', desc: 'Current balance', tip: 'The usual glyph density.' },
      { value: 1, name: 'More', desc: 'Dense, fine glyphs', tip: 'Draws the craft with many more, finer glyphs for extra texture.' },
    ],
  },
  {
    key: 'color',
    eyebrow: 'Colour',
    title: 'How should the colours feel?',
    help: 'Changes how strong the colours are; the colours themselves stay recognizable.',
    options: [
      { value: -1, name: 'Pastel', desc: 'Softer and lighter', tip: 'Less saturated, lighter colours.' },
      { value: 0, name: 'Keep', desc: 'Current balance', tip: 'The usual colour strength.' },
      { value: 1, name: 'Vivid', desc: 'Stronger colours', tip: 'More saturated, stronger colours.' },
    ],
  },
  {
    key: 'interpretation',
    eyebrow: 'Interpretation',
    title: 'How much of your description should make it in?',
    help: 'Whether I draw every detail you write, or focus on the main thing.',
    options: [
      { value: -1, name: 'Essentials', desc: 'The main thing, clearly', tip: 'Keeps only the main subject and its defining features, so its shape reads clearly.' },
      { value: 0, name: 'Keep', desc: 'Current balance', tip: 'The usual balance.' },
      { value: 1, name: 'Every detail', desc: 'All you wrote', tip: 'Tries to show every feature you name, even small ones.' },
    ],
  },
  {
    key: 'surprise',
    eyebrow: 'Surprise',
    title: 'How much should I add on my own?',
    help: 'Whether I stick to what you asked for, or read it more freely and add touches of my own.',
    options: [
      { value: -1, name: 'Controlled', desc: 'Only what I asked for', tip: 'A concrete reading of your words; nothing added.' },
      { value: 0, name: 'Keep', desc: 'Current balance', tip: 'The usual amount of my own ideas.' },
      { value: 1, name: 'Surprise me', desc: 'Add unexpected ideas', tip: 'A freer, more abstract reading of your words, with a few details of my own on top.' },
    ],
  },
];

export function TuneQuestions({
  kind,
  onSave,
  onClose,
}: {
  kind: Kind | null;
  onSave: (answers: Prefs, scope: Scope) => void; // after the scope question
  onClose: () => void; // back to the workshop (after the summary)
}) {
  const [answers, setAnswers] = useState<Prefs>({});
  const [scope, setScope] = useState<Scope | null>(null);
  const [index, setIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [done, setDone] = useState(false);
  const kindName = kind ? KIND_LABEL[kind].many : 'Similar things';
  const scopeQ: Question<'scope', Scope> = {
    key: 'scope',
    eyebrow: 'Scope',
    title: 'Where should I remember these choices?',
    help: 'Only the questions you answered are remembered.',
    options: [
      {
        value: 'kind',
        name: kind ? `All ${kindName}` : 'Similar crafts',
        desc: kind ? `Future ${kindName.toLowerCase()} you craft` : 'Crafts of the same kind',
        tip: kind
          ? `Used whenever a future craft is ${KIND_LABEL[kind].one === 'Object' ? 'an object' : `a ${KIND_LABEL[kind].one.toLowerCase()}`} — judged by its main element.`
          : 'Used for future crafts of the same kind.',
      },
      { value: 'all', name: 'All crafts', desc: 'Every future craft', tip: 'Used for every future craft until you change them.' },
      { value: 'session', name: 'This session', desc: 'Until you close the game', tip: 'Used only until the game is closed or reloaded.' },
    ],
  };
  const total = PREF_QUESTIONS.length + 1;
  const goTo = (i: number) => {
    setIndex(i);
    setMaxVisited((m) => Math.max(m, i));
  };
  const next = () => {
    if (index < total - 1) goTo(index + 1);
  };

  if (done) {
    const keys = PREF_QUESTIONS.map((q) => q.key).filter((k) => answers[k] !== undefined);
    return (
      <div className="fb-tune">
        <div className="fb-q-title">Preferences saved</div>
        <div className="ds-muted fb-q-help">Only the questions you answered will affect future crafts.</div>
        <div className="fb-summary">
          {keys.length === 0 && <div className="ds-muted">No questions answered, so nothing changes.</div>}
          {keys.map((k) => (
            <div key={k} className="fb-summary-item">
              <GlyphIcon g={ICONS[k][String(answers[k])]} />
              <div>
                <b>{PREF_INFO[k].title}</b>
                <span className="ds-muted">{PREF_INFO[k].labels[answers[k] as PrefValue]}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="ds-muted fb-saved-for">
          Remembered for{' '}
          {scope === 'all' ? 'all crafts' : scope === 'session' ? 'this session' : kind ? `all ${kindName.toLowerCase()}` : 'similar crafts'}.
        </div>
        <div className="fb-settings-note">You can change these anytime in Settings → Crafting preferences.</div>
        <button className="ds-action go fb-back" onClick={onClose}>
          Back to the workshop
        </button>
      </div>
    );
  }

  const isScope = index === total - 1;
  const q = isScope ? scopeQ : PREF_QUESTIONS[index];
  const icon = (v: string) => ICONS[isScope ? 'scope' : (q.key as PrefKey)][v];
  return (
    <div className="fb-tune">
      <div className="fb-progress">
        <span className="ds-muted">
          {index + 1} / {total}
        </span>
        <div className="fb-dots">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              className={'fb-dot' + (i < index ? ' done' : i === index ? ' current' : '')}
              disabled={i > maxVisited}
              onClick={() => goTo(i)}
              aria-label={i > maxVisited ? 'Answer earlier questions first' : `Go to question ${i + 1}`}
              title={i > maxVisited ? 'Answer earlier questions first' : `Go to question ${i + 1}`}
            />
          ))}
        </div>
      </div>
      <div className="fb-q-eyebrow">{q.eyebrow}</div>
      <div className="fb-q-title">{q.title}</div>
      <div className="ds-muted fb-q-help">{q.help}</div>
      <div className="fb-answers">
        {(q.options as Option<PrefValue | Scope>[]).map((o) => {
          const sel = isScope ? scope === o.value : answers[q.key as PrefKey] === o.value;
          return (
            <button
              key={String(o.value)}
              className={'fb-answer' + (sel ? ' on' : '')}
              onClick={() => {
                if (isScope) {
                  setScope(o.value as Scope);
                  onSave(answers, o.value as Scope);
                  setTimeout(() => setDone(true), 200);
                } else {
                  setAnswers((a) => ({ ...a, [q.key]: o.value as PrefValue }));
                  setTimeout(next, 200);
                }
              }}
            >
              <span className="fb-tip">{o.tip}</span>
              <GlyphIcon g={icon(String(o.value))} />
              <span className="fb-answer-name">{o.name}</span>
              <span className="ds-muted fb-answer-desc">{o.desc}</span>
            </button>
          );
        })}
      </div>
      {!isScope && (
        <div className="fb-skip-row">
          <button
            className="ds-link fb-skip"
            onClick={() => {
              setAnswers((a) => {
                const n = { ...a };
                delete n[q.key as PrefKey];
                return n;
              });
              next();
            }}
          >
            Skip this question
          </button>
          <span className="fb-tip">Skipping leaves this setting as it is.</span>
        </div>
      )}
    </div>
  );
}

// ---- Settings → Crafting preferences ------------------------------------------

const SCOPE_TITLE = (scope: Scope, kind: Kind | null) =>
  scope === 'all' ? 'All crafts' : scope === 'session' ? 'This session only' : `${kind ? KIND_LABEL[kind].many : ''}`;

// Every saved answer, changeable per place it's remembered (all crafts, one
// kind, this session); "—" clears one.
export function CraftPrefsSettings() {
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  const stored = loadPrefs();
  const session = sessionPrefs();
  const [addKind, setAddKind] = useState<Kind | ''>('');
  const blocks: { scope: Scope; kind: Kind | null; prefs: Prefs }[] = [
    { scope: 'all', kind: null, prefs: stored.all },
    ...KINDS.filter((k) => stored.byKind[k] || k === addKind).map((k) => ({ scope: 'kind' as const, kind: k, prefs: stored.byKind[k] ?? {} })),
    ...(Object.keys(session).length ? [{ scope: 'session' as const, kind: null, prefs: session }] : []),
  ];
  const missing = KINDS.filter((k) => !stored.byKind[k] && k !== addKind);
  return (
    <div className="fb-settings">
      <div className="ds-muted fb-settings-intro">How Mitchy crafts for you. Set in the workshop after rating a craft.</div>
      {blocks.map((b) => (
        <div key={b.scope + (b.kind ?? '')} className="fb-settings-block">
          <div className="fb-settings-scope">{SCOPE_TITLE(b.scope, b.kind)}</div>
          <div className="fb-settings-rows">
          {PREF_KEYS.map((k) => (
            <label key={k} className="fb-settings-row">
              <span>{PREF_INFO[k].title}</span>
              <select
                value={b.prefs[k] === undefined ? '' : String(b.prefs[k])}
                onChange={(e) => {
                  setPref(b.scope, b.kind, k, e.target.value === '' ? null : (Number(e.target.value) as PrefValue));
                  refresh();
                }}
              >
                <option value="">—</option>
                {([-1, 0, 1] as const).map((v) => (
                  <option key={v} value={v}>
                    {PREF_INFO[k].labels[v]}
                  </option>
                ))}
              </select>
            </label>
          ))}
          </div>
        </div>
      ))}
      <div className="fb-settings-foot">
        {missing.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              setAddKind(e.target.value as Kind);
            }}
            aria-label="Add preferences for one kind"
          >
            <option value="">+ preferences for one kind…</option>
            {missing.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k].many}
              </option>
            ))}
          </select>
        )}
        <button
          className="ds-link"
          onClick={() => {
            resetPrefs();
            setAddKind('');
            refresh();
          }}
        >
          Reset all
        </button>
      </div>
    </div>
  );
}
