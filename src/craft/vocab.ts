// ---------------------------------------------------------------------------
// Craft vocabulary — the enumerated taxonomy a player prompt is parsed into.
//
// Goal: cover the majority of what players actually type in "craft anything"
// games. Those prompts almost always decompose into a handful of dimensions:
//
//   [rarity] [size] [material] [color] [pattern] [finish] [mood] [style]
//   [shape-features] BASE-NOUN [+ second noun = hybrid]
//
// e.g. "a tiny glowing golden three-headed robot dog", "big red spotted cat",
//      "cursed ancient sword", "cute fluffy blue slime".
//
// This is a *starting* taxonomy drawn from common crafting/sandbox prompt
// patterns (Infinite Craft-style combiners, Doodle God, Minecraft/Terraria
// mods, character creators, loot generators). Refine the lists from your own
// playtest logs — the words players actually use are themselves thesis data.
//
// Each dimension is authored as { canonical: [aliases...] } and compiled into a
// fast alias -> canonical lookup. Add words freely; nothing else changes.
// ---------------------------------------------------------------------------

export type Dimension =
  | 'color'
  | 'size'
  | 'material'
  | 'pattern'
  | 'finish'
  | 'mood'
  | 'style'
  | 'rarity';

// Build an alias->canonical map (the canonical word maps to itself too).
function buildLookup(groups: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const canonical of Object.keys(groups)) {
    out[canonical] = canonical;
    for (const alias of groups[canonical]) out[alias] = canonical;
  }
  return out;
}

// ---- COSMETIC dimensions (do NOT change the silhouette → not in the key) ----

// color → resolved to a palette hex at render time (see PALETTE below)
const COLOR_GROUPS: Record<string, string[]> = {
  red: ['crimson', 'scarlet', 'ruby', 'cherry', 'blood', 'rose-red'],
  orange: ['amber', 'tangerine', 'pumpkin', 'apricot'],
  yellow: ['gold-yellow', 'lemon', 'mustard', 'canary', 'sunny'],
  green: ['emerald', 'forest', 'olive', 'moss', 'jade', 'grass'],
  lime: ['neon-green', 'chartreuse'],
  teal: ['turquoise', 'aqua', 'aquamarine'],
  cyan: ['sky', 'ice-blue'],
  blue: ['azure', 'cobalt', 'sapphire', 'ocean', 'royal-blue'],
  navy: ['dark-blue', 'midnight'],
  purple: ['violet', 'lavender', 'lilac', 'indigo', 'plum', 'amethyst'],
  magenta: ['fuchsia', 'hotpink'],
  pink: ['rose', 'salmon', 'blush', 'bubblegum'],
  brown: ['tan', 'chocolate-brown', 'coffee', 'chestnut', 'sepia'],
  beige: ['cream', 'ivory', 'sand-color', 'wheat'],
  black: ['ebony', 'charcoal', 'onyx', 'jet', 'dark'],
  white: ['snow', 'pearl', 'bone-white', 'ivory-white'],
  gray: ['grey', 'ash', 'slate', 'silver-gray', 'stone-gray'],
  gold: ['golden', 'gilded', 'brass'],
  silver: ['chrome', 'steel-color', 'platinum'],
  rainbow: ['prismatic', 'multicolor', 'multicolour', 'colorful', 'colourful'],
  neon: ['glow-color', 'fluorescent'],
  pastel: ['soft-color', 'muted'],
};

// size → resolved to a render scale factor (see SIZE_SCALE)
const SIZE_GROUPS: Record<string, string[]> = {
  tiny: ['mini', 'miniature', 'teeny', 'itty', 'micro', 'baby', 'pocket'],
  small: ['little', 'smol', 'petite', 'lil', 'wee', 'compact'],
  medium: ['normal', 'regular', 'standard', 'average', 'mid'],
  large: ['big', 'huge', 'grand', 'jumbo', 'oversized'],
  giant: ['gigantic', 'massive', 'enormous', 'colossal', 'titanic', 'mega', 'humongous'],
};

// material → tints the color + biases the character set (still cosmetic)
const MATERIAL_GROUPS: Record<string, string[]> = {
  wood: ['wooden', 'oak', 'timber', 'bamboo'],
  stone: ['stony', 'rock', 'rocky', 'granite', 'pebble'],
  metal: ['metallic', 'steel', 'iron', 'tin', 'aluminum'],
  gold: ['golden', 'gilded'],
  silver: ['chrome', 'platinum'],
  bronze: ['copper', 'brass'],
  crystal: ['crystalline', 'quartz', 'prism'],
  glass: ['glassy', 'mirror'],
  ice: ['icy', 'frozen', 'frost', 'frosty'],
  fire: ['fiery', 'flaming', 'burning', 'ember', 'lava', 'molten'],
  water: ['watery', 'liquid', 'aqua-mat'],
  cloud: ['cloudy', 'misty', 'foggy', 'vapor'],
  slime: ['slimy', 'goo', 'gooey', 'jelly', 'ooze'],
  bone: ['bony', 'skeletal', 'skull'],
  diamond: ['gem-mat', 'jeweled'],
  obsidian: ['volcanic-glass'],
  plush: ['fluffy', 'fuzzy', 'furry', 'soft', 'cotton', 'wool'],
  paper: ['papery', 'cardboard', 'origami'],
  plastic: ['rubber', 'vinyl'],
  clay: ['ceramic', 'terracotta', 'porcelain'],
  sand: ['sandy', 'dust'],
  leaf: ['leafy', 'plant-mat', 'vine', 'floral-mat'],
  candy: ['sugar', 'sweet-mat', 'gummy'],
  chocolate: ['cocoa'],
  cheese: ['cheesy'],
  shadow: ['dark-mat', 'void', 'smoke'],
  light: ['radiant', 'holy-mat', 'glowing-mat'],
};

// pattern → surface decoration (cosmetic overlay)
const PATTERN_GROUPS: Record<string, string[]> = {
  plain: ['solid', 'simple'],
  striped: ['stripes', 'stripey', 'lined'],
  spotted: ['spots', 'spotty', 'dalmatian', 'leopard'],
  dotted: ['polka', 'polka-dot', 'dots'],
  checkered: ['checkerboard', 'checked', 'plaid', 'tartan'],
  floral: ['flowery', 'flowered'],
  starry: ['stars', 'starstruck', 'galaxy'],
  camo: ['camouflage', 'military'],
  gradient: ['ombre', 'faded-pattern'],
};

// finish → a light effect layer (cosmetic overlay)
const FINISH_GROUPS: Record<string, string[]> = {
  matte: ['flat-finish', 'dull'],
  shiny: ['shining', 'gleaming', 'sparkly', 'sparkling', 'glossy', 'polished', 'glittery', 'glitter'],
  glowing: ['glow', 'luminous', 'radiant-finish', 'bright', 'lit'],
  transparent: ['see-through', 'translucent', 'ghostly', 'ghost', 'invisible', 'clear'],
  metallic: ['chrome-finish', 'reflective'],
  wet: ['dripping', 'soggy', 'damp'],
  furry: ['fuzzy-finish', 'hairy'],
};

// mood / expression → mostly for creatures (cosmetic: swaps the face)
const MOOD_GROUPS: Record<string, string[]> = {
  happy: ['smiling', 'joyful', 'cheerful', 'excited', 'glad'],
  sad: ['crying', 'gloomy', 'depressed', 'unhappy'],
  angry: ['mad', 'furious', 'grumpy', 'rage', 'raging'],
  sleepy: ['tired', 'drowsy', 'lazy', 'sleeping'],
  cute: ['adorable', 'kawaii', 'precious', 'sweet'],
  evil: ['demonic', 'menacing', 'sinister', 'wicked'],
  surprised: ['shocked', 'startled', 'amazed'],
  scared: ['afraid', 'terrified', 'nervous'],
};

// style / theme → biases silhouette accents + palette (cosmetic bias)
const STYLE_GROUPS: Record<string, string[]> = {
  cute: ['adorable-style', 'kawaii-style', 'chibi'],
  scary: ['spooky', 'creepy', 'horror', 'nightmare'],
  ancient: ['old', 'antique', 'primitive', 'prehistoric', 'ruined'],
  magic: ['magical', 'mystic', 'mystical', 'enchanted', 'arcane', 'wizard'],
  holy: ['divine', 'angelic', 'sacred', 'blessed'],
  cursed: ['hexed', 'haunted', 'corrupted', 'undead'],
  royal: ['regal', 'kingly', 'queenly', 'noble', 'majestic'],
  cyberpunk: ['cyber', 'techno', 'neon-city'],
  tech: ['futuristic', 'sci-fi', 'scifi', 'robotic', 'mechanical', 'digital'],
  steampunk: ['steam', 'clockwork', 'brass-punk'],
  medieval: ['knightly', 'castle-style'],
  gothic: ['goth', 'dark-style'],
  cosmic: ['space', 'galactic', 'stellar', 'astral', 'celestial'],
  retro: ['vintage', 'oldschool', '8bit', 'pixel'],
  wild: ['feral', 'savage', 'jungle-style'],
};

// rarity → adds flair (a border / sparkle), cosmetic
const RARITY_GROUPS: Record<string, string[]> = {
  common: ['plain-rarity', 'basic', 'ordinary'],
  uncommon: ['special'],
  rare: ['scarce'],
  epic: ['ultra', 'super', 'awesome'],
  legendary: ['legend', 'fabled', 'godly'],
  mythic: ['mythical', 'divine-rarity', 'ultimate'],
};

export const LOOKUPS: Record<Dimension, Record<string, string>> = {
  color: buildLookup(COLOR_GROUPS),
  size: buildLookup(SIZE_GROUPS),
  material: buildLookup(MATERIAL_GROUPS),
  pattern: buildLookup(PATTERN_GROUPS),
  finish: buildLookup(FINISH_GROUPS),
  mood: buildLookup(MOOD_GROUPS),
  style: buildLookup(STYLE_GROUPS),
  rarity: buildLookup(RARITY_GROUPS),
};

// ---- render resolution for cosmetics ---------------------------------------

// curated palette (one hex per colour key; specials get a representative tone —
// swap for a CSS gradient later). Keep this the single source of colour truth.
export const PALETTE: Record<string, string> = {
  red: '#d64550', orange: '#e08a3c', yellow: '#e6c84f', green: '#5a9e5a',
  lime: '#8fce5a', teal: '#3fa5a0', cyan: '#4fc4d6', blue: '#4a78c8',
  navy: '#35508a', purple: '#8a5fc0', magenta: '#c85fb0', pink: '#e089b4',
  brown: '#8a6d4b', beige: '#cbb890', black: '#3a3a3a', white: '#e8e8e8',
  gray: '#8a8a8a', gold: '#d4af37', silver: '#c0c8d0',
  rainbow: '#d65fb0', neon: '#66e060', pastel: '#c9b6e0',
};

export const SIZE_SCALE: Record<string, number> = {
  tiny: 0.5, small: 0.7, medium: 1, large: 1.4, giant: 1.9,
};

// ---- SHAPE inputs (these DO change the silhouette → part of the key) --------

// noun -> broad category, and the flat set of known nouns for base detection
const CATEGORY_NOUNS: Record<string, string[]> = {
  creature: [
    'dog', 'puppy', 'cat', 'kitten', 'bird', 'fish', 'dragon', 'snake', 'frog', 'rabbit', 'bunny',
    'fox', 'wolf', 'bear', 'lion', 'tiger', 'horse', 'cow', 'pig', 'sheep', 'goat', 'chicken',
    'duck', 'owl', 'bat', 'spider', 'bee', 'butterfly', 'crab', 'octopus', 'whale', 'shark',
    'turtle', 'lizard', 'dinosaur', 'dino', 'robot', 'ghost', 'slime', 'blob', 'monster', 'beast',
    'creature', 'pet', 'animal', 'mouse', 'rat', 'hamster', 'penguin', 'elephant', 'monkey', 'deer',
    'unicorn', 'phoenix', 'griffin', 'golem', 'zombie', 'skeleton', 'demon', 'angel', 'fairy', 'imp',
  ],
  plant: [
    'flower', 'rose', 'tulip', 'daisy', 'sunflower', 'tree', 'bush', 'fern', 'cactus', 'mushroom',
    'vine', 'leaf', 'sprout', 'seed', 'herb', 'moss', 'lily', 'lotus', 'bamboo', 'palm', 'bonsai',
    'clover', 'weed', 'plant', 'sapling', 'root', 'berry-bush',
  ],
  food: [
    'apple', 'banana', 'orange-fruit', 'grape', 'berry', 'strawberry', 'cherry-fruit', 'lemon-fruit',
    'bread', 'cake', 'pie', 'cookie', 'donut', 'cupcake', 'pizza', 'burger', 'sandwich', 'taco',
    'cheese', 'egg', 'meat', 'fish-food', 'soup', 'stew', 'candy', 'chocolate-bar', 'icecream',
    'lollipop', 'pancake', 'waffle', 'sushi', 'noodle', 'rice-bowl', 'honey', 'jam', 'milk', 'juice',
  ],
  weapon: [
    'sword', 'axe', 'dagger', 'knife', 'spear', 'bow', 'arrow', 'hammer', 'mace', 'club', 'wand',
    'staff', 'shield', 'gun', 'cannon', 'bomb', 'blade', 'scythe', 'whip', 'crossbow', 'katana',
  ],
  tool: [
    'pickaxe', 'shovel', 'spade', 'hoe', 'rake', 'trowel', 'saw', 'drill', 'wrench', 'screwdriver',
    'brush', 'key', 'lantern', 'torch', 'rope', 'net', 'fishingrod', 'wateringcan', 'bucket', 'broom',
  ],
  clothing: [
    'hat', 'cap', 'crown', 'helmet', 'shirt', 'coat', 'cape', 'cloak', 'dress', 'skirt', 'pants',
    'boots', 'shoes', 'gloves', 'scarf', 'mask', 'glasses', 'ring', 'necklace', 'armor', 'belt',
  ],
  vehicle: [
    'car', 'truck', 'bike', 'bicycle', 'scooter', 'skateboard', 'boat', 'ship', 'raft', 'canoe',
    'kayak', 'plane', 'rocket', 'wagon', 'cart', 'sled', 'submarine', 'balloon', 'train',
  ],
  furniture: [
    'chair', 'table', 'bed', 'sofa', 'couch', 'lamp', 'shelf', 'desk', 'stool', 'bench', 'clock',
    'mirror', 'door', 'window', 'fence', 'chest', 'barrel', 'crate', 'box',
  ],
  container: ['jar', 'bottle', 'flask', 'vial', 'pot', 'basket', 'bag', 'sack', 'pouch', 'cup', 'mug', 'bowl', 'plate'],
  gem: ['gem', 'crystal', 'diamond', 'ruby-gem', 'emerald-gem', 'pearl', 'jewel', 'stone', 'rock', 'coin', 'orb'],
  potion: ['potion', 'elixir', 'brew', 'poison', 'medicine', 'tonic', 'scroll', 'spellbook', 'rune'],
  toy: ['ball', 'kite', 'yoyo', 'top', 'dice', 'block', 'teddy', 'doll', 'puppet', 'balloon-toy'],
  instrument: ['guitar', 'drum', 'flute', 'trumpet', 'piano', 'violin', 'bell', 'horn-inst', 'harp'],
  structure: ['house', 'castle', 'tower', 'bridge', 'wall', 'hut', 'tent', 'well', 'statue', 'shrine', 'gate'],
  celestial: ['star', 'moon', 'sun', 'planet', 'comet', 'cloud', 'rainbow-obj', 'lightning'],
};

export const NOUN_CATEGORY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const cat of Object.keys(CATEGORY_NOUNS)) {
    for (const noun of CATEGORY_NOUNS[cat]) out[noun] = cat;
  }
  return out;
})();

// noun synonyms → a canonical noun, so near-identical requests share one asset
// (e.g. "puppy", "doggo", "pup" all become "dog"). Extend from playtest logs.
export const NOUN_SYNONYMS: Record<string, string> = {
  puppy: 'dog', doggo: 'dog', pup: 'dog', hound: 'dog', pooch: 'dog',
  kitten: 'cat', kitty: 'cat', feline: 'cat',
  bunny: 'rabbit', hare: 'rabbit',
  birdie: 'bird', birb: 'bird',
  dino: 'dinosaur',
  blob: 'slime',
  auto: 'car', automobile: 'car', vehicle: 'car',
  cycle: 'bike', bicycle: 'bike',
  sword: 'sword', blade: 'sword', longsword: 'sword',
  bloom: 'flower', blossom: 'flower',
};

// number words → count (for "three-headed", "two heads", ...)
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, single: 1, two: 2, double: 2, twin: 2, three: 3, triple: 3, four: 4, quad: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, many: 3, multiple: 3, several: 3,
};

// body parts that, when multiplied, change the silhouette (shape features)
export const BODY_PARTS = ['head', 'heads', 'wing', 'wings', 'horn', 'horns', 'tail', 'tails', 'leg', 'legs', 'arm', 'arms', 'eye', 'eyes', 'spike', 'spikes'];

// standalone shape-feature adjectives (silhouette changing) → canonical feature
export const SHAPE_WORDS: Record<string, string> = {
  winged: 'wings', flying: 'floating', floating: 'floating', hovering: 'floating',
  horned: 'horns', spiky: 'spikes', spiked: 'spikes', tailed: 'tail',
  tall: 'tall', long: 'tall', short: 'short', flat: 'flat', round: 'round', fat: 'round',
  wheeled: 'wheels', armored: 'armor', legged: 'legs',
};

// filler words to ignore entirely
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'with', 'and', 'of', 'that', 'this', 'some', 'my', 'made', 'out',
  'kind', 'sort', 'type', 'really', 'very', 'so', 'just', 'please', 'want', 'give', 'me',
  'craft', 'make', 'create', 'build', 'it', 'is', 'has', 'having', 'looks', 'like', 'to',
  'for', 'in', 'on', 'from', 'thing', 'stuff', 'called', 'named', 'named-as',
]);
