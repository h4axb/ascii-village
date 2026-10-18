// The fallback reader's accuracy (src/craft/lexicon.ts promptParts) on themed
// sample prompts: what it reads as each prompt's main object.
//
//   npx vite-node scripts/test-main-noun.mjs
const g = globalThis;
g.window ??= { location: { pathname: '/' } };
g.document ??= { documentElement: { style: { setProperty() {} } } };
g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const { promptParts } = await import('../src/craft/lexicon.ts');

// [prompt, expected main object]
const CASES = [
  // ships
  ['a pirate ship', 'pirate ship'], ['a viking ship', 'viking ship'], ['a small red wooden boat with sails', 'boat'],
  ['a big galleon with three masts', 'galleon'], ['a tiny canoe', 'canoe'], ['a golden yacht', 'yacht'],
  ['a ship with a dragon head', 'ship'], ['a raft made of bamboo', 'raft'], ['a steampunk submarine', 'submarine'],
  ['a ghost ship with torn sails', 'ghost ship'], ['a blue sailboat with a striped sail', 'sailboat'],
  ['a longship with round shields', 'longship'], ['a turtle ship', 'turtle ship'], ['a shark ship that can swim fast', 'shark ship'],
  ['a cozy houseboat with flowers', 'houseboat'], ['a royal barge', 'royal barge'], ['an icebreaker', 'icebreaker'],
  ['a paper boat', 'paper boat'], ['a rowboat with oars', 'rowboat'], ['a catamaran', 'catamaran'],
  ['a pirate galleon with cannons and a skull flag', 'pirate galleon'], ['a fishing boat with nets', 'fishing boat'],
  ['a junk with red sails', 'junk'], ['a kayak for the lake', 'kayak'], ['a frigate', 'frigate'],
  ['a magical flying ship', 'flying ship'], ['a schooner with two masts', 'schooner'], ['a steamboat with a paddle wheel', 'steamboat'],
  ['a gondola with a lantern', 'gondola'], ['a dragon boat', 'dragon boat'], ['a viking longship with a dragon prow', 'viking longship'],
  ['a crystal ship', 'crystal ship'], ['a candy boat made of chocolate', 'candy boat'], ['a giant battleship', 'battleship'],
  ['a tugboat', 'tugboat'], ['a yellow submarine', 'yellow submarine'], ['a lifeboat', 'lifeboat'], ['a ferry', 'ferry'],
  ['ein piratenschiff', 'piratenschiff'], ['ein kleines boot', 'boot'], ['un bateau pirate', 'bateau pirate'],
  ['a wooden raft with a palm tree', 'raft'], ['a speedboat', 'speedboat'], ['a dinghy', 'dinghy'], ['a clipper ship', 'ship'],
  ['a ship in a bottle', 'ship in a bottle'], ['a sloop', 'sloop'], ['a war galley', 'war galley'],
  ['an old rusty steamer', 'steamer'], ['a cute little toy boat', 'toy boat'],
  // watering tools
  ['a watering can', 'watering can'], ['a blue watering can', 'watering can'], ['a golden watering can with flowers', 'golden watering can'],
  ['a watering can that pours rainbows', 'watering can'], ['a tiny copper watering can', 'watering can'],
  ['a sprinkler', 'sprinkler'], ['a garden hose', 'garden hose'], ['a spray bottle with a flower', 'spray bottle'],
  ['a bucket', 'bucket'], ['a magic watering wand', 'watering wand'], ['a rain cloud that waters plants', 'rain cloud'],
  ['a vintage zinc watering can', 'watering can'], ['a watering can shaped like a frog', 'watering can'],
  ['a pink watering can with polka dots', 'watering can'], ['a ceramic jug', 'jug'], ['a teapot watering can', 'watering can'],
  ['a plant mister', 'plant mister'], ['a kettle', 'kettle'], ['a pressure sprayer', 'pressure sprayer'],
  ['a rain barrel', 'rain barrel'], ['a long spout watering can', 'watering can'], ['a water gun', 'water gun'],
  ['eine giesskanne', 'giesskanne'], ['une arrosoir bleu', 'arrosoir'], ['a watering can with a duck head', 'watering can'],
  ['a self watering globe', 'self watering globe'], ['a brass watering can', 'watering can'], ['a hose with a spray nozzle', 'hose'],
  ['a fancy enamel pitcher', 'pitcher'], ['a watering can for my cactus', 'watering can'],
  // pets
  ['a cat', 'cat'], ['a cat that can fly', 'cat'], ['a dog', 'dog'], ['a golden retriever', 'golden retriever'],
  ['a golden retriever puppy', 'puppy'], ['a fluffy white bunny', 'bunny'], ['a corgi with a crown', 'corgi'],
  ['a dragon', 'dragon'], ['a baby dragon with tiny wings', 'baby dragon'], ['a unicorn', 'unicorn'],
  ['a hamster in a wheel', 'hamster'], ['a guinea pig', 'guinea pig'], ['a maine coon', 'maine coon'],
  ['a black cat with a witch hat', 'black cat'], ['a husky', 'husky'], ['a pug wearing sunglasses', 'pug'],
  ['a parrot that talks', 'parrot'], ['an owl', 'owl'], ['a goldfish', 'goldfish'], ['a turtle', 'turtle'],
  ['a bearded dragon', 'bearded dragon'], ['an axolotl', 'axolotl'], ['a red panda', 'red panda'], ['a fox', 'fox'],
  ['a tiny pig', 'pig'], ['a frog with a crown', 'frog'], ['a penguin', 'penguin'], ['a sleepy sloth', 'sloth'],
  ['a dachshund', 'dachshund'], ['a french bulldog', 'french bulldog'], ['a siamese cat', 'siamese cat'],
  ['a robot dog', 'robot dog'], ['a phoenix', 'phoenix'], ['a griffin', 'griffin'], ['a bee', 'bee'],
  ['a ladybug', 'ladybug'], ['a hedgehog with an apple', 'hedgehog'], ['a dog that can swim', 'dog'],
  ['a kitten that plays with yarn', 'kitten'], ['a bunny that hops', 'bunny'], ['a cat which can talk', 'cat'],
  ['eine katze', 'katze'], ['ein hund mit hut', 'hund'], ['un chat', 'chat'], ['un perro', 'perro'],
  ['a shiba inu', 'shiba inu'], ['a border collie', 'border collie'], ['a ferret', 'ferret'], ['a chinchilla', 'chinchilla'],
  ['a pony', 'pony'], ['a little lamb', 'lamb'], ['a duckling', 'duckling'], ['a koi fish', 'koi fish'],
  ['a seahorse', 'seahorse'], ['an octopus', 'octopus'], ['a jellyfish', 'jellyfish'], ['a wolf', 'wolf'],
  ['a panda', 'panda'], ['a koala', 'koala'], ['a chameleon', 'chameleon'], ['a cockatiel', 'cockatiel'],
  ['a mini horse', 'mini horse'], ['a cat with wings', 'cat'], ['a dog with a pirate hat', 'dog'],
  ['a ghost cat', 'cat'], ['a fire dragon', 'dragon'], ['a space hamster', 'hamster'], ['a dog in a tutu', 'dog'],
  ['a cat in a boat', 'cat'], ['a frog on a lily pad', 'frog'],
];

let hit = 0;
const misses = [];
for (const [p, want] of CASES) {
  const got = promptParts(p).main;
  if (got === want) hit++;
  else misses.push(`  ${JSON.stringify(p)} → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`);
}
console.log(`main object: ${hit}/${CASES.length} = ${((hit / CASES.length) * 100).toFixed(1)} %`);
if (misses.length) console.log('misses:\n' + misses.join('\n'));
