// The quest overlay under the clock (top-left): the questline, the current
// objective (icon, title, optional counter) and one line of subtext. It
// slides closed to a bookmark tab; a second bookmark under it opens the
// game's controls in the same sliding card. Presentational; App.tsx owns the
// state and decides when it shows.
import type { ReactNode } from 'react';
import type { Objective } from './quests';

export type QuestView = 'quest' | 'controls';

// The keys of one control: letters / words as key caps, 'Mouse' and
// 'Click' as a small mouse drawing
export function KeyCaps({ keys }: { keys: string[] }) {
  return (
    <span className="qp-keys">
      {keys.map((k, i) =>
        k === 'Mouse' || k === 'Click' || k === 'Mouse wheel' ? (
          <MouseIcon key={i} wheel={k === 'Mouse wheel'} />
        ) : (
          <kbd key={i} className={'qp-key' + (k.length > 2 ? ' wide' : '')}>
            {k}
          </kbd>
        ),
      )}
    </span>
  );
}

function MouseIcon({ wheel }: { wheel?: boolean }) {
  return (
    <svg className="qp-mouse" viewBox="0 0 16 22" width="16" height="22" aria-label={wheel ? 'mouse wheel' : 'mouse'}>
      <rect x="1.5" y="1.5" width="13" height="19" rx="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1.5v6.5M1.5 8h13" stroke="currentColor" strokeWidth="1.1" />
      {wheel ? (
        <rect x="6.6" y="3.4" width="2.8" height="3.6" rx="1.3" fill="currentColor" />
      ) : (
        <path d="M2 8V7.5A6 6 0 0 1 8 2v6z" fill="currentColor" opacity="0.55" />
      )}
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M7 3.5h10v17l-5-4-5 4z" strokeLinejoin="round" />
    </svg>
  );
}
function BulbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.2 1.1 2v.7h5v-.7c0-.8.4-1.5 1.1-2A6 6 0 0 0 12 3.5z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10" strokeLinecap="round" />
    </svg>
  );
}

export function QuestPanel({
  objective,
  task,
  sub,
  progress,
  open,
  view,
  controls,
  onToggle,
  onControls,
  onHint,
  hintBusy,
  blinkControls,
  blinkQuest,
}: {
  onHint?: () => void; // the light bulb: play this step's hint
  hintBusy?: boolean; // a hint is playing
  blinkControls?: boolean; // the Controls bookmark blinks (a hint)
  blinkQuest?: boolean; // the Quest bookmark blinks (the way back from the controls)
  objective: Objective;
  task?: string; // overrides objective.task (e.g. once the boat is crafted)
  sub?: string; // overrides objective.sub
  progress?: { n: number; of: number };
  open: boolean;
  view: QuestView;
  controls: [string, string[]][];
  onToggle: () => void; // the quest bookmark
  onControls: () => void; // the controls bookmark
}) {
  let body: ReactNode;
  if (view === 'controls')
    body = (
      <>
        <div className="qp-line">CONTROLS</div>
        <ul className="qp-controls">
          {controls.map(([label, keys]) => (
            <li key={label}>
              <KeyCaps keys={keys} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </>
    );
  else
    body = (
      <>
        {/* the step's title (the questline's own title and intro aren't
            shown in the panel), the hint's light bulb on its right */}
        <div className="qp-head">
          <div className="qp-title">{objective.title}</div>
          {onHint && (
            <button className="qp-hint" onClick={onHint} disabled={hintBusy} aria-label="hint" title="Hint">
              <BulbIcon />
            </button>
          )}
        </div>
        <div className="qp-task">
          {objective.icon && <span className="qp-icon">{objective.icon}</span>}
          <span>{task ?? objective.task}</span>
        </div>
        {progress && (
          <div className="qp-progress">
            <span>
              {Math.min(progress.n, progress.of)} / {progress.of}
            </span>
            <span className="qp-bar">
              <span style={{ width: `${(Math.min(progress.n, progress.of) / progress.of) * 100}%` }} />
            </span>
          </div>
        )}
        <p className="qp-sub">{sub ?? objective.sub}</p>
      </>
    );

  return (
    <div className={'qp' + (open ? ' open' : '')}>
      <div className="qp-card" aria-hidden={!open}>
        {body}
      </div>
      <div className="qp-tabs">
        <button
          className={'qp-tab' + (open && view === 'quest' ? ' on' : '') + (blinkQuest ? ' blink' : '')}
          onClick={onToggle}
          aria-label={open && view === 'quest' ? 'hide the quest' : 'show the quest'}
          title="Quest"
        >
          <BookmarkIcon />
        </button>
        <button
          className={'qp-tab' + (open && view === 'controls' ? ' on' : '') + (blinkControls ? ' blink' : '')}
          onClick={onControls}
          aria-label="controls"
          title="Controls"
        >
          <KeyboardIcon />
        </button>
      </div>
    </div>
  );
}
