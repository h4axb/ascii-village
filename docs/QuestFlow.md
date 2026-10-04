# Quest flow and two-condition user test

On `/1` (and `/intro/1`), the game runs a guided quest flow after the intro, then repeats the crafting part with the other crafting panel. The setting is per link, in `src/quest/quests.ts` (`ORDERS`):

| Link | Condition 1 | Condition 2 |
|---|---|---|
| `/1` | pre-clarification | post-reflection |
| `/2` | prepared as post-reflection, then pre-clarification; switched off until enabled | |

The other links are unchanged.

## Flow

**NEW BEGINNINGS**
1. Learn the controls.
2. Gather 12 resources.
3. Store an item at the house.
4. Find Mitchy. *Cinematic A:* Mitchy hands over the crafting token.
5. Craft a water vehicle and place it on the water.
6. QUEST COMPLETE. *Cinematic B:* sail to the shop island.

**GROWING ROOTS**
1. Craft a watering tool from a token bought at the shop.
2. Fill it at the pond.
3. Plant a seed.
4. Water it.
5. Harvest it.
6. Sell the Sunbloom (20 coins), buy a token, craft a companion and equip it.
7. Report back with "I'm done."
8. Mitchy's line, then QUEST COMPLETE.

**Rating questions (condition 1)**, then **Continue**, then the **black transition screen**, then **Begin second part**.

**SECOND JOURNEY (condition 2).** The game restarts right after Cinematic A. *Cinematic C* is the same sail as B. The steps from the watering tool to "I'm done" follow, then QUEST COMPLETE.

**Rating questions (condition 2)**, then Mitchy's closing lines, then **Open final survey**.

## What to edit

All in `src/quest/quests.ts`:
- **Texts:** objectives, Mitchy's lines, the transition text.
- **`RATING_QUESTIONS`:** placeholder wording. Keep the `id`s stable once testing starts. Both conditions always get the same questions on the same 1-5 scale.
- **`FINAL_SURVEY_URL`:** empty until the survey link is pasted in.

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

**Seeds**
- Every link: a picked flower drops a seed 15% of the time. While the planting step still needs one, a seed is guaranteed.
- A seed stays dormant until its first watering, then grows into a Sunbloom in about 45 s. A Sunbloom sells for 20 coins, the price of one token.
- Dates can't be planted any more.

**Feedback**
- Every crafting rating records `cond` (`pre` / `post`).
- Each condition's rating answers are one record with `rating: {questionId: 1-5 | null}`.
- The dashboard (`/2/feedback`) shows the average per question for each condition. The CSV has `cond` and `rating` columns.

**DEV-only test hooks:** `window.__qt()` (App.tsx), used by automated runs.
