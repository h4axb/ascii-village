// Mitchy's Workshop — the crafting panel. The player describes an item and
// the LLM builds an ASCII sprite. Reuses the craft backend in llm.ts
// (streaming hooks, alternatives, mitchy chat); this file is purely the UI +
// state machine.
//
// Layout (design system, see src/ui):
//   ← back                                                        ✕
//                                                                 ¤ money
//   ┌ the chat ────────────────────────────────────────────┐▐ bookmark
//   │ [Mitchy]  ┌ bubble ┐                                 │  (past chats)
//   │           └────────┘              ┌ bubble ┐ [You]   │
//   │                                   └────────┘         │
//   │ ┌ your prompt (80 signs) ─────────────┐ [ Craft it! ] │
//   └──────────────────────────────────────────────────────┘
//
// The bookmark opens the chat history as a column on the right; picking a
// past craft shows its chat in place of the current one. ← steps back
// (history → current chat); Esc, ✕ and ← on the current chat always ask
// before leaving, and [F] confirms like the world's interaction prompts.
//
// With `choices` (the /1 test link) a craft first runs a preflight: when the
// request can't be drawn as asked, Mitchy offers two concepts or her own
// hunch ("Surprise me") before drawing anything; the shown result is always
// exactly what the player gets. There, leaving never throws a finished
// design away: the last result goes into the inventory.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as S from './sprites';
import { craftItem, mitchyChat, getMitchyLine, preflightCraft } from './llm';
import type { CraftConcept, OwnedItem, ShopItem } from './llm';
import { appendHistory, ago, loadHistory, type CraftRecord, type ChatLine } from './craftHistory';
import { MITCHY_NAME } from './introPartB';
import {
  Bubble,
  ChatMessage,
  ChoicePanel,
  FitSprite,
  Frame,
  IconHammer,
  IconHistory,
  Sheet,
  type Speaker,
  type SpriteLook,
} from './ui';

export const PROMPT_MAX = 80;
// One paid rework of a finished design: the player says what to change and
// Mitchy crafts it again. Once per token; refunded if the rework fails.
export const ADJUST_PRICE = 12;

const MITCHY: Speaker = { name: MITCHY_NAME, look: S.MITCHY_FACE_LOOK, solid: {} };

// input → working → (choosing →) working → failed | success → folded
type Phase = 'input' | 'working' | 'choosing' | 'failed' | 'success' | 'folded';

type Result = { item: ShopItem; prompt: string };

type Turn =
  | { who: 'mitchy' | 'me'; kind: 'text'; text: string }
  | { who: 'mitchy'; kind: 'result'; item: ShopItem; prompt: string; status?: string }
  | { who: 'mitchy'; kind: 'alts'; intro: string; options: string[] }
  | { who: 'mitchy'; kind: 'concepts'; concepts: [CraftConcept, CraftConcept]; surprise: string };

const CONCEPT_LETTERS = ['A', 'B'] as const;

const STAGE_TEXT: Record<string, string> = {
  image: 'sketching a reference…',
  drawing: 'drawing…',
  retrying: 'hmm, adjusting…',
  thinking: 'thinking it over…',
};

const lookOf = (it: {
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string;
  textureModifier?: SpriteLook['texture'];
}): SpriteLook => ({
  sprite: it.sprite,
  colors: it.colors,
  palette: it.palette,
  color: it.color,
  texture: it.textureModifier,
});

// A crafted item inside a bubble: the picture in its own frame, name and
// its one-line function under it.
function ResultCard({ look, name, desc }: { look: SpriteLook; name: string; desc?: string }) {
  return (
    <div className="cw3-card">
      <Frame className="cw3-art">
        <FitSprite look={look} fill={0.82} maxScale={2.4} />
      </Frame>
      <div className="cw3-card-name">{name}</div>
      {desc && <div className="ds-muted">“{desc}”</div>}
    </div>
  );
}

export default function CraftModal({
  token,
  player,
  choices = false,
  money,
  onSpend,
  onConsume,
  onClose,
  confirmClose,
  onConfirmChange,
  onBusyChange,
  onDoneChange,
}: {
  token: OwnedItem;
  player: Speaker; // the player's name and face, for their side of the chat
  choices?: boolean; // the /1 flow: preflight + concepts, no auto retry, keep the last result on leave
  money: number;
  onSpend: (coins: number) => void; // negative = refund
  onConsume: (equip: boolean, item: ShopItem) => void; // spend token, equip if asked — does NOT close
  onClose: () => void;
  confirmClose: boolean; // App raises this on Esc / outside-click
  onConfirmChange: (v: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onDoneChange: (done: boolean) => void;
}) {
  void token;
  const [phase, setPhase] = useState<Phase>('input');
  const [thread, setThread] = useState<Turn[]>([
    {
      who: 'mitchy',
      kind: 'text',
      text: 'Welcome to the workshop! Tell me what you want and what it should do. Anything you like.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [partial, setPartial] = useState<string[]>([]);
  const partialLevel = useRef(-1);
  const [popup, setPopup] = useState<Result | null>(null);
  // (choices) the latest finished design not yet taken, kept while a rework
  // runs — what leaving saves; plus whether a paid rework is in flight
  const lastResult = useRef<Result | null>(null);
  const reworking = useRef(false);
  const closed = useRef(false); // left the workshop: late results are ignored
  const [history, setHistory] = useState<CraftRecord[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewRec, setViewRec] = useState<CraftRecord | null>(null); // a past craft's chat in place of the current one
  const [adjusting, setAdjusting] = useState(false); // typing what to change
  const [adjusted, setAdjusted] = useState(false); // the one rework is used
  const [optSel, setOptSel] = useState(0);
  const [leaveSel, setLeaveSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const busy = phase === 'working';
  const done = phase === 'folded';
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => onDoneChange(done), [done, onDoneChange]);

  const push = (t: Turn) => setThread((l) => [...l, t]);

  // ---- crafting ----
  // `rework`: the previous result being adjusted — `text` is then only the
  // change, and the craft runs on the old prompt plus that change.
  // `how.say`: the player's line when it isn't the prompt itself (a concept
  // pick); `how.direct`: skip the preflight (a picked concept or one of
  // Mitchy's alternatives); `how.surprise`: Mitchy's own hunch, revealed.
  function startCraft(
    text: string,
    rework?: Result,
    how: { say?: string; direct?: boolean; surprise?: boolean } = {},
  ) {
    const craftPrompt = rework ? `${rework.prompt}, but ${text}` : text;
    push({ who: 'me', kind: 'text', text: how.say ?? text });
    setPhase('working');
    setStage(null);
    setPartial([]);
    setBusyLine(null);
    partialLevel.current = -1;
    reworking.current = !!rework;
    getMitchyLine('a "hold on, building your thing right now" busy').then(setBusyLine);

    const draw = () =>
      craftItem(
        craftPrompt,
        {
          onStage: (s: string) => setStage(s),
          onLine: (line: string, _i: number, level: number) => {
            if (level !== partialLevel.current) {
              partialLevel.current = level;
              setPartial([line]);
            } else setPartial((p) => [...p, line]);
          },
        },
        { retry: !choices },
      ).then((r) => finish(r));

    if (choices && !rework && !how.direct) {
      setStage('thinking');
      preflightCraft(craftPrompt).then((pf) => {
        if (closed.current) return;
        if (!pf.needsChoice) return draw();
        setStage(null);
        setPhase('choosing');
        push({
          who: 'mitchy',
          kind: 'text',
          text: "Ooh, that's a lot of wonderful ideas for one little token. I see two ways to build it, or I can follow my own hunch:",
        });
        push({ who: 'mitchy', kind: 'concepts', concepts: pf.concepts, surprise: pf.surprise });
      });
    } else draw();

    function finish(r: Awaited<ReturnType<typeof craftItem>>) {
      if (closed.current) return; // left meanwhile; leave() already settled it
      reworking.current = false;
      setStage(null);
      setPartial([]);
      if (r.ok) {
        setPhase('success');
        if (rework) setAdjusted(true);
        if (how.surprise) push({ who: 'mitchy', kind: 'text', text: "Ta-da! Here's what I came up with." });
        push({ who: 'mitchy', kind: 'result', item: r.item, prompt: craftPrompt });
        setPopup({ item: r.item, prompt: craftPrompt });
        lastResult.current = { item: r.item, prompt: craftPrompt };
      } else if (rework) {
        // the rework failed: coins back, and the previous design is still
        // there to take (or to try adjusting again)
        onSpend(-ADJUST_PRICE);
        setPhase('success');
        push({ who: 'mitchy', kind: 'text', text: `${r.reply} (Your ${ADJUST_PRICE} coins are back in your pocket.)` });
        push({ who: 'mitchy', kind: 'result', item: rework.item, prompt: rework.prompt });
        setPopup(rework);
      } else {
        setPhase('failed');
        setInput(text.slice(0, PROMPT_MAX)); // pre-fill so they can edit instead of retype
        if (r.suggestions?.length) push({ who: 'mitchy', kind: 'alts', intro: r.reply, options: r.suggestions });
        else push({ who: 'mitchy', kind: 'text', text: r.reply });
      }
    }
  }

  // (an adjustment is sent from its own option, not from Craft it!)
  const canSend = !!input.trim() && !done && !popup;
  function submit() {
    const text = input.trim();
    if (!text || done) return; // token spent
    if (popup) {
      if (!adjusting || money < ADJUST_PRICE) return; // awaiting a choice
      const rework = popup;
      onSpend(ADJUST_PRICE);
      setAdjusting(false);
      setPopup(null);
      setInput('');
      setThread((l) =>
        l.map((t) => (t.kind === 'result' && t.item === rework.item && !t.status ? { ...t, status: 'Let me rework this one…' } : t)),
      );
      startCraft(text, rework);
      return;
    }
    setViewRec(null); // back to the current chat
    setHistoryOpen(false);
    if (busy) {
      // chat with Mitchy while she works — independent of the pipeline
      push({ who: 'me', kind: 'text', text });
      setInput('');
      mitchyChat(text).then((reply) => push({ who: 'mitchy', kind: 'text', text: reply }));
      return;
    }
    setInput('');
    startCraft(text);
  }

  // ---- success → folded (player chose equip / inventory) ----
  function choose(equip: boolean, res: Result | null = popup) {
    if (!res) return;
    const { item } = res;
    lastResult.current = null;
    onConsume(equip, item); // spend the token; App does NOT close the panel
    const status = equip ? 'Equipped to your hand.' : 'Tucked into your inventory.';
    const turns = thread.map((t) => (t.kind === 'result' && t.item === item ? { ...t, status } : t));
    setThread(turns);
    const rec: CraftRecord = {
      id: `h-${Date.now()}`,
      name: item.name,
      prompt: res.prompt,
      category: item.category,
      sprite: item.sprite,
      color: item.color,
      ...(item.palette && item.colors ? { palette: item.palette, colors: item.colors } : {}),
      textureModifier: item.textureModifier,
      fn: item.fn,
      punchline: item.funcDesc,
      at: Date.now(),
      chat: toChat(turns),
    };
    setHistory(appendHistory(rec));
    setPopup(null);
    setPhase('folded');
    getMitchyLine('a "all done, come back with another token" friendly').then((line) =>
      push({ who: 'mitchy', kind: 'text', text: line }),
    );
  }

  // ---- adjusting a finished design (paid, once) ----
  function startAdjust() {
    if (!popup || adjusted || money < ADJUST_PRICE) return;
    setAdjusting(true);
    push({ who: 'mitchy', kind: 'text', text: 'Sure! What should I change? Tell me in a few words.' });
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  function cancelAdjust() {
    setAdjusting(false);
    setInput('');
  }

  // ---- leaving ----
  // (choices) a finished design is never thrown away: the last one goes into
  // the inventory (token spent), and a rework still running is dropped with
  // its coins refunded. Otherwise the unused token simply stays.
  function leave() {
    if (closed.current) return;
    closed.current = true;
    if (choices && !done) {
      if (reworking.current) onSpend(-ADJUST_PRICE);
      if (lastResult.current) choose(false, lastResult.current);
    }
    onClose();
  }

  // ---- navigation ----
  function back() {
    if (historyOpen) setHistoryOpen(false);
    else if (viewRec) setViewRec(null);
    else if (adjusting) cancelAdjust();
    else onConfirmChange(true);
  }

  // Leaving always asks; [F] confirms (like the world's interaction
  // prompts), Esc on the prompt stays. Capture phase, so it wins over the
  // prompt field (which stops key events from reaching the world).
  useEffect(() => {
    if (!confirmClose) return;
    setLeaveSel(0);
    inputRef.current?.blur();
  }, [confirmClose]);
  useEffect(() => {
    if (!confirmClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        leave();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ---- the reply options (the player's side) ----
  const lastMitchy = [...thread].reverse().find((t) => t.who === 'mitchy');
  const lastAlts = !busy && phase === 'failed' && lastMitchy?.kind === 'alts' ? lastMitchy.options : null;
  const lastConcepts = phase === 'choosing' && lastMitchy?.kind === 'concepts' ? lastMitchy : null;
  type Opt = { label: string; go: () => void; disabled?: boolean; title?: string };
  const options: Opt[] = viewRec
    ? []
    : popup && adjusting
      ? [
          {
            label: `Adjust it (${ADJUST_PRICE} coins)`,
            go: submit,
            disabled: !input.trim(),
            title: input.trim() ? undefined : 'Type what should change first.',
          },
          { label: 'Never mind, keep this one.', go: cancelAdjust },
        ]
      : popup
      ? [
          { label: 'Equip it.', go: () => choose(true) },
          { label: 'Into my inventory.', go: () => choose(false) },
          ...(adjusted
            ? []
            : [
                {
                  label: `Adjust the design (${ADJUST_PRICE} coins)`,
                  go: startAdjust,
                  disabled: money < ADJUST_PRICE,
                  title:
                    money < ADJUST_PRICE
                      ? `You need ${ADJUST_PRICE} coins to adjust it.`
                      : 'Tell Mitchy what to change; she crafts it once more.',
                },
              ]),
        ]
      : lastConcepts
        ? [
            ...lastConcepts.concepts.map((c, i) => {
              const say = `${CONCEPT_LETTERS[i]}: ${c.name}`;
              return { label: say, go: () => startCraft(c.prompt, undefined, { say, direct: true }) };
            }),
            {
              label: 'Surprise me!',
              go: () => startCraft(lastConcepts.surprise, undefined, { say: 'Surprise me!', direct: true, surprise: true }),
            },
          ]
        : lastAlts
          ? lastAlts.map((o) => ({ label: o, go: () => startCraft(o, undefined, { direct: true }) }))
          : done
            ? [{ label: 'Leave the workshop.', go: leave }]
            : [];
  useEffect(() => setOptSel(0), [options.length, popup, lastAlts, lastConcepts, adjusting]);

  // arrows + Enter pick an option while the prompt field is empty
  useEffect(() => {
    if (!options.length || confirmClose || historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (input.trim()) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const n = options.length;
        setOptSel((s) => (s + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const o = options[Math.min(optSel, options.length - 1)];
        if (!o.disabled) o.go();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ---- the chat: consecutive turns of one speaker share a face ----
  type Group = { who: 'mitchy' | 'me'; bubbles: ReactNode[] };
  const groups: Group[] = [];
  const add = (who: 'mitchy' | 'me', ...bubbles: ReactNode[]) => {
    const last = groups[groups.length - 1];
    if (last && last.who === who) last.bubbles.push(...bubbles);
    else groups.push({ who, bubbles });
  };
  if (viewRec) {
    const lines = viewRec.chat ?? [{ who: 'me' as const, text: viewRec.prompt }];
    lines.forEach((c, i) => add(c.who, <Bubble key={`l${i}`}>{c.text}</Bubble>));
    add(
      'mitchy',
      <Bubble key="res">
        <ResultCard look={lookOf(viewRec)} name={viewRec.name} desc={viewRec.punchline} />
      </Bubble>,
    );
  } else {
    thread.forEach((t, i) => {
      if (t.kind === 'text') add(t.who, <Bubble key={i}>{t.text}</Bubble>);
      else if (t.kind === 'alts') add('mitchy', <Bubble key={i}>{t.intro}</Bubble>);
      else if (t.kind === 'concepts')
        add(
          'mitchy',
          <Bubble key={i} className="cw3-concepts-bubble">
            <div className="cw3-concepts">
              {t.concepts.map((c, j) => (
                <Frame key={j} className="cw3-concept">
                  <span className="cw3-concept-letter">{CONCEPT_LETTERS[j]}</span>
                  <span className="cw3-concept-name">{c.name}</span>
                  <span className="ds-muted">{c.summary}</span>
                </Frame>
              ))}
              <Frame className="cw3-concept surprise">
                <span className="cw3-concept-letter">?</span>
                <span className="cw3-concept-name">Surprise me</span>
                <span className="ds-muted">Mitchy's own interpretation</span>
              </Frame>
            </div>
          </Bubble>,
        );
      else
        add(
          'mitchy',
          <Bubble key={i}>
            <ResultCard look={lookOf(t.item)} name={t.item.name} desc={t.item.funcDesc} />
          </Bubble>,
          <Bubble key={`${i}q`}>
            {t.status ?? `Here you go: ${t.item.name}! Want to hold it, or keep it in your inventory?`}
          </Bubble>,
        );
    });
    if (busy)
      add(
        'mitchy',
        <Bubble key="busy">
          {busyLine ?? '…'}
        </Bubble>,
        <Bubble key="drawing">
          <div className="cw3-card">
            <Frame className="cw3-art">
              <pre className="cw3-drawing">{partial.join('\n') || ' '}</pre>
            </Frame>
            <div className="ds-muted">
              {stage === 'drawing' && partial.length
                ? `drawing line ${partial.length}`
                : (STAGE_TEXT[stage ?? ''] ?? 'working')}
              <span className="cw-ellipsis" />
            </div>
            <div className="cw-progress-bar">
              <span />
            </div>
          </div>
        </Bubble>,
      );
  }

  // keep the newest message in view
  const chatSize = groups.reduce((n, g) => n + g.bubbles.length, 0) + partial.length + options.length;
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatSize, viewRec, busyLine, adjusting]);

  // what leaving now keeps (see leave())
  function leaveText(): string | undefined {
    if (done) return undefined;
    const last = choices ? lastResult.current : null;
    if (last && reworking.current)
      return `Mitchy is still reworking it. Your last finished design, ${last.item.name}, goes into your inventory, and your ${ADJUST_PRICE} coins come back.`;
    if (last) return `Your last design, ${last.item.name}, goes into your inventory.`;
    if (busy) return 'Mitchy is still building. Your unused token stays safe in your inventory.';
    return 'Your unused token stays safe in your inventory.';
  }

  const placeholder = busy
    ? 'Chat with Mitchy while she works …'
    : adjusting
      ? 'What should change? e.g. make the sail red …'
      : popup
      ? 'Pick an option above'
      : done
        ? 'Come back with another token'
        : "Describe what you'd like to craft …";

  return (
    <Sheet label="Mitchy's Workshop" onBack={back} onClose={() => onConfirmChange(true)} money={money} fill>
      <Frame className="cw3">
        <button
          className={'cw3-bookmark' + (historyOpen ? ' open' : '')}
          onClick={() => setHistoryOpen((o) => !o)}
          aria-label={historyOpen ? 'hide chat history' : 'show chat history'}
          aria-expanded={historyOpen}
          title="Chat history"
        >
          <IconHistory size={20} />
        </button>

        <div className="cw3-body">
          <div className="cw3-chat" ref={chatRef}>
            {viewRec && (
              <div className="cw3-past">
                <span>Past chat · {ago(viewRec.at)}</span>
                <button className="ds-link" onClick={() => setViewRec(null)}>
                  back to the current chat
                </button>
              </div>
            )}
            {groups.map((g, i) => (
              <ChatMessage key={i} who={g.who === 'me' ? player : MITCHY} side={g.who === 'me' ? 'right' : 'left'}>
                {g.bubbles}
              </ChatMessage>
            ))}
            {options.length > 0 && (
              <div className="ds-options cw3-replies" role="listbox">
                {options.map((o, i) => (
                  <button
                    key={o.label}
                    role="option"
                    aria-selected={i === optSel}
                    className={'ds-option' + (i === optSel ? ' sel' : '')}
                    onMouseEnter={() => setOptSel(i)}
                    onClick={o.go}
                    disabled={o.disabled}
                    title={o.title}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {historyOpen && (
            <aside className="cw3-history" aria-label="Chat history">
              <div className="cw3-history-head">Chat history</div>
              <div className="cw3-history-list">
                {history.length === 0 && <div className="ds-muted cw3-history-empty">Nothing crafted yet.</div>}
                {history.map((r) => (
                  <button
                    key={r.id}
                    className={'cw3-hrow' + (viewRec?.id === r.id ? ' sel' : '')}
                    onClick={() => {
                      setViewRec(r);
                      setHistoryOpen(false);
                    }}
                  >
                    <span className="cw3-hthumb">
                      <FitSprite look={lookOf(r)} fill={0.8} maxScale={1.6} />
                    </span>
                    <span className="cw3-hrow-text">
                      <span className="cw3-hrow-prompt">{r.prompt}</span>
                      <span className="ds-muted">{ago(r.at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          )}
        </div>

        <div className="cw3-bottom">
          <Frame className="cw3-prompt">
            <input
              ref={inputRef}
              className="cw3-input"
              value={input}
              autoFocus
              maxLength={PROMPT_MAX}
              disabled={(!!popup && !adjusting) || done}
              placeholder={placeholder}
              aria-label="Describe what you'd like to craft"
              onChange={(e) => setInput(e.target.value.slice(0, PROMPT_MAX))}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') return; // global save
                if (e.key === 'Enter' && input.trim()) submit();
                if (e.key !== 'Escape') e.stopPropagation(); // movement keys stay out of the world
              }}
            />
            <span className={'cw3-count' + (input.length >= PROMPT_MAX ? ' full' : '')}>
              {input.length}/{PROMPT_MAX}
            </span>
          </Frame>
          <button className="cw3-craft" onClick={submit} disabled={!canSend}>
            <IconHammer />
            <span>{busy ? 'Send' : 'Craft it!'}</span>
          </button>
        </div>
      </Frame>

      {/* Leaving always asks. [F] leave · [Esc] stay */}
      {confirmClose && (
        <div className="cw3-scrim">
          <ChoicePanel
            title="Leave the workshop?"
            question={leaveText()}
            options={['Leave', 'Stay']}
            sel={leaveSel}
            onSel={setLeaveSel}
            onPick={(i) => (i === 0 ? leave() : onConfirmChange(false))}
            hint="[F] leave · [Esc] stay"
          />
        </div>
      )}
    </Sheet>
  );
}

// The session's turns as plain lines for the history (the result itself is
// stored on the record, so it isn't repeated here).
function toChat(turns: Turn[]): ChatLine[] {
  const out: ChatLine[] = [];
  for (const t of turns) {
    if (t.kind === 'text') out.push({ who: t.who, text: t.text });
    else if (t.kind === 'alts') out.push({ who: 'mitchy', text: `${t.intro} (${t.options.join(' / ')})` });
    else if (t.kind === 'concepts')
      out.push({
        who: 'mitchy',
        text: `Ideas: ${t.concepts.map((c, i) => `${CONCEPT_LETTERS[i]} ${c.name}`).join(' / ')} / Surprise me`,
      });
  }
  return out;
}
