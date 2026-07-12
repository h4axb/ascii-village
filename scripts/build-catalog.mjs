// ---------------------------------------------------------------------------
// BUILD-TIME TIER 1 — Species catalog  (Sonnet 5)
//
//   node --env-file=.env scripts/build-catalog.mjs
//
// Quality-critical: this catalog is the foundation every downstream layer
// samples from, so it runs on the smartest model. It's offline and cached to
// src/data/catalog.json — the game imports that JSON as static data and never
// calls the model at runtime for it.
//
// This is a working TEMPLATE wired to the game's real categories. Expand the
// prompt/schema (rarity tiers, botany, lore, price curves…) to taste.
// ---------------------------------------------------------------------------

import { writeFile, mkdir } from 'node:fs/promises';
import { chat, chatJSON, mapLimit, MODELS } from './lib/requesty.mjs';

const CATEGORIES = ['plant', 'pets', 'clothing', 'vehicle', 'food'];
const PER_CATEGORY = 20; // ~100 species total; bump toward 200 as you like

console.log(`Building catalog with ${MODELS.catalog} ...`);

const lists = await mapLimit(CATEGORIES, 3, async (category) => {
  const raw = await chatJSON(
    [
      {
        role: 'system',
        content:
          'You design items for a cozy ASCII village game. Return JSON only: ' +
          '{"species":[{"name","rarity","desc","funcDesc","basePrice"}]}. ' +
          'rarity is one of "common"|"uncommon"|"rare"|"legendary" (skew common). ' +
          'name: short Title Case. desc: one charming sentence. ' +
          'funcDesc: one lowercase playful sentence. basePrice: integer coins, ' +
          'scaled by rarity (common ~3-8, legendary ~30-60).',
      },
      { role: 'user', content: `Design ${PER_CATEGORY} distinct ${category} species.` },
    ],
    { model: MODELS.catalog, temperature: 0.9, maxTokens: 4096 },
  );
  const species = (raw.species ?? []).map((s) => ({ ...s, category }));
  console.log(`  ${category}: ${species.length}`);
  return species;
});

const catalog = lists.flat();
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../src/data/catalog.json', import.meta.url),
  JSON.stringify(catalog, null, 2),
);
console.log(`Wrote src/data/catalog.json (${catalog.length} species).`);
void chat; // exported for ad-hoc prompting while iterating
