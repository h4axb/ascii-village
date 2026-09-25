// ---------------------------------------------------------------------------
// SILHOUETTE-FIRST PLANNING — Stage 1 evaluation tool (see the plan at
// C:\Users\hanah\.claude\plans\greedy-orbiting-dream.md).
//
// Runs the REAL production planner (planCraft) and renderer (renderRegions,
// renderMask) against a batch of prompts and prints a raw geometry MASK
// side by side with the final TEXTURED sprite, using exactly the same
// resolved CraftPlan for both — so silhouette quality can be judged
// independently of texture/shading. Kept as a dev tool (not throwaway):
// reused for every later stage's own stop/go gate, same status as
// scripts/craft-plan-prototype.mjs.
//
// Self-bundles its .ts entry (scripts/ can't import .ts directly) via
// esbuild's JS API, using the same import.meta.env -> real process.env
// VITE_ vars `define` technique proven earlier this session for e2e
// testing against the real pipeline.
//
// Run:  node --env-file=.env scripts/craft-mask-eval.mjs
// Run one prompt:  node --env-file=.env scripts/craft-mask-eval.mjs "a viking ship with flower decoration" vehicle
// ---------------------------------------------------------------------------

import esbuild from 'esbuild';
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const envVars = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^(VITE_[A-Z_]+)=(.*)$/);
  if (m) envVars[m[1]] = m[2];
}

const outDir = mkdtempSync(join(tmpdir(), 'craft-mask-eval-'));
const outfile = join(outDir, 'bundle.mjs');

await esbuild.build({
  entryPoints: [new URL('./craft-mask-eval-entry.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  define: { 'import.meta.env': JSON.stringify(envVars) },
});

await import(`file://${outfile}`);
