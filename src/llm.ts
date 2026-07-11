// TODO: replace with Anthropic API call.
// This module mocks an LLM backend. Nothing else in the app knows (or may
// know) whether these responses are mocked — same async interface either way.

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

export const CATEGORIES = ['plant', 'pets', 'clothing', 'vehicle', 'food'] as const;
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
  equip: null | {
    mode: 'vehicle' | 'hold' | 'pet';
    speedMult?: number; // vehicles: movement interval multiplier (<1 = faster)
    waterOnly?: boolean; // e.g. boats — unusable until water exists
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
    { name: 'Sail Boat', category: 'vehicle', sprite: ['   |\\', '   |_\\', ' \\____/'], desc: 'A small boat with a proud sail.', funcDesc: 'can only be used on water.', price: 35, equip: { mode: 'vehicle', speedMult: 0.6, waterOnly: true } },
    { name: 'Hand Wagon', category: 'vehicle', sprite: ['[____]', ' o  o'], desc: 'Squeaky but reliable.', funcDesc: 'ride it to move a bit faster.', price: 20, equip: { mode: 'vehicle', speedMult: 0.85 } },
  ],
  food: [
    { name: 'Bread', category: 'food', sprite: ['  ____', ' (____)'], desc: 'Fresh from someone’s oven.', funcDesc: 'a tasty snack. smells amazing.', price: 4, equip: { mode: 'hold' } },
    { name: 'Berry Pie', category: 'food', sprite: ['  ~ ~', ' ~~~~~', '(_____)'], desc: 'Still warm in the middle.', funcDesc: 'a tasty snack. share it maybe.', price: 7, equip: { mode: 'hold' } },
    { name: 'Cheese', category: 'food', sprite: ['  ___', ' /o_o\\', ' |___|'], desc: 'Aged to perfection.', funcDesc: 'a tasty snack. mice approve.', price: 5, equip: { mode: 'hold' } },
    { name: 'Honey Jar', category: 'food', sprite: [' [=]', '(###)', '(___)'], desc: 'Liquid gold from local bees.', funcDesc: 'a tasty snack. sticky though.', price: 9, equip: { mode: 'hold' } },
  ],
};

const TOKEN_PRICES: Record<Category, number> = {
  plant: 12,
  pets: 30,
  clothing: 15,
  vehicle: 35,
  food: 10,
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
  const pool = [...ITEM_POOL[category]];
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
};

const WATER_WORDS = ['boat', 'ship', 'canoe', 'kayak', 'raft'];
const FAST_WORDS = ['bike', 'bicycle', 'scooter'];

export type CraftResult = { ok: true; item: ShopItem } | { ok: false; reply: string };

// Craft anything the player describes, as long as it fits the token's
// category. Mocked: keyword checks stand in for real LLM judgement.
export async function craftItem(category: Category, prompt: string): Promise<CraftResult> {
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
  const rnd = seededRand(Array.from(prompt).reduce((a, c) => a + c.charCodeAt(0), category.length));
  const pool = ITEM_POOL[category];
  const template = pool[Math.floor(rnd() * pool.length)];
  let equip: ShopItem['equip'];
  let funcDesc: string;
  switch (category) {
    case 'vehicle': {
      const water = WATER_WORDS.some((w) => p.includes(w));
      const fast = FAST_WORDS.some((w) => p.includes(w));
      equip = { mode: 'vehicle', speedMult: fast ? 0.55 : 0.7, waterOnly: water };
      funcDesc = water ? 'can only be used on water.' : 'ride it to move faster.';
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
  }
  return {
    ok: true,
    item: {
      id: `craft-${Date.now()}`,
      name,
      category,
      sprite: template.sprite,
      desc: `Custom-crafted from a ${category} token.`,
      funcDesc,
      price: 0,
      kind: 'item',
      equip,
    },
  };
}

export async function getFunFact(itemName: string): Promise<string> {
  await delay(400);
  const facts = FACTS[itemName] ?? ['Not much is known about this item.'];
  return facts[Math.floor(Math.random() * facts.length)];
}

export async function getPrice(itemName: string): Promise<number> {
  await delay(400);
  const base = BASE_PRICE[itemName] ?? 1;
  // slight random variance: -1, 0, or +1
  return Math.max(1, base + Math.floor(Math.random() * 3) - 1);
}
