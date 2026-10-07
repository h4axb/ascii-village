// ---------------------------------------------------------------------------
// GLYPH GENERATOR — a dev tool (pnpm ref), not part of the game.
//
//   1 Import   drop a ZIP, single PNGs or a folder (up to 20 per batch). Each
//              image is cleaned (background removed, cropped, photos turned
//              into pixel art) and auto-marked: parts, anchors, decoration and
//              detail areas (src/glyph/refs.ts).
//   2 Markers  fix or add marks per image: fill a colour area with a part,
//              paint / erase, place anchors, draw areas.
//   3 Glyphs   bake the selected images at a sign count; check the combined
//              result as the game draws it and the split into components
//              (each part its own colour); then send the selected ones to the
//              world editor's assets or to the crafting library.
//
// Work in progress is autosaved to refs/work/ (survives a reload). No LLM is
// needed except the optional auto-marking call (one per image).
// ---------------------------------------------------------------------------
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bake, DEFAULTS, SIGN_PRESETS, hex, type Baked, type BakeOptions, type Img } from '../../src/glyph/bake';
import { buildAtlas, GAME_FONT } from '../../src/glyph/atlas';
import { cellParts, bakedToSprite } from '../../src/glyph/sprite';
import { decodeMask, encodeMask, ZONES, GAME_CATEGORIES, type RefArea, type RefPart, type Zone, type GameCategory, type RefRole } from '../../src/glyph/refs';
import { readZipImages } from './zip';
import { clean, imageFromBlob, imgToDataUrl, imgFromDataUrl } from './clean';
import { aiAvailable, autoMark, colourZones, emptyMarks, hintFromPath, segments, VOCAB, type Hint, type Marks } from './automark';
import { toGameAsset, toRefDoc, toSvg } from './exportSvg';
import './style.css';

const MAX_BATCH = 20;
const IMG_RE = /\.(png|webp|jpe?g|gif)$/i;
const PART_COLORS = ['#ff5f5f', '#5fa8ff', '#5fdc7a', '#ffc94d', '#c77dff', '#4de1d2', '#ff8fd0', '#b0b0b0', '#ff9f43', '#9fe870', '#7d8bff', '#e0e0a0'];
const GRASS = '#afc765';
const SHEET_BG = '#16100d';

type Status = 'queued' | 'cleaning' | 'marking' | 'ready' | 'flagged' | 'error';
interface Item {
  id: string;
  name: string;
  path: string;
  status: Status;
  note?: string;
  photo?: boolean;
  pixelized?: boolean;
  art?: Img;
  marks?: Marks;
  markSource?: 'ai' | 'zones';
  opts: BakeOptions;
  asset: { kind: 'boulder' | 'decor'; scale: number };
  selected: boolean;
  sent: { asset?: string; ref?: string };
}
interface SavedItem extends Omit<Item, 'art' | 'marks'> {
  artUrl?: string;
  marks?: Omit<Marks, 'mask'> & { mask: number[] };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ref';
const uid = () => Math.random().toString(36).slice(2, 10);
const darkenRgb = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  const d = (v: number) => Math.round(v * 0.45);
  return `rgb(${d(n >> 16)},${d((n >> 8) & 255)},${d(n & 255)})`;
};
const partColor = (i: number) => PART_COLORS[i % PART_COLORS.length];

// ---- autosave ---------------------------------------------------------------------------
function serialize(it: Item): SavedItem {
  const { art, marks, ...rest } = it;
  return { ...rest, artUrl: art ? imgToDataUrl(art) : undefined, marks: marks ? { ...marks, mask: encodeMask(marks.mask) } : undefined };
}
async function deserialize(s: SavedItem): Promise<Item> {
  const art = s.artUrl ? await imgFromDataUrl(s.artUrl) : undefined;
  const { artUrl: _a, marks, ...rest } = s;
  return {
    ...rest,
    opts: { ...DEFAULTS, ...rest.opts, bg: 'alpha' },
    art,
    marks: marks && art ? { ...marks, mask: decodeMask(marks.mask, art.w * art.h) } : undefined,
    status: rest.status === 'cleaning' || rest.status === 'marking' || rest.status === 'queued' ? (art ? 'ready' : 'error') : rest.status,
  };
}

// ---- quality gate: every named part must still show at the simple sign count -----------
function qualityNote(it: Item, atlas: ReturnType<typeof buildAtlas>): string | undefined {
  if (!it.art || !it.marks) return undefined;
  if (!it.marks.parts.length) return 'no parts marked';
  if (it.marks.role === 'decoration') return undefined; // meant to be small
  const b = bake(it.art, { ...it.opts, bg: 'alpha', signs: SIGN_PRESETS[0].signs }, atlas);
  const cp = cellParts(b, partNames(it), it.art.w, it.art.h);
  const thin = it.marks.parts.filter((p) => cp.filter((c) => c === p.name).length < 3).map((p) => p.name);
  return thin.length ? `too small to read at ${SIGN_PRESETS[0].name}: ${thin.join(', ')}` : undefined;
}
const partNames = (it: Item): string[] => Array.from(it.marks!.mask, (v, i) => (it.art!.data[i * 4 + 3] ? (v ? it.marks!.parts[v - 1]?.name ?? 'other' : 'other') : ''));

// ---- views ------------------------------------------------------------------------------
function Thumb({ img, size = 56 }: { img?: Img; size?: number }) {
  const url = useMemo(() => (img ? imgToDataUrl(img) : ''), [img]);
  return <div className="thumb" style={{ width: size, height: size }}>{url && <img src={url} />}</div>;
}

// the game look: columns doubled, rows stretched, a backing of each cell's
// own colour at 45%, on grass; `only` shows one part, `tint` colours by part
function GlyphCanvas({ b, line, mode, cellPart, colorOf, only }: { b: Baked; line: number; mode: 'game' | 'sheet'; cellPart?: string[]; colorOf?: (p: string) => string; only?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.font = `${line}px ${GAME_FONT}`;
    const charW = ctx.measureText('M').width;
    const game = mode === 'game';
    const NR = game ? Math.max(1, Math.round(b.rows * 1.22)) : b.rows;
    const cw = game ? charW : line, chW = game ? 2 : 1;
    const pad = line * 1.5;
    const W = Math.ceil(b.cols * chW * cw + pad * 2), H = Math.ceil(NR * line + pad * 2);
    cv.width = W;
    cv.height = H;
    ctx.fillStyle = game ? GRASS : SHEET_BG;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${line * (game ? 1 : 0.8)}px ${GAME_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let rr = 0; rr < NR; rr++) {
      const r = game ? Math.floor((rr * b.rows) / NR) : rr;
      const y0 = Math.floor(pad + rr * line), y1 = Math.floor(pad + (rr + 1) * line);
      for (let c = 0; c < b.cols * chW; c++) {
        const idx = r * b.cols + (game ? c >> 1 : c);
        const cell = b.cells[idx];
        if (!cell) continue;
        const p = cellPart?.[idx] ?? '';
        if (only && p !== only) continue;
        const x0 = Math.floor(pad + c * cw), x1 = Math.floor(pad + (c + 1) * cw);
        const h = colorOf ? colorOf(p) : hex(cell.rgb);
        ctx.fillStyle = game || colorOf ? darkenRgb(h) : SHEET_BG;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = h;
        ctx.fillText(cell.ch, (x0 + x1) / 2, (y0 + y1) / 2);
      }
    }
  }, [b, line, mode, cellPart, colorOf, only]);
  return <canvas ref={ref} className="glyphs" />;
}

// ---- the marker editor ------------------------------------------------------------------
type Tool = 'fill' | 'paint' | 'erase' | 'anchor' | 'decoration' | 'detail';
function MarkerEditor({ it, onChange }: { it: Item; onChange: (m: Marks) => void }) {
  const art = it.art!, m = it.marks!;
  const [tool, setTool] = useState<Tool>('fill');
  const [part, setPart] = useState(0);
  const [brush, setBrush] = useState(3);
  const [zoom, setZoom] = useState(() => Math.max(3, Math.floor(520 / Math.max(art.w, art.h))));
  const [anchorSel, setAnchorSel] = useState<string | null>(null);
  const [areaSel, setAreaSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const seg = useMemo(() => segments(art), [art]);
  const ref = useRef<HTMLCanvasElement>(null);
  const cat = VOCAB.categories[m.category];
  const vocabParts = cat?.parts ?? [];

  useEffect(() => {
    const cv = ref.current!;
    const W = art.w * zoom, H = art.h * zoom;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // checkerboard, art, part tint
    for (let y = 0; y < H; y += 12) for (let x = 0; x < W; x += 12) {
      ctx.fillStyle = ((x + y) / 12) % 2 ? '#262626' : '#1e1e1e';
      ctx.fillRect(x, y, 12, 12);
    }
    const tmp = document.createElement('canvas');
    tmp.width = art.w;
    tmp.height = art.h;
    const id = new ImageData(new Uint8ClampedArray(art.data), art.w, art.h);
    for (let i = 0; i < art.w * art.h; i++) {
      const v = m.mask[i];
      if (!v || !id.data[i * 4 + 3]) continue;
      const pc = parseInt(partColor(v - 1).slice(1), 16);
      const a = v - 1 === part ? 0.55 : 0.35;
      id.data[i * 4] = id.data[i * 4] * (1 - a) + (pc >> 16) * a;
      id.data[i * 4 + 1] = id.data[i * 4 + 1] * (1 - a) + ((pc >> 8) & 255) * a;
      id.data[i * 4 + 2] = id.data[i * 4 + 2] * (1 - a) + (pc & 255) * a;
    }
    tmp.getContext('2d')!.putImageData(id, 0, 0);
    ctx.drawImage(tmp, 0, 0, W, H);
    // part borders
    ctx.fillStyle = '#ffffffaa';
    for (let y = 0; y < art.h; y++)
      for (let x = 0; x < art.w; x++) {
        const v = m.mask[y * art.w + x];
        if (x + 1 < art.w && m.mask[y * art.w + x + 1] !== v) ctx.fillRect((x + 1) * zoom - 0.5, y * zoom, 1, zoom);
        if (y + 1 < art.h && m.mask[(y + 1) * art.w + x] !== v) ctx.fillRect(x * zoom, (y + 1) * zoom - 0.5, zoom, 1);
      }
    // areas and anchors
    ctx.lineWidth = 2;
    ctx.font = '12px sans-serif';
    [...m.areas, ...(draft ? [{ ...draft, name: '', type: tool === 'detail' ? 'detail' : 'decoration' } as RefArea] : [])].forEach((a, i) => {
      ctx.strokeStyle = a.type === 'detail' ? '#4de1d2' : '#ffd34d';
      ctx.setLineDash(i === areaSel ? [] : [6, 4]);
      ctx.strokeRect(a.x * W, a.y * H, a.w * W, a.h * H);
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      if (a.name) ctx.fillText(`${a.type === 'detail' ? '✎' : '★'} ${a.name}`, a.x * W + 3, a.y * H + 13);
    });
    for (const a of m.anchors) {
      ctx.fillStyle = a.name === anchorSel ? '#ffffff' : '#ff4df0';
      ctx.beginPath();
      ctx.arc(a.x * W, a.y * H, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(a.name, a.x * W + 8, a.y * H - 7);
    }
  }, [art, m, zoom, part, draft, anchorSel, areaSel, tool]);

  const set = (patch: Partial<Marks>) => onChange({ ...m, ...patch });
  const at = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(0.9999, (ev.clientX - r.left) / r.width)), y: Math.max(0, Math.min(0.9999, (ev.clientY - r.top) / r.height)) };
  };
  function paint(p: { x: number; y: number }, v: number) {
    const mask = m.mask.slice();
    const cx = p.x * art.w, cy = p.y * art.h;
    for (let y = Math.floor(cy - brush); y <= Math.ceil(cy + brush); y++)
      for (let x = Math.floor(cx - brush); x <= Math.ceil(cx + brush); x++) {
        if (x < 0 || y < 0 || x >= art.w || y >= art.h) continue;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > brush * brush) continue;
        if (art.data[(y * art.w + x) * 4 + 3]) mask[y * art.w + x] = v;
      }
    set({ mask });
  }
  function onPointer(kind: 'down' | 'move' | 'up', ev: React.PointerEvent<HTMLCanvasElement>) {
    const p = at(ev);
    if (tool === 'fill' && kind === 'down') {
      if (!m.parts[part]) return;
      const s = seg[Math.floor(p.y * art.h) * art.w + Math.floor(p.x * art.w)];
      if (s < 0) return;
      const mask = m.mask.slice();
      for (let i = 0; i < mask.length; i++) if (seg[i] === s) mask[i] = part + 1;
      set({ mask });
    } else if ((tool === 'paint' || tool === 'erase') && kind !== 'up' && ev.buttons & 1) {
      if (tool === 'paint' && !m.parts[part]) return;
      paint(p, tool === 'erase' ? 0 : part + 1);
    } else if (tool === 'anchor' && kind === 'down') {
      const name = anchorSel ?? window.prompt('Anchor name: a part name where a swapped part attaches (sail, flag …), or "attach" for this picture\'s own fixing point', vocabParts[0] ?? 'attach')?.trim();
      if (!name) return;
      set({ anchors: [...m.anchors.filter((a) => a.name !== name), { name, x: p.x, y: p.y }] });
      setAnchorSel(null);
    } else if (tool === 'decoration' || tool === 'detail') {
      if (kind === 'down') start.current = p;
      const s0 = start.current;
      if (!s0) return;
      const r = { x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) };
      if (kind === 'move') setDraft(r);
      if (kind === 'up') {
        start.current = null;
        setDraft(null);
        if (r.w < 0.03 || r.h < 0.03) return;
        if (areaSel != null) {
          set({ areas: m.areas.map((a, i) => (i === areaSel ? { ...a, ...r } : a)) });
          setAreaSel(null);
          return;
        }
        const name = window.prompt(tool === 'detail' ? 'Detail area name (a painted motif goes here)' : 'Decoration area name', `${tool}${m.areas.length + 1}`)?.trim();
        if (!name) return;
        const accepts = tool === 'decoration' ? (window.prompt('Decorations it suits (comma separated)', 'flag, gem, flower') ?? '').split(',').map((t) => t.trim()).filter(Boolean) : [];
        const under = m.mask[Math.floor((r.y + r.h / 2) * art.h) * art.w + Math.floor((r.x + r.w / 2) * art.w)];
        set({ areas: [...m.areas, { name, type: tool, ...r, accepts, ...(tool === 'detail' && under ? { part: m.parts[under - 1].name } : {}) }] });
      }
    }
  }

  const counts = useMemo(() => {
    const c = new Array(m.parts.length).fill(0);
    for (const v of m.mask) if (v) c[v - 1]++;
    return c;
  }, [m]);

  return (
    <div className="editor">
      <div className="editor-canvas">
        <div className="row">
          {(['fill', 'paint', 'erase', 'anchor', 'decoration', 'detail'] as Tool[]).map((t) => (
            <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={TOOL_HELP[t]}>
              {TOOL_LABEL[t]}
            </button>
          ))}
          {(tool === 'paint' || tool === 'erase') && (
            <label className="inline">
              brush <input type="range" min={1} max={12} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
            </label>
          )}
          <label className="inline">
            zoom <input type="range" min={2} max={12} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
        </div>
        <p className="dim help">{TOOL_HELP[tool]}</p>
        <canvas
          ref={ref}
          className="markcanvas"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            onPointer('down', e);
          }}
          onPointerMove={(e) => onPointer('move', e)}
          onPointerUp={(e) => onPointer('up', e)}
        />
      </div>
      <div className="editor-side">
        <h3>About it</h3>
        <label className="field">
          <span>title</span>
          <input value={m.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>role</span>
            <select value={m.role} onChange={(e) => set({ role: e.target.value as RefRole })}>
              <option value="body">body (whole object)</option>
              <option value="part">part (swappable)</option>
              <option value="decoration">decoration</option>
            </select>
          </label>
          <label className="field">
            <span>category</span>
            <select value={m.category} onChange={(e) => set({ category: e.target.value, gameCategory: VOCAB.categories[e.target.value]?.gameCategory ?? m.gameCategory })}>
              <option value="">—</option>
              {Object.keys(VOCAB.categories).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {m.role === 'part' && (
            <label className="field">
              <span>replaces part</span>
              <input list="vocab-parts" value={m.partType} onChange={(e) => set({ partType: slug(e.target.value) })} />
            </label>
          )}
          <label className="field">
            <span>game category</span>
            <select value={m.gameCategory} onChange={(e) => set({ gameCategory: e.target.value as GameCategory })}>
              {GAME_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>size</span>
            <select value={m.sizeBand} onChange={(e) => set({ sizeBand: e.target.value as Marks['sizeBand'] })}>
              <option>small</option>
              <option>medium</option>
              <option>large</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>tags</span>
          <input value={m.tags.join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
        </label>
        <label className="field">
          <span>description</span>
          <input value={m.description} onChange={(e) => set({ description: e.target.value })} />
        </label>

        <h3>Parts</h3>
        <datalist id="vocab-parts">
          {vocabParts.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {m.parts.map((p, i) => (
          <div key={i} className={'part' + (i === part ? ' on' : '')} onClick={() => setPart(i)}>
            <span className="swatch" style={{ background: partColor(i) }} />
            <input list="vocab-parts" value={p.name} onChange={(e) => set({ parts: m.parts.map((q, j) => (j === i ? { ...q, name: slug(e.target.value) } : q)) })} />
            <select value={p.zone} onChange={(e) => set({ parts: m.parts.map((q, j) => (j === i ? { ...q, zone: e.target.value as Zone } : q)) })}>
              {ZONES.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
            <span className="dim count">{counts[i]}</span>
            <button
              title="remove this part (its pixels become unmarked)"
              onClick={(e) => {
                e.stopPropagation();
                set({ parts: m.parts.filter((_, j) => j !== i), mask: m.mask.map((v) => (v === i + 1 ? 0 : v > i + 1 ? v - 1 : v)) });
                setPart(0);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <button
            onClick={() => {
              const used = new Set(m.parts.map((p) => p.name));
              const name = vocabParts.find((p) => !used.has(p)) ?? `part${m.parts.length + 1}`;
              set({ parts: [...m.parts, { name, zone: 'primary' } as RefPart] });
              setPart(m.parts.length);
              setTool('fill');
            }}
          >
            + part
          </button>
          <button onClick={() => window.confirm('Replace all parts with colour zones?') && set(colourZones(art))}>colour zones</button>
        </div>

        <h3>Anchors</h3>
        {m.anchors.map((a) => (
          <div key={a.name} className={'item' + (a.name === anchorSel ? ' on' : '')}>
            <span onClick={() => { setAnchorSel(a.name); setTool('anchor'); }} title="click, then click the picture to move it">● {a.name}</span>
            <button onClick={() => set({ anchors: m.anchors.filter((x) => x !== a) })}>✕</button>
          </div>
        ))}
        <h3>Areas</h3>
        {m.areas.map((a, i) => (
          <div key={i} className={'item' + (i === areaSel ? ' on' : '')}>
            <span onClick={() => { setAreaSel(i); setTool(a.type); }} title="click, then drag on the picture to redraw it">
              {a.type === 'detail' ? '✎' : '★'} {a.name}
            </span>
            {a.type === 'decoration' ? (
              <input value={a.accepts.join(', ')} title="decorations it suits" onChange={(e) => set({ areas: m.areas.map((x, j) => (j === i ? { ...x, accepts: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } : x)) })} />
            ) : (
              <select value={a.part ?? ''} title="drawn only on this part" onChange={(e) => set({ areas: m.areas.map((x, j) => (j === i ? { ...x, part: e.target.value || undefined } : x)) })}>
                <option value="">any part</option>
                {m.parts.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            )}
            <button onClick={() => set({ areas: m.areas.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
const TOOL_LABEL: Record<Tool, string> = { fill: 'fill area', paint: 'paint', erase: 'erase', anchor: 'anchor', decoration: '★ deco area', detail: '✎ detail area' };
const TOOL_HELP: Record<Tool, string> = {
  fill: 'Click a colour area of the picture to give it the selected part (fastest way to fix a split).',
  paint: 'Drag to paint the selected part.',
  erase: 'Drag to unmark pixels.',
  anchor: 'Click to place an anchor (where a swapped part attaches; "attach" = this picture\'s own fixing point). Select one in the list first to move it.',
  decoration: 'Drag a box where a decoration (flag, gem …) may be added. Select one in the list first to redraw it.',
  detail: 'Drag a box where a detail with no reference may be painted (a skull on a sail). Select one in the list first to redraw it.',
};

// ---- the page --------------------------------------------------------------------------------
function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [tab, setTab] = useState<'import' | 'markers' | 'glyphs'>('import');
  const [ai, setAi] = useState(false);
  const [useAi, setUseAi] = useState(true);
  const [pixelize, setPixelize] = useState<'auto' | 'on' | 'off'>('auto');
  const [bgTol, setBgTol] = useState(40);
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'combined' | 'components'>('combined');
  const [solo, setSolo] = useState<string | null>(null);
  const [line, setLine] = useState(11);
  const [generated, setGenerated] = useState<Set<string>>(new Set());
  const atlas = useMemo(() => buildAtlas(DEFAULTS.ramp + DEFAULTS.edgeGlyphs), []);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // load the batch in progress, and whether auto-marking can use a model
  useEffect(() => {
    void aiAvailable().then((ok) => {
      setAi(ok);
      setUseAi(ok);
    });
    void fetch('/__ref/work')
      .then((r) => r.json())
      .then(async (saved: SavedItem[]) => {
        const loaded = await Promise.all(saved.map(deserialize));
        setItems(loaded);
        if (loaded[0]) setCur(loaded[0].id);
      });
  }, []);

  // autosave changed items (debounced)
  const dirty = useRef(new Set<string>());
  const saveTimer = useRef<number | null>(null);
  const update = useCallback((id: string, patch: Partial<Item> | ((it: Item) => Partial<Item>)) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) } : it)));
    dirty.current.add(id);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      for (const d of dirty.current) {
        const it = itemsRef.current.find((x) => x.id === d);
        if (it) void fetch('/__ref/work', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d, item: serialize(it) }) });
      }
      dirty.current.clear();
    }, 600);
  }, []);

  // ---- import: files -> queued items -> cleaned -> auto-marked (all in parallel) ----
  async function addFiles(entries: { path: string; blob: Blob }[]) {
    const room = MAX_BATCH - itemsRef.current.length;
    const take = entries.filter((e) => IMG_RE.test(e.path)).slice(0, Math.max(0, room));
    const skipped = entries.length - take.length;
    if (skipped > 0) setStatus(`a batch holds ${MAX_BATCH} images: ${skipped} skipped. Send or remove some, then add the rest.`);
    const fresh: Item[] = take.map((e) => ({
      id: uid(),
      name: e.path.split('/').pop()!.replace(IMG_RE, ''),
      path: e.path,
      status: 'queued',
      opts: { ...DEFAULTS, bg: 'alpha', fillHoles: false, signs: SIGN_PRESETS[1].signs },
      asset: { kind: 'boulder', scale: 0.26 },
      selected: true,
      sent: {},
    }));
    setItems((l) => [...l, ...fresh]);
    if (!cur && fresh[0]) setCur(fresh[0].id);
    await Promise.all(
      fresh.map(async (it, n) => {
        const e = take[n];
        try {
          update(it.id, { status: 'cleaning' });
          const im = await imageFromBlob(e.blob);
          const c = clean(im, { bgTolerance: bgTol, pixelize });
          const hint: Hint = hintFromPath(e.path);
          const base = emptyMarks(c.art.w, c.art.h, it.name.replace(/[-_]+/g, ' '), hint);
          update(it.id, { status: 'marking', art: c.art, photo: c.photo, pixelized: c.pixelized });
          const r = await autoMark(c.art, base, hint, useAi && ai);
          const done: Item = { ...it, art: c.art, marks: r.marks, markSource: r.source, photo: c.photo, pixelized: c.pixelized };
          const q = qualityNote(done, atlas);
          update(it.id, { marks: r.marks, markSource: r.source, status: q || r.note ? 'flagged' : 'ready', note: [r.note, q].filter(Boolean).join(' · ') || undefined });
        } catch (err) {
          update(it.id, { status: 'error', note: String(err) });
        }
      }),
    );
  }
  async function onFiles(files: File[]) {
    const entries: { path: string; blob: Blob }[] = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        try {
          for (const z of await readZipImages(f)) entries.push({ path: z.path, blob: z.blob });
        } catch (err) {
          setStatus(`${f.name}: ${String(err)}`);
        }
      } else entries.push({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, blob: f });
    }
    await addFiles(entries);
  }

  const it = items.find((x) => x.id === cur) ?? null;
  const selected = items.filter((x) => x.selected && x.art && x.marks);
  const remove = (ids: string[]) => {
    setItems((l) => l.filter((x) => !ids.includes(x.id)));
    for (const id of ids) void fetch('/__ref/work-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (cur && ids.includes(cur)) setCur(null);
  };
  const go = (d: number) => {
    const ready = items.filter((x) => x.art && x.marks);
    const i = ready.findIndex((x) => x.id === cur);
    if (ready.length) setCur(ready[(i + d + ready.length) % ready.length].id);
  };

  // ---- glyphs ----
  const baked = useMemo(() => {
    if (!it?.art || !it.marks || tab !== 'glyphs') return null;
    const b = bake(it.art, { ...it.opts, bg: 'alpha' }, atlas);
    return { b, parts: cellParts(b, partNames(it), it.art.w, it.art.h) };
  }, [it, tab, atlas]);
  const legend = useMemo(() => {
    if (!baked || !it?.marks) return [];
    const names = [...it.marks.parts.map((p) => p.name), 'other'];
    return names.map((n) => ({ name: n, cells: baked.parts.filter((p) => p === n).length })).filter((x) => x.cells > 0 || x.name !== 'other');
  }, [baked, it]);
  const colorOfPart = useCallback(
    (p: string) => {
      const i = it?.marks?.parts.findIndex((x) => x.name === p) ?? -1;
      return i >= 0 ? partColor(i) : '#777777';
    },
    [it],
  );

  async function send(target: 'asset' | 'ref') {
    const list = selected;
    if (!list.length) return setStatus('select images first (the checkboxes)');
    const done: string[] = [];
    for (const x of list) {
      const m = x.marks!, art = x.art!;
      const id = `${slug(m.category || 'ref')}-${slug(m.title || x.name)}`;
      const post = async (overwrite: boolean) => {
        if (target === 'asset') {
          const b = bake(art, { ...x.opts, bg: 'alpha' }, atlas);
          return fetch('/__ref/send-asset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: id, asset: toGameAsset(m, `${x.path} (Glyph Generator)`, b, x.asset.kind, x.asset.scale), overwrite }) });
        }
        return fetch('/__ref/send-ref', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ref: toRefDoc(id, m, art.w, art.h), art: imgToDataUrl(art), overwrite }) });
      };
      let r = await post(false);
      if (r.status === 409) {
        const d = await r.json();
        if (!window.confirm(`${d.file} already exists. Overwrite it?`)) continue;
        r = await post(true);
      }
      const d = await r.json();
      if (!r.ok) {
        setStatus(`${x.name}: ${d.error}`);
        continue;
      }
      update(x.id, (old) => ({ sent: { ...old.sent, [target]: d.saved } }));
      done.push(d.saved);
    }
    setStatus(`${target === 'asset' ? 'sent to the editor assets (reload the game to see them under New)' : 'sent to the crafting library'}: ${done.join(', ') || 'nothing'}`);
  }

  function downloadSvg() {
    if (!it || !baked || !it.marks) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toSvg(slug(it.marks.title), baked.b, baked.parts, it.marks)], { type: 'image/svg+xml' }));
    a.download = `${slug(it.marks.title || it.name)}.svg`;
    a.click();
  }

  const counts = {
    busy: items.filter((x) => x.status === 'queued' || x.status === 'cleaning' || x.status === 'marking').length,
    ready: items.filter((x) => x.status === 'ready').length,
    flagged: items.filter((x) => x.status === 'flagged').length,
  };

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void onFiles([...e.dataTransfer.files]);
      }}
    >
      <aside className="batch">
        <h1>Glyph Generator</h1>
        <div className="dim">
          {items.length}/{MAX_BATCH} · {counts.ready} ready · {counts.flagged} flagged{counts.busy ? ` · ${counts.busy} working` : ''}
        </div>
        <div className="row">
          <button onClick={() => setItems((l) => l.map((x) => ({ ...x, selected: true })))}>all</button>
          <button onClick={() => setItems((l) => l.map((x) => ({ ...x, selected: false })))}>none</button>
          <button className="danger" disabled={!items.some((x) => x.selected)} onClick={() => window.confirm('Remove the selected images from the batch?') && remove(items.filter((x) => x.selected).map((x) => x.id))}>
            remove
          </button>
        </div>
        <ul className="cards">
          {items.map((x) => (
            <li key={x.id} className={'card ' + x.status + (x.id === cur ? ' on' : '')} onClick={() => setCur(x.id)}>
              <input type="checkbox" checked={x.selected} onClick={(e) => e.stopPropagation()} onChange={(e) => update(x.id, { selected: e.target.checked })} />
              <Thumb img={x.art} size={44} />
              <div className="meta">
                <div className="nm">{x.marks?.title || x.name}</div>
                <div className={'st ' + x.status}>
                  {x.status}
                  {x.markSource === 'zones' && x.status !== 'error' ? ' · zones' : ''}
                  {generated.has(x.id) ? ' · baked' : ''}
                </div>
                {(x.status === 'cleaning' || x.status === 'marking' || x.status === 'queued') && (
                  <div className="bar">
                    <div style={{ width: x.status === 'queued' ? '8%' : x.status === 'cleaning' ? '35%' : '75%' }} />
                  </div>
                )}
                {(x.sent.asset || x.sent.ref) && (
                  <div className="sent">
                    {x.sent.asset && <span title={x.sent.asset}>→ assets</span>} {x.sent.ref && <span title={x.sent.ref}>→ crafting</span>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        <nav className="tabs">
          {(
            [
              ['import', '1 Import'],
              ['markers', '2 Markers'],
              ['glyphs', '3 Glyphs'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
          <span className="status">{status}</span>
        </nav>

        {tab === 'import' && (
          <section className="import">
            <label className="drop">
              <b>Drop a ZIP, PNGs or a folder here</b>
              <span className="dim">or click to choose files · up to {MAX_BATCH} per batch · folders become hints (boat/sails/red.png = a sail for boats)</span>
              <input type="file" multiple accept="image/*,.zip" hidden onChange={(e) => e.target.files && void onFiles([...e.target.files])} />
            </label>
            <label className="btn">
              choose a folder…
              <input type="file" hidden {...({ webkitdirectory: '' } as object)} onChange={(e) => e.target.files && void onFiles([...e.target.files])} />
            </label>
            <div className="opts">
              <label className="check">
                <input type="checkbox" checked={useAi && ai} disabled={!ai} onChange={(e) => setUseAi(e.target.checked)} /> auto-mark parts with AI (one call per image)
                {!ai && <span className="dim"> · no VITE_LLM_API_KEY in .env: colour zones instead</span>}
              </label>
              <label className="row">
                <span>photos → pixel art</span>
                <select value={pixelize} onChange={(e) => setPixelize(e.target.value as typeof pixelize)}>
                  <option value="auto">auto (when it looks like a photo)</option>
                  <option value="on">always</option>
                  <option value="off">never</option>
                </select>
              </label>
              <label className="row">
                <span>background tolerance</span>
                <input type="range" min={0} max={120} value={bgTol} onChange={(e) => setBgTol(Number(e.target.value))} /> <span className="dim">{bgTol}</span>
              </label>
            </div>
            <div className="grid">
              {items.map((x) => (
                <div key={x.id} className={'tile ' + x.status} onClick={() => { setCur(x.id); if (x.marks) setTab('markers'); }}>
                  <Thumb img={x.art} size={120} />
                  <div className="nm">{x.marks?.title || x.name}</div>
                  <div className={'st ' + x.status}>{x.status}{x.pixelized ? ' · pixelized' : ''}</div>
                  {x.note && <div className="note">{x.note}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'markers' && (
          <section>
            {it?.art && it.marks ? (
              <>
                <div className="row head">
                  <button onClick={() => go(-1)}>‹ prev</button>
                  <b>{it.marks.title || it.name}</b>
                  <span className="dim">{it.path} · {it.art.w}×{it.art.h}px · marked by {it.markSource === 'ai' ? 'AI' : 'colour zones'}</span>
                  <button onClick={() => go(1)}>next ›</button>
                  <button
                    disabled={!ai}
                    title="run the AI marking again for this image"
                    onClick={async () => {
                      update(it.id, { status: 'marking' });
                      const r = await autoMark(it.art!, it.marks!, hintFromPath(it.path), true);
                      update(it.id, { marks: r.marks, markSource: r.source, status: r.note ? 'flagged' : 'ready', note: r.note });
                    }}
                  >
                    re-mark with AI
                  </button>
                  <button
                    className="primary"
                    disabled={!selected.length}
                    onClick={() => {
                      setGenerated(new Set(selected.map((x) => x.id)));
                      if (!it.selected && selected[0]) setCur(selected[0].id);
                      setTab('glyphs');
                    }}
                  >
                    Generate glyphs ({selected.length}) →
                  </button>
                </div>
                {it.note && <p className="note">{it.note}</p>}
                <MarkerEditor
                  it={it}
                  onChange={(m) => {
                    const q = qualityNote({ ...it, marks: m }, atlas);
                    update(it.id, { marks: m, status: q ? 'flagged' : 'ready', note: q });
                  }}
                />
              </>
            ) : (
              <p className="empty">Import images first, then pick one on the left.</p>
            )}
          </section>
        )}

        {tab === 'glyphs' && (
          <section>
            {it?.art && it.marks && baked ? (
              <>
                <div className="row head">
                  <button onClick={() => go(-1)}>‹ prev</button>
                  <b>{it.marks.title || it.name}</b>
                  <span className="counter">
                    <b>{baked.b.signs}</b> signs · {baked.b.cols}×{baked.b.rows}
                  </span>
                  <button onClick={() => go(1)}>next ›</button>
                  <span className="sp" />
                  <button className={view === 'combined' ? 'on' : ''} onClick={() => setView('combined')}>
                    combined
                  </button>
                  <button className={view === 'components' ? 'on' : ''} onClick={() => setView('components')}>
                    components
                  </button>
                </div>
                <div className="glyph-main">
                  <div className="glyph-views">
                    {view === 'combined' ? (
                      <>
                        <figure>
                          <figcaption>in game</figcaption>
                          <GlyphCanvas b={baked.b} line={line} mode="game" />
                        </figure>
                        <figure>
                          <figcaption>sheet (svg)</figcaption>
                          <GlyphCanvas b={baked.b} line={line + 4} mode="sheet" />
                        </figure>
                      </>
                    ) : (
                      <>
                        <figure>
                          <figcaption>each part its own colour{solo ? ` · only ${solo}` : ''}</figcaption>
                          <GlyphCanvas b={baked.b} line={line} mode="game" cellPart={baked.parts} colorOf={colorOfPart} only={solo} />
                        </figure>
                        <figure>
                          <figcaption>with the art's colours{solo ? ` · only ${solo}` : ''}</figcaption>
                          <GlyphCanvas b={baked.b} line={line} mode="game" cellPart={baked.parts} only={solo} />
                        </figure>
                      </>
                    )}
                  </div>
                  <div className="glyph-side">
                    {view === 'components' && (
                      <>
                        <h3>Parts (click to show alone)</h3>
                        {legend.map((l) => (
                          <div key={l.name} className={'legend' + (solo === l.name ? ' on' : '')} onClick={() => setSolo(solo === l.name ? null : l.name)}>
                            <span className="swatch" style={{ background: colorOfPart(l.name) }} />
                            <span>{l.name}</span>
                            <span className={l.cells < 3 ? 'warn' : 'dim'}>{l.cells} cells</span>
                          </div>
                        ))}
                        <button onClick={() => setTab('markers')}>← fix marks</button>
                      </>
                    )}
                    <h3>Signs</h3>
                    <div className="row">
                      {SIGN_PRESETS.map((p) => (
                        <button key={p.name} className={it.opts.signs === p.signs ? 'on' : ''} onClick={() => update(it.id, { opts: { ...it.opts, signs: p.signs } })}>
                          {p.name} · {p.signs}
                        </button>
                      ))}
                    </div>
                    <Slider label="target signs" value={it.opts.signs} min={50} max={3000} step={10} onChange={(v) => update(it.id, { opts: { ...it.opts, signs: v } })} />
                    <Slider label="edge contrast" value={it.opts.edgeContrast} min={10} max={200} step={5} onChange={(v) => update(it.id, { opts: { ...it.opts, edgeContrast: v } })} />
                    <Slider label="outline" value={it.opts.outline} min={0} max={0.8} step={0.05} onChange={(v) => update(it.id, { opts: { ...it.opts, outline: v } })} />
                    <Slider label="tones" value={it.opts.tones} min={2} max={62} step={1} onChange={(v) => update(it.id, { opts: { ...it.opts, tones: v } })} />
                    <Slider label="contrast" value={it.opts.contrast} min={0.5} max={2} step={0.05} onChange={(v) => update(it.id, { opts: { ...it.opts, contrast: v } })} />
                    <Slider label="saturation" value={it.opts.saturation} min={0} max={2} step={0.05} onChange={(v) => update(it.id, { opts: { ...it.opts, saturation: v } })} />
                    <Slider label="lift" value={it.opts.lift} min={0.6} max={1.8} step={0.05} onChange={(v) => update(it.id, { opts: { ...it.opts, lift: v } })} />
                    <label className="check">
                      <input type="checkbox" checked={it.opts.shapeMatch} onChange={(e) => update(it.id, { opts: { ...it.opts, shapeMatch: e.target.checked } })} /> glyphs follow edges
                    </label>
                    <label className="check" title="fill gaps the object surrounds (useful for leafy art; off keeps real see-through gaps)">
                      <input type="checkbox" checked={it.opts.fillHoles} onChange={(e) => update(it.id, { opts: { ...it.opts, fillHoles: e.target.checked } })} /> fill enclosed gaps
                    </label>
                    <div className="row">
                      <button onClick={() => { for (const x of selected) update(x.id, { opts: { ...it.opts } }); setStatus(`settings applied to ${selected.length} selected`); }}>apply to selected</button>
                      <button onClick={downloadSvg}>download .svg</button>
                    </div>
                    <Slider label="preview size" value={line} min={5} max={24} step={1} onChange={setLine} />

                    <h3>Send the selected ({selected.length})</h3>
                    <div className="grid2">
                      <label className="field">
                        <span>asset kind</span>
                        <select value={it.asset.kind} onChange={(e) => update(it.id, { asset: { ...it.asset, kind: e.target.value as 'boulder' | 'decor' } })}>
                          <option value="boulder">boulder (solid)</option>
                          <option value="decor">decor</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>scale</span>
                        <input type="number" step={0.01} min={0.05} max={2} value={it.asset.scale} onChange={(e) => update(it.id, { asset: { ...it.asset, scale: Number(e.target.value) } })} />
                      </label>
                    </div>
                    <button className="primary" disabled={!selected.length} onClick={() => void send('asset')}>
                      Send to editor assets
                    </button>
                    <button className="primary alt" disabled={!selected.length} onClick={() => void send('ref')}>
                      Send to crafting library
                    </button>
                    <p className="dim">
                      Assets: src/data/assets/&lt;category&gt;-&lt;title&gt;.json, under New in the world editor. Crafting: src/data/refs/&lt;id&gt;/ (art.png + ref.json), used by the in-game crafting.
                    </p>
                  </div>
                </div>
                <div className="strip">
                  {items
                    .filter((x) => generated.has(x.id) && x.art)
                    .map((x) => (
                      <div key={x.id} className={'tile small' + (x.id === cur ? ' on' : '')} onClick={() => setCur(x.id)}>
                        <input type="checkbox" checked={x.selected} onClick={(e) => e.stopPropagation()} onChange={(e) => update(x.id, { selected: e.target.checked })} />
                        <Thumb img={x.art} size={64} />
                        <div className="nm">{x.marks?.title || x.name}</div>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <p className="empty">Select images and press “Generate glyphs” in the Markers tab.</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="dim">{Number.isInteger(value) ? value : value.toFixed(2)}</span>
    </label>
  );
}

// keep the unused-but-exported helper referenced for tooling
void bakedToSprite;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
