// LLM backend for the shop/craft/detail features.
//
// If an API key is configured (VITE_LLM_API_KEY in .env) these functions call
// a real OpenAI-compatible model via ./llmClient. If not — or if the call
// fails for any reason — they fall back to the built-in mock responses below.
// Nothing else in the app knows (or may know) which path ran: same async
// interface either way.

import { llmEnabled, chat, chatJSON, chatStream, MODELS } from './llmClient';
// Build-time-generated static data (produced offline by scripts/build-*.mjs).
// The shop samples from these; if they're empty, it falls back to ITEM_POOL.
import catalogData from './data/catalog.json';
import spritesData from './data/sprites.json';
// Sprite generation pipeline (text-only → validate → retries → error).
import {
  parseSpec,
  resolveStyle,
  instanceFromSpec,
  makeSprite,
  screenCraftPrompt,
  suggestAlternatives,
  type CraftLog,
} from './craft';
import { generateReferenceImage } from './imageGen';

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
  apple: [
    'Apples float because they are about 25% air.',
    'There are more than 7,500 apple varieties grown around the world.',
    'An apple tree can take four to five years to produce its first fruit.',
    'The science of growing apples is called pomology.',
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
  apple: 5,
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
  color?: string; // crafted items: player-chosen colour (CSS colour)
  scale?: number; // crafted items: player-chosen size multiplier
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

const TOKEN_PRICES: Record<Category, number> = {
  plant: 12,
  pets: 30,
  clothing: 15,
  vehicle: 35,
  food: 10,
  utensils: 14,
};

function seededRand(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The shop's stock for one category and one real-world hour: a craft token
// first, then 3 "generated" items. Same hour → same stock (deterministic).
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
  const token: ShopItem = {
    id: `${category}-token-${hourSeed}`,
    name: `${category[0].toUpperCase() + category.slice(1)} Token`,
    category,
    sprite: TOKEN_SPRITE,
    desc: `A craft token attuned to everything ${category}.`,
    funcDesc: `use it to craft any ${category}-ish thing u can describe.`,
    price: TOKEN_PRICES[category],
    kind: 'token',
    equip: null,
  };
  return [token, ...picked];
}

// keywords that clearly belong to a category — used to reject cross-category
// craft requests (a plant token can't craft a bicycle)
const CATEGORY_WORDS: Record<Category, string[]> = {
  plant: ['flower', 'tree', 'plant', 'rose', 'daisy', 'cactus', 'fern', 'bush', 'herb', 'vine', 'seed'],
  pets: ['dog', 'puppy', 'cat', 'kitten', 'bird', 'bunny', 'rabbit', 'pet', 'turtle', 'hamster', 'fox'],
  clothing: ['hat', 'scarf', 'boots', 'shirt', 'cape', 'coat', 'glove', 'sock', 'dress', 'jacket'],
  vehicle: ['bike', 'bicycle', 'boat', 'ship', 'canoe', 'kayak', 'skateboard', 'cart', 'wagon', 'sled', 'car', 'scooter'],
  food: ['bread', 'pie', 'cake', 'cheese', 'soup', 'apple', 'berry', 'honey', 'cookie', 'stew', 'sandwich'],
  utensils: ['can', 'watering', 'trowel', 'basket', 'pot', 'bucket', 'shovel', 'rake', 'hoe', 'spade'],
};

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

// Live-progress hooks the crafting UI can pass into craftItem.
export interface CraftUiHooks {
  onStage?: (stage: 'image' | 'drawing' | 'retrying') => void;
  onLine?: (line: string, index: number, level: 0 | 1 | 2) => void;
  onImage?: (dataUrl: string) => void;
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
    desc: `Custom-crafted from a ${category} token.`,
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

// Craft anything the player describes. With an LLM key set, this runs the
// generate → validate → shared-store → fail pipeline and produces a real
// per-prompt sprite (plus the player's colour/size). Offline, it falls back to
// the keyword-based mock below so the game still crafts.
export async function craftItem(category: Category, prompt: string, ui?: CraftUiHooks): Promise<CraftResult> {
  if (llmEnabled) {
    const spec = parseSpec(prompt);
    const wanted = CRAFT_TO_TOKEN[spec.category];
    if (wanted && wanted !== category) {
      return {
        ok: false,
        reply: `hmm... that sounds more like a ${wanted} thing. this token only crafts ${category} stuff. try again?`,
      };
    }
    try {
      // PRE-FLIGHT SCREEN — one cheap call making every judgment needed
      // before generation (category fit + content safety + size class; the
      // size classification used to be its own call inside makeSprite, so
      // this is net-zero extra calls). A mismatch or blocked prompt bails
      // here for ~$0.00002 instead of a full wasted generation.
      const screened = await screenCraftPrompt(prompt, category, chatJSON, {
        model: MODELS.fast,
        fallbackModel: MODELS.fastFallback,
      });
      if (screened.sensitive) {
        // deliberately NO suggestions on blocked input
        return {
          ok: false,
          reply: "let's keep it cozy in my shop... i won't craft that one. try something friendlier?",
        };
      }
      if (!screened.fit) {
        // deliberately NO suggestions on a category mismatch
        return {
          ok: false,
          reply: screened.tokenHint
            ? `hmm... "${prompt}" feels more like a ${screened.tokenHint} thing. this token only crafts ${category} stuff, purr.`
            : `hmm... "${prompt}" doesn't really feel like a ${category} thing. this token only crafts ${category} stuff. try again?`,
        };
      }

      // Text-only → validate → retries. If every attempt fails, sprite is
      // null and the player gets an honest error message (no template
      // stand-in, no silent substitution — deliberate).
      // strategy:'text-only' — dropped the image-mediated step: it was both
      // expensive (vision tokens) and counterproductive (over-specifying
      // visual detail from a reference image was hurting sprite quality, not
      // helping). genImage/onImage/onStage('image') stay wired but go
      // unused — keeps the A/B capability available if image-mediated
      // generation is worth revisiting later; just flip strategy back.
      const { sprite, log, refImage, error } = await makeSprite(prompt, category, {
        genImage: generateReferenceImage,
        chatStream, // streaming Stage 2 transport (per-line validation + fail-fast)
        classify: async () => screened.sizeClass, // already decided by the screen
        model: MODELS.smart, // ASCII sprite generation — primary
        modelFallback: MODELS.smartFallback, // used only if the primary fails before any output
        strategy: 'text-only',
        onStage: ui?.onStage,
        onLine: ui?.onLine,
        onImage: ui?.onImage,
      });
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
      const item = buildCraftedItem(category, name, prompt);
      item.sprite = sprite.lines; // the freshly generated sprite
      // colour still comes from the player's words; size is baked into the
      // sprite's own dimensions (sizeClass), so no CSS scale needed.
      const style = resolveStyle(instanceFromSpec(spec, item.id));
      if (style.color) item.color = style.color;
      item.desc = `Freshly crafted from a ${category} token.`;
      return { ok: true, item, refImage };
    } catch (err) {
      console.warn('[craft] pipeline error:', err);
      return {
        ok: false,
        reply: "oops... something went wrong on my workbench. give it another try in a moment?",
      };
    }
  }

  await delay(900);
  const p = prompt.toLowerCase();
  const fitsOwn = CATEGORY_WORDS[category].some((w) => p.includes(w));
  const other = CATEGORIES.find(
    (c) => c !== category && CATEGORY_WORDS[c].some((w) => p.includes(w)),
  );
  if (!fitsOwn && other) {
    return {
      ok: false,
      reply: `hmm... that sounds more like a ${other} thing. this token only crafts ${category} stuff. try again?`,
    };
  }
  const name = prompt.trim().slice(0, 18).replace(/^\w/, (c) => c.toUpperCase()) || 'Mystery Thing';
  return { ok: true, item: buildCraftedItem(category, name, prompt) };
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
  'shake the apple tree. trust me.',
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
