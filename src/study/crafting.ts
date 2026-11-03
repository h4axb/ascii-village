// Crafting UX: which statements concern the generative crafting (its generator
// and interface, or its use in the game) and which only the game; each
// participant's biggest Crafting UX problem; and the problems shared across
// participants (the recurring findings, limited to confirmed crafting problems).
// Only confirmed tags count (suggestions never do); people are counted once
// however many statements they made.
import type { CraftRole, CraftingUxDoc, FindingDoc, ItemDoc } from './types';
import { designOfItem } from './pages/Codes';
import { findingsOf, type Model, type Person } from './model';

export type Rel = 'core' | 'integration' | 'game' | 'unclear' | 'open';
export const REL_ROLE: Record<Exclude<Rel, 'open'>, CraftRole> = { core: 'cx-core', integration: 'cx-integration', game: 'cx-game', unclear: 'cx-unclear' };
export const REL_LABEL: Record<Rel, string> = { core: 'Generator & Interface', integration: 'Crafting–Spiel-Integration', game: 'Nur Spiel', unclear: 'Unklar', open: 'offen' };
export const REL_SHORT: Record<Rel, string> = { core: 'Kern', integration: 'Integration', game: 'Nur Spiel', unclear: 'Unklar', open: 'offen' };
export const REL_HINT: Record<Exclude<Rel, 'open'>, string> = {
  core: 'Prompt, Pre-Clarification, Post-Feedback, KI-Ergebnis',
  integration: 'Das generierte Objekt im Spiel: platzieren, nutzen',
  game: 'Quests, Bewegung, Dialoge – ohne Crafting-Bezug',
  unclear: 'Zu wenig Kontext für eine Einordnung',
};
export type CraftScope = 'core' | 'extended'; // Kern / Kern + Integration

const roleOf = (m: Model, chip: string) => m.chipRole.get(chip);
// a statement's confirmed Crafting-Bezug ('open': none yet)
export function relOf(m: Model, i: Pick<ItemDoc, 'chips'>): Rel {
  for (const c of i.chips) {
    const r = roleOf(m, c);
    if (r === 'cx-core') return 'core';
    if (r === 'cx-integration') return 'integration';
    if (r === 'cx-game') return 'game';
    if (r === 'cx-unclear') return 'unclear';
  }
  return 'open';
}
// the AI's suggestion for it (not counted)
export function suggestedRel(m: Model, i: Pick<ItemDoc, 'suggested'>): Exclude<Rel, 'open'> | null {
  const r = relOf(m, { chips: i.suggested });
  return r === 'open' ? null : r;
}
export const relChip = (m: Model, rel: Exclude<Rel, 'open'>) => m.tags.flatMap((g) => g.chips).find((c) => c.role === REL_ROLE[rel])?.id ?? null;
export const craftGroup = (m: Model) => m.tags.find((g) => g.chips.some((c) => c.role === 'cx-core')) ?? null;

export const isProblem = (m: Model, i: ItemDoc) => i.chips.some((c) => roleOf(m, c) === 'problem');
const PRIO: Record<string, number> = { essential: 3, tbd: 2, nice: 1 };
export const prioOf = (m: Model, i: ItemDoc) => Math.max(0, ...i.chips.map((c) => PRIO[roleOf(m, c) ?? ''] ?? 0));
export const inScope = (rel: Rel, scope: CraftScope) => rel === 'core' || (scope === 'extended' && rel === 'integration');

export function distribution(m: Model, items: ItemDoc[]) {
  const out: Record<Rel, number> = { core: 0, integration: 0, game: 0, unclear: 0, open: 0 };
  for (const i of items) out[relOf(m, i)]++;
  return out;
}

// the confirmed crafting problems (Art: Problem with a Crafting-Bezug in scope)
export const craftProblems = (m: Model, items: ItemDoc[], scope: CraftScope, variant: 'all' | 'A' | 'B' = 'all') =>
  items.filter((i) => isProblem(m, i) && inScope(relOf(m, i), scope) && (variant === 'all' || designOfItem(i) === variant));

export interface SharedIssue {
  finding: FindingDoc;
  items: ItemDoc[];
  persons: string[];
  a: number; // people with statements about variant A only
  b: number; // B only
  both: number;
  none: number; // without a variant
  rels: Rel[];
}
// the recurring findings among the crafting problems, by the number of people
export function sharedIssues(m: Model, problems: ItemDoc[], findings: Record<string, FindingDoc>): SharedIssue[] {
  const by = new Map<string, ItemDoc[]>();
  for (const i of problems) for (const f of findingsOf(i)) if (findings[f]) by.set(f, [...(by.get(f) ?? []), i]);
  return [...by.entries()]
    .map(([id, items]) => {
      const persons = [...new Set(items.map((i) => i.person))].sort();
      let a = 0, b = 0, both = 0, none = 0;
      for (const p of persons) {
        const ds = new Set(items.filter((i) => i.person === p).map(designOfItem));
        const hasA = ds.has('A'), hasB = ds.has('B');
        if (hasA && hasB) both++;
        else if (hasA) a++;
        else if (hasB) b++;
        else none++;
      }
      return { finding: findings[id], items, persons, a, b, both, none, rels: [...new Set(items.map((i) => relOf(m, i)))] };
    })
    .sort((x, y) => y.persons.length - x.persons.length || y.items.length - x.items.length || x.finding.name.localeCompare(y.finding.name));
}

// a person's candidates for the main problem: their findings among their
// crafting problems, then their crafting problems without a finding
export interface Candidate {
  key: string; // f:<finding> | i:<item>
  finding: FindingDoc | null;
  item: ItemDoc | null;
  items: ItemDoc[]; // the person's own statements behind it
  prio: number;
  rel: Rel;
}
export function candidatesOf(m: Model, person: string, problems: ItemDoc[], findings: Record<string, FindingDoc>): Candidate[] {
  const own = problems.filter((i) => i.person === person);
  const out: Candidate[] = [];
  const byF = new Map<string, ItemDoc[]>();
  for (const i of own) for (const f of findingsOf(i)) if (findings[f]) byF.set(f, [...(byF.get(f) ?? []), i]);
  for (const [f, items] of byF) out.push({ key: `f:${f}`, finding: findings[f], item: null, items, prio: Math.max(...items.map((i) => prioOf(m, i))), rel: relOf(m, items[0]) });
  for (const i of own) if (!findingsOf(i).some((f) => findings[f])) out.push({ key: `i:${i.id}`, finding: null, item: i, items: [i], prio: prioOf(m, i), rel: relOf(m, i) });
  return out.sort((a, b) => b.prio - a.prio || b.items.length - a.items.length);
}

export const SPECIAL_LABEL: Record<NonNullable<CraftingUxDoc['special']>, string> = { none: 'Kein Crafting-Problem', multiple: 'Mehrere gleich wichtig', insufficient: 'Zu wenig Belege' };

export interface MainState {
  status: 'confirmed' | 'suggested' | 'open' | 'invalid';
  label: string;
  key: string | null; // the chosen / proposed candidate
  doc: CraftingUxDoc | null;
}
// what the page shows for a person: the decision stored, else a proposal (the
// candidate with the highest priority and most statements), else open; a
// stored decision whose evidence is gone is flagged
export function mainOf(p: Person, cands: Candidate[], findings: Record<string, FindingDoc>, items: Record<string, ItemDoc>): MainState {
  const doc = p.doc.craftingUx ?? null;
  if (doc && (doc.special || doc.finding || doc.item)) {
    if (doc.special) return { status: 'confirmed', label: SPECIAL_LABEL[doc.special], key: null, doc };
    const key = doc.finding ? `f:${doc.finding}` : `i:${doc.item}`;
    const label = doc.finding ? findings[doc.finding]?.name ?? 'Befund gelöscht' : items[doc.item!]?.de || items[doc.item!]?.text || 'Aussage gelöscht';
    return { status: cands.some((c) => c.key === key) ? 'confirmed' : 'invalid', label, key, doc };
  }
  const top = cands[0];
  if (top) return { status: 'suggested', label: top.finding?.name ?? (top.item!.de || top.item!.text), key: top.key, doc: null };
  return { status: 'open', label: 'kein Crafting-Problem erfasst', key: null, doc: null };
}
