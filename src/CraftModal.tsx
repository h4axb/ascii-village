// Mitchy's Workshop — the crafting panel. The player describes an item and
// the LLM builds an ASCII sprite. Reuses the craft backend in llm.ts
// (streaming hooks, alternatives, mitchy chat); this file is purely the UI +
// state machine.
//
// Layout (a translucent, blurred sheet over the world):
//   ← back                                              ✕
//                                                       ¤ money
//   [ 20 fixed item slots — the inventory ]   [ info on the selection /
//                                               the live drawing / result ]
//   Mitchy's latest line                       [ options, when there are any ]
//   [ your prompt ]
//   show chat history
//
// "show chat history" opens a window over the slots + info area listing past
// crafts; picking one swaps the slots for that craft's chat. ← steps back
// (history → main, chat → items); Esc, ✕ and ← on the main view always ask
// before leaving, and [F] confirms like the world's interaction prompts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as S from './sprites';
import { craftItem, mitchyChat, getMitchyLine } from './llm';
import type { OwnedItem, ShopItem } from './llm';
import type { TextureModifier } from './craft';
import { appendHistory, groupByDay, loadHistory, timeOf, type CraftRecord, type ChatLine } from './craftHistory';
import { ColoredSprite } from './ColoredSprite';

const MITCHY_FACE = S.CAT.slice(0, 2);
export const CRAFT_SLOTS = 20;

// One inventory entry as the panel shows it (App builds these from inv/bag).
export interface CraftSlot {
  key: string;
  name: string;
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string;
  texture?: TextureModifier;
  count?: number; // stackable materials
  price?: number;
  priceLabel?: string; // 'Base price' for negotiated materials
  desc: string;
  note?: string; // an owned item's function line
  tag?: string; // TOKEN / EQ
}

// input → working → failed → success → folded
type Phase = 'input' | 'working' | 'failed' | 'success' | 'folded';

type Turn =
  | { who: 'mitchy' | 'me'; kind: 'text'; text: string }
  | { who: 'mitchy'; kind: 'result'; item: ShopItem; prompt: string; status?: string }
  | { who: 'mitchy'; kind: 'alts'; intro: string; options: string[] };

const STAGE_TEXT: Record<string, string> = {
  image: 'sketching a reference…',
  drawing: 'drawing…',
  retrying: 'hmm, adjusting…',
};

// A sprite drawn at its natural size, then shrunk (never enlarged) to fit its
// box, so every slot keeps the same size whatever the item's dimensions.
function FitSprite(p: {
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string;
  texture?: TextureModifier;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const b = box.current;
    const inner = b?.firstElementChild as HTMLElement | null;
    if (!b || !inner) return;
    const fit = () => {
      const w = inner.offsetWidth;
      const h = inner.offsetHeight;
      if (!w || !h) return;
      setK(Math.min(1, (b.clientWidth - 8) / w, (b.clientHeight - 8) / h));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [p.sprite]);
  return (
    <div className={'cw2-fit ' + (p.className ?? '')} ref={box}>
      <ColoredSprite
        sprite={p.sprite}
        colors={p.colors}
        palette={p.palette}
        color={p.color}
        texture={p.texture}
        style={{ transform: `translate(-50%, -50%) scale(${k})` }}
      />
    </div>
  );
}

// thin-line icons, same stroke as everything else on the sheet
const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
    <path d="M20 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export default function CraftModal({
  token,
  slots,
  money,
  onConsume,
  onClose,
  confirmClose,
  onConfirmChange,
  onBusyChange,
  onDoneChange,
}: {
  token: OwnedItem;
  slots: CraftSlot[];
  money: number;
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
  const [popup, setPopup] = useState<{ item: ShopItem; prompt: string } | null>(null);
  const [history, setHistory] = useState<CraftRecord[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewRec, setViewRec] = useState<CraftRecord | null>(null); // a past craft's chat in place of the slots
  const [sel, setSel] = useState<string | null>(slots[0]?.key ?? null);
  const [optSel, setOptSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase === 'working';
  const done = phase === 'folded';
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => onDoneChange(done), [done, onDoneChange]);

  const push = (t: Turn) => setThread((l) => [...l, t]);

  // ---- crafting ----
  function startCraft(text: string) {
    push({ who: 'me', kind: 'text', text });
    setPhase('working');
    setStage(null);
    setPartial([]);
    setBusyLine(null);
    partialLevel.current = -1;
    getMitchyLine('a "hold on, building your thing right now" busy').then(setBusyLine);

    craftItem(text, {
      onStage: (s: string) => setStage(s),
      onLine: (line: string, _i: number, level: number) => {
        if (level !== partialLevel.current) {
          partialLevel.current = level;
          setPartial([line]);
        } else setPartial((p) => [...p, line]);
      },
    }).then((r) => {
      setStage(null);
      setPartial([]);
      if (r.ok) {
        setPhase('success');
        push({ who: 'mitchy', kind: 'result', item: r.item, prompt: text });
        setPopup({ item: r.item, prompt: text });
      } else {
        setPhase('failed');
        setInput(text); // pre-fill so they can edit instead of retype
        if (r.suggestions?.length) push({ who: 'mitchy', kind: 'alts', intro: r.reply, options: r.suggestions });
        else push({ who: 'mitchy', kind: 'text', text: r.reply });
      }
    });
  }

  function submit() {
    const text = input.trim();
    if (!text) return;
    if (busy) {
      // chat with Mitchy while she works — independent of the pipeline
      push({ who: 'me', kind: 'text', text });
      setInput('');
      mitchyChat(text).then((reply) => push({ who: 'mitchy', kind: 'text', text: reply }));
      return;
    }
    if (phase === 'folded' || popup) return; // token spent / awaiting choice
    setInput('');
    startCraft(text);
  }

  // ---- success → folded (player chose equip / inventory) ----
  function choose(equip: boolean) {
    if (!popup) return;
    const { item } = popup;
    onConsume(equip, item); // spend the token; App does NOT close the panel
    const status = equip ? 'Equipped to your hand.' : 'Tucked into your inventory.';
    const turns = thread.map((t) => (t.kind === 'result' && t.item === item ? { ...t, status } : t));
    setThread(turns);
    const rec: CraftRecord = {
      id: `h-${Date.now()}`,
      name: item.name,
      prompt: popup.prompt,
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

  // ---- navigation ----
  function back() {
    if (historyOpen) setHistoryOpen(false);
    else if (viewRec) setViewRec(null);
    else onConfirmChange(true);
  }

  // Leaving always asks; [F] confirms (like the world's interaction
  // prompts), Esc on the prompt stays. Capture phase, so it wins over the
  // prompt field (which stops key events from reaching the world).
  useEffect(() => {
    if (!confirmClose) return;
    inputRef.current?.blur();
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmClose, onClose]);

  // ---- what the dialogue line, the info panel and the options show ----
  const lastMitchy = [...thread].reverse().find((t) => t.who === 'mitchy');
  const line = busy
    ? (busyLine ?? '…')
    : lastMitchy?.kind === 'text'
      ? lastMitchy.text
      : lastMitchy?.kind === 'alts'
        ? lastMitchy.intro
        : lastMitchy?.kind === 'result'
          ? `Here you go: ${lastMitchy.item.name}! Want to hold it, or keep it in your inventory?`
          : '';
  const lastAlts = !busy && phase === 'failed' && lastMitchy?.kind === 'alts' ? lastMitchy.options : null;
  type Opt = { label: string; go: () => void };
  const options: Opt[] = popup
    ? [
        { label: 'Equip it.', go: () => choose(true) },
        { label: 'Into my inventory.', go: () => choose(false) },
      ]
    : lastAlts
      ? lastAlts.map((o) => ({ label: o, go: () => startCraft(o) }))
      : done
        ? [{ label: 'Leave the workshop.', go: onClose }]
        : [];
  useEffect(() => setOptSel(0), [options.length, popup, lastAlts]);

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
        options[Math.min(optSel, options.length - 1)].go();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const selected = slots.find((s) => s.key === sel) ?? null;
  const grid: (CraftSlot | null)[] = Array.from({ length: CRAFT_SLOTS }, (_, i) => slots[i] ?? null);

  return (
    <div className="cw2" role="dialog" aria-label="Mitchy's Workshop" aria-modal="true">
      <button className="cw2-back" onClick={back} aria-label="back">
        <BackIcon />
      </button>
      <div className="cw2-corner">
        <button className="cw2-x" onClick={() => onConfirmChange(true)} aria-label="close workshop">
          <CloseIcon />
        </button>
        <div className="cw2-money" title="your coins">
          <span className="cw2-coin">¤</span>
          {money.toLocaleString()}
        </div>
      </div>

      <div className="cw2-main">
        {/* LEFT: 20 slots, or a past craft's chat */}
        {viewRec ? (
          <div className="cw2-chatview">
            <div className="cw2-chatview-head">
              <span>{viewRec.name}</span>
              <span className="cw2-muted">{timeOf(viewRec.at)}</span>
            </div>
            <div className="cw2-chatview-list">
              {(viewRec.chat ?? [{ who: 'me' as const, text: viewRec.prompt }]).map((c, i) => (
                <div key={i} className={'cw2-msg ' + c.who}>
                  <div className="cw2-msg-who">{c.who === 'me' ? 'You' : 'Mitchy'}</div>
                  <div className="cw2-msg-text">{c.text}</div>
                </div>
              ))}
              <div className="cw2-msg mitchy">
                <div className="cw2-msg-who">Result</div>
                <div className="cw2-result">
                  <FitSprite
                    className="cw2-result-sprite"
                    sprite={viewRec.sprite}
                    colors={viewRec.colors}
                    palette={viewRec.palette}
                    color={viewRec.color}
                    texture={viewRec.textureModifier}
                  />
                  <div>
                    <div className="cw2-result-name">{viewRec.name}</div>
                    <div className="cw2-muted">“{viewRec.punchline}”</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="cw2-grid">
            {grid.map((s, i) => (
              <button
                key={s?.key ?? `empty-${i}`}
                className={'cw2-slot' + (s ? ' filled' : '') + (s && s.key === sel ? ' sel' : '')}
                onClick={s ? () => setSel(s.key) : undefined}
                disabled={!s}
                aria-label={s?.name ?? 'empty slot'}
              >
                {s && (
                  <>
                    <FitSprite sprite={s.sprite} colors={s.colors} palette={s.palette} color={s.color} texture={s.texture} />
                    {s.count !== undefined && <span className="cw2-count">x{s.count}</span>}
                    {s.tag && <span className="cw2-tag">{s.tag}</span>}
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        {/* RIGHT: info — the live drawing, the fresh result, or the selection */}
        <div className="cw2-info">
          {busy ? (
            <>
              <div className="cw2-info-art">
                <pre className="cw2-drawing">{partial.join('\n') || ' '}</pre>
              </div>
              <div className="cw2-info-name">Crafting…</div>
              <div className="cw2-info-desc">
                {stage === 'drawing' && partial.length
                  ? `drawing line ${partial.length}`
                  : (STAGE_TEXT[stage ?? ''] ?? 'working')}
                <span className="cw-ellipsis" />
              </div>
              <div className="cw-progress-bar">
                <span />
              </div>
            </>
          ) : popup ? (
            <>
              <FitSprite
                className="cw2-info-art"
                sprite={popup.item.sprite}
                colors={popup.item.colors}
                palette={popup.item.palette}
                color={popup.item.color}
                texture={popup.item.textureModifier}
              />
              <div className="cw2-info-name">{popup.item.name}</div>
              <div className="cw2-info-rule" />
              <div className="cw2-info-desc">“{popup.item.funcDesc}”</div>
              <div className="cw2-muted">You asked for “{popup.prompt}”</div>
            </>
          ) : selected ? (
            <>
              <div className="cw2-info-top">
                <FitSprite
                  className="cw2-info-art"
                  sprite={selected.sprite}
                  colors={selected.colors}
                  palette={selected.palette}
                  color={selected.color}
                  texture={selected.texture}
                />
                <div className="cw2-info-stats">
                  {selected.price !== undefined && (
                    <div className="cw2-stat">
                      <span>¤ {selected.price}</span>
                      <span className="cw2-muted">{selected.priceLabel ?? 'Price'}</span>
                    </div>
                  )}
                  <div className="cw2-stat">
                    <span>x{selected.count ?? 1}</span>
                    <span className="cw2-muted">In Inventory</span>
                  </div>
                </div>
              </div>
              <div className="cw2-info-name">{selected.name}</div>
              <div className="cw2-info-rule" />
              <div className="cw2-info-desc">{selected.desc}</div>
              {selected.note && <div className="cw2-muted">{selected.note}</div>}
            </>
          ) : (
            <div className="cw2-muted cw2-center">Your inventory is empty.</div>
          )}
        </div>

        {/* History window — the size of the slots + info area */}
        {historyOpen && (
          <div className="cw2-history">
            <div className="cw2-history-head">
              <span>Chat history</span>
              <span className="cw2-muted">{history.length} crafts</span>
            </div>
            <div className="cw2-history-list">
              {history.length === 0 && <div className="cw2-muted">Nothing crafted yet.</div>}
              {groupByDay(history).map((g) => (
                <div key={g.label}>
                  <div className="cw2-day">{g.label}</div>
                  {g.items.map((r) => (
                    <button
                      key={r.id}
                      className="cw2-hrow"
                      onClick={() => {
                        setViewRec(r);
                        setHistoryOpen(false);
                      }}
                    >
                      <FitSprite
                        className="cw2-hthumb"
                        sprite={r.sprite}
                        colors={r.colors}
                        palette={r.palette}
                        color={r.color}
                        texture={r.textureModifier}
                      />
                      <span className="cw2-hrow-text">
                        <span className="cw2-hrow-name">{r.name}</span>
                        <span className="cw2-muted">“{r.prompt}”</span>
                      </span>
                      <span className="cw2-muted">{timeOf(r.at)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM: Mitchy's line + your prompt; options to the right */}
      <div className="cw2-bottom">
        <div className="cw2-talk">
          <div className="cw2-dialog">
            <div className="cw2-speaker">
              <pre className="cw2-face">{MITCHY_FACE.join('\n')}</pre>
              Mitchy
            </div>
            <div className="cw2-line">{line}</div>
          </div>
          {!done && (
            <div className="cw2-prompt">
              <input
                ref={inputRef}
                className="cw2-input"
                value={input}
                autoFocus
                maxLength={100}
                disabled={!!popup}
                placeholder={
                  busy ? 'Chat with Mitchy while she works…' : popup ? 'Pick an option' : 'Describe it, and what it should do…'
                }
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') return; // global save
                  if (e.key === 'Enter' && input.trim()) submit();
                  if (e.key !== 'Escape') e.stopPropagation(); // movement keys stay out of the world
                }}
              />
              <button className="cw2-send" onClick={submit} disabled={!input.trim()} aria-label="send">
                ↵
              </button>
            </div>
          )}
          <button className="cw2-history-link" onClick={() => setHistoryOpen((o) => !o)}>
            {historyOpen ? 'hide chat history' : 'show chat history'}
          </button>
        </div>

        <div className="cw2-options">
          {options.map((o, i) => (
            <button
              key={o.label}
              className={'cw2-opt' + (i === optSel ? ' sel' : '')}
              onMouseEnter={() => setOptSel(i)}
              onClick={o.go}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Leaving always asks. [F] leave · [Esc] stay */}
      {confirmClose && (
        <div className="cw2-scrim">
          <div className="cw2-confirm">
            <div className="cw2-confirm-text">
              {busy ? 'Mitchy is still building. Leave anyway?' : 'Leave the workshop?'}
            </div>
            {!done && <div className="cw2-muted">Your unused token stays safe in your inventory.</div>}
            <div className="cw2-confirm-btns">
              <button className="cw2-opt" onClick={onClose}>
                [F] Leave
              </button>
              <button className="cw2-opt" onClick={() => onConfirmChange(false)}>
                [Esc] Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The session's turns as plain lines for the history (the result itself is
// stored on the record, so it isn't repeated here).
function toChat(turns: Turn[]): ChatLine[] {
  const out: ChatLine[] = [];
  for (const t of turns) {
    if (t.kind === 'text') out.push({ who: t.who, text: t.text });
    else if (t.kind === 'alts') out.push({ who: 'mitchy', text: `${t.intro} (${t.options.join(' / ')})` });
  }
  return out;
}
