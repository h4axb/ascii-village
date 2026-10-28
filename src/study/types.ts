// The study dashboard's stored documents (functions/api/study.ts) and the
// game data it reads. Everything shown is derived from these (model.ts).
import type { FeedbackRecord } from '../feedback/schema';
import type { RunEvent } from '../quest/runlog';
import type { ExportInvite } from '../feedback/studyExport';

export type Design = 'A' | 'B';
// a survey column's design: A or B by name, or the 1st / 2nd run of the
// test (A or B depending on the participant's group AB / BA)
export type Side = Design | '1' | '2';

// ---- Tally ----
export type ColumnRole =
  | { role: 'ignore' }
  | { role: 'id' } // the participant id the game sent (tallyid / test_id)
  | { role: 'order' } // the design order the game sent (AB / BA)
  | { role: 'time' } // when the answer was submitted (pairs rows with participants: match.ts)
  | { role: 'p1'; question: string; values: Record<string, Side | 'neutral' | null> } // Teil 1: direct comparison
  // Teil 2; design null: a statement about both (no pair, described only)
  | { role: 'likert'; item: string; design: Side | null; values: Record<string, number | null> }
  // Teil 3: item 0–7, answers 1–7; design null: one UEQ-S for the whole game
  | { role: 'ueqs'; item: number; design: Side | null; reversed: boolean }
  | { role: 'choice'; question: string } // one answer out of several options (evaluated per option)
  // one option of a question Tally exports as a column per option ("Question (Option)" = true / false)
  | { role: 'option'; question: string; option: string }
  | { role: 'info'; label: string; numeric: boolean } // Teil 4
  | { role: 'text'; label: string }; // free text
// German versions of the survey's English texts (questions, answer options,
// free-text answers), keyed by the original text; the answers stay as given
export type TranslationMemory = Record<string, { de: string; auto: boolean }>;
export interface TallyDoc {
  file: string;
  importedAt: number;
  headers: string[];
  rows: string[][];
  mapping: ColumnRole[];
  parts?: (number | null)[]; // the first column of Teil 1–4 (the roles inside follow it)
  // the submit times as moments (UTC ms) and the zone the file was read in, as
  // of the import (the cells stay as exported; the dashboard reads them anew)
  times?: (number | null)[];
  timeZone?: 'UTC' | 'Europe/Berlin';
}

// ---- participants: corrections that apply everywhere ----
export interface PersonDoc {
  id: string; // P007
  excluded?: boolean;
  reason?: string;
  swapP1?: boolean; // mixed up A and B in Teil 1: every Tally answer A ↔ B
  // Teil 1 answers set by hand, per question (the design, not the run); null = no answer
  p1?: Record<string, 'A' | 'B' | 'neutral' | null>;
  runtime?: 'sum' | 'main'; // several links: their times added, or the main link only
  mainLink?: string; // the invite key of the main link
  tallyRow?: number | null; // the Tally row (index), null = none; undefined = matched automatically
  group?: 'AB' | 'BA'; // test group, when it differs from what was tracked
  age?: number | null; // overrides the Tally answer
  minutes?: number | null; // (older: the active time set by hand; read as timing.activeMin)
  // several links = several attempts of one participant: per link (invite key)
  // what was checked by hand; anything unset is taken from the tracking
  attempts?: Record<string, AttemptDoc>;
  timing?: TimingDoc;
}

// how a duration was found, and how exact it is
export type TimingSource = 'event_log' | 'observation' | 'estimate';
export type TimingPrecision = 'exact' | 'approximate' | 'unavailable';
export type AttemptOutcome = 'abgeschlossen' | 'unterbrochen' | 'neu gestartet' | 'technisch abgebrochen' | 'abgebrochen';
// one attempt (one test link) as corrected by hand; null = "no valid value"
export interface AttemptDoc {
  n?: number; // the attempt's number (1, 2, 3 …), when the start order is not it
  start?: number | null; // ms
  end?: number | null;
  activeMin?: number | null;
  outcome?: AttemptOutcome;
  source?: TimingSource;
  precision?: TimingPrecision;
  note?: string;
}
// the participant's times as corrected by hand (unset = from the attempts)
export interface TimingDoc {
  elapsedMin?: number | null; // first start → last end
  activeMin?: number | null; // all attempts' active play together
  interruptionMin?: number | null;
  technical?: boolean; // a technical interruption happened
  cleanMin?: number | null; // a valid uninterrupted first-time completion (null: none)
  eligible?: boolean; // used in the clean-completion statistic
  exclusionReason?: string;
  source?: TimingSource;
  precision?: TimingPrecision;
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
  questionOwn?: boolean; // the question was edited by hand (kept on re-import)
  sectionOwn?: boolean; // Beobachtung / Nachgespräch set by hand (kept on re-import, found in either section)
  text: string; // the statement as noted (the original)
  original?: string; // the wording first imported (never overwritten)
  de?: string; // the German version (AI draft or own wording)
  deAuto?: boolean; // the German version is still the unedited AI draft
  deStale?: boolean; // the original changed after the German version was made
  interpretation?: string;
  addition?: string; // remembered later ("nachträgliche Ergänzung"), kept apart from the note
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

export type ChipRole = 'game' | 'survey' | 'process' | 'problem' | 'positive' | 'surprise' | 'remark' | 'intervention' | 'essential' | 'tbd' | 'nice' | 'rejected';
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
  // the qualitative codes: what a statement is about (several per statement)
  {
    id: 'code',
    name: 'Code',
    multi: true,
    order: 4,
    chips: [
      { id: 'c-kontrolle', label: 'Kontrolle' },
      { id: 'c-erwartung', label: 'Erwartung' },
      { id: 'c-feedbackwirkung', label: 'Feedbackwirkung' },
      { id: 'c-verstaendlichkeit', label: 'Verständlichkeit' },
      { id: 'c-spielfluss', label: 'Spielfluss' },
      { id: 'c-outputqualitaet', label: 'Outputqualität' },
      { id: 'c-technik', label: 'Technische Probleme' },
      { id: 'c-positiv', label: 'Positives Erlebnis' },
    ],
  },
  // the moderator had to step in (combinable with any "Art")
  {
    id: 'moderation',
    name: 'Moderation',
    multi: false,
    order: 5,
    chips: [{ id: 'eingriff', label: 'Eingriff', role: 'intervention' }],
  },
  {
    id: 'gueltigkeit',
    name: 'Gültigkeit',
    multi: false,
    order: 6,
    chips: [{ id: 'verworfen', label: 'Verworfen', role: 'rejected' }],
  },
];

// the formal names of the feedback categories (thesis wording)
export const CATEGORY = {
  essential: 'Kritische Usability-Probleme',
  positive: 'Positive Rückmeldungen',
  surprise: 'Unerwartete Beobachtungen',
  intervention: 'Moderationseingriffe',
  recurring: 'Wiederkehrende Befunde',
} as const;
