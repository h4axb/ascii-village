// Talking to Mitchy: the workshop's chat window (same look as CraftModal),
// with reply buttons instead of a text field. The player can ask how she is
// doing or what the stars say about their luck today (Mitchy is into
// horoscopes); her answers are generated in her voice (llm.ts mitchySmallTalk
// / mitchyLuck). One luck reading per day: asking again repeats it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as S from './sprites';
import { mitchyLuck, mitchySmallTalk } from './llm';
import { MITCHY_NAME } from './introPartB';
import { linkKey } from './link';
import { Bubble, ChatMessage, Frame, Sheet, type Speaker } from './ui';

const MITCHY: Speaker = { name: MITCHY_NAME, look: S.MITCHY_FACE_LOOK, solid: {} };

// the first talk ever plugs the craft tokens; after that, a greeting
const TOKEN_LINE =
  'did u already try buying craft tokens with ur hard-earned money? i got a few options. if u want, come around!';
const GREETINGS = [
  'oh hey u! pull up a crate, what is on ur mind?',
  'purr, look who it is. what can i do for u?',
  'hey hey! the shop is quiet, so i am all ears.',
  'welcome back! wanna chat a little?',
];

const LUCK_KEY = linkKey('asciia-mitchy-luck');
const today = () => new Date().toISOString().slice(0, 10);
function storedLuck(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(LUCK_KEY) ?? 'null') as { day?: string; text?: string } | null;
    return v?.day === today() && v.text ? v.text : null;
  } catch {
    return null;
  }
}
function storeLuck(text: string) {
  try {
    localStorage.setItem(LUCK_KEY, JSON.stringify({ day: today(), text }));
  } catch {
    // storage blocked: she just reads the stars again next time
  }
}

type Line = { who: 'mitchy' | 'me'; text: string };

export function MitchyTalk({
  player,
  money,
  first,
  onClose,
}: {
  player: Speaker;
  money: number;
  first: boolean; // the player's first talk with her: the craft-token tip
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(() => [
    { who: 'mitchy', text: first ? TOKEN_LINE : GREETINGS[Math.floor(Math.random() * GREETINGS.length)] },
  ]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  function ask(question: string, answer: () => Promise<string>) {
    setLines((l) => [...l, { who: 'me', text: question }]);
    setBusy(true);
    void answer().then((text) => {
      if (!alive.current) return;
      setLines((l) => [...l, { who: 'mitchy', text }]);
      setBusy(false);
    });
  }

  const name = player.name;
  const options = [
    {
      label: 'Hey Mitchy, how are you doing?',
      go: () => ask('Hey Mitchy, how are you doing?', () => mitchySmallTalk(name)),
    },
    {
      label: 'What do the stars say about my luck today?',
      go: () =>
        ask('What do the stars say about my luck today?', async () => {
          const known = storedLuck();
          if (known) return `the stars have not changed since earlier today, purr. ${known}`;
          const text = await mitchyLuck(name, new Date().toDateString());
          storeLuck(text);
          return text;
        }),
    },
    { label: 'See you later!', go: onClose },
  ];

  // arrows + Enter pick a reply (Esc closes, handled by the game)
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        options[sel].go();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // keep the newest message in view
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, busy]);

  // consecutive lines from the same speaker share one face
  const groups: { who: Line['who']; texts: string[] }[] = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && g.who === l.who) g.texts.push(l.text);
    else groups.push({ who: l.who, texts: [l.text] });
  }
  if (busy) {
    const g = groups[groups.length - 1];
    if (g && g.who === 'mitchy') g.texts.push('…');
    else groups.push({ who: 'mitchy', texts: ['…'] });
  }

  return (
    <Sheet label="Talk to Mitchy" onBack={onClose} onClose={onClose} money={money} fill>
      <Frame className="cw3 talk">
        <div className="cw3-body">
          <div className="cw3-chat" ref={chatRef}>
            {groups.map((g, i) => (
              <ChatMessage key={i} who={g.who === 'me' ? player : MITCHY} side={g.who === 'me' ? 'right' : 'left'}>
                {g.texts.map((t, j) => (
                  <Bubble key={j} className={t === '…' ? 'talk-typing' : undefined}>
                    {t}
                  </Bubble>
                ))}
              </ChatMessage>
            ))}
            {!busy && (
              <div className="ds-options cw3-replies" role="listbox">
                {options.map((o, i) => (
                  <button
                    key={o.label}
                    role="option"
                    aria-selected={i === sel}
                    className={'ds-option' + (i === sel ? ' sel' : '')}
                    onMouseEnter={() => setSel(i)}
                    onClick={o.go}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Frame>
    </Sheet>
  );
}
