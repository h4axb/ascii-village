# Game Pitch

> Working document — fill the «placeholders» with your own framing before the
> professor meeting.

## Working title

Asciia Bay

## One-liner

A cozy, text-based (ASCII) island-village game where crafting is driven by a
large language model, so the world's items are open-ended and never fully
predictable.

## What the player does

- Explore a hand-designed island of distinct regions (grassland, rainforest,
  desert, volcanic lava, snowy peak, beaches) surrounded by ocean.
- Forage materials, run a home garden (plant, water on a per-plant schedule,
  harvest), shop and sell, and sail the ocean with a boat.
- **Craft** by describing what they want; the LLM interprets the request and
  produces an item, so two players rarely get exactly the same result.

## The hook (and the research angle)

The crafting mechanic is **non-deterministic**: the same prompt can yield
different outcomes. The design challenge — and the thesis focus — is **visual
user guidance under non-deterministic LLM behaviour**: how do you keep the
interface legible, learnable, and trustworthy when the underlying system is
unpredictable?

## Target audience

«e.g. players of cozy/sandbox games; and, academically, HTW examiners assessing
UI/UX process» — refine this.

## Thesis question (draft — finalize for Thu Jul 16)

«State the research question here: the crafting-mechanic variants you compare,
the metrics (task success, perceived control, trust/predictability,
time-on-task), and how the non-deterministic LLM condition stays comparable
across playtesters.»

## Scope / status

Prototype. Implemented so far: real LLM crafting boundary, farming loop,
designed island map, shop/inventory/equip. See the latest
[dev log](devlogs/2026-07-week2.md).
