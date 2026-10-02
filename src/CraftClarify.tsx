// Crafting panel 1 (the /1 link, pre-clarification): the pieces of the
// workshop chat that belong to this flow, built on the UI design system
// (src/ui). The workshop (CraftModal.tsx) owns the state; these are
// presentational.
//
//   ClarifyPlan   after Mitchy's questions: each decision with its answers
//                 as tags (the pick highlighted); a click changes the answer.
//                 The workshop's own Craft it! button commits.
//   RatingPanel   ▲ I like it / ▼ Not quite, then — in the same, fixed-size
//                 panel — what did or didn't work (standard tags, other /1
//                 players' tags, an own tag), then a thank-you. Pure
//                 feedback: nothing here changes the game (src/feedback/).
import type { ClarifyQuestion } from './llm';
import { FEEDBACK_REASONS, POSITIVE_REASONS, TAG_MAX } from './feedback/schema';

export const YOU_DECIDE = 'You decide';

// ---- the plan panel ----------------------------------------------------------

// picks[i]: the chosen option index, null = "You decide"
export function ClarifyPlan({
  questions,
  picks,
  locked,
  onPick,
}: {
  questions: ClarifyQuestion[];
  picks: (number | null)[];
  locked: boolean; // crafting has started: the answers are final
  onPick: (q: number, pick: number | null) => void;
}) {
  return (
    <div className={'cl-panel' + (locked ? ' locked' : '')}>
      {!locked && <span className="cl-skip">Skip with Esc</span>}
      <div className="cl-title">Here is my plan</div>
      {questions.map((q, i) => (
        <div className="cl-row" key={i}>
          <span className="cl-row-label">{q.topic}</span>
          <div className="fb-chips">
            {q.options.map((o, j) => (
              <button
                key={o.label}
                className={'fb-chip' + (picks[i] === j ? ' on' : '')}
                disabled={locked}
                onClick={() => onPick(i, j)}
              >
                {o.label}
              </button>
            ))}
            <button
              className={'fb-chip decide' + (picks[i] === null ? ' on' : '')}
              disabled={locked}
              onClick={() => onPick(i, null)}
            >
              {YOU_DECIDE}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- the rating ----------------------------------------------------------------

export type RateStep = 'vote' | 'tags' | 'done';
const OWN_CHIP = '+ Add your own tag';

// The standard tags with the other players' ones mixed in (after every
// second standard tag), so they read as one list; `peer` marks theirs.
function mixed(standard: readonly string[], peers: string[]): { label: string; peer: boolean }[] {
  const own = new Set(standard.map((s) => s.toLowerCase()));
  const extra = peers.filter((p) => !own.has(p.toLowerCase()));
  const out: { label: string; peer: boolean }[] = [];
  standard.forEach((s, i) => {
    out.push({ label: s, peer: false });
    if (i % 2 === 1 && extra.length) out.push({ label: extra.shift()!, peer: true });
  });
  return [...out, ...extra.map((label) => ({ label, peer: true }))];
}

export function RatingPanel({
  vote,
  step,
  picked,
  ownOpen,
  own,
  peers,
  onVote,
  onPicked,
  onOwnOpen,
  onOwn,
  onDone,
}: {
  vote: 'up' | 'down' | null;
  step: RateStep;
  picked: string[]; // standard and other players' tags, max 3 with the own tag
  ownOpen: boolean;
  own: string;
  peers: { up: string[]; down: string[] };
  onVote: (v: 'up' | 'down') => void;
  onPicked: (p: string[]) => void;
  onOwnOpen: (open: boolean) => void;
  onOwn: (t: string) => void;
  onDone: () => void;
}) {
  const count = picked.length + (ownOpen ? 1 : 0);
  const toggle = (t: string) => {
    if (picked.includes(t)) onPicked(picked.filter((x) => x !== t));
    else if (count < 3) onPicked([...picked, t]);
  };
  const voteRow = (
    <div className="fb-vote-row">
      <button
        className={'fb-vote-btn up' + (vote === 'up' ? ' on' : '')}
        onClick={() => onVote('up')}
        disabled={step === 'done'}
        aria-pressed={vote === 'up'}
      >
        ▲ I like it
      </button>
      <button
        className={'fb-vote-btn down' + (vote === 'down' ? ' on' : '')}
        onClick={() => onVote('down')}
        disabled={step === 'done'}
        aria-pressed={vote === 'down'}
      >
        ▼ Not quite
      </button>
    </div>
  );

  if (step !== 'tags' || !vote)
    return (
      <div className="fb-vote rv">
        <div className="rv-center">
          <div className="fb-vote-title">How did this craft turn out?</div>
          {voteRow}
          {step === 'done' ? (
            <div className="rv-thanks">Thank you for your honest feedback!</div>
          ) : (
            <div className="ds-muted fb-vote-sub rv-sub">Choose one before continuing.</div>
          )}
        </div>
      </div>
    );

  const standard = vote === 'down' ? FEEDBACK_REASONS.filter((r) => r !== 'Other') : POSITIVE_REASONS;
  return (
    <div className="fb-vote rv">
      <span className="cl-skip">Skip with Esc</span>
      <div className="rv-q">{vote === 'down' ? 'What didn’t work for you?' : 'What did you like?'}</div>
      <div className="fb-chips">
        {mixed(standard, peers[vote]).map(({ label, peer }) => {
          const on = picked.includes(label);
          return (
            <button
              key={label}
              className={'fb-chip' + (peer ? ' peer' : '') + (on ? ' on' : '')}
              disabled={!on && count >= 3}
              onClick={() => toggle(label)}
            >
              {label}
            </button>
          );
        })}
        <button className={'fb-chip' + (ownOpen ? ' on' : '')} disabled={!ownOpen && count >= 3} onClick={() => onOwnOpen(!ownOpen)}>
          {OWN_CHIP}
        </button>
      </div>
      {ownOpen && (
        <label className="fb-comment rv-own">
          <span>Your tag</span>
          <span className="fb-tag-row">
            <input
              value={own}
              maxLength={TAG_MAX}
              autoFocus
              autoComplete="off"
              placeholder="e.g. wings too small"
              onChange={(e) => onOwn(e.target.value.slice(0, TAG_MAX))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onDone();
                if (e.key !== 'Escape') e.stopPropagation(); // typing stays out of the world and the menus
              }}
            />
            <span className="fb-tag-count">
              {own.length}/{TAG_MAX}
            </span>
          </span>
        </label>
      )}
      <div className="rv-done">
        <span className="ds-muted fb-count">{count} / 3 selected</span>
        <button className="ds-action" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
