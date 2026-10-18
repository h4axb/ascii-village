// LLM backend for the shop/craft/detail features.
//
// If an API key is configured (VITE_LLM_API_KEY in .env) these functions call
// a real OpenAI-compatible model via ./llmClient. If not — or if the call
// fails for any reason — they fall back to the built-in mock responses below.
// Nothing else in the app knows (or may know) which path ran: same async
// interface either way.

import { llmEnabled, chat, chatJSON, MODELS, AiServiceError, type AiFailure } from './llmClient';
import type { DailySaju } from './saju';
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
  classifyKind,
  resolvePrefs,
  hasKindPrefs,
  densityOf,
  temperatureOf,
  planPrefsText,
  applyColorPref,
  isKind,
  type Prefs,
  planAndRender,
  analyzeCraft,
  SIZE_QUESTION,
  MOOD_PRESETS,
  textureModifierFor,
  type ClarifyQuestion,
  type Mood,
  type SizeClass,
  type CraftPreflight,
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
import { fallbackNote, fitToGame, typoDistance } from './craft/colours';
import { readPrompt, type PromptRead } from './craft/readPrompt';
import { SVG_PROMPT, coverage, parseDrawing, rasterSvg } from './craft/svgDraw';
import { LINK } from './link';
import { closestWords, kindOf, promptParts, themeOfObject, type Theme } from './craft/lexicon';
import { fallbackSubject, missingAssetNote } from './craft/fallbackCraft';
import { renderPlan, templatePlan } from './craft/spritePipeline';

// ---- the fallback's surprise and closest reading (clarifyPrompt) ----
const THEMES: Theme[] = ['ships', 'watering', 'pets'];
// a few of each theme's library-made objects, for "Surprise me"
const THEME_SURPRISES: Record<Theme, string[]> = {
  ships: ['pirate ship', 'shark ship', 'galleon', 'turtle ship', 'viking ship', 'sailboat', 'rowboat'],
  // (no colour words: the player's own colour is kept on top)
  watering: ['watering can', 'classic watering can', 'watering can with a flower on top'],
  pets: ['golden retriever', 'corgi', 'husky', 'pug', 'dachshund', 'shiba inu', 'beagle', 'border collie'],
};
// the prompt's understood colour and size words, kept for a new reading
function keptWords(prompt: string): string[] {
  return (prompt.toLowerCase().match(/[\p{L}-]+/gu) ?? []).filter((w) => {
    const k = kindOf(w);
    return k === 'colour' || k === 'size';
  });
}
function themeSurprisePrompt(prompt: string, theme: Theme): string {
  const list = THEME_SURPRISES[theme];
  return [...keptWords(prompt), list[Math.floor(Math.random() * list.length)]].join(' ');
}
import {
  REF_CRAFT_ON,
  hasRefBodies,
  matchRefs,
  refPrompt,
  refCatalogue,
  parseRefChoice,
  choiceToMatch,
  buildFromMatch,
  refDescription,
  gameCategoryOf,
  logRefCraft,
  bakeImage,
  drawnBands,
  isWateringCan,
  isAlwaysRef,
  isShip,
  shapeShip,
  shapeWateringCan,
  colourOf,
  colourPhrasesOf,
  partSwatches,
  colourPrompt,
  parseColours,
  applyColours,
  wholeColour,
  withoutDetails,
  unknownsOf,
  type RefMatch,
} from './craft/refCraft';
import type { RefDoc } from './glyph/refs';

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
  seed: 1,
  bloom: 20, // exactly one crafting token (TOKEN_PRICE)
  // the gift seeds' harvests, each worth about one token: three berries
  // (7 each) or one pumpkin
  strawberry: 7,
  pumpkin: 21,
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
  grip?: 'left' | 'right'; // held items: the side its handle is on (right = held in the left hand)
  // made from the reference library: that body's id (and mirrored?), e.g. a
  // ship's seats for the boarding cinematic (shipSeats.ts)
  refId?: string;
  refMirror?: boolean;
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
  // kind: what kind of thing it is (its main element) and applied: the
  // player's crafting preferences used for it — both only with opts.prefs
  // note: what Mitchy says after it (a colour that couldn't be mixed exactly)
  | { ok: true; item: ShopItem; refImage?: string; kind?: Category; applied?: Prefs; note?: string; fixes?: [string, string][] }
  // `suggestions`: up to 3 alternative craft prompts (shown as clickable
  // buttons). Present only on BENIGN failures — never on category mismatches
  // or blocked (sensitive) input.
  // aiDown: the AI service couldn't be reached at all (see AiDown)
  // error: the technical reason a drawing failed (for the /1 feedback log)
  | { ok: false; reply: string; suggestions?: string[]; aiDown?: AiDown; error?: string };

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
// `opts.retry: false` skips the automatic re-plan after a failed first plan
// (the /1 test link); by default it runs as before.
// prefs: apply the player's crafting preferences (craft/prefs.ts) — the /2
// link; without it everything crafts exactly as before
// clarify: the player's answers from the pre-clarification step (the /1
// link) — planner guidance plus exact size / finish / mood overrides; with
// noAlts a failure offers no alternative ideas
type CraftOpts = { retry?: boolean; prefs?: boolean; clarify?: CraftClarify; noAlts?: boolean };
// The prompt is read first (craft/readPrompt.ts: its spelling fixed, its
// size / colours / details as tags), and everything after crafts from the
// fixed prompt; the item's "prompt:" tag keeps what the player typed.
export async function craftItem(prompt: string, ui?: CraftUiHooks, opts: CraftOpts = {}): Promise<CraftResult> {
  const policy = checkPolicy(prompt);
  if (!policy.allowed) return { ok: false, reply: policy.reason! };
  const typed = prompt;
  // an unreadable prompt read as its closest known object, or a surprise of
  // its theme (keeping the colours and sizes that were understood)
  if (opts.clarify?.rewrite) prompt = opts.clarify.rewrite;
  if (opts.clarify?.themeSurprise) prompt = themeSurprisePrompt(prompt, opts.clarify.themeSurprise);
  // the pre-clarification's answers about unknown words: the known word the
  // player picked, or the word left out — before the prompt is read
  for (const [from, to] of opts.clarify?.replace ?? []) prompt = prompt.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), to);
  if (opts.clarify?.dropDetails?.length) prompt = withoutDetails(prompt, opts.clarify.dropDetails);
  const read = await readPrompt(prompt);
  if (read.fixes.length) console.info('[craft] read as', JSON.stringify(read.fixed), read.fixes);
  // crafting never fails: anything that breaks on the way crafts the
  // fallback (blocked prompts are still refused inside)
  let r: CraftResult;
  try {
    r = await craftFixed(read.fixed, ui, opts, read);
  } catch (err) {
    r = await fallbackCraft(read.fixed, opts, read, String(err));
  }
  if (!r.ok) return r;
  r.item.tags = (r.item.tags ?? []).map((t) => (t.startsWith('prompt: ') ? `prompt: ${typed.trim()}` : t));
  return read.fixes.length ? { ...r, fixes: read.fixes } : r;
}

async function craftFixed(prompt: string, ui: CraftUiHooks | undefined, opts: CraftOpts, read: PromptRead): Promise<CraftResult> {
  // Local content policy runs FIRST and on every path — before any network
  // call, and equally in offline/mock mode. The model-side `sensitive` check
  // below is fail-open by design (a failed request returns "not sensitive"),
  // so this deterministic pass is the part that always holds.
  const policy = checkPolicy(prompt);
  if (!policy.allowed) return { ok: false, reply: policy.reason! };
  // the details the player chose to leave out (the /1 pre preferences)
  if (opts.clarify?.dropDetails?.length) prompt = withoutDetails(prompt, opts.clarify.dropDetails);

  // From the reference library first (craft/refCraft.ts): 0 calls when the
  // matcher can place every word, 1 small call otherwise. Nothing in the
  // library fits -> the shape planner below, as before.
  // (watering cans and dogs come from the library on every link:
  // src/data/refs/watering-can-* and pet-dog-*)
  if ((REF_CRAFT_ON || isAlwaysRef(matchRefs(prompt))) && hasRefBodies()) {
    const r = await craftWithRefs(prompt, ui, opts, read).catch((err) => {
      console.warn('[craft] reference craft failed:', err);
      return null;
    });
    if (r) return r;
  }

  // the test link /4: the AI draws it (craft/svgDraw.ts); a failed drawing
  // falls through to the shape planner below
  if (LINK === '4' && llmEnabled) {
    const r = await craftDrawn(prompt, ui, read);
    if (r) return r;
  }

  if (llmEnabled) {
    const spec = parseSpec(prompt);
    try {
      // PLAN — one cheap call that now decides content safety, size, AND the
      // region-by-region visual composition (CraftPlan) in one shot. Its
      // `fit` field no longer gates anything: a universal token has no
      // category to mismatch against, so the only rejection left here is a
      // blocked prompt. `tokenHint` is still useful as a category guess.
      // The preferences for the planner (surprise) have to be
      // known before it runs; when some are saved for one KIND of thing, a
      // tiny call finds this request's kind first.
      let planPrefs: Prefs = {};
      if (opts.prefs) {
        const guess = hasKindPrefs()
          ? await classifyKind(prompt, chatJSON, { model: MODELS.fast, fallbackModel: MODELS.fastFallback })
          : null;
        planPrefs = resolvePrefs(isKind(guess) ? guess : null);
      }
      const prefsText = [opts.prefs ? planPrefsText(planPrefs) : '', opts.clarify?.guidance ?? ''].filter(Boolean).join('\n\n');
      const temperature = opts.prefs ? temperatureOf(planPrefs) : undefined;
      // no link ever ends without an item: a plan call that breaks (other
      // than the AI being unreachable: the fallback below) goes on with no
      // plan, and the pipeline's rescue draws it (spritePipeline.ts neverFail)
      const neverFail = true;
      let plan: Awaited<ReturnType<typeof planCraft>>;
      try {
        plan = await planCraft(prompt, spec.category, chatJSON, {
          model: MODELS.fast,
          fallbackModel: MODELS.fastFallback,
          prefsText,
          temperature,
        });
      } catch (err) {
        if (err instanceof AiServiceError) throw err;
        console.warn('[craft] plan call failed, rescuing:', err);
        plan = { fit: true, sensitive: false, sizeAdjust: 'default', sizeClass: opts.clarify?.size ?? 'medium', name: '', width: 0, height: 0, parts: [], regions: [] };
      }
      if (plan.sensitive) {
        // deliberately NO suggestions on blocked input
        return {
          ok: false,
          reply: "let's keep it cozy in my shop... i won't craft that one. try something friendlier?",
        };
      }
      // With preferences, the planner's own judgement of the main element is
      // the kind — and the item's category, since they are the same six.
      const category =
        opts.prefs && isKind(plan.kind)
          ? (plan.kind as Category)
          : inferCategory(spec.category, plan.tokenHint as Category | undefined);
      // density and colour act after planning, so they follow the final kind
      const postPrefs: Prefs = opts.prefs ? resolvePrefs(category) : {};
      const applied: Prefs = opts.prefs
        ? {
            surprise: planPrefs.surprise,
            detail: postPrefs.detail,
            color: postPrefs.color,
          }
        : {};

      // Normalize/validate the plan → render locally (deterministic, no
      // LLM) → one retry of the PLAN on a hard failure. If both attempts
      // fail, sprite is null and the player gets an honest error message (no
      // template stand-in, no silent substitution — deliberate). Rendering
      // is instant/local now, so there's nothing to parallelize it against —
      // craftDescribe runs after category is known, same dependency as
      // before, just no longer racing a Stage-2 call that no longer exists.
      ui?.onStage?.('drawing');
      const { sprite, log, error, rescue } = await planAndRender(prompt, category, plan, {
        chat: chatJSON,
        model: MODELS.fast,
        fallbackModel: MODELS.fastFallback,
        retry: opts.retry,
        neverFail,
        colour: pickedHex(opts.clarify?.colour),
        ...(opts.prefs
          ? { multiplier: densityOf(postPrefs), color: postPrefs.color, prefsText, temperature }
          : {}),
        ...(opts.clarify
          ? {
              prefsText,
              sizeClass: opts.clarify.size,
              ...(opts.clarify.mood
                ? { palette: MOOD_PRESETS[opts.clarify.mood].palette, glyphs: MOOD_PRESETS[opts.clarify.mood].glyphs }
                : {}),
            }
          : {}),
      });
      if (log.retried) ui?.onStage?.('retrying');
      if (sprite) sprite.lines.forEach((line, i) => ui?.onLine?.(line, i, log.fallbackLevel as 0 | 1));
      const description = await craftDescribe(prompt, category);
      craftLog.push(log);
      console.info('[craft]', log);

      // nothing drawn, or only the pipeline's stand-in shape: the never-fail
      // fallback (its unified reading picks the shape; Mitchy says the asset
      // is missing). A plan of the AI's own, rendered leniently, stays.
      if (!sprite || rescue === 'template') return fallbackCraft(prompt, opts, read, error ?? 'only the template shape');

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
      const finish = opts.clarify?.finish ?? (opts.clarify?.mood ? MOOD_PRESETS[opts.clarify.mood].finish : undefined);
      if (finish) item.textureModifier = finish;
      // /1: drawn without a reference picture (none fits the words) or
      // rescued: Mitchy says it's a first try
      const untrained = neverFail && (rescue || !matchRefs(prompt).body) ? UNTRAINED_NOTE : undefined;
      const out: CraftResult = opts.prefs ? { ok: true, item, kind: category, applied } : { ok: true, item };
      return untrained ? { ...out, note: untrained } : out;
    } catch (err) {
      console.warn('[craft] pipeline error:', err);
      // the AI unreachable, or anything else breaking: the fallback
      return fallbackCraft(prompt, opts, read, err instanceof AiServiceError ? `AI unreachable (${err.failure})` : String(err));
    }
  }
  // no AI at all (no key): the fallback
  return fallbackCraft(prompt, opts, read, 'offline');
}

// The never-fail fallback, for every link and both designs: the library body
// when one fits (no AI call: an outage still gives real pictures for known
// things), else the built-in shape for what the unified word lists read the
// prompt as (craft/fallbackCraft.ts) - and Mitchy says that asset is missing
// and noted for a next patch (logged with the missing references).
async function fallbackCraft(prompt: string, opts: CraftOpts, read: PromptRead | undefined, why: string): Promise<CraftResult> {
  console.warn('[craft] fallback:', why);
  if (hasRefBodies() && matchRefs(prompt).body) {
    const r = await craftWithRefs(prompt, undefined, { ...opts, noModel: true }, read).catch((err) => {
      console.warn('[craft] fallback: library failed:', err);
      return null;
    });
    if (r) return r;
  }
  const subject = fallbackSubject(prompt);
  const category: Category = subject.category ?? inferCategory(parseSpec(prompt).category);
  const word = subject.word ?? prompt.trim().split(/\s+/).pop() ?? '';
  const name = (word || 'Mystery Thing').slice(0, 18).replace(/^\w/, (c) => c.toUpperCase());
  const d = mockCraftDescribe(prompt, category);
  const item = buildCraftedItem(category, name, prompt, { funcDesc: d.fn.narrative });
  try {
    // the player's colour (the answer, else the first colour said) and size
    const said = colourPhrasesOf(prompt)[0]?.base;
    const rgb = said ? colourOf(said) : null;
    const colour = pickedHex(opts.clarify?.colour) ?? (rgb ? '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') : undefined);
    const size = opts.clarify?.size ?? read?.size ?? 'medium';
    const sprite = renderPlan(prompt, templatePlan(category, name, colour, size));
    item.sprite = sprite.lines;
    if (sprite.palette && sprite.colors) {
      item.palette = sprite.palette;
      item.colors = sprite.colors;
    }
    if (sprite.resolutionScale) item.scale = sprite.resolutionScale;
  } catch (err) {
    // (the category's own sprite stays)
    console.warn('[craft] fallback: shape failed:', err);
  }
  item.fn = d.fn;
  item.desc = d.description;
  item.tags = [...d.tags, `prompt: ${prompt.trim()}`];
  item.textureModifier = textureModifierFor(parseSpec(prompt).finish);
  logRefCraft(prompt, 'planner', null, word ? [word] : []);
  const note = missingAssetNote(subject.word);
  return opts.prefs ? { ok: true, item, kind: category, applied: {}, note } : { ok: true, item, note };
}

// /4: one smart-model call draws the item as an SVG; cleaned, drawn on a
// canvas and baked into glyphs like a reference picture. null = no usable
// drawing (the shape planner takes over).
async function craftDrawn(prompt: string, ui: CraftUiHooks | undefined, read: PromptRead): Promise<CraftResult | null> {
  const t0 = performance.now();
  try {
    ui?.onStage?.('drawing');
    const raw = await chatJSON<Record<string, unknown>>(
      [
        { role: 'system', content: SVG_PROMPT },
        { role: 'user', content: `The player asked for: "${prompt}"` },
      ],
      { temperature: 0.6, maxTokens: 4000, model: MODELS.smart, fallbackModel: MODELS.fast },
    );
    const d = parseDrawing(raw);
    if (!d) {
      console.warn('[craft] drawing: no usable SVG');
      return null;
    }
    const img = await rasterSvg(d.svg);
    if (coverage(img) < 0.03) {
      console.warn('[craft] drawing: nearly empty');
      return null;
    }
    const category: Category = (CATEGORIES as readonly string[]).includes(d.category) ? (d.category as Category) : inferCategory(parseSpec(prompt).category);
    const band = drawnBands(category, read.size ?? undefined);
    const g = bakeImage(img, band.signs, band.screenW);
    // the drawing's colours in the game's palette, like any AI colour
    const palette = Object.fromEntries(Object.entries(g.palette).map(([k, h]) => [k, '#' + fitToGame(hexRgb(h)).map((v) => v.toString(16).padStart(2, '0')).join('')]));
    const description = await craftDescribe(prompt, category);
    const name = d.name || prompt.trim().slice(0, 18).replace(/^\w/, (c) => c.toUpperCase()) || 'Mystery Thing';
    const item = buildCraftedItem(category, name, prompt, { funcDesc: description.fn.narrative });
    item.fn = description.fn;
    item.sprite = g.lines;
    item.colors = g.colors;
    item.palette = palette;
    item.scale = g.scale;
    item.desc = d.description || description.description;
    item.tags = [...description.tags, `prompt: ${prompt.trim()}`];
    console.info('[craft] drawn by the AI', { ms: Math.round(performance.now() - t0), glyphs: g.signs, category });
    return { ok: true, item, refImage: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d.svg) };
  } catch (err) {
    console.warn('[craft] drawing failed:', err);
    return null;
  }
}

// A craft from the reference library: the matcher's recipe, or the model's
// when the words need it (unknown details, a name, an invented function).
// null = the library can't express it: the caller uses the shape planner.
async function craftWithRefs(
  prompt: string,
  ui: CraftUiHooks | undefined,
  opts: { prefs?: boolean; clarify?: CraftClarify; noModel?: boolean },
  read?: PromptRead,
): Promise<CraftResult | null> {
  // the clarify answer: its own hex ("Sky blue"), else its colour word
  const cc = opts.clarify?.colour?.trim().toLowerCase();
  const pickedColour = cc ? (/^#[0-9a-f]{6}$/.test(cc) ? fitToGame(hexRgb(cc)) : colourOf(cc.split(/\s+/).pop()!)) : null;
  const first = matchRefs(prompt);
  // the /2 preferences for this kind of thing (the body's category): detail
  // and colour in the bake, surprise in the variant pick and the model call
  const kind = first.body ? gameCategoryOf(first.body) : null;
  const prefs: Prefs = opts.prefs ? resolvePrefs(isKind(kind) ? kind : null) : {};
  const surprise = opts.clarify?.surprise ?? (prefs.surprise === 1 ? true : prefs.surprise === -1 ? false : undefined);
  const shape = { surprise, colour: pickedColour };
  let m: RefMatch & { details?: Parameters<typeof buildFromMatch>[0]['details']; mirror?: boolean } = isShip(first)
    ? shapeShip(first, prompt, shape)
    : shapeWateringCan(first, prompt, shape);
  // a watering can or a ship keeps what was picked here (variant, colours,
  // what's taken out, where the details go); the model only adds the details
  const can = isWateringCan(m) || isShip(m) ? { body: m.body!, colours: m.colours, petals: m.petals, blank: m.blank, detailArea: m.detailArea, styleDetails: m.styleDetails } : null;
  // where the details go: the picked area first; a feature that belongs
  // elsewhere on the body (a ship's hull, its bow) may use those areas
  const others = m.body?.areas.filter((a) => a.type === 'detail' && a.name !== m.detailArea).map((a) => `"${a.name}"`) ?? [];
  const where = m.detailArea
    ? `\nDraw the details the player asked for (${m.leftover.join(', ')}) as regions in the area "${m.detailArea}" of the body "${m.body!.id}"${others.length ? ` (or, for a feature that belongs elsewhere, in ${others.join(' / ')})` : ''}, and keep that body.`
    : '';
  let text: { description: string; tags: string[]; fn: ItemFunction; name?: string } | null = null;
  let via: 'match' | 'model' = 'match';
  if (m.needsModel && llmEnabled && !opts.noModel) {
    try {
      const raw = await chatJSON<Record<string, unknown>>(
        [
          { role: 'system', content: refPrompt() },
          { role: 'user', content: `Library: ${refCatalogue(m)}\n\nThe player asked for: "${prompt}"${where}${prefs.surprise ? `\n\n${planPrefsText(prefs)}` : ''}` },
        ],
        { temperature: prefs.surprise ? temperatureOf(prefs) - 0.2 : 0.5, maxTokens: 900, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
      );
      const c = parseRefChoice(raw);
      const chosen = c ? choiceToMatch(c, m) : null;
      if (!chosen) {
        logRefCraft(prompt, 'planner', null, m.leftover);
        return null;
      }
      m = chosen;
      // a watering can keeps the variant and colours picked above; the
      // model only adds the details
      if (can) {
        const own = new Set(can.body.areas.filter((a) => a.type === 'detail').map((a) => a.name));
        const details = can.detailArea ? (m.details ?? []).map((d) => (own.has(d.area) ? d : { ...d, area: can.detailArea! })) : m.details;
        m = { ...m, body: can.body, colours: { ...m.colours, ...can.colours }, petals: can.petals, blank: can.blank, detailArea: can.detailArea, details, styleDetails: can.styleDetails };
      }
      via = 'model';
      if (c?.description) text = { description: c.description, tags: c.tags ?? [], fn: c.fn!, name: c.name };
    } catch (err) {
      console.warn('[craft] reference call failed:', err);
      if (!m.body) return null;
    }
  }
  if (pickedColour) m = wholeColour(m, pickedColour);
  // the colours exactly as said ("baby blue"): the model names them; only
  // when it doesn't answer the base colour words stay, and Mitchy says so
  let note: string | undefined;
  const phrases = colourPhrasesOf(prompt);
  if (phrases.length) {
    const exact = m.body && !opts.noModel ? await craftColours(prompt, m.body) : null;
    if (exact) m = applyColours(m, exact);
    else note = fallbackNote(phrases) ?? undefined;
  }
  if (!m.body) {
    logRefCraft(prompt, 'planner', null, m.leftover);
    return null;
  }
  ui?.onStage?.('drawing');
  // the size: the answer, else a size word in the prompt
  const said = read?.size ?? (/\b(tiny|small|little|mini)\b/i.test(prompt) ? 'small' : /\b(big|large|huge|giant)\b/i.test(prompt) ? 'large' : /\bmedium\b/i.test(prompt) ? 'medium' : undefined);
  // the surprise (design A's answer, design B's preference): a decoration
  // from the universal library, fitted to the item (craft/surpriseLib.ts)
  if (surprise) m.surprise = { seed: prompt.trim().toLowerCase() };
  const sp = await buildFromMatch(m, opts.clarify?.size ?? said, prefs.detail ?? 0);
  if (prefs.color) sp.palette = applyColorPref(sp.palette, prefs.color);
  sp.lines.forEach((line, i) => ui?.onLine?.(line, i, 0));
  logRefCraft(prompt, via, m.body.id, m.leftover);
  const category = gameCategoryOf(m.body);
  const t = text ?? refDescription(m);
  // no model text: the words before "with", without a leading article
  const head = prompt.trim().split(/\s+(?:with|and|that|which)\s+/i)[0].replace(/^(a|an|the|my)\s+/i, '');
  const short = head.length <= 24 ? head : head.slice(0, 24).replace(/\s+\S*$/, '');
  const name = text?.name || short.replace(/^\w/, (ch) => ch.toUpperCase()) || m.body.title;
  const item = buildCraftedItem(category, name, prompt, { funcDesc: t.fn.narrative });
  item.fn = t.fn;
  item.sprite = sp.lines;
  item.palette = sp.palette;
  item.colors = sp.colors;
  item.scale = sp.scale;
  item.refId = m.body.id;
  if (m.mirror) item.refMirror = true;
  item.desc = t.description;
  item.tags = [...t.tags, `prompt: ${prompt.trim()}`];
  // a ship from the library floats
  // (always a vehicle: a boat is never held in the hand)
  if (isShip(m)) item.equip = { ...item.equip, mode: 'vehicle', float: true };
  // a watering can waters
  if (can && isWateringCan(m)) {
    item.tool = 'water';
    item.equip = { mode: 'hold' };
    // the references have the spout left and the handle right
    item.grip = m.mirror ? 'left' : 'right';
  }
  const spec = parseSpec(prompt);
  item.textureModifier = textureModifierFor(spec.finish);
  const finish = opts.clarify?.finish ?? (opts.clarify?.mood ? MOOD_PRESETS[opts.clarify.mood].finish : undefined);
  if (finish) item.textureModifier = finish;
  console.info('[craft] from references', { body: m.body.id, via, signs: sp.signs, swaps: m.swaps.map((x) => x.ref.id), decorations: m.decorations.map((x) => x.ref.id) });
  const out: CraftResult = opts.prefs ? { ok: true, item, kind: category, applied: { detail: prefs.detail, color: prefs.color, surprise: prefs.surprise } } : { ok: true, item };
  // the surprise is named, so the player can spot it
  if (sp.surpriseName) {
    item.tags = [...(item.tags ?? []), `surprise: ${sp.surpriseName}`];
    note = [note, `I added a little surprise: ${sp.surpriseName}.`].filter(Boolean).join(' ');
  }
  return note ? { ...out, note } : out;
}

// what Mitchy says after an item drawn without a reference picture (/1)
const UNTRAINED_NOTE = "I haven't crafted one of these before, so this is a first try. I still need more training for things like this.";
// a picked colour ("#d65a4e") in the game's palette, as a hex for the shape
// template; a colour word is left to the planner
function pickedHex(c: string | undefined): string | undefined {
  const h = c?.trim().toLowerCase();
  if (!h || !/^#[0-9a-f]{6}$/.test(h)) return undefined;
  return '#' + fitToGame(hexRgb(h)).map((v) => v.toString(16).padStart(2, '0')).join('');
}

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

// One small call: the player's colour words and the body's parts -> a hex
// colour per part that should change. null when the model isn't configured,
// can't be reached or gives no usable colour (the caller then keeps the base
// colour words and tells the player).
async function craftColours(prompt: string, body: RefDoc): Promise<Record<string, [number, number, number]> | null> {
  if (!llmEnabled) return null;
  try {
    const parts = await partSwatches(body);
    const raw = await chatJSON<Record<string, unknown>>(
      [
        { role: 'system', content: colourPrompt() },
        { role: 'user', content: `The item: ${body.title}. Its parts: ${JSON.stringify(parts)}\n\nThe player asked for: "${prompt}"` },
      ],
      { temperature: 0.2, maxTokens: 300, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
    );
    return parseColours(raw, body);
  } catch (err) {
    console.warn('[craft] colour call failed:', err);
    return null;
  }
}

// The /3 preflight: can this be drawn as asked, or should the player pick a
// concept first? Offline it always crafts directly.
export type { CraftPreflight, CraftConcept } from './craft';

// The AI service couldn't be reached: what the workshop tells the player.
export interface AiDown {
  failure: AiFailure;
  status: number | null;
  detail: string; // the service's own message, shown small under the explanation
}
export const aiDownOf = (e: AiServiceError): AiDown => ({ failure: e.failure, status: e.status, detail: e.detail });
export { AiServiceError };

// The /1 pre-clarification, asked before drawing: always the mood question
// with all eight moods, then ONE question the model picks for this prompt
// (craft/spriteGen.ts clarifyCraft), or the size question when it gives none.
// Unreachable AI: throws (the workshop shows it). Blocked prompt: none.
export type { ClarifyQuestion, ClarifyOption } from './craft';
export interface CraftClarify {
  guidance: string;
  size?: SizeClass;
  colour?: string; // the colour picked ("Sky blue")
  surprise?: boolean; // "Yes, surprise me"
  dropDetails?: string[]; // detail phrases the player chose to leave out
  replace?: [string, string][]; // unknown words read as the known word the player picked
  rewrite?: string; // the whole prompt read as this ("blue ship")
  themeSurprise?: 'ships' | 'watering' | 'pets'; // a surprise of the theme instead
  finish?: TextureModifier;
  mood?: Mood;
}
// The questions come from what the prompt leaves open, worked out locally
// (craft/refCraft.ts unknownsOf, no model call): its size and colour when it
// names none, whether to add a surprise, then the details no reference can
// draw (named from the prompt, a yes/no).
// `retry`: the main object isn't a word the game knows (and the model
// couldn't read it): Mitchy asks for another object instead of questions
// `reported`: a word the game didn't know was reported for a next patch
// (the workshop shows the bug-report toast)
export type ClarifyResult = { questions: ClarifyQuestion[]; retry?: undefined; reported?: string } | { retry: string; questions?: undefined; reported?: string };
export async function clarifyPrompt(prompt: string): Promise<ClarifyResult> {
  // a blocked prompt is refused by craftItem right after, without questions
  if (!checkPolicy(prompt).allowed) return { questions: [] };
  const read = await readPrompt(prompt);
  if (read.via === 'model') return { questions: preQuestions(read.fixed, read) };
  // read locally: the words the game doesn't know are asked about, as typed
  const parts = promptParts(prompt);
  const surprise = (theme: Theme | null) => ({
    label: 'Surprise me',
    effect: 'A surprise from Mitchy.',
    surpriseTheme: theme ?? THEMES[Math.floor(Math.random() * THEMES.length)],
    surprise: true,
    final: true,
  });
  const tryAnother = { label: 'Try another object', effect: 'Type another object.', tryAgain: true };
  // each unknown word gets its own question: its closest known word, or
  // (a detail) leave it out
  const near = (w: string, kinds?: Parameters<typeof closestWords>[2]) => {
    const [c] = closestWords(w, 1, kinds);
    return c && typoDistance(w.toLowerCase(), c) <= (w.length >= 7 ? 2 : 1) ? c : (kinds ? null : c);
  };
  const mainQs: ClarifyQuestion[] = [];
  if (parts.main && !parts.mainKnown) {
    const obj = near(parts.main, ['object']);
    if (obj)
      // a typo of an object it knows: that object, a surprise, or another one
      mainQs.push({
        topic: parts.main,
        q: `I don't know "${parts.main}". Did you mean ${obj}?`,
        options: [{ label: obj, effect: `Read "${parts.main}" as ${obj}.`, replace: [parts.main, obj] }, surprise(themeOfObject(obj) ?? parts.theme), tryAnother],
        noDecide: true,
      });
    else {
      // an object it doesn't know at all: reported for a next patch; a
      // surprise or another object (nothing else to ask about)
      logRefCraft(prompt, 'planner', null, [parts.main]);
      return {
        questions: [
          {
            topic: parts.main,
            q: `I don't know a "${parts.main}" yet. Shall I surprise you, or do you want to try another object?`,
            options: [surprise(parts.theme), tryAnother],
            noDecide: true,
          },
        ],
        reported: parts.main,
      };
    }
  }
  const unknown = [...new Set(parts.unknown.filter((w) => w !== parts.main))];
  const typoQs: ClarifyQuestion[] = [
    ...mainQs,
    ...unknown.map((w) => {
      const c = near(w);
      return {
        topic: w,
        q: c ? `I don't know "${w}". Did you mean ${c}?` : `I don't know "${w}".`,
        options: [
          ...(c ? [{ label: c, effect: `Read "${w}" as ${c}.`, replace: [w, c] as [string, string] }] : []),
          { label: 'Leave out this detail', effect: `Leave "${w}" out.`, drop: [w] },
        ],
        noDecide: true,
      };
    }),
  ];
  // a typo that's a colour / size: its own question covers the colour / size one
  const nearKinds = new Set(unknown.flatMap((w) => closestWords(w, 1).map(kindOf)));
  const rest = preQuestions(prompt, undefined, unknown, { colour: nearKinds.has('colour'), size: nearKinds.has('size') });
  // the typo questions right after size / colour, before the surprise
  const at = rest.findIndex((q) => q.topic === 'Surprise');
  return { questions: at < 0 ? [...rest, ...typoQs] : [...rest.slice(0, at), ...typoQs, ...rest.slice(at)] };
}
// (each with its own exact colour: no model call needed for these): the
// rainbow plus black and white, eased into the game's palette when used
const COLOUR_OPTIONS: { label: string; word: string }[] = [
  { label: 'Red', word: '#d65a4e' },
  { label: 'Orange', word: '#e9954f' },
  { label: 'Yellow', word: '#efcb5c' },
  { label: 'Green', word: '#6cbf5a' },
  { label: 'Sky blue', word: '#7ec4ee' },
  { label: 'Blue', word: '#4a74c9' },
  { label: 'Purple', word: '#9a6cc9' },
  { label: 'Pink', word: '#f39ac0' },
  { label: 'Black', word: '#2b2b33' },
  { label: 'White', word: '#f4f1e6' },
];
// `read`: the prompt's reading (craft/readPrompt.ts): a size or colour it
// found counts as said, and with the model's reading only the details it
// names can be "not among my patterns" (a typo never is)
// `asked`: unknown words already asked about (clarifyPrompt), so they are no
// "not among my patterns" detail; `covered`: a colour / size they stand for
export function preQuestions(prompt: string, read?: PromptRead, asked: string[] = [], covered: { colour?: boolean; size?: boolean } = {}): ClarifyQuestion[] {
  const u = unknownsOf(prompt);
  if (read?.size || covered.size) u.sizeNamed = true;
  if (read?.colours.length || covered.colour) u.colourNamed = true;
  if (asked.length) u.details = u.details.filter((d) => !d.toLowerCase().split(/\s+/).some((w) => asked.includes(w)));
  if (read?.via === 'model') {
    const named = new Set([...read.details, read.style ?? ''].flatMap((d) => d.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
    u.details = u.details.filter((d) => d.toLowerCase().split(/\s+/).some((w) => named.has(w) || named.has(w.replace(/s$/, ''))));
  }
  const qs: ClarifyQuestion[] = [];
  if (!u.sizeNamed)
    qs.push({
      ...SIZE_QUESTION,
      options: SIZE_QUESTION.options.map((o, i) => ({ ...o, label: ['Small', 'Medium', 'Large'][i] ?? o.label })),
    });
  if (!u.colourNamed)
    qs.push({
      topic: 'Colour',
      q: 'What colour should it be?',
      options: COLOUR_OPTIONS.map((c) => ({ label: c.label, effect: `Main colour: ${c.label.toLowerCase()}.`, colour: c.word })),
    });
  // the surprise is always asked; the details no reference can draw last
  qs.push({
    topic: 'Surprise',
    q: 'Should I add a little surprise?',
    options: [
      { label: 'Yes, surprise me', effect: 'Add one unexpected, charming little detail.', surprise: true },
      { label: 'Keep it classic', effect: 'Keep it classic, no extras.', surprise: false },
    ],
  });
  if (u.refBody && u.details.length) {
    const many = u.details.length > 1;
    const names = u.details.map((d) => `the ${d}`);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const it = many ? 'them' : 'it';
    qs.push({
      topic: u.details.map((d) => d.replace(/^\w/, (ch) => ch.toUpperCase())).join(', '),
      q: `${list.replace(/^\w/, (ch) => ch.toUpperCase())} ${many ? "aren't among" : "isn't one of"} my patterns, so ${many ? 'their' : 'its'} look may be unpredictable. Craft ${it} anyway?`,
      options: [
        { label: `Craft ${it} anyway`, effect: `Include ${list}, drawn freely.` },
        { label: `Leave ${it} out`, effect: `Leave ${list} out.`, drop: u.details },
      ],
      noDecide: true,
    });
  }
  return qs;
}
export async function preflightCraft(prompt: string): Promise<CraftPreflight> {
  if (!llmEnabled || !checkPolicy(prompt).allowed) return { needsChoice: false };
  return analyzeCraft(prompt, chatJSON, { model: MODELS.fast, fallbackModel: MODELS.fastFallback });
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
            'little sassy, occasionally slipping in a "purr". No emoji, no quotes, no preamble. ' +
            MITCHY_TONE,
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

// Mitchy's writing style: plain, natural sentences — no colons or dashes
// unless they are truly needed.
const MITCHY_TONE =
  'Write natural, flowing sentences. Do not use colons or dashes (":", "-", "–", "—") unless truly necessary.';

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
            'occasionally slipping in a "purr". No emoji, no quotes, no preamble. ' +
            MITCHY_TONE,
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

// ---------------------------------------------------------------------------
// Talking to Mitchy (MitchyTalk.tsx): small talk, and today's luck — Mitchy
// is really into horoscopes. Generated in her voice; static lines when
// offline or on any error, so the chat never breaks.
// ---------------------------------------------------------------------------

const MITCHY_PERSONA =
  'You are Mitchy, a cozy, witty shopkeeper CAT in Asciia Bay, a small ASCII island village where the ' +
  'villager collects dates from the palm tree, flowers, stones, ferns, cacti and ice flowers and sells them ' +
  'to you. You also craft items from craft tokens. You are really into horoscopes and the stars. You speak in ' +
  'lowercase, playful and a little sassy, sometimes say "purr" or write "u" for you. No emoji, no quotes, ' +
  'no preamble. ';

const SMALL_TALK_FALLBACK = [
  'purr, pretty good. sold three stones before lunch and napped on the counter twice, so a solid day.',
  'oh u know, sorting flowers by colour and judging everyone who walks past. busy busy.',
  'tired but happy. the date palm has been extra generous lately, have u noticed?',
  'honestly great. the sun hit my counter just right this morning and i did not move for an hour.',
];

const LUCK_FALLBACK = [
  'the stars say today is a lucky one for u. stones are ur charm, the pond is ur spot and soft blue is ur colour.',
  'mercury is doing something sneaky, so take it slow. a fresh date from the palm will turn ur luck around, trust me.',
  'big flower energy today. pick a few by the garden and wear something sunny yellow, good things follow.',
  'the moon is cozy tonight, so is ur luck. a little fern brings u coins and green is ur colour, purr.',
];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function mitchyTalkLine(task: string, fallback: string, maxTokens: number): Promise<string> {
  if (!llmEnabled) {
    await delay(500);
    return fallback;
  }
  try {
    const line = await chat(
      [
        { role: 'system', content: MITCHY_PERSONA + MITCHY_TONE },
        { role: 'user', content: task },
      ],
      { temperature: 1, maxTokens, model: MODELS.fast, fallbackModel: MODELS.fastFallback },
    );
    return line?.trim() || fallback;
  } catch (err) {
    console.warn('[llm] Mitchy talk fell back to static:', err);
    return fallback;
  }
}

// "Hey Mitchy, how are you doing?"
export function mitchySmallTalk(playerName: string): Promise<string> {
  return mitchyTalkLine(
    `The villager ${playerName} asks how you are doing. Answer in one or two short sentences (under 30 words) ` +
      'about your day in the shop, warm and a little funny.',
    pick(SMALL_TALK_FALLBACK),
    80,
  );
}

// "What do the stars say about my luck today?" With the player's saju
// (saju.ts, computed in code; the birth date itself is never sent), the
// reading follows their day master and today's pillar like a real daily saju;
// without it, a general horoscope.
export function mitchyLuck(playerName: string, day: string, saju?: DailySaju | null): Promise<string> {
  if (!saju)
    return mitchyTalkLine(
      `Today is ${day}. The villager ${playerName} asks what the stars say about their luck today. Give a playful, ` +
        'kind horoscope in two or three short sentences (under 45 words). Name one lucky thing from the island ' +
        '(a date, flower, stone, fern, cactus or ice flower), one lucky spot (the palm tree, the pond, the garden ' +
        'or your shop) and a lucky colour. Never gloomy.',
      pick(LUCK_FALLBACK),
      120,
    );
  return mitchyTalkLine(
    `Today is ${day}. Read the villager ${playerName}'s daily saju (Korean Four Pillars) from these facts, which ` +
      'are already worked out, so do not calculate anything yourself and do not change them.\n' +
      `Their day master: ${saju.dayMaster}.\n` +
      `Today's day pillar: ${saju.today}.\n` +
      `Today's relation to them: ${saju.god.name}, meaning ${saju.god.theme}.\n` +
      `Their chart is low in ${saju.weak}, so their lucky colour is ${saju.colour} and lucky direction ${saju.direction}.\n` +
      'In two or three short sentences (under 55 words), tell them what today holds in simple words, mentioning ' +
      'their element meeting today\'s element once. Add their lucky colour and one lucky thing from the island ' +
      '(a date, flower, stone, fern, cactus or ice flower). Vague and kind like a real fortune, never gloomy, ' +
      'no Chinese characters.',
    `ur ${saju.element} meets today's ${saju.todayElement}, so the stars ` +
      `say today is about ${saju.god.theme}. ${saju.colour} is ur colour, purr.`,
    140,
  );
}

// The value a material's sale price is negotiated around (see getPrice).
export function basePrice(itemName: string): number {
  return BASE_PRICE[itemName] ?? 1;
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
