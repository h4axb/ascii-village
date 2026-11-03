// The Project Log and the section pages: a table of the entries (search,
// filters, newest/oldest, pages of 10, a list or a grid), and the chosen entry
// beside it in a panel, where every part is edited in place: title, date,
// type, status, sections, topics, each content block on its own, evidence and
// references. On narrow screens the panel covers the list. It is always the
// one record: a change here is a change on every page that shows the entry.
import { useEffect, useMemo, useState } from 'react';
import { readLog, writeLog, type LogImport } from './logImport';
import type { JournalStore, Put } from './store';
import { suggestSections } from './suggest';
import { BLOCK_PRESETS, ENTRY_STATUS, ENTRY_TYPES, SECTIONS, fmtDate, newId, type Block, type Entry } from './types';
import { allTopics, EntryDialog, sectionTitle } from './EntryEditor';
import { EntryCard, ImportDialog, PageHead } from './pages';
import { DayFacts } from './AddEntry';
import { Markdown } from './markdown';
import { Attachments, Chips, Icon, IconBtn, InlineText, MdEditor } from './ui';

type IconName = Parameters<typeof Icon>[0]['name'];
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

// a block's icon by its name (Context, Method / Approach …; own names get a note)
export function blockIcon(label: string): IconName {
  const l = label.toLowerCase();
  if (/context|kontext/.test(l)) return 'doc';
  if (/method|approach|methode|vorgehen/.test(l)) return 'flask';
  if (/decision|action|entscheid/.test(l)) return 'branch';
  if (/rationale|reason|begründ/.test(l)) return 'scale';
  if (/outcome|result|ergebnis/.test(l)) return 'target';
  if (/reflect|reflexion/.test(l)) return 'chat';
  return 'note';
}

const useWide = () => {
  const q = '(min-width: 1240px)';
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
};

export function LogList({ store, page, selected, openEntry, closeEntry, newEntry }: { store: JournalStore; page: string; selected: string | null; openEntry: (id: string) => void; closeEntry: () => void; newEntry: (section?: string) => void }) {
  const [f, setF] = useState<Filter>(NO_FILTER);
  const [showFilters, setShowFilters] = useState(true);
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('jr-log-view') === 'grid' ? 'grid' : 'list'));
  const [n, setN] = useState(0); // the page of the table
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [importing, setImporting] = useState<{ name: string; data: LogImport } | null>(null);
  const wide = useWide();
  const isSection = SECTIONS.some((s) => s.id === page);
  const all = Object.values(store.docs.entries);
  const list = useMemo(
    () =>
      all
        .filter((e) => !isSection || e.sections.includes(page))
        .filter((e) => (!f.section || e.sections.includes(f.section)) && (!f.type || e.type === f.type) && (!f.status || e.status === f.status) && (!f.topic || e.topics.includes(f.topic)))
        .filter((e) => !f.q.trim() || `${e.title} ${e.topics.join(' ')} ${e.blocks.map((b) => b.md).join(' ')}`.toLowerCase().includes(f.q.trim().toLowerCase()))
        .sort((a, b) => (f.sort === 'new' ? -1 : 1) * ((a.date || '0').localeCompare(b.date || '0') || a.created - b.created)),
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
    const i = list.findIndex((e) => e.id === selected);
    if (i >= 0 && Math.floor(i / PAGE) !== cur) setN(Math.floor(i / PAGE));
  }, [selected]);
  const active = JSON.stringify({ ...f, sort: 'new' }) !== JSON.stringify(NO_FILTER);
  const topics = allTopics(store);
  const entry = selected ? store.docs.entries[selected] : null;
  const exportMd = () => {
    setMenu(false);
    const md = writeLog(isSection ? all.filter((e) => e.sections.includes(page)) : all, isSection ? [] : Object.values(store.docs.deadlines), (id) => sectionTitle(store, id));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${page === 'log' ? 'project-log' : page}.md`;
    a.click();
  };
  const bulk = (put: Put[], del: { coll: 'entries'; id: string }[] = []) => {
    void store.commit(put, del);
    setChecked(new Set());
  };
  const chosen = [...checked].map((id) => store.docs.entries[id]).filter(Boolean);

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
              onChange={(e) => e.target.value && bulk(chosen.filter((x) => !x.sections.includes(e.target.value)).map((x) => ({ coll: 'entries', id: x.id, data: { ...x, sections: [...x.sections, e.target.value], updated: Date.now() } })))}
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
              onChange={(e) => e.target.value && bulk(chosen.filter((x) => x.sections.includes(e.target.value)).map((x) => ({ coll: 'entries', id: x.id, data: { ...x, sections: x.sections.filter((s) => s !== e.target.value), updated: Date.now() } })))}
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
              onClick={() => {
                if (!confirm(`Delete ${checked.size} ${checked.size === 1 ? 'entry' : 'entries'}? They disappear from every page (earlier states stay in the edit history).`)) return;
                if (selected && checked.has(selected)) closeEntry();
                bulk([], [...checked].map((id) => ({ coll: 'entries' as const, id })));
              }}
            >
              <Icon name="trash" /> Delete
            </button>
            <button type="button" className="jr-linkbtn" onClick={() => setChecked(new Set())}>
              Clear
            </button>
          </div>
        )}

      <div className={`jr-log-body${entry && wide ? ' has-panel' : ''}`}>
      <div className="jr-log-main">
        {!list.length ? (
          <div className="jr-empty">
            <p>{active ? 'No entry matches the filters.' : isSection ? 'No entry is assigned to this page yet. Choose it under “Sections” in an entry.' : 'No entries yet.'}</p>
            {!active && (
              <button type="button" className="is-primary" onClick={() => newEntry(isSection ? page : undefined)}>
                <Icon name="plus" /> New Entry
              </button>
            )}
          </div>
        ) : view === 'grid' ? (
          <ul className="jr-cards">
            {shown.map((e) => (
              <li key={e.id} className={e.id === selected ? 'is-selected' : ''}>
                <EntryCard store={store} e={e} onOpen={() => openEntry(e.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="jr-table" role="table" aria-label="Entries">
            <div className="jr-row is-head" role="row">
              <span className="jr-cell-check" role="columnheader">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={shown.every((e) => checked.has(e.id))}
                  onChange={(e) => setChecked((c) => new Set(e.target.checked ? [...c, ...shown.map((x) => x.id)] : [...c].filter((id) => !shown.some((x) => x.id === id))))}
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
            {shown.map((e) => (
              <div key={e.id} className={`jr-row is-${e.status}${e.id === selected ? ' is-selected' : ''}`} role="row" onClick={() => openEntry(e.id)}>
                <span className="jr-cell-check" role="cell" onClick={(x) => x.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${e.title}`} checked={checked.has(e.id)} onChange={(x) => setChecked((c) => { const s = new Set(c); if (x.target.checked) s.add(e.id); else s.delete(e.id); return s; })} />
                </span>
                <span className="jr-cell-date" role="cell">
                  {e.date ? fmtDate(e.date, e.dateEnd) : '–'}
                </span>
                <button type="button" className="jr-cell-title" role="cell" onClick={(x) => (x.stopPropagation(), openEntry(e.id))} aria-current={e.id === selected ? 'true' : undefined}>
                  {e.title}
                  <small>{`${ENTRY_TYPES.find((t) => t.id === e.type)?.label}${e.status !== 'none' ? ` · ${ENTRY_STATUS.find((s) => s.id === e.status)?.label}` : ''}`}</small>
                </button>
                <span className="jr-cell-sections" role="cell">
                  {e.sections.length ? e.sections.map((s) => <span key={s} className="jr-tag is-section" title={sectionTitle(store, s)}>{shortSection(store, s)}</span>) : <span className="jr-muted">–</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {list.length > 0 && (
          <nav className="jr-pager" aria-label="Pages">
            <span className="jr-muted jr-small">{`Showing ${shown.length} of ${list.length} ${list.length === 1 ? 'entry' : 'entries'}${active ? ' (filtered)' : ''}`}</span>
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

      {entry && (
        <>
          {!wide && <div className="jr-panel-scrim" onClick={closeEntry} />}
          <EntryPanel key={entry.id} store={store} entry={entry} onClose={closeEntry} floating={!wide} />
        </>
      )}
      </div>
      {importing && <ImportDialog store={store} name={importing.name} data={importing.data} onClose={() => setImporting(null)} />}
    </div>
  );
}

// ---- the chosen entry, edited in place ----
function EntryPanel({ store, entry: e, onClose, floating }: { store: JournalStore; entry: Entry; onClose: () => void; floating: boolean }) {
  const [menu, setMenu] = useState(false);
  const [full, setFull] = useState(false); // the whole entry in the dialog
  const [secEdit, setSecEdit] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // a block's id
  const [draft, setDraft] = useState<Block | null>(null);
  const [preview, setPreview] = useState(false);
  const [topic, setTopic] = useState('');
  const save = (p: Partial<Entry>) => void store.commit([{ coll: 'entries', id: e.id, data: { ...e, ...p, updated: Date.now() } }]);
  useEffect(() => {
    if (!floating) return;
    const onKey = (x: KeyboardEvent) => x.key === 'Escape' && !editing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [floating, editing, onClose]);
  const startBlock = (b: Block) => {
    if (editing && draft && !confirmLeave()) return;
    setEditing(b.id);
    setDraft(b);
    setPreview(false);
  };
  const confirmLeave = () => {
    const was = e.blocks.find((b) => b.id === editing);
    return !draft || !was || (draft.md === was.md && draft.label === was.label) || confirm('Discard the changes to this block?');
  };
  const saveBlock = () => {
    if (!draft) return;
    const exists = e.blocks.some((b) => b.id === draft.id);
    save({ blocks: exists ? e.blocks.map((b) => (b.id === draft.id ? { ...draft, label: draft.label.trim() || b.label } : b)) : [...e.blocks, draft] });
    setEditing(null);
    setDraft(null);
  };
  const addBlock = (label: string) => {
    if (editing && !confirmLeave()) return;
    const b = { id: newId('b'), label, md: '' };
    setEditing(b.id);
    setDraft(b);
    setPreview(false);
  };
  const sug = suggestSections(e);
  const known = allTopics(store);
  const addTopic = (t: string) => {
    const v = t.trim().replace(/^#/, '');
    if (v && !e.topics.some((x) => x.toLowerCase() === v.toLowerCase())) save({ topics: [...e.topics, known.find((k) => k.toLowerCase() === v.toLowerCase()) ?? v] });
    setTopic('');
  };
  const newBlock = editing && draft && !e.blocks.some((b) => b.id === draft.id) ? draft : null;
  const blocks = newBlock ? [...e.blocks, newBlock] : e.blocks;

  return (
    <aside className={`jr-panel${floating ? ' is-floating' : ''}`} aria-label={`Entry: ${e.title}`}>
      <header className="jr-panel-head">
        <span className="jr-panel-sections">
          {e.sections.map((s) => (
            <span key={s} className="jr-tag is-section">
              {sectionTitle(store, s)}
            </span>
          ))}
          <button type="button" className="jr-linkbtn jr-small" onClick={() => setSecEdit(!secEdit)} aria-expanded={secEdit}>
            {secEdit ? 'Done' : e.sections.length ? 'Edit sections' : '+ Sections'}
          </button>
        </span>
        <span className="jr-panel-tools">
          <span className="jr-menuwrap">
            <IconBtn icon="more" label="More" onClick={() => setMenu(!menu)} />
            {menu && (
              <span className="jr-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <button type="button" className="jr-menu-item" role="menuitem" onClick={() => (setMenu(false), setFull(true))}>
                  Edit history & all fields
                </button>
                <button
                  type="button"
                  className="jr-menu-item is-danger"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    if (!confirm(`Delete “${e.title}”? It disappears from every page. (Its earlier states stay in the edit history.)`)) return;
                    onClose();
                    void store.commit([], [{ coll: 'entries', id: e.id }]);
                  }}
                >
                  Delete entry
                </button>
              </span>
            )}
          </span>
          <IconBtn icon="expand" label="Open the whole entry" onClick={() => setFull(true)} />
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </span>
      </header>
      {secEdit && (
        <div className="jr-panel-secedit">
          <Chips all={SECTIONS.map((s) => ({ id: s.id, label: sectionTitle(store, s.id) }))} chosen={e.sections} suggested={sug} label="Sections" onToggle={(id) => save({ sections: e.sections.includes(id) ? e.sections.filter((x) => x !== id) : [...e.sections, id] })} />
          <p className="jr-muted jr-small">The entry also always appears in the Project Log and the Timeline. Dashed: suggested from its type and text.</p>
        </div>
      )}
      <InlineText as="h2" value={e.title} label="Title" onSave={(v) => v && save({ title: v })} className="jr-panel-title" />
      <div className="jr-panel-meta">
        <span className="jr-panel-field">
          <Icon name="calendar" />
          <input type="date" value={e.date} aria-label="Date" onChange={(x) => save({ date: x.target.value })} />
        </span>
        <span className="jr-panel-field">
          <Icon name="doc" />
          <select value={e.type} aria-label="Type" onChange={(x) => save({ type: x.target.value as Entry['type'] })}>
            {ENTRY_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </span>
        <span className={`jr-panel-field jr-status-select is-${e.status}`}>
          <span className="jr-dot" aria-hidden="true" />
          <select value={e.status} aria-label="Status" onChange={(x) => save({ status: x.target.value as Entry['status'] })}>
            {ENTRY_STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="jr-chips jr-panel-topics">
        {e.topics.map((t) => (
          <span key={t} className="jr-chip is-small">
            #{t}
            <button type="button" className="jr-chip-x" aria-label={`Remove topic ${t}`} onClick={() => save({ topics: e.topics.filter((x) => x !== t) })}>
              ×
            </button>
          </span>
        ))}
        <input
          className="jr-chip-input"
          list="jr-topics-panel"
          value={topic}
          placeholder="+ topic"
          aria-label="Add a topic"
          onChange={(x) => setTopic(x.target.value)}
          onKeyDown={(x) => {
            if (x.key === 'Enter' || x.key === ',') {
              x.preventDefault();
              addTopic(topic);
            }
          }}
          onBlur={() => topic.trim() && addTopic(topic)}
        />
        <datalist id="jr-topics-panel">
          {known.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      <DayFacts store={store} e={e} />

      <div className="jr-panel-blocks">
        {blocks.map((b) => {
          const on = editing === b.id && draft;
          return (
            <section key={b.id} className={`jr-pblock${on ? ' is-editing' : ''}`}>
              <span className="jr-pblock-icon" aria-hidden="true">
                <Icon name={blockIcon(on ? draft.label : b.label)} />
              </span>
              <div className="jr-pblock-body">
                {on ? (
                  <>
                    <input className="jr-pblock-label" value={draft.label} list="jr-blockpresets-panel" aria-label="Block name" onChange={(x) => setDraft({ ...draft, label: x.target.value })} />
                    <MdEditor value={draft.md} onChange={(v) => setDraft({ ...draft, md: v })} rows={Math.min(14, Math.max(4, draft.md.split('\n').length + 1))} preview={preview} setPreview={setPreview} label={draft.label} />
                    <div className="jr-actions">
                      {e.blocks.some((x) => x.id === b.id) && (
                        <button type="button" className="jr-linkbtn" onClick={() => confirm(`Remove the block “${b.label}”?`) && (save({ blocks: e.blocks.filter((x) => x.id !== b.id) }), setEditing(null), setDraft(null))}>
                          Remove block
                        </button>
                      )}
                      <span className="jr-spacer" />
                      <button type="button" onClick={() => (confirmLeave() ? (setEditing(null), setDraft(null)) : undefined)}>
                        Cancel
                      </button>
                      <button type="button" className="is-primary" onClick={saveBlock} disabled={!draft.md.trim() && !e.blocks.some((x) => x.id === b.id)}>
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>{b.label}</h3>
                    {b.md.trim() ? <Markdown md={b.md} /> : <p className="jr-muted">Empty.</p>}
                  </>
                )}
              </div>
              {!on && <IconBtn icon="edit" label={`Edit ${b.label}`} onClick={() => startBlock(b)} />}
            </section>
          );
        })}
        <datalist id="jr-blockpresets-panel">
          {BLOCK_PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {!editing && (
          <div className="jr-chips jr-panel-add">
            <span className="jr-muted jr-small">Add:</span>
            {BLOCK_PRESETS.filter((p) => !e.blocks.some((b) => b.label === p)).map((p) => (
              <button key={p} type="button" className="jr-chip is-small" onClick={() => addBlock(p)}>
                <Icon name="plus" />
                {p}
              </button>
            ))}
          </div>
        )}
        <section className="jr-pblock">
          <span className="jr-pblock-icon" aria-hidden="true">
            <Icon name="clip" />
          </span>
          <div className="jr-pblock-body">
            <h3>Evidence & References</h3>
            <Attachments store={store} files={e.files} links={e.sources} onChange={(files, sources) => save({ files, sources })} />
          </div>
        </section>
      </div>
      {e.updated && <p className="jr-muted jr-small jr-panel-foot">{`Last edited ${new Date(e.updated).toLocaleString('en-GB', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' })}`}</p>}
      {full && <EntryDialog store={store} entry={e} onClose={() => setFull(false)} />}
    </aside>
  );
}
