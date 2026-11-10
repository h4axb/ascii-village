// The Project Log and the section pages: a table (search, filters,
// newest/oldest, pages of 10, a list or a grid). The Project Log lists the days'
// entries; a section page lists the tasks assigned to it (and older entries
// assigned as a whole), so a day with five tasks shows only the one that
// belongs here. A row opens the entry in the overlay, at that task.
import { useEffect, useMemo, useState } from 'react';
import { readLog, writeLog, type LogImport } from './logImport';
import type { JournalStore, Put } from './store';
import { ENTRY_STATUS, ENTRY_TYPES, SECTIONS, blockKinds, fmtDate, itemSections, itemText, itemTopics, sectionBlockTitle, sectionItems, type Entry, type LogItem } from './types';
import { allTopics, sectionTitle } from './EntryEditor';
import { taskTime } from './EntryForm';
import { EntryCard, ImportDialog, PageHead, TaskCard } from './pages';
import { Icon, IconBtn } from './ui';
import { MatchDialog, SyncButton } from './zotero';

const PAGE = 10;

interface Filter {
  q: string;
  section: string;
  type: string;
  status: string;
  topic: string;
  sort: 'new' | 'old';
}
const NO_FILTER: Filter = { q: '', section: '', type: '', status: '', topic: '', sort: 'new' };

// a section's short name for the table (an own title as it is)
const SHORT: Record<string, string> = { decisions: 'Decisions', methodology: 'Methods', personal: 'Personal', design: 'Design', research: 'Research' };
const shortSection = (store: JournalStore, id: string) => {
  const own = store.docs.pages[id]?.title;
  const def = SECTIONS.find((x) => x.id === id)?.title;
  return own && own !== def ? own : SHORT[id] ?? sectionTitle(store, id);
};

export function LogList({ store, page, selected, selectedTask, openEntry, newEntry }: { store: JournalStore; page: string; selected: string | null; selectedTask: string | null; openEntry: (id: string, task?: string) => void; newEntry: (section?: string) => void }) {
  const [f, setF] = useState<Filter>(NO_FILTER);
  const [showFilters, setShowFilters] = useState(true);
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('jr-log-view') === 'grid' ? 'grid' : 'list'));
  const [n, setN] = useState(0); // the page of the table
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [matching, setMatching] = useState(false);
  // the Zotero sync: on the Project Log and on Research & Findings
  const zoteroHere = page === 'log' || page === 'research';
  const [importing, setImporting] = useState<{ name: string; data: LogImport } | null>(null);
  const isSection = SECTIONS.some((s) => s.id === page);
  const kinds = blockKinds(store.docs.settings);
  const all = Object.values(store.docs.entries);
  const list = useMemo(
    () =>
      (isSection ? sectionItems(all, page) : all.map((e): LogItem => ({ key: e.id, e })))
        .filter((i) => (!f.section || itemSections(i).includes(f.section)) && (!f.type || i.e.type === f.type) && (!f.status || i.e.status === f.status) && (!f.topic || itemTopics(i).includes(f.topic)))
        .filter((i) => !f.q.trim() || itemText(i).toLowerCase().includes(f.q.trim().toLowerCase()))
        .sort((a, b) => (f.sort === 'new' ? -1 : 1) * ((a.e.date || '0').localeCompare(b.e.date || '0') || a.e.created - b.e.created || (a.t?.start ?? '').localeCompare(b.t?.start ?? ''))),
    [all, f, isSection, page],
  );
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(n, pages - 1);
  const shown = list.slice(cur * PAGE, cur * PAGE + PAGE);
  const set = (p: Partial<Filter>) => {
    setF((x) => ({ ...x, ...p }));
    setN(0);
  };
  useEffect(() => {
    try {
      localStorage.setItem('jr-log-view', view);
    } catch {
      /* per viewer only */
    }
  }, [view]);
  // the chosen entry's page is the one shown
  useEffect(() => {
    if (!selected) return;
    const i = list.findIndex((x) => x.e.id === selected && (!selectedTask || !x.t || x.t.id === selectedTask));
    if (i >= 0 && Math.floor(i / PAGE) !== cur) setN(Math.floor(i / PAGE));
  }, [selected]);
  const active = JSON.stringify({ ...f, sort: 'new' }) !== JSON.stringify(NO_FILTER);
  const topics = allTopics(store);
  const isSel = (i: LogItem) => i.e.id === selected && (!i.t || !selectedTask || i.t.id === selectedTask);
  const open = (i: LogItem) => openEntry(i.e.id, i.t?.id);
  const exportMd = () => {
    setMenu(false);
    const md = writeLog(isSection ? [...new Set(sectionItems(all, page).map((i) => i.e))] : all, isSection ? [] : Object.values(store.docs.deadlines), (id) => sectionTitle(store, id), blockKinds(store.docs.settings), store.docs.zotero);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${page === 'log' ? 'project-log' : page}.md`;
    a.click();
  };
  const chosen = list.filter((i) => checked.has(i.key));
  // a selected task changes on its own; a selected day changes in all its tasks
  // (or, for an older entry without tasks, as a whole)
  const bulkSections = (section: string, add: boolean) => {
    const out = new Map<string, Entry>();
    const ed = (e: Entry) => out.get(e.id) ?? e;
    const apply = (xs: string[] | undefined) => (add ? [...new Set([...(xs ?? []), section])] : (xs ?? []).filter((x) => x !== section));
    for (const i of chosen) {
      const e = ed(i.e);
      const tasks = e.tasks ?? [];
      if (i.t) out.set(e.id, { ...e, tasks: tasks.map((t) => (t.id === i.t!.id ? { ...t, sections: apply(t.sections) } : t)) });
      else if (tasks.length) out.set(e.id, { ...e, sections: add ? e.sections : apply(e.sections), tasks: tasks.map((t) => ({ ...t, sections: apply(t.sections) })) });
      else out.set(e.id, { ...e, sections: apply(e.sections) });
    }
    void store.commit([...out.values()].map((e): Put => ({ coll: 'entries', id: e.id, data: { ...e, updated: Date.now() } })));
    setChecked(new Set());
  };
  const bulkDelete = () => {
    const days = chosen.filter((i) => !i.t);
    const tasks = chosen.filter((i) => i.t && !days.some((d) => d.e.id === i.e.id));
    const what = [days.length ? `${days.length} ${days.length === 1 ? 'entry' : 'entries'} with all their tasks` : '', tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : ''].filter(Boolean).join(' and ');
    if (!confirm(`Delete ${what}? They disappear from every page (earlier states stay in the edit history).`)) return;
    const put = new Map<string, Entry>();
    for (const i of tasks) {
      const e = put.get(i.e.id) ?? i.e;
      put.set(e.id, { ...e, tasks: (e.tasks ?? []).filter((t) => t.id !== i.t!.id), updated: Date.now() });
    }
    void store.commit(
      [...put.values()].map((e): Put => ({ coll: 'entries', id: e.id, data: e })),
      days.map((d) => ({ coll: 'entries' as const, id: d.e.id })),
    );
    setChecked(new Set());
  };

  return (
    <div className="jr-log">
        <PageHead
          store={store}
          id={page}
          actions={
            <>
              <label className="jr-search">
                <Icon name="search" />
                <input type="search" value={f.q} placeholder="Search entries…" aria-label="Search entries" onChange={(e) => set({ q: e.target.value })} />
              </label>
              <button type="button" className={`jr-iconbtn is-boxed${showFilters ? ' is-on' : ''}`} aria-pressed={showFilters} aria-label="Filters" title="Filters" onClick={() => setShowFilters(!showFilters)}>
                <Icon name="filter" />
              </button>
              <span className="jr-seg" role="group" aria-label="View">
                <button type="button" className={view === 'list' ? 'is-on' : ''} aria-pressed={view === 'list'} aria-label="List" title="List" onClick={() => setView('list')}>
                  <Icon name="list" />
                </button>
                <button type="button" className={view === 'grid' ? 'is-on' : ''} aria-pressed={view === 'grid'} aria-label="Grid" title="Grid" onClick={() => setView('grid')}>
                  <Icon name="grid" />
                </button>
              </span>
              {zoteroHere && <SyncButton store={store} />}
              <button type="button" className="is-primary" onClick={() => newEntry(isSection ? page : undefined)}>
                <Icon name="plus" /> New Entry
              </button>
              <span className="jr-menuwrap">
                <IconBtn icon="more" label="More" onClick={() => setMenu(!menu)} />
                {menu && (
                  <span className="jr-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                    {page === 'log' && (
                      <label className="jr-menu-item" role="menuitem">
                        Import Markdown …
                        <input
                          type="file"
                          accept=".md,.markdown,.txt,text/markdown,text/plain"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            setMenu(false);
                            if (file) setImporting({ name: file.name, data: readLog(await file.text()) });
                          }}
                        />
                      </label>
                    )}
                    <button type="button" className="jr-menu-item" role="menuitem" onClick={exportMd} disabled={!list.length && page !== 'log'}>
                      Export Markdown
                    </button>
                    {zoteroHere && (
                      <>
                        <button
                          type="button"
                          className="jr-menu-item"
                          role="menuitem"
                          disabled={store.zotero.busy}
                          onClick={() => {
                            setMenu(false);
                            void store.zotero.sync(true).catch(() => undefined);
                          }}
                        >
                          Reload all sources from Zotero
                        </button>
                        <button
                          type="button"
                          className="jr-menu-item"
                          role="menuitem"
                          onClick={() => {
                            setMenu(false);
                            setMatching(true);
                          }}
                        >
                          Match existing links with Zotero …
                        </button>
                      </>
                    )}
                  </span>
                )}
              </span>
            </>
          }
        />
        {showFilters && (
          <div className="jr-filters" role="search">
            {!isSection && (
              <select value={f.section} aria-label="Section" onChange={(e) => set({ section: e.target.value })}>
                <option value="">All Sections</option>
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sectionTitle(store, s.id)}
                  </option>
                ))}
              </select>
            )}
            <select value={f.type} aria-label="Type" onChange={(e) => set({ type: e.target.value })}>
              <option value="">All Types</option>
              {ENTRY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select value={f.status} aria-label="Status" onChange={(e) => set({ status: e.target.value })}>
              <option value="">All Status</option>
              {ENTRY_STATUS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {topics.length > 0 && (
              <select value={f.topic} aria-label="Topic" onChange={(e) => set({ topic: e.target.value })}>
                <option value="">All Topics</option>
                {topics.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>
            )}
            <select value={f.sort} aria-label="Order" onChange={(e) => set({ sort: e.target.value as Filter['sort'] })}>
              <option value="new">Date: Newest</option>
              <option value="old">Date: Oldest</option>
            </select>
            {active && (
              <button type="button" className="jr-linkbtn" onClick={() => set(NO_FILTER)}>
                Reset
              </button>
            )}
          </div>
        )}

        {checked.size > 0 && (
          <div className="jr-bulk" role="toolbar" aria-label="Selected entries">
            <strong>{`${checked.size} selected`}</strong>
            <select
              value=""
              aria-label="Add to a section"
              onChange={(e) => e.target.value && bulkSections(e.target.value, true)}
            >
              <option value="">Add to section …</option>
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {sectionTitle(store, s.id)}
                </option>
              ))}
            </select>
            <select
              value=""
              aria-label="Remove from a section"
              onChange={(e) => e.target.value && bulkSections(e.target.value, false)}
            >
              <option value="">Remove from section …</option>
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {sectionTitle(store, s.id)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="is-danger"
              onClick={bulkDelete}
            >
              <Icon name="trash" /> Delete
            </button>
            <button type="button" className="jr-linkbtn" onClick={() => setChecked(new Set())}>
              Clear
            </button>
          </div>
        )}

      <div className="jr-log-main">
        {!list.length ? (
          <div className="jr-empty">
            <p>{active ? 'Nothing matches the filters.' : isSection ? 'No task is assigned to this page yet. Choose it under “Show in sections” in a task.' : 'No entries yet.'}</p>
            {!active && (
              <button type="button" className="is-primary" onClick={() => newEntry(isSection ? page : undefined)}>
                <Icon name="plus" /> New Entry
              </button>
            )}
          </div>
        ) : view === 'grid' ? (
          <ul className="jr-cards">
            {shown.map((i) => (
              <li key={i.key} className={isSel(i) ? 'is-selected' : ''}>
                {i.t ? <TaskCard store={store} e={i.e} t={i.t} title={page === 'methodology' ? sectionBlockTitle(i, page, kinds) : ''} onOpen={() => open(i)} /> : <EntryCard store={store} e={i.e} title={page === 'methodology' ? sectionBlockTitle(i, page, kinds) : ''} onOpen={() => open(i)} />}
              </li>
            ))}
          </ul>
        ) : (
          <div className="jr-table" role="table" aria-label={isSection ? 'Tasks and entries' : 'Entries'}>
            <div className="jr-row is-head" role="row">
              <span className="jr-cell-check" role="columnheader">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={shown.every((i) => checked.has(i.key))}
                  onChange={(e) => setChecked((c) => new Set(e.target.checked ? [...c, ...shown.map((x) => x.key)] : [...c].filter((k) => !shown.some((x) => x.key === k))))}
                />
              </span>
              <span className="jr-cell-date" role="columnheader">
                Date
              </span>
              <span className="jr-cell-title" role="columnheader">
                Title
              </span>
              <span className="jr-cell-sections" role="columnheader">
                Sections
              </span>
            </div>
            {shown.map((i) => {
              const e = i.e;
              const secs = itemSections(i);
              // Methods & Methodology: the method block's own title, the log's below it
              const own = page === 'methodology' ? sectionBlockTitle(i, page, kinds) : '';
              const tasks = e.tasks ?? [];
              const sub = own
                ? [i.t ? i.t.title : '', e.title, i.t ? taskTime(i.t) : ''].filter(Boolean).join(' · ')
                : i.t
                ? [e.title, taskTime(i.t)].filter(Boolean).join(' · ')
                : [ENTRY_TYPES.find((t) => t.id === e.type)?.label, e.status !== 'none' ? ENTRY_STATUS.find((s) => s.id === e.status)?.label : '', tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : ''].filter(Boolean).join(' · ');
              return (
                <div key={i.key} className={`jr-row is-${e.status}${i.t ? ' is-task' : ''}${isSel(i) ? ' is-selected' : ''}`} role="row" onClick={() => open(i)}>
                  <span className="jr-cell-check" role="cell" onClick={(x) => x.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${i.t?.title || e.title}`} checked={checked.has(i.key)} onChange={(x) => setChecked((c) => { const s = new Set(c); if (x.target.checked) s.add(i.key); else s.delete(i.key); return s; })} />
                  </span>
                  <span className="jr-cell-date" role="cell">
                    {e.date ? fmtDate(e.date, e.dateEnd) : '–'}
                  </span>
                  <button type="button" className="jr-cell-title" role="cell" onClick={(x) => (x.stopPropagation(), open(i))} aria-current={isSel(i) ? 'true' : undefined}>
                    {own || (i.t ? i.t.title || 'Untitled task' : e.title)}
                    <small>{sub}</small>
                  </button>
                  <span className="jr-cell-sections" role="cell">
                    {secs.length ? secs.map((s) => <span key={s} className="jr-tag is-section" title={sectionTitle(store, s)}>{shortSection(store, s)}</span>) : <span className="jr-muted">–</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {list.length > 0 && (
          <nav className="jr-pager" aria-label="Pages">
            <span className="jr-muted jr-small">{`Showing ${shown.length} of ${list.length} ${isSection ? (list.length === 1 ? 'item' : 'items') : list.length === 1 ? 'entry' : 'entries'}${active ? ' (filtered)' : ''}`}</span>
            {pages > 1 && (
              <span className="jr-pager-pages">
                <IconBtn icon="up" label="Previous page" disabled={cur === 0} onClick={() => setN(cur - 1)} />
                {Array.from({ length: pages }, (_, i) => i)
                  .filter((i) => pages <= 7 || i === 0 || i === pages - 1 || Math.abs(i - cur) <= 1)
                  .map((i, k, arr) => (
                    <span key={i} className="jr-pager-item">
                      {k > 0 && i - arr[k - 1] > 1 && <span className="jr-muted">…</span>}
                      <button type="button" className={i === cur ? 'is-on' : ''} aria-current={i === cur ? 'page' : undefined} onClick={() => setN(i)}>
                        {i + 1}
                      </button>
                    </span>
                  ))}
                <IconBtn icon="down" label="Next page" disabled={cur >= pages - 1} onClick={() => setN(cur + 1)} />
              </span>
            )}
          </nav>
        )}
      </div>

      {importing && <ImportDialog store={store} name={importing.name} data={importing.data} onClose={() => setImporting(null)} />}
      {matching && <MatchDialog store={store} onClose={() => setMatching(false)} />}
    </div>
  );
}
