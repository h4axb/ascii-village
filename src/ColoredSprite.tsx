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
function darken(hex: string, factor: number): string {
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

// onClick/onMouseEnter/onMouseLeave are deliberately NOT compared: callers
// build these as fresh closures every render too, but each one only ever
// closes over that entity's own stable id and calls a stable outer setter
// the same way every time — semantically identical between renders for a
// given entity, so treating them as always-equal is correct (a memoized
// instance keeps whichever closure it mounted with, which behaves
// identically to a freshly-built one), not just a convenient shortcut.
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
    styleEqual(prev.style, next.style)
  );
}

export const ColoredSprite = React.memo(ColoredSpriteImpl, propsAreEqual);
