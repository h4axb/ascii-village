// Talking to Mitchy: the workshop's chat window (same look as CraftModal),
// with reply buttons instead of a text field. The player can ask how she is
// doing or what the stars say about their luck today (Mitchy is into
// horoscopes); her answers are generated in her voice (llm.ts mitchySmallTalk
// / mitchyLuck). One luck reading per day: asking again repeats it.
//
// The luck reading is a daily saju (saju.ts): the first time, Mitchy asks for
// the player's birthday. It stays in this browser (per link) and only the
// worked-out pillars reach the AI. "Rather not say" keeps a general horoscope.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as S from './sprites';
import { mitchyLuck, mitchySmallTalk } from './llm';
import { MITCHY_NAME } from './introPartB';
import { linkKey } from './link';
import { dailySaju } from './saju';
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
const BIRTH_KEY = linkKey('asciia-birthdate'); // "YYYY-MM-DD", or "none" = rather not say
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date()); // the player's own calendar day

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    // storage blocked: she just asks again next time
  }
}
// today's reading, if it was made for the same birthday answer
function storedLuck(birth: string): string | null {
  try {
    const v = JSON.parse(read(LUCK_KEY) ?? 'null') as { day?: string; birth?: string; text?: string } | null;
    return v?.day === today() && v.birth === birth && v.text ? v.text : null;
  } catch {
    return null;
  }
}
const storeLuck = (birth: string, text: string) => write(LUCK_KEY, JSON.stringify({ day: today(), birth, text }));

// Settings → "Forget my birthday"
export const hasBirthDate = () => !!read(BIRTH_KEY);
export function forgetBirthDate() {
  write(BIRTH_KEY, null);
  write(LUCK_KEY, null);
}

const LUCK_Q = 'What do the stars say about my luck today?';
const MIN_BIRTH = '1900-01-01';

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
  const [askingBirth, setAskingBirth] = useState(false);
  const [birth, setBirth] = useState('');
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

  // the reading itself, for a stored birthday answer ("none": a general horoscope)
  function readStars(answer: string) {
    const known = storedLuck(answer);
    if (known) return Promise.resolve(`the stars have not changed since earlier today, purr. ${known}`);
    const saju = answer === 'none' ? null : dailySaju(answer, new Date());
    return mitchyLuck(name, new Date().toDateString(), saju).then((text) => {
      storeLuck(answer, text);
      return text;
    });
  }
  function luck() {
    const answer = read(BIRTH_KEY);
    if (answer) return ask(LUCK_Q, () => readStars(answer));
    // first time: she needs the birthday for a real saju reading
    setLines((l) => [
      ...l,
      { who: 'me', text: LUCK_Q },
      { who: 'mitchy', text: 'ooh, for a proper saju reading i need ur birthday. when were u born?' },
    ]);
    setAskingBirth(true);
  }
  function giveBirth(answer: string) {
    setAskingBirth(false);
    write(BIRTH_KEY, answer);
    const said =
      answer === 'none'
        ? 'I’d rather not say.'
        : `I was born on ${new Date(`${answer}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`;
    ask(said, () =>
      answer === 'none'
        ? readStars(answer).then((t) => `no worries, the stars still have a hint for u. ${t}`)
        : readStars(answer),
    );
  }
  const birthOk = /^\d{4}-\d{2}-\d{2}$/.test(birth) && birth >= MIN_BIRTH && birth <= today();

  const options = [
    {
      label: 'Hey Mitchy, how are you doing?',
      go: () => ask('Hey Mitchy, how are you doing?', () => mitchySmallTalk(name)),
    },
    { label: LUCK_Q, go: luck },
    { label: 'See you later!', go: onClose },
  ];

  // arrows + Enter pick a reply (Esc closes, handled by the game)
  useEffect(() => {
    if (busy || askingBirth) return;
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
  }, [lines.length, busy, askingBirth]);

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
            {askingBirth && (
              <form
                className="talk-birth"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (birthOk) giveBirth(birth);
                }}
              >
                <label>
                  <span>My birthday</span>
                  <input
                    type="date"
                    value={birth}
                    min={MIN_BIRTH}
                    max={today()}
                    autoFocus
                    onChange={(e) => setBirth(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Escape') e.stopPropagation(); // typing stays out of the world
                    }}
                  />
                </label>
                <div className="talk-birth-actions">
                  <button type="submit" className="ds-option" disabled={!birthOk}>
                    Read my stars
                  </button>
                  <button type="button" className="ds-option" onClick={() => giveBirth('none')}>
                    I’d rather not say
                  </button>
                </div>
                <span className="ds-muted talk-birth-note">Only kept in this browser.</span>
              </form>
            )}
            {!busy && !askingBirth && (
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
