// Runs every quest step's hint (all three questlines) in the dev server and
// checks it did its job: a focus hint pans the camera (and leaves its "!"
// when it has a bubble), a card hint opens its card, and none says
// "nothing ... nearby". Screenshots go to $OUT (default ./hint-shots).
//   npx vite --port 5173 &   then   node scripts/test-hints.mjs
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? 'hint-shots';
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const save = {
  version: 1, anchor: now, anchorReal: now, timeScale: 1, player: { x: 36, y: 53 },
  inv: {}, money: 0, storages: [], bag: [], equippedId: null, removedIds: [], shaken: [], plantedCrops: [],
  introDone: true, quest: { part: 'q1', step: 0, gathered: 0 },
};
// playwright isn't a project dependency: the global install, else ours
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript((s) => localStorage.setItem('ascii-village-save-1', JSON.stringify(s)), save);
const p = await ctx.newPage();
await p.goto(`${BASE}/1`);
await p.waitForFunction(() => document.documentElement.dataset.font);
await p.waitForTimeout(1000);
await p.click('button.start').catch(() => {});
await p.waitForFunction(() => window.__qt?.().state, null, { timeout: 15000 });

const steps = await p.evaluate(async () => {
  const { QUESTLINE_1, QUESTLINE_2, REPLAY } = await import('/src/quest/quests.ts');
  return [['q1', QUESTLINE_1], ['q2', QUESTLINE_2], ['c2', REPLAY]].flatMap(([part, l]) =>
    l.steps.map((s, i) => ({ part, i, id: s.id, hint: s.hint })),
  );
});

let fails = 0;
for (const s of steps) {
  await p.evaluate(({ part, i }) => window.__qt().setStep(part, i), s);
  await p.waitForTimeout(300);
  const run = p.evaluate(() => window.__qt().hint());
  await p.waitForTimeout(900); // mid-hold: the camera is over the target
  const st = await p.evaluate(() => window.__qt().hintState());
  await p.screenshot({ path: `${OUT}/${s.part}-${s.i}-${s.id}.png` });
  await run;
  const h = s.hint;
  const problems = [];
  if (st.toast && /nothing/.test(st.toast)) problems.push(`toast "${st.toast}"`);
  if (h.focus && Math.hypot(st.pan.x, st.pan.y) < 0.01 && !st.toast) problems.push('camera did not move');
  if (h.focus && h.bubble && !st.marks.includes(h.focus)) problems.push('no "!"');
  if (h.card && !st.card) problems.push('no card');
  const what = h.card ? 'card' : h.focus ? `focus ${h.focus}` : h.blink ? 'blink' : '-';
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${s.part} ${s.i} ${s.id.padEnd(10)} ${what.padEnd(16)} ${problems.join(', ')}`);
  if (problems.length) fails++;
  // close a card, wait out the glide back
  await p.keyboard.press('Escape');
  await p.waitForTimeout(h.focus ? 1200 : 300);
}
console.log(fails ? `${fails} hint(s) failed` : 'all hints ok');
await b.close();
process.exit(fails ? 1 : 0);
