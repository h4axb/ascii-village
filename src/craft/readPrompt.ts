// ---------------------------------------------------------------------------
// Reading a crafting prompt before anything else: one small model call
// fixes its spelling ("a gree drgon" -> "a green dragon") and hands back
// what it asks for as tags — size, colours, details, a style. Everything
// after (the /1 questions, the library matcher, the colour call, the
// planner) works from the fixed prompt and the tags, so a typo no longer
// hides a colour or turns into an "unknown detail".
//
// Without the model (offline, a failed call, or slower than READ_MS) the
// local fallback fixes colour and size words only (colours.ts fixTypos).
// One reading per prompt per session: the questions and the craft right
// after share it.
// ---------------------------------------------------------------------------
import { chatJSON, llmEnabled, MODELS } from '../llmClient';
import { fixTypos } from './colours';
import { isKnownWord } from './lexicon';
import type { SizeClass } from './spriteConfig';

export interface PromptRead {
  fixed: string; // the prompt with its spelling fixed (else as typed)
  size: SizeClass | null; // a size the player said
  colours: { target: string; colour: string }[]; // "whole" or the part words
  details: string[]; // features asked for, short phrases
  style: string | null; // a style / culture / theme ("viking")
  fixes: [string, string][]; // the words that were corrected, as typed -> as read
  via: 'model' | 'local';
}

const READ_MS = 2500;
const cache = new Map<string, Promise<PromptRead>>();

export function readPrompt(prompt: string): Promise<PromptRead> {
  const key = prompt.trim().toLowerCase();
  let p = cache.get(key);
  if (!p) {
    p = read(prompt.trim());
    cache.set(key, p);
  }
  return p;
}

function local(prompt: string): PromptRead {
  const { fixed, fixes } = fixTypos(prompt, isKnownWord);
  return { fixed, size: null, colours: [], details: [], style: null, fixes, via: 'local' };
}

const SYSTEM = `You read a player's request for an item in a cozy crafting game, before it is crafted.
Reply with JSON only:
{"fixed": the request with its spelling mistakes fixed,
 "size": "small" | "medium" | "large" | null,
 "colours": [{"target": "whole" or the part it is for, "colour": the colour as a plain word or short phrase}],
 "details": [the features the player asks for beyond the main thing, as short phrases],
 "style": a style, culture or theme the item should have ("viking", "steampunk", "royal") or null}
Rules:
- "fixed": correct typos only ("gree" -> "green", "drgon" -> "dragon", "smal" -> "small", "vikin" -> "viking"). Keep the player's words, order and language; never add, drop or reinterpret anything. If nothing is misspelled, return the request unchanged.
- "size": only when the player says a size (tiny / little count as small, big / huge / giant as large); else null.
- "colours": only colours the player says, read through typos; [] when none.
- "details": only what the player names; [] when it's just the main thing.`;

async function read(prompt: string): Promise<PromptRead> {
  if (!llmEnabled || !prompt) return local(prompt);
  try {
    const raw = await Promise.race([
      chatJSON<Record<string, unknown>>(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
        { temperature: 0, maxTokens: 250, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
      ),
      new Promise<null>((res) => setTimeout(() => res(null), READ_MS)),
    ]);
    return parseRead(raw, prompt) ?? local(prompt);
  } catch (err) {
    console.warn('[craft] reading the prompt failed, reading it locally:', err);
    return local(prompt);
  }
}

const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function parseRead(raw: Record<string, unknown> | null | undefined, prompt: string): PromptRead | null {
  if (!raw || typeof raw !== 'object') return null;
  // the fixed prompt: about as long as the original (so nothing was added),
  // else the original with the local fixes
  let fixed = str(raw.fixed, 200);
  const ow = words(prompt);
  const fw = words(fixed);
  if (!fixed || fw.length > ow.length + 2 || fw.length < ow.length - 2 || fixed.length > prompt.length * 1.5 + 10) fixed = fixTypos(prompt, isKnownWord).fixed;
  const sz = str(raw.size, 12).toLowerCase();
  const size: SizeClass | null = /^(small|tiny|little|mini)$/.test(sz) ? 'small' : /^(large|big|huge|giant)$/.test(sz) ? 'large' : sz === 'medium' ? 'medium' : null;
  const colours = (Array.isArray(raw.colours) ? raw.colours : [])
    .map((c) => (c && typeof c === 'object' ? { target: str((c as Record<string, unknown>).target, 40) || 'whole', colour: str((c as Record<string, unknown>).colour, 40) } : null))
    .filter((c): c is { target: string; colour: string } => !!c?.colour)
    .slice(0, 6);
  const details = (Array.isArray(raw.details) ? raw.details : []).map((d) => str(d, 40)).filter(Boolean).slice(0, 8);
  const style = str(raw.style, 30) || null;
  // which words changed (same word count: position by position)
  const fixes: [string, string][] = [];
  const typed = prompt.match(/[\p{L}\p{N}]+/gu) ?? [];
  const read = fixed.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (typed.length === read.length) typed.forEach((w, i) => w.toLowerCase() !== read[i].toLowerCase() && fixes.push([w, read[i]]));
  return { fixed, size, colours, details, style, fixes, via: 'model' };
}
