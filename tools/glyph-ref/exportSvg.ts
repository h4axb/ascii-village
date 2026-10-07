// The outputs:
//   <name>.svg   the glyph sheet in the format of the existing references
//                (cat8_glyph.svg, pond3_blueberries.svg): one <text x y fill>
//                per 20px cell, grouped per part (<g data-part data-zone>),
//                anchors and slots as hidden markers and data attributes;
//   <name>.json  the same marks plus the bake settings, for the crafting
//                generator and for re-baking;
//   <name>.asset.json  a game asset (src/data/assets/ format): columns doubled,
//                rows stretched for the game's cell, part masks per row.
import { hex, type Baked, type BakeOptions } from './bake';
import { partsOfCells, type Marks } from './marks';
import { GAME_FONT } from './glyphAtlas';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CELL = 20;

export function toSvg(name: string, title: string, b: Baked, m: Marks): string {
  const owner = partsOfCells(b, m);
  const groups = new Map<number, string[]>(); // -1 = no part
  b.cells.forEach((c, i) => {
    if (!c) return;
    const p = owner[i] ?? -1;
    const x = (i % b.cols) * CELL + CELL / 2, y = ((i / b.cols) | 0) * CELL + CELL / 2;
    const arr = groups.get(p) ?? [];
    arr.push(`      <text x="${x}" y="${y}" fill="${hex(c.rgb)}">${esc(c.ch)}</text>`);
    groups.set(p, arr);
  });
  const W = b.cols * CELL, H = b.rows * CELL;
  const anchors = m.anchors.map((a) => ({ name: a.name, col: Math.min(b.cols - 1, Math.floor(a.x * b.cols)), row: Math.min(b.rows - 1, Math.floor(a.y * b.rows)) }));
  const slots = m.slots.map((s) => ({
    name: s.name,
    col: Math.floor(s.x * b.cols),
    row: Math.floor(s.y * b.rows),
    cols: Math.max(1, Math.round(s.w * b.cols)),
    rows: Math.max(1, Math.round(s.h * b.rows)),
    accepts: s.accepts,
  }));
  const partDesc = m.parts.length ? ` Parts: ${m.parts.map((p) => `${p.name} (${p.zone})`).join(', ')}; each in <g data-part>.` : '';
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 2}" height="${H / 2}" role="img" aria-label="${esc(title)}, ${b.cols} by ${b.rows} glyphs" data-asset="${esc(name)}" data-signs="${b.signs}"` +
      ` data-category="${esc(m.category)}" data-size-band="${m.sizeBand}" data-tags="${esc(m.tags.join(','))}"` +
      ` data-anchors="${esc(JSON.stringify(anchors))}" data-slots="${esc(JSON.stringify(slots))}">`,
  );
  out.push(`  <title>${esc(title)}</title>`);
  out.push(`  <desc>${esc(`${title}: ${b.signs} glyphs on a ${b.cols} by ${b.rows} grid, baked by tools/glyph-ref.${partDesc}`)}</desc>`);
  out.push(`  <style>\n    text { font-family: ${GAME_FONT.replace(/'/g, '"')};\n      font-size: 15px; text-anchor: middle; dominant-baseline: central; }\n  </style>`);
  out.push('  <rect width="100%" height="100%" fill="#16100d"/>');
  const order = [...groups.keys()].sort((a, c) => a - c);
  for (const p of order) {
    const part = p >= 0 ? m.parts[p] : null;
    const id = part ? part.name.replace(/[^\w-]/g, '-') : 'other';
    out.push(`  <g id="${esc(id)}" data-part="${esc(part ? part.name : 'other')}"${part ? ` data-zone="${part.zone}"` : ''}>`);
    out.push(...groups.get(p)!);
    out.push('  </g>');
  }
  if (anchors.length) {
    out.push('  <g id="anchors" display="none">');
    for (const a of anchors) out.push(`    <circle data-anchor="${esc(a.name)}" cx="${a.col * CELL + CELL / 2}" cy="${a.row * CELL + CELL / 2}" r="4"/>`);
    out.push('  </g>');
  }
  if (slots.length) {
    out.push('  <g id="slots" display="none">');
    for (const s of slots)
      out.push(`    <rect data-slot="${esc(s.name)}" data-accepts="${esc(s.accepts.join(','))}" x="${s.col * CELL}" y="${s.row * CELL}" width="${s.cols * CELL}" height="${s.rows * CELL}"/>`);
    out.push('  </g>');
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

const KEYS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// A src/data/assets/<slug>.json: columns doubled, rows stretched by `stretch`
// (a drawn game cell is ~1.22x wider than tall), one key per tone.
export function toGameAsset(label: string, source: string, b: Baked, m: Marks, stretch: number, kind: string, scale: number) {
  const owner = partsOfCells(b, m);
  const tones = [...new Set(b.cells.filter(Boolean).map((c) => hex(c!.rgb)))];
  const key = new Map(tones.map((t, i) => [t, KEYS[i]]));
  const NR = Math.max(1, Math.round(b.rows * stretch));
  const rowOf = Array.from({ length: NR }, (_, i) => Math.floor((i * b.rows) / NR));
  const sprite: string[] = [], colors: string[] = [];
  const parts: Record<string, string[]> = {};
  for (const p of m.parts) parts[p.name] = [];
  for (const r of rowOf) {
    let s = '', k = '';
    const pr: Record<string, string> = Object.fromEntries(m.parts.map((p) => [p.name, '']));
    for (let c = 0; c < b.cols; c++) {
      const cell = b.cells[r * b.cols + c];
      s += cell ? cell.ch + cell.ch : '  ';
      k += cell ? key.get(hex(cell.rgb))!.repeat(2) : '  ';
      const o = owner[r * b.cols + c];
      for (const p of m.parts) pr[p.name] += o != null && m.parts[o] === p ? '##' : '  ';
    }
    const n = s.trimEnd().length;
    sprite.push(s.slice(0, n));
    colors.push(k.slice(0, n));
    for (const p of m.parts) parts[p.name].push(pr[p.name].trimEnd());
  }
  const asGame = (x: number, y: number) => ({ col: Math.floor(x * b.cols) * 2, row: Math.floor(y * NR) });
  return {
    generated: {
      source,
      transcribedBy: 'tools/glyph-ref',
      note: `Baked from ${source} without an LLM: ${b.signs} glyphs on ${b.cols} by ${b.rows} cells, columns doubled and rows stretched ${stretch}x for the game's cell.`,
    },
    label,
    kind,
    scale,
    interactable: false,
    palette: Object.fromEntries(tones.map((t) => [key.get(t)!, t])),
    sprite,
    colors,
    ...(m.parts.length ? { parts: Object.fromEntries(m.parts.map((p) => [p.name, { zone: p.zone, mask: parts[p.name] }])) } : {}),
    ...(m.anchors.length ? { anchors: Object.fromEntries(m.anchors.map((a) => [a.name, asGame(a.x, a.y)])) } : {}),
    ...(m.slots.length
      ? { slots: m.slots.map((s) => ({ name: s.name, accepts: s.accepts, ...asGame(s.x, s.y), cols: Math.max(1, Math.round(s.w * b.cols)) * 2, rows: Math.max(1, Math.round(s.h * NR)) })) }
      : {}),
    ...(m.tags.length || m.category ? { ref: { tags: m.tags, category: m.category, sizeBand: m.sizeBand } } : {}),
  };
}

export function toRefJson(name: string, source: string, o: BakeOptions, b: Baked, m: Marks) {
  return { name, source, settings: o, grid: { cols: b.cols, rows: b.rows, signs: b.signs }, marks: m };
}
