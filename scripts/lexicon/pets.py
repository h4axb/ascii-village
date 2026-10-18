# The pet theme's words (scripts/build-lexicon.py): animals as objects.
DOGS = """
dog, puppy, pup, doggo, doggy, hound, pooch, mutt, affenpinscher, afghan hound, airedale, airedale terrier, akbash, akita,
alaskan klee kai, alaskan malamute, malamute, american bulldog, american bully, american eskimo dog, american foxhound,
american pit bull terrier, pit bull, pitbull, american staffordshire terrier, amstaff, anatolian shepherd, appenzeller,
australian cattle dog, blue heeler, heeler, australian kelpie, kelpie, australian shepherd, aussie, australian terrier,
azawakh, barbet, basenji, basset, basset hound, beagle, bearded collie, beauceron, bedlington terrier, belgian malinois,
malinois, belgian sheepdog, groenendael, belgian tervuren, tervuren, bergamasco, berger picard, bernese mountain dog, bernese,
bichon, bichon frise, biewer terrier, black and tan coonhound, coonhound, black russian terrier, bloodhound, bluetick coonhound,
boerboel, bolognese, border collie, border terrier, borzoi, boston terrier, bouvier, bouvier des flandres, boxer,
boykin spaniel, bracco italiano, briard, brittany, brittany spaniel, brussels griffon, griffon, bull terrier, bulldog,
english bulldog, french bulldog, frenchie, bullmastiff, cairn terrier, canaan dog, cane corso, cardigan welsh corgi,
cavalier king charles spaniel, cavalier, cesky terrier, chesapeake bay retriever, chihuahua, chinese crested, chinese shar pei,
shar pei, chinook, chow chow, chow, cirneco dell etna, clumber spaniel, cocker spaniel, cocker, english cocker spaniel, collie,
rough collie, smooth collie, coton de tulear, curly coated retriever, dachshund, sausage dog, wiener dog, doxie, dalmatian,
dandie dinmont terrier, doberman, dobermann, doberman pinscher, dogo argentino, dogue de bordeaux, english foxhound,
english setter, english springer spaniel, springer spaniel, springer, english toy spaniel, entlebucher, eurasier,
field spaniel, finnish lapphund, finnish spitz, flat coated retriever, fox terrier, wire fox terrier, smooth fox terrier,
german pinscher, german shepherd, alsatian, german shorthaired pointer, german wirehaired pointer, giant schnauzer,
glen of imaal terrier, golden retriever, golden, goldendoodle, labradoodle, cockapoo, cavapoo, maltipoo, pomsky, puggle,
schnoodle, yorkipoo, sheepadoodle, bernedoodle, aussiedoodle, gordon setter, great dane, great pyrenees, pyrenean mountain dog,
greater swiss mountain dog, greyhound, italian greyhound, harrier, havanese, ibizan hound, icelandic sheepdog,
irish red and white setter, irish setter, red setter, irish terrier, irish water spaniel, irish wolfhound, wolfhound,
jack russell, jack russell terrier, parson russell terrier, japanese chin, japanese spitz, keeshond, kerry blue terrier,
komondor, kooikerhondje, kuvasz, labrador, labrador retriever, lab, lagotto romagnolo, lakeland terrier, leonberger, lhasa apso,
lowchen, maltese, manchester terrier, mastiff, english mastiff, neapolitan mastiff, tibetan mastiff, miniature american shepherd,
miniature pinscher, min pin, miniature schnauzer, schnauzer, standard schnauzer, mudi, newfoundland, newfie,
norfolk terrier, norwegian buhund, norwegian elkhound, elkhound, norwich terrier, nova scotia duck tolling retriever, toller,
old english sheepdog, otterhound, papillon, pekingese, pembroke welsh corgi, corgi, welsh corgi, petit basset griffon vendeen,
pharaoh hound, plott hound, pointer, english pointer, polish lowland sheepdog, pomeranian, pom, poodle, toy poodle,
miniature poodle, standard poodle, portuguese water dog, pug, puli, pumi, pyrenean shepherd, rat terrier, redbone coonhound,
rhodesian ridgeback, ridgeback, rottweiler, rottie, saint bernard, st bernard, saluki, samoyed, schipperke, scottish deerhound,
deerhound, scottish terrier, scottie, sealyham terrier, shetland sheepdog, sheltie, shiba inu, shiba, shih tzu,
siberian husky, husky, silky terrier, skye terrier, sloughi, soft coated wheaten terrier, wheaten terrier, spanish water dog,
spinone italiano, staffordshire bull terrier, staffy, staffie, sussex spaniel, swedish vallhund, tibetan spaniel,
tibetan terrier, toy fox terrier, treeing walker coonhound, vizsla, weimaraner, welsh springer spaniel, welsh terrier,
west highland white terrier, westie, whippet, wirehaired pointing griffon, xoloitzcuintli, xolo, yorkshire terrier, yorkie,
akita inu, shikoku, kai ken, kishu, hokkaido dog, jindo, korean jindo, tosa, chinese chongqing dog, thai ridgeback,
phu quoc ridgeback, bully kutta, rajapalayam, mudhol hound, chippiparai, kombai, indian pariah dog, dingo, new guinea singing dog,
carolina dog, peruvian hairless dog, mexican hairless, argentine dogo, fila brasileiro, brazilian terrier, dogo canario,
presa canario, perro de presa canario, ca de bou, mallorca shepherd, catalan sheepdog, gos d'atura, spanish mastiff,
pyrenean mastiff, galgo, spanish greyhound, podenco, portuguese podengo, estrela mountain dog, cao da serra da estrela,
maremma sheepdog, maremmano, bergamasco shepherd, volpino italiano, cane da pastore, lagotto, segugio italiano,
french spaniel, brittany dog, briquet griffon vendeen, grand basset griffon vendeen, beagle harrier, great gascon hound,
dutch shepherd, schapendoes, drentse patrijshond, stabyhoun, saarloos wolfdog, wolfdog, czechoslovakian wolfdog,
german spitz, wolfspitz, kleinspitz, mittelspitz, pomeranian spitz, hovawart, landseer, kromfohrlander, german hunting terrier,
jagdterrier, munsterlander, small munsterlander, large munsterlander, pudelpointer, weimaraner pointer, rottweiler dog,
leonberger dog, eurasier dog, boxer dog, dachshund dog, schnauzer dog, pinscher, harzer fuchs, altdeutscher schaferhund,
swiss shepherd, white swiss shepherd, berger blanc suisse, entlebucher mountain dog, appenzeller sennenhund,
grosser schweizer sennenhund, swiss hound, finnish hound, karelian bear dog, swedish lapphund, norrbottenspets,
drever, hamiltonstovare, danish swedish farmdog, broholmer, old danish pointer, icelandic dog, faroese sheepdog,
russian toy, russian spaniel, borzoi hound, caucasian shepherd, central asian shepherd, alabai, south russian ovcharka,
laika, west siberian laika, east siberian laika, yakutian laika, samoyed dog, chukotka sled dog, sled dog, sledge dog,
greenland dog, canadian eskimo dog, inuit dog, chinook dog, alaskan husky, eskimo dog, mountain cur, treeing cur,
black mouth cur, catahoula, catahoula leopard dog, blue lacy, bluetick, american english coonhound, leopard cur,
boston bull, toy terrier, english toy terrier, teddy roosevelt terrier, rat dog, feist, mountain feist, chihuahua mix,
lurcher, longdog, mongrel, mixed breed, rescue dog, guide dog, police dog, therapy dog, sheepdog, shepherd dog, herding dog,
guard dog, watchdog, lapdog, lap dog, toy dog, teacup dog, hunting dog, retriever, setter, spaniel, terrier, bulldog breed,
mastiff breed, spitz, hound dog, sighthound, scenthound, working dog, sporting dog, pocket dog, corgi puppy, husky puppy,
golden puppy, lab puppy, pug puppy
"""

CATS = """
cat, kitten, kitty, kitties, cats, kittens, feline, tomcat, tabby, tabby cat, calico, calico cat, tortoiseshell, tortie,
tuxedo cat, ginger cat, orange cat, black cat, white cat, grey cat, gray cat, alley cat, house cat, abyssinian,
american bobtail, american curl, american shorthair, american wirehair, balinese, bengal, bengal cat, birman, bombay,
british longhair, british shorthair, burmese, burmilla, chartreux, chausie, colorpoint shorthair, cornish rex, cymric,
devon rex, donskoy, egyptian mau, european shorthair, exotic shorthair, exotic, havana brown, himalayan, japanese bobtail,
javanese, khao manee, korat, kurilian bobtail, laperm, lykoi, maine coon, maine coon cat, manx, minskin, munchkin,
nebelung, norwegian forest cat, wegie, ocicat, oriental shorthair, oriental longhair, persian, persian cat, peterbald,
pixie bob, ragamuffin, ragdoll, ragdoll cat, russian blue, savannah, savannah cat, scottish fold, selkirk rex, serengeti,
siamese, siamese cat, siberian, siberian cat, singapura, snowshoe, sokoke, somali, sphynx, sphinx cat, hairless cat, tonkinese,
toyger, turkish angora, turkish van, van cat, ukrainian levkoy, york chocolate, thai cat, aphrodite cat, arabian mau,
australian mist, bambino, cheetoh, highlander cat, kinkalow, lambkin, napoleon cat, minuet cat, ojos azules, raas,
sam sawet, suphalak, tiffanie, chantilly, german rex, mekong bobtail, neva masquerade, ussuri, caracal cat, lynx cat,
fat cat, chonky cat, chonk, floof, catto, kitteh, mog, moggy, puss, pussycat, kitty cat
"""

SMALL = """
hamster, dwarf hamster, syrian hamster, roborovski hamster, guinea pig, cavy, rabbit, bunny, bun, lop rabbit, lop,
holland lop, netherland dwarf, lionhead rabbit, angora rabbit, rex rabbit, flemish giant, mini rex, dutch rabbit,
hare, jackrabbit, ferret, chinchilla, gerbil, mouse, mice, fancy mouse, rat, fancy rat, degu, hedgehog, pygmy hedgehog,
sugar glider, squirrel, chipmunk, flying squirrel, prairie dog, marmot, groundhog, woodchuck, gopher, mole, shrew, vole,
lemming, dormouse, jerboa, capybara, pika, rabbits, hamsters, guinea pigs, mini pig, micro pig, teacup pig, pot bellied pig,
pygmy goat, miniature horse, mini horse, miniature donkey, alpaca, llama
"""

BIRDS = """
bird, birdie, birb, budgie, budgerigar, parakeet, parrot, macaw, scarlet macaw, blue and gold macaw, cockatoo, cockatiel,
lovebird, conure, sun conure, green cheek conure, african grey, grey parrot, amazon parrot, eclectus, lory, lorikeet,
rainbow lorikeet, caique, kakapo, kea, kaka, canary, finch, zebra finch, gouldian finch, goldfinch, bullfinch, chaffinch,
sparrow, robin, bluebird, blue jay, jay, cardinal, oriole, tanager, warbler, wren, chickadee, titmouse, tit, blue tit,
great tit, nuthatch, swallow, swift, martin, starling, myna, mynah, crow, raven, magpie, rook, jackdaw, dove, pigeon,
turtle dove, mourning dove, owl, barn owl, snowy owl, great horned owl, little owl, eagle owl, burrowing owl, eagle,
bald eagle, golden eagle, hawk, falcon, peregrine, peregrine falcon, kestrel, osprey, kite, buzzard, vulture, condor,
hummingbird, kingfisher, woodpecker, toucan, hornbill, puffin, penguin, emperor penguin, king penguin, little penguin,
rockhopper penguin, gentoo penguin, adelie penguin, flamingo, pelican, heron, egret, stork, crane, ibis, spoonbill,
swan, black swan, goose, geese, duck, duckling, mallard, wood duck, mandarin duck, teal duck, loon, grebe, cormorant,
gull, seagull, albatross, petrel, tern, sandpiper, plover, kiwi, ostrich, emu, cassowary, rhea, peacock, peahen, peafowl,
pheasant, quail, partridge, grouse, turkey, chicken, chick, hen, rooster, cockerel, bantam, silkie, silkie chicken,
guinea fowl, lyrebird, bird of paradise, roadrunner, cuckoo, nightingale, lark, skylark, mockingbird, thrush, blackbird,
bunting, waxwing, kookaburra, budgies, parrots, birds, owls, ducks, chickens, phoenix bird, firebird, thunderbird
"""

FISH = """
fish, goldfish, koi, koi fish, betta, betta fish, siamese fighting fish, guppy, molly, platy, swordtail, tetra, neon tetra,
cardinal tetra, angelfish, discus, oscar, cichlid, gourami, pleco, plecostomus, catfish, corydoras, loach, clown loach,
danio, zebrafish, rasbora, barb, tiger barb, rainbow fish, killifish, arowana, pufferfish, puffer fish, blowfish, clownfish,
clown fish, nemo, tang, blue tang, dory fish, yellow tang, surgeonfish, damselfish, wrasse, goby, blenny, butterflyfish,
butterfly fish, triggerfish, lionfish, grouper, snapper, parrotfish, seahorse, sea horse, sea dragon, pipefish, moray eel,
eel, electric eel, ray, stingray, manta ray, manta, shark, great white shark, hammerhead, hammerhead shark, whale shark,
tiger shark, nurse shark, reef shark, mako, salmon, trout, bass, carp, pike, perch, cod, tuna, mackerel, sardine, herring,
anchovy, swordfish, marlin, sailfish, flounder, halibut, sole, sunfish, mola, barracuda, piranha, sturgeon, gar, anglerfish,
lanternfish, flying fish, mudskipper, axolotl, betta fishes, fishes, fishy, goldfishes
"""

REPTILES = """
lizard, gecko, leopard gecko, crested gecko, day gecko, tokay gecko, bearded dragon, beardie, iguana, green iguana,
chameleon, panther chameleon, veiled chameleon, anole, skink, blue tongue skink, monitor lizard, komodo dragon, monitor,
tegu, uromastyx, frilled lizard, horned lizard, basilisk, thorny devil, gila monster, snake, corn snake, ball python,
python, royal python, boa, boa constrictor, king snake, kingsnake, milk snake, garter snake, hognose snake, rattlesnake,
cobra, king cobra, viper, mamba, anaconda, tree snake, sea snake, turtle, tortoise, box turtle, sea turtle, red eared slider,
snapping turtle, leatherback, galapagos tortoise, sulcata, terrapin, crocodile, alligator, caiman, gharial, dinosaur, dino,
t rex, trex, tyrannosaurus, triceratops, stegosaurus, brachiosaurus, velociraptor, raptor, pterodactyl, pteranodon,
ankylosaurus, diplodocus, spinosaurus, parasaurolophus, frog, toad, tree frog, poison dart frog, bullfrog, tadpole, newt,
salamander, fire salamander, axolotls, frogs, turtles, lizards, snakes
"""

FARM = """
horse, pony, foal, colt, filly, mare, stallion, donkey, mule, cow, calf, bull, ox, oxen, cattle, highland cow, highland cattle,
sheep, lamb, ram, ewe, goat, kid, billy goat, pig, piglet, hog, boar, sow, chicken, hen, rooster, chick, duck, goose, turkey,
rabbit, llama, alpaca, camel, dromedary, yak, water buffalo, buffalo, bison, reindeer, deer, fawn, shetland pony, welsh pony,
connemara pony, haflinger, fjord horse, norwegian fjord, icelandic horse, arabian horse, arabian, thoroughbred, quarter horse,
appaloosa, mustang, clydesdale, shire horse, percheron, friesian, andalusian, lipizzaner, palomino, pinto, paint horse,
mini pony, unicorn pony, holstein, jersey cow, angus, hereford, merino, suffolk sheep, valais blacknose sheep, nubian goat,
angora goat, pygmy goats, saddleback pig, kunekune
"""

WILD = """
fox, red fox, arctic fox, fennec, fennec fox, wolf, grey wolf, arctic wolf, coyote, jackal, hyena, bear, brown bear,
grizzly, grizzly bear, black bear, polar bear, panda, giant panda, red panda, koala, sloth, lion, lioness, cub, tiger,
white tiger, leopard, snow leopard, cheetah, jaguar, panther, black panther, puma, cougar, mountain lion, lynx, bobcat,
ocelot, serval, caracal, elephant, baby elephant, rhino, rhinoceros, hippo, hippopotamus, giraffe, zebra, okapi, gazelle,
antelope, impala, springbok, wildebeest, gnu, moose, elk, caribou, stag, doe, kangaroo, wallaby, wombat, quokka, platypus,
echidna, tasmanian devil, opossum, possum, raccoon, racoon, skunk, badger, honey badger, otter, sea otter, beaver,
weasel, stoat, ermine, mink, marten, wolverine, mongoose, meerkat, armadillo, anteater, aardvark, pangolin, tapir, monkey,
chimp, chimpanzee, gorilla, orangutan, gibbon, baboon, lemur, ring tailed lemur, capuchin, marmoset, tamarin, macaque,
snow monkey, bat, fruit bat, flying fox, vampire bat, deer mouse, porcupine, hedgehogs, camel calf, warthog, bushbaby,
loris, slow loris, tarsier, binturong, civet, genet, dhole, maned wolf, african wild dog, painted dog, quoll, numbat,
bilby, sugar gliders, foxes, wolves, bears, pandas, tigers, lions, monkeys, elephants
"""

BUGS = """
bug, bugs, insect, insects, butterfly, moth, caterpillar, ladybug, ladybird, bee, honeybee, bumblebee, wasp, hornet, ant,
ants, beetle, stag beetle, rhinoceros beetle, scarab, firefly, fireflies, glowworm, dragonfly, damselfly, grasshopper,
cricket, locust, cicada, praying mantis, mantis, stick insect, walking stick, leaf insect, cockroach, termite, flea, fly,
housefly, mosquito, gnat, spider, tarantula, jumping spider, black widow, scorpion, centipede, millipede, snail, slug,
earthworm, worm, inchworm, silkworm, mealworm, isopod, woodlouse, pill bug, roly poly, tick, mite, water bug, pond skater,
weevil, aphid, monarch butterfly, swallowtail, luna moth, atlas moth, hercules beetle, ladybugs, bees, butterflies, spiders
"""

SEA = """
whale, blue whale, humpback, humpback whale, orca, killer whale, sperm whale, beluga, narwhal, dolphin, bottlenose dolphin,
porpoise, seal, harbor seal, harp seal, sea lion, walrus, manatee, dugong, octopus, squid, giant squid, cuttlefish, nautilus,
jellyfish, jelly, box jellyfish, man o war jellyfish, starfish, sea star, sea urchin, sand dollar, sea cucumber, coral,
anemone, sea anemone, sponge, crab, hermit crab, king crab, spider crab, lobster, crayfish, crawfish, shrimp, prawn, krill,
barnacle, clam, oyster, mussel, scallop, conch, sea snail, sea slug, nudibranch, horseshoe crab, sea otters, penguins,
whales, dolphins, octopi, octopuses, crabs, lobsters
"""

FANTASY = """
dragon, baby dragon, dragonling, wyvern, wyrm, drake, hydra, basilisk, cockatrice, griffin, gryphon, griffon, hippogriff,
pegasus, unicorn, alicorn, phoenix, thunderbird, roc, kraken, leviathan, sea serpent, sea monster, loch ness monster, nessie,
mermaid, merman, merfolk, siren, selkie, kelpie, centaur, minotaur, satyr, faun, fairy, faerie, pixie, sprite, brownie,
gnome, elf, dwarf, goblin, hobgoblin, imp, troll, ogre, giant, yeti, bigfoot, sasquatch, chupacabra, jackalope, wolpertinger,
werewolf, vampire, ghost, spirit, poltergeist, banshee, wraith, specter, spectre, zombie, mummy, skeleton, lich, golem,
gargoyle, chimera, manticore, sphinx, cerberus, hellhound, kitsune, nine tailed fox, tanuki, kappa, tengu, oni, qilin,
kirin, baku, nue, chinese dragon, lung dragon, fenghuang, foo dog, fu dog, guardian lion, bunyip, yowie, thunderbird spirit,
wendigo, slime, blob, jelly monster, mimic, beholder, owlbear, displacer beast, dragon turtle, fire salamander spirit,
elemental, fire elemental, water elemental, earth elemental, air elemental, will o the wisp, wisp, robot, robot dog,
robo pet, mecha, android, alien, ufo alien, space cat, star creature, monster, beast, creature, critter, cryptid, mythical beast,
magical creature, familiar, spirit animal, totem, pet rock, tamagotchi, plushie, plush, teddy bear, teddy, stuffed animal,
toy dog, robot cat, clockwork bird, mechanical owl, cyber dog, dragons, unicorns, fairies, monsters
"""

PART = """
head, ears, ear, floppy ears, pointy ears, eyes, eye, nose, snout, muzzle, beak, bill, mouth, teeth, fangs, tongue, whiskers,
mane, fur, coat, hair, feathers, feather, scales, shell, carapace, wings, wing, tail, fluffy tail, bushy tail, curly tail,
paws, paw, claws, claw, talons, hooves, hoof, horns, horn, antlers, tusks, tusk, trunk, neck, legs, leg, feet, foot,
belly, back, spine, spines, quills, fins, fin, gills, flippers, flipper, tentacles, tentacle, antennae, antenna, stinger,
crest, comb, wattle, hump, pouch, spots, stripes, patches, markings, mask, collar fur, ruff, tuft, tufts, mittens, socks,
blaze, freckles, toe beans, pads, cheeks, chubby cheeks, eyebrows, eyelashes, lashes, smile, frown, blush, heads, tails,
two heads, three heads, six legs, eight legs, many legs, no legs
"""

ACCESSORY = """
collar, collars, leash, lead, harness, bow, bowtie, bow tie, ribbon, bell, name tag, tag, bandana, scarf, sweater, jumper,
hoodie, coat, raincoat, boots, booties, shoes, socks, hat, cap, beanie, crown, tiara, helmet, glasses, sunglasses, goggles,
monocle, top hat, witch hat, wizard hat, party hat, santa hat, cowboy hat, pirate hat, bonnet, flower crown, wreath, cape,
cloak, tutu, dress, skirt, vest, armor, armour, saddle, bridle, reins, blanket, cushion, bed, basket, crate, kennel,
doghouse, cage, hutch, aquarium, fish tank, terrarium, tank, bowl, food bowl, water bowl, toy, toys, ball, bone, chew toy,
squeaky toy, frisbee, stick, yarn ball, yarn, mouse toy, scratching post, cat tree, perch, swing, mirror, wheel,
hamster wheel, ball pit, tunnel, backpack, saddlebag, badge, medal, necklace, pendant, earrings, jewel, gem, flower, flowers,
leaf, bowl of food, treat, treats, carrot, fish treat, bone treat, pacifier, bib, diaper, umbrella, balloon, cupcake
"""

STYLE = """
cute, adorable, fluffy, fuzzy, furry, soft, cuddly, tiny, baby, chubby, chonky, round, fat, plump, skinny, slim, tall,
long, short, big, small, little, mini, giant, huge, sleepy, happy, playful, grumpy, angry, fierce, scary, spooky, friendly,
smiling, silly, goofy, derpy, majestic, noble, royal, regal, wild, tame, wise, old, young, magical, enchanted, mystical,
mythical, legendary, cosmic, celestial, ghostly, robotic, mechanical, cyber, steampunk, clockwork, pixel, kawaii, chibi,
cartoon, realistic, spotted, striped, speckled, dappled, brindle, merle, tabby, calico, piebald, pied, patched, hairless,
bald, curly, curly haired, long haired, short haired, wire haired, shaggy, sleek, shiny, glossy, sparkly, glittery, rainbow,
neon, glowing, fiery, icy, frosty, snowy, golden, silver, crystal, jeweled, armored, winged, horned, tailed, spiky,
scaly, feathered, flying, floating, swimming, sitting, standing, sleeping, running, jumping, dancing, laughing, winking,
waving, with a smile, two headed, three headed, multi headed, baby sized, pocket sized, giant sized, teacup sized,
viking, pirate, wizard, witch, knight, princess, prince, king, queen, chef, astronaut, ninja, samurai, cowboy, detective,
superhero, punk, goth, hipster, nerd, scholar
"""

TRANSLATIONS = {
    'object': """
hund, hunde, welpe, hündchen, huendchen, dackel, schäferhund, schaeferhund, mops, pudel, katze, katzen, kätzchen,
kaetzchen, kater, mieze, hase, häschen, haeschen, kaninchen, meerschweinchen, hamster, maus, ratte, igel, eichhörnchen,
eichhoernchen, frettchen, vogel, papagei, wellensittich, kanarienvogel, eule, adler, ente, gans, huhn, hahn, küken, kueken,
pinguin, fisch, goldfisch, hai, wal, delfin, delphin, schildkröte, schildkroete, eidechse, schlange, frosch, kröte, kroete,
pferd, pony, esel, kuh, schaf, ziege, schwein, ferkel, fuchs, wolf, bär, baer, eisbär, eisbaer, panda, löwe, loewe,
tiger, elefant, giraffe, zebra, affe, koala, faultier, otter, biber, waschbär, waschbaer, dachs, reh, hirsch, elch,
känguru, kaenguru, krake, tintenfisch, qualle, seestern, krabbe, hummer, garnele, schnecke, schmetterling, biene,
marienkäfer, marienkaefer, spinne, käfer, kaefer, drache, einhorn, greif, phönix, phoenix, meerjungfrau, fee, troll,
kobold, zwerg, riese, geist, gespenst, monster, roboter, dinosaurier,
chien, chiot, chienne, toutou, caniche, carlin, teckel, berger allemand, chat, chaton, minou, lapin, lapereau,
cochon d'inde, hamster, souris, rat, hérisson, herisson, écureuil, ecureuil, furet, oiseau, perroquet, perruche, canari,
hibou, chouette, aigle, canard, oie, poule, coq, poussin, pingouin, manchot, poisson, poisson rouge, requin, baleine,
dauphin, tortue, lézard, lezard, serpent, grenouille, crapaud, cheval, poney, âne, ane, vache, mouton, chèvre, chevre,
cochon, renard, loup, ours, ours polaire, panda, lion, tigre, éléphant, elephant, girafe, zèbre, zebre, singe, koala,
paresseux, loutre, castor, raton laveur, blaireau, cerf, élan, elan, kangourou, pieuvre, poulpe, calmar, méduse, meduse,
étoile de mer, etoile de mer, crabe, homard, crevette, escargot, papillon, abeille, coccinelle, araignée, araignee,
scarabée, scarabee, dragon, licorne, griffon, phénix, phenix, sirène, sirene, fée, fee, troll, lutin, nain, géant, geant,
fantôme, fantome, monstre, robot, dinosaure,
perro, perrito, cachorro, can, gato, gatito, michi, conejo, conejito, cobaya, cuy, hámster, hamster, ratón, raton, rata,
erizo, ardilla, hurón, huron, pájaro, pajaro, loro, periquito, canario, búho, buho, lechuza, águila, aguila, pato, ganso,
gallina, gallo, pollito, pingüino, pinguino, pez, pececito, pez dorado, tiburón, tiburon, ballena, delfín, delfin,
tortuga, lagarto, lagartija, serpiente, culebra, rana, sapo, caballo, poni, burro, vaca, oveja, cabra, cerdo, cerdito,
zorro, lobo, oso, oso polar, panda, león, leon, tigre, elefante, jirafa, cebra, mono, koala, perezoso, nutria, castor,
mapache, tejón, tejon, ciervo, venado, alce, canguro, pulpo, calamar, medusa, estrella de mar, cangrejo, langosta,
gamba, camarón, camaron, caracol, mariposa, abeja, mariquita, araña, arana, escarabajo, dragón, dragon, unicornio, grifo,
fénix, fenix, sirena, hada, trol, duende, enano, gigante, fantasma, monstruo, robot, dinosaurio,
cane, cucciolo, cagnolino, gatto, gattino, micio, coniglio, coniglietto, porcellino d'india, criceto, topo, topolino,
ratto, riccio, scoiattolo, furetto, uccello, pappagallo, cocorita, canarino, gufo, civetta, aquila, anatra, oca, gallina,
gallo, pulcino, pinguino, pesce, pesciolino, pesce rosso, squalo, balena, delfino, tartaruga, lucertola, serpente, rana,
rospo, cavallo, pony, asino, mucca, pecora, capra, maiale, maialino, volpe, lupo, orso, orso polare, panda, leone, tigre,
elefante, giraffa, zebra, scimmia, koala, bradipo, lontra, castoro, procione, tasso, cervo, alce, canguro, polpo, calamaro,
medusa, stella marina, granchio, aragosta, gambero, lumaca, farfalla, ape, coccinella, ragno, scarabeo, drago, unicorno,
grifone, fenice, sirena, fata, troll, folletto, nano, gigante, fantasma, mostro, robot, dinosauro,
hond, honden, puppy, hondje, kat, katten, kitten, poes, poesje, konijn, konijntje, cavia, hamster, muis, rat, egel,
eekhoorn, fret, vogel, papegaai, parkiet, kanarie, uil, adelaar, eend, gans, kip, haan, kuiken, pinguïn, pinguin, vis,
goudvis, haai, walvis, dolfijn, schildpad, hagedis, slang, kikker, pad, paard, pony, ezel, koe, schaap, geit, varken,
biggetje, vos, wolf, beer, ijsbeer, panda, leeuw, tijger, olifant, giraf, zebra, aap, koala, luiaard, otter, bever,
wasbeer, das, hert, eland, kangoeroe, octopus, inktvis, kwal, zeester, krab, kreeft, garnaal, slak, vlinder, bij,
lieveheersbeestje, spin, kever, draak, eenhoorn, griffioen, feniks, zeemeermin, fee, trol, kabouter, dwerg, reus, spook,
monster, robot, dinosaurus
""",
    'part': """
kopf, ohren, ohr, augen, nase, schnauze, schnabel, maul, zähne, zaehne, zunge, schnurrhaare, mähne, maehne, fell, federn,
schuppen, panzer, flügel, fluegel, schwanz, schweif, pfoten, pfote, krallen, hufe, hörner, hoerner, geweih, stoßzähne,
stosszaehne, rüssel, ruessel, hals, beine, bauch, rücken, ruecken, flossen, tentakel, fühler, fuehler, flecken, streifen,
tête, tete, oreilles, yeux, nez, museau, bec, bouche, dents, langue, moustaches, crinière, criniere, fourrure, plumes,
écailles, ecailles, carapace, ailes, queue, pattes, patte, griffes, sabots, cornes, bois, défenses, defenses, trompe, cou,
jambes, ventre, dos, nageoires, tentacules, antennes, taches, rayures,
cabeza, orejas, ojos, nariz, hocico, pico, boca, dientes, lengua, bigotes, melena, pelaje, pelo, plumas, escamas,
caparazón, caparazon, alas, cola, rabo, patas, pata, garras, pezuñas, pezunas, cuernos, astas, colmillos, trompa, cuello,
piernas, barriga, espalda, aletas, tentáculos, tentaculos, antenas, manchas, rayas,
testa, orecchie, occhi, naso, muso, becco, bocca, denti, lingua, baffi, criniera, pelo, pelliccia, piume, squame, guscio,
ali, coda, zampe, zampa, artigli, zoccoli, corna, palchi, zanne, proboscide, collo, gambe, pancia, schiena, pinne,
tentacoli, antenne, macchie, strisce,
kop, oren, ogen, neus, snuit, snavel, bek, mond, tanden, tong, snorharen, manen, vacht, veren, schubben, schild,
vleugels, staart, poten, poot, klauwen, hoeven, hoorns, gewei, slagtanden, slurf, nek, benen, buik, rug, vinnen,
tentakels, voelsprieten, vlekken, strepen
""",
    'detail': """
halsband, leine, geschirr, schleife, glöckchen, gloeckchen, halstuch, pullover, mantel, stiefel, mütze, muetze, hut,
krone, brille, sonnenbrille, umhang, sattel, decke, körbchen, koerbchen, korb, hundehütte, hundehuette, käfig, kaefig,
aquarium, napf, spielzeug, ball, knochen,
collier, laisse, harnais, nœud, noeud, clochette, bandana, pull, manteau, bottes, bonnet, chapeau, couronne, lunettes,
cape, selle, couverture, panier, niche, cage, aquarium, gamelle, jouet, balle, os,
collar, correa, arnés, arnes, lazo, cascabel, pañuelo, panuelo, suéter, sueter, abrigo, botas, gorro, sombrero, corona,
gafas, lentes, capa, silla de montar, manta, cesta, caseta, jaula, acuario, cuenco, juguete, pelota, hueso,
collare, guinzaglio, pettorina, fiocco, campanella, bandana, maglione, cappotto, stivali, berretto, cappello, corona,
occhiali, mantello, sella, coperta, cesta, cuccia, gabbia, acquario, ciotola, giocattolo, palla, osso,
halsband, riem, tuig, strik, belletje, bandana, trui, jas, laarzen, muts, hoed, kroon, bril, zonnebril, cape, zadel,
deken, mand, hondenhok, kooi, aquarium, bak, speelgoed, bal, bot
""",
    'style': """
niedlich, süß, suess, flauschig, kuschelig, klein, winzig, groß, gross, riesig, dick, pummelig, schläfrig, schlaefrig,
fröhlich, froehlich, verspielt, grimmig, wild, magisch, gefleckt, gestreift, golden, glitzernd,
mignon, mignonne, adorable, doux, duveteux, petit, minuscule, grand, géant, geant, gros, dodu, endormi, joyeux, joueur,
grognon, sauvage, magique, tacheté, tachete, rayé, raye, doré, dore, scintillant,
lindo, linda, mono, adorable, esponjoso, suave, pequeño, pequeno, diminuto, grande, gigante, gordo, regordete, dormilón,
dormilon, feliz, juguetón, jugueton, gruñón, grunon, salvaje, mágico, magico, manchado, rayado, dorado, brillante,
carino, carina, tenero, morbido, soffice, piccolo, minuscolo, grande, gigante, grasso, paffuto, assonnato, felice,
giocoso, scontroso, selvaggio, magico, maculato, striato, dorato, scintillante,
schattig, lief, pluizig, zacht, klein, piepklein, groot, reusachtig, dik, mollig, slaperig, vrolijk, speels, chagrijnig,
wild, magisch, gevlekt, gestreept, gouden, glinsterend
""",
}
