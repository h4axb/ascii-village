// Small name-entry panel shown once, mid Intro Part B (after Mitchy asks
// "What's your name?"). A design-system panel (src/ui): the same surface,
// field and option button as the birthday question in MitchyTalk.
import { useEffect, useRef, useState } from 'react';
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
  // a name is required: trying to go on without one says so and shakes the
  // field
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const name = value.trim().slice(0, MAX_NAME_LEN);
    if (!name) {
      setMissing(true);
      const el = inputRef.current;
      el?.focus();
      el?.animate(
        [0, -6, 5, -3, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 380, easing: 'ease' },
      );
      return;
    }
    onSubmit(name);
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
          ref={inputRef}
          autoFocus
          disabled={locked}
          className="introb-name-input"
          value={value}
          maxLength={MAX_NAME_LEN}
          placeholder="your name"
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value.trim()) setMissing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <div className="ds-options">
          <button className="ds-option introb-name-submit" disabled={locked} onClick={submit}>
            Confirm
          </button>
        </div>
        {locked ? (
          <div className="ds-panel-hint">continuing automatically as "{DEFAULT_PLAYER_NAME}"…</div>
        ) : missing ? (
          <div className="ds-panel-hint" role="alert">
            Please enter a name.
          </div>
        ) : null}
      </div>
    </div>
  );
}
