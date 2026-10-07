// ---------------------------------------------------------------------------
// GLYPH REF MAKER — a dev tool (pnpm ref), not part of the game.
//
// Drop a PNG, tune the bake until it reads well at the game's size, mark its
// parts / anchors / decoration slots, and save: a glyph-sheet SVG in the
// format of the existing references, a JSON with the marks, and optionally a
// game asset straight into src/data/assets/. No LLM anywhere. Every image in
// refs/src/ keeps its settings and marks (<stem>.ref.json), so "re-bake all"
// rebuilds everything after a baker change.
// ---------------------------------------------------------------------------
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bake, autoZones, DEFAULTS, SIGN_PRESETS, hex, type Baked, type BakeOptions, type Img } from './bake';
import { buildAtlas, GAME_FONT } from './glyphAtlas';
import { emptyMarks, marksFromZones, paintPart, partsOfCells, PART_COLORS, ZONES, type Marks, type Zone } from './marks';
import { toGameAsset, toRefJson, toSvg } from './exportSvg';
import './style.css';

const MAX_SIDE = 640; // big images are scaled down on load; plenty for ~2,000 signs
const IMG_RE = /\.(png|webp|jpe?g|gif)$/i;
const GRASS = '#afc765';
const SHEET_BG = '#16100d';

type Tool = 'paint' | 'erase' | 'anchor' | 'slot';
interface Saved {
  settings: BakeOptions;
  marks: Marks;
  title?: string;
  variants?: boolean;
  game?: { slug: string; stretch: number; kind: string; scale: number; write: boolean };
}

function loadImage(url: string): Promise<{ img: Img; w0: number; h0: number }> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(im.width, im.height));
      const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, 0, 0, w, h);
      resolve({ img: { w, h, data: ctx.getImageData(0, 0, w, h).data }, w0: im.width, h0: im.height });
    };
    im.onerror = reject;
    im.src = url;
  });
}

const darken = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  const d = (v: number) => Math.round(v * 0.45);
  return `rgb(${d(n >> 16)},${d((n >> 8) & 255)},${d(n & 255)})`;
};

// ---- the views ----------------------------------------------------------------------
// The sheet: square cells like the SVG, with the marks painted over it. Pointer
// positions are reported in 0..1 of the object box (= the whole grid).
function SheetView({
  b,
  marks,
  showMarks,
  cell,
  onPointer,
  slotDraft,
}: {
  b: Baked;
  marks: Marks;
  showMarks: boolean;
  cell: number;
  onPointer: (kind: 'down' | 'move' | 'up', x: number, y: number, buttons: number) => void;
  slotDraft: { x: number; y: number; w: number; h: number } | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const W = b.cols * cell, H = b.rows * cell;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = SHEET_BG;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${cell * 0.75}px ${GAME_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const owner = showMarks ? partsOfCells(b, marks) : [];
    b.cells.forEach((c, i) => {
      if (!c) return;
      const x = (i % b.cols) * cell, y = ((i / b.cols) | 0) * cell;
      const o = owner[i];
      if (o != null && marks.parts[o]) {
        ctx.fillStyle = marks.parts[o].color + '55';
        ctx.fillRect(x, y, cell, cell);
      }
      ctx.fillStyle = hex(c.rgb);
      ctx.fillText(c.ch, x + cell / 2, y + cell / 2);
    });
    if (!showMarks) return;
    ctx.lineWidth = 2;
    for (const s of [...marks.slots, ...(slotDraft ? [{ ...slotDraft, name: '' }] : [])]) {
      ctx.strokeStyle = '#ffd34d';
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(s.x * W, s.y * H, s.w * W, s.h * H);
      ctx.setLineDash([]);
      if (s.name) {
        ctx.fillStyle = '#ffd34d';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(s.name, s.x * W + 3, s.y * H + 9);
      }
    }
    for (const a of marks.anchors) {
      ctx.fillStyle = '#ff4df0';
      ctx.beginPath();
      ctx.arc(a.x * W, a.y * H, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(a.name, a.x * W + 7, a.y * H - 6);
    }
  }, [b, marks, showMarks, cell, slotDraft]);
  const at = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))] as const;
  };
  return (
    <canvas
      ref={ref}
      className="sheet"
      onPointerDown={(ev) => {
        ev.currentTarget.setPointerCapture(ev.pointerId);
        onPointer('down', ...at(ev), ev.buttons);
      }}
      onPointerMove={(ev) => onPointer('move', ...at(ev), ev.buttons)}
      onPointerUp={(ev) => onPointer('up', ...at(ev), ev.buttons)}
    />
  );
}

// The game look: columns doubled, rows stretched, every cell on a backing of
// its own colour at 45% (ColoredSprite's darken(hex, 0.55)), on grass.
function GameView({ b, line, stretch }: { b: Baked; line: number; stretch: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.font = `${line}px ${GAME_FONT}`;
    const charW = ctx.measureText('M').width;
    const NR = Math.max(1, Math.round(b.rows * stretch));
    const pad = line * 2;
    const W = Math.ceil(b.cols * 2 * charW + pad * 2), H = Math.ceil(NR * line + pad * 2);
    cv.width = W;
    cv.height = H;
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${line}px ${GAME_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let rr = 0; rr < NR; rr++) {
      const r = Math.floor((rr * b.rows) / NR);
      const y0 = Math.floor(pad + rr * line), y1 = Math.floor(pad + (rr + 1) * line);
      for (let c = 0; c < b.cols * 2; c++) {
        const cell = b.cells[r * b.cols + (c >> 1)];
        if (!cell) continue;
        const x0 = Math.floor(pad + c * charW), x1 = Math.floor(pad + (c + 1) * charW);
        const h = hex(cell.rgb);
        ctx.fillStyle = darken(h);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = h;
        ctx.fillText(cell.ch, (x0 + x1) / 2, (y0 + y1) / 2);
      }
    }
  }, [b, line, stretch]);
  return <canvas ref={ref} className="game" />;
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="dim">{fmt ? fmt(value) : value}</span>
    </label>
  );
}

// ---- the page --------------------------------------------------------------------------
function App() {
  const [files, setFiles] = useState<{ file: string; settings: boolean }[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [src, setSrc] = useState<{ img: Img; url: string; w0: number; h0: number } | null>(null);
  const [opts, setOpts] = useState<BakeOptions>(DEFAULTS);
  const [marks, setMarks] = useState<Marks>(emptyMarks());
  const [title, setTitle] = useState('');
  const [variants, setVariants] = useState(false);
  const [game, setGame] = useState({ slug: '', stretch: 1.22, kind: 'boulder', scale: 0.26, write: false });
  const [tool, setTool] = useState<Tool>('paint');
  const [part, setPart] = useState(0);
  const [brush, setBrush] = useState(0.05);
  const [showMarks, setShowMarks] = useState(true);
  const [cell, setCell] = useState(16);
  const [line, setLine] = useState(12);
  const [zonesK, setZonesK] = useState(3);
  const [status, setStatus] = useState('');
  const [slotDraft, setSlotDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const slotStart = useRef<{ x: number; y: number } | null>(null);

  const stem = sel ? sel.replace(IMG_RE, '') : '';
  const set = (p: Partial<BakeOptions>) => setOpts((o) => ({ ...o, ...p }));

  async function refresh() {
    const r = await fetch('/__ref/list');
    setFiles(await r.json());
  }
  useEffect(() => void refresh(), []);

  async function readSaved(file: string): Promise<Saved | null> {
    const r = await fetch(`/refs/src/${file.replace(IMG_RE, '')}.ref.json?t=${Date.now()}`);
    if (!r.ok) return null;
    try {
      return (await r.json()) as Saved;
    } catch {
      return null;
    }
  }

  async function open(file: string) {
    setSel(file);
    const url = `/refs/src/${file}`;
    const { img, w0, h0 } = await loadImage(url);
    setSrc({ img, url, w0, h0 });
    const s = await readSaved(file);
    setOpts({ ...DEFAULTS, ...(s?.settings ?? {}) });
    setMarks({ ...emptyMarks(), ...(s?.marks ?? {}) });
    setTitle(s?.title ?? file.replace(IMG_RE, '').replace(/[-_]+/g, ' '));
    setVariants(!!s?.variants);
    setGame({ slug: '', stretch: 1.22, kind: 'boulder', scale: 0.26, write: false, ...(s?.game ?? {}) });
    setStatus('');
  }

  async function upload(f: File) {
    const name = f.name.replace(/[^\w.-]+/g, '_');
    const dataUrl = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(f);
    });
    const r = await fetch('/__ref/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, dataUrl }) });
    if (!r.ok) return setStatus(`upload failed: ${(await r.json()).error}`);
    await refresh();
    await open(name);
  }

  const glyphSet = opts.ramp + opts.edgeGlyphs;
  const atlas = useMemo(() => buildAtlas(glyphSet), [glyphSet]);
  const baked = useMemo(() => (src ? bake(src.img, opts, atlas) : null), [src, opts, atlas]);

  // ---- marking on the sheet ----
  function onPointer(kind: 'down' | 'move' | 'up', x: number, y: number, buttons: number) {
    if (!showMarks) return;
    if (tool === 'paint' || tool === 'erase') {
      if (kind === 'up' || !(buttons & 1)) return;
      if (tool === 'paint' && !marks.parts[part]) return setStatus('add a part first');
      setMarks((m) => paintPart(m, x, y, brush, tool === 'erase' ? 0 : part + 1));
    } else if (tool === 'anchor' && kind === 'down') {
      const name = window.prompt('Anchor name (top, handle, attach, seat, …)', 'top')?.trim();
      if (name) setMarks((m) => ({ ...m, anchors: [...m.anchors.filter((a) => a.name !== name), { name, x, y }] }));
    } else if (tool === 'slot') {
      if (kind === 'down') slotStart.current = { x, y };
      const s0 = slotStart.current;
      if (!s0) return;
      const r = { x: Math.min(s0.x, x), y: Math.min(s0.y, y), w: Math.abs(x - s0.x), h: Math.abs(y - s0.y) };
      if (kind === 'move') setSlotDraft(r);
      if (kind === 'up') {
        slotStart.current = null;
        setSlotDraft(null);
        if (r.w < 0.02 || r.h < 0.02) return;
        const name = window.prompt('Slot name', `slot${marks.slots.length + 1}`)?.trim();
        if (!name) return;
        const accepts = (window.prompt('Decorations it accepts (comma separated)', 'flag, gem, flower') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        setMarks((m) => ({ ...m, slots: [...m.slots, { name, ...r, accepts }] }));
      }
    }
  }

  // ---- saving ----
  async function saveOne(base: string, o: BakeOptions, b: Baked, withGame: boolean) {
    const svg = toSvg(base, title || stem, b, marks);
    const json = JSON.stringify(toRefJson(base, sel!, o, b, marks), null, 2);
    const asset = JSON.stringify(toGameAsset(title || stem, `${base}.svg (from ${sel})`, b, marks, game.stretch, game.kind, game.scale), null, 2);
    const settings: Saved = { settings: opts, marks, title, variants, game };
    const r = await fetch('/__ref/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base, stem, svg, json, asset, gameSlug: withGame && game.write && game.slug ? (base === stem ? game.slug : `${game.slug}-${base.slice(stem.length + 1)}`) : undefined, settings: JSON.stringify(settings, null, 2) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d.saved as string[];
  }
  async function save() {
    if (!sel || !src || !baked) return;
    try {
      const saved = [...(await saveOne(stem, opts, baked, true))];
      if (variants)
        for (const p of SIGN_PRESETS) {
          const o = { ...opts, signs: p.signs };
          saved.push(...(await saveOne(`${stem}_${p.name}`, o, bake(src.img, o, atlas), true)));
        }
      setStatus(`saved ${saved.join(', ')}`);
      refresh();
    } catch (e) {
      setStatus(`not saved: ${String(e)}`);
    }
  }

  // ---- re-bake every image that has saved settings ----
  async function rebakeAll() {
    const done: string[] = [];
    for (const f of files.filter((f) => f.settings)) {
      const s = await readSaved(f.file);
      if (!s) continue;
      const { img } = await loadImage(`/refs/src/${f.file}`);
      const o = { ...DEFAULTS, ...s.settings };
      const at = buildAtlas(o.ramp + o.edgeGlyphs);
      const st = f.file.replace(IMG_RE, '');
      const m = { ...emptyMarks(), ...s.marks };
      const g = { slug: '', stretch: 1.22, kind: 'boulder', scale: 0.26, write: false, ...(s.game ?? {}) };
      const one = async (base: string, oo: BakeOptions) => {
        const b = bake(img, oo, at);
        const body = {
          base,
          stem: st,
          svg: toSvg(base, s.title || st, b, m),
          json: JSON.stringify(toRefJson(base, f.file, oo, b, m), null, 2),
          asset: JSON.stringify(toGameAsset(s.title || st, `${base}.svg (from ${f.file})`, b, m, g.stretch, g.kind, g.scale), null, 2),
          gameSlug: g.write && g.slug ? (base === st ? g.slug : `${g.slug}-${base.slice(st.length + 1)}`) : undefined,
          settings: JSON.stringify(s, null, 2),
        };
        await fetch('/__ref/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        done.push(base);
      };
      await one(st, o);
      if (s.variants) for (const p of SIGN_PRESETS) await one(`${st}_${p.name}`, { ...o, signs: p.signs });
    }
    setStatus(`re-baked ${done.length}: ${done.join(', ')}`);
  }

  const partCounts = useMemo(() => {
    if (!baked) return [];
    const own = partsOfCells(baked, marks);
    return marks.parts.map((_, i) => own.filter((o) => o === i).length);
  }, [baked, marks]);

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = [...e.dataTransfer.files].find((x) => IMG_RE.test(x.name));
        if (f) void upload(f);
      }}
    >
      <aside className="files">
        <h1>Glyph Ref Maker</h1>
        <p className="dim">Drop a PNG anywhere, or pick one from refs/src/.</p>
        <label className="btn">
          + add image
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <ul>
          {files.map((f) => (
            <li key={f.file} className={f.file === sel ? 'on' : ''} onClick={() => open(f.file)}>
              {f.file} {f.settings && <span className="dim">●</span>}
            </li>
          ))}
        </ul>
        <button onClick={rebakeAll} disabled={!files.some((f) => f.settings)} title="bake every image again from its saved settings and marks">
          re-bake all
        </button>
      </aside>

      <main>
        {!src || !baked ? (
          <div className="empty">Drop a PNG (pixel art or a picture on a plain background) to start.</div>
        ) : (
          <>
            <div className="counter">
              <b>{baked.signs}</b> signs · {baked.cols} × {baked.rows} cells · source {src.w0} × {src.h0}
            </div>
            <div className="views">
              <figure>
                <figcaption>source</figcaption>
                <img src={src.url} className="src" />
              </figure>
              <figure>
                <figcaption>
                  sheet (svg) {showMarks && <span className="dim">· {tool === 'paint' ? 'drag to paint the part' : tool === 'erase' ? 'drag to erase' : tool === 'anchor' ? 'click to place an anchor' : 'drag a decoration slot'}</span>}
                </figcaption>
                <SheetView b={baked} marks={marks} showMarks={showMarks} cell={cell} onPointer={onPointer} slotDraft={slotDraft} />
              </figure>
              <figure>
                <figcaption>in game (on grass, dark backing)</figcaption>
                <GameView b={baked} line={line} stretch={game.stretch} />
              </figure>
            </div>
          </>
        )}
      </main>

      <aside className="panel">
        <section>
          <h2>Signs</h2>
          <div className="row">
            {SIGN_PRESETS.map((p) => (
              <button key={p.name} className={opts.signs === p.signs ? 'on' : ''} onClick={() => set({ signs: p.signs })}>
                {p.name} · {p.signs}
              </button>
            ))}
          </div>
          <Slider label="target signs" value={opts.signs} min={0} max={3000} step={10} onChange={(v) => set({ signs: v })} fmt={(v) => (v ? String(v) : 'by cols')} />
          {!opts.signs && <Slider label="columns" value={opts.cols} min={4} max={120} step={1} onChange={(v) => set({ cols: v })} />}
          <label className="check">
            <input type="checkbox" checked={variants} onChange={(e) => setVariants(e.target.checked)} /> also save simple / middle / detailed
          </label>
        </section>

        <section>
          <h2>Shape</h2>
          <label className="row">
            <span>background</span>
            <select value={opts.bg} onChange={(e) => set({ bg: e.target.value as BakeOptions['bg'] })}>
              <option value="auto">auto (transparent or plain)</option>
              <option value="alpha">transparency only</option>
              <option value="none">keep everything</option>
            </select>
          </label>
          {opts.bg === 'auto' && <Slider label="bg tolerance" value={opts.bgTolerance} min={0} max={120} step={1} onChange={(v) => set({ bgTolerance: v })} />}
          <Slider label="coverage" value={opts.coverage} min={0.05} max={0.95} step={0.05} onChange={(v) => set({ coverage: v })} fmt={(v) => v.toFixed(2)} />
          <label className="check">
            <input type="checkbox" checked={opts.shapeMatch} onChange={(e) => set({ shapeMatch: e.target.checked })} /> glyphs follow edges (shape matching)
          </label>
          {opts.shapeMatch && <Slider label="edge contrast" value={opts.edgeContrast} min={10} max={200} step={5} onChange={(v) => set({ edgeContrast: v })} />}
          <Slider label="outline" value={opts.outline} min={0} max={0.8} step={0.05} onChange={(v) => set({ outline: v })} fmt={(v) => v.toFixed(2)} />
          <label className="check">
            <input type="checkbox" checked={opts.fillHoles} onChange={(e) => set({ fillHoles: e.target.checked })} /> fill enclosed gaps
          </label>
          <Slider label="cell aspect" value={opts.aspect} min={0.6} max={1.6} step={0.02} onChange={(v) => set({ aspect: v })} fmt={(v) => v.toFixed(2)} />
          <label className="field">
            <span>ramp (sparse → dense)</span>
            <input value={opts.ramp} onChange={(e) => set({ ramp: e.target.value })} />
          </label>
          <label className="field">
            <span>edge glyphs</span>
            <input value={opts.edgeGlyphs} onChange={(e) => set({ edgeGlyphs: e.target.value })} />
          </label>
        </section>

        <section>
          <h2>Colour</h2>
          <Slider label="tones" value={opts.tones} min={2} max={62} step={1} onChange={(v) => set({ tones: v })} />
          <Slider label="contrast" value={opts.contrast} min={0.5} max={2} step={0.05} onChange={(v) => set({ contrast: v })} fmt={(v) => v.toFixed(2)} />
          <Slider label="saturation" value={opts.saturation} min={0} max={2} step={0.05} onChange={(v) => set({ saturation: v })} fmt={(v) => v.toFixed(2)} />
          <Slider label="lift" value={opts.lift} min={0.6} max={1.8} step={0.05} onChange={(v) => set({ lift: v })} fmt={(v) => v.toFixed(2)} />
          <button onClick={() => setOpts({ ...DEFAULTS, signs: opts.signs })}>reset bake settings</button>
        </section>

        <section>
          <h2>View</h2>
          <Slider label="sheet cell" value={cell} min={6} max={30} step={1} onChange={setCell} fmt={(v) => `${v}px`} />
          <Slider label="game line" value={line} min={4} max={30} step={1} onChange={setLine} fmt={(v) => `${v}px`} />
        </section>

        <section>
          <h2>Marks</h2>
          <label className="check">
            <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} /> show and edit marks
          </label>
          <div className="row">
            {(['paint', 'erase', 'anchor', 'slot'] as Tool[]).map((t) => (
              <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)}>
                {t}
              </button>
            ))}
          </div>
          {(tool === 'paint' || tool === 'erase') && <Slider label="brush" value={brush} min={0.01} max={0.25} step={0.01} onChange={setBrush} fmt={(v) => v.toFixed(2)} />}
          <h3>Parts</h3>
          {marks.parts.map((p, i) => (
            <div key={i} className={'part' + (i === part ? ' on' : '')} onClick={() => setPart(i)}>
              <span className="swatch" style={{ background: p.color }} />
              <input
                value={p.name}
                onChange={(e) => setMarks((m) => ({ ...m, parts: m.parts.map((q, j) => (j === i ? { ...q, name: e.target.value.replace(/[^\w-]/g, '') } : q)) }))}
              />
              <select value={p.zone} onChange={(e) => setMarks((m) => ({ ...m, parts: m.parts.map((q, j) => (j === i ? { ...q, zone: e.target.value as Zone } : q)) }))}>
                {ZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
              <span className="dim">{partCounts[i] ?? 0}</span>
              <button
                title="remove this part"
                onClick={(e) => {
                  e.stopPropagation();
                  setMarks((m) => ({
                    ...m,
                    parts: m.parts.filter((_, j) => j !== i),
                    partMap: m.partMap.map((v) => (v === i + 1 ? 0 : v > i + 1 ? v - 1 : v)),
                  }));
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
                setMarks((m) => ({ ...m, parts: [...m.parts, { name: `part${m.parts.length + 1}`, zone: 'primary', color: PART_COLORS[m.parts.length % PART_COLORS.length] }] }));
                setPart(marks.parts.length);
                setTool('paint');
              }}
            >
              + part
            </button>
            <button
              title="split the cells into colour groups as a first guess (replaces the parts)"
              disabled={!baked}
              onClick={() => baked && (marks.parts.length === 0 || window.confirm('Replace the painted parts with auto zones?')) && setMarks((m) => marksFromZones(baked, autoZones(baked, zonesK), zonesK, m))}
            >
              auto zones
            </button>
            <input type="number" min={2} max={8} value={zonesK} onChange={(e) => setZonesK(Number(e.target.value))} className="num" />
          </div>
          <h3>Anchors</h3>
          {marks.anchors.map((a) => (
            <div key={a.name} className="item">
              <span>● {a.name}</span>
              <button onClick={() => setMarks((m) => ({ ...m, anchors: m.anchors.filter((x) => x !== a) }))}>✕</button>
            </div>
          ))}
          <h3>Decoration slots</h3>
          {marks.slots.map((s, i) => (
            <div key={i} className="item">
              <span>▭ {s.name}</span>
              <input
                value={s.accepts.join(', ')}
                title="decorations it accepts"
                onChange={(e) => setMarks((m) => ({ ...m, slots: m.slots.map((x, j) => (j === i ? { ...x, accepts: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } : x)) }))}
              />
              <button onClick={() => setMarks((m) => ({ ...m, slots: m.slots.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          ))}
          <h3>About it</h3>
          <label className="field">
            <span>tags</span>
            <input value={marks.tags.join(', ')} placeholder="boat, wooden, small" onChange={(e) => setMarks((m) => ({ ...m, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }))} />
          </label>
          <label className="field">
            <span>category</span>
            <input value={marks.category} placeholder="vehicle, tool, pet, hold, decoration, prop" onChange={(e) => setMarks((m) => ({ ...m, category: e.target.value.trim() }))} />
          </label>
          <label className="row">
            <span>size band</span>
            <select value={marks.sizeBand} onChange={(e) => setMarks((m) => ({ ...m, sizeBand: e.target.value as Marks['sizeBand'] }))}>
              <option>small</option>
              <option>medium</option>
              <option>large</option>
            </select>
          </label>
        </section>

        <section>
          <h2>Save</h2>
          <label className="field">
            <span>title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <p className="dim">
            writes refs/out/{stem || '<name>'}.svg, .json and .asset.json{variants ? ' (+ _simple, _middle, _detailed)' : ''}, and keeps the settings in refs/src/{stem || '<name>'}.ref.json
          </p>
          <h3>Game asset</h3>
          <Slider label="row stretch" value={game.stretch} min={1} max={1.5} step={0.01} onChange={(v) => setGame((g) => ({ ...g, stretch: v }))} fmt={(v) => v.toFixed(2)} />
          <label className="row">
            <span>kind</span>
            <select value={game.kind} onChange={(e) => setGame((g) => ({ ...g, kind: e.target.value }))}>
              <option>boulder</option>
              <option>decor</option>
              <option>cat</option>
            </select>
          </label>
          <Slider label="scale" value={game.scale} min={0.05} max={1} step={0.01} onChange={(v) => setGame((g) => ({ ...g, scale: v }))} fmt={(v) => v.toFixed(2)} />
          <label className="check">
            <input type="checkbox" checked={game.write} onChange={(e) => setGame((g) => ({ ...g, write: e.target.checked }))} /> also write src/data/assets/
            <input value={game.slug} placeholder="slug" disabled={!game.write} onChange={(e) => setGame((g) => ({ ...g, slug: e.target.value.replace(/[^\w-]/g, '') }))} className="slug" />
            .json
          </label>
          <button className="primary" onClick={save} disabled={!baked}>
            save
          </button>
          {status && <p className="status">{status}</p>}
        </section>
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
