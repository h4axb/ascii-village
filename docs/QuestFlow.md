# Quest flow and two-condition user test

On `/1` (and `/intro/1`), the game runs a guided quest flow after the intro, then repeats the crafting part with the other crafting panel. The setting is per link, in `src/quest/quests.ts` (`ORDERS`):

| Link | Condition 1 | Condition 2 |
|---|---|---|
| `/1` | pre-clarification (A) | post-reflection (B): order `AB` |
| `/2` | post-reflection (B) | pre-clarification (A): order `BA` |

The other links are unchanged.

## Flow

**NEW BEGINNINGS** (*Your new life on ASCIIA Bay starts here.*)
1. YOUR FIRST STEPS: walk around a little (10 tiles).
2. LITTLE THINGS ADD UP: gather 3 resources.
3. MAKE YOURSELF AT HOME: store an item at the house.
4. CHECK IN WITH MITCHY. *Cinematic A:* Mitchy hands over the crafting token.
5. BEYOND THE SHORE: craft a water vehicle and place it on the water. *Cinematic B:* sail to the shop island, then **NEW BEGINNINGS COMPLETE**.
6. **The seed gift.** Mitchy offers a housewarming seed, named only by a hint: "Tiny sweet seed" (strawberries) or "Round golden seed" (a pumpkin). The pick goes into the bag (`quest.seedKind`).

**GROWING ROOTS** (*Time to make this little island feel more like home.*)
1. A GARDEN OF YOUR OWN: craft a watering tool from a token bought at the shop.
2. A LITTLE WATER GOES A LONG WAY: fill it at the pond.
3. PUT DOWN ROOTS: plant the gift seed.
4. HELP IT FLOURISH: water it (F next to it, holding the tool).
5. THE FIRST HARVEST: harvest it (F once grown). Strawberries and pumpkins both sell for 20 coins, one token.
6. A FRIEND OF YOUR OWN: craft a companion and equip it.
7. SOMETHING TO SHOW: report back with "I'm done.", then **GROWING ROOTS COMPLETE**.

**Rating questions (condition 1)**, then **Continue**, then the **black transition screen**, then **Begin second part**.

**SECOND JOURNEY (condition 2)** (*A familiar journey, with another way to bring your ideas to life.*): the game restarts right after Cinematic A.
1. ACROSS THE BAY, ONCE MORE: the vehicle. *Cinematic C* (the same sail), then the seed gift again.
2. The seven GROWING ROOTS steps, from the watering tool to SOMETHING TO SHOW, with shorter texts, then **SECOND JOURNEY COMPLETE**.

**Rating questions (condition 2)**, then Mitchy's closing lines, then **Open final survey**.

**Hints.** The light bulb at the top right of the quest panel plays the current step's hint (`hint` on each objective). Hints never play on their own.
- **Focus hints:** lock the player, glide the camera to the objective (resource, house, Mitchy, pond, garden bed or your plant) and back, and can leave a "!" over it until the step changes. The resource hint also sparkles the 3 nearest resources.
- **YOUR FIRST STEPS:** blinks the Controls bookmark.
- **Picture hints:** open a modal whose [bracketed] line describes the picture to be drawn.

## What to edit

All in `src/quest/quests.ts`:
- **Texts:** objectives, Mitchy's lines, the transition text.
- **`RATING_QUESTIONS`:** placeholder wording. Keep the `id`s stable once testing starts. Both conditions always get the same questions on the same 1-5 scale.
- **`FINAL_SURVEY_URL`:** the Tally survey (`https://tally.so/r/7R8900`), opened with `?order=…&test_id=…`.

## How it is built

**State**
- Quest progress is `SaveState.quest` (`src/quest/state.ts`).
- On quest links it is written to the save after every step, so a reload keeps progress.
- The world as it was right after the token hand-over is kept as `quest.snapshot`. "Begin second part" restores it: inventory, money, storage, bag, crops, placed items, picked resources, player and Mitchy positions. It then adds a fresh token, unequips, resets the token-buy count and clears the post-reflection preferences.

**State types**

| Type | Behaviour |
|---|---|
| Gameplay steps | Complete on the player's own actions. The hooks are in `collect`, `storeItem`, `consumeCraft`, `equipOwned`, `commitPlacement`, `plantBase`, `waterCrops`, `harvestCrop` and the pond. |
| Cinematics | Hold `cinematic = 'quest'`, so input is locked and the quest panel is hidden. The next objective only appears when they end. |
| Rating questions and transition | Pause the game. |

**Crafting is permissive.** Whatever the player crafts for the vehicle, tool or companion objective is made to work as one:
- the vehicle floats;
- the tool waters;
- the companion follows.

**Boat**
- On quest links, a floating vehicle is placed on open water within 6 tiles of the player.
- After the trip it stays docked. Clicking it gives **Sail across**, a short ferry between the main island and the shop island (`src/quest/route.ts`).

- Picked flowers no longer drop seeds; the seed comes from Mitchy’s gift.
- Every link: a picked flower drops a seed 15% of the time. While the planting step still needs one, a seed is guaranteed.
- A seed stays dormant until its first watering, then grows into a Sunbloom in about 45 s. A Sunbloom sells for 20 coins, the price of one token.
- Dates can't be planted any more.

**Feedback**
- Every crafting rating records `cond` (`pre` / `post`).
- Each condition's rating answers are one record with `rating: {questionId: 1-5 | null}`.
- The dashboard (`/2/feedback`) shows the average per question for each condition. The CSV has `cond` and `rating` columns.

**DEV-only test hooks:** `window.__qt()` (App.tsx), used by automated runs.

## Participants and the survey link

**Getting an ID**
- A new run asks the server for the next participant ID: `P001`, `P002`, … counted across every device.
- A new run is a new player on `/1`, `/2`, `/intro/1` or `/intro/2`, or **New Game**.
- The server is `POST /api/participant` (`functions/api/participant.ts`, same D1 database as the feedback). Its table creates itself on first use.
- Under `pnpm dev`, a stand-in counts in `.participants-dev.json`.

**Keeping it**
- The run keeps `{participantId, order}` in its save (`testSession`), so a reload keeps the same ID.
- Settings shows it as "Test ID P001 · order AB".
- Offline, the run gets a local ID instead (`L-` and 5 letters).

**Uploading a save**
- A run continues on the link of its order.
- A `BA` save uploaded on `/1` is stored as the `/2` save, and the game switches to `/2` (`/intro/1` → `/intro/2`). The same works the other way round.

**Where it goes**
- **Feedback records:** every craft and rating record carries `participant` and `order`, and both are in the dashboard's CSV.
- **Survey:** **Open final survey** opens `FINAL_SURVEY_URL` with `?order=AB&test_id=P001` added (`surveyUrl` in `src/quest/session.ts`).

