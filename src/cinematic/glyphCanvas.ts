// ---------------------------------------------------------------------------
// A full-screen GLYPH CANVAS for the cinematic's water-and-door scene
// (scene.ts): a grid of character cells, each with a glyph, a glyph colour
// and an optional backing colour (the game's look: a glyph on a darker
// backing of its own colour).
//
// Per frame the scene fills the buffer, then draw() paints it in three cheap
// passes, with no fillText per frame: the backings as a one-pixel-per-cell
// image scaled up; every glyph stamped in white from a small atlas; their
// colours as another one-pixel-per-cell image, scaled up and kept only where
// a glyph is (destination-in).
//
// The cells are square here, like the door's glyph drawing (door.ts), so its
// cells map one to one onto the canvas. draw() can move a camera (a scale
// about a point plus an offset) without re-sampling.
// ---------------------------------------------------------------------------
import { GLYPH_FONT } from './config';

// every glyph the scene uses (index 0 = empty)
// (the door's own glyphs, and the falling phrases' letters)
export const GLYPHSET = ' ·.:,\'`-~=+*oO0@°|/\\_v^&%§¤‡†¥Ø#≈()<>!;"ˇY¦¬AUacdefilnoprstuy';
const GI = new Map([...GLYPHSET].map((c, i) => [c, i]));
export const g = (c: string): number => GI.get(c) ?? 0;

export type RGB = [number, number, number];
export const pack = (c: RGB): number => ((Math.max(0, Math.min(255, c[0] | 0)) << 16) | (Math.max(0, Math.min(255, c[1] | 0)) << 8) | Math.max(0, Math.min(255, c[2] | 0))) >>> 0;
export const NONE = 0xffffffff;

export class GlyphCanvas {
  readonly cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  cw = 10; // cell size, CSS px
  ch = 18;
  cols = 0;
  rows = 0;
  vw = 0;
  vh = 0;
  private dpr = 1;
  glyph = new Uint8Array(0);
  fg = new Uint32Array(0);
  bg = new Uint32Array(0);
  // white glyph stamps, one per glyph (colour comes from the tint layer)
  private atlas = document.createElement('canvas');
  // per frame: the glyphs in white, the per-cell colours, both full size
  private mask = document.createElement('canvas');
  private tint = document.createElement('canvas');
  // one pixel per cell: backings and glyph colours, scaled up without smoothing
  private small = document.createElement('canvas');
  private smallImg: ImageData | null = null;

  constructor(cv: HTMLCanvasElement) {
    this.cv = cv;
    this.ctx = cv.getContext('2d', { alpha: true })!;
  }

  // square cells of `cell` px; glyphs drawn at `font` of the cell's height
  resize(vw: number, vh: number, cell: number, font = 0.75) {
    if (vw === this.vw && vh === this.vh && cell === this.cw) return;
    this.vw = vw;
    this.vh = vh;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = Math.max(5, cell);
    this.ch = this.cw;
    this.cols = Math.ceil(vw / this.cw);
    this.rows = Math.ceil(vh / this.ch);
    const n = this.cols * this.rows;
    this.glyph = new Uint8Array(n);
    this.fg = new Uint32Array(n);
    this.bg = new Uint32Array(n).fill(NONE);
    const W = Math.round(this.cols * this.cw * this.dpr), H = Math.round(this.rows * this.ch * this.dpr);
    this.cv.width = Math.round(vw * this.dpr);
    this.cv.height = Math.round(vh * this.dpr);
    this.cv.style.width = `${vw}px`;
    this.cv.style.height = `${vh}px`;
    for (const c of [this.mask, this.tint]) {
      c.width = W;
      c.height = H;
    }
    this.small.width = this.cols;
    this.small.height = this.rows;
    this.smallImg = new ImageData(this.cols, this.rows);
    // the stamps: every glyph once, white, at this cell size
    const tw = Math.ceil(this.cw * this.dpr), th = Math.ceil(this.ch * this.dpr);
    this.atlas.width = tw * GLYPHSET.length;
    this.atlas.height = th;
    const a = this.atlas.getContext('2d')!;
    a.font = `${this.ch * this.dpr * font}px ${GLYPH_FONT}`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    a.fillStyle = '#fff';
    [...GLYPHSET].forEach((c, i) => {
      if (i) a.fillText(c, i * tw + tw / 2, th / 2 + th * 0.04);
    });
  }

  clear() {
    this.glyph.fill(0);
    this.bg.fill(NONE);
  }

  // paint the buffer over a base colour (the scene's darkness); cam scales
  // the picture by s about (fx, fy) and shifts it by (dx, dy), CSS px
  draw(base: string, opacity = 1, cam = { s: 1, fx: 0, fy: 0, dx: 0, dy: 0 }) {
    const { ctx, cols, rows, dpr } = this;
    const W = this.mask.width, H = this.mask.height;
    const px = this.smallImg!;
    const d = px.data;
    // 1. backings: one pixel per cell, scaled up
    for (let i = 0; i < cols * rows; i++) {
      const b = this.bg[i];
      const o = i * 4;
      if (b === NONE) {
        d[o + 3] = 0;
        continue;
      }
      d[o] = b >> 16;
      d[o + 1] = (b >> 8) & 255;
      d[o + 2] = b & 255;
      d[o + 3] = 255;
    }
    const sctx = this.small.getContext('2d')!;
    sctx.putImageData(px, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.imageSmoothingEnabled = false;
    const k = dpr * (1 - cam.s);
    ctx.setTransform(cam.s, 0, 0, cam.s, cam.fx * k + cam.dx * dpr, cam.fy * k + cam.dy * dpr);
    ctx.drawImage(this.small, 0, 0, cols, rows, 0, 0, W, H);
    // 2. the glyphs in white
    const m = this.mask.getContext('2d')!;
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, W, H);
    const tw = Math.ceil(this.cw * dpr), th = Math.ceil(this.ch * dpr);
    const cw = this.cw * dpr, chh = this.ch * dpr;
    for (let r = 0, i = 0; r < rows; r++) {
      const y0 = Math.floor(r * chh);
      for (let c = 0; c < cols; c++, i++) {
        const gi = this.glyph[i];
        if (gi) m.drawImage(this.atlas, gi * tw, 0, tw, th, Math.floor(c * cw), y0, tw, th);
      }
    }
    // 3. their colours, one pixel per cell, scaled up, kept only where a glyph is
    for (let i = 0; i < cols * rows; i++) {
      const f = this.fg[i];
      const o = i * 4;
      d[o] = f >> 16;
      d[o + 1] = (f >> 8) & 255;
      d[o + 2] = f & 255;
      d[o + 3] = this.glyph[i] ? 255 : 0;
    }
    sctx.putImageData(px, 0, 0);
    const tctx = this.tint.getContext('2d')!;
    tctx.globalCompositeOperation = 'source-over';
    tctx.imageSmoothingEnabled = false;
    tctx.clearRect(0, 0, W, H);
    tctx.drawImage(this.small, 0, 0, cols, rows, 0, 0, W, H);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(this.mask, 0, 0);
    ctx.imageSmoothingEnabled = cam.s !== 1;
    ctx.drawImage(this.tint, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
}
