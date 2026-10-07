// The Glyph Generator's own dev server (pnpm ref). A separate Vite root: the
// game's build never sees it. Endpoints:
//
//   GET  /__ref/ai          is a vision model configured (.env VITE_LLM_API_KEY)?
//   POST /__ref/automark    { image, hint, vocab } -> the model's marks (JSON)
//   GET  /__ref/work        the batch in progress (refs/work/*.json)
//   POST /__ref/work        { id, item } -> refs/work/<id>.json (autosave)
//   POST /__ref/work-delete { id }
//   POST /__ref/send-asset  { slug, asset, overwrite? } -> src/data/assets/<slug>.json
//   POST /__ref/send-ref    { id, ref, art, overwrite? } -> src/data/refs/<id>/ref.json + art.png
//
// Writes only under tools/glyph-ref/refs/, src/data/assets/ and src/data/refs/.
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdir, readdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = __dirname;
const REPO = path.resolve(ROOT, '../..');
const WORK = path.join(ROOT, 'refs/work');
const GAME_ASSETS = path.join(REPO, 'src/data/assets');
const GAME_REFS = path.join(REPO, 'src/data/refs');
const safe = (s: unknown): s is string => typeof s === 'string' && /^[\w-]+$/.test(s);
const exists = (p: string) => access(p).then(() => true, () => false);

function body(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(s || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const MARK_PROMPT = (hint: unknown, vocab: unknown) => `You mark up a game reference picture (pixel art of ONE object on a transparent background) for a crafting generator that recolours and swaps its parts.

Known categories and the part names to use for each: ${JSON.stringify(vocab)}
What the file's folder suggests (may be empty): ${JSON.stringify(hint)}

Reply with JSON only:
{
  "role": "body" | "part" | "decoration",   // body = a whole object (a boat); part = one swappable part on its own (a sail); decoration = a small extra (a flag, a gem)
  "category": one of the known categories,
  "partType": for role "part": which part name it is, else "",
  "title": a short name (2-4 words),
  "tags": 3-6 short traits (style, material, mood: "pirate", "wooden", "cute"),
  "description": one cozy sentence about it,
  "sizeBand": "small" | "medium" | "large",
  "parts": [ { "name": a part name from the category's list, "zone": "primary" | "secondary" | "trim" | "fixed", "polygon": [[x, y], ...] } ],
  "anchors": [ { "name": the part name a swapped part should attach at (e.g. "sail" at the mast where the sail hangs), or "attach" for a part/decoration's own fixing point, "x": 0-1, "y": 0-1 } ],
  "areas": [ { "name": short id, "type": "decoration" | "detail", "x", "y", "w", "h": 0-1 box, "accepts": decoration tags it suits (decoration areas), "part": the part a detail is drawn on (detail areas) } ]
}
Rules:
- Coordinates are fractions of the picture: x from the left edge, y from the top edge.
- Outline EVERY visible part with a polygon of 4-12 points that follows its outline; parts may overlap, smaller parts are drawn on top.
- zone: primary = the main material, secondary = the second material, trim = edges and small accents, fixed = must never change colour (eyes, faces, outlines).
- Give 1-3 decoration areas where an extra would look natural (top of a mast, the bow, a collar), and 1-2 detail areas on big flat parts (a sail, a hull side) where a painted motif could go.`;

function refFiles(env: Record<string, string>): Plugin {
  const key = (env.VITE_LLM_API_KEY ?? '').trim();
  const base = (env.VITE_LLM_BASE_URL?.trim() || 'https://router.requesty.ai/v1').replace(/\/$/, '');
  const model = env.VITE_LLM_MODEL_WORLDASSET?.trim() || 'anthropic/claude-haiku-4-5-20251001';
  return {
    name: 'glyph-ref-files',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const send = (code: number, v: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(v));
        };
        const url = req.url?.split('?')[0];
        try {
          if (url === '/__ref/ai') return send(200, { ok: key.length > 0 && key !== 'test', model });
          if (url === '/__ref/automark' && req.method === 'POST') {
            if (!key || key === 'test') return send(400, { error: 'no VITE_LLM_API_KEY in .env' });
            const b = await body(req);
            const r = await fetch(`${base}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body: JSON.stringify({
                model,
                temperature: 0.2,
                max_tokens: 2500,
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: MARK_PROMPT(b.hint, b.vocab) },
                      { type: 'image_url', image_url: { url: b.image } },
                    ],
                  },
                ],
              }),
            });
            const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; error?: unknown };
            if (!r.ok) return send(502, { error: `model: ${JSON.stringify(j.error ?? r.statusText).slice(0, 300)}` });
            const text = j.choices?.[0]?.message?.content ?? '';
            const m = text.match(/\{[\s\S]*\}/);
            if (!m) return send(502, { error: 'the model sent no JSON' });
            return send(200, JSON.parse(m[0]));
          }
          if (url === '/__ref/work' && req.method === 'GET') {
            await mkdir(WORK, { recursive: true });
            const files = (await readdir(WORK)).filter((f) => f.endsWith('.json')).sort();
            const items = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(WORK, f), 'utf8'))));
            return send(200, items);
          }
          if (url === '/__ref/work' && req.method === 'POST') {
            const b = await body(req);
            if (!safe(b.id)) return send(400, { error: 'bad id' });
            await mkdir(WORK, { recursive: true });
            await writeFile(path.join(WORK, `${b.id}.json`), JSON.stringify(b.item));
            return send(200, { ok: true });
          }
          if (url === '/__ref/work-delete' && req.method === 'POST') {
            const b = await body(req);
            if (!safe(b.id)) return send(400, { error: 'bad id' });
            await rm(path.join(WORK, `${b.id}.json`), { force: true });
            return send(200, { ok: true });
          }
          if (url === '/__ref/send-asset' && req.method === 'POST') {
            const b = await body(req);
            if (!safe(b.slug)) return send(400, { error: 'bad name' });
            const file = path.join(GAME_ASSETS, `${b.slug}.json`);
            if (!b.overwrite && (await exists(file))) return send(409, { error: 'exists', file: `src/data/assets/${b.slug}.json` });
            await writeFile(file, JSON.stringify(b.asset, null, 2) + '\n');
            return send(200, { saved: `src/data/assets/${b.slug}.json` });
          }
          if (url === '/__ref/send-ref' && req.method === 'POST') {
            const b = await body(req);
            if (!safe(b.id) || typeof b.art !== 'string') return send(400, { error: 'bad id' });
            const dir = path.join(GAME_REFS, b.id);
            if (!b.overwrite && (await exists(dir))) return send(409, { error: 'exists', file: `src/data/refs/${b.id}/` });
            await mkdir(dir, { recursive: true });
            await writeFile(path.join(dir, 'ref.json'), JSON.stringify(b.ref) + '\n');
            await writeFile(path.join(dir, 'art.png'), Buffer.from(b.art.split(',')[1], 'base64'));
            return send(200, { saved: `src/data/refs/${b.id}/` });
          }
        } catch (err) {
          return send(500, { error: String(err) });
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: ROOT,
  plugins: [react(), refFiles(loadEnv(mode, REPO, ''))],
  server: { port: 5180, fs: { allow: [REPO] } },
}));
