import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { docHash } from './src/editor/docHash';

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

export default defineConfig({
  plugins: [react(), worldEditorSavePlugin(), introNarrationSavePlugin()],
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
