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
// With `choices` (the /3 test link) a craft first runs a preflight: when the
// request can't be drawn as asked, Mitchy offers two concepts or her own
// hunch ("Surprise me") before drawing anything; the shown result is always
// exactly what the player gets. There, leaving never throws a finished
// design away: the last result goes into the inventory.
//
// With `clarify` (the /1 test link) a new idea first gets Mitchy's 1-2
// questions (one message each, "You decide" always offered), then her plan
// with every answer changeable; Craft it! commits, Esc skips. Each result is
// rated in a fixed-size panel (CraftClarify.tsx); failures offer no
// alternatives. Leaving keeps the last finished design, as above.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as S from './sprites';
import { craftItem, mitchyChat, getMitchyLine, preflightCraft, clarifyPrompt, AiServiceError, aiDownOf } from './llm';
import type { AiDown, ClarifyQuestion, CraftClarify, CraftConcept, OwnedItem, ShopItem } from './llm';
import { AiDownPopup, AI_RETRY_MS, noteAiDown, clearAiDown } from './AiDownPopup';
import { clarifyGuidance } from './craft';
import { ClarifyPlan, RatingPanel, YOU_DECIDE, type RateStep } from './CraftClarify';
import { FeedbackVote, TuneQuestions } from './CraftFeedback';
import { appliedLabels, isKind, KIND_LABEL, savePrefs, type Kind, type Prefs, type Scope } from './craft/prefs';
import {
  cleanTag,
  FEEDBACK_REASONS,
  POSITIVE_REASONS,
  type ClarifyLog,
  type FeedbackReason,
  type PositiveReason,
} from './feedback/schema';
import { loadSharedTags, newFeedbackId, playerId, sendFeedback, SESSION, type SharedTags } from './feedback/client';
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

// input → working → (choosing | clarifying →) working → failed | success → folded
// offline: the AI couldn't be reached; a popup explains and retries
type Phase = 'input' | 'working' | 'choosing' | 'clarifying' | 'offline' | 'failed' | 'success' | 'folded';

type Result = { item: ShopItem; prompt: string };

// (feedback) the rating of the result on the table — see CraftFeedback.tsx
interface Fb {
  id: string;
  at: number;
  result: Result;
  kind: Kind | null;
  applied: Prefs;
  adjusted: boolean;
  vote: 'up' | 'down' | null;
  reasons: FeedbackReason[];
  commentOpen: boolean;
  comment: string;
  step: 'vote' | 'tuning' | 'tuned';
  answers: Prefs | null;
  scope: Scope | null;
  // (clarify, the /1 link) the rating panel: vote → tags → thank-you
  rstep: RateStep;
  picked: string[]; // standard and other players' tags
  ownOpen: boolean;
  own: string; // the player's own tag
  clarify: ClarifyLog | null; // the pre-clarification behind this result
}

// (clarify) Mitchy's questions before a craft: picks[i] is the chosen option,
// null = "You decide", undefined = not answered yet; `step` = the question
// being asked (questions.length once the plan panel shows); `run` crafts.
interface Clar {
  prompt: string;
  questions: ClarifyQuestion[];
  picks: (number | null | undefined)[];
  step: number;
  t0: number;
  locked: boolean; // crafting started: the answers are final
  run: (c: CraftClarify, log: ClarifyLog) => void;
}

type Turn =
  | { who: 'mitchy' | 'me'; kind: 'text'; text: string }
  | { who: 'mitchy'; kind: 'result'; item: ShopItem; prompt: string; status?: string; tag?: string; made?: string[] }
  | { who: 'mitchy'; kind: 'alts'; intro: string; options: string[] }
  | { who: 'mitchy'; kind: 'concepts'; concepts: [CraftConcept, CraftConcept]; surprise: string }
  | { who: 'mitchy'; kind: 'plan' }; // (clarify) the plan panel, live from `clar`

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
// (feedback) `tag`: its kind, `made`: the preferences it was crafted with.
function ResultCard({
  look,
  name,
  desc,
  tag,
  made,
}: {
  look: SpriteLook;
  name: string;
  desc?: string;
  tag?: string;
  made?: string[];
}) {
  return (
    <div className="cw3-card">
      <Frame className="cw3-art">
        <FitSprite look={look} fill={0.82} maxScale={2.4} />
      </Frame>
      <div className="cw3-card-name">
        {name}
        {tag && <span className="fb-kind-tag">{tag}</span>}
      </div>
      {desc && <div className="ds-muted">“{desc}”</div>}
      {made && made.length > 0 && <div className="fb-made">made with: {made.join(' · ')}</div>}
    </div>
  );
}

export default function CraftModal({
  token,
  player,
  choices = false,
  feedback = false,
  clarify = false,
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
  choices?: boolean; // the /3 flow: preflight + concepts, no auto retry, keep the last result on leave
  feedback?: boolean; // the /2 flow: rate each result, tune future crafts (CraftFeedback.tsx), keep the last result on leave
  clarify?: boolean; // the /1 flow: Mitchy's questions before crafting, then rate each result (CraftClarify.tsx), keep the last result on leave
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
  const [fb, setFb] = useState<Fb | null>(null);
  const fbRef = useRef(fb);
  fbRef.current = fb;
  const [leaveSel, setLeaveSel] = useState(0);
  const [clar, setClar] = useState<Clar | null>(null);
  const clarRef = useRef(clar);
  clarRef.current = clar;
  const [peers, setPeers] = useState<SharedTags>({ up: [], down: [] });
  // The AI couldn't be reached: a popup says so plainly, tries once more on
  // its own after AI_RETRY_MS, and after that asks the player to tell the
  // host. `retry` repeats exactly the step that failed; no token is spent.
  const [aiDown, setAiDown] = useState<{ info: AiDown; attempt: number; retryAt: number | null; retrying: boolean; retry: () => void } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  function goOffline(info: AiDown, retry: () => void) {
    setPhase('offline');
    setStage(null);
    setPartial([]);
    setBusyLine(null);
    const failedBefore = noteAiDown(); // it already failed before a reload: treat it as a repeat
    setAiDown((a) => {
      const attempt = a ? a.attempt + 1 : failedBefore ? 2 : 1;
      return { info, attempt, retryAt: attempt === 1 ? Date.now() + AI_RETRY_MS : null, retrying: false, retry };
    });
  }
  function retryAi() {
    const a = aiDown;
    if (!a || a.retrying) return;
    setAiDown({ ...a, retrying: true, retryAt: null });
    a.retry();
  }
  useEffect(() => {
    if (!aiDown?.retryAt) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= aiDown.retryAt!) retryAi();
    }, 500);
    return () => window.clearInterval(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (clarify) void loadSharedTags().then(setPeers);
  }, [clarify]);
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
    // (clarify) a new idea gets Mitchy's questions first (not a rework)
    const asking = clarify && !rework && !how.direct;
    const building = () => getMitchyLine('a "hold on, building your thing right now" busy').then(setBusyLine);
    if (!asking) void building();

    // `again`: a retry after the AI couldn't be reached (see goOffline)
    const draw = (cl?: CraftClarify, log?: ClarifyLog, again = false) => {
      if (asking || again) {
        setPhase('working');
        setStage(null);
        setPartial([]);
        setBusyLine(null);
        void building();
      }
      void craftItem(
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
        { retry: !choices, prefs: feedback, ...(clarify ? { clarify: cl, noAlts: true } : {}) },
      ).then((r) => {
        if (closed.current) return;
        if (!r.ok && r.aiDown) return goOffline(r.aiDown, () => draw(cl, log, true));
        setAiDown(null);
        clearAiDown();
        finish(r, log);
      });
    };

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
    } else if (asking) {
      const ask = () => {
        setPhase('working');
        setStage('thinking');
        setBusyLine('Ooh, let me think about that for a second.');
        const t0 = Date.now();
        void clarifyPrompt(craftPrompt).then((qs) => {
          if (closed.current) return;
          setAiDown(null);
          clearAiDown();
          if (!qs.length) return draw(undefined, { questions: [], skipped: false, ms: Date.now() - t0, outcome: 'crafted' });
          setStage(null);
          setBusyLine(null);
          setPhase('clarifying');
          setClar({ prompt: craftPrompt, questions: qs, picks: [], step: 0, t0: Date.now(), locked: false, run: draw });
          push({
            who: 'mitchy',
            kind: 'text',
            text: `Ooh, before I start I have ${qs.length === 1 ? 'one quick question' : 'two quick questions'} so it turns out the way you imagine.`,
          });
          push({ who: 'mitchy', kind: 'text', text: qs[0].q });
        }).catch((err: unknown) => {
          if (closed.current) return;
          goOffline(
            err instanceof AiServiceError ? aiDownOf(err) : { failure: 'server', status: null, detail: String(err) },
            ask,
          );
        });
      };
      ask();
    } else draw();

    function finish(r: Awaited<ReturnType<typeof craftItem>>, log?: ClarifyLog) {
      if (closed.current) return; // left meanwhile; leave() already settled it
      reworking.current = false;
      setStage(null);
      setPartial([]);
      if (r.ok) {
        setPhase('success');
        if (rework) setAdjusted(true);
        if (how.surprise) push({ who: 'mitchy', kind: 'text', text: "Ta-da! Here's what I came up with." });
        const kind = feedback && isKind(r.kind) ? r.kind : null;
        const rated = feedback || clarify;
        push({
          who: 'mitchy',
          kind: 'result',
          item: r.item,
          prompt: craftPrompt,
          ...(feedback
            ? {
                tag: kind ? KIND_LABEL[kind].one : undefined,
                made: appliedLabels(r.applied ?? {}),
                status: 'There it is. First impression?',
              }
            : clarify
              ? { status: 'There it is. What do you think?' }
              : {}),
        });
        setPopup({ item: r.item, prompt: craftPrompt });
        lastResult.current = { item: r.item, prompt: craftPrompt };
        if (rated)
          setFb({
            id: newFeedbackId(),
            at: Date.now(),
            result: { item: r.item, prompt: craftPrompt },
            kind,
            applied: r.applied ?? {},
            adjusted: !!rework,
            vote: null,
            reasons: [],
            commentOpen: false,
            comment: '',
            step: 'vote',
            answers: null,
            scope: null,
            rstep: 'vote',
            picked: [],
            ownOpen: false,
            own: '',
            clarify: log ?? null,
          });
      } else if (rework) {
        // the rework failed: coins back, and the previous design is still
        // there to take (or to try adjusting again)
        onSpend(-ADJUST_PRICE);
        setPhase('success');
        push({ who: 'mitchy', kind: 'text', text: `${r.reply} (Your ${ADJUST_PRICE} coins are back in your pocket.)` });
        push({ who: 'mitchy', kind: 'result', item: rework.item, prompt: rework.prompt });
        setPopup(rework);
      } else {
        if (clarify && log) sendClarifyOnly(craftPrompt, { ...log, outcome: 'failed' });
        setPhase('failed');
        setInput(text.slice(0, PROMPT_MAX)); // pre-fill so they can edit instead of retype
        if (r.suggestions?.length) push({ who: 'mitchy', kind: 'alts', intro: r.reply, options: r.suggestions });
        else push({ who: 'mitchy', kind: 'text', text: r.reply });
      }
    }
  }

  // ---- (clarify) answering Mitchy's questions ----
  function answerClar(pick: number | null) {
    const c = clarRef.current;
    if (!c || c.locked || c.step >= c.questions.length) return;
    const q = c.questions[c.step];
    push({ who: 'me', kind: 'text', text: pick === null ? YOU_DECIDE : q.options[pick].label });
    const picks = [...c.picks];
    picks[c.step] = pick;
    const step = c.step + 1;
    if (step < c.questions.length) push({ who: 'mitchy', kind: 'text', text: c.questions[step].q });
    else {
      push({
        who: 'mitchy',
        kind: 'text',
        text: 'Lovely. Here is what I will make. Click any answer to change it, and press Craft it whenever you are ready.',
      });
      push({ who: 'mitchy', kind: 'plan' });
    }
    setClar({ ...c, picks, step });
  }
  // Craft it! on the plan panel, or Esc: open questions become "You decide"
  function commitClar(skipped: boolean) {
    const c = clarRef.current;
    if (!c || c.locked) return;
    const picks = c.questions.map((_, i) => c.picks[i] ?? null);
    if (skipped && c.step < c.questions.length)
      push({ who: 'mitchy', kind: 'text', text: "No problem, I'll decide the rest myself." });
    setClar({ ...c, picks, locked: true });
    const answers = c.questions.map((q, i) => ({ topic: q.topic, pick: picks[i] === null ? null : q.options[picks[i]!] }));
    const chosen = answers.flatMap((a) => (a.pick ? [a.pick] : []));
    const cl: CraftClarify = {
      guidance: clarifyGuidance(answers),
      size: chosen.find((o) => o.size)?.size,
      finish: chosen.find((o) => o.finish)?.finish,
      mood: chosen.find((o) => o.mood)?.mood,
    };
    c.run(cl, clarLog(c, picks, skipped, 'crafted'));
  }
  function clarLog(c: Clar, picks: (number | null | undefined)[], skipped: boolean, outcome: ClarifyLog['outcome']): ClarifyLog {
    return {
      questions: c.questions.map((q, i) => ({
        topic: q.topic,
        q: q.q,
        options: q.options.map((o) => o.label),
        pick: picks[i] == null ? null : q.options[picks[i]!].label,
      })),
      skipped,
      ms: Date.now() - c.t0,
      outcome,
    };
  }
  // a clarification that never got rated (the craft failed, or the player
  // left before crafting) — still worth a record
  function sendClarifyOnly(prompt: string, log: ClarifyLog) {
    void sendFeedback({
      v: 1,
      id: newFeedbackId(),
      at: Date.now(),
      player: playerId(),
      session: SESSION,
      link: window.location.pathname,
      prompt,
      name: '',
      kind: '',
      adjusted: false,
      vote: null,
      reasons: [],
      positive: [],
      tags: [],
      clarify: log,
      comment: '',
      applied: {},
      answers: null,
      scope: null,
      sprite: { lines: [] },
    });
  }
  // Esc skips the questions (or the rating's tags) instead of asking to leave
  useEffect(() => {
    const asking = phase === 'clarifying';
    const tagging = !!fb && fb.rstep === 'tags';
    if (!clarify || confirmClose || (!asking && !tagging)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (asking) commitClar(true);
      else finishRating();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // (an adjustment is sent from its own option, not from Craft it!)
  const planReady = phase === 'clarifying' && !!clar && !clar.locked && clar.step >= clar.questions.length;
  const canSend = planReady || (!!input.trim() && !done && !popup && phase !== 'clarifying');
  function submit() {
    if (phase === 'clarifying') {
      if (planReady) commitClar(false);
      return;
    }
    const text = input.trim();
    if (!text || done) return; // token spent
    if (popup) {
      if (!adjusting || money < ADJUST_PRICE) return; // awaiting a choice
      const rework = popup;
      flushFb(); // the rating of the old design is final now
      setFb(null);
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

  // ---- (feedback) storing the rating ----
  // Sent once voted, again (same id) when reasons, comment or tuning answers
  // change — debounced, and flushed right away on taking or leaving.
  function fbRecord(f: Fb) {
    const { item, prompt } = f.result;
    return {
      v: 1 as const,
      id: f.id,
      at: f.at,
      player: playerId(),
      session: SESSION,
      link: window.location.pathname,
      prompt,
      name: item.name,
      kind: f.kind ?? '',
      adjusted: f.adjusted,
      vote: f.vote as 'up' | 'down',
      reasons: clarify
        ? f.vote === 'down'
          ? f.picked.filter((t): t is FeedbackReason => (FEEDBACK_REASONS as readonly string[]).includes(t))
          : []
        : f.vote === 'down'
          ? f.reasons
          : [],
      positive:
        clarify && f.vote === 'up'
          ? f.picked.filter((t): t is PositiveReason => (POSITIVE_REASONS as readonly string[]).includes(t))
          : [],
      tags: clarify
        ? [
            ...f.picked.filter((t) => !(FEEDBACK_REASONS as readonly string[]).includes(t) && !(POSITIVE_REASONS as readonly string[]).includes(t)),
            ...(f.ownOpen && cleanTag(f.own) ? [cleanTag(f.own)!] : []),
          ]
        : [],
      clarify: f.clarify,
      comment: f.vote === 'down' && f.commentOpen ? f.comment.trim() : '',
      applied: f.applied,
      answers: f.answers,
      scope: f.scope,
      sprite: { lines: item.sprite, ...(item.palette && item.colors ? { palette: item.palette, colors: item.colors } : {}) },
    };
  }
  const sentFb = useRef('');
  function flushFb(f: Fb | null = fbRef.current) {
    if (!f || !f.vote) return;
    const rec = fbRecord(f);
    const key = JSON.stringify(rec);
    if (key === sentFb.current) return;
    sentFb.current = key;
    void sendFeedback(rec);
  }
  useEffect(() => {
    if (!fb?.vote) return;
    const t = window.setTimeout(() => flushFb(fb), 800);
    return () => window.clearTimeout(t);
  }, [fb]); // eslint-disable-line react-hooks/exhaustive-deps
  const updFb = (patch: Partial<Fb>) => setFb((f) => (f ? { ...f, ...patch } : f));
  // (clarify) Done or Esc on the rating's tags: thank the player, store it
  function finishRating() {
    const f = fbRef.current;
    if (!f || !f.vote) return;
    const next = { ...f, rstep: 'done' as const };
    setFb(next);
    flushFb(next);
  }

  // ---- success → folded (player chose equip / inventory) ----
  function choose(equip: boolean, res: Result | null = popup) {
    if (!res) return;
    const { item } = res;
    lastResult.current = null;
    if (clarify) finishRating(); // (already done; stores any late change)
    else flushFb();
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
    if (clarify) finishRating();
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
    const c = clarRef.current;
    if (clarify && c && !c.locked) sendClarifyOnly(c.prompt, clarLog(c, c.picks, false, 'left'));
    if ((choices || feedback || clarify) && !done) {
      if (reworking.current) onSpend(-ADJUST_PRICE);
      if (lastResult.current) choose(false, lastResult.current);
    }
    flushFb();
    onClose();
  }

  // ---- navigation ----
  function back() {
    if (fb?.step === 'tuning') updFb({ step: 'vote' });
    else if (historyOpen) setHistoryOpen(false);
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
  type Opt = { label: string; go: () => void; disabled?: boolean; title?: string; cls?: string };
  const asked = phase === 'clarifying' && clar && !clar.locked && clar.step < clar.questions.length ? clar.questions[clar.step] : null;
  const options: Opt[] = viewRec
    ? []
    : asked
      ? [
          ...asked.options.map((o, j) => ({ label: o.label, go: () => answerClar(j) })),
          { label: YOU_DECIDE, go: () => answerClar(null), cls: 'decide' },
        ]
    : phase === 'clarifying'
      ? [] // the plan panel: change answers there, then Craft it!
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
      : popup && fb && (clarify ? fb.rstep !== 'done' : !fb.vote || fb.step === 'tuning')
      ? [] // (feedback) rate it first / answering the questions
      : popup
      ? [
          { label: 'Equip it.', go: () => choose(true) },
          { label: 'Into my inventory.', go: () => choose(false) },
          ...(feedback && fb && fb.step === 'vote'
            ? [{ label: 'Tune future crafts →', go: () => updFb({ step: 'tuning' }) }]
            : []),
          ...(adjusted
            ? []
            : [
                {
                  label: `${fb?.step === 'tuned' ? 'Adjust it with these' : 'Adjust the design'} (${ADJUST_PRICE} coins)`,
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
  useEffect(() => setOptSel(0), [options.length, popup, lastAlts, lastConcepts, adjusting, fb?.step, fb?.rstep, clar?.step]);

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
      else if (t.kind === 'plan') {
        if (clar)
          add(
            'mitchy',
            <div key={i} className="cl-wrap">
              <ClarifyPlan
                questions={clar.questions}
                picks={clar.questions.map((_, j) => clar.picks[j] ?? null)}
                locked={clar.locked}
                onPick={(q, pick) =>
                  setClar((c) => (c && !c.locked ? { ...c, picks: c.picks.map((p, j) => (j === q ? pick : p)) } : c))
                }
              />
            </div>,
          );
      }
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
            <ResultCard look={lookOf(t.item)} name={t.item.name} desc={t.item.funcDesc} tag={t.tag} made={t.made} />
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
  }, [chatSize, viewRec, busyLine, adjusting, fb?.vote, fb?.reasons.length, fb?.commentOpen, fb?.rstep, fb?.ownOpen]);

  // what leaving now keeps (see leave())
  function leaveText(): string | undefined {
    if (done) return undefined;
    const last = choices || feedback || clarify ? lastResult.current : null;
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
      : phase === 'clarifying'
      ? asked
        ? 'Pick an answer above, or press Esc to skip'
        : 'Change an answer above, or press Craft it'
      : popup && fb && clarify && fb.rstep !== 'done'
      ? 'Rate it above first'
      : popup && fb && !fb.vote
      ? 'Rate it above first: I like it / Not quite'
      : fb?.step === 'tuning'
      ? 'One answer per question, or skip'
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
            {fb?.step === 'tuning' && !viewRec ? (
              <TuneQuestions
                kind={fb.kind}
                onSave={(answers, scope) => {
                  savePrefs(answers, scope, fb.kind);
                  updFb({ answers, scope });
                }}
                onClose={() => {
                  updFb({ step: 'tuned' });
                  push({
                    who: 'mitchy',
                    kind: 'text',
                    text:
                      'Got it, I’ll remember that. You can change these anytime in Settings → Crafting preferences. ' +
                      (adjusted ? 'Want to keep this one?' : `Want me to adjust this one with them (${ADJUST_PRICE} coins), or keep it?`),
                  });
                }}
              />
            ) : (
              groups.map((g, i) => (
                <ChatMessage key={i} who={g.who === 'me' ? player : MITCHY} side={g.who === 'me' ? 'right' : 'left'}>
                  {g.bubbles}
                </ChatMessage>
              ))
            )}
            {fb && clarify && (popup || fb.rstep === 'done') && !viewRec && !adjusting && (
              <RatingPanel
                vote={fb.vote}
                step={fb.rstep}
                picked={fb.picked}
                ownOpen={fb.ownOpen}
                own={fb.own}
                peers={peers}
                onVote={(vote) => updFb({ vote, rstep: 'tags', picked: [], ownOpen: false, own: '' })}
                onPicked={(picked) => updFb({ picked })}
                onOwnOpen={(ownOpen) => updFb({ ownOpen })}
                onOwn={(own) => updFb({ own })}
                onDone={finishRating}
              />
            )}
            {fb && popup && !clarify && fb.step === 'vote' && !viewRec && !adjusting && (
              <FeedbackVote
                vote={fb.vote}
                reasons={fb.reasons}
                commentOpen={fb.commentOpen}
                comment={fb.comment}
                onVote={(vote) => updFb({ vote, ...(vote === 'up' ? { reasons: [], commentOpen: false, comment: '' } : {}) })}
                onReasons={(reasons) => updFb({ reasons })}
                onCommentOpen={(commentOpen) => updFb({ commentOpen })}
                onComment={(comment) => updFb({ comment })}
              />
            )}
            {options.length > 0 && (
              <div className="ds-options cw3-replies" role="listbox">
                {options.map((o, i) => (
                  <button
                    key={o.label}
                    role="option"
                    aria-selected={i === optSel}
                    className={'ds-option' + (o.cls ? ' ' + o.cls : '') + (i === optSel ? ' sel' : '')}
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
              disabled={(!!popup && !adjusting) || done || phase === 'clarifying'}
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

      {/* the AI couldn't be reached: say so, retry, then ask for the host */}
      {aiDown && !confirmClose && (
        <div className="cw3-scrim">
          <AiDownPopup
            info={aiDown.info}
            attempt={aiDown.attempt}
            retryAt={aiDown.retryAt}
            retrying={aiDown.retrying}
            now={now}
            onRetry={retryAi}
            onLeave={leave}
          />
        </div>
      )}

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
