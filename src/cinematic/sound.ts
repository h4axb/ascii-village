// The notification chime of the intro cinematic (src/cinematic/): the game
// has no sound files, so it is synthesized - two soft sine notes, a short
// ding-dong, like a mail app's. Quiet (SOUND.volume in config.ts), never
// overlapping (SOUND.minGap), and silent if audio is unavailable.
import { SOUND } from './config';

let ctx: AudioContext | null = null;
let last = -Infinity;

export function chime(): void {
  if (!SOUND.enabled) return;
  const now = performance.now();
  if (now - last < SOUND.minGap) return;
  last = now;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = SOUND.volume;
    out.connect(ctx.destination);
    // two notes, the second a fourth below, each a quick attack and a soft tail
    [
      [1318.5, 0, 0.55],
      [987.8, 0.11, 0.8],
    ].forEach(([f, at, len]) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.6, t0 + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g).connect(out);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.05);
    });
  } catch {
    // no audio: the cinematic goes on without it
  }
}
