// Line-art HUD icons. Hand-rolled inline SVG (no icon dependency, matching
// the project's zero-dependency rule). All draw with `currentColor` so the
// colour comes from CSS, and share one 24x24 viewBox so they optically match
// at any size.

type P = { className?: string; title?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function SunIcon({ className }: P) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4.2" />
      {/* 8 rays */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={12 + Math.cos(a) * 6.6}
            y1={12 + Math.sin(a) * 6.6}
            x2={12 + Math.cos(a) * 9}
            y2={12 + Math.sin(a) * 9}
          />
        );
      })}
    </svg>
  );
}

export function MoonIcon({ className }: P) {
  return (
    <svg {...base} className={className}>
      <path d="M20.5 13.2A8.4 8.4 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z" />
    </svg>
  );
}

// The gear / bag / hand line-art icons that used to live here are gone: the
// HUD orbit menu now uses the glyph-art SVGs in src/assets instead, and
// nothing else referenced them.

export function SaveIcon({ className }: P) {
  return (
    <svg {...base} className={className}>
      {/* floppy-disk body with a clipped corner, a label window, a write-slot */}
      <path d="M4.5 4.5h12l3 3v12h-15z" />
      <path d="M7.5 4.5v6h7.5v-6" />
      <path d="M7.5 20v-6h9v6" />
    </svg>
  );
}

export function CoinIcon({ className }: P) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4 13.18 10.38 16.37 10.58 13.9 12.62 14.7 15.72 12 14 9.3 15.72 10.1 12.62 7.63 10.58 10.82 10.38Z" />
    </svg>
  );
}
