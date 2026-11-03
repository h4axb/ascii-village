// The Markdown log as it is kept by hand, read into journal records and
// written back the same way:
//
//   ## Next Deadline: Feedback auswerten 03.11.26      → an open deadline
//   ~~Feedback auswerten 29.10.26~~                     → a deadline that is done
//   ~~Playtesting!! 20.10.-23.10.26~~                   → … with a span
//   ~~Feedback auswerten 29.10.26~~ – reason            → with the title of an open one: an
//                                                         earlier date of it, moved for that reason
//   ### [x] Bachelorantrag & Exposé                     → an entry, done
//   ### [pass] Character customization (21.09.26)       → passed, dated
//   ### [ ] … / ### [?] … / ### Title                   → open / in discussion / no status
//   (everything up to the next ### or ## heading)       → the entry's Markdown
//
// Only proposals: the journal shows them before anything is stored.
import { BLOCK_KINDS, ENTRY_STATUS, blockKindOf, blockTitle, fmtMinutes, newId, taskMinutes, type Deadline, type DeadlineChange, type Entry, type EntryStatus } from './types';

const yearOf = (y: string | undefined, fallback: number) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : fallback);
const iso = (d: string, m: string, y: number) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

// "21.09.26", "20.10.-23.10.26", "3.11.2026" → ISO date(s); the rest of the text
export function datesIn(text: string, year = new Date().getFullYear()): { date: string | null; dateEnd: string | null; rest: string } {
  const span = /\(?\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\)?/.exec(text);
  if (span) {
    const y2 = yearOf(span[6], yearOf(span[3], year));
    const y1 = yearOf(span[3], y2);
    return { date: iso(span[1], span[2], y1), dateEnd: iso(span[4], span[5], y2), rest: tidy(text.replace(span[0], '')) };
  }
  const one = /\(?\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\)?(?!\d)/.exec(text);
  if (one) return { date: iso(one[1], one[2], yearOf(one[3], year)), dateEnd: null, rest: tidy(text.replace(one[0], '')) };
  return { date: null, dateEnd: null, rest: tidy(text) };
}
const tidy = (s: string) => s.replace(/\(\s*\)/g, '').replace(/\s+:/g, ':').replace(/\s*[:–-]\s*$/, '').replace(/\s{2,}/g, ' ').trim();

const STATUS: Record<string, EntryStatus> = { x: 'done', X: 'done', ' ': 'open', '': 'open', pass: 'passed', '?': 'discussion' };

export interface LogImport {
  entries: Entry[];
  deadlines: Deadline[];
}

export function readLog(md: string, year = new Date().getFullYear()): LogImport {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const entries: Entry[] = [];
  const deadlines: Deadline[] = [];
  let cur: { head: string; body: string[] } | null = null;
  const now = Date.now();
  const flush = () => {
    if (!cur) return;
    const m = /^\[(x|X| |pass|\?|)\]\s*(.*)$/.exec(cur.head);
    const status: EntryStatus = m ? STATUS[m[1]] : 'none';
    const { date, dateEnd, rest } = datesIn(m ? m[2] : cur.head, year);
    const body = cur.body.join('\n').replace(/^\n+|\n+$/g, '');
    entries.push({
      id: newId('e'),
      date: date ?? '',
      dateEnd,
      title: rest || '(untitled)',
      type: 'log',
      status,
      sections: [],
      topics: [],
      blocks: body ? [{ id: newId('b'), label: 'Notes', md: body }] : [],
      sources: [],
      files: [],
      visibility: 'private',
      created: now,
      updated: now,
    });
    cur = null;
  };
  for (const line of lines) {
    const dl = /^##\s+Next\s+Deadline\s*:\s*(.+)$/i.exec(line);
    if (dl) {
      flush();
      const { date, dateEnd, rest } = datesIn(dl[1], year);
      deadlines.push({ id: newId('d'), label: rest, date: date ?? '', dateEnd, done: false });
      continue;
    }
    const struck = /^\s*~~(.+?)~~\s*(?:[–—-]\s*(.*))?$/.exec(line);
    if (struck && !cur) {
      const { date, dateEnd, rest } = datesIn(struck[1], year);
      deadlines.push({ id: newId('d'), label: rest, date: date ?? '', dateEnd, done: true, ...(struck[2]?.trim() ? { note: struck[2].trim() } : {}) } as Deadline & { note?: string });
      continue;
    }
    const h = /^###\s+(.*)$/.exec(line);
    if (h) {
      flush();
      cur = { head: h[1].trim(), body: [] };
      continue;
    }
    if (/^##\s/.test(line)) {
      // another level-2 heading ends the entry above
      flush();
      continue;
    }
    if (cur) cur.body.push(line);
  }
  flush();
  return { entries, deadlines: mergeMoves(deadlines) };
}

// struck-through dates with the title of a deadline that is still open are
// that deadline's earlier dates: kept as its changes (oldest first)
function mergeMoves(list: (Deadline & { note?: string })[]): Deadline[] {
  const key = (d: Deadline) => d.label.trim().toLowerCase();
  const out: Deadline[] = [];
  const used = new Set<Deadline>();
  for (const open of list.filter((d) => !d.done)) {
    const old = list.filter((d) => d.done && d.date && key(d) === key(open)).sort((a, b) => a.date.localeCompare(b.date));
    old.forEach((d) => used.add(d));
    const dates = [...old.map((d) => d.date), open.date];
    const changes: DeadlineChange[] = old.map((d, i) => ({ at: Date.now(), from: d.date, to: dates[i + 1], reason: d.note ?? '' }));
    out.push({ id: open.id, label: open.label, date: open.date, dateEnd: open.dateEnd, done: false, ...(changes.length ? { changes } : {}) });
  }
  for (const d of list) if (d.done && !used.has(d)) out.push({ id: d.id, label: d.label, date: d.date, dateEnd: d.dateEnd, done: true });
  return out;
}

// ---- back to Markdown, in the same layout ----
const short = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : '');
const shortSpan = (a: string, b?: string | null) => (b && b !== a ? `${a.slice(8, 10)}.${a.slice(5, 7)}.-${short(b)}` : short(a));

export function writeLog(entries: Entry[], deadlines: Deadline[], sectionTitle: (id: string) => string): string {
  const out: string[] = [];
  const open = deadlines.filter((d) => !d.done).sort((a, b) => a.date.localeCompare(b.date));
  const done = deadlines.filter((d) => d.done).sort((a, b) => b.date.localeCompare(a.date));
  // a deadline's earlier dates follow it, struck through, with the reason it moved
  const moves = (d: Deadline) => [...(d.changes ?? [])].reverse().map((c) => `~~${d.label} ${short(c.from)}~~${c.reason ? ` – ${c.reason}` : ''}`);
  if (open[0]) out.push(`## Next Deadline: ${open[0].label} ${shortSpan(open[0].date, open[0].dateEnd)}`.trim(), ...moves(open[0]));
  for (const d of open.slice(1)) out.push(`Deadline: ${d.label} ${shortSpan(d.date, d.dateEnd)}`.trim(), ...moves(d));
  for (const d of done) out.push(`~~${d.label} ${shortSpan(d.date, d.dateEnd)}~~`.replace(' ~~', '~~'), ...moves(d));
  if (out.length) out.push('');
  for (const e of [...entries].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'))) {
    const mark = ENTRY_STATUS.find((s) => s.id === e.status)?.md;
    const date = e.date ? ` (${shortSpan(e.date, e.dateEnd)})` : '';
    out.push(`### ${mark ? `${mark} ` : ''}${e.title}${date}`);
    const meta = [e.sections.length ? `Sections: ${e.sections.map(sectionTitle).join(', ')}` : '', e.topics.length ? `Topics: ${e.topics.join(', ')}` : ''].filter(Boolean);
    if (meta.length) out.push(`_${meta.join(' · ')}_`);
    for (const b of e.blocks) {
      if (e.blocks.length > 1 || b.label !== 'Notes') out.push('', `**${b.label}**`);
      out.push(b.md);
    }
    for (const s of e.sources) out.push(`- [${s.label || s.url}](${s.url})`);
    // each task with its time, sections, tags and documentation
    for (const t of e.tasks ?? []) {
      const m = taskMinutes(t);
      const time = [t.start || t.end ? `${t.start || '?'}–${t.end || '?'}` : '', m != null ? fmtMinutes(m) : ''].filter(Boolean).join(', ');
      out.push('', `**Task: ${t.title || 'Untitled'}**${time ? ` (${time})` : ''}`);
      const tm = [(t.sections ?? []).length ? `Sections: ${(t.sections ?? []).map(sectionTitle).join(', ')}` : '', (t.topics ?? []).length ? `Topics: ${(t.topics ?? []).join(', ')}` : ''].filter(Boolean);
      if (tm.length) out.push(`_${tm.join(' · ')}_`);
      for (const b of t.blocks ?? []) {
        const k = BLOCK_KINDS.find((x) => x.id === blockKindOf(b))?.label ?? 'Notes';
        out.push('', `*${k}${blockTitle(b) ? `: ${blockTitle(b)}` : ''}*`, b.md);
      }
      for (const s of t.sources ?? []) out.push(`- [${s.label || s.url}](${s.url})`);
    }
    out.push('', '');
  }
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n');
}
