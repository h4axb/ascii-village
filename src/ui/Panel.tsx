// Small centred panels: a titled card for short content (settings) and a
// choice card (a question + options, e.g. "Do you want to shake this palm
// tree?  Yes / No"). Same surface, lines and option buttons as <Dialogue>;
// the owner handles keys (arrows / Enter / F / Esc).
import { createContext, useContext, type ReactNode } from 'react';
import { IconClose } from './icons';

// The close (X) action for the panel shown as a modal: given, every Panel
// draws its own X inside its top-right corner
export const PanelCloseContext = createContext<(() => void) | null>(null);

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
  const close = useContext(PanelCloseContext);
  return (
    <div className={'ds-panel' + (close ? ' has-x' : '') + (className ? ' ' + className : '')} role="dialog" aria-label={title}>
      {close && (
        <button className="ds-iconbtn ds-panel-x" onClick={close} aria-label="close">
          <IconClose />
        </button>
      )}
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
