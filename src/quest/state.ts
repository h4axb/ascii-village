// Quest progress (SaveState.quest) and the small pure helpers around it.
// See quests.ts for the flow itself.
import type { SaveState } from '../save';
import { QUEST_ORDER, QUESTLINE_1, QUESTLINE_2, REPLAY, type Cond, type Objective, type Questline, type StepId } from './quests';

// Where in the test the player is:
//   q1 / q2      questlines 1 and 2 (condition 1)
//   rate1        condition 1's rating questions
//   transition   the black test-transition screen
//   c2           the replay (condition 2)
//   rate2        condition 2's rating questions, then the final survey
//   end          finished
export type QuestPart = 'q1' | 'q2' | 'rate1' | 'transition' | 'c2' | 'rate2' | 'end';

// The world as it was right before the first water vehicle was crafted:
// condition 2 starts again from exactly here (plus a fresh token).
export type QuestSnapshot = Pick<
  SaveState,
  'player' | 'inv' | 'money' | 'storages' | 'bag' | 'removedIds' | 'shaken' | 'plantedCrops' | 'placed' | 'mitchyPos'
>;

export interface QuestBoat {
  id: string; // the placed item's id; the boat waits on the water where it was left
}

export interface QuestState {
  part: QuestPart;
  step: number; // index into the current questline's steps
  gathered: number; // FIELD GATHERING's counter
  waterTool?: string; // the crafted watering tool's ownedId
  filled?: boolean; // the watering tool holds water
  seedCrop?: string; // the planted seed's crop id
  boat?: QuestBoat;
  riding?: boolean; // the player is sailing the boat (WASD over water)
  snapshot?: QuestSnapshot;
}

export const freshQuest = (): QuestState => ({ part: 'q1', step: 0, gathered: 0 });

export function questlineOf(part: QuestPart): Questline | null {
  return part === 'q1' ? QUESTLINE_1 : part === 'q2' ? QUESTLINE_2 : part === 'c2' ? REPLAY : null;
}

export function objectiveOf(q: QuestState | null): Objective | null {
  if (!q) return null;
  return questlineOf(q.part)?.steps[q.step] ?? null;
}

// Is `id` the objective the player is on right now?
export const isStep = (q: QuestState | null, id: StepId) => objectiveOf(q)?.id === id;

// The crafting panel for this point of the test
export function condOf(part: QuestPart): Cond | null {
  if (!QUEST_ORDER) return null;
  return part === 'c2' || part === 'rate2' || part === 'end' ? QUEST_ORDER[1] : QUEST_ORDER[0];
}

// The next objective, or the questline's end (null)
export function advance(q: QuestState): QuestState | null {
  const line = questlineOf(q.part);
  if (!line) return null;
  return q.step + 1 < line.steps.length ? { ...q, step: q.step + 1 } : null;
}

export function parseQuest(v: unknown): QuestState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const q = v as Partial<QuestState>;
  const parts: QuestPart[] = ['q1', 'q2', 'rate1', 'transition', 'c2', 'rate2', 'end'];
  if (!parts.includes(q.part as QuestPart) || typeof q.step !== 'number') return undefined;
  return { ...(q as QuestState), gathered: Number(q.gathered) || 0 };
}
