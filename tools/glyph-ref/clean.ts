// A dropped image -> the reference's art: background removed (transparency,
// or a plain backdrop flood-filled from the corners), cropped to the object,
// scaled to at most ART_MAX px. Photos (thousands of colours) are optionally
// turned into flat pixel art first, which bakes far more readably.
import { objectMask, medianCut, type Img, type RGB } from '../../src/glyph/bake';

export const ART_MAX = 128;

export function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('not an image'));
    im.src = url;
  });
}

function draw(im: CanvasImageSource, w: number, h: number, smooth: boolean): Img {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

export function countColours(img: Img): number {
  const s = new Set<number>();
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.data[i * 4 + 3] < 128) continue;
    s.add((img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2]);
    if (s.size > 5000) break;
  }
  return s.size;
}

export interface Cleaned {
  art: Img;
  photo: boolean; // looked like a photo (many colours)
  pixelized: boolean;
}

export function clean(im: HTMLImageElement, opts: { bgTolerance: number; pixelize: 'auto' | 'on' | 'off' }): Cleaned {
  // work at a manageable size first
  const k0 = Math.min(1, 512 / Math.max(im.width, im.height));
  const big = draw(im, Math.max(1, Math.round(im.width * k0)), Math.max(1, Math.round(im.height * k0)), true);
  const m = objectMask(big, { bg: 'auto', bgTolerance: opts.bgTolerance });
  let x0 = big.w, y0 = big.h, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++)
    if (m[i]) {
      const x = i % big.w, y = (i / big.w) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (x1 < 0) throw new Error('no object found (all background)');
  // cut out on a transparent canvas
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const cut = document.createElement('canvas');
  cut.width = bw;
  cut.height = bh;
  const cctx = cut.getContext('2d', { willReadFrequently: true })!;
  const id = cctx.createImageData(bw, bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const si = (y + y0) * big.w + x + x0, di = y * bw + x;
      if (!m[si]) continue;
      for (let c = 0; c < 3; c++) id.data[di * 4 + c] = big.data[si * 4 + c];
      id.data[di * 4 + 3] = 255;
    }
  cctx.putImageData(id, 0, 0);
  const k = Math.min(1, ART_MAX / Math.max(bw, bh));
  const w = Math.max(1, Math.round(bw * k)), h = Math.max(1, Math.round(bh * k));
  const art = draw(cut, w, h, true);
  // smoothing leaves soft alpha on the rim: make it binary
  for (let i = 0; i < w * h; i++) art.data[i * 4 + 3] = art.data[i * 4 + 3] >= 128 ? 255 : 0;
  const photo = countColours(art) > 900;
  const pixelized = opts.pixelize === 'on' || (opts.pixelize === 'auto' && photo);
  if (pixelized) {
    const cols: RGB[] = [];
    for (let i = 0; i < w * h; i++) if (art.data[i * 4 + 3]) cols.push([art.data[i * 4], art.data[i * 4 + 1], art.data[i * 4 + 2]]);
    const tone = medianCut(cols, 18);
    for (let i = 0; i < w * h; i++) {
      if (!art.data[i * 4 + 3]) continue;
      const t = tone([art.data[i * 4], art.data[i * 4 + 1], art.data[i * 4 + 2]]);
      art.data[i * 4] = t[0];
      art.data[i * 4 + 1] = t[1];
      art.data[i * 4 + 2] = t[2];
    }
  }
  return { art, photo, pixelized };
}

export function imgToDataUrl(img: Img, scale = 1): string {
  const cv = document.createElement('canvas');
  cv.width = img.w;
  cv.height = img.h;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  if (scale === 1) return cv.toDataURL('image/png');
  const big = document.createElement('canvas');
  big.width = img.w * scale;
  big.height = img.h * scale;
  const ctx = big.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cv, 0, 0, big.width, big.height);
  return big.toDataURL('image/png');
}

export async function imgFromDataUrl(url: string): Promise<Img> {
  const im = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  return draw(im, im.width, im.height, false);
}
