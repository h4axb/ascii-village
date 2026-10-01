// The frame every full-screen panel sits in: a translucent, blurred sheet
// over the world, a back button top-left, a close button top-right and the
// player's money under it. Content goes in `children` (see Split for the
// usual two-column layout).
import type { ReactNode } from 'react';
import { IconBack, IconClose, IconCoin } from './icons';

export function Sheet({
  label,
  onBack,
  onClose,
  money,
  children,
  footer,
  rail,
}: {
  label: string; // accessible name of the dialog
  // a column of icon buttons under the back button (e.g. the shop's
  // Sell / Buy switch); the content starts to its right
  onBack?: () => void;
  onClose: () => void;
  money?: number;
  children: ReactNode;
  footer?: ReactNode; // e.g. a key hint line
  rail?: ReactNode;
}) {
  return (
    <div className="ds-sheet" role="dialog" aria-label={label} aria-modal="true">
      {/* One centred column: the top bar spans exactly the content's width,
          so ← lines up with the content's left edge and ✕ + currency with
          its right edge. */}
      <div className="ds-sheet-inner">
        <div className="ds-sheet-top">
          {onBack ? (
            <button className="ds-iconbtn" onClick={onBack} aria-label="back">
              <IconBack />
            </button>
          ) : (
            <span />
          )}
          <div className="ds-sheet-corner">
            <button className="ds-iconbtn" onClick={onClose} aria-label="close">
              <IconClose />
            </button>
            {money !== undefined && <Currency amount={money} />}
          </div>
        </div>
        {rail ? (
          <div className="ds-sheet-body has-rail">
            <div className="ds-sheet-rail">{rail}</div>
            <div className="ds-sheet-main">{children}</div>
          </div>
        ) : (
          <div className="ds-sheet-body">{children}</div>
        )}
        {footer && <div className="ds-sheet-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Currency({ amount }: { amount: number }) {
  return (
    <div className="ds-currency" title="your coins">
      <IconCoin />
      <span>{amount.toLocaleString()}</span>
    </div>
  );
}

// Left content + right detail column, top-aligned.
export function Split({ children }: { children: ReactNode }) {
  return <div className="ds-split">{children}</div>;
}
