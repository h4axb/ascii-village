// An ASCII sprite fitted into a fixed box: drawn at its natural size, then
// scaled so it fills the box without ever changing the box itself — every
// slot keeps the same size whatever the item's dimensions. `maxScale` caps
// how far a small sprite may grow (1 = only ever shrink).
import { useLayoutEffect, useRef, useState } from 'react';
import { ColoredSprite, type TextureModifier } from '../ColoredSprite';

export interface SpriteLook {
  sprite: string[];
  colors?: string[];
  palette?: Record<string, string>;
  color?: string;
  texture?: TextureModifier;
}

export function FitSprite({
  look,
  className,
  fill = 0.8,
  maxScale = 1,
  cover = false,
  solid,
  cells = false,
}: {
  look: SpriteLook;
  className?: string;
  fill?: number; // share of the box the sprite may cover
  maxScale?: number;
  // fill the box on its SHORT side and let the rest be clipped (a portrait
  // crop of a wide face) instead of fitting the whole sprite in
  cover?: boolean;
  // the player's per-cell backing + eyes, as in the world (see ColoredSprite)
  solid?: { eyeRow?: number };
  // every drawn glyph on a darkened backing of its own colour, as the dates
  // and flowers in the world (a look without a palette gets one from its
  // colour)
  cells?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const b = box.current;
    const inner = b?.firstElementChild as HTMLElement | null;
    if (!b || !inner) return;
    const fit = () => {
      const w = inner.offsetWidth;
      const h = inner.offsetHeight;
      if (!w || !h) return;
      const kw = (b.clientWidth * fill) / w;
      const kh = (b.clientHeight * fill) / h;
      setK(Math.min(maxScale, cover ? Math.max(kw, kh) : Math.min(kw, kh)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    // the first measure can land before the font has loaded
    let alive = true;
    document.fonts?.ready.then(() => alive && fit());
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [look.sprite, fill, maxScale, cover, cells]);
  const cellLook = cells && !(look.colors && look.palette && Object.keys(look.palette).length) ? oneColour(look) : look;
  return (
    <div className={'ds-fit' + (className ? ' ' + className : '')} ref={box}>
      <ColoredSprite
        sprite={cellLook.sprite}
        colors={cellLook.colors}
        palette={cellLook.palette}
        color={cellLook.color}
        texture={cellLook.texture}
        solidCells={!!solid || cells}
        eyeRow={solid?.eyeRow}
        style={{ transform: `translate(-50%, -50%) scale(${k})` }}
      />
    </div>
  );
}

// A single-colour look as a one-key palette, so it can take per-cell backing
const CREAM = '#e9dcc1';
function oneColour(look: SpriteLook): SpriteLook {
  const hex = look.color ?? CREAM;
  return { ...look, palette: { a: hex }, colors: look.sprite.map((l) => l.replace(/[^ ]/g, 'a')) };
}
