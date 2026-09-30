// Thin-line icons for the UI design system (see ./ui.css). One stroke width,
// round caps, drawn on a 24px grid and coloured by `currentColor`, so every
// icon matches the 1px frame lines around it at any size.
import type { ReactNode } from 'react';

function Icon({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export type IconProps = { size?: number };

export const IconBack = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M20 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const IconClose = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

// currency: a coin with an inner ring (filled, it's the one warm accent)
export const IconCoin = ({ size = 20 }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
    <circle cx="12" cy="12" r="9" fill="var(--ds-coin)" />
    <circle cx="12" cy="12" r="5.2" fill="none" stroke="var(--ds-coin-dark)" strokeWidth="1.6" />
  </svg>
);

// "in inventory": a small tied pouch
export const IconBag = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M9 4h6l-1.5 3h-3z" />
    <path d="M10.5 7C6 9 5 13 5.5 16.5 6 19.5 8.5 20.5 12 20.5s6-1 6.5-4C19 13 18 9 13.5 7" />
  </Icon>
);

export const IconHand = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v6.5" />
    <path d="M17 11a1.5 1.5 0 0 1 3 0v2.5a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.9-2.6L4 14.3a1.6 1.6 0 0 1 2.6-1.8L8 14V9.5" />
  </Icon>
);

export const IconSprout = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 21v-9" />
    <path d="M12 12C12 8 9 6 4.5 6c0 4 3 6 7.5 6z" />
    <path d="M12 12c0-4 3-6 7.5-6 0 4-3 6-7.5 6z" />
  </Icon>
);

// "place in world": a folded map
export const IconMap = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5L3.5 20z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Icon>
);

// craft token: a coin-like disc with a spark
export const IconSpark = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Icon>
);

// the craft button: a small hammer
export const IconHammer = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M13.5 6.5 5 15a1.8 1.8 0 0 0 2.5 2.5L16 9" />
    <path d="M11.5 4.5 15 3l6 6-1.5 3.5-2-2-2 2-4-4 2-2z" />
  </Icon>
);

// past chats: a clock with a turn-back arrow
export const IconHistory = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4h4" />
    <path d="M12 8v4.5l3 2" />
  </Icon>
);

// settings: a cog (8 teeth around a ring)
export const IconGear = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" />
    <circle cx="12" cy="12" r="6.4" />
  </Icon>
);
