// The hint's sparkles round the nearest resources (quests.ts hint.sparkles):
// 2-4 at a time, each a four-point star that grows in white, peaks, turns
// magenta and shrinks to a twinkle; about half end with a ring that spins
// open round the star, breaks into dashes and widens away. Each one is
// placed at a random spot on one of the resources, a little bigger or
// smaller than the last. Drawn in the world layer (ch / em units).
import { useEffect, useRef, useState } from 'react';

export interface SparkleBox {
  key: string;
  x: number; // ch
  y: number; // em
  w: number; // ch
  h: number; // em
}
interface Sparkle {
  id: number;
  x: number; // ch
  y: number; // em
  size: number; // ch
  ring: boolean;
  born: number;
}

const LIFE_MS = 1400;
const RING_LIFE_MS = 1700;
const TICK_MS = 120;
const STAR = 'M0,-10 Q1.3,-1.3 10,0 Q1.3,1.3 0,10 Q-1.3,1.3 -10,0 Q-1.3,-1.3 0,-10Z';

export function HintSparkles({ boxes }: { boxes: SparkleBox[] }) {
  const [list, setList] = useState<Sparkle[]>([]);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const want = useRef(3);
  const next = useRef(1);
  useEffect(() => {
    if (!boxes.length) {
      setList([]);
      return;
    }
    const t = window.setInterval(() => {
      const now = performance.now();
      setList((l) => {
        const live = l.filter((s) => now - s.born < (s.ring ? RING_LIFE_MS : LIFE_MS));
        const bs = boxesRef.current;
        // one more when under the count, with a little random delay; the
        // count wanders between 2 and 4
        if (bs.length && live.length < want.current && (live.length < 2 || Math.random() < 0.45)) {
          const b = bs[Math.floor(Math.random() * bs.length)];
          live.push({
            id: next.current++,
            x: b.x + b.w * (0.1 + Math.random() * 0.8),
            y: b.y + b.h * (0.05 + Math.random() * 0.8),
            size: 2.2 * (0.8 + Math.random() * 0.5),
            ring: Math.random() < 0.5,
            born: now,
          });
          want.current = 2 + Math.floor(Math.random() * 3);
        }
        return live.length === l.length && live.every((s, i) => s === l[i]) ? l : live;
      });
    }, TICK_MS);
    return () => window.clearInterval(t);
  }, [boxes.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {list.map((s) => (
        <svg
          key={s.id}
          className={'hint-spark' + (s.ring ? ' ring' : '')}
          viewBox="-20 -20 40 40"
          aria-hidden="true"
          style={{ left: `${s.x}ch`, top: `${s.y}em`, width: `${s.size * 2}ch`, height: `${s.size * 2}ch` }}
        >
          {s.ring && (
            <>
              <circle className="hs-ring" r="11" />
              <g className="hs-dash">
                <circle r="11" />
                <path d="M0,-15 V-12.5 M15,0 H12.5 M0,15 V12.5 M-15,0 H-12.5" />
              </g>
            </>
          )}
          <path className="hs-star" d={STAR} />
        </svg>
      ))}
    </>
  );
}
