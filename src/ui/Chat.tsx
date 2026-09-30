// A conversation, message by message: each message has the speaker's face in
// a square box with their name under it, and a framed bubble pointing at
// them. Mitchy (and any NPC) on the left, the player on the right.
//
//   [face]  ┌ bubble ─────┐                     ┌ bubble ┐  [face]
//   Mitchy  └─────────────┘                     └────────┘  Player
//
// Purely presentational; the owner builds the list (see src/CraftModal.tsx).
import type { ReactNode } from 'react';
import { FitSprite, type SpriteLook } from './FitSprite';

export interface Speaker {
  name: string;
  look: SpriteLook;
  solid?: { eyeRow?: number }; // the player's per-cell backing (see FitSprite)
  cover?: boolean; // crop a wide face to fill the box (the player's) instead of fitting it whole
}

export function Portrait({ who }: { who: Speaker }) {
  return (
    <div className="ds-portrait">
      <div className="ds-portrait-box">
        <FitSprite look={who.look} solid={who.solid} cover={!!who.cover} fill={who.cover ? 1.1 : 0.9} maxScale={3} />
      </div>
      <div className="ds-portrait-name">{who.name}</div>
    </div>
  );
}

// One message. `side` puts the face left (npc) or right (player); several
// bubbles in a row from the same speaker share one face.
export function ChatMessage({
  who,
  side,
  children,
}: {
  who: Speaker;
  side: 'left' | 'right';
  children: ReactNode; // one or more <Bubble>s
}) {
  return (
    <div className={'ds-msg ' + side}>
      <Portrait who={who} />
      <div className="ds-msg-bubbles">{children}</div>
    </div>
  );
}

export function Bubble({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={'ds-bubble' + (className ? ' ' + className : '')}>{children}</div>;
}

// A framed box with the dashed corner brackets of the dialogue box.
export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={'ds-frame' + (className ? ' ' + className : '')}>
      <span className="ds-bracket tl" />
      <span className="ds-bracket tr" />
      <span className="ds-bracket bl" />
      <span className="ds-bracket br" />
      {children}
    </div>
  );
}
