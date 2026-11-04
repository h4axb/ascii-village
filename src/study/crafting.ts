// Crafting UX: which statements concern the generative crafting (its generator
// and interface, or its use in the game) and which only the game; each
// participant's biggest Crafting UX problem; and the problems shared across
// participants (the recurring findings, limited to the crafting statements).
// Only confirmed tags count (suggestions never do); people are counted once
// however many statements they made.
import type { CraftRole, CraftingUxDoc, CraftingUxPick, ItemDoc } from './types';
import { designOfItem } from './pages/Codes';
import type { Model, Person } from './model';

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

// the crafting statements: every statement whose confirmed Crafting-Bezug is in
// scope (Kern, or Kern + Integration), whatever its Art (problem, observation,
// remark …): the Crafting-Bezug alone decides
export const craftItems = (m: Model, items: ItemDoc[], scope: CraftScope, variant: 'all' | 'A' | 'B' = 'all') =>
  items.filter((i) => inScope(relOf(m, i), scope) && (variant === 'all' || designOfItem(i) === variant));
// the statement's Art as tagged (Problem, Anmerkung …), for showing it
export const artOf = (m: Model, i: ItemDoc) => {
  const c = i.chips.find((x) => ['problem', 'positive', 'surprise', 'remark'].includes(roleOf(m, x) ?? ''));
  return c ? m.chipLabel.get(c) ?? '' : '';
};

// a shared Crafting UX problem: a group of crafting statements of its own,
// kept apart from the recurring findings (settings/craftingProblems)
export type CxStatus = 'idea' | 'chosen' | 'implemented' | 'tested' | 'rejected';
export const CX_STATUS: [CxStatus, string][] = [
  ['idea', 'Idee'],
  ['chosen', 'Ausgewählt'],
  ['implemented', 'Umgesetzt'],
  ['tested', 'Getestet'],
  ['rejected', 'Verworfen'],
];
export interface CxSolution {
  id: string;
  text: string;
  status: CxStatus; // Idee › Ausgewählt › Umgesetzt › Getestet, or Verworfen
  evaluation?: string; // what a later test showed about it
}
// how a statement counts for a problem: as evidence of the difficulty, or as
// context only (a preference, a neutral remark: never counted as affected)
export type CxRole = 'evidence' | 'context';
export interface CxProblem {
  id: string;
  name: string;
  description?: string; // the problem, neutrally worded
  cause?: string; // a possible cause
  requirement?: string; // the design requirement it leads to
  solutions?: CxSolution[];
  status?: CxStatus;
  category?: string; // e.g. Verständlichkeit, Kontrolle
  evaluation?: string; // the evaluation result: did later testing support the solution
  items: string[]; // statement ids
  roles?: Record<string, CxRole>; // set by hand, else by the statement's Art
  auto?: boolean; // created from an AI proposal
}
// a statement's role in a problem: set by hand, else a positive reaction or a
// remark is context, everything else (a problem, a surprise, untagged) evidence
export function roleIn(m: Model, g: CxProblem, i: ItemDoc): CxRole {
  const r = g.roles?.[i.id];
  if (r) return r;
  return i.chips.some((c) => ['positive', 'remark'].includes(roleOf(m, c) ?? '')) ? 'context' : 'evidence';
}
// (older solutions: 'chosen' stays Ausgewählt; anything unknown is an idea)
export const solStatus = (s: CxSolution): CxStatus => (CX_STATUS.some(([k]) => k === s.status) ? s.status : 'idea');
export const cxProblemsOf = (settings: Record<string, unknown>): CxProblem[] => ((settings.craftingProblems as { list?: CxProblem[] } | undefined)?.list ?? []);
export const groupsOfItem = (problems: CxProblem[], id: string) => problems.filter((g) => g.items.includes(id));

export interface SharedIssue {
  problem: CxProblem;
  items: ItemDoc[]; // its crafting statements in the current view
  evidence: ItemDoc[]; // those that document the difficulty
  persons: string[]; // the people affected: with evidence (context never counts)
  context: string[]; // people with context statements only
  a: number; // people with statements about variant A only
  b: number; // B only
  both: number;
  none: number; // without a variant
  rels: Rel[];
}
// the problem groups with the crafting statements in view, by the number of people
// (a group with none of them in view is still listed, with 0)
export function sharedIssues(m: Model, inView: ItemDoc[], problems: CxProblem[]): SharedIssue[] {
  const byId = new Map(inView.map((i) => [i.id, i]));
  return problems
    .map((g) => {
      const items = g.items.map((id) => byId.get(id)).filter((i): i is ItemDoc => !!i);
      const evidence = items.filter((i) => roleIn(m, g, i) === 'evidence');
      const persons = [...new Set(evidence.map((i) => i.person))].sort();
      const context = [...new Set(items.map((i) => i.person))].filter((p) => !persons.includes(p)).sort();
      let a = 0, b = 0, both = 0, none = 0;
      for (const p of persons) {
        const ds = new Set(evidence.filter((i) => i.person === p).map(designOfItem));
        const hasA = ds.has('A'), hasB = ds.has('B');
        if (hasA && hasB) both++;
        else if (hasA) a++;
        else if (hasB) b++;
        else none++;
      }
      return { problem: g, items, evidence, persons, context, a, b, both, none, rels: [...new Set(evidence.map((i) => relOf(m, i)))] };
    })
    .sort((x, y) => y.persons.length - x.persons.length || y.items.length - x.items.length || x.problem.name.localeCompare(y.problem.name));
}

// a person's candidates for the main problem: the problem groups their crafting
// statements are in, then their crafting statements without a group
export interface Candidate {
  key: string; // p:<problem> | i:<item>
  problem: CxProblem | null;
  item: ItemDoc | null;
  items: ItemDoc[]; // the person's own statements behind it
  prio: number;
  rel: Rel;
}
export function candidatesOf(m: Model, person: string, crafting: ItemDoc[], problems: CxProblem[]): Candidate[] {
  const own = crafting.filter((i) => i.person === person);
  const out: Candidate[] = [];
  for (const g of problems) {
    const items = own.filter((i) => g.items.includes(i.id));
    if (items.length) out.push({ key: `p:${g.id}`, problem: g, item: null, items, prio: Math.max(...items.map((i) => prioOf(m, i))), rel: relOf(m, items[0]) });
  }
  for (const i of own) if (!problems.some((g) => g.items.includes(i.id))) out.push({ key: `i:${i.id}`, problem: null, item: i, items: [i], prio: prioOf(m, i), rel: relOf(m, i) });
  return out.sort((a, b) => b.prio - a.prio || b.items.length - a.items.length);
}

export const SPECIAL_LABEL: Record<NonNullable<CraftingUxDoc['special']>, string> = { none: 'Kein Crafting-Problem', multiple: 'Mehrere gleich wichtig', insufficient: 'Zu wenig Belege' };

export const MAX_PICKS = 3;
export const pickKey = (x: CraftingUxPick) => (x.problem ? `p:${x.problem}` : `i:${x.item}`);
// a decision's picks, in their order (older decisions: the one problem / statement)
export function picksOf(doc: CraftingUxDoc | null | undefined): CraftingUxPick[] {
  if (!doc || doc.special) return [];
  if (doc.picks?.length) return doc.picks.filter((x) => x.problem || x.item).slice(0, MAX_PICKS);
  return doc.problem || doc.item ? [{ problem: doc.problem, item: doc.item }] : [];
}
export interface MainPick {
  key: string;
  label: string;
  ok: boolean; // its evidence is still there
}
export interface MainState {
  status: 'confirmed' | 'suggested' | 'open' | 'invalid';
  label: string;
  key: string | null; // the first chosen / the proposed candidate
  picks: MainPick[]; // the central problems chosen, by weight
  doc: CraftingUxDoc | null;
}
// what the page shows for a person: the decision stored (up to three central
// problems, or a special case), else a proposal (the candidate with the highest
// priority and most statements), else open; a stored pick whose evidence is
// gone is flagged
export function mainOf(p: Person, cands: Candidate[], problems: CxProblem[], items: Record<string, ItemDoc>): MainState {
  const doc = p.doc.craftingUx ?? null;
  const picks = picksOf(doc);
  if (doc && (doc.special || picks.length || doc.finding)) {
    if (doc.special) return { status: 'confirmed', label: SPECIAL_LABEL[doc.special], key: null, picks: [], doc };
    // (a decision made on a recurring finding, before the problem groups: to choose again)
    if (!picks.length) return { status: 'invalid', label: 'früher auf einen Befund gesetzt – neu wählen', key: null, picks: [], doc };
    const out = picks.map((x) => {
      const key = pickKey(x);
      const label = x.problem ? problems.find((g) => g.id === x.problem)?.name ?? 'Problem-Gruppe gelöscht' : items[x.item!]?.de || items[x.item!]?.text || 'Aussage gelöscht';
      return { key, label, ok: cands.some((c) => c.key === key) };
    });
    return { status: out.every((x) => x.ok) ? 'confirmed' : 'invalid', label: out.map((x) => x.label).join(' · '), key: out[0].key, picks: out, doc };
  }
  const top = cands[0];
  if (top) return { status: 'suggested', label: top.problem?.name ?? (top.item!.de || top.item!.text), key: top.key, picks: [], doc: null };
  return { status: 'open', label: 'keine Crafting-Aussage erfasst', key: null, picks: [], doc: null };
}
// the people a problem group is central to, with its rank among their picks (1–3)
export const centralTo = (gid: string, people: { p: Person; main: MainState }[]) =>
  people.flatMap(({ p, main }) => {
    const r = main.picks.findIndex((x) => x.ok && x.key === `p:${gid}`);
    return r >= 0 ? [{ person: p.id, rank: r + 1 }] : [];
  });
