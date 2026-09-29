// The right-hand detail column: the item's picture beside its name and a few
// stat rows, a rule, the description, a rule, then full-width action
// buttons. Every section is optional so other panels (shop, crafting,
// storage) can reuse the same structure.
import type { ReactNode } from 'react';
import { FitSprite, type SpriteLook } from './FitSprite';

export interface Stat {
  icon: ReactNode;
  value: ReactNode;
  label: string;
}

export interface Action {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function DetailPanel({
  look,
  title,
  stats = [],
  children,
  actions = [],
  empty,
}: {
  look?: SpriteLook;
  title?: string;
  stats?: Stat[];
  children?: ReactNode; // description block
  actions?: Action[];
  empty?: ReactNode; // shown instead when nothing is selected
}) {
  if (!look || !title) {
    return <aside className="ds-detail ds-detail-empty">{empty}</aside>;
  }
  return (
    <aside className="ds-detail">
      <div className="ds-detail-head">
        <FitSprite className="ds-detail-art" look={look} fill={0.8} maxScale={2.6} />
        <div className="ds-detail-titles">
          <div className="ds-detail-title">{title}</div>
          {stats.map((s) => (
            <div key={s.label} className="ds-stat">
              <span className="ds-stat-icon">{s.icon}</span>
              <span className="ds-stat-value">{s.value}</span>
              <span className="ds-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      {children && <div className="ds-detail-desc">{children}</div>}
      {actions.length > 0 && (
        <div className="ds-actions">
          {actions.map((a) => (
            <button key={a.label} className="ds-action" onClick={a.onClick} disabled={a.disabled}>
              <span className="ds-action-icon">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
