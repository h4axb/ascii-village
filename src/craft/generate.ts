// ---------------------------------------------------------------------------
// Sprite generation. The LLM does NOT draw ASCII directly (it's bad at 2D art);
// it returns an occupancy grid of 0/1 (a task it handles far better), and a
// deterministic renderer turns that shape into an outlined ASCII sprite. The
// chat function is injected so this stays provider-agnostic and testable.
// ---------------------------------------------------------------------------

import type { CraftSpec } from './spec';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export type ChatJSON = <T>(
  messages: ChatMessage[],
  opts?: { model?: string; temperature?: number; maxTokens?: number },
) => Promise<T>;

const GRID = { w: 9, h: 5 };

export function occupancyMessages(spec: CraftSpec): ChatMessage[] {
  const thing = [spec.base, spec.hybrid ? '+ ' + spec.hybrid : '', ...spec.shape]
    .filter(Boolean)
    .join(' ');
  return [
    {
      role: 'system',
      content:
        'You design tiny ASCII game sprites as an occupancy grid. Reply with JSON only: ' +
        `{"grid": rows}, where rows is exactly ${GRID.h} arrays of ${GRID.w} numbers, each 0 (empty) ` +
        'or 1 (part of the object). Draw a clear, centered, recognizable silhouette. No prose.',
    },
    { role: 'user', content: `Object: ${thing || 'thing'}. Grid: ${GRID.w} wide x ${GRID.h} tall.` },
  ];
}

// Outline glyph for a filled cell, chosen from which sides are empty.
function glyph(u: boolean, d: boolean, l: boolean, r: boolean): string {
  if (u && l) return ',';
  if (u && r) return '.';
  if (d && l) return '`';
  if (d && r) return "'";
  if (u) return '"';
  if (d) return '_';
  if (l) return '(';
  if (r) return ')';
  return '#';
}

// Deterministically render a 0/1 grid into an outlined ASCII sprite.
export function renderGrid(grid: number[][]): string[] {
  const h = grid.length;
  const w = Math.max(...grid.map((row) => row.length));
  const at = (y: number, x: number) => (y < 0 || y >= h || x < 0 || x >= w ? 0 : grid[y][x] ? 1 : 0);
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      if (!at(y, x)) {
        line += ' ';
        continue;
      }
      line += glyph(!at(y - 1, x), !at(y + 1, x), !at(y, x - 1), !at(y, x + 1));
    }
    out.push(line);
  }
  return out;
}

// Ask the model for a grid and render it. Returns null on any failure so the
// pipeline can retry or fall back.
export async function generateFromGrid(
  spec: CraftSpec,
  chat: ChatJSON,
  model?: string,
): Promise<string[] | null> {
  try {
    const res = await chat<{ grid: number[][] }>(occupancyMessages(spec), {
      model,
      temperature: 0.6,
      maxTokens: 220,
    });
    const grid = res?.grid;
    if (!Array.isArray(grid) || grid.length === 0) return null;
    const clean = grid.map((row) => (Array.isArray(row) ? row.map((v) => (v ? 1 : 0)) : []));
    if (clean.every((row) => row.every((v) => v === 0))) return null; // all empty
    return renderGrid(clean);
  } catch {
    return null;
  }
}

// Convenience: bind a chat function into a generator the pipeline can call.
export function makeLlmGenerator(chat: ChatJSON, model?: string) {
  return (spec: CraftSpec) => generateFromGrid(spec, chat, model);
}
