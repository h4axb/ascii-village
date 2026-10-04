// The user-test screens around the quests: the QUEST COMPLETE popup, Mitchy's
// rating questions (one at a time, identical for both conditions), the black
// test-transition screen and the closing survey prompt. Presentational;
// App.tsx owns the flow and stores the answers.
import { useState } from 'react';
import * as S from '../sprites';
import { FitSprite, Panel } from '../ui';
import { RATING_QUESTIONS, RATING_SCALE, TRANSITION_TEXT, type RatingQuestion } from './quests';

export function QuestComplete({ title, text }: { title: string; text: string }) {
  return (
    <div className="quest-done" role="status">
      <div className="quest-done-kicker">QUEST COMPLETE</div>
      <div className="quest-done-title">{title}</div>
      <div className="quest-done-text">{text}</div>
    </div>
  );
}

const MitchyFace = () => (
  <div className="ds-portrait-box ds-panel-face">
    <FitSprite look={S.MITCHY_FACE_LOOK} solid={{}} fill={0.92} maxScale={3} />
  </div>
);

// One question at a time: 1-5 or Skip. `onAnswer` gets null for a skip.
// After the last one the `end` content shows (Continue / the survey).
export function RatingSequence({
  intro,
  onAnswer,
  end,
}: {
  intro: string; // Mitchy's lead-in line, shown above the first question
  onAnswer: (q: RatingQuestion, value: number | null, index: number) => void;
  end: React.ReactNode;
}) {
  const [i, setI] = useState(0);
  const q = RATING_QUESTIONS[i] as RatingQuestion | undefined;
  const answer = (v: number | null) => {
    if (!q) return;
    onAnswer(q, v, i);
    setI(i + 1);
  };
  return (
    <div className="rq-scrim">
      <Panel title="Mitchy" className="rq">
        <div className="ds-panel-art">
          <MitchyFace />
        </div>
        {q ? (
          <>
            {i === 0 && <p className="ds-panel-text rq-intro">{intro}</p>}
            <div className="rq-count">
              {i + 1} / {RATING_QUESTIONS.length}
            </div>
            <p className="ds-panel-text rq-q">{q.text}</p>
            <div className="rq-scale" role="radiogroup" aria-label={q.text}>
              {RATING_SCALE.map((v) => (
                <button key={v} className="ds-option rq-btn" onClick={() => answer(v)} aria-label={String(v)}>
                  {v}
                </button>
              ))}
            </div>
            <div className="rq-labels">
              <span>{q.low}</span>
              <span>{q.high}</span>
            </div>
            <button className="ds-link rq-skip" onClick={() => answer(null)}>
              Skip
            </button>
          </>
        ) : (
          end
        )}
      </Panel>
    </div>
  );
}

// USERTEST_TRANSITION: gameplay is paused underneath
export function TestTransition({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="tt" role="dialog" aria-label="User test transition">
      <div className="tt-body">
        {TRANSITION_TEXT.map((t) => (
          <p key={t}>{t}</p>
        ))}
        <button className="ds-action go tt-btn" onClick={onBegin}>
          <span>Begin second part</span>
        </button>
      </div>
    </div>
  );
}
