// LLM backend for the shop/craft/detail features.
//
// If an API key is configured (VITE_LLM_API_KEY in .env) these functions call
// a real OpenAI-compatible model via ./llmClient. If not — or if the call
// fails for any reason — they fall back to the built-in mock responses below.
// Nothing else in the app knows (or may know) which path ran: same async
// interface either way.

import { llmEnabled, chat, chatJSON, MODELS } from './llmClient';
// Build-time-generated static data (produced offline by scripts/build-*.mjs).
// The shop samples from these; if they're empty, it falls back to ITEM_POOL.
import catalogData from './data/catalog.json';
import spritesData from './data/sprites.json';
// Sprite generation pipeline: plan (LLM) -> normalize/validate -> render
// (local, deterministic) -> retry-once-on-hard-failure.
import {
  parseSpec,
  resolveStyle,
  instanceFromSpec,
  planCraft,
  planAndRender,
  suggestAlternatives,
  textureModifierFor,
  type CraftLog,
  type TextureModifier,
} from './craft';
import {
  parseItemFunction,
  parseGameplayIntent,
  NEUTRAL_MODIFIERS,
  MODIFIER_PROMPT,
  type ItemFunction,
} from './craft/functions';
import { checkPolicy } from './craft/policy';

// Structured log, one record per generation. Kept in memory + echoed to the
// console; read it for playtest analysis.
export const craftLog: CraftLog[] = [];

const FACTS: Record<string, string[]> = {
  flower: [
    'Some wildflowers bloom for only a single day.',
    'Bees see flowers in ultraviolet patterns invisible to humans.',
    'Young sunflowers track the sun across the sky, then settle facing east.',
    "The world's largest flower smells like rotting meat to attract flies.",
  ],
  stone: [
    'Almost every stone you pick up is millions of years old.',
    'Some river stones travel hundreds of miles before settling down.',
    'Obsidian is natural glass, formed when lava cools too fast to crystallize.',
    'The oldest known rocks on Earth are over 4 billion years old.',
    'Pumice is the only rock that floats on water.',
  ],
  date: [
    'Date palms have been farmed for more than 6,000 years.',
    'A single date palm can drop over 100kg of fruit in a season.',
    'Dates are about 70% sugar by weight once they dry on the tree.',
    'Date palms are either male or female; only the females fruit.',
  ],
  cactus: [
    'Some cacti can survive two years without a single drop of rain.',
    'The saguaro cactus can grow over 12 meters tall.',
    'Cactus spines are actually highly modified leaves.',
  ],
  fern: [
    'Ferns are older than dinosaurs — over 350 million years old.',
    'Ferns reproduce with spores instead of seeds.',
    'Some ferns can filter toxins out of the air.',
  ],
  iceflower: [
    'Some arctic flowers track the sun to warm their petals.',
    'Frost flowers form when supercooled sap bursts through plant stems.',
    'Certain alpine blooms survive being frozen solid overnight.',
  ],
};

const BASE_PRICE: Record<string, number> = {
  flower: 3,
  stone: 2,
  date: 5,
  cactus: 6,
  fern: 4,
  iceflower: 9,
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Shop stock + craft tokens (mocked LLM generation)
// ---------------------------------------------------------------------------

export const CATEGORIES = ['plant', 'pets', 'clothing', 'vehicle', 'food', 'utensils'] as const;
export type Category = (typeof CATEGORIES)[number];

// An item instance the player owns (bought or crafted).
export type OwnedItem = ShopItem & { ownedId: string };

export interface ShopItem {
  id: string;
  name: string;
  category: Category;
  sprite: string[];
  desc: string; // flavor text
  funcDesc: string; // what the item does — shown as subtext everywhere
  price: number;
  kind: 'item' | 'token';
  tool?: 'water'; // utensils that act as tools (e.g. the watering can)
  color?: string; // crafted items: base/default sprite colour (CSS colour)
  // crafted items: optional per-region colour ("paint by number"). palette maps
  // single-char keys → hex; colors is a grid the same shape as sprite, each cell
  // a palette key or '.' (= base colour). Both present or both absent.
  palette?: Record<string, string>;
  colors?: string[];
  scale?: number; // crafted items: player-chosen size multiplier
  // crafted items only: a lightweight "prompt memory" — a few inferred
  // descriptive traits (material/mood/etc., from craftDescribe) plus one
  // exact `prompt: <what the player typed>` entry appended in code (not by
  // the LLM), so what spawned the item is always faithfully preserved even
  // if the model paraphrases everything else. Shown on the item's tooltip.
  tags?: string[];
  // crafted items only: visual finish effect, derived from spec.finish (see
  // craft/spec.ts's textureModifierFor) — 'matte' or absent means no effect.
  textureModifier?: TextureModifier;
  // crafted items only: the player-invented function, translated by the LLM
  // into bounded numeric modifiers (see craft/functions.ts). Applies only
  // once the item is PLACED in the world, near the crop beds.
  fn?: ItemFunction;
  equip: null | {
    mode: 'vehicle' | 'hold' | 'pet';
    speedMult?: number; // vehicles: movement interval multiplier (<1 = faster)
    float?: boolean; // boats/rafts — lets the player travel onto ocean water
  };
}

const TOKEN_SPRITE = [' .--.', '( ** )', " '--'"];

const ITEM_POOL: Record<Category, Omit<ShopItem, 'id' | 'kind'>[]> = {
  plant: [
    { name: 'Mango', category: 'plant', sprite: ['  ,/', ' .--.', '(::::)', " '--'"], desc: 'A rare tropical fruit, heavy and sweet.', funcDesc: 'hold it and look exotic. worth a lot to the right buyer.', price: 14, equip: { mode: 'hold' } },
    { name: 'Rose', category: 'plant', sprite: ['@}-,--'], desc: 'A single perfect rose.', funcDesc: 'hold it for maximum charm.', price: 5, equip: { mode: 'hold' } },
    { name: 'Cactus', category: 'plant', sprite: [' _|_', '( | )', ' |_|'], desc: 'Prickly but low maintenance.', funcDesc: 'hold it carefully. very carefully.', price: 7, equip: { mode: 'hold' } },
    { name: 'Fern', category: 'plant', sprite: ['\\\\|//', ' \\|/', '  |'], desc: 'An ancient, shade-loving plant.', funcDesc: 'hold it to feel one with the forest.', price: 4, equip: { mode: 'hold' } },
    { name: 'Bonsai', category: 'plant', sprite: [' ,&&,', ' \\||/', ' [__]'], desc: 'A tiny tree, decades in the making.', funcDesc: 'hold it and feel very patient.', price: 12, equip: { mode: 'hold' } },
  ],
  pets: [
    { name: 'Puppy', category: 'pets', sprite: ['/^-^\\', '(o.o)', ' |_|>'], desc: 'A round, excitable puppy.', funcDesc: 'follows u around wherever u go.', price: 25, equip: { mode: 'pet' } },
    { name: 'Bunny', category: 'pets', sprite: ['(\\_/)', '(o.o)', '(> <)'], desc: 'Soft. Fast. Judging you.', funcDesc: 'follows u around wherever u go.', price: 18, equip: { mode: 'pet' } },
    { name: 'Bird', category: 'pets', sprite: [' (o>', ' //\\', ' V_/'], desc: 'A small bird with big opinions.', funcDesc: 'follows u around wherever u go.', price: 15, equip: { mode: 'pet' } },
    { name: 'Turtle', category: 'pets', sprite: [' ,--.', '(=##=)', ' ~~~~'], desc: 'Slow and steady. Mostly slow.', funcDesc: 'follows u around... eventually.', price: 20, equip: { mode: 'pet' } },
  ],
  clothing: [
    { name: 'Straw Hat', category: 'clothing', sprite: ['  ___', ' /___\\', '/_____\\'], desc: 'Keeps the sun off. Farm chic.', funcDesc: 'hold it to look like a real farmer.', price: 8, equip: { mode: 'hold' } },
    { name: 'Scarf', category: 'clothing', sprite: ['~~~~~', '   ~~', '   ~~'], desc: 'Hand-knitted, probably.', funcDesc: 'hold it for instant coziness.', price: 6, equip: { mode: 'hold' } },
    { name: 'Boots', category: 'clothing', sprite: ['|\\', '| \\_', '|___|'], desc: 'Sturdy leather boots.', funcDesc: 'hold them and feel ready for adventure.', price: 10, equip: { mode: 'hold' } },
    { name: 'Cape', category: 'clothing', sprite: ['/===\\', '|   |', '|___|'], desc: 'Dramatic in any wind.', funcDesc: 'hold it heroically.', price: 11, equip: { mode: 'hold' } },
  ],
  vehicle: [
    { name: 'Bicycle', category: 'vehicle', sprite: ['  __o', '  -\\<,', '(*)/(*)'], desc: 'Two wheels of freedom.', funcDesc: 'ride it to move much faster.', price: 30, equip: { mode: 'vehicle', speedMult: 0.55 } },
    { name: 'Skateboard', category: 'vehicle', sprite: [' ______', ' o    o'], desc: 'No brakes. Never had them.', funcDesc: 'ride it to move faster.', price: 22, equip: { mode: 'vehicle', speedMult: 0.7 } },
    { name: 'Sail Boat', category: 'vehicle', sprite: ['   |\\', '   |_\\', ' \\____/'], desc: 'A small boat with a proud sail.', funcDesc: 'equip it to sail out onto the ocean.', price: 35, equip: { mode: 'vehicle', speedMult: 0.6, float: true } },
    { name: 'Hand Wagon', category: 'vehicle', sprite: ['[____]', ' o  o'], desc: 'Squeaky but reliable.', funcDesc: 'ride it to move a bit faster.', price: 20, equip: { mode: 'vehicle', speedMult: 0.85 } },
  ],
  food: [
    { name: 'Bread', category: 'food', sprite: ['  ____', ' (____)'], desc: 'Fresh from someone’s oven.', funcDesc: 'a tasty snack. smells amazing.', price: 4, equip: { mode: 'hold' } },
    { name: 'Berry Pie', category: 'food', sprite: ['  ~ ~', ' ~~~~~', '(_____)'], desc: 'Still warm in the middle.', funcDesc: 'a tasty snack. share it maybe.', price: 7, equip: { mode: 'hold' } },
    { name: 'Cheese', category: 'food', sprite: ['  ___', ' /o_o\\', ' |___|'], desc: 'Aged to perfection.', funcDesc: 'a tasty snack. mice approve.', price: 5, equip: { mode: 'hold' } },
    { name: 'Honey Jar', category: 'food', sprite: [' [=]', '(###)', '(___)'], desc: 'Liquid gold from local bees.', funcDesc: 'a tasty snack. sticky though.', price: 9, equip: { mode: 'hold' } },
  ],
  utensils: [
    { name: 'Watering Can', category: 'utensils', sprite: ['  __', ' /  |__', '(o___,_)'], desc: 'A little tin watering can.', funcDesc: 'equip it, then press F at the garden bed to water your crops.', price: 15, tool: 'water', equip: { mode: 'hold' } },
    { name: 'Trowel', category: 'utensils', sprite: ['  __', ' (==)', '  ||'], desc: 'For turning soil.', funcDesc: 'hold it and feel like a proper gardener.', price: 8, equip: { mode: 'hold' } },
    { name: 'Basket', category: 'utensils', sprite: [' \\___/', ' |###|', ' \\___/'], desc: 'A woven harvest basket.', funcDesc: 'hold it to carry your harvest in style.', price: 9, equip: { mode: 'hold' } },
  ],
};

// One universal token, one price. It used to be a token per category at
// 10-35 each, with the token's category gating what you could craft; now a
// single token crafts anything and the crafted item's category is inferred
// from the prompt instead (see craftItem).
export const TOKEN_PRICE = 20;
export const TOKENS_PER_DAY = 3;

// Not part of the rotating per-category stock — the shop shows it in its own
// slot, so it appears once rather than six times. hourSeed only keeps the id
// stable within a restock window.
export function universalToken(hourSeed: number): ShopItem {
  return {
    id: `token-${hourSeed}`,
    name: 'Craft Token',
    category: 'utensils', // nominal only; the crafted item infers its own
    sprite: TOKEN_SPRITE,
    desc: 'A blank token, humming with possibility.',
    funcDesc: 'describe anything you can imagine — and what it should do.',
    price: TOKEN_PRICE,
    kind: 'token',
    equip: null,
  };
}

function seededRand(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The shop's stock for one category and one real-world hour: 3 "generated"
// items. Same hour → same stock (deterministic). The craft token is no longer
// part of this — it's universal now, so the shop renders it once on its own
// (see universalToken).
export async function getShopStock(category: Category, hourSeed: number): Promise<ShopItem[]> {
  await delay(300);
  const rnd = seededRand(hourSeed * 131 + CATEGORIES.indexOf(category) * 17 + 5);
  // Prefer the generated catalog; fall back to the hardcoded pool if it's empty
  // (e.g. the build scripts haven't been run).
  const source = GENERATED_POOL[category].length > 0 ? GENERATED_POOL[category] : ITEM_POOL[category];
  const pool = [...source];
  const picked: ShopItem[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const idx = Math.floor(rnd() * pool.length);
    const base = pool.splice(idx, 1)[0];
    picked.push({ ...base, id: `${category}-${hourSeed}-${i}`, kind: 'item' });
  }
  return picked;
}

const WATER_WORDS = ['boat', 'ship', 'canoe', 'kayak', 'raft'];
const FAST_WORDS = ['bike', 'bicycle', 'scooter'];

// ---------------------------------------------------------------------------
// Generated catalog → shop pool (built offline; see scripts/build-*.mjs)
// ---------------------------------------------------------------------------

type CatalogEntry = { name: string; rarity: string; desc: string; funcDesc: string; basePrice: number; category: string };
type SpriteEntry = { name: string; category: string; sprite: string[] };

const CATEGORY_FALLBACK_SPRITE: Record<Category, string[]> = {
  plant: ['\\|/', ' | ', '_|_'],
  pets: ['/^-^\\', '(o.o)', ' |_|'],
  clothing: [' ___ ', '/___\\', '\\___/'],
  vehicle: ['  __o', ' -\\<,', '(*)/(*)'],
  food: [' ___ ', '(   )', '(___)'],
  utensils: ['  __', ' (==)', '  ||'],
};

// Derive an equip mode from the category (the catalog doesn't store one).
function equipFor(category: Category, name: string): ShopItem['equip'] {
  const p = name.toLowerCase();
  if (category === 'vehicle') {
    const water = WATER_WORDS.some((w) => p.includes(w));
    const fast = FAST_WORDS.some((w) => p.includes(w));
    return { mode: 'vehicle', speedMult: fast ? 0.55 : 0.7, float: water };
  }
  if (category === 'pets') return { mode: 'pet' };
  return { mode: 'hold' };
}

// Join catalog + sprites into the same shape ITEM_POOL uses, grouped by category.
const GENERATED_POOL: Record<Category, Omit<ShopItem, 'id' | 'kind'>[]> = (() => {
  const spriteMap = new Map<string, string[]>();
  for (const s of spritesData as SpriteEntry[]) spriteMap.set(`${s.category}:${s.name}`, s.sprite);

  const pool = { plant: [], pets: [], clothing: [], vehicle: [], food: [], utensils: [] } as Record<Category, Omit<ShopItem, 'id' | 'kind'>[]>;
  for (const e of catalogData as CatalogEntry[]) {
    if (!(CATEGORIES as readonly string[]).includes(e.category)) continue;
    const cat = e.category as Category;
    pool[cat].push({
      name: e.name,
      category: cat,
      sprite: spriteMap.get(`${cat}:${e.name}`) ?? CATEGORY_FALLBACK_SPRITE[cat],
      desc: e.desc,
      funcDesc: e.funcDesc,
      price: Math.max(1, Math.round(e.basePrice) || 1),
      equip: equipFor(cat, e.name),
    });
  }
  return pool;
})();

export type CraftResult =
  | { ok: true; item: ShopItem; refImage?: string }
  // `suggestions`: up to 3 alternative craft prompts (shown as clickable
  // buttons). Present only on BENIGN failures — never on category mismatches
  // or blocked (sensitive) input.
  | { ok: false; reply: string; suggestions?: string[] };

// Live-progress hooks the crafting UI can pass into craftItem. Rendering is
// now local/synchronous (no more image or streaming stages — see the
// crafting pipeline overhaul), so 'image' is gone and onLine's lines arrive
// all at once rather than progressively; the hooks are kept (not removed)
// so CraftModal's existing busy/partial-line UI keeps working unmodified.
export interface CraftUiHooks {
  onStage?: (stage: 'drawing' | 'retrying') => void;
  onLine?: (line: string, index: number, level: 0 | 1 | 2) => void;
}

// Pick a sprite + default equip/funcDesc for a freshly crafted item. Sprites
// are hand-drawn ASCII we don't trust an LLM to produce, so we always reuse a
// template from the category pool. `overrides` lets the LLM path tweak the
// vehicle behavior (water-only / fast) it inferred from the prompt.
function buildCraftedItem(
  category: Category,
  name: string,
  prompt: string,
  overrides?: { water?: boolean; fast?: boolean; funcDesc?: string },
): ShopItem {
  const p = prompt.toLowerCase();
  const rnd = seededRand(Array.from(prompt).reduce((a, c) => a + c.charCodeAt(0), category.length));
  const pool = ITEM_POOL[category];
  const template = pool[Math.floor(rnd() * pool.length)];
  let equip: ShopItem['equip'];
  let funcDesc: string;
  switch (category) {
    case 'vehicle': {
      const water = overrides?.water ?? WATER_WORDS.some((w) => p.includes(w));
      const fast = overrides?.fast ?? FAST_WORDS.some((w) => p.includes(w));
      equip = { mode: 'vehicle', speedMult: fast ? 0.55 : 0.7, float: water };
      funcDesc = water ? 'sail it out onto the ocean.' : 'ride it to move faster.';
      break;
    }
    case 'pets':
      equip = { mode: 'pet' };
      funcDesc = 'follows u around wherever u go.';
      break;
    case 'plant':
      equip = { mode: 'hold' };
      funcDesc = 'a hand-crafted plant. hold it proudly.';
      break;
    case 'clothing':
      equip = { mode: 'hold' };
      funcDesc = 'hand-made. wear it (hold it) proudly.';
      break;
    case 'food':
      equip = { mode: 'hold' };
      funcDesc = 'a homemade snack. probably edible.';
      break;
    case 'utensils':
      equip = { mode: 'hold' };
      funcDesc = /water/.test(p) ? 'equip it, then press F at the garden bed to water crops.' : 'a handy garden utensil. hold it.';
      break;
  }
  const tool: ShopItem['tool'] = category === 'utensils' && /water/.test(p) ? 'water' : undefined;
  return {
    id: `craft-${Date.now()}`,
    name,
    category,
    sprite: template.sprite,
    desc: 'Custom-crafted from a blank token.',
    funcDesc: overrides?.funcDesc?.trim() || funcDesc,
    price: 0,
    kind: 'item',
    tool,
    equip,
  };
}

// craft spec category → the game's token category (only the clear mappings;
// anything else is allowed on any token)
const CRAFT_TO_TOKEN: Partial<Record<string, Category>> = {
  creature: 'pets', plant: 'plant', food: 'food', clothing: 'clothing',
  vehicle: 'vehicle', weapon: 'utensils', tool: 'utensils', container: 'utensils',
  gem: 'utensils', potion: 'utensils', instrument: 'utensils', furniture: 'utensils',
};

// The crafted item still HAS a category (it drives sprite sizing, the equip
// template, and inventory grouping) — it's just inferred from what the player
// asked for now, rather than dictated by which token they bought. Falls back
// to the model's own hint, then to a neutral default.
function inferCategory(specCategory: string, hint?: Category): Category {
  return CRAFT_TO_TOKEN[specCategory] ?? hint ?? 'utensils';
}

// Craft anything the player describes. With an LLM key set, this runs the
// generate → validate → shared-store → fail pipeline and produces a real
// per-prompt sprite (plus the player's colour/size). Offline, it falls back to
// the keyword-based mock below so the game still crafts.
export async function craftItem(prompt: string, ui?: CraftUiHooks): Promise<CraftResult> {
  // Local content policy runs FIRST and on every path — before any network
  // call, and equally in offline/mock mode. The model-side `sensitive` check
  // below is fail-open by design (a failed request returns "not sensitive"),
  // so this deterministic pass is the part that always holds.
  const policy = checkPolicy(prompt);
  if (!policy.allowed) return { ok: false, reply: policy.reason! };

  if (llmEnabled) {
    const spec = parseSpec(prompt);
    try {
      // PLAN — one cheap call that now decides content safety, size, AND the
      // region-by-region visual composition (CraftPlan) in one shot. Its
      // `fit` field no longer gates anything: a universal token has no
      // category to mismatch against, so the only rejection left here is a
      // blocked prompt. `tokenHint` is still useful as a category guess.
      const plan = await planCraft(prompt, spec.category, chatJSON, {
        model: MODELS.fast,
        fallbackModel: MODELS.fastFallback,
      });
      if (plan.sensitive) {
        // deliberately NO suggestions on blocked input
        return {
          ok: false,
          reply: "let's keep it cozy in my shop... i won't craft that one. try something friendlier?",
        };
      }
      const category = inferCategory(spec.category, plan.tokenHint as Category | undefined);

      // Normalize/validate the plan → render locally (deterministic, no
      // LLM) → one retry of the PLAN on a hard failure. If both attempts
      // fail, sprite is null and the player gets an honest error message (no
      // template stand-in, no silent substitution — deliberate). Rendering
      // is instant/local now, so there's nothing to parallelize it against —
      // craftDescribe runs after category is known, same dependency as
      // before, just no longer racing a Stage-2 call that no longer exists.
      ui?.onStage?.('drawing');
      const { sprite, log, error } = await planAndRender(prompt, category, plan, {
        chat: chatJSON,
        model: MODELS.fast,
        fallbackModel: MODELS.fastFallback,
      });
      if (log.retried) ui?.onStage?.('retrying');
      if (sprite) sprite.lines.forEach((line, i) => ui?.onLine?.(line, i, log.fallbackLevel as 0 | 1));
      const description = await craftDescribe(prompt, category);
      craftLog.push(log);
      console.info('[craft]', log);

      if (!sprite) {
        // BENIGN failure (sensitive/mismatch were filtered above): let Mitchy
        // offer three strategy-diverse alternatives as clickable options.
        const s = await suggestAlternatives(prompt, category, error ?? 'generation failed', chatJSON, {
          model: MODELS.fast,
          fallbackModel: MODELS.fastFallback,
        });
        if (s) return { ok: false, reply: s.intro, suggestions: s.options };
        return {
          ok: false,
          reply:
            `oops... i tried a few times but couldn't get "${prompt}" right ` +
            `(${error ?? 'generation failed'}). maybe describe it a bit differently?`,
        };
      }

      const name =
        (sprite.name && sprite.name.trim()) ||
        prompt.trim().slice(0, 18).replace(/^\w/, (c) => c.toUpperCase()) ||
        'Mystery Thing';
      // The player's own stated function becomes the item's funcDesc via the
      // overrides hook, replacing the per-category boilerplate — this is the
      // whole point of letting them invent one.
      const item = buildCraftedItem(category, name, prompt, {
        funcDesc: description.fn.narrative,
      });
      item.fn = description.fn;
      item.sprite = sprite.lines; // the freshly generated sprite
      // Per-region colour from the generator (rose: red bloom, green stem …),
      // when it produced a valid palette + grid. Absent → the sprite is mono.
      if (sprite.palette && sprite.colors) {
        item.palette = sprite.palette;
        item.colors = sprite.colors;
      }
      // the base colour still comes from the player's words; on-screen SIZE is
      // baked into the sprite's own dimensions (sizeClass), so resolveStyle's
      // own size-word scale is intentionally not applied here. The scale that
      // IS applied compensates for the renderer's higher internal glyph
      // resolution (see spriteConfig.ts's RESOLUTION_MULTIPLIER) — a
      // different concern from the player's stated size, so no conflict.
      const style = resolveStyle(instanceFromSpec(spec, item.id));
      if (style.color) item.color = style.color;
      if (sprite.resolutionScale) item.scale = sprite.resolutionScale;
      item.desc = description.description;
      // the exact prompt is appended in CODE, not asked of the model — see
      // craftDescribe's own comment on why that tag has to be verbatim.
      item.tags = [...description.tags, `prompt: ${prompt.trim()}`];
      item.textureModifier = textureModifierFor(spec.finish);
      return { ok: true, item };
    } catch (err) {
      console.warn('[craft] pipeline error:', err);
      return {
        ok: false,
        reply: "oops... something went wrong on my workbench. give it another try in a moment?",
      };
    }
  }

  await delay(900);
  // No cross-category rejection any more — one universal token crafts
  // anything, so the category is simply inferred and the craft proceeds.
  const offlineSpec = parseSpec(prompt);
  const category = inferCategory(offlineSpec.category);
  const name = prompt.trim().slice(0, 18).replace(/^\w/, (c) => c.toUpperCase()) || 'Mystery Thing';
  // Offline mode still gets real (mock) description/tags/texture — parseSpec
  // and textureModifierFor are pure local keyword-matching (no LLM needed at
  // all), and craftDescribe degrades to its own mock text when !llmEnabled,
  // so there's no reason to skip this path just because there's no API key.
  const description = await craftDescribe(prompt, category);
  const item = buildCraftedItem(category, name, prompt, {
    funcDesc: description.fn.narrative,
  });
  item.fn = description.fn;
  item.desc = description.description;
  item.tags = [...description.tags, `prompt: ${prompt.trim()}`];
  item.textureModifier = textureModifierFor(offlineSpec.finish);
  return { ok: true, item };
}

function mockFunFact(itemName: string): string {
  const facts = FACTS[itemName] ?? ['Not much is known about this item.'];
  return facts[Math.floor(Math.random() * facts.length)];
}

export async function getFunFact(itemName: string): Promise<string> {
  if (!llmEnabled) {
    await delay(400);
    return mockFunFact(itemName);
  }
  try {
    return await chat(
      [
        {
          role: 'system',
          content:
            'You give short, delightful fun facts for Asciia Bay, a cozy ASCII island-farming game. ' +
            'Reply with ONE surprising, true-sounding fact in a single sentence, under 20 words. ' +
            'No preamble, no quotes, no emoji.',
        },
        { role: 'user', content: `Fun fact about: ${itemName}` },
      ],
      { temperature: 0.9, maxTokens: 60, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
    );
  } catch (err) {
    console.warn('[llm] getFunFact fell back to mock:', err);
    return mockFunFact(itemName);
  }
}

// ---------------------------------------------------------------------------
// Mitchy — the shopkeeper cat NPC. Her chatter is generated by Haiku (fast,
// cheap, characterful), with static fallback lines when offline or on error.
// ---------------------------------------------------------------------------

const MITCHY_FALLBACK = [
  'purrr... nice weather today, huh?',
  'shake the date palm. trust me.',
  'i buy almost anything. ALMOST.',
  'being a shopkeeper cat is honest work.',
  'flowers sell well this season.',
];

// Free-form chat with Mitchy WHILE she crafts — replies to what the player
// actually typed, in character, without touching the running pipeline.
export async function mitchyChat(message: string): Promise<string> {
  const fallback = MITCHY_FALLBACK[Math.floor(Math.random() * MITCHY_FALLBACK.length)];
  if (!llmEnabled) {
    await delay(300);
    return fallback;
  }
  try {
    const line = await chat(
      [
        {
          role: 'system',
          content:
            'You are Mitchy, a cozy, witty shopkeeper CAT in Asciia Bay, a cozy ASCII island-village game. You are ' +
            'currently BUSY crafting an item for the villager and chatting while you work. ' +
            'Reply to what they said in lowercase, one short line under 20 words, playful and a ' +
            'little sassy, occasionally slipping in a "purr". No emoji, no quotes, no preamble.',
        },
        { role: 'user', content: message },
      ],
      { temperature: 1, maxTokens: 50, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
    );
    return line || fallback;
  } catch (err) {
    console.warn('[llm] mitchyChat fell back to static:', err);
    return fallback;
  }
}

export async function getMitchyLine(context = 'a casual idle'): Promise<string> {
  const fallback = MITCHY_FALLBACK[Math.floor(Math.random() * MITCHY_FALLBACK.length)];
  if (!llmEnabled) {
    await delay(300);
    return fallback;
  }
  try {
    const line = await chat(
      [
        {
          role: 'system',
          content:
            'You are Mitchy, a cozy, witty shopkeeper CAT in Asciia Bay, a cozy ASCII island-village game. ' +
            'Speak in lowercase, one short line under 18 words, playful and a little sassy, ' +
            'occasionally slipping in a "purr". No emoji, no quotes, no preamble.',
        },
        { role: 'user', content: `Say ${context} line to the villager who just walked up.` },
      ],
      { temperature: 1, maxTokens: 40, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
    );
    return line || fallback;
  } catch (err) {
    console.warn('[llm] getMitchyLine fell back to static:', err);
    return fallback;
  }
}

function mockPrice(itemName: string): number {
  const base = BASE_PRICE[itemName] ?? 1;
  // slight random variance: -1, 0, or +1
  return Math.max(1, base + Math.floor(Math.random() * 3) - 1);
}

export async function getPrice(itemName: string): Promise<number> {
  if (!llmEnabled) {
    await delay(400);
    return mockPrice(itemName);
  }
  try {
    const { price } = await chatJSON<{ price: number }>(
      [
        {
          role: 'system',
          content:
            'You are a friendly shopkeeper in Asciia Bay, a cozy ASCII island-village game. Price small ' +
            'foraged items in coins, roughly 1-15. Reply with JSON only: {"price": <integer>}.',
        },
        { role: 'user', content: `How many coins for a ${itemName}?` },
      ],
      { temperature: 0.7, maxTokens: 20 },
    );
    const n = Math.round(Number(price));
    if (!Number.isFinite(n) || n < 1) throw new Error(`bad price: ${price}`);
    return Math.min(99, n);
  } catch (err) {
    console.warn('[llm] getPrice fell back to mock:', err);
    return mockPrice(itemName);
  }
}

// ---------------------------------------------------------------------------
// Crafted-item flavor text + inferred tags. A small, separate, cheap call —
// same reasoning as keeping screenCraftPrompt/getFunFact/getPrice apart from
// the sprite-drawing prompt: that prompt is already tuned tight for
// reliability on a small/fast model (see spriteGen.ts's own notes), and
// bolting more concerns onto it is exactly the kind of thing that's already
// been found to hurt it. This runs in PARALLEL with makeSprite (see
// craftItem below), not after, so it costs no extra wall-clock time on the
// common path.
//
// The "prompt: <exact text>" memory tag is NOT requested from the model —
// it's appended in code by the caller, verbatim, so what actually spawned
// the item is always faithfully preserved even if the model paraphrases or
// drops words elsewhere. Only the OTHER, inferred tags come from here.
// ---------------------------------------------------------------------------

interface CraftDescription {
  description: string;
  tags: string[];
  // The player's invented function, translated into bounded numbers. Folded
  // into THIS call rather than a fourth round-trip: the extra fields cost
  // only output tokens, and the model is already looking at the same prompt.
  fn: ItemFunction;
}

function mockCraftDescribe(prompt: string, category: Category): CraftDescription {
  return {
    description: `A hand-crafted ${category} item, made just the way you described it.`,
    tags: [category],
    fn: { narrative: '', modifiers: { ...NEUTRAL_MODIFIERS } },
  };
}

export async function craftDescribe(prompt: string, category: Category): Promise<CraftDescription> {
  if (!llmEnabled) {
    await delay(300);
    return mockCraftDescribe(prompt, category);
  }
  try {
    const r = await chatJSON<{
      description?: unknown;
      tags?: unknown;
      narrative_function?: unknown;
      gameplay_intent?: unknown;
      modifiers?: unknown;
      behavior?: unknown;
    }>(
      [
        {
          role: 'system',
          content:
            'You write short flavor text for Asciia Bay, a cozy ASCII island-village game, for an item a ' +
            'player just described to a crafting station. Reply with JSON only: {"description": "...", ' +
            '"tags": ["...", "..."], "narrative_function": "...", "gameplay_intent": {...}, "modifiers": {...}, ' +
            '"behavior": null}. ' +
            '"description": ONE to TWO short sentences, warm/cozy tone, no preamble, ' +
            'no quotes around it, under 30 words total — say what the thing IS and maybe one charming detail, ' +
            'not what it does (that goes in narrative_function). "tags": 2 to 5 short (1-2 word) INFERRED traits — ' +
            'material, mood, colour, or notable quality (e.g. "artificial", "cozy", "sharp", "ancient") — ' +
            'not a restatement of the whole prompt, not the item\'s name, and never prefixed with "prompt:" ' +
            '(that tag is added separately, elsewhere). "narrative_function": ONE short sentence, same cozy ' +
            'tone, saying what the item DOES for the player — take the function they described seriously, ' +
            'even a strange one.\n\n' +
            MODIFIER_PROMPT,
        },
        { role: 'user', content: `Category: ${category}. The player asked for: "${prompt}".` },
      ],
      { temperature: 0.8, maxTokens: 400, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
    );
    const description = typeof r?.description === 'string' ? r.description.trim() : '';
    const tags = Array.isArray(r?.tags)
      ? r.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
      : [];
    if (!description) throw new Error('empty description');
    // parseItemFunction never throws — worst case the item is cosmetic, which
    // must not cost the player their whole craft.
    const intent = parseGameplayIntent(r?.gameplay_intent);
    return { description, tags: tags.slice(0, 5), fn: parseItemFunction(r ?? {}, intent) };
  } catch (err) {
    console.warn('[llm] craftDescribe fell back to mock:', err);
    return mockCraftDescribe(prompt, category);
  }
}
