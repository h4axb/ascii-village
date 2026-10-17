// The quest overlay under the clock (top-left): the questline, the current
// objective (icon, title, optional counter) and one line of subtext. It
// slides closed to a bookmark tab; a second bookmark under it opens the
// game's controls in the same sliding card. Presentational; App.tsx owns the
// state and decides when it shows.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Objective } from './quests';
import { PixelIcon } from '../ui/PixelIcon';

// A finished step's beat (see QuestPanel): crossed out, then slid out, then
// the next step slides in. Played only while the quest view is showing.
export const STEP_DONE_MS = 2200;
const STEP_SLIDE_MS = 350;

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

// The quest bookmark: a clipboard with its list ticked off in green
const CLIPBOARD = [
  '......OOOOO......',
  '......OgOgO......',
  '.OOOOOgggggOOOOO.',
  '.OBBBOGGGGGOBBBO.',
  '.OBOOOOOOOOOOOBO.',
  '.OBOPPPPPPPPPOBO.',
  '.OBOPPPPCPPPPOBO.',
  '.OBOPCPCPPKKKOBO.',
  '.OBOPPCPPPPPPOBO.',
  '.OBOPPPPPPPPPOBO.',
  '.OBOPPPPCPPPPOBO.',
  '.OBOPCPCPPKKKOBO.',
  '.OBOPPCPPPPPPOBO.',
  '.OBOPPPPPPPPPOBO.',
  '.OBOPPPPCPPPPOBO.',
  '.OBOPCPCPPKKKOBO.',
  '.OBOPPCPPPPPPOBO.',
  '.OBOPPPPPPPPPOBO.',
  '.OBOOOOOOOOOOOBO.',
  '.OBBBBBBBBBBBBBO.',
  '.OOOOOOOOOOOOOOO.',
];
const CLIPBOARD_COLORS = {
  O: '#2a1f17',
  B: '#8a5a35',
  G: '#5f5f5c',
  g: '#8f8f8a',
  P: 'var(--ds-select)',
  K: '#2a1f17',
  C: 'var(--ds-go)',
};
function ClipboardIcon() {
  return <PixelIcon map={CLIPBOARD} colors={CLIPBOARD_COLORS} />;
}

// The controls bookmark: the W A S D keycaps, bevelled like real keys, in
// the panel's own olive and cream (ui.css .qp-tab sets the --qp-key-*)
const WASD = [
  '........OOOOO........',
  '.......OLLLLLO.......',
  '.......OTFFFTO.......',
  '.......OTFFFTO.......',
  '.......OTFTFTO.......',
  '.......OTTFTTO.......',
  '.......OTFFFTO.......',
  '.......ODDDDDO.......',
  '........OOOOO........',
  '.OOOOO..OOOOO..OOOOO.',
  'OLLLLLOOLLLLLOOLLLLLO',
  'OFFTFFOOFTTTFOOFTTFFO',
  'OFTFTFOOFTFFFOOFTFTFO',
  'OFTTTFOOFTTTFOOFTFTFO',
  'OFTFTFOOFFFTFOOFTFTFO',
  'OFTFTFOOFTTTFOOFTTFFO',
  'ODDDDDOODDDDDOODDDDDO',
  '.OOOOO..OOOOO..OOOOO.',
];
const WASD_COLORS = {
  O: 'var(--qp-key-out)',
  L: 'var(--qp-key-light)',
  F: 'var(--qp-key-face)',
  D: 'var(--qp-key-dark)',
  T: 'var(--qp-key-letter)',
};
function WasdIcon() {
  return <PixelIcon map={WASD} colors={WASD_COLORS} />;
}
function BulbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.2 1.1 2v.7h5v-.7c0-.8.4-1.5 1.1-2A6 6 0 0 0 12 3.5z" strokeLinejoin="round" strokeLinecap="round" />
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
  seen,
  onSeen,
}: {
  onHint?: () => void; // the light bulb: play this step's hint
  hintBusy?: boolean; // a hint is playing
  blinkControls?: boolean; // the Controls bookmark blinks (a hint)
  blinkQuest?: boolean; // the Quest bookmark blinks (the way back from the controls)
  // the step the player last saw in the quest view; when it isn't the current
  // one, it was finished meanwhile: its beat plays, then onSeen(current)
  seen?: Objective | null;
  onSeen?: (id: string) => void;
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
  // the finished step's beat: 'done' (crossed out) → 'out' → 'in' (the next)
  const [phase, setPhase] = useState<'idle' | 'done' | 'out' | 'in'>('idle');
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const showing = open && view === 'quest';
  const pending = !!seen && seen.id !== objective.id;
  useEffect(() => {
    if (!showing || !pending || phase !== 'idle') return;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    setPhase('done');
    at(STEP_DONE_MS, () => setPhase('out'));
    at(STEP_DONE_MS + STEP_SLIDE_MS, () => {
      setPhase('in');
      onSeen?.(objective.id);
    });
    at(STEP_DONE_MS + 2 * STEP_SLIDE_MS, () => setPhase('idle'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, pending, phase]);
  // what the card shows: the finished step during its beat, else the current
  const finished = (phase === 'done' || phase === 'out') && seen ? seen : null;
  const shown = finished ?? objective;

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
      <div className={'qp-body' + (finished ? ' done' : '') + (phase === 'out' ? ' out' : phase === 'in' ? ' in' : '')}>
        {/* the step's title (the questline's own title and intro aren't
            shown in the panel), the hint's light bulb on its right */}
        <div className="qp-head">
          <div className="qp-title">
            {finished && <span className="qp-check">✓ </span>}
            {shown.title}
          </div>
          {onHint && (
            <button className="qp-hint" onClick={onHint} disabled={hintBusy} aria-label="hint" title="Hint">
              <BulbIcon />
            </button>
          )}
        </div>
        <div className="qp-task">
          {shown.icon && <span className="qp-icon">{shown.icon}</span>}
          <span className="qp-strike">{finished ? shown.task : (task ?? objective.task)}</span>
        </div>
        {progress && !finished && (
          <div className="qp-progress">
            <span>
              {Math.min(progress.n, progress.of)} / {progress.of}
            </span>
            <span className="qp-bar">
              <span style={{ width: `${(Math.min(progress.n, progress.of) / progress.of) * 100}%` }} />
            </span>
          </div>
        )}
        <p className="qp-sub">
          <span className="qp-strike">{finished ? shown.sub : (sub ?? objective.sub)}</span>
        </p>
      </div>
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
          <ClipboardIcon />
        </button>
        <button
          className={'qp-tab' + (open && view === 'controls' ? ' on' : '') + (blinkControls ? ' blink' : '')}
          onClick={onControls}
          aria-label="controls"
          title="Controls"
        >
          <WasdIcon />
        </button>
      </div>
    </div>
  );
}
