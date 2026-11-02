// A coding file (JSON) with tags per statement, read for the review window
// (TagReview): nothing is stored until it is confirmed there. Reads the
// export layout with aussagen[].codierung (from Fassung 4) and the older one
// with teilnehmende.{P…}[].tags. Only statements whose tags differ from the
// dashboard's, or that are marked for review, become proposals; tag ids the
// dashboard does not know are left out and reported.
import type { ItemDoc, TagGroup } from './types';
import { findingsOf } from './model';
import type { TagProposal } from './AiReview';

export interface CodingNote {
  review: boolean; // "Prüfung erforderlich"
  reason: string | null;
}
export interface CodingImport {
  proposals: TagProposal[];
  notes: Record<string, CodingNote>;
  unknownStatements: string[];
  unknownTags: string[];
  unchanged: number;
  version: string | null;
}

interface Entry {
  statement_id?: unknown;
  tags?: unknown;
  pruefstatus?: unknown;
  pruefgrund?: unknown;
  codierung?: { tags?: unknown; pruefstatus?: unknown; pruefgrund?: unknown };
}

const asTags = (v: unknown): string[] =>
  v && typeof v === 'object' ? Object.values(v as Record<string, unknown>).flatMap((x) => (Array.isArray(x) ? x.filter((c): c is string => typeof c === 'string') : [])) : [];

export function readCoding(text: string, items: Record<string, ItemDoc>, tags: TagGroup[]): CodingImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  const d = data as { aussagen?: unknown; teilnehmende?: unknown; meta?: { fassung?: unknown } };
  const entries: Entry[] = Array.isArray(d.aussagen)
    ? (d.aussagen as Entry[])
    : d.teilnehmende && typeof d.teilnehmende === 'object'
      ? Object.values(d.teilnehmende as Record<string, unknown>).flatMap((l) => (Array.isArray(l) ? (l as Entry[]) : []))
      : [];
  if (!entries.length) throw new Error('Keine Aussagen gefunden: erwartet wird „aussagen“ (mit „codierung“) oder „teilnehmende“.');

  const known = new Set(tags.flatMap((g) => g.chips.map((c) => c.id)));
  const out: CodingImport = { proposals: [], notes: {}, unknownStatements: [], unknownTags: [], unchanged: 0, version: d.meta?.fassung != null ? String(d.meta.fassung) : null };
  const unknownTags = new Set<string>();
  for (const e of entries) {
    const id = typeof e.statement_id === 'string' ? e.statement_id : '';
    const item = items[id];
    if (!item) {
      if (id) out.unknownStatements.push(id);
      continue;
    }
    const raw = asTags(e.codierung?.tags ?? e.tags);
    raw.filter((c) => !known.has(c)).forEach((c) => unknownTags.add(c));
    const chips = [...new Set(raw.filter((c) => known.has(c)))];
    const status = String(e.codierung?.pruefstatus ?? e.pruefstatus ?? '');
    const reason = e.codierung?.pruefgrund ?? e.pruefgrund;
    const note: CodingNote = { review: /prüfung/i.test(status), reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null };
    const same = chips.length === item.chips.length && chips.every((c) => item.chips.includes(c));
    if (same && !note.review) {
      out.unchanged++;
      continue;
    }
    out.proposals.push({ id, chips, findings: findingsOf(item), newFinding: null });
    out.notes[id] = note;
  }
  out.unknownTags = [...unknownTags];
  return out;
}
