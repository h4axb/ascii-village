// A grid of equal item slots (5 columns). Always shows at least `minSlots`
// (empty ones included, so the grid keeps its shape); more items add rows,
// and the grid scrolls inside its fixed height rather than growing.
import { FitSprite, type SpriteLook } from './FitSprite';

export interface Slot {
  key: string;
  look: SpriteLook;
  count?: number; // bottom-right number (stackables)
  tag?: string; // top-right mark, e.g. TOKEN / EQ
  disabled?: boolean; // shown greyed, not clickable
  label: string; // accessible name
}

export function SlotGrid({
  slots,
  selected,
  onSelect,
  minSlots = 20,
}: {
  slots: Slot[];
  selected: string | null;
  onSelect: (slot: Slot) => void;
  minSlots?: number;
}) {
  const n = Math.max(minSlots, Math.ceil(slots.length / 5) * 5);
  const cells = Array.from({ length: n }, (_, i) => slots[i] ?? null);
  return (
    <div className="ds-grid">
      {cells.map((s, i) =>
        s ? (
          <button
            key={s.key}
            className={'ds-slot filled' + (s.key === selected ? ' sel' : '') + (s.disabled ? ' disabled' : '')}
            onClick={(e) => {
              e.stopPropagation();
              if (!s.disabled) onSelect(s);
            }}
            aria-label={s.label}
            aria-pressed={s.key === selected}
          >
            <FitSprite look={s.look} fill={0.72} maxScale={2.2} />
            {s.count !== undefined && <span className="ds-slot-count">{s.count}</span>}
            {s.tag && <span className="ds-slot-tag">{s.tag}</span>}
          </button>
        ) : (
          <div key={`empty-${i}`} className="ds-slot" aria-hidden />
        ),
      )}
    </div>
  );
}
