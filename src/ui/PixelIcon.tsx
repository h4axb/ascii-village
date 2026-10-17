// A pixel-art icon: one character per pixel ('.' = clear), each colour by
// key (CSS colours, design-system variables too), every pixel `px` CSS px
// square so it stays crisp. `size` sets the height in CSS px instead (the
// width follows), for icons that sit in a line of text.
import type { ReactNode } from 'react';

export function PixelIcon({
  map,
  colors,
  px = 2,
  size,
  className,
}: {
  map: string[];
  colors: Record<string, string>;
  px?: number;
  size?: number;
  className?: string;
}) {
  const rects: ReactNode[] = [];
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const k = row[x];
      let n = 1;
      while (row[x + n] === k) n++;
      if (colors[k]) rects.push(<rect key={`${x},${y}`} x={x} y={y} width={n} height={1} fill={colors[k]} />);
      x += n;
    }
  });
  const w = Math.max(...map.map((r) => r.length));
  const scale = size ? size / map.length : px;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${map.length}`}
      width={w * scale}
      height={map.length * scale}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {rects}
    </svg>
  );
}
