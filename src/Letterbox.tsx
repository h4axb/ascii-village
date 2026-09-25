// Top/bottom letterbox bars for Intro Part B. Pure presentational — App.tsx
// owns the two booleans that drive it:
//   visible: mount the bars at all (false the rest of the game, always false
//            before the cinematic's eye-opening reveal begins).
//   open:    slide the bars off-screen (only ever true in the last beat of
//            the cinematic, right before it hands control back).
// The codebase has no letterboxing today (see the .field/.stage comments
// about always covering the viewport edge-to-edge) — this is intentionally
// a plain overlay pinned to the viewport, not part of that scaling system,
// so it never fights it for layout.
import type React from 'react';
import { LETTERBOX_BAR_VH, LETTERBOX_TRANSITION_MS } from './introPartB';

export default function Letterbox({ visible, open }: { visible: boolean; open: boolean }) {
  if (!visible) return null;
  const barStyle = (edge: 'top' | 'bottom'): React.CSSProperties => ({
    position: 'fixed',
    left: 0,
    right: 0,
    [edge]: 0,
    height: `${LETTERBOX_BAR_VH}vh`,
    background: '#000',
    // Above IntroA's root (z-index 10000, IntroA.tsx) — this now also
    // renders during stages 1-14 (App.tsx passes
    // visible={letterboxVisible || introAActive}), so the bars must sit on
    // top of that prologue's own content, not underneath it. Still below
    // .introb-dialogue-wrap (10005) and the DEV Skip Intro button (10010),
    // so dialogue/name entry and the skip control stay usable on top of
    // the bars during stages 15-18.
    zIndex: 10001,
    pointerEvents: 'none',
    transition: `transform ${LETTERBOX_TRANSITION_MS}ms ease`,
    transform: open ? `translateY(${edge === 'top' ? '-100%' : '100%'})` : 'translateY(0)',
  });
  return (
    <>
      <div style={barStyle('top')} />
      <div style={barStyle('bottom')} />
    </>
  );
}
