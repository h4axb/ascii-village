// Small centred panels: a titled card for short content (settings) and a
// choice card (a question + options, e.g. "Do you want to shake this palm
// tree?  Yes / No"). Same surface, lines and option buttons as <Dialogue>;
// the owner handles keys (arrows / Enter / F / Esc).
import type { ReactNode } from 'react';

export function Panel({
  title,
  children,
  hint,
  className,
}: {
  title?: string;
  children?: ReactNode;
  hint?: ReactNode; // key hint line at the bottom
  className?: string;
}) {
  return (
    <div className={'ds-panel' + (className ? ' ' + className : '')} role="dialog" aria-label={title}>
      {title && <div className="ds-panel-title">{title}</div>}
      {children}
      {hint && <div className="ds-panel-hint">{hint}</div>}
    </div>
  );
}

export function ChoicePanel({
  title,
  question,
  options,
  sel,
  onSel,
  onPick,
  hint,
  art,
  details,
}: {
  title: string;
  question?: ReactNode;
  options: readonly string[];
  sel: number;
  onSel: (i: number) => void;
  onPick: (i: number) => void;
  hint?: ReactNode;
  art?: ReactNode; // optional picture above the question (e.g. Mitchy)
  // per option: a richer label (an icon, a price) and a line saying what it does
  details?: readonly ({ label?: ReactNode; sub?: ReactNode } | undefined)[];
}) {
  return (
    <Panel title={title} hint={hint} className="ds-choice">
      {art && <div className="ds-panel-art">{art}</div>}
      {question && <p className="ds-panel-text">{question}</p>}
      <div className="ds-options" role="listbox">
        {options.map((o, i) => (
          <button
            key={o}
            role="option"
            aria-selected={i === sel}
            className={'ds-option' + (i === sel ? ' sel' : '') + (details?.[i]?.sub ? ' has-sub' : '')}
            onMouseEnter={() => onSel(i)}
            onClick={(e) => {
              e.stopPropagation();
              onPick(i);
            }}
          >
            {details?.[i]?.sub ? (
              <>
                <span className="ds-option-label">{details[i]!.label ?? o}</span>
                <span className="ds-option-sub">{details[i]!.sub}</span>
              </>
            ) : (
              (details?.[i]?.label ?? o)
            )}
          </button>
        ))}
      </div>
    </Panel>
  );
}
