// One log entry: read it, or edit it in one place. Saving updates the one
// record, so every page that shows it changes with it. Sections and topics are
// suggested from the type and content (dashed chips) but only ever added by a
// click; nothing chosen by hand is replaced.
import { useEffect, useMemo, useState } from 'react';
import { Markdown } from './markdown';
import type { JournalStore } from './store';
import { suggestSections, suggestTopics } from './suggest';
import { BLOCK_PRESETS, ENTRY_STATUS, ENTRY_TYPES, SECTIONS, fmtDate, newId, today, entrySections, entryTopics, type Block, type Entry } from './types';
import { Attachments, Chips, Icon, IconBtn, MdEditor, Modal, VisibilitySwitch } from './ui';

export function blankEntry(section?: string): Entry {
  const now = Date.now();
  return { id: newId('e'), date: today(), dateEnd: null, title: '', type: 'log', status: 'none', sections: section ? [section] : [], topics: [], blocks: [{ id: newId('b'), label: 'Context', md: '' }], sources: [], files: [], visibility: 'private', created: now, updated: now };
}

export const sectionTitle = (store: JournalStore, id: string) => store.docs.pages[id]?.title || SECTIONS.find((s) => s.id === id)?.title || id;
export const allTopics = (store: JournalStore) => [...new Set(Object.values(store.docs.entries).flatMap(entryTopics))].sort((a, b) => a.localeCompare(b));

export function EntryMeta({ store, e }: { store: JournalStore; e: Entry }) {
  const st = ENTRY_STATUS.find((s) => s.id === e.status);
  return (
    <div className="jr-meta">
      {e.date && <span className="jr-date">{fmtDate(e.date, e.dateEnd)}</span>}
      <span className="jr-type">{ENTRY_TYPES.find((t) => t.id === e.type)?.label}</span>
      {e.status !== 'none' && <span className={`jr-status is-${e.status}`}>{st?.label}</span>}
      {entrySections(e).map((s) => (
        <span key={s} className="jr-tag is-section">
          {sectionTitle(store, s)}
        </span>
      ))}
      {entryTopics(e).map((t) => (
        <span key={t} className="jr-tag">
          #{t}
        </span>
      ))}
      {e.visibility === 'shared' && (
        <span className="jr-tag is-shared">
          <Icon name="globe" /> Shared
        </span>
      )}
    </div>
  );
}

export function EntryDialog({ store, entry, isNew, onClose }: { store: JournalStore; entry: Entry; isNew?: boolean; onClose: () => void }) {
  const [edit, setEdit] = useState(!!isNew);
  const [e, setE] = useState<Entry>(entry);
  const [previews, setPreviews] = useState<Record<string, boolean>>({});
  const [topicDraft, setTopicDraft] = useState('');
  const [history, setHistory] = useState<{ at: number; data: Entry }[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!edit) setE(store.docs.entries[entry.id] ?? entry);
  }, [store.docs.entries, entry, edit]);
  const saved = store.docs.entries[entry.id];
  const dirty = JSON.stringify(e) !== JSON.stringify(saved ?? entry);
  const known = allTopics(store);
  const secSug = useMemo(() => (edit ? suggestSections(e) : []), [edit, e]);
  const topSug = useMemo(() => (edit ? suggestTopics(e, known) : []), [edit, e, known]);
  const set = (p: Partial<Entry>) => setE((x) => ({ ...x, ...p }));
  const setBlock = (id: string, p: Partial<Block>) => set({ blocks: e.blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const move = (i: number, d: number) => {
    const b = [...e.blocks];
    const [x] = b.splice(i, 1);
    b.splice(i + d, 0, x);
    set({ blocks: b });
  };
  const close = () => {
    if (edit && dirty && !confirm('Discard the unsaved changes?')) return;
    onClose();
  };
  const save = async () => {
    if (!e.title.trim()) {
      setMsg('A title is needed.');
      return;
    }
    const data: Entry = { ...e, title: e.title.trim(), topics: [...new Set(e.topics.map((t) => t.trim()).filter(Boolean))], blocks: e.blocks.filter((b) => b.md.trim() || b.label !== 'Context' || e.blocks.length === 1), updated: Date.now() };
    try {
      await store.commit([{ coll: 'entries', id: data.id, data }]);
      setE(data);
      setEdit(false);
      setMsg(null);
      if (isNew) onClose();
    } catch {
      setMsg('Not saved – see the message at the top.');
    }
  };
  const remove = () => {
    if (!confirm(`Delete “${saved?.title ?? e.title}”? It disappears from every page. (Its earlier states stay in the edit history.)`)) return;
    void store.commit([], [{ coll: 'entries', id: e.id }]);
    // milestones that pointed to it
    const put = Object.values(store.docs.milestones)
      .filter((m) => m.related.includes(e.id))
      .map((m) => ({ coll: 'milestones' as const, id: m.id, data: { ...m, related: m.related.filter((r) => r !== e.id) } }));
    if (put.length) void store.commit(put);
    onClose();
  };
  const addTopic = (t: string) => {
    const v = t.trim().replace(/^#/, '');
    if (v && !e.topics.some((x) => x.toLowerCase() === v.toLowerCase())) set({ topics: [...e.topics, known.find((k) => k.toLowerCase() === v.toLowerCase()) ?? v] });
    setTopicDraft('');
  };

  if (!edit) {
    const cur = saved ?? e;
    return (
      <Modal
        title={cur.title}
        onClose={onClose}
        wide
        footer={
          <>
            <button type="button" onClick={() => void store.history('entries', cur.id).then((h) => setHistory(h as { at: number; data: Entry }[]))}>
              <Icon name="history" /> Edit history
            </button>
            <span className="jr-spacer" />
            <button type="button" className="is-primary" onClick={() => setEdit(true)}>
              <Icon name="edit" /> Edit
            </button>
          </>
        }
      >
        <EntryMeta store={store} e={cur} />
        {cur.blocks.map((b) => (
          <section key={b.id} className="jr-block">
            {(cur.blocks.length > 1 || b.label !== 'Notes') && <h3>{b.label}</h3>}
            <Markdown md={b.md} />
          </section>
        ))}
        {(cur.sources.length > 0 || cur.files.length > 0) && (
          <section className="jr-block">
            <h3>Sources & attachments</h3>
            <Attachments store={store} files={cur.files} links={cur.sources} onChange={(files, sources) => void store.commit([{ coll: 'entries', id: cur.id, data: { ...cur, files, sources, updated: Date.now() } }])} />
          </section>
        )}
        {history && <History history={history} onUse={(d) => (setE({ ...d, id: cur.id }), setEdit(true), setHistory(null))} onClose={() => setHistory(null)} />}
      </Modal>
    );
  }

  return (
    <Modal
      title={isNew ? 'New log entry' : 'Edit entry'}
      onClose={close}
      wide
      footer={
        <>
          {!isNew && saved && (
            <button type="button" className="is-danger" onClick={remove}>
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="jr-spacer" />
          {msg && <span className="jr-warn" role="alert">{msg}</span>}
          <button
            type="button"
            onClick={() => {
              if (dirty && !confirm('Discard the unsaved changes?')) return;
              if (isNew) onClose();
              else {
                setE(saved ?? entry);
                setEdit(false);
              }
            }}
          >
            Cancel
          </button>
          <button type="button" className="is-primary" onClick={() => void save()} disabled={!dirty && !isNew}>
            Save
          </button>
        </>
      }
    >
      <div className="jr-form">
        <label className="jr-field is-wide">
          <span>Title</span>
          <input value={e.title} onChange={(x) => set({ title: x.target.value })} placeholder="e.g. Improving my project documentation workflow" autoFocus={isNew} />
        </label>
        <label className="jr-field">
          <span>Entry type</span>
          <select value={e.type} onChange={(x) => set({ type: x.target.value as Entry['type'] })}>
            {ENTRY_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="jr-field">
          <span>Status</span>
          <select value={e.status} onChange={(x) => set({ status: x.target.value as Entry['status'] })}>
            {ENTRY_STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.md ? `  ${s.md}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="jr-field">
          <span>Date</span>
          <input type="date" value={e.date} onChange={(x) => set({ date: x.target.value })} />
        </label>
        <label className="jr-field">
          <span>Until (optional)</span>
          <input type="date" value={e.dateEnd ?? ''} min={e.date || undefined} onChange={(x) => set({ dateEnd: x.target.value || null })} />
        </label>
        <div className="jr-field">
          <span>Visibility</span>
          <VisibilitySwitch value={e.visibility} onChange={(v) => set({ visibility: v })} />
        </div>
      </div>

      <div className="jr-field is-wide">
        <span>
          Sections <span className="jr-muted">– the pages this entry appears on (always also in All Project Logs and the Timeline)</span>
        </span>
        <Chips all={SECTIONS.map((s) => ({ id: s.id, label: sectionTitle(store, s.id) }))} chosen={e.sections} suggested={secSug} label="Sections" onToggle={(id) => set({ sections: e.sections.includes(id) ? e.sections.filter((x) => x !== id) : [...e.sections, id] })} />
        <p className="jr-muted jr-small">{`Displayed in ${e.sections.length + 1} ${e.sections.length ? 'places' : 'place'}: All Project Logs${e.sections.map((s) => `, ${sectionTitle(store, s)}`).join('')}.`}</p>
      </div>

      <div className="jr-field is-wide">
        <span>Topics</span>
        <div className="jr-chips">
          {e.topics.map((t) => (
            <span key={t} className="jr-chip is-on">
              #{t}
              <button type="button" className="jr-chip-x" aria-label={`Remove topic ${t}`} onClick={() => set({ topics: e.topics.filter((x) => x !== t) })}>
                ×
              </button>
            </span>
          ))}
          {topSug.map((t) => (
            <button key={t} type="button" className="jr-chip is-suggested" onClick={() => addTopic(t)} title="Suggested from the content – click to add">
              <Icon name="plus" />#{t}
            </button>
          ))}
          <input
            className="jr-chip-input"
            list="jr-topics"
            value={topicDraft}
            placeholder="+ topic"
            aria-label="Add a topic"
            onChange={(x) => setTopicDraft(x.target.value)}
            onKeyDown={(x) => {
              if (x.key === 'Enter' || x.key === ',') {
                x.preventDefault();
                addTopic(topicDraft);
              }
            }}
            onBlur={() => topicDraft.trim() && addTopic(topicDraft)}
          />
          <datalist id="jr-topics">
            {known.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="jr-blocks">
        {e.blocks.map((b, i) => (
          <div key={b.id} className="jr-blockedit">
            <div className="jr-blockedit-head">
              <input className="jr-blocklabel" value={b.label} list="jr-blockpresets" onChange={(x) => setBlock(b.id, { label: x.target.value })} aria-label="Block name" />
              <IconBtn icon="up" label="Move block up" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconBtn icon="down" label="Move block down" disabled={i === e.blocks.length - 1} onClick={() => move(i, 1)} />
              <IconBtn icon="trash" label="Remove block" danger onClick={() => (!b.md.trim() || confirm(`Remove the block “${b.label}”?`)) && set({ blocks: e.blocks.filter((x) => x.id !== b.id) })} />
            </div>
            <MdEditor value={b.md} onChange={(v) => setBlock(b.id, { md: v })} rows={b.md.split('\n').length > 6 ? 12 : 5} preview={!!previews[b.id]} setPreview={(p) => setPreviews((x) => ({ ...x, [b.id]: p }))} label={b.label} />
          </div>
        ))}
        <datalist id="jr-blockpresets">
          {BLOCK_PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="jr-chips">
          <span className="jr-muted jr-small">Add block:</span>
          {BLOCK_PRESETS.filter((p) => !e.blocks.some((b) => b.label === p)).map((p) => (
            <button key={p} type="button" className="jr-chip" onClick={() => set({ blocks: [...e.blocks, { id: newId('b'), label: p, md: '' }] })}>
              <Icon name="plus" />
              {p}
            </button>
          ))}
          <button type="button" className="jr-chip" onClick={() => set({ blocks: [...e.blocks, { id: newId('b'), label: 'New block', md: '' }] })}>
            <Icon name="plus" />
            Own block
          </button>
        </div>
      </div>

      <div className="jr-field is-wide">
        <span>Sources & attachments</span>
        <Attachments store={store} files={e.files} links={e.sources} onChange={(files, sources) => set({ files, sources })} />
      </div>
    </Modal>
  );
}

function History({ history, onUse, onClose }: { history: { at: number; data: Entry }[]; onUse: (d: Entry) => void; onClose: () => void }) {
  return (
    <section className="jr-block jr-history">
      <h3>
        Edit history <IconBtn icon="x" label="Close history" onClick={onClose} />
      </h3>
      {history.length ? (
        <ul>
          {history.map((h) => (
            <li key={h.at}>
              <span>{new Date(h.at).toLocaleString('en-GB', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span className="jr-muted">{`before this change: “${h.data.title}”`}</span>
              <button type="button" className="jr-linkbtn" onClick={() => onUse(h.data)}>
                Open in editor
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="jr-muted">No earlier states yet – this entry has not been changed since it was created.</p>
      )}
    </section>
  );
}
