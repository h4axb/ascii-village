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

export function GearIcon({ className }: P) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3.1" />
      <circle cx="12" cy="12" r="6.2" />
      {/* teeth */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={12 + Math.cos(a) * 6.2}
            y1={12 + Math.sin(a) * 6.2}
            x2={12 + Math.cos(a) * 8.6}
            y2={12 + Math.sin(a) * 8.6}
          />
        );
      })}
    </svg>
  );
}

export function BagIcon({ className }: P) {
  return (
    <svg {...base} className={className}>
      {/* bag body + handle */}
      <path d="M5.4 8.2h13.2l-1 11.3H6.4z" />
      <path d="M9 8.2V6.6a3 3 0 0 1 6 0v1.6" />
      {/* little refresh swirl, as in the sketch */}
      <path d="M10 13.8a2.3 2.3 0 1 0 .9-1.8" />
      <path d="M10.7 10.4v1.8h1.8" />
    </svg>
  );
}

export function HandIcon({ className }: P) {
  return (
    <svg {...base} className={className}>
      {/* four fingers + thumb, open palm */}
      <path d="M9.4 11V5.9a1.2 1.2 0 0 1 2.4 0V11" />
      <path d="M11.8 10.7V4.9a1.2 1.2 0 0 1 2.4 0v5.8" />
      <path d="M14.2 11V6.4a1.2 1.2 0 0 1 2.4 0V13" />
      <path d="M9.4 11.4V9.2a1.2 1.2 0 0 0-2.4 0v5.4" />
      <path d="M7 14.6c0 3 2.2 5.4 5.2 5.4s4.4-2 4.4-5.2" />
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
