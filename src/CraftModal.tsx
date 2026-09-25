// Mitchy's Workshop — the crafting modal. A chat thread with Mitchy where the
// player describes an item and the LLM builds an ASCII sprite. Reuses the
// craft backend in llm.ts (streaming hooks, alternatives, mitchy chat); this
// file is purely the UI + state machine.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as S from './sprites';
import { craftItem, mitchyChat, getMitchyLine } from './llm';
import type { OwnedItem, ShopItem } from './llm';
import { appendHistory, groupByDay, loadHistory, timeOf, type CraftRecord } from './craftHistory';
import { ColoredSprite } from './ColoredSprite';

const MITCHY_FACE = S.CAT.slice(0, 2); // small face for avatar tiles

// input → working → failed → success → folded  (see the spec's state machine)
type Phase = 'input' | 'working' | 'failed' | 'success' | 'folded';

type Turn =
  | { who: 'mitchy' | 'me'; kind: 'text'; text: string }
  | { who: 'mitchy'; kind: 'result'; item: ShopItem; prompt: string; status?: string }
  | { who: 'mitchy'; kind: 'alts'; intro: string; options: string[] };

const STAGE_TEXT: Record<string, string> = {
  image: 'sketching a reference…',
  drawing: 'drawing…',
  retrying: 'hmm — adjusting…',
};

export default function CraftModal({
  token,
  playerFace,
  playerFaceColors,
  playerPalette,
  onConsume,
  onClose,
  confirmClose,
  onConfirmChange,
  onBusyChange,
  onDoneChange,
}: {
  token: OwnedItem;
  playerFace: string[];
  playerFaceColors: string[];
  playerPalette: Record<string, string>;
  onConsume: (equip: boolean, item: ShopItem) => void; // spend token, equip if asked — does NOT close
  onClose: () => void;
  confirmClose: boolean; // App raises this on Esc / global ✕ / outside-click
  onConfirmChange: (v: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onDoneChange: (done: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('input');
  const [thread, setThread] = useState<Turn[]>([
    {
      who: 'mitchy',
      kind: 'text',
      text: "welcome to the workshop! tell me what you want and what it should do — anything you like.",
    },
  ]);
  const [input, setInput] = useState('');
  // live streaming state during 'working'
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [partial, setPartial] = useState<string[]>([]);
  const partialLevel = useRef(-1);
  // success popup + its result
  const [popup, setPopup] = useState<{ item: ShopItem; prompt: string } | null>(null);
  // history drawer
  const [history, setHistory] = useState<CraftRecord[]>(() => loadHistory());
  const [drawer, setDrawer] = useState(false);
  const [detail, setDetail] = useState<CraftRecord | null>(null);

  const busy = phase === 'working';
  const done = phase === 'folded';
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => onDoneChange(done), [done, onDoneChange]);

  const threadRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, partial, phase]);

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
    onConsume(equip, item); // spend the token; App does NOT close the modal
    const status = equip ? '◆ Equipped to your hand.' : '◆ Tucked into your inventory.';
    setThread((l) => l.map((t) => (t.kind === 'result' && t.item === item ? { ...t, status } : t)));
    // persist to history
    const rec: CraftRecord = {
      id: `h-${Date.now()}`,
      name: item.name,
      prompt: popup.prompt,
      category: item.category, // inferred from the prompt now, not the token
      sprite: item.sprite,
      color: item.color,
      ...(item.palette && item.colors ? { palette: item.palette, colors: item.colors } : {}),
      textureModifier: item.textureModifier,
      fn: item.fn,
      punchline: item.funcDesc,
      at: Date.now(),
    };
    setHistory(appendHistory(rec));
    setPopup(null);
    setPhase('folded');
    getMitchyLine('a "all done, come back with another token" friendly').then((line) =>
      push({ who: 'mitchy', kind: 'text', text: line }),
    );
  }

  // ---- exit / drawer keyboard ----
  function requestExit() {
    if (done) onClose();
    else onConfirmChange(true);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawer || detail) {
        e.preventDefault();
        e.stopPropagation();
        setDetail(null);
        setDrawer(false);
      }
      // otherwise let App's Esc handler run (routes to the exit confirm)
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drawer, detail]);

  const composerState: 'idle' | 'working' | 'failed' | 'done' =
    phase === 'working' ? 'working' : phase === 'failed' ? 'failed' : phase === 'folded' ? 'done' : 'idle';

  return (
    <div className="cw" role="dialog" aria-label="Mitchy's Workshop" aria-modal="true">
      {/* Header */}
      <header className="cw-head">
        <div className="cw-title">Mitchy's Workshop</div>
        <div className="cw-token" title="craft token">
          <span className="cw-token-dot" />
          <span className="cw-token-name">craft token</span>
          <span className="cw-token-scope">· anything</span>
        </div>
        <button className="cw-x" onClick={requestExit} aria-label="close workshop">
          ✕
        </button>
      </header>

      {/* Stage: chat thread + the drawer clipped inside it */}
      <div className="cw-stage">
        <div className="cw-thread" ref={threadRef}>
          {thread.map((t, i) => (
            <ChatTurn
              key={i}
              t={t}
              playerFace={playerFace}
              playerFaceColors={playerFaceColors}
              playerPalette={playerPalette}
              onPickAlt={startCraft}
            />
          ))}

          {busy && (
            <div className="cw-turn mitchy">
              <div className="cw-avatar">
                <pre>{MITCHY_FACE.join('\n')}</pre>
              </div>
              <div className="cw-bubble">
                <div className="cw-label">MITCHY</div>
                <div className="cw-body">{busyLine ?? '…'}</div>
                <div className="cw-card streaming">
                  <div className="cw-sprite-box">
                    <pre>{partial.join('\n') || ' '}</pre>
                  </div>
                  <div className="cw-progress-text">
                    {stage === 'drawing' && partial.length
                      ? `drawing line ${partial.length}`
                      : STAGE_TEXT[stage ?? ''] ?? 'working'}
                    <span className="cw-ellipsis" />
                  </div>
                  <div className="cw-progress-bar">
                    <span />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* History drawer (position:absolute, clipped by the stage) */}
        <aside className={'cw-drawer' + (drawer ? ' open' : '')} aria-hidden={!drawer}>
          <button
            className="cw-bookmark"
            aria-expanded={drawer}
            aria-label={drawer ? 'Close crafting history' : 'Open crafting history'}
            onClick={() => {
              setDetail(null);
              setDrawer((d) => !d);
            }}
          >
            ◷
          </button>
          <div className="cw-drawer-inner">
            {!detail ? (
              <>
                <div className="cw-drawer-head">
                  <span>History</span>
                  <span className="cw-drawer-count">{history.length} crafts</span>
                </div>
                <div className="cw-drawer-list">
                  {history.length === 0 && <div className="cw-empty">nothing crafted yet.</div>}
                  {groupByDay(history).map((g) => (
                    <div key={g.label}>
                      <div className="cw-day">{g.label}</div>
                      {g.items.map((r) => (
                        <button key={r.id} className="cw-hrow" onClick={() => setDetail(r)}>
                          <ColoredSprite
                            className="cw-hthumb"
                            sprite={r.sprite}
                            colors={r.colors}
                            palette={r.palette}
                            color={r.color}
                            texture={r.textureModifier}
                          />
                          <div className="cw-hrow-text">
                            <div className="cw-hrow-name">{r.name}</div>
                            <div className="cw-hrow-prompt">“{r.prompt}”</div>
                            <div className="cw-hrow-meta">
                              {timeOf(r.at)} · {r.category}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="cw-drawer-head">
                  <button className="cw-back" onClick={() => setDetail(null)}>
                    ← All crafts
                  </button>
                  <span className="cw-drawer-count">{timeOf(detail.at)}</span>
                </div>
                <div className="cw-detail">
                  <div className="cw-sprite-box big">
                    <ColoredSprite
                      sprite={detail.sprite}
                      colors={detail.colors}
                      palette={detail.palette}
                      color={detail.color}
                      texture={detail.textureModifier}
                    />
                  </div>
                  <div className="cw-detail-name">{detail.name}</div>
                  <div className="cw-detail-punch">“{detail.punchline}”</div>
                  <div className="cw-detail-meta">
                    <div>
                      <span>You asked for</span> “{detail.prompt}”
                    </div>
                    <div>
                      <span>Token</span> {detail.category} · {timeOf(detail.at)}
                    </div>
                  </div>
                  <button
                    className="cw-again"
                    disabled={done || busy}
                    onClick={() => {
                      setDrawer(false);
                      setDetail(null);
                      setInput(detail.prompt);
                    }}
                  >
                    Craft this again
                  </button>
                  <div className="cw-footnote">Already crafted — this is a record, not the item.</div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Composer */}
      <div className="cw-composer">
        {composerState === 'done' ? (
          <div className="cw-done-row">
            <span className="cw-hint">◆ this token's been used up.</span>
            <button className="cw-close-btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="cw-input-row">
              <input
                className="cw-input"
                value={input}
                autoFocus
                disabled={composerState === 'working'}
                placeholder={
                  composerState === 'working'
                    ? 'Mitchy is working…'
                    : 'Describe it — and what it should do…'
                }
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    return; // let Ctrl+S bubble up to the global save shortcut
                  }
                  if (e.key === 'Enter') {
                    submit();
                  } else if (e.key === 'Escape') {
                    if (drawer || detail) {
                      setDetail(null);
                      setDrawer(false);
                    } else {
                      requestExit();
                    }
                  }
                  e.stopPropagation(); // don't leak movement keys to the world
                }}
              />
              {composerState !== 'working' && (
                <button className="cw-send" onClick={submit}>
                  {composerState === 'failed' ? 'Try again' : 'Craft it'}
                </button>
              )}
            </div>
            <div className="cw-hint">
              {composerState === 'working'
                ? 'Mitchy builds once per token.'
                : '◆ craft token — anything you can describe. Say what it does, too.'}
            </div>
          </>
        )}
      </div>

      {/* Success popup — separate overlay above the modal */}
      {popup && (
        <div className="cw-popup-scrim">
          <div className="cw-popup" role="dialog" aria-label="crafted item">
            <div className="cw-popup-bar">Crafting Station</div>
            <div className="cw-popup-prompt">“{popup.prompt}”</div>
            <div className="cw-sprite-box big">
              <ColoredSprite
                sprite={popup.item.sprite}
                colors={popup.item.colors}
                palette={popup.item.palette}
                color={popup.item.color}
                texture={popup.item.textureModifier}
              />
            </div>
            <div className="cw-popup-name">{popup.item.name}</div>
            <div className="cw-popup-punch">“{popup.item.funcDesc}”</div>
            <div className="cw-popup-btns">
              <button onClick={() => choose(true)}>Equip</button>
              <button onClick={() => choose(false)}>Inventory</button>
            </div>
          </div>
        </div>
      )}

      {/* Exit confirm — token is safe in inventory */}
      {confirmClose && (
        <div className="cw-popup-scrim">
          <div className="cw-confirm">
            <div className="cw-confirm-text">
              {busy
                ? 'Mitchy is still building. Leave anyway?'
                : 'Leave the workshop?'}
            </div>
            <div className="cw-confirm-sub">
              ◆ Your unused token stays safe in your inventory.
            </div>
            <div className="cw-confirm-btns">
              <button onClick={() => onConfirmChange(false)}>Keep crafting</button>
              <button onClick={onClose}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One chat turn.
function ChatTurn({
  t,
  playerFace,
  playerFaceColors,
  playerPalette,
  onPickAlt,
}: {
  t: Turn;
  playerFace: string[];
  playerFaceColors: string[];
  playerPalette: Record<string, string>;
  onPickAlt: (prompt: string) => void;
}) {
  const mine = t.who === 'me';
  const face = mine ? playerFace : MITCHY_FACE;
  return (
    <div className={'cw-turn ' + t.who}>
      <div className="cw-avatar">
        {mine ? (
          <ColoredSprite
            className="cw-face-player"
            sprite={face}
            colors={playerFaceColors}
            palette={playerPalette}
          />
        ) : (
          <pre>{face.join('\n')}</pre>
        )}
      </div>
      <div className="cw-bubble">
        <div className="cw-label">{mine ? 'YOU' : 'MITCHY'}</div>
        {t.kind === 'text' && <div className="cw-body">{t.text}</div>}

        {t.kind === 'result' && (
          <div className="cw-card">
            <div className="cw-sprite-box">
              <ColoredSprite
                sprite={t.item.sprite}
                colors={t.item.colors}
                palette={t.item.palette}
                color={t.item.color}
                texture={t.item.textureModifier}
              />
            </div>
            <div className="cw-card-name">{t.item.name}</div>
            <div className="cw-card-punch">“{t.item.funcDesc}”</div>
            {t.status && <div className="cw-card-status">{t.status}</div>}
          </div>
        )}

        {t.kind === 'alts' && (
          <>
            <div className="cw-body">{t.intro}</div>
            <div className="cw-alts">
              {t.options.map((o, i) => (
                <button key={i} className="cw-alt" onClick={() => onPickAlt(o)}>
                  <div className="cw-alt-name">{o}</div>
                  <div className="cw-alt-pick">craft this →</div>
                </button>
              ))}
            </div>
            <div className="cw-alts-note">
              ◆ Your token is untouched. Pick one, or write me something new.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
