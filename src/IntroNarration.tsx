// Presentational component for Intro Stage A's internal-monologue
// narration (see src/introNarrationData.ts — the ONE authoritative narration
// source for the whole unified intro, not just Stage A — for the data,
// and IntroA.tsx for the sequencing that drives this). A small "data
// drives a small presentational component" piece, the same shape as
// DialogueBox.tsx, but intentionally a different, simpler shell — no
// speaker label, no choices; must read as thought, not speech. It does
// share DialogueBox's "next" arrow: click it or press Enter to move on (the
// beat also moves on by itself after AUTO_NEXT_MS — see IntroA.tsx).
//
// A bottom-center black chat box (see styles.css's .introa-narration-*
// rules) at one FIXED size regardless of which beat is showing — sized to
// fit the single longest line across all of introNarrationData.ts's stages
// (see styles.css's own comment for the exact number), so the box never
// grows/shrinks/reflows between beats. The full line pops in at once (no
// per-letter typing).
//
// `text === null` renders nothing shown (opacity 0, still mounted) rather
// than unmounting, so the CSS opacity transition actually gets to play on
// both the fade-in and the fade-out.
import { NextArrow } from './DialogueBox';

export default function IntroNarration({ text, onNext }: { text: string | null; onNext?: () => void }) {
  return (
    <div className="introa-narration-wrap">
      <div className={'introa-narration-box' + (text ? ' visible' : '')}>
        <p className="introa-narration-text">{text ?? ' '}</p>
        {text && <NextArrow onClick={onNext} />}
      </div>
    </div>
  );
}
