// The project journal's records. One entry is stored once and shown on every
// page it is assigned to (its sections) and in the timeline; editing it
// anywhere edits that one record.
//
//   Sections        which pages show an entry (Decision Log, Methodology …)
//   Topics          free keywords to search and group (Crafting, Usertesting …)
//   Content blocks  the parts of an entry (Context, Method, Decision …), Markdown

export type EntryType = 'log' | 'decision' | 'method' | 'reflection' | 'design' | 'research' | 'meeting' | 'note';
export const ENTRY_TYPES: { id: EntryType; label: string }[] = [
  { id: 'log', label: 'Log' },
  { id: 'decision', label: 'Decision' },
  { id: 'method', label: 'Method' },
  { id: 'reflection', label: 'Reflection' },
  { id: 'design', label: 'Design' },
  { id: 'research', label: 'Research' },
  { id: 'meeting', label: 'Meeting / Feedback' },
  { id: 'note', label: 'Note' },
];

// the status of an entry, as the Markdown log writes it: ### [x] / [pass] / [ ]
export type EntryStatus = 'none' | 'open' | 'discussion' | 'done' | 'passed';
export const ENTRY_STATUS: { id: EntryStatus; label: string; md: string }[] = [
  { id: 'none', label: 'No status', md: '' },
  { id: 'open', label: 'Open', md: '[ ]' },
  { id: 'discussion', label: 'In discussion', md: '[?]' },
  { id: 'done', label: 'Done', md: '[x]' },
  { id: 'passed', label: 'Passed', md: '[pass]' },
];

export type Visibility = 'private' | 'shared';

export interface Block {
  id: string;
  label: string; // Context, Method, Decision, Outcome, Reflection, Notes or own
  md: string;
}
export const BLOCK_PRESETS = ['Context', 'Method / Approach', 'Decision / Action', 'Rationale', 'Outcome', 'Reflection', 'Notes'];

export interface Source {
  label: string;
  url: string;
}

export interface Entry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  dateEnd?: string | null; // a span, e.g. 20.10.–23.10.
  title: string;
  type: EntryType;
  status: EntryStatus;
  sections: string[]; // page ids (decisions, methodology …); every entry is in the Project Log
  topics: string[];
  blocks: Block[];
  sources: Source[];
  files: string[]; // file ids
  visibility: Visibility;
  created: number;
  updated: number;
}

export type MilestoneStatus = 'planned' | 'in-progress' | 'completed';
export const MILESTONE_STATUS: { id: MilestoneStatus; label: string }[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
];
export interface Milestone {
  id: string;
  name: string;
  description: string;
  start: string; // ISO date or yyyy-mm, may be empty
  end: string;
  status: MilestoneStatus;
  order: number;
  related: string[]; // entry ids
  visibility: Visibility;
}

// a deadline moved to another date: when, from, to, and why (one short sentence)
export interface DeadlineChange {
  at: number;
  from: string; // ISO
  to: string;
  reason: string;
}
export interface Deadline {
  id: string;
  label: string;
  date: string; // ISO
  dateEnd?: string | null;
  done: boolean;
  changes?: DeadlineChange[]; // oldest first
}
export const REASON_MAX = 140;

// a section of the Overview page: free Markdown text, or one of the lists
// stats: the four tiles (phase, next deadline, milestones done, days left);
// milestones: the timeline; highlights: recent decisions, method notes and the
// personal development focus (a checklist kept here)
export type OverviewKind = 'stats' | 'milestones' | 'highlights' | 'text' | 'deadlines' | 'attachments';
export interface FocusItem {
  id: string;
  text: string;
  done: boolean;
}
export interface OverviewSection {
  id: string;
  kind: OverviewKind;
  title: string;
  md: string;
  hidden: boolean;
  order: number;
  visibility: Visibility;
  files?: string[]; // attachments
  links?: Source[];
  items?: FocusItem[]; // highlights: the personal development focus
  target?: string | null; // stats: the milestone the days count down to (unset = the last one)
}

// a page's own settings: title, introduction, shown in the navigation or not
export interface PageConfig {
  id: string;
  title: string;
  description: string; // Markdown
  hidden: boolean;
  order: number;
}

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  created: number;
}

export interface JournalDocs {
  entries: Record<string, Entry>;
  milestones: Record<string, Milestone>;
  deadlines: Record<string, Deadline>;
  pages: Record<string, PageConfig>;
  overview: Record<string, OverviewSection>;
  settings: Record<string, unknown>;
  files: Record<string, FileMeta>;
}
export type Coll = Exclude<keyof JournalDocs, 'files'>;

// the pages, in the order of /journal's navigation; "log" lists every entry
export const PAGES: { id: string; path: string; title: string; description: string; section: boolean }[] = [
  { id: 'overview', path: '', title: 'Overview', description: '', section: false },
  { id: 'timeline', path: 'timeline', title: 'Timeline', description: 'Every entry and milestone in the order it happened.', section: false },
  { id: 'log', path: 'log', title: 'Project Log', description: 'All documentation, activities and developments.', section: false },
  { id: 'decisions', path: 'decisions', title: 'Decision Log', description: 'Design and project decisions, with their context and reasons.', section: true },
  { id: 'methodology', path: 'methodology', title: 'Methods & Methodology', description: 'How the project is researched, tested and evaluated.', section: true },
  { id: 'personal', path: 'personal', title: 'Personal Development', description: 'What I learned and how my way of working changed.', section: true },
  { id: 'design', path: 'design', title: 'Design Process', description: 'Iterations, explorations and design work.', section: true },
  { id: 'research', path: 'research', title: 'Research & Findings', description: 'Sources, user test findings and results.', section: true },
];
export const SECTIONS = PAGES.filter((p) => p.section);

export const DEFAULT_OVERVIEW: OverviewSection[] = [
  { id: 'stats', kind: 'stats', title: 'At a glance', md: '', hidden: false, order: 0, visibility: 'private' },
  { id: 'milestones', kind: 'milestones', title: 'Milestone Timeline', md: '', hidden: false, order: 1, visibility: 'private' },
  { id: 'highlights', kind: 'highlights', title: 'Decisions, methods & focus', md: '', hidden: false, order: 2, visibility: 'private', items: [] },
  { id: 'description', kind: 'text', title: 'Project description', md: '**ASCIIA BAY**\n\nA cozy web-based game exploring UI/UX design for generative crafting interactions.', hidden: false, order: 3, visibility: 'private' },
  { id: 'deadlines', kind: 'deadlines', title: 'Deadlines', md: '', hidden: false, order: 4, visibility: 'private' },
  { id: 'objectives', kind: 'text', title: 'Objectives', md: '', hidden: false, order: 5, visibility: 'private' },
  { id: 'questions', kind: 'text', title: 'Research questions', md: '', hidden: false, order: 6, visibility: 'private' },
  { id: 'phase', kind: 'text', title: 'Current phase', md: '', hidden: true, order: 7, visibility: 'private' },
  { id: 'notes', kind: 'text', title: 'Notes', md: '', hidden: false, order: 8, visibility: 'private' },
  { id: 'attachments', kind: 'attachments', title: 'Attachments & links', md: '', hidden: false, order: 9, visibility: 'private', files: [], links: [] },
];
// added once to an Overview made before the dashboard layout: the tiles, the
// timeline and the three cards come first; everything else keeps its order
export const OVERVIEW_V2 = DEFAULT_OVERVIEW.filter((s) => s.kind === 'stats' || s.kind === 'highlights');

// first visit only: the example milestones from the brief (all editable)
export const DEFAULT_MILESTONES: Milestone[] = [
  { id: 'm-usertesting', name: 'Usertesting', description: '', start: '2026-10', end: '', status: 'completed', order: 0, related: [], visibility: 'private' },
  { id: 'm-evaluation', name: 'Evaluation & redesign', description: '', start: '2026-11', end: '', status: 'in-progress', order: 1, related: [], visibility: 'private' },
  { id: 'm-submission', name: 'Bachelor submission', description: '', start: '2027-01', end: '', status: 'planned', order: 2, related: [], visibility: 'private' },
];

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// dates as the log writes them: 02.11.2026 / 02.11.26 / "November 2026"
export function fmtDate(iso: string | null | undefined, end?: string | null): string {
  if (!iso) return '';
  const one = (d: string) => {
    if (/^\d{4}-\d{2}$/.test(d)) return new Date(`${d}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const [y, m, dd] = d.split('-');
    return dd ? `${dd}.${m}.${y}` : d;
  };
  return end && end !== iso ? `${one(iso)} – ${one(end)}` : one(iso);
}
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
