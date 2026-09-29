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
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  // default: the outlined action button. 'go': the one primary action of a
  // screen, green once enabled. 'link': a small underlined help action that
  // must not compete with the others.
  variant?: 'default' | 'go' | 'link';
}

export function DetailPanel({
  look,
  title,
  titleAside,
  stats = [],
  children,
  extra,
  actions = [],
  empty,
}: {
  look?: SpriteLook;
  title?: string;
  titleAside?: ReactNode; // right of the title, e.g. the item's coin value
  stats?: Stat[];
  children?: ReactNode; // description block
  extra?: ReactNode; // a screen-specific block under the description (e.g. payment controls)
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
          <div className="ds-detail-title">
            <span>{title}</span>
            {titleAside && <span className="ds-detail-title-aside">{titleAside}</span>}
          </div>
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
      {extra}
      {actions.length > 0 && (
        <div className="ds-actions">
          {actions.map((a) =>
            a.variant === 'link' ? (
              <button key={a.label} className="ds-link" onClick={a.onClick} disabled={a.disabled}>
                {a.label}
              </button>
            ) : (
              <button
                key={a.label}
                className={'ds-action' + (a.variant === 'go' ? ' go' : '')}
                onClick={a.onClick}
                disabled={a.disabled}
              >
                <span className="ds-action-icon">{a.icon}</span>
                <span>{a.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </aside>
  );
}
