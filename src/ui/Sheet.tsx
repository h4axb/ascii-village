// The frame every full-screen panel sits in: a translucent, blurred sheet
// over the world, a back button top-left, a close button top-right and the
// player's money under it. Content goes in `children` (see Split for the
// usual two-column layout).
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconBack, IconClose, IconCoin } from './icons';

export function Sheet({
  label,
  onBack,
  onClose,
  money,
  children,
  footer,
  rail,
  fill,
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
  // run from the top edge of the screen to the bottom (the crafting and
  // shop windows); the content stretches into the height
  fill?: boolean;
}) {
  const ref = useFitToScreen(!!fill);
  return (
    <div className={'ds-sheet' + (fill ? ' fill' : '')} ref={ref} role="dialog" aria-label={label} aria-modal="true">
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

// A sheet never scrolls and is never cropped: when its natural size is
// bigger than the window (small laptop screens), it is scaled down as a
// whole until it fits, keeping every proportion. On a screen it already fits
// it is left exactly as it is. transform doesn't change the layout size, so
// measuring offsetWidth/Height always reads the natural size and the
// ResizeObserver can't feed back into itself.
//
// A `fill` sheet is already exactly the window's height, so what's scaled
// (from the top) is its content, when the content needs more than that.
const SCREEN_MARGIN = 12; // px kept free around a sheet that doesn't fill
function useFitToScreen(fill: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const sheet = ref.current;
    const el = fill ? (sheet?.querySelector<HTMLElement>('.ds-sheet-inner') ?? null) : sheet;
    if (!sheet || !el) return;
    const fit = () => {
      let k: number;
      if (fill) {
        const cs = getComputedStyle(sheet);
        const availH = sheet.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const availW = sheet.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        // the inner box is exactly the sheet's height; what its content
        // really needs is its scroll size
        k = Math.min(1, availH / el.scrollHeight, availW / el.offsetWidth);
      } else {
        k = Math.min(
          1,
          (window.innerWidth - SCREEN_MARGIN * 2) / el.offsetWidth,
          (window.innerHeight - SCREEN_MARGIN * 2) / el.offsetHeight,
        );
      }
      el.style.transform = k < 1 ? `scale(${k})` : '';
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(sheet);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [fill]);
  return ref;
}
