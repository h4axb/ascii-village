// The outputs of a reference:
//   toSvg       the glyph sheet in the format of the existing references
//               (cat8_glyph.svg, pond3_blueberries.svg): one <text x y fill>
//               per 20px cell, grouped per part (<g data-part data-zone>),
//               anchors and areas as hidden markers
//   toGameAsset a src/data/assets/<slug>.json for the world editor
//   toRefDoc    a src/data/refs/<id>/ref.json for the crafting generator
import { hex, type Baked } from '../../src/glyph/bake';
import { GAME_FONT } from '../../src/glyph/atlas';
import { bakedToSprite } from '../../src/glyph/sprite';
import { encodeMask, type RefDoc } from '../../src/glyph/refs';
import type { Marks } from './automark';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CELL = 20;

export function toSvg(name: string, b: Baked, cellPart: string[], m: Marks): string {
  const groups = new Map<string, string[]>();
  b.cells.forEach((c, i) => {
    if (!c) return;
    const p = cellPart[i] || 'other';
    const x = (i % b.cols) * CELL + CELL / 2, y = ((i / b.cols) | 0) * CELL + CELL / 2;
    groups.set(p, [...(groups.get(p) ?? []), `      <text x="${x}" y="${y}" fill="${hex(c.rgb)}">${esc(c.ch)}</text>`]);
  });
  const W = b.cols * CELL, H = b.rows * CELL;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 2}" height="${H / 2}" role="img" aria-label="${esc(m.title)}, ${b.cols} by ${b.rows} glyphs" data-asset="${esc(name)}" data-signs="${b.signs}"` +
      ` data-role="${m.role}" data-category="${esc(m.category)}" data-tags="${esc(m.tags.join(','))}"` +
      ` data-anchors="${esc(JSON.stringify(m.anchors))}" data-areas="${esc(JSON.stringify(m.areas))}">`,
  );
  out.push(`  <title>${esc(m.title)}</title>`);
  out.push(`  <desc>${esc(`${m.description} ${b.signs} glyphs on ${b.cols} by ${b.rows} cells, baked by the Glyph Generator. Parts: ${m.parts.map((p) => `${p.name} (${p.zone})`).join(', ')}.`)}</desc>`);
  out.push(`  <style>\n    text { font-family: ${GAME_FONT.replace(/'/g, '"')};\n      font-size: 15px; text-anchor: middle; dominant-baseline: central; }\n  </style>`);
  out.push('  <rect width="100%" height="100%" fill="#16100d"/>');
  for (const [p, lines] of groups) {
    const zone = m.parts.find((x) => x.name === p)?.zone;
    out.push(`  <g id="${esc(p)}" data-part="${esc(p)}"${zone ? ` data-zone="${zone}"` : ''}>`, ...lines, '  </g>');
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

export function toGameAsset(m: Marks, source: string, b: Baked, kind: string, scale: number) {
  const g = bakedToSprite(b);
  return {
    generated: {
      source,
      transcribedBy: 'tools/glyph-ref',
      note: `Baked by the Glyph Generator without an LLM: ${b.signs} glyphs on ${b.cols} by ${b.rows} cells, columns doubled and rows stretched for the game's cell.`,
    },
    label: m.title,
    kind,
    scale,
    interactable: false,
    palette: g.palette,
    sprite: g.sprite,
    colors: g.colors,
  };
}

export function toRefDoc(id: string, m: Marks, w: number, h: number): RefDoc {
  return {
    version: 1,
    id,
    title: m.title,
    role: m.role,
    category: m.category,
    gameCategory: m.gameCategory,
    ...(m.role === 'part' && m.partType ? { partType: m.partType } : {}),
    tags: m.tags,
    description: m.description,
    sizeBand: m.sizeBand,
    w,
    h,
    parts: m.parts,
    mask: encodeMask(m.mask),
    anchors: m.anchors,
    areas: m.areas,
  };
}
