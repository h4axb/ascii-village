import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { docHash } from './src/editor/docHash';
import { handleFeedback, type FeedbackEnv } from './functions/api/feedback';
import { handleParticipant } from './functions/api/participant';
import { gateLlm, handleAdmin, handleSession, type SessionEnv } from './functions/api/session';
import { handleEvents } from './functions/api/events';
import { handleStudy } from './functions/api/study';
import { onRequestPost } from './functions/api/chat/completions';

// Dev-only save endpoint for the in-game world editor (src/editor/, press E).
// The editor never writes on its own: Ctrl+S / Save POSTs everything it edits
// in one request, and this writes the files you then commit and push:
//
//   src/data/world.json         objects moved / removed / added, colliders
//   src/data/sceneMarkers.json  scene marker positions
//   src/data/assets.meta.json   per-asset kind / scale / label
//
// Each file comes with the fingerprint (src/editor/docHash.ts) of the copy
// the editor loaded. If the file on disk no longer matches it (another tab
// saved, a git pull, a hand edit), nothing is written and the editor gets a
// 409 naming the files, instead of silently overwriting newer work.
//
// Registered via configureServer, so it only exists under `vite dev` — never
// in a build or `vite preview`.
const EDITOR_FILES = {
  world: 'src/data/world.json',
  markers: 'src/data/sceneMarkers.json',
  meta: 'src/data/assets.meta.json',
} as const;
type EditorFile = keyof typeof EDITOR_FILES;

function worldEditorSavePlugin(): Plugin {
  const abs = (f: EditorFile) => path.resolve(__dirname, EDITOR_FILES[f]);
  const files = Object.keys(EDITOR_FILES) as EditorFile[];
  return {
    name: 'world-editor-save',
    // Without this, writing world.json would hot-reload everything that
    // imports it (effectively the whole game, via world.ts) and throw away
    // the editing session. The editor already shows what it saved; the next
    // page load reads the new files.
    handleHotUpdate(ctx) {
      if (files.some((f) => ctx.file === abs(f))) return [];
    },
    configureServer(server) {
      server.middlewares.use('/__dev/save-world', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          (async () => {
            const reply = (status: number, data: unknown) => {
              res.statusCode = status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
            };
            try {
              const parsed = JSON.parse(body) as {
                docs: Partial<Record<EditorFile, unknown>>;
                base: Partial<Record<EditorFile, string>>;
              };
              const w = parsed.docs?.world as { version?: number; added?: unknown; removed?: unknown } | undefined;
              if (w && (w.version !== 2 || !Array.isArray(w.added) || !Array.isArray(w.removed))) {
                return reply(400, { error: 'world.json must be a version 2 document' });
              }
              const conflicts: string[] = [];
              for (const f of files) {
                if (parsed.docs?.[f] === undefined) continue;
                let onDisk: unknown = {};
                try {
                  onDisk = JSON.parse(await readFile(abs(f), 'utf-8'));
                } catch {
                  // missing file: counts as empty
                }
                if (docHash(onDisk) !== parsed.base?.[f]) conflicts.push(EDITOR_FILES[f]);
              }
              if (conflicts.length) return reply(409, { error: 'changed on disk', files: conflicts });
              const hashes: Partial<Record<EditorFile, string>> = {};
              for (const f of files) {
                const doc = parsed.docs?.[f];
                if (doc === undefined) continue;
                await writeFile(abs(f), JSON.stringify(doc, null, 2) + '\n', 'utf-8');
                hashes[f] = docHash(doc);
              }
              reply(200, { saved: Object.keys(hashes).map((f) => EDITOR_FILES[f as EditorFile]), hashes });
            } catch (err) {
              reply(400, { error: String(err) });
            }
          })();
        });
      });
    },
  };
}

// Dev-only upload for the start screen's title image (the world editor's
// Start screen tab): the PNG in the request body becomes
// public/start-title.png, written at once. Where it's drawn, how big and
// turned, and its version (so browsers fetch the new picture) are part of
// world.json, saved with the world.
function startTitleUploadPlugin(): Plugin {
  const filePath = path.resolve(__dirname, 'public/start-title.png');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const MAX = 12 * 1024 * 1024;
  return {
    name: 'start-title-upload',
    configureServer(server) {
      server.middlewares.use('/__dev/save-title', (req, res, next) => {
        if (req.method !== 'POST') return next();
        const chunks: Buffer[] = [];
        let size = 0;
        const reply = (status: number, data: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX) chunks.push(chunk);
        });
        req.on('end', () => {
          (async () => {
            const body = Buffer.concat(chunks);
            if (size > MAX) return reply(413, { error: 'the image is over 12 MB' });
            if (body.length < 8 || !body.subarray(0, 8).equals(PNG)) return reply(400, { error: 'not a PNG file' });
            await writeFile(filePath, body);
            reply(200, { saved: 'public/start-title.png', bytes: body.length });
          })().catch((err) => reply(500, { error: String(err) }));
        });
      });
    },
  };
}

// Dev-only save endpoint for the DEV Intro Editor's "INTRO" tab
// (src/devIntroNarration.ts, part of the "E" editor). Same idea as above:
// POSTs the editor's current { [stageId]: NarrationBeat[] } working copy
// (mirroring introNarrationData.ts's own INTRO_NARRATION shape) straight to
// src/data/introNarrationOverrides.json, which introNarrationData.ts merges
// into INTRO_NARRATION at module load — at BOTH dev-server and production
// build time, so a saved beat is real shipped content, not just a live-
// session preview.
function introNarrationSavePlugin(): Plugin {
  const filePath = path.resolve(__dirname, 'src/data/introNarrationOverrides.json');
  return {
    name: 'intro-narration-save',
    handleHotUpdate(ctx) {
      if (ctx.file === filePath) return [];
    },
    configureServer(server) {
      server.middlewares.use('/__dev/intro-narration', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          (async () => {
            try {
              const parsed = JSON.parse(body);
              if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('expected Partial<Record<IntroStageId, NarrationBeat[]>>');
              }
              await writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
              res.statusCode = 204;
              res.end();
            } catch (err) {
              res.statusCode = 400;
              res.end(String(err));
            }
          })();
        });
      });
    },
  };
}

// Dev-only save endpoints for the world editor's Theme and Ground tabs: each
// writes one data file (src/theme.ts / src/ground.ts read them). Not
// hot-reloaded on write, so the editing session stays.
function jsonSavePlugin(name: string, route: string, file: string, valid: (v: unknown) => boolean): Plugin {
  const filePath = path.resolve(__dirname, file);
  return {
    name,
    handleHotUpdate(ctx) {
      if (ctx.file === filePath) return [];
    },
    configureServer(server) {
      server.middlewares.use(route, (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          (async () => {
            try {
              const parsed = JSON.parse(body);
              if (!valid(parsed)) throw new Error(`not a valid ${file}`);
              await writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
              res.statusCode = 204;
              res.end();
            } catch (err) {
              res.statusCode = 400;
              res.end(String(err));
            }
          })();
        });
      });
    },
  };
}
const themeSavePlugin = () =>
  jsonSavePlugin('theme-save', '/__dev/save-theme', 'src/data/theme.json', (v) => {
    const d = v as { active?: unknown; presets?: unknown };
    return !!d && typeof d.active === 'string' && typeof d.presets === 'object';
  });
const shipSeatsSavePlugin = () =>
  jsonSavePlugin('ship-seats-save', '/__dev/save-ship-seats', 'src/data/shipSeats.json', (v) => !!v && typeof v === 'object' && !Array.isArray(v));
const seatsSavePlugin = () =>
  jsonSavePlugin('seats-save', '/__dev/save-seats', 'src/data/seats.json', (v) => !!v && typeof v === 'object' && !Array.isArray(v));
const groundSavePlugin = () =>
  jsonSavePlugin('ground-save', '/__dev/save-ground', 'src/data/ground.json', (v) => {
    const d = v as { cells?: unknown; stones?: unknown };
    return !!d && typeof d.cells === 'string' && Array.isArray(d.stones);
  });

// The Worker's /api routes under `pnpm dev` and `vite preview`, running the
// real handlers (functions/api/*) against a local SQLite file standing in for
// Cloudflare D1 (.dev-d1.sqlite, not committed): crafting feedback, the
// participant ids, personal invite links and their AI budgets, the run log
// and the dashboard's Participants tab. The dashboard password here is
// FEEDBACK_ADMIN_TOKEN from the environment, or "dev". Under `vite preview`
// (a production build) the LLM proxy runs too, with the key from
// LLM_API_KEY / VITE_LLM_API_KEY and LLM_BASE_URL from the environment.
function workerApiDevPlugin(): Plugin {
  type Env = SessionEnv & FeedbackEnv & Record<string, unknown>;
  let env: Env | null = null;
  async function getEnv(): Promise<Env> {
    if (env) return env;
    const { DatabaseSync } = (await import('node:sqlite' as string)) as {
      DatabaseSync: new (file: string) => { exec(sql: string): void; prepare(sql: string): { run(...v: unknown[]): unknown; all(...v: unknown[]): unknown[] } };
    };
    const sqlite = new DatabaseSync(path.resolve(__dirname, '.dev-d1.sqlite'));
    sqlite.exec(await readFile(path.resolve(__dirname, 'worker/feedback.sql'), 'utf-8'));
    // the D1 calls the handlers use: prepare().bind().run()/all()
    const db = {
      prepare(sql: string) {
        let vals: unknown[] = [];
        const st = {
          bind(...v: unknown[]) {
            vals = v.map((x) => (x === undefined ? null : x));
            return st;
          },
          async run() {
            return sqlite.prepare(sql).run(...vals);
          },
          async all<T>() {
            return { results: sqlite.prepare(sql).all(...vals) as T[] };
          },
        };
        return st;
      },
    };
    const e = process.env;
    env = {
      FEEDBACK_DB: db as never,
      FEEDBACK_ADMIN_TOKEN: e.FEEDBACK_ADMIN_TOKEN || 'dev',
      LLM_API_KEY: e.LLM_API_KEY || e.VITE_LLM_API_KEY,
      LLM_BASE_URL: e.LLM_BASE_URL,
      // (dev only: /api/study/translate answers "[DE] …" without a key, for testing)
      STUDY_FAKE_AI: e.STUDY_FAKE_AI,
      LLM_ALLOWED_MODELS: e.LLM_ALLOWED_MODELS,
      LLM_OPEN_DAILY_LIMIT: e.LLM_OPEN_DAILY_LIMIT,
    };
    return env;
  }
  const route = (p: string) =>
    p === '/api/feedback' || p === '/api/feedback/tags' || p === '/api/participant' || p === '/api/events' || p === '/api/chat/completions' || p.startsWith('/api/session/') || p.startsWith('/api/admin/') || p.startsWith('/api/study');
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.originalUrl ?? req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (!route(url.pathname)) return next();
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
        const request = new Request(url, { method: req.method, headers, body });
        const e = await getEnv();
        const p = url.pathname;
        let out: Response;
        if (p === '/api/chat/completions') out = (await gateLlm(request, e)) ?? (await onRequestPost({ request, env: e as never }));
        else if (p.startsWith('/api/feedback')) out = await handleFeedback(request, e);
        else if (p === '/api/participant') out = await handleParticipant(request, e);
        else if (p === '/api/events') out = await handleEvents(request, e);
        else if (p.startsWith('/api/session/')) out = await handleSession(request, e);
        else if (p.startsWith('/api/study')) out = await handleStudy(request, e as never);
        else out = await handleAdmin(request, e);
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await out.arrayBuffer()));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  };
  return {
    name: 'worker-api-dev',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), worldEditorSavePlugin(), startTitleUploadPlugin(), introNarrationSavePlugin(), themeSavePlugin(), groundSavePlugin(), shipSeatsSavePlugin(), seatsSavePlugin(), workerApiDevPlugin()],
  server: {
    // Pinned so a dev server never silently drifts onto a different port
    // (Vite's default is to auto-increment on conflict) — localStorage is
    // origin-scoped, so a tab on :5173 and a later reload landing on :5174
    // would look like data loss when it's actually just a different storage
    // bucket. Failing loudly on a taken port is easier to diagnose than that.
    port: 5173,
    strictPort: true,
    proxy: {
      // Cloudflare's REST API sends no CORS headers (it's built for
      // server/CLI use, not direct browser calls) — the dev server forwards
      // the request server-side instead, so the browser never sees the
      // cross-origin block. See src/imageGen.ts for the matching client code.
      '/cf-ai': {
        target: 'https://api.cloudflare.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cf-ai/, ''),
      },
    },
  },
});
