// The journal's pages besides the Overview. Every list shows the same entry
// records: the Project Log all of them, a section page those assigned to it,
// the Timeline all of them by date. A page's own title and introduction are
// edited here without touching any entry.
import { useMemo, useState } from 'react';
import { plainText } from './markdown';
import { readLog, writeLog, type LogImport } from './logImport';
import type { JournalStore, Put } from './store';
import { suggestSections, suggestTopics } from './suggest';
import { ENTRY_STATUS, ENTRY_TYPES, PAGES, SECTIONS, fmtDate, type Entry, type PageConfig } from './types';
import { allTopics, EntryMeta, sectionTitle } from './EntryEditor';
import { Chips, Icon, InlineText, MdField, Modal } from './ui';

export function pageConfig(store: JournalStore, id: string): PageConfig {
  const def = PAGES.find((p) => p.id === id);
  const i = PAGES.findIndex((p) => p.id === id);
  const base: PageConfig = { id, title: def?.title ?? id, description: def?.description ?? '', hidden: false, order: i };
  return { ...base, ...(store.docs.pages[id] as Partial<PageConfig> | undefined) };
}

export function PageHead({ store, id, fallbackTitle, fallbackDescription, actions }: { store: JournalStore; id: string; fallbackTitle?: string; fallbackDescription?: string; actions?: React.ReactNode }) {
  const c = pageConfig(store, id);
  const title = store.docs.pages[id]?.title ?? fallbackTitle ?? c.title;
  const description = store.docs.pages[id]?.description ?? fallbackDescription ?? c.description;
  const save = (p: Partial<PageConfig>) => void store.commit([{ coll: 'pages', id, data: { ...c, title, description, ...p } }]);
  return (
    <header className="jr-pagehead">
      <div className="jr-pagehead-row">
        <InlineText as="h1" value={title} label="Page title" onSave={(v) => save({ title: v || title })} />
        {actions && <span className="jr-pagehead-actions">{actions}</span>}
      </div>
      <MdField md={description} label="Introduction" rows={2} placeholder="No introduction." onSave={(v) => save({ description: v })} />
    </header>
  );
}

interface Filter {
  q: string;
  type: string;
  status: string;
  topic: string;
  section: string;
  sort: 'new' | 'old';
}
const NO_FILTER: Filter = { q: '', type: '', status: '', topic: '', section: '', sort: 'new' };

export function EntryList({ store, page, openEntry, newEntry }: { store: JournalStore; page: string; openEntry: (id: string) => void; newEntry: (section?: string) => void }) {
  const [f, setF] = useState<Filter>(NO_FILTER);
  const [importing, setImporting] = useState<{ name: string; data: LogImport } | null>(null);
  const isSection = SECTIONS.some((s) => s.id === page);
  const all = Object.values(store.docs.entries);
  const list = all
    .filter((e) => !isSection || e.sections.includes(page))
    .filter((e) => (!f.type || e.type === f.type) && (!f.status || e.status === f.status) && (!f.topic || e.topics.includes(f.topic)) && (!f.section || e.sections.includes(f.section)))
    .filter((e) => !f.q.trim() || `${e.title} ${e.topics.join(' ')} ${e.blocks.map((b) => b.md).join(' ')}`.toLowerCase().includes(f.q.trim().toLowerCase()))
    .sort((a, b) => (f.sort === 'new' ? -1 : 1) * ((a.date || '0').localeCompare(b.date || '0') || a.created - b.created));
  const topics = allTopics(store);
  const active = JSON.stringify({ ...f, sort: 'new' }) !== JSON.stringify(NO_FILTER);
  const exportMd = () => {
    const md = writeLog(isSection ? all.filter((e) => e.sections.includes(page)) : all, isSection ? [] : Object.values(store.docs.deadlines), (id) => sectionTitle(store, id));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${page === 'log' ? 'project-log' : page}.md`;
    a.click();
  };
  return (
    <>
      <PageHead
        store={store}
        id={page}
        actions={
          <>
            {page === 'log' && (
              <label className="jr-btn">
                Import Markdown
                <input
                  type="file"
                  accept=".md,.markdown,.txt,text/markdown,text/plain"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) setImporting({ name: file.name, data: readLog(await file.text()) });
                  }}
                />
              </label>
            )}
            <button type="button" onClick={exportMd} disabled={!list.length && page !== 'log'}>
              Export Markdown
            </button>
            <button type="button" className="is-primary" onClick={() => newEntry(isSection ? page : undefined)}>
              <Icon name="plus" /> New entry
            </button>
          </>
        }
      />
      <div className="jr-filters" role="search">
        <input type="search" value={f.q} placeholder="Search title, topics and text" aria-label="Search" onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.type} aria-label="Entry type" onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">All types</option>
          {ENTRY_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={f.status} aria-label="Status" onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Any status</option>
          {ENTRY_STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {topics.length > 0 && (
          <select value={f.topic} aria-label="Topic" onChange={(e) => setF({ ...f, topic: e.target.value })}>
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        )}
        {!isSection && (
          <select value={f.section} aria-label="Section" onChange={(e) => setF({ ...f, section: e.target.value })}>
            <option value="">All sections</option>
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {sectionTitle(store, s.id)}
              </option>
            ))}
          </select>
        )}
        <select value={f.sort} aria-label="Order" onChange={(e) => setF({ ...f, sort: e.target.value as Filter['sort'] })}>
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
        </select>
        {active && (
          <button type="button" className="jr-linkbtn" onClick={() => setF(NO_FILTER)}>
            Reset
          </button>
        )}
      </div>
      <p className="jr-muted jr-small jr-count">{`${list.length} ${list.length === 1 ? 'entry' : 'entries'}${active ? ' (filtered)' : ''}`}</p>
      {list.length ? (
        <ul className="jr-entries">
          {list.map((e) => (
            <li key={e.id}>
              <EntryCard store={store} e={e} onOpen={() => openEntry(e.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="jr-empty">
          <p>{active ? 'No entry matches the filters.' : isSection ? 'No entry is assigned to this page yet. Choose it under “Sections” in an entry.' : 'No entries yet.'}</p>
          {!active && (
            <button type="button" className="is-primary" onClick={() => newEntry(isSection ? page : undefined)}>
              <Icon name="plus" /> New entry
            </button>
          )}
        </div>
      )}
      {importing && <ImportDialog store={store} name={importing.name} data={importing.data} onClose={() => setImporting(null)} />}
    </>
  );
}

export function EntryCard({ store, e, onOpen }: { store: JournalStore; e: Entry; onOpen: () => void }) {
  const first = plainText(e.blocks.map((b) => b.md).join('\n'));
  return (
    <button type="button" className="jr-entry" onClick={onOpen}>
      <span className="jr-entry-title">
        {e.status !== 'none' && <span className={`jr-box is-${e.status === 'passed' ? 'pass' : e.status}`} aria-hidden="true" />}
        {e.title}
      </span>
      <EntryMeta store={store} e={e} />
      {first && <span className="jr-entry-text">{first.length > 220 ? `${first.slice(0, 220)} …` : first}</span>}
    </button>
  );
}

export function Timeline({ store, openEntry }: { store: JournalStore; openEntry: (id: string) => void }) {
  const items = useMemo(() => {
    const es = Object.values(store.docs.entries).map((e) => ({ key: e.id, date: e.date, kind: 'entry' as const, e }));
    const ms = Object.values(store.docs.milestones)
      .filter((m) => m.start)
      .map((m) => ({ key: m.id, date: m.start.length === 7 ? `${m.start}-01` : m.start, kind: 'milestone' as const, m }));
    return [...es, ...ms].sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
  }, [store.docs.entries, store.docs.milestones]);
  const groups: { label: string; items: typeof items }[] = [];
  for (const it of items) {
    const label = it.date ? new Date(`${it.date.slice(0, 7)}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Without date';
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return (
    <>
      <PageHead store={store} id="timeline" />
      {groups.length ? (
        groups.map((g) => (
          <section key={g.label} className="jr-tl">
            <h2 className="jr-tl-month">{g.label}</h2>
            <ol>
              {g.items.map((it) =>
                it.kind === 'entry' ? (
                  <li key={it.key} className="jr-tl-item">
                    <EntryCard store={store} e={it.e} onOpen={() => openEntry(it.e.id)} />
                  </li>
                ) : (
                  <li key={it.key} className={`jr-tl-item is-milestone is-${it.m.status}`}>
                    <span className="jr-ms-dot" aria-hidden="true" />
                    <span>
                      <strong>{it.m.name}</strong>
                      <span className="jr-muted">{` · milestone · ${fmtDate(it.m.start, it.m.end)}`}</span>
                    </span>
                  </li>
                ),
              )}
            </ol>
          </section>
        ))
      ) : (
        <p className="jr-empty">Nothing yet. Entries appear here by their date.</p>
      )}
    </>
  );
}

// the Markdown log read into entries: shown first, sections/topics suggested
// (preselected, every one can be removed), then stored in one go
function ImportDialog({ store, name, data, onClose }: { store: JournalStore; name: string; data: LogImport; onClose: () => void }) {
  const known = allTopics(store);
  const existing = new Set(Object.values(store.docs.entries).map((e) => `${e.date}|${e.title.toLowerCase()}`));
  // (an entry already in the journal starts unticked)
  const [rows, setRows] = useState(() =>
    data.entries.map((e) => ({ take: !existing.has(`${e.date}|${e.title.toLowerCase()}`), e: { ...e, sections: suggestSections(e), topics: suggestTopics(e, known) } })),
  );
  const [takeDeadlines, setTakeDeadlines] = useState(() => !Object.keys(store.docs.deadlines).length);
  const set = (i: number, e: Entry) => setRows((r) => r.map((x, j) => (j === i ? { ...x, e } : x)));
  const taken = rows.filter((r) => r.take);
  const apply = async () => {
    const put: Put[] = [...taken.map((r) => ({ coll: 'entries' as const, id: r.e.id, data: r.e })), ...(takeDeadlines ? data.deadlines.map((d) => ({ coll: 'deadlines' as const, id: d.id, data: d })) : [])];
    await store.commit(put);
    onClose();
  };
  return (
    <Modal
      title={`Import ${name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="jr-muted jr-small">{`${taken.length} of ${rows.length} entries${takeDeadlines && data.deadlines.length ? ` · ${data.deadlines.length} deadlines` : ''}`}</span>
          <span className="jr-spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="is-primary" disabled={!taken.length && !(takeDeadlines && data.deadlines.length)} onClick={() => void apply()}>
            Import
          </button>
        </>
      }
    >
      <p className="jr-muted">Read from the Markdown: “### [x] / [pass] / [ ] Title (date)” as entries, “## Next Deadline:” and struck-through lines as deadlines. Sections and topics are suggested from the text – remove or add any before importing. Nothing is stored until “Import”.</p>
      {data.deadlines.length > 0 && (
        <label className="jr-check">
          <input type="checkbox" checked={takeDeadlines} onChange={(e) => setTakeDeadlines(e.target.checked)} />
          {`Deadlines: ${data.deadlines.map((d) => `${d.done ? '✓ ' : ''}${d.label}${d.date ? ` (${fmtDate(d.date, d.dateEnd)})` : ''}`).join(' · ')}`}
        </label>
      )}
      <ul className="jr-import">
        {rows.map((r, i) => {
          const dup = existing.has(`${r.e.date}|${r.e.title.toLowerCase()}`);
          return (
            <li key={r.e.id} className={r.take ? '' : 'is-off'}>
              <label className="jr-check">
                <input type="checkbox" checked={r.take} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, take: e.target.checked } : y)))} />
                <strong>{r.e.title}</strong>
                <span className="jr-muted">{[r.e.date ? fmtDate(r.e.date, r.e.dateEnd) : 'no date', ENTRY_STATUS.find((s) => s.id === r.e.status)?.label, `${r.e.blocks[0]?.md.split('\n').length ?? 0} lines`].join(' · ')}</span>
                {dup && <span className="jr-warn">already in the journal</span>}
              </label>
              <Chips all={SECTIONS.map((s) => ({ id: s.id, label: sectionTitle(store, s.id) }))} chosen={r.e.sections} label="Sections" onToggle={(id) => set(i, { ...r.e, sections: r.e.sections.includes(id) ? r.e.sections.filter((x) => x !== id) : [...r.e.sections, id] })} />
              <div className="jr-chips">
                {r.e.topics.map((t) => (
                  <span key={t} className="jr-chip is-on">
                    #{t}
                    <button type="button" className="jr-chip-x" aria-label={`Remove topic ${t}`} onClick={() => set(i, { ...r.e, topics: r.e.topics.filter((x) => x !== t) })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
