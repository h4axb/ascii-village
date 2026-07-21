// ---------------------------------------------------------------------------
// AssetStore — the "generate once, serve many" content store.
//
// The interface is async on purpose: today it's backed by memory/localStorage
// (per-browser), but the SAME interface drops onto a shared backend (Supabase +
// pgvector, a KV, etc.) so one asset can be reused across all players. Only the
// implementation changes — callers never do.
//
//   getByKey(key)         exact shape match  → reuse, apply this player's colour
//   findSimilar(spec)     nothing exact, but is there a close one? → reuse + alias
//   put(asset) / alias    store a newly generated asset (and point keys at it)
// ---------------------------------------------------------------------------

import type { BaseAsset, CraftSpec } from './spec';
import { baseKey } from './spec';

export interface AssetStore {
  getByKey(key: string): Promise<BaseAsset | null>;
  findSimilar(spec: CraftSpec, minScore?: number): Promise<{ asset: BaseAsset; score: number } | null>;
  put(asset: BaseAsset): Promise<void>;
  alias(key: string, baseId: string): Promise<void>;
  all(): Promise<BaseAsset[]>;
}

// optional persistence backend (localStorage in the browser; omitted in tests)
export interface Persistence {
  load(): string | null;
  save(data: string): void;
}

export function localStoragePersistence(storageKey = 'craft-assets'): Persistence {
  return {
    load: () => (typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null),
    save: (data) => {
      if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, data);
    },
  };
}

// shape tokens used for similarity (nouns + silhouette features)
function shapeTokens(a: { base: string; hybrid?: string; shape: string[] }): string[] {
  return [a.base, ...(a.hybrid ? [a.hybrid] : []), ...a.shape];
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// A local (per-browser) store. Good for prototyping the model; swap for a
// shared backend later without touching callers.
export class LocalAssetStore implements AssetStore {
  private assets = new Map<string, BaseAsset>();
  private index = new Map<string, string>(); // key/alias -> assetId

  constructor(private persist?: Persistence) {
    this.hydrate();
  }

  async getByKey(key: string): Promise<BaseAsset | null> {
    const id = this.index.get(key);
    return (id && this.assets.get(id)) || null;
  }

  async findSimilar(spec: CraftSpec, minScore = 0.55): Promise<{ asset: BaseAsset; score: number } | null> {
    const q = shapeTokens(spec);
    let best: { asset: BaseAsset; score: number } | null = null;
    for (const asset of this.assets.values()) {
      if (asset.category !== spec.category) continue; // only reuse within a category
      const score = jaccard(q, shapeTokens(asset));
      if (score >= minScore && (!best || score > best.score)) best = { asset, score };
    }
    return best;
  }

  async put(asset: BaseAsset): Promise<void> {
    this.assets.set(asset.id, asset);
    this.index.set(asset.key, asset.id);
    this.save();
  }

  async alias(key: string, baseId: string): Promise<void> {
    this.index.set(key, baseId);
    this.save();
  }

  async all(): Promise<BaseAsset[]> {
    return [...this.assets.values()];
  }

  private save() {
    if (!this.persist) return;
    this.persist.save(
      JSON.stringify({ assets: [...this.assets.values()], index: [...this.index.entries()] }),
    );
  }

  private hydrate() {
    const raw = this.persist?.load();
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { assets: BaseAsset[]; index: [string, string][] };
      for (const a of data.assets) this.assets.set(a.id, a);
      for (const [k, id] of data.index) this.index.set(k, id);
    } catch {
      // corrupt cache — start fresh
    }
  }
}

// The full lookup flow: exact key → similar → miss (caller generates + stores).
// Returns the base asset to use plus how it was found, or null if the caller
// must generate a new one.
export async function resolveBase(
  store: AssetStore,
  spec: CraftSpec,
): Promise<{ asset: BaseAsset; via: 'exact' | 'similar'; score?: number } | null> {
  const key = baseKey(spec);
  const exact = await store.getByKey(key);
  if (exact) return { asset: exact, via: 'exact' };

  const similar = await store.findSimilar(spec);
  if (similar) {
    await store.alias(key, similar.asset.id); // point this phrasing at the reused asset
    return { asset: similar.asset, via: 'similar', score: similar.score };
  }
  return null; // caller: generate, then store.put(...)
}
