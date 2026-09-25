// ---------------------------------------------------------------------------
// Entry point bundled at runtime by scripts/craft-mask-eval.mjs — see that
// file for why this indirection exists (scripts/ can't import .ts directly;
// this lets the eval tool use the REAL production planner/renderer instead
// of a duplicated copy). Not part of the app; never imported by src/.
// ---------------------------------------------------------------------------

import { chat, chatJSON, MODELS } from '../src/llmClient';
import { planPrompt, planCraft } from '../src/craft/spriteGen';
import { validateRegionPlan, resolveCanvasSize, resolveRegions, applyRelationAdjustments } from '../src/craft/spriteValidate';
import { renderRegions } from '../src/craft/glyphRender';
import { renderMask } from '../src/craft/glyphRenderDebug';
import { planAndRender } from '../src/craft/spritePipeline';

const DEFAULT_PROMPTS: [string, string][] = [
  ['a viking ship with flower decoration', 'vehicle'],
  ['sailboat', 'vehicle'],
  ['acoustic guitar', 'utensils'],
  ['wine glass', 'utensils'],
  ['wheelbarrow', 'utensils'],
  ['umbrella', 'clothing'],
  ['hot air balloon', 'vehicle'],
];

async function evalPrompt(prompt: string, category: string) {
  const plan = await planCraft(prompt, category, chatJSON, { model: MODELS.fast, fallbackModel: MODELS.fastFallback });
  console.log('='.repeat(78));
  console.log(`PROMPT: "${prompt}"  (category: ${category})`);
  if (plan.sensitive) {
    console.log('  BLOCKED (sensitive)');
    return;
  }
  const check = validateRegionPlan(plan);
  if (!check.ok) {
    console.log(`  PLAN INVALID: ${check.error}`);
    console.log(`  raw plan: ${JSON.stringify(plan).slice(0, 800)}`);
    return;
  }
  console.log(`  parts: ${plan.parts.join(' | ')}`);
  console.log(`  regions: ${check.plan.regions.map((r) => `${r.id}(${r.primitive})`).join(', ')}`);
  console.log(`  relations: ${(check.plan.relations ?? []).map((r) => `${r.subject} ${r.relation} ${r.object}`).join(', ') || '(none)'}`);
  if (check.warnings.length) console.log(`  warnings: ${check.warnings.join('; ')}`);

  const canvas = resolveCanvasSize(check.plan.sizeClass, check.plan.width, check.plan.height);
  const rasterRegions = resolveRegions(check.plan.regions, canvas.width, canvas.height);
  const { regions: adjustedRegions, warnings: relationWarnings } = applyRelationAdjustments(
    rasterRegions,
    check.plan.relations ?? [],
    canvas.width,
    canvas.height,
  );
  if (relationWarnings.length) console.log(`  relation adjustments: ${relationWarnings.join('; ')}`);
  const mask = renderMask(canvas.width, canvas.height, adjustedRegions, prompt);
  const textured = renderRegions(canvas.width, canvas.height, adjustedRegions, prompt, check.plan.face);

  const maskLines = mask.lines;
  const texLines = textured.lines;
  const rows = Math.max(maskLines.length, texLines.length);
  const maskW = Math.max(0, ...maskLines.map((l) => l.length));
  console.log(`  MASK${' '.repeat(Math.max(1, maskW - 3))}TEXTURED`);
  for (let i = 0; i < rows; i++) {
    const left = (maskLines[i] ?? '').padEnd(maskW, ' ');
    const right = texLines[i] ?? '';
    console.log(`  ${left}  ${right}`);
  }
}

async function main() {
  const only = process.argv[2];
  if (process.env.PROMPT_CHECK === '1') {
    console.log(planPrompt());
    console.log(`\n[prompt length: ${planPrompt().length} chars]`);
    return;
  }
  if (process.env.ERR_CHECK === '1') {
    const prompt = only || 'acoustic guitar';
    const category = process.argv[3] || 'utensils';
    try {
      const raw = await chat(
        [
          { role: 'system', content: planPrompt() },
          { role: 'user', content: `Token category: ${category}. Request: "${prompt}".` },
        ],
        { model: MODELS.fast, temperature: 0.7, maxTokens: 1500 },
      );
      console.log('OK, length:', raw.length);
    } catch (err) {
      console.log('THROWN ERROR:', err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (process.env.RAW_CHECK === '1') {
    const prompt = only || 'a viking ship with flower decoration';
    const category = process.argv[3] || 'vehicle';
    const raw = await chat(
      [
        { role: 'system', content: planPrompt() },
        { role: 'user', content: `Token category: ${category}. Request: "${prompt}".` },
      ],
      { model: MODELS.fast, temperature: 0.7, maxTokens: 1500 },
    );
    console.log('RAW response length:', raw.length);
    console.log(raw);
    return;
  }
  if (process.env.RETRY_CHECK === '1') {
    const prompt = only || 'a viking ship with flower decoration';
    const category = process.argv[3] || 'vehicle';
    const initial = await planCraft(prompt, category, chatJSON, { model: MODELS.fast, fallbackModel: MODELS.fastFallback });
    const { sprite, log, error } = await planAndRender(prompt, category, initial, { chat: chatJSON, model: MODELS.fast, fallbackModel: MODELS.fastFallback });
    console.log('RETRY-CHECK result:', sprite ? 'SPRITE PRODUCED' : `FAILED: ${error}`);
    console.log('log:', JSON.stringify(log, null, 2));
    return;
  }
  const prompts = only ? [[only, process.argv[3] || 'utensils'] as [string, string]] : DEFAULT_PROMPTS;
  console.log(`Model: ${MODELS.fast}\n`);
  for (const [prompt, category] of prompts) {
    await evalPrompt(prompt, category);
  }
}

main();
