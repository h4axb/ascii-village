// The study dashboard's stored documents (functions/api/study.ts) and the
// game data it reads. Everything shown is derived from these (model.ts).
import type { FeedbackRecord } from '../feedback/schema';
import type { RunEvent } from '../quest/runlog';
import type { ExportInvite } from '../feedback/studyExport';

export type Design = 'A' | 'B';

// ---- Tally ----
export type ColumnRole =
  | { role: 'ignore' }
  | { role: 'id' } // the participant id the game sent (tallyid / test_id)
  | { role: 'order' } // the design order the game sent (AB / BA)
  | { role: 'p1'; question: string; values: Record<string, Design | 'neutral' | null> } // Teil 1: direct comparison
  | { role: 'likert'; item: string; design: Design; values: Record<string, number | null> } // Teil 2
  | { role: 'ueqs'; item: number; design: Design; reversed: boolean } // Teil 3: item 0–7, answers 1–7
  | { role: 'info'; label: string; numeric: boolean } // Teil 4
  | { role: 'text'; label: string }; // free text
export interface TallyDoc {
  file: string;
  importedAt: number;
  headers: string[];
  rows: string[][];
  mapping: ColumnRole[];
}

// ---- participants: corrections that apply everywhere ----
export interface PersonDoc {
  id: string; // P007
  excluded?: boolean;
  reason?: string;
  swapP1?: boolean; // mixed up A and B in Teil 1
  runtime?: 'sum' | 'main'; // several links: their times added, or the main link only
  mainLink?: string; // the invite key of the main link
  tallyRow?: number | null; // the Tally row (index), null = none; undefined = matched automatically
  group?: 'AB' | 'BA'; // test group, when it differs from what was tracked
  age?: number | null; // overrides the Tally answer
}

// ---- notes ----
export interface NotesDoc {
  text: string;
  importedAt: number;
  file?: string;
}
// what the notes file says about a participant (its header lines)
export interface NotesMeta {
  id: string;
  name: string; // kept on the Notizen page only: never in figures, quotes or exports
  link: string;
  slot: string;
  group: string;
}
export type Section = 'during' | 'followup' | 'survey';
export const SECTION_LABEL: Record<Section, string> = { during: 'Beobachtung', followup: 'Nachgespräch', survey: 'Umfrage (Freitext)' };

export interface ItemDoc {
  id: string;
  person: string;
  link?: string; // the link from the notes header (P009.2's)
  section: Section;
  question?: string; // the Follow-up question it answers
  text: string;
  order: number;
  chips: string[]; // confirmed chip ids
  suggested: string[]; // AI suggestions, not counted
  finding?: string | null; // confirmed recurring finding
  suggestedFinding?: string | null;
  suggestedNewFinding?: string | null;
  confirmed?: boolean; // the statement has been checked
  status?: 'changed' | 'new' | 'removed'; // after re-importing the notes
  manual?: boolean; // added by hand (kept on re-import)
}

export type ChipRole = 'game' | 'survey' | 'process' | 'problem' | 'positive' | 'surprise' | 'remark' | 'essential' | 'tbd' | 'nice' | 'rejected';
export interface Chip {
  id: string;
  label: string;
  role?: ChipRole;
}
export interface TagGroup {
  id: string;
  name: string;
  multi: boolean;
  order: number;
  chips: Chip[];
}

export interface FindingDoc {
  id: string;
  name: string;
}

export interface CaptionDoc {
  caption: string;
}
export interface HypothesisDoc {
  id: string;
  text: string;
  claims: string[];
  expect?: Design | null; // the design the hypothesis expects to be better
  note?: string; // the interpretation
  order?: number;
}
export interface ClaimDoc {
  text: string;
}

export interface StudyDocs {
  tally: Record<string, TallyDoc>;
  notes: Record<string, NotesDoc>;
  items: Record<string, ItemDoc>;
  findings: Record<string, FindingDoc>;
  tags: Record<string, TagGroup>;
  people: Record<string, PersonDoc>;
  captions: Record<string, CaptionDoc>;
  hypotheses: Record<string, HypothesisDoc>;
  claims: Record<string, ClaimDoc>;
  settings: Record<string, unknown>;
}
export type Coll = keyof StudyDocs;

export interface Invite extends ExportInvite {
  run_order?: string | null;
  last_seen?: number | null;
}
export interface GameData {
  invites: Invite[];
  events: RunEvent[];
  feedback: FeedbackRecord[];
}

// the default tag sets (the first visit stores them; all editable)
export const DEFAULT_TAGS: TagGroup[] = [
  {
    id: 'bereich',
    name: 'Bereich',
    multi: false,
    order: 0,
    chips: [
      { id: 'spiel', label: 'Spiel', role: 'game' },
      { id: 'umfrage', label: 'Umfrage', role: 'survey' },
      { id: 'ablauf', label: 'Testablauf', role: 'process' },
    ],
  },
  {
    id: 'art',
    name: 'Art',
    multi: false,
    order: 1,
    chips: [
      { id: 'problem', label: 'Problem', role: 'problem' },
      { id: 'positiv', label: 'Positiv', role: 'positive' },
      { id: 'ueberraschung', label: 'Überraschung', role: 'surprise' },
      { id: 'anmerkung', label: 'Anmerkung', role: 'remark' },
    ],
  },
  {
    id: 'prioritaet',
    name: 'Priorität',
    multi: false,
    order: 2,
    chips: [
      { id: 'essenziell', label: 'Essenziell', role: 'essential' },
      { id: 'offen', label: 'Offen (t.b.d.)', role: 'tbd' },
      { id: 'nice', label: 'Nice-to-have', role: 'nice' },
    ],
  },
  {
    id: 'thema',
    name: 'Thema',
    multi: true,
    order: 3,
    chips: [
      { id: 'crafting', label: 'Crafting' },
      { id: 'variante-a', label: 'Variante A' },
      { id: 'variante-b', label: 'Variante B' },
      { id: 'steuerung', label: 'Steuerung' },
      { id: 'quests', label: 'Quests & Hinweise' },
      { id: 'dialoge', label: 'Dialoge' },
      { id: 'darstellung', label: 'Darstellung' },
      { id: 'technik', label: 'Technik' },
    ],
  },
  {
    id: 'gueltigkeit',
    name: 'Gültigkeit',
    multi: false,
    order: 4,
    chips: [{ id: 'verworfen', label: 'Verworfen', role: 'rejected' }],
  },
];

// the formal names of the feedback categories (thesis wording)
export const CATEGORY = {
  essential: 'Kritische Usability-Probleme',
  positive: 'Positive Rückmeldungen',
  surprise: 'Unerwartete Beobachtungen',
  recurring: 'Wiederkehrende Befunde',
} as const;
