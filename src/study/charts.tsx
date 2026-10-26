// The figures of /feedback: plain SVG, drawn at the width they get (so
// labels stay readable on a phone), greyscale with one accent. Every figure
// sits in a <Figure> with its number, an editable caption, and a PNG export
// (the figure with its caption below, 2400 px wide, white) for Word.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fmt } from './stats';
import { getLang, tr } from './i18n';

export const INK = '#1d1d1b';
export const MUTED = '#6b6b66';
export const GRID = '#e4e3de';
export const SERIES = { A: '#4b4b48', B: '#c2571a' } as const; // variant A grey, B the accent
export const NEUTRAL = '#bdbcb5';
const FONT = "'IBM Plex Sans', Arial, sans-serif";

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const nf = (x: number, d = 0) => fmt(x, d);

// a nice axis maximum and its ticks
function ticks(max: number, count = 4, integer = false): number[] {
  if (max <= 0) return [0, 1];
  const raw = integer ? Math.max(1, max / count) : max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw && (!integer || Number.isInteger(s))) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}


// ---- labels: measured, wrapped onto as many lines as they need, never cut ----
let measureCtx: CanvasRenderingContext2D | null = null;
function textW(t: string, size = 12): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return t.length * size * 0.56;
  measureCtx.font = `${size}px ${FONT}`;
  return measureCtx.measureText(t).width;
}
function wrapText(t: string, maxW: number, size = 12): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textW(next, size) > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
const LINE = 15; // line height of a 12 px label
// the label column (at most `share` of the width) and every label's lines
function labelColumn(labels: string[], w: number, share: number) {
  const natural = Math.max(40, ...labels.map((l) => textW(l))) + 14;
  const labelW = Math.min(natural, Math.max(90, w * share));
  return { labelW, lines: labels.map((l) => wrapText(l, labelW - 14)) };
}
// a left-aligned label, vertically centred on `cy`
function Label({ lines, cy, full }: { lines: string[]; cy: number; full: string }) {
  const y0 = cy - ((lines.length - 1) * LINE) / 2 + 4;
  return (
    <text x={0} y={y0} fontSize={12} fill={INK}>
      {lines.map((l, i) => (
        <tspan key={i} x={0} dy={i ? LINE : 0}>
          {l}
        </tspan>
      ))}
      <title>{full}</title>
    </text>
  );
}
// legend entries flowing onto further lines when they don't fit
function legendLayout(names: string[], x0: number, w: number, swatch = 15) {
  let x = x0;
  let y = 0;
  const pos = names.map((n) => {
    const itemW = swatch + textW(n) + 18;
    if (x > x0 && x + itemW > w) {
      x = x0;
      y += 18;
    }
    const at = { x, y };
    x += itemW;
    return at;
  });
  return { pos, height: names.length ? y + 18 : 0 };
}

// ---- horizontal bars, one or two series (A/B) ----
export interface BarRow {
  label: string;
  values: number[]; // one per series
  note?: string; // shown after the bar instead of the value
  color?: string; // this row's colour (a single series only)
  heading?: boolean; // a group heading over the rows below it (no bar)
}
// `title`: a heading inside the drawing (kept in the PNG export)
export function Bars({ rows, series, unit = '', digits = 0, max, title }: { rows: BarRow[]; series?: { name: string; color: string }[]; unit?: string; digits?: number; max?: number; title?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const ser = series ?? [{ name: '', color: INK }];
  const bars = rows.filter((r) => !r.heading);
  const col = labelColumn(bars.map((r) => r.label), w, 0.45);
  const labelW = col.labelW;
  // headings span the whole width, in bold
  const lines = rows.map((r) => (r.heading ? wrapText(r.label, w, 13) : col.lines[bars.indexOf(r)]));
  const barH = ser.length > 1 ? 11 : 16;
  const block = ser.length * (barH + 2);
  const titleLines = title ? wrapText(title, w, 13) : [];
  const head = titleLines.length ? titleLines.length * 17 + 6 : 0;
  const legend = ser.length > 1 ? legendLayout(ser.map((s) => s.name), labelW, w) : { pos: [], height: 0 };
  const top = (ser.length > 1 ? legend.height + 8 : 6) + head;
  // every row as tall as its label
  const rowHs = rows.map((r, i) => (r.heading ? lines[i].length * 17 + (i ? 16 : 4) : Math.max(block, lines[i].length * LINE) + 12));
  const rowY = rowHs.map((_, i) => top + rowHs.slice(0, i).reduce((a, b) => a + b, 0));
  const h = top + rowHs.reduce((a, b) => a + b, 0) + 22;
  const top_ = max ?? Math.max(digits ? 0.1 : 1, ...bars.flatMap((r) => r.values));
  const tk = ticks(top_, 4, !digits);
  const xMax = tk[tk.length - 1];
  // room on the right for the longest value text
  const right = Math.max(44, ...bars.flatMap((r) => r.values.map((v, j) => textW(j === r.values.length - 1 && r.note ? r.note : `${nf(v, digits)}${unit}`, 11) + 14)));
  const plotW = Math.max(40, w - labelW - right);
  const x = (v: number) => labelW + (v / xMax) * plotW;
  return (
    <div ref={ref} className="st-chart">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fontFamily={FONT} role="img">
        {titleLines.length > 0 && (
          <text x={0} y={14} fontSize={13} fontWeight={500} fill={INK}>
            {titleLines.map((l, i) => (
              <tspan key={i} x={0} dy={i ? 17 : 0}>
                {l}
              </tspan>
            ))}
          </text>
        )}
        {ser.length > 1 &&
          ser.map((s, i) => (
            <g key={s.name} transform={`translate(${legend.pos[i].x}, ${8 + head + legend.pos[i].y})`}>
              <rect width={10} height={10} rx={2} fill={s.color} />
              <text x={15} y={9} fontSize={12} fill={INK}>
                {s.name}
              </text>
            </g>
          ))}
        {tk.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 2} y2={h - 18} stroke={GRID} />
            <text x={x(t)} y={h - 4} fontSize={11} fill={MUTED} textAnchor="middle">
              {nf(t, Number.isInteger(t) ? 0 : 1)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          if (r.heading)
            return (
              <text key={r.label + i} x={0} y={rowY[i] + rowHs[i] - lines[i].length * 17 + 9} fontSize={13} fontWeight={500} fill={INK}>
                {lines[i].map((l, k) => (
                  <tspan key={k} x={0} dy={k ? 17 : 0}>
                    {l}
                  </tspan>
                ))}
              </text>
            );
          const y0 = rowY[i] + 6 + (rowHs[i] - 12 - block) / 2;
          return (
            <g key={r.label + i}>
              <Label lines={lines[i]} cy={y0 + block / 2} full={r.label} />
              {r.values.map((v, j) => {
                const y = y0 + j * (barH + 2);
                const bw = Math.max(0, x(v) - labelW);
                return (
                  <g key={j}>
                    <rect x={labelW} y={y} width={Math.max(bw, v > 0 ? 2 : 0)} height={barH} rx={Math.min(3, bw / 2)} fill={ser.length === 1 && r.color ? r.color : ser[j].color}>
                      <title>{`${r.label}${ser[j].name ? ` – ${ser[j].name}` : ''}: ${nf(v, digits)}${unit}`}</title>
                    </rect>
                    <text x={labelW + bw + 5} y={y + barH / 2 + 4} fontSize={11} fill={MUTED}>
                      {j === r.values.length - 1 && r.note ? r.note : `${nf(v, digits)}${unit}`}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- diverging stacked bars (Likert): negative left, neutral centred ----
export interface LikertRow {
  label: string;
  counts: number[]; // per scale point, low → high
}
export function Diverging({ rows, scale }: { rows: LikertRow[]; scale: string[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const k = scale.length;
  const mid = (k - 1) / 2;
  // greyscale for disagreement, accent shades for agreement, neutral grey in the middle
  // darker towards the ends of the scale
  const colors = scale.map((_, i) => (i < mid ? ['#a5a49d', '#7a7a74', '#3b3b38'][Math.min(2, Math.ceil(mid - i) - 1)] : i > mid ? ['#e8a77e', '#d77c42', '#a8440f'][Math.min(2, Math.ceil(i - mid) - 1)] : NEUTRAL));
  const { labelW, lines } = labelColumn(rows.map((r) => r.label), w, 0.4);
  const plotW = Math.max(60, w - labelW - 16);
  const legend = legendLayout(scale, labelW, w, 14);
  const top = legend.height + 16;
  const rowHs = lines.map((l) => Math.max(20, l.length * LINE) + 8);
  const rowY = rowHs.map((_, i) => top + rowHs.slice(0, i).reduce((a, b) => a + b, 0));
  const h = top + rowHs.reduce((a, b) => a + b, 0) + 22;
  const cx = labelW + plotW / 2;
  const maxN = Math.max(1, ...rows.map((r) => r.counts.reduce((a, b) => a + b, 0)));
  const unit = plotW / 2 / maxN;
  return (
    <div ref={ref} className="st-chart">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fontFamily={FONT} role="img">
        {scale.map((s, i) => (
          <g key={s} transform={`translate(${legend.pos[i].x}, ${6 + legend.pos[i].y})`}>
            <rect width={10} height={10} rx={2} fill={colors[i]} />
            <text x={14} y={9} fontSize={11} fill={INK}>
              {s}
            </text>
          </g>
        ))}
        <line x1={cx} x2={cx} y1={top - 6} y2={h - 18} stroke={MUTED} />
        {[-maxN, -maxN / 2, maxN / 2, maxN].map((t) => (
          <text key={t} x={cx + t * unit} y={h - 4} fontSize={11} fill={MUTED} textAnchor="middle">
            {nf(Math.abs(t), Number.isInteger(t) ? 0 : 1)}
          </text>
        ))}
        {rows.map((r, i) => {
          const y = rowY[i] + (rowHs[i] - 20) / 2;
          const neutral = k % 2 ? r.counts[Math.floor(mid)] : 0;
          const neg = r.counts.slice(0, Math.ceil(mid)).reduce((a, b) => a + b, 0);
          let pos = cx - (neg + neutral / 2) * unit;
          return (
            <g key={r.label + i}>
              <Label lines={lines[i]} cy={y + 10} full={r.label} />
              {r.counts.map((c, j) => {
                const x0 = pos;
                pos += c * unit;
                return c ? (
                  <rect key={j} x={x0 + 1} y={y + 2} width={Math.max(0, c * unit - 2)} height={16} rx={2} fill={colors[j]}>
                    <title>{`${r.label} – ${scale[j]}: ${c}`}</title>
                  </rect>
                ) : null;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- means with 95 % intervals on a fixed scale ----
export interface DotRow {
  label: string;
  points: { value: number; lo: number; hi: number; series: number }[];
}
export function Dots({ rows, series, domain, refLines = [] }: { rows: DotRow[]; series: { name: string; color: string }[]; domain: [number, number]; refLines?: number[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const { labelW, lines } = labelColumn(rows.map((r) => r.label), w, 0.4);
  const block = 18 * series.length;
  const legend = legendLayout(series.map((s) => s.name), labelW, w);
  const top = legend.height + 10;
  const rowHs = lines.map((l) => Math.max(block, l.length * LINE) + 12);
  const rowY = rowHs.map((_, i) => top + rowHs.slice(0, i).reduce((a, b) => a + b, 0));
  const h = top + rowHs.reduce((a, b) => a + b, 0) + 22;
  const plotW = Math.max(60, w - labelW - 16);
  const x = (v: number) => labelW + ((Math.min(domain[1], Math.max(domain[0], v)) - domain[0]) / (domain[1] - domain[0])) * plotW;
  const tk: number[] = [];
  for (let v = domain[0]; v <= domain[1]; v++) tk.push(v);
  return (
    <div ref={ref} className="st-chart">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fontFamily={FONT} role="img">
        {series.map((s, i) => (
          <g key={s.name} transform={`translate(${legend.pos[i].x}, ${6 + legend.pos[i].y})`}>
            <circle cx={5} cy={5} r={4.5} fill={s.color} />
            <text x={15} y={9} fontSize={12} fill={INK}>
              {s.name}
            </text>
          </g>
        ))}
        {tk.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 4} y2={h - 18} stroke={refLines.includes(t) ? MUTED : GRID} />
            <text x={x(t)} y={h - 4} fontSize={11} fill={MUTED} textAnchor="middle">
              {t > 0 && domain[0] < 0 ? `+${t}` : t}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y0 = rowY[i] + 6 + (rowHs[i] - 12 - block) / 2;
          return (
            <g key={r.label + i}>
              <Label lines={lines[i]} cy={y0 + block / 2} full={r.label} />
              {r.points.map((p, j) => {
                const y = y0 + p.series * 18 + 9;
                const s = series[p.series];
                if (!Number.isFinite(p.value)) return null;
                return (
                  <g key={j}>
                    {Number.isFinite(p.lo) && <line x1={x(p.lo)} x2={x(p.hi)} y1={y} y2={y} stroke={s.color} strokeWidth={2} strokeLinecap="round" />}
                    <circle cx={x(p.value)} cy={y} r={5} fill={s.color} stroke="#fff" strokeWidth={2}>
                      <title>{`${r.label} – ${s.name}: ${nf(p.value, 2)}${Number.isFinite(p.lo) ? ` [${nf(p.lo, 2)}; ${nf(p.hi, 2)}]` : ''}`}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- the figure frame: number, title, caption, PNG ----
export function Figure({
  n,
  title,
  caption,
  onCaption,
  children,
  table,
}: {
  n: number | string;
  title: string;
  caption: string;
  onCaption: (c: string) => void;
  children: ReactNode;
  table?: () => string; // CSV of the figure's numbers
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(caption);
  const [copied, setCopied] = useState(false);
  useEffect(() => setDraft(caption), [caption]);
  const full = `${getLang() === 'en' ? 'Figure' : 'Abbildung'} ${n}: ${draft}`;
  return (
    <figure className="st-figure">
      <figcaption className="st-figtitle">
        <span className="st-fignum">Abb. {n}</span> {title}
      </figcaption>
      <div ref={ref}>{children}</div>
      <textarea
        className="st-caption"
        value={draft}
        rows={Math.max(1, Math.ceil(draft.length / 48))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== caption && onCaption(draft)}
        aria-label={`Bildunterschrift Abbildung ${n}`}
      />
      <div className="st-figtools">
        <button type="button" onClick={() => void exportPng(ref.current, full, `${tr('Abbildung')}-${n}.png`)}>
          PNG
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(full).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Kopiert' : 'Text kopieren'}
        </button>
        {table && (
          <button type="button" onClick={() => download(new Blob(['\uFEFF' + table()], { type: 'text/csv;charset=utf-8' }), `${tr('Abbildung')}-${n}.csv`)}>
            CSV
          </button>
        )}
      </div>
    </figure>
  );
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// the font, embedded into the exported SVG (an <img> can't load web fonts)
let fontCss: Promise<string> | null = null;
function embeddedFont(): Promise<string> {
  fontCss ??= fetch('/fonts/ibm-plex-sans-latin.woff2')
    .then((r) => (r.ok ? r.blob() : Promise.reject()))
    .then(
      (b) =>
        new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(`@font-face{font-family:'IBM Plex Sans';font-weight:100 700;src:url(${fr.result}) format('woff2');}`);
          fr.readAsDataURL(b);
        }),
    )
    .catch(() => '');
  return fontCss;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > width && line) {
        lines.push(line);
        line = word;
      } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

// the figure (every SVG in it, stacked) with its caption below, as a PNG
export async function exportPng(host: HTMLElement | null, caption: string, name: string) {
  const svgs = host ? [...host.querySelectorAll('svg')] : [];
  if (!svgs.length) return;
  const css = await embeddedFont();
  const OUT = 2400;
  const baseW = Math.max(...svgs.map((s) => s.width.baseVal.value));
  const k = OUT / baseW;
  const pad = 40;
  const imgs = await Promise.all(
    svgs.map(
      (s) =>
        new Promise<{ img: HTMLImageElement; h: number }>((res, rej) => {
          const c = s.cloneNode(true) as SVGSVGElement;
          c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
          st.textContent = css;
          c.prepend(st);
          const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(c)], { type: 'image/svg+xml' }));
          const img = new Image();
          img.onload = () => res({ img, h: s.height.baseVal.value });
          img.onerror = rej;
          img.src = url;
        }),
    ),
  );
  await document.fonts?.load(`${Math.round(13 * k)}px 'IBM Plex Sans'`).catch(() => null);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontPx = Math.round(13 * k);
  ctx.font = `${fontPx}px 'IBM Plex Sans', Arial, sans-serif`;
  const lines = wrap(ctx, caption, OUT);
  const figH = imgs.reduce((a, i) => a + i.h * k, 0);
  canvas.width = OUT + pad * 2;
  canvas.height = Math.ceil(pad + figH + fontPx * 1.2 + lines.length * fontPx * 1.45 + pad);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = pad;
  for (const { img, h } of imgs) {
    ctx.drawImage(img, pad, y, OUT, h * k);
    y += h * k;
  }
  ctx.font = `${fontPx}px 'IBM Plex Sans', Arial, sans-serif`;
  ctx.fillStyle = INK;
  y += fontPx * 1.2;
  for (const l of lines) {
    y += fontPx * 1.2;
    ctx.fillText(l, pad, y);
    y += fontPx * 0.25;
  }
  canvas.toBlob((b) => b && download(b, name), 'image/png');
}
