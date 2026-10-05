// Small name-entry panel shown once, mid Intro Part B (after Mitchy asks
// "What's your name?"). A design-system panel (src/ui): the same surface,
// field and option button as the birthday question in MitchyTalk.
import { useEffect, useState } from 'react';
import { AUTO_ADVANCE_MS, DEFAULT_PLAYER_NAME } from './introPartB';

const MAX_NAME_LEN = 18;

export default function NameEntryPanel({
  onSubmit,
  locked,
}: {
  onSubmit: (name: string) => void;
  // Test-mode only — see DialogueBox's own `locked` prop for why.
  locked?: boolean;
}) {
  const [value, setValue] = useState('');

  function submit() {
    onSubmit(value.trim().slice(0, MAX_NAME_LEN) || DEFAULT_PLAYER_NAME);
  }

  useEffect(() => {
    if (!locked) return;
    const t = window.setTimeout(() => onSubmit(DEFAULT_PLAYER_NAME), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  return (
    <div className="introb-dialogue-wrap">
      <div className="ds-panel introb-name-entry" role="dialog" aria-label="What's your name?">
        <div className="ds-panel-title">What's your name?</div>
        <input
          autoFocus
          disabled={locked}
          className="introb-name-input"
          value={value}
          maxLength={MAX_NAME_LEN}
          placeholder={DEFAULT_PLAYER_NAME}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <div className="ds-options">
          <button className="ds-option introb-name-submit" disabled={locked} onClick={submit}>
            Confirm
          </button>
        </div>
        <div className="ds-panel-hint">
          {locked ? `continuing automatically as "${DEFAULT_PLAYER_NAME}"…` : `leave blank for "${DEFAULT_PLAYER_NAME}"`}
        </div>
      </div>
    </div>
  );
}
