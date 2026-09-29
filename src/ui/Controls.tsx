// Small form pieces for detail panels: a label/value row and a − n + stepper.
import type { ReactNode } from 'react';

// "Label ........ value" on one line; `strong` for a total.
export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={'ds-row' + (strong ? ' strong' : '')}>
      <span className="ds-row-label">{label}</span>
      <span className="ds-row-value">{value}</span>
    </div>
  );
}

// − n +, clamped to [min, max]; a button that can't act is disabled and
// looks it.
export function Stepper({
  value,
  min = 0,
  max,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  label: string; // accessible name, e.g. "Amount to give"
}) {
  return (
    <div className="ds-stepper" role="group" aria-label={label}>
      <button type="button" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="less">
        −
      </button>
      <span className="ds-stepper-value" aria-live="polite">
        {value}
      </span>
      <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label="more">
        +
      </button>
    </div>
  );
}
