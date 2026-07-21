// ---------------------------------------------------------------------------
// STAGE 2 — Claude vision transcribes the reference image into an ASCII sprite.
// One vision call (image + text), anatomy-first. Pure prompt building + parsing;
// the vision chat function is injected (llm.ts owns the client), so this file
// never imports an API client.
// ---------------------------------------------------------------------------

import {
  FACE_SET,
  MAX_SPRITE_WIDTH,
  SIZE_BANDS,
  SIZE_GUIDELINE,
  STYLE_EXAMPLES,
  type GeneratedSprite,
  type SizeClass,
} from './spriteConfig';

import { checkLine } from './spriteValidate';

// Local vision message types (kept out of the client to respect the boundary).
type ContentPart =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image_url'; image_url: { url: string } };
interface VMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}
export type VisionJSON = <T>(
  messages: VMessage[],
  opts?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: { type: 'disabled' | 'enabled' | 'adaptive' };
    fallbackModel?: string;
  },
) => Promise<T>;

// Streaming transport (llmClient.chatStream matches this shape). Yields raw
// text deltas; a delta may contain several newlines at once.
export type ChatStreamFn = (
  messages: VMessage[],
  opts?: {
    model?: string;
    maxTokens?: number;
    thinking?: { type: 'disabled' | 'enabled' | 'adaptive' };
    signal?: AbortSignal;
    fallbackModel?: string;
  },
) => AsyncGenerator<string, void, void>;

const FACE_LIST = FACE_SET.join(' ');
const BODY_LIST = "@ # * o O . , ' \" ` ~ - _ = + | / \\ ( ) < > ^ v ; : ! % & and space";

function styleBlock(): string {
  return STYLE_EXAMPLES.map((e) => `${e.name}:\n${e.art.join('\n')}`).join('\n\n');
}

// The full system prompt. `hasImage` branches the handful of sections that
// actually mention a reference image — kept parameterized (rather than
// hard-coding the text-only framing) so the image-mediated path stays
// available for a future A/B without rewriting this function again.
export function systemPrompt(hasImage: boolean): string {
  return [
    // 1) ROLE
    hasImage
      ? 'You are an ASCII sprite artist. You transcribe a reference image into a symbolic ' +
        'character sprite. Symbols carry meaning — you NEVER shade silhouettes with density characters. ' +
        'You NEVER write words, names, or letters as labels inside the sprite: every part is drawn as a ' +
        'shape out of the allowed symbols (a body is an outlined shape, never the word "body").'
      : 'You are an ASCII sprite artist. You turn a short text description into a symbolic ' +
        'character sprite. Symbols carry meaning — you NEVER shade silhouettes with density characters. ' +
        'You NEVER write words, names, or letters as labels inside the sprite: every part is drawn as a ' +
        'shape out of the allowed symbols (a body is an outlined shape, never the word "body").',

    // 2) STRUCTURAL ANALYSIS — break the subject down first, then draw
    'First analyse the subject into its essential visual components (these become "parts"):\n' +
      '- Core anatomy: head shape, body posture, ears, limbs, tail — with COUNTS (e.g. 3 heads, 4 legs)\n' +
      '- Key features / expression: eye style, mouth, snout, and the cute-face mood\n' +
      '- Accessories & details: glasses, hats, collars, loading rings, clothing, markings\n' +
      '(For plants: bloom/crown, stem/trunk, leaves, pot. For objects/structures: the main silhouette ' +
      'plus functional parts like wheels, roof, handle.)\n' +
      'Note the spatial arrangement — what sits on top / left / right. THEN draw the sprite part by part, ' +
      'preserving that arrangement and the proportions. ' +
      (hasImage
        ? 'Reproduce the anatomy you actually SEE in the image — every part that is there, in the same ' +
          'layout — do not add, drop, or "improve" parts based on assumptions. '
        : 'Derive the anatomy from the words in the description — infer reasonable, typical anatomy for ' +
          'the subject described; do not invent extra parts the description never implied. ') +
      'Prioritize a recognizable silhouette over dense texture, with clean outlines. When you are ' +
      'uncertain about a detail, simplify rather than elaborate — a clean simple silhouette that reads ' +
      'clearly beats an over-detailed one that loses coherence; every extra stroke is a chance to bend ' +
      'the grid or blur the shape.',

    // 3) CONCEPT SUBSTITUTION — reason about motifs that don't translate
    // literally, the way a from-scratch creative pass would, rather than a
    // blind pixel transcription. Scoped: motifs/details only, never core
    // anatomy, never text.
    (hasImage
      ? 'When the reference contains a theme or motif with no literal symbol in the allowed set '
      : 'When the description names a theme or motif with no literal symbol in the allowed set ') +
      '(a loading spinner, a sparkle effect, a specific small accessory), do not omit it and do not ' +
      'trace it pixel-for-pixel — reason about what it REPRESENTS and choose a fitting symbolic ' +
      'stand-in from the allowed glyphs (e.g. a loading ring above a head could become a * spark or a ' +
      'cocked ear; a "thinking" mood could become the face expression itself). Apply this to motifs ' +
      'and small details only — heads, limbs, and body structure are still drawn structurally from the ' +
      'anatomy analysis. Never substitute in text, letters, or a caption: the sprite is symbols only.',

    // 4) FACES — cute dot faces, single-width so the grid never bends
    'For eyes and mouths of creatures/characters, draw a CUTE Japanese-style dot face, chosen by mood: ' +
      'neutral (·ω·), happy (^ω^), sleepy (-_-) or (_ _), grumpy (>_<), surprised (°o°), plain ( o.o ). ' +
      'The dots (· ° o) are the eyes and ω is a small animal mouth when used. Always wrap the face in ( ). ' +
      'A mood does NOT need a special glyph — sleepy, grumpy and other expressions can be built entirely ' +
      'from plain punctuation (as in the examples) when that reads better than a dot-face. ' +
      'Use ONLY single-width glyphs — never the fullwidth kaomoji dot (・) or any other wide glyph.\n' +
      `FACE SET (the only non-ASCII glyphs allowed): ${FACE_LIST}. ` +
      `Everything else must come from: ${BODY_LIST}. No words, no other letters, no digits.`,

    // 5) STYLE EXAMPLES
    'Your output must look stylistically related to these existing sprites:\n\n' + styleBlock(),

    // 6) SIZE — bands derive from SIZE_BANDS (anchored to the hand-made world
    // sprites), never hardcoded here, so retuning the bands retunes the prompt.
    `Sprites are ${SIZE_BANDS.small.minW} to ${MAX_SPRITE_WIDTH} characters wide — ` +
      `${SIZE_BANDS.small.minW} is a HARD FLOOR, never narrower. Size classes: ` +
      `small ${SIZE_BANDS.small.minW}-${SIZE_BANDS.small.maxW} wide (max ${SIZE_BANDS.small.maxH} tall), ` +
      `medium ${SIZE_BANDS.medium.minW}-${SIZE_BANDS.medium.maxW} wide (max ${SIZE_BANDS.medium.maxH} tall), ` +
      `large ${SIZE_BANDS.large.minW}-${Math.min(SIZE_BANDS.large.maxW, MAX_SPRITE_WIDTH)} wide (max ${SIZE_BANDS.large.maxH} tall). ` +
      SIZE_GUIDELINE +
      ' Your sprite stands NEXT TO those world sprites — a creature wider than ~8 characters reads as ' +
      'bigger than a person, so most animals and items belong in the small band (the style-example cat ' +
      'is 7 wide — that is the right scale for a pet). ' +
      'Choose the smallest class that lets every anatomical part stay recognizable. A standing or ' +
      'dynamic pose (a raised limb, a wave, an outstretched part) needs LATERAL room, not just height — ' +
      'use the full width of the chosen band rather than compressing narrow and stacking tall; a sprite ' +
      'narrower than its band\'s minimum width fails validation outright.',

    // 7) OUTPUT — a plain-text grammar designed for incremental streaming.
    // ANALYSIS COMES FIRST, deliberately: PARTS + LAYOUT are written before a
    // single sprite row, forcing the structural analysis to actually happen
    // before drawing (thinking is disabled, so these two lines ARE the
    // model's working space — worth the ~1s before the first sprite line).
    // SYMMETRY comes after LAYOUT (judging symmetry needs the anatomy already
    // reasoned out) and before NAME/LINES (it governs how rows are drawn).
    // Control keywords use letters that don't exist in the sprite charset
    // (only o/O/v are allowed), so a sprite row can never be mistaken for a
    // control line. No sizeClass field: it's decided upstream and re-derived
    // from actual width anyway.
    // NOTE: a SYMMETRY: mirror|none field (model draws only a left half, we
    // mirror it) was tried and is fully implemented/unit-tested downstream
    // (mirrorHalfLine, SpriteLineStream) — but live-tested against
    // google/gemini-2.5-flash-lite it was NOT reliable: the model repeatedly
    // wrote a COMPLETE symmetric-looking pattern (e.g. a whole "( ^ω^ )" face)
    // instead of a true half, even with an explicit strengthened warning
    // against exactly that failure, so mirroring doubled it into garbage.
    // Confirmed twice, not a fluke. Not asking for it here — the field is
    // absent from the grammar below, so the parser's default ('none') always
    // applies and every line passes through unmodified. Re-add the SYMMETRY
    // line + a worked example (git history has the exact prompt text) if this
    // is ever retried against a more capable model.
    'Reply in EXACTLY this plain-text format — no JSON, no code fences, no commentary outside the fields. ' +
      'Start immediately with PARTS:. PARTS and LAYOUT are your structural analysis — be precise ' +
      '(exact COUNTS, which parts touch, what is biggest) and then draw following that plan exactly. ' +
      'Do not write anything between LINES: and the sprite rows:\n' +
      'PARTS: part one | part two | part three\n' +
      'LAYOUT: one short sentence on the spatial arrangement (top/left/right, sizes)\n' +
      'NAME: short cute name\n' +
      'LINES:\n' +
      '<one sprite row per line, exactly as drawn, padded with trailing spaces to the sprite width>\n' +
      'END\n\n' +
      'Example (format only — draw whatever fits the subject; this is a valid SMALL sprite, 8 wide x 4 tall):\n' +
      'PARTS: pointed ears x2 | dot face | round body | four paws | tail\n' +
      'LAYOUT: ears on top of head, face centered, a rounded body below it, paws under the body, tail at right\n' +
      'NAME: Village Cat\n' +
      'LINES:\n' +
      ' /\\_/\\  \n' +
      '( o.o ) \n' +
      ' (___)~ \n' +
      ' ^   ^  \n' +
      'END\n\n' +
      'Keep PARTS to at most 6 short phrases (2-5 words each) with counts, covering anatomy + accessories.',
  ].join('\n\n');
}

function userText(
  prompt: string,
  category: string,
  hasImage: boolean,
  retryHint?: string,
  sizeClass?: SizeClass,
): string {
  let base = hasImage
    ? `Token category: ${category}. The player asked for: "${prompt}". Transcribe the reference image.`
    : `Token category: ${category}. The player asked for: "${prompt}". No reference image — derive the ` +
      `anatomy from the words, then draw the sprite.`;
  if (sizeClass) {
    const band = SIZE_BANDS[sizeClass];
    base += ` Draw within the ${sizeClass} size band: ${band.minW}-${Math.min(band.maxW, MAX_SPRITE_WIDTH)} characters wide, max ${band.maxH} lines tall.`;
  }
  return retryHint ? `${base}\n\nYour previous attempt failed validation: ${retryHint}. Fix exactly that.` : base;
}

// ---------------------------------------------------------------------------
// STAGE 0 — pre-flight screen. ONE cheap JSON call that makes every judgment
// needed before generation starts (absorbs what used to be classifySize):
//   fit        does the request belong to the token's category?
//   tokenHint  which token WOULD fit, for Mitchy's feedback line
//   sensitive  violent/gory/sexual/hateful content (cozy family game)
//   sizeClass  the size band the sprite generator draws inside
// A mismatch or blocked prompt now costs one tiny call instead of a full
// wasted generation. On ANY failure the default is PERMISSIVE (fit, not
// sensitive, medium) — a broken screen must never block crafting.
// ---------------------------------------------------------------------------

export interface CraftScreen {
  fit: boolean;
  tokenHint?: string; // a real category name, when fit is false
  sensitive: boolean;
  sizeClass: SizeClass;
}

const TOKEN_CATEGORIES =
  'plant (flowers, trees, flora), pets (animals, creatures, companions), ' +
  'clothing (wearables, accessories), vehicle (things you ride), ' +
  'food (edible things), utensils (tools, weapons, furniture, misc objects)';

export function screenPrompt(): string {
  return (
    'You screen craft requests for Asciia Bay, a cozy, family-friendly ASCII island-village game. ' +
    `The token categories are: ${TOKEN_CATEGORIES}. ` +
    'Judge: (1) "fit" — does the requested thing belong to the GIVEN token category? Be LENIENT: a ' +
    'hybrid like "a dog with a witch hat" fits pets because the core subject is a pet; only mark ' +
    'fit=false when the core subject clearly belongs elsewhere. (2) "tokenHint" — when fit is false, ' +
    'the category it WOULD belong to (or "none"). (3) "sensitive" — true only for violent, gory, ' +
    'sexual, hateful, or otherwise family-unfriendly content. (4) "sizeClass" — ' +
    SIZE_GUIDELINE +
    ' Reply with JSON only: {"fit": true|false, "tokenHint": "plant|pets|clothing|vehicle|food|utensils|none", ' +
    '"sensitive": true|false, "sizeClass": "small"|"medium"|"large"}.'
  );
}

export async function screenCraftPrompt(
  prompt: string,
  category: string,
  chat: VisionJSON,
  opts: { model?: string; fallbackModel?: string } = {},
): Promise<CraftScreen> {
  try {
    const r = await chat<{ fit?: unknown; tokenHint?: unknown; sensitive?: unknown; sizeClass?: unknown }>(
      [
        { role: 'system', content: screenPrompt() },
        { role: 'user', content: `Token category: ${category}. Request: "${prompt}".` },
      ],
      { model: opts.model, maxTokens: 60, thinking: { type: 'disabled' }, fallbackModel: opts.fallbackModel },
    );
    const s = r?.sizeClass;
    return {
      fit: r?.fit !== false, // anything unclear → permissive
      tokenHint: typeof r?.tokenHint === 'string' && r.tokenHint !== 'none' ? r.tokenHint : undefined,
      sensitive: r?.sensitive === true,
      sizeClass: s === 'small' || s === 'medium' || s === 'large' ? s : 'medium',
    };
  } catch {
    return { fit: true, sensitive: false, sizeClass: 'medium' };
  }
}

// ---------------------------------------------------------------------------
// Failure suggestions — when a craft fails for a benign reason, Mitchy offers
// three alternatives close to the player's idea. Each option is forced onto a
// DIFFERENT repair strategy (reduce / rearrange / refocus) so they're three
// distinct creative directions of equal quality — not one real fix plus two
// downgraded echoes of it, which is what a naive "give 3 alternatives" prompt
// produces. The caller shuffles the result so no option reads as "first".
// ---------------------------------------------------------------------------

export interface CraftSuggestions {
  intro: string; // Mitchy's one-liner naming what was too much
  options: string[]; // exactly 3 short alternative craft prompts
}

export async function suggestAlternatives(
  prompt: string,
  category: string,
  failReason: string,
  chat: VisionJSON,
  opts: { model?: string; fallbackModel?: string } = {},
): Promise<CraftSuggestions | null> {
  try {
    const r = await chat<{ intro?: unknown; options?: unknown }>(
      [
        {
          role: 'system',
          content:
            'You are Mitchy, a cozy, witty shopkeeper CAT in Asciia Bay, a cozy ASCII island-village game. A craft attempt ' +
            'just failed and you propose three alternatives the player can pick instead. Ground your ' +
            'intro in the TECHNICAL REASON given (e.g. "too tall" means the motif did not fit the ' +
            'sprite size): one playful lowercase line naming what was too much, under 18 words, no ' +
            'emoji. Then exactly 3 options, each 3-8 words, each a craftable description staying ' +
            'CLOSE to the player\'s idea and fitting the token category. Each option MUST use a ' +
            'different repair strategy: ' +
            '(A) REDUCE — keep the subject, shrink the overloaded element (e.g. one hat instead of three); ' +
            '(B) REARRANGE — keep ALL the elements, change the composition so it fits (e.g. hats lined up beside, not stacked); ' +
            '(C) REFOCUS — keep the theme, shift the subject or perspective (e.g. the stack of hats itself as the item). ' +
            'Each must be independently appealing — if any reads like a plain downgrade of another, ' +
            'rewrite it before answering. Do not number or rank them. ' +
            'Reply with JSON only: {"intro": "...", "options": ["...", "...", "..."]}.',
        },
        {
          role: 'user',
          content: `Token category: ${category}. The player asked for: "${prompt}". Technical failure reason: ${failReason}.`,
        },
      ],
      { model: opts.model, temperature: 0.8, maxTokens: 180, thinking: { type: 'disabled' }, fallbackModel: opts.fallbackModel },
    );
    const intro = typeof r?.intro === 'string' ? r.intro.trim() : '';
    const options = Array.isArray(r?.options)
      ? r.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim()).slice(0, 3)
      : [];
    if (!intro || options.length < 3) return null;
    // shuffle so the model's own left-to-right ordering bias can't make one
    // option look like "the real fix" and the others like consolation prizes
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { intro, options };
  } catch {
    return null; // caller degrades to a plain error reply, no buttons
  }
}

// ---------------------------------------------------------------------------
// "Generate half, mirror the rest" — for bilaterally-symmetric subjects, the
// model draws only the LEFT HALF of each row (last char = the shared center
// column, never duplicated); we mirror+join it here. Halves typical sprite-
// body output tokens and guarantees perfect symmetry (a common LLM ASCII
// failure mode). Flip pairs are direction-sensitive glyphs; everything else
// (including FACE_SET) self-maps.
// ---------------------------------------------------------------------------

const MIRROR_PAIRS: Record<string, string> = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<' };

export function mirrorHalfLine(half: string): string {
  if (half.length === 0) return half; // malformed empty half — width check catches it downstream
  const center = half[half.length - 1];
  const left = half.slice(0, -1);
  const flipped = [...left].reverse().map((ch) => MIRROR_PAIRS[ch] ?? ch).join('');
  return left + center + flipped;
}

// ---------------------------------------------------------------------------
// Incremental wire-format parser. Consumes raw stream deltas and emits events
// the moment each line is complete, so a sprite row can be validated (and
// rendered) without waiting for the full response.
//   state machine: header (NAME:) → lines (until END) → done (PARTS:)
// Anything before NAME:/LINES: (stray prose, code fences) is ignored.
// ---------------------------------------------------------------------------

export type ParsedEvent =
  | { type: 'name'; name: string }
  | { type: 'line'; text: string; index: number }
  | { type: 'end' }
  | { type: 'parts'; parts: string[] }
  | { type: 'layout'; layout: string }
  | { type: 'symmetry'; mode: 'mirror' | 'none' };

export class SpriteLineStream {
  private state: 'header' | 'lines' | 'done' = 'header';
  private buf = '';
  private index = 0;
  private symmetry: 'mirror' | 'none' = 'none';

  feed(delta: string): ParsedEvent[] {
    this.buf += delta;
    const out: ParsedEvent[] = [];
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      this.dispatch(line, out);
    }
    return out;
  }

  // flush a trailing unterminated line at EOF (typically the PARTS: footer)
  finish(): ParsedEvent[] {
    const out: ParsedEvent[] = [];
    if (this.buf.length > 0) {
      this.dispatch(this.buf.replace(/\r$/, ''), out);
      this.buf = '';
    }
    return out;
  }

  private dispatch(line: string, out: ParsedEvent[]) {
    if (this.state === 'header') {
      const t = line.trim();
      if (t.startsWith('PARTS:')) {
        out.push({
          type: 'parts',
          parts: t.slice(6).split('|').map((s) => s.trim()).filter(Boolean).slice(0, 6),
        });
      } else if (t.startsWith('LAYOUT:')) out.push({ type: 'layout', layout: t.slice(7).trim().slice(0, 160) });
      else if (t.startsWith('SYMMETRY:')) {
        const mode = t.slice(9).trim().toLowerCase() === 'mirror' ? 'mirror' : 'none';
        this.symmetry = mode; // remembered for the 'lines' state below
        out.push({ type: 'symmetry', mode });
      } else if (t.startsWith('NAME:')) out.push({ type: 'name', name: t.slice(5).trim().slice(0, 24) });
      else if (t === 'LINES:') this.state = 'lines';
      // anything else before LINES: is ignored
    } else if (this.state === 'lines') {
      if (line.trim() === 'END') {
        this.state = 'done';
        out.push({ type: 'end' });
      } else {
        // do NOT trim — trailing spaces are part of the sprite grid. Mirror
        // happens HERE, before the line is ever emitted, so every downstream
        // consumer (checkLine, onLine, fail-fast abort) only ever sees the
        // full, already-mirrored row — no changes needed anywhere else.
        const text = this.symmetry === 'mirror' ? mirrorHalfLine(line) : line;
        out.push({ type: 'line', text, index: this.index++ });
      }
    } else {
      // tolerate a trailing PARTS: after END (old-format compatibility)
      const t = line.trim();
      if (t.startsWith('PARTS:')) {
        out.push({
          type: 'parts',
          parts: t.slice(6).split('|').map((s) => s.trim()).filter(Boolean).slice(0, 6),
        });
      }
    }
  }
}

// One STREAMING generation attempt. Sprite lines are validated the moment they
// arrive; the first bad line aborts the in-flight request (fail fast — no
// tokens wasted finishing a doomed response). Returns either the sprite or an
// error string that feeds the retry-hint mechanism.
export async function generateSprite(
  prompt: string,
  category: string,
  referenceImage: string | null,
  chatStream: ChatStreamFn,
  opts: {
    model?: string;
    fallbackModel?: string;
    retryHint?: string;
    sizeClass?: SizeClass;
    onLine?: (line: string, index: number) => void; // progressive rendering hook
  } = {},
): Promise<{ sprite: GeneratedSprite } | { error: string }> {
  const hasImage = !!referenceImage;
  // The system prompt is pure/static — a perfect prompt-cache prefix. The
  // cache_control breakpoint makes every craft after the first read the
  // system prompt from cache (~11x cheaper on that span; verified live).
  const messages: VMessage[] = [
    {
      role: 'system',
      content: [{ type: 'text', text: systemPrompt(hasImage), cache_control: { type: 'ephemeral' } }],
    },
  ];
  if (hasImage) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userText(prompt, category, true, opts.retryHint, opts.sizeClass) },
        { type: 'image_url', image_url: { url: referenceImage as string } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userText(prompt, category, false, opts.retryHint, opts.sizeClass) });
  }

  const controller = new AbortController();
  const parser = new SpriteLineStream();
  let name = 'Crafted Thing';
  let parts: string[] = [];
  let layout: string | undefined;
  let symmetry: 'mirror' | 'none' = 'none';
  const lines: string[] = [];
  let ended = false;

  const handle = (events: ParsedEvent[]): string | null => {
    for (const ev of events) {
      if (ev.type === 'name') name = ev.name || name;
      else if (ev.type === 'end') ended = true;
      else if (ev.type === 'parts') parts = ev.parts;
      else if (ev.type === 'layout') layout = ev.layout;
      else if (ev.type === 'symmetry') symmetry = ev.mode;
      else if (ev.type === 'line' && !ended) {
        const check = checkLine(ev.text);
        if (!check.ok) return check.error ?? 'bad line';
        lines.push(ev.text);
        opts.onLine?.(ev.text, ev.index);
      }
    }
    return null;
  };

  try {
    // thinking disabled: this is direct transcription, not a reasoning task.
    // Generous budget as headroom — with streaming + fail-fast the real cost
    // is bounded by aborting early, not by the ceiling.
    const stream = chatStream(messages, {
      model: opts.model,
      maxTokens: 6000,
      thinking: { type: 'disabled' },
      signal: controller.signal,
      fallbackModel: opts.fallbackModel,
    });
    for await (const delta of stream) {
      const bad = handle(parser.feed(delta));
      if (bad) {
        controller.abort(); // fail fast — stop the model mid-generation
        return { error: bad };
      }
    }
    const bad = handle(parser.finish());
    if (bad) return { error: bad };
  } catch (e) {
    return { error: `stream failed: ${(e as Error)?.message ?? e}` };
  }

  if (lines.length === 0) return { error: 'no sprite lines received' };
  return { sprite: { name, sizeClass: 'medium', parts, layout, symmetry, lines } };
}
