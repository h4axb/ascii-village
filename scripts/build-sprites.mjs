// ---------------------------------------------------------------------------
// BUILD-TIME TIER 2 — Sprite parameter specs  (Haiku 4.5)
//
//   node --env-file=.env scripts/build-sprites.mjs   (run build-catalog first)
//
// Tiny constrained JSON per species — exactly the high-volume narrow extraction
// Haiku is built for. A validator + template fallback catches weak output, so a
// cheap model is the right call. Offline, cached to src/data/sprites.json.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import { chatJSON, mapLimit, MODELS } from './lib/requesty.mjs';

const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));

// Fallback sprite by category when a model's output fails validation.
const FALLBACK = {
  plant: ['\\|/', ' | ', '_|_'],
  pets: ['/^-^\\', '(o.o)', ' |_|'],
  clothing: [' ___ ', '/___\\', '\\___/'],
  vehicle: ['  __o', ' -\\<,', '(*)/(*)'],
  food: [' ___ ', '(   )', '(___)'],
};

function validSprite(s) {
  return Array.isArray(s) && s.length >= 1 && s.length <= 4 && s.every((l) => typeof l === 'string' && l.length <= 8);
}

console.log(`Building sprites with ${MODELS.sprites} for ${catalog.length} species ...`);

const sprites = await mapLimit(catalog, 6, async (sp) => {
  let sprite;
  try {
    const r = await chatJSON(
      [
        {
          role: 'system',
          content:
            'You make tiny ASCII sprites for a village game. Return JSON only: ' +
            '{"sprite":["line1","line2","line3"]}. 1-4 lines, each at most 8 chars, ' +
            'plain ASCII only. It should visually suggest the item.',
        },
        { role: 'user', content: `Sprite for a ${sp.rarity} ${sp.category}: "${sp.name}".` },
      ],
      { model: MODELS.sprites, temperature: 0.7, maxTokens: 100 },
    );
    sprite = validSprite(r.sprite) ? r.sprite : FALLBACK[sp.category];
  } catch {
    sprite = FALLBACK[sp.category];
  }
  return { name: sp.name, category: sp.category, sprite };
});

await writeFile(new URL('../src/data/sprites.json', import.meta.url), JSON.stringify(sprites, null, 2));
console.log(`Wrote src/data/sprites.json (${sprites.length} sprites).`);
