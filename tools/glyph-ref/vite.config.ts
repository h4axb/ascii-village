// The Glyph Ref Maker's own dev server (pnpm ref). A separate Vite root: the
// game's build never sees it. Its endpoints only read and write files under
// tools/glyph-ref/refs/ (and, when asked, a game asset in src/data/assets/):
//
//   GET  /__ref/list     the images in refs/src/ and whether each has settings
//   POST /__ref/upload   { name, dataUrl } -> refs/src/<name>  (a dropped image)
//   POST /__ref/save     { base, svg, json, asset?, gameSlug?, settings }
//                        -> refs/out/<base>.svg / .json (/.asset.json),
//                           refs/src/<stem>.ref.json (settings + marks),
//                           src/data/assets/<gameSlug>.json if gameSlug is set
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdir, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = __dirname;
const SRC = path.join(ROOT, 'refs/src');
const OUT = path.join(ROOT, 'refs/out');
const GAME_ASSETS = path.resolve(ROOT, '../../src/data/assets');
const IMG = /\.(png|webp|jpe?g|gif)$/i;
const safe = (s: string) => /^[\w.-]+$/.test(s) && !s.includes('..');

function body(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(s));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function refFiles(): Plugin {
  return {
    name: 'glyph-ref-files',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const send = (code: number, v: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(v));
        };
        try {
          if (req.url === '/__ref/list' && req.method === 'GET') {
            await mkdir(SRC, { recursive: true });
            const all = await readdir(SRC);
            const imgs = all.filter((f) => IMG.test(f)).sort();
            return send(200, imgs.map((f) => ({ file: f, settings: all.includes(f.replace(IMG, '') + '.ref.json') })));
          }
          if (req.url === '/__ref/upload' && req.method === 'POST') {
            const { name, dataUrl } = (await body(req)) as { name: string; dataUrl: string };
            if (!safe(name) || !IMG.test(name)) return send(400, { error: 'bad name' });
            await mkdir(SRC, { recursive: true });
            await writeFile(path.join(SRC, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
            return send(200, { saved: `refs/src/${name}` });
          }
          if (req.url === '/__ref/save' && req.method === 'POST') {
            const b = (await body(req)) as { base: string; stem: string; svg: string; json: string; asset?: string; gameSlug?: string; settings: string };
            if (!safe(b.base) || !safe(b.stem) || (b.gameSlug && !safe(b.gameSlug))) return send(400, { error: 'bad name' });
            await mkdir(OUT, { recursive: true });
            const saved: string[] = [];
            await writeFile(path.join(OUT, `${b.base}.svg`), b.svg);
            saved.push(`refs/out/${b.base}.svg`);
            await writeFile(path.join(OUT, `${b.base}.json`), b.json);
            saved.push(`refs/out/${b.base}.json`);
            if (b.asset) {
              await writeFile(path.join(OUT, `${b.base}.asset.json`), b.asset);
              saved.push(`refs/out/${b.base}.asset.json`);
            }
            await writeFile(path.join(SRC, `${b.stem}.ref.json`), b.settings);
            if (b.gameSlug && b.asset) {
              await access(GAME_ASSETS);
              await writeFile(path.join(GAME_ASSETS, `${b.gameSlug}.json`), b.asset);
              saved.push(`src/data/assets/${b.gameSlug}.json`);
            }
            return send(200, { saved });
          }
        } catch (err) {
          return send(500, { error: String(err) });
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: ROOT,
  plugins: [react(), refFiles()],
  server: { port: 5180, fs: { allow: [path.resolve(ROOT, '../..')] } },
});
