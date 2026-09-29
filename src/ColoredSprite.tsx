// Renders an ASCII sprite with optional PER-REGION colour ("paint by number").
// Given a `colors` grid + `palette` (from the LLM craft pipeline), each glyph is
// coloured by its palette key; cells marked '.' (or with no/invalid key) fall
// back to the base `color`. With no colour data it's just a mono <pre>, so it's
// a drop-in replacement for `<pre style={{ color }}>{sprite.join('\n')}</pre>`.
import React from 'react';

// The four crafting "finish" effects a player's prompt can imply (see
// craft/spec.ts's textureModifierFor, derived from the SAME finish
// vocabulary — shiny/glowing/metallic/matte — parseSpec already extracts).
// 'matte' (and anything unmapped) is the default: no CSS effect at all.
export type TextureModifier = 'shiny' | 'neon' | 'metallic' | 'matte';

// Glyphs eligible for the shiny highlight — small, deliberately generic
// "glint" characters rather than anything structural, so the effect reads as
// a light catching an edge, not a random colour swap. Plain ASCII, so no
// width-safety concern.
const SHINY_GLINTS = new Set(['*', "'"]);
const SHINY_HEX = '#ffffff';

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
// A darkened version of a cell's OWN colour, used as that cell's background
// in `solidCells` mode — see the Props.solidCells comment for why this (not
// a single flat colour) is what makes each cell's backing automatically
// belong to its own region (hair backing is dark hair-red, shirt backing is
// dark shirt-white, etc.) without this component having to know what body
// part any given cell is.
export function darken(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const d = (v: number) => Math.max(0, Math.round(v * (1 - factor)));
  return `#${d(r).toString(16).padStart(2, '0')}${d(g).toString(16).padStart(2, '0')}${d(b).toString(16).padStart(2, '0')}`;
}
// Matches docs/character-sprite-parts's own is_warm_brown eye predicate
// (same repo, same convention) — used by `eyeRow` below to find the
// intentionally-empty-looking eye cells within a known row by their colour,
// rather than by hand-picked coordinates.
function isWarmBrown(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return r - g >= 40 && r - g <= 90 && g - b >= 5 && g - b <= 40 && r < 220;
}
const EYE_BG = '#4A3028';

interface Props {
  sprite: string[];
  colors?: string[]; // same shape as sprite; each cell a palette key or '.'
  palette?: Record<string, string>; // key → hex
  color?: string; // base colour for uncoloured cells / mono sprites
  className?: string;
  style?: React.CSSProperties;
  // One <span> per glyph instead of one per colour run. Costs far more DOM, so
  // it is opt-in — but it lets CSS pin every glyph to exactly one cell width,
  // which is the only way to use characters the font renders double-width
  // without the row shearing. See the .ent.pond rule in styles.css.
  perCell?: boolean;
  // Per-cell OPAQUE backgrounds (a darkened version of each cell's own
  // colour), so occupied cells read as a solid sprite instead of letting
  // whatever's behind them (terrain, another entity) show through. Only
  // genuinely empty (' ', uncoloured) cells stay transparent. Deliberately
  // opt-in and currently only used by the player (see .player-sprite in
  // App.tsx) — this is NOT the same thing as `color`/`perCell`, and applying
  // it to every sprite in the game would change how everything looks, not
  // just fix the one reported case.
  solidCells?: boolean;
  // With `solidCells`, the row (0-indexed into `sprite`) to scan for the
  // player's eye cells: any cell in this row whose resolved colour is
  // "warm brown" (isWarmBrown above) gets forced to an opaque dark-brown
  // background with NO glyph drawn, instead of the normal own-colour
  // backing — the eyes are represented by colour+absence-of-visible-ink at
  // this render scale, not by an actually-empty sprite cell, so they'd
  // otherwise get the same (wrong) treatment as a real gap. Omit for sprites/
  // frames where the eye row hasn't been verified (e.g. walk-cycle frames
  // with different crop/padding — see docs/character-sprite-parts/README.md).
  eyeRow?: number;
  onClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  // Crafted-item visual finish. 'shiny' forces per-glyph rendering (like
  // perCell) so the glint characters can be individually forced bright white;
  // 'neon'/'metallic' are pure CSS (text-shadow / grayscale filter, see
  // styles.css) added as a class — no rendering-path change needed for them.
  texture?: TextureModifier;
}

function ColoredSpriteImpl({
  sprite,
  colors,
  palette,
  color,
  className,
  style,
  perCell,
  solidCells,
  eyeRow,
  onClick,
  onMouseEnter,
  onMouseLeave,
  texture,
}: Props) {
  const hasColour = !!colors && !!palette && Object.keys(palette).length > 0;
  const preStyle: React.CSSProperties = color ? { color, ...style } : { ...style };
  const texClass = texture && texture !== 'matte' ? ` tex-${texture}` : '';
  const fullClassName = (className ?? '') + texClass;

  // SOLID CELLS: every OCCUPIED cell gets an opaque background (a darkened
  // version of its own colour) so the terrain/whatever's behind it can't
  // show through — only genuinely empty cells stay transparent. The eye row
  // (if given) gets a fixed dark-brown background with no glyph instead,
  // since those cells are visually "empty" (a tiny low-contrast dot at this
  // render scale) but still belong to the character — see the Props comment.
  if (solidCells && hasColour) {
    return (
      <pre className={fullClassName} style={preStyle} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {sprite.map((line, y) => {
          const crow = colors![y] ?? '';
          const isEyeRow = eyeRow === y;
          const cells: React.ReactNode[] = [];
          let gap = '';
          for (let x = 0; x < line.length; x++) {
            const ch = line[x];
            const key = crow[x];
            const hex = key ? palette![key] : undefined;
            const eyeHere = isEyeRow && !!hex && isWarmBrown(hex);
            if (ch === ' ' && !eyeHere) {
              gap += ' ';
              continue;
            }
            if (gap) {
              cells.push(gap);
              gap = '';
            }
            if (eyeHere) {
              cells.push(
                <span key={x} style={{ background: EYE_BG }}>
                  {' '}
                </span>,
              );
              continue;
            }
            cells.push(
              <span key={x} style={hex ? { color: hex, background: darken(hex, 0.55) } : undefined}>
                {ch}
              </span>,
            );
          }
          if (gap) cells.push(gap);
          return (
            <React.Fragment key={y}>
              {cells}
              {y < sprite.length - 1 ? '\n' : ''}
            </React.Fragment>
          );
        })}
      </pre>
    );
  }

  // SHINY: always per-glyph, whether or not the sprite has its own colour
  // data, so the glint override can win over both a palette colour and the
  // plain base colour. Everything else here mirrors the perCell branch below.
  if (texture === 'shiny') {
    return (
      <pre className={fullClassName} style={preStyle} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {sprite.map((line, y) => {
          const crow = colors?.[y] ?? '';
          const cells: React.ReactNode[] = [];
          let gap = '';
          for (let x = 0; x < line.length; x++) {
            const ch = line[x];
            if (ch === ' ') {
              gap += ch;
              continue;
            }
            if (gap) {
              cells.push(gap);
              gap = '';
            }
            const glint = SHINY_GLINTS.has(ch);
            const hex = glint ? SHINY_HEX : palette?.[crow[x]];
            cells.push(
              <span key={x} style={hex ? { color: hex } : undefined}>
                {ch}
              </span>,
            );
          }
          if (gap) cells.push(gap);
          return (
            <React.Fragment key={y}>
              {cells}
              {y < sprite.length - 1 ? '\n' : ''}
            </React.Fragment>
          );
        })}
      </pre>
    );
  }

  // no colour data → plain mono sprite (identical to the old render path)
  if (!hasColour) {
    return (
      <pre className={fullClassName} style={preStyle} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {sprite.join('\n')}
      </pre>
    );
  }

  // PER-CELL: every glyph gets its own span so CSS can force it into a
  // one-cell box. Blank cells stay plain text — a space is single-width in any
  // monospace font, so it needs no pinning and would only add DOM.
  if (perCell) {
    return (
      <pre className={fullClassName} style={preStyle} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {sprite.map((line, y) => {
          const crow = colors![y] ?? '';
          const cells: React.ReactNode[] = [];
          let gap = '';
          for (let x = 0; x < line.length; x++) {
            const ch = line[x];
            if (ch === ' ') {
              gap += ch;
              continue;
            }
            if (gap) {
              cells.push(gap);
              gap = '';
            }
            const hex = palette![crow[x]];
            cells.push(
              <span key={x} style={hex ? { color: hex } : undefined}>
                {ch}
              </span>,
            );
          }
          if (gap) cells.push(gap);
          return (
            <React.Fragment key={y}>
              {cells}
              {y < sprite.length - 1 ? '\n' : ''}
            </React.Fragment>
          );
        })}
      </pre>
    );
  }

  // group each row into runs of the same effective colour → one <span> per run,
  // so a full sprite is only a handful of spans, not one per character
  const rows: React.ReactNode[] = [];
  for (let y = 0; y < sprite.length; y++) {
    const line = sprite[y];
    const crow = colors![y] ?? '';
    const spans: React.ReactNode[] = [];
    let run = '';
    let runHex: string | undefined;
    let sk = 0;
    const flush = () => {
      if (!run) return;
      spans.push(
        runHex ? (
          <span key={sk++} style={{ color: runHex }}>
            {run}
          </span>
        ) : (
          run
        ),
      );
      run = '';
    };
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      const key = crow[x];
      const hex = ch !== ' ' && key ? palette![key] : undefined; // spaces never coloured
      if (hex !== runHex) {
        flush();
        runHex = hex;
      }
      run += ch;
    }
    flush();
    rows.push(
      <React.Fragment key={y}>
        {spans}
        {y < sprite.length - 1 ? '\n' : ''}
      </React.Fragment>,
    );
  }

  return (
    <pre className={fullClassName} style={preStyle} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {rows}
    </pre>
  );
}

// Shallow-compares `style`'s own VALUES rather than its reference — callers
// (App.tsx's world-entity map, most of all) rebuild `style={{ left, top,
// zIndex, ... }}` as a fresh object literal every render, so a plain
// React.memo would see "changed" every time regardless of whether the
// numbers inside actually moved. This is what makes memoizing worthwhile at
// all: for an entity whose data hasn't changed (the common case — `ents` in
// App.tsx is itself memoized and doesn't depend on player position), every
// value in here comes out identical even though the wrapping object is new.
function styleEqual(a?: React.CSSProperties, b?: React.CSSProperties): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a) as (keyof React.CSSProperties)[];
  const bKeys = Object.keys(b) as (keyof React.CSSProperties)[];
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// onClick/onMouseEnter/onMouseLeave: callers build these as fresh closures
// every render, but each one only closes over that entity's own stable id
// and calls a stable outer setter, so a new closure behaves exactly like the
// one already mounted — comparing identity would defeat the memo. What DOES
// matter is whether a handler exists at all: App passes `undefined` while an
// entity is out of interaction range and a handler once the player walks up
// to it. Ignoring that switch kept the handler-less version mounted, so
// Mitchy, the shop or a house hotspot stayed unclickable for anyone who
// loaded the game away from them.
function propsAreEqual(prev: Props, next: Props): boolean {
  return (
    prev.sprite === next.sprite &&
    prev.colors === next.colors &&
    prev.palette === next.palette &&
    prev.color === next.color &&
    prev.className === next.className &&
    prev.perCell === next.perCell &&
    prev.solidCells === next.solidCells &&
    prev.eyeRow === next.eyeRow &&
    prev.texture === next.texture &&
    !prev.onClick === !next.onClick &&
    !prev.onMouseEnter === !next.onMouseEnter &&
    !prev.onMouseLeave === !next.onMouseLeave &&
    styleEqual(prev.style, next.style)
  );
}

export const ColoredSprite = React.memo(ColoredSpriteImpl, propsAreEqual);

// The `solidCells` look drawn on ONE canvas instead of one <span> per cell.
// Used for the player: its walk cycle swaps the whole sprite several times a
// second, and as ~400 styled spans (each with a background and a 4-way text
// shadow) every swap rewrote thousands of DOM styles and repainted the
// screen — measured as the biggest cost of walking. Same colours, same eye
// cells, same 1px outline as the span version.
interface SolidCanvasProps {
  sprite: string[];
  colors: string[];
  palette: Record<string, string>;
  eyeRow?: number;
  className?: string;
  style?: React.CSSProperties;
  charW: number; // px per cell at the sprite's own font size
  lineH: number;
  res: number; // backing pixels per CSS px (screen scale x devicePixelRatio)
  outline?: string | null; // CSS var holding the outline colour; null = none
  solid?: boolean; // opaque darkened backing per cell (ColoredSprite's solidCells)
  onClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
}

// Rendering a sprite costs ~2,000 fillText calls (every glyph plus its 4-way
// outline), so each look is rendered once and kept: a walk frame the player
// has already shown is one drawImage the next time round. Keyed by the
// sprite/colours/palette objects themselves (applyOutfit hands back new ones
// when the outfit changes, which retires the old entries) and then by
// resolution + style; only the current resolution is kept per look.
type SolidLook = { key: string; img: HTMLCanvasElement };
const solidCache = new WeakMap<string[], WeakMap<string[], WeakMap<object, SolidLook>>>();

function renderSolid(
  sprite: string[],
  colors: string[],
  palette: Record<string, string>,
  eyeRow: number | undefined,
  charW: number,
  lineH: number,
  r: number,
  font: string,
  base: string,
  ring: string | null,
  solid: boolean,
): HTMLCanvasElement {
  const cols = Math.max(0, ...sprite.map((l) => l.length));
  const rows = sprite.length;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(cols * charW * r));
  c.height = Math.max(1, Math.ceil(rows * lineH * r));
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.font = `${lineH * r}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // cells in paint order: every background first, then every glyph's
  // outline, then the glyphs — the order the browser paints the spans in
  const glyphs: [string, number, number, string][] = [];
  for (let y = 0; y < rows; y++) {
    const line = sprite[y];
    const crow = colors[y] ?? '';
    const y0 = Math.floor(y * lineH * r);
    const y1 = Math.floor((y + 1) * lineH * r);
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      const key = crow[x];
      const hex = key ? palette[key] : undefined;
      const eye = eyeRow === y && !!hex && isWarmBrown(hex);
      if (ch === ' ' && !eye) continue;
      const x0 = Math.floor(x * charW * r);
      const x1 = Math.floor((x + 1) * charW * r);
      if (solid && (eye || hex)) {
        ctx.fillStyle = eye ? EYE_BG : darken(hex!, 0.55);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (!eye && ch !== ' ') glyphs.push([ch, (x0 + x1) / 2, (y0 + y1) / 2, hex ?? base]);
    }
  }
  if (ring) {
    const o = r; // the CSS ring is 1px at the sprite's own scale
    ctx.fillStyle = ring;
    for (const [ch, x, y] of glyphs) {
      ctx.fillText(ch, x + o, y);
      ctx.fillText(ch, x - o, y);
      ctx.fillText(ch, x, y + o);
      ctx.fillText(ch, x, y - o);
    }
  }
  let last = '';
  for (const [ch, x, y, hex] of glyphs) {
    if (hex !== last) ctx.fillStyle = last = hex;
    ctx.fillText(ch, x, y);
  }
  return c;
}

export function SolidSpriteCanvas({
  sprite,
  colors,
  palette,
  eyeRow,
  className,
  style,
  charW,
  lineH,
  res,
  outline = '--player-outline',
  solid = true,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: SolidCanvasProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const cols = Math.max(0, ...sprite.map((l) => l.length));
  const rows = sprite.length;
  const r = Math.min(3, Math.max(0.5, Math.ceil(res * 4) / 4));
  React.useLayoutEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const cs = getComputedStyle(c);
    const base = cs.color || '#fff';
    const ring = outline ? cs.getPropertyValue(outline).trim() || '#000' : null;
    const font = cs.fontFamily || 'monospace';
    const key = `${r}|${charW}|${lineH}|${eyeRow}|${font}|${base}|${ring}|${solid}`;
    let byColors = solidCache.get(sprite);
    if (!byColors) solidCache.set(sprite, (byColors = new WeakMap()));
    let byPalette = byColors.get(colors);
    if (!byPalette) byColors.set(colors, (byPalette = new WeakMap()));
    let look = byPalette.get(palette);
    if (!look || look.key !== key) {
      if (look) look.img.width = look.img.height = 0; // old resolution: free it now
      look = { key, img: renderSolid(sprite, colors, palette, eyeRow, charW, lineH, r, font, base, ring, solid) };
      byPalette.set(palette, look);
    }
    const { img } = look;
    if (c.width !== img.width || c.height !== img.height) {
      c.width = img.width;
      c.height = img.height;
    } else ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
  }, [sprite, colors, palette, eyeRow, charW, lineH, r, outline, solid]);
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ position: 'absolute', width: `${cols}ch`, height: `${rows}em`, ...style }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}
