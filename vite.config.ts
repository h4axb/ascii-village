import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Dev-only save endpoint for the in-game world editor (src/devWorldAssets.ts,
// "E" panel). Placing/deleting there used to only ever reach localStorage —
// this is what makes it a REAL, permanent change: the browser POSTs its
// current {removedIds, added} state here and this writes it straight to
// src/data/worldOverrides.json, which src/world.ts merges into STRUCT_ENTS
// at module load. Registered via configureServer so it only exists while
// running `vite dev` (never in a production build/preview) — same
// dev-only boundary every other piece of this feature already respects
// (import.meta.env.DEV on the client side).
function worldOverridesSavePlugin(): Plugin {
  const filePath = path.resolve(__dirname, 'src/data/worldOverrides.json');
  return {
    name: 'world-overrides-save',
    // Without this, every write below would trigger Vite's normal HMR
    // reload for anything importing this JSON — which is effectively the
    // whole app via world.ts — forcing a full page reload (camera/player
    // position and all) after every single placement or deletion. The
    // running session's React state already reflects the change live; the
    // disk write is purely for NEXT load's persistence, so suppress the
    // reload here rather than disrupt whatever's currently happening.
    handleHotUpdate(ctx) {
      if (ctx.file === filePath) return [];
    },
    configureServer(server) {
      server.middlewares.use('/__dev/world-overrides', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          (async () => {
            try {
              const parsed = JSON.parse(body);
              if (!Array.isArray(parsed.removedIds) || !Array.isArray(parsed.added)) {
                throw new Error('expected { removedIds: string[], added: Ent[] }');
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

// Dev-only save endpoint for the in-game Scene Markings tool
// (src/devSceneMarkers.ts, part of the "E" editor's own second tab). Same
// shape as worldOverridesSavePlugin above, deliberately a SEPARATE endpoint
// and a SEPARATE file (src/data/sceneMarkers.json) — markers are editor
// metadata for later cinematics, not world entities, so they don't belong
// in worldOverrides.json alongside STRUCT_ENTS overrides.
function sceneMarkersSavePlugin(): Plugin {
  const filePath = path.resolve(__dirname, 'src/data/sceneMarkers.json');
  return {
    name: 'scene-markers-save',
    handleHotUpdate(ctx) {
      if (ctx.file === filePath) return [];
    },
    configureServer(server) {
      server.middlewares.use('/__dev/scene-markers', (req, res, next) => {
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
                throw new Error('expected Record<string, {x:number,y:number}>');
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

// Dev-only save endpoint for the DEV Intro Editor's "INTRO" tab
// (src/devIntroNarration.ts, part of the "E" editor). Same shape again:
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
  plugins: [react(), worldOverridesSavePlugin(), sceneMarkersSavePlugin(), introNarrationSavePlugin()],
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
