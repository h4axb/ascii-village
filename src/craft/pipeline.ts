// ---------------------------------------------------------------------------
// craftSprite — the full crafting pipeline, in the requested order:
//
//   0. validate the request is legitimate               (else: fail)
//   1. GENERATE a fresh sprite + validate it, retrying   (success → use + store)
//   2. if the LLM can't produce a valid one → DATABASE    (exact, then similar)
//   3. if the store has nothing suitable → FAIL
//
// The `generate` function is injected (compose it from ./generate + your chat
// client), and the `store` is any AssetStore (local now, shared backend later).
// ---------------------------------------------------------------------------

import type { AssetStore } from './assetStore';
import { resolveBase } from './assetStore';
import type { BaseAsset, CraftSpec, ItemInstance } from './spec';
import { baseKey, instanceFromSpec, parseSpec } from './spec';
import { DEFAULT_LIMITS, repairSprite, validateRequest, validateSprite, type SpriteLimits } from './validate';

export interface CraftDeps {
  store: AssetStore;
  generate: (spec: CraftSpec) => Promise<string[] | null>;
  limits?: SpriteLimits;
  maxTries?: number;
  // off by default (generate-first, per design). Turn on to reuse existing
  // assets before spending an LLM call.
  preferCache?: boolean;
}

export type CraftOutcome =
  | {
      ok: true;
      source: 'generated' | 'reused';
      via?: 'exact' | 'similar';
      score?: number;
      asset: BaseAsset;
      instance: ItemInstance;
      sprite: string[];
      tries: number;
    }
  | { ok: false; stage: 'request' | 'exhausted'; reasons: string[] };

function uid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : 'a_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function reuse(spec: CraftSpec, hit: { asset: BaseAsset; via: 'exact' | 'similar'; score?: number }): CraftOutcome {
  return {
    ok: true,
    source: 'reused',
    via: hit.via,
    score: hit.score,
    asset: hit.asset,
    instance: instanceFromSpec(spec, hit.asset.id),
    sprite: hit.asset.sprite,
    tries: 0,
  };
}

export async function craftSprite(prompt: string, deps: CraftDeps): Promise<CraftOutcome> {
  const { store, generate } = deps;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const maxTries = deps.maxTries ?? 3;
  const spec = parseSpec(prompt);

  // 0) request legitimacy
  const req = validateRequest(spec);
  if (!req.ok) return { ok: false, stage: 'request', reasons: req.reasons };

  // optional efficiency mode: reuse before generating
  if (deps.preferCache) {
    const cached = await resolveBase(store, spec);
    if (cached) return reuse(spec, cached);
  }

  // 1) GENERATE a fresh sprite + validate, retrying a few times
  for (let t = 1; t <= maxTries; t++) {
    const candidate = await generate(spec);
    if (!candidate) continue;
    const repaired = repairSprite(candidate, limits);
    if (validateSprite(repaired, limits).ok) {
      const asset: BaseAsset = {
        id: uid(),
        key: baseKey(spec),
        category: spec.category,
        base: spec.base,
        hybrid: spec.hybrid,
        shape: spec.shape,
        sprite: repaired,
        createdAt: Date.now(),
      };
      await store.put(asset);
      return {
        ok: true,
        source: 'generated',
        asset,
        instance: instanceFromSpec(spec, asset.id),
        sprite: repaired,
        tries: t,
      };
    }
  }

  // 2) LLM couldn't produce a legitimate sprite → DATABASE fallback
  const hit = await resolveBase(store, spec);
  if (hit) return reuse(spec, hit);

  // 3) nothing in the store either → FAIL
  return {
    ok: false,
    stage: 'exhausted',
    reasons: ['could not generate a valid sprite, and found nothing similar in the store'],
  };
}
