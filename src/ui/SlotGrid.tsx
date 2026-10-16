// A grid of equal item slots (5 columns). Always shows at least `minSlots`
// (empty ones included, so the grid keeps its shape); more items add rows,
// and the grid scrolls inside its fixed height rather than growing.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FitSprite, type SpriteLook } from './FitSprite';

export interface Slot {
  key: string;
  look: SpriteLook;
  count?: number; // bottom-right number (stackables)
  tag?: string; // top-right mark, e.g. TOKEN / EQ
  disabled?: boolean; // shown greyed, not clickable
  note?: string; // shown in a small box while hovered (e.g. why it's greyed)
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
  // the hovered slot's note, over the slot (fixed, so the grid's scrolling
  // box never clips it)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  return (
    <div className="ds-grid" onMouseLeave={() => setTip(null)}>
      {tip &&
        createPortal(
          <div className="ds-slot-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </div>,
          document.body,
        )}
      {cells.map((s, i) =>
        s ? (
          <button
            key={s.key}
            className={'ds-slot filled' + (s.key === selected ? ' sel' : '') + (s.disabled ? ' disabled' : '')}
            onClick={(e) => {
              e.stopPropagation();
              if (!s.disabled) onSelect(s);
            }}
            aria-label={s.note ? `${s.label}: ${s.note}` : s.label}
            aria-pressed={s.key === selected}
            onMouseEnter={(e) => {
              if (!s.note) return setTip(null);
              const r = e.currentTarget.getBoundingClientRect();
              setTip({ text: s.note, x: r.left + r.width / 2, y: r.top });
            }}
            onMouseLeave={() => setTip(null)}
          >
            <FitSprite look={s.look} fill={0.72} maxScale={2.2} cells />
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
