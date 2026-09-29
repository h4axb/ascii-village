// A character talking, bottom-centre over the world: a name tab on the box's
// top-left edge, the line inside a framed box with dashed corner brackets,
// a bobbing ▼ when the player can move on, and — when there's a choice — a
// column of options to the right, the active one marked ▶.
//
// Purely presentational: whoever owns the conversation decides what the
// keys and clicks do (see src/DialogueBox.tsx).
import type { ReactNode } from 'react';

// The bobbing "next" arrow (also used by the intro's narration box).
export function NextArrow({ onClick, label = 'next' }: { onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="next-arrow"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <svg viewBox="0 0 12 8" width="14" height="9" aria-hidden>
        <path d="M0 0h12L6 8z" fill="currentColor" />
      </svg>
    </button>
  );
}

export function Dialogue({
  speaker,
  children,
  options,
  sel = 0,
  onSel,
  onPick,
  onNext,
  className,
}: {
  speaker: string;
  children: ReactNode; // the line
  options?: readonly string[];
  sel?: number;
  onSel?: (i: number) => void;
  onPick?: (i: number) => void;
  onNext?: () => void; // shows ▼ and makes the box clickable
  className?: string;
}) {
  const hasOptions = !!options && options.length > 0;
  return (
    <div className={'ds-dialogue-wrap' + (className ? ' ' + className : '')}>
      <div
        className={'ds-dialogue' + (onNext ? ' clickable' : '')}
        onClick={onNext && !hasOptions ? onNext : undefined}
      >
        <div className="ds-dialogue-name">{speaker}</div>
        <span className="ds-bracket tl" />
        <span className="ds-bracket tr" />
        <span className="ds-bracket bl" />
        <span className="ds-bracket br" />
        <div className="ds-dialogue-text">{children}</div>
        {onNext && !hasOptions && <NextArrow onClick={onNext} />}
      </div>
      {hasOptions && (
        <div className="ds-options" role="listbox">
          {options!.map((o, i) => (
            <button
              key={o}
              role="option"
              aria-selected={i === sel}
              className={'ds-option' + (i === sel ? ' sel' : '')}
              onMouseEnter={() => onSel?.(i)}
              onClick={(e) => {
                e.stopPropagation();
                onPick?.(i);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
