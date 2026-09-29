// Bottom-center sequential dialogue box for Intro Part B. Reuses the
// existing .panel/.dialog-panel/.opts design-token system (see styles.css)
// rather than inventing its own look — the only new CSS is the fixed
// bottom-center positioning wrapper and the yellow key-highlight span.
//
// Supports:
//   - a speaker label that changes mid-conversation ('???' -> 'Mitchy')
//   - inline {KEY:xxx} / {SETTINGS_CONTROLS} highlight tokens (see
//     introPartB.ts's DIALOGUE_HIGHLIGHT_LABELS) rendered as yellow spans
//   - a "next" arrow at the bottom centre of the box (click it, anywhere on
//     the box, or press Enter/Space) when there are no choices; the line
//     also moves on by itself after AUTO_NEXT_MS
//   - a two-option choice prompt (reusing OptList's up/down + enter pattern)
import type React from 'react';
import { useEffect, useState } from 'react';
import { AUTO_ADVANCE_MS, AUTO_NEXT_MS, DIALOGUE_HIGHLIGHT_LABELS } from './introPartB';
import { Dialogue } from './ui';

// The ▼ lives in the design system now; re-exported for IntroNarration.
export { NextArrow } from './ui';

export interface DialogueLine {
  speaker: string;
  text: string;
  choices?: readonly string[];
}

// Splits on {KEY:xxx} and {SETTINGS_CONTROLS}-style tokens, rendering each as
// a yellow key-hint span. Anything not a recognized token (including plain
// {PLAYER_NAME} — that's substituted to plain text BEFORE it ever reaches
// here, by substitutePlayerName) is left as plain text untouched.
function renderHighlighted(text: string): React.ReactNode[] {
  const re = /\{(KEY:[^}]+|SETTINGS_CONTROLS)\}/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[1];
    const label = token.startsWith('KEY:') ? token.slice(4) : DIALOGUE_HIGHLIGHT_LABELS[token] ?? token;
    out.push(
      <span className="key-hl" key={k++}>
        {label}
      </span>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function DialogueBox({
  line,
  onAdvance,
  onChoice,
  locked,
}: {
  line: DialogueLine;
  onAdvance: () => void;
  onChoice: (i: number) => void;
  // Test-mode only (see introPartB.ts's AUTO_ADVANCE_MS) — ignores clicks/
  // keyboard entirely and auto-advances (or auto-picks choice 0) on a
  // timer, so an environment that can't deliver click events into the
  // iframe (an editor's embedded preview) can still play the cinematic
  // through unattended.
  locked?: boolean;
}) {
  const hasChoices = !!line.choices && line.choices.length > 0;
  const [sel, setSel] = useState(0);

  // Reset the highlighted option whenever a fresh choice prompt appears.
  useEffect(() => {
    if (hasChoices) setSel(0);
  }, [line, hasChoices]);

  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (hasChoices) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          setSel((s) => (s + 1) % (line.choices?.length ?? 1));
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChoice(sel);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onAdvance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, hasChoices, line, sel, onAdvance, onChoice]);

  // Normal play: a plain line (no choices) moves on by itself after
  // AUTO_NEXT_MS unless the player advanced it first. Re-armed per line.
  useEffect(() => {
    if (locked || hasChoices) return;
    const t = window.setTimeout(onAdvance, AUTO_NEXT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, hasChoices, line]);

  // Locked/test mode: no click or keyboard, just a timer. Re-armed every
  // time `line` changes (a fresh dialogue beat), same as the sel-reset
  // effect above.
  useEffect(() => {
    if (!locked) return;
    const t = window.setTimeout(() => {
      if (hasChoices) onChoice(0);
      else onAdvance();
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, line]);

  return (
    <Dialogue
      className={locked ? 'introb-locked' : undefined}
      speaker={line.speaker}
      options={hasChoices ? line.choices : undefined}
      sel={sel}
      onSel={locked ? undefined : setSel}
      onPick={locked ? undefined : onChoice}
      onNext={locked ? undefined : onAdvance}
    >
      {renderHighlighted(line.text)}
    </Dialogue>
  );
}
