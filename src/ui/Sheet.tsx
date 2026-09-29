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
}: {
  label: string; // accessible name of the dialog
  onBack?: () => void;
  onClose: () => void;
  money?: number;
  children: ReactNode;
  footer?: ReactNode; // e.g. a key hint line
}) {
  return (
    <div className="ds-sheet" role="dialog" aria-label={label} aria-modal="true">
      {onBack && (
        <button className="ds-iconbtn ds-sheet-back" onClick={onBack} aria-label="back">
          <IconBack />
        </button>
      )}
      <div className="ds-sheet-corner">
        <button className="ds-iconbtn" onClick={onClose} aria-label="close">
          <IconClose />
        </button>
        {money !== undefined && <Currency amount={money} />}
      </div>
      <div className="ds-sheet-body">{children}</div>
      {footer && <div className="ds-sheet-footer">{footer}</div>}
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
