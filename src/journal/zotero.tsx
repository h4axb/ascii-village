// The journal's sources from Zotero: how a source reads (from the library's
// copy, so it follows every change made in Zotero), the window to pick one or
// to add a new one to Zotero, the sync button and the matching of older links.
// The API key stays on the server (functions/api/zotero.ts).
import { useMemo, useState } from 'react';
import type { JournalStore, Put, ZoteroDraft } from './store';
import type { Entry, Source, ZoteroItem, ZoteroState } from './types';
import { Icon, Modal } from './ui';

// ---------- how a source reads ----------

export const authorsShort = (cs: string[]) => (cs.length === 0 ? '' : cs.length === 1 ? cs[0] : cs.length === 2 ? `${cs[0]} & ${cs[1]}` : `${cs[0]} et al.`);
export const citeShort = (it: ZoteroItem) => [authorsShort(it.creators), it.year ? `(${it.year})` : ''].filter(Boolean).join(' ');
// a PDF or file on its own in Zotero: no authors, year or reference yet
export const noDetails = (it: ZoteroItem) => it.itemType === 'attachment';
const fileKind = (it: ZoteroItem) => (/pdf/i.test(it.contentType ?? '') ? 'PDF' : it.contentType === 'link' ? 'Link' : 'File');
export const itemUrl = (it: ZoteroItem) => it.url || (it.doi ? `https://doi.org/${it.doi}` : '');

export interface SourceView {
  label: string;
  url: string;
  cite: string; // "Norman (2013)"
  bib: string; // the APA reference
  item: ZoteroItem | null;
  missing: boolean; // linked to Zotero, but no longer in the library
}
export function sourceView(s: Source, zotero: Record<string, ZoteroItem>): SourceView {
  const it = s.zotero ? zotero[s.zotero] : undefined;
  if (it) return { label: it.title || s.label, url: itemUrl(it) || s.url, cite: noDetails(it) ? fileKind(it) : citeShort(it), bib: it.bib, item: it, missing: false };
  return { label: s.label || s.url, url: s.url, cite: '', bib: '', item: null, missing: !!s.zotero };
}
// a source as one Markdown line (the log's export)
export function sourceMd(s: Source, zotero: Record<string, ZoteroItem>): string {
  const v = sourceView(s, zotero);
  const text = v.item ? `${v.cite ? `${v.cite} ` : ''}${v.label}` : v.label || v.url;
  return v.url ? `- [${text}](${v.url})` : `- ${text}`;
}

// "5 min ago"
export function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// a Zotero source in a list: "Norman (2013) · The Design of …", the APA line under it
export function ZoteroSource({ s, zotero, actions }: { s: Source; zotero: Record<string, ZoteroItem>; actions?: React.ReactNode }) {
  const v = sourceView(s, zotero);
  return (
    <div className={`jr-zsrc${v.missing ? ' is-missing' : ''}`}>
      <Icon name="book" />
      <span className="jr-zsrc-text">
        <span className="jr-zsrc-title">
          {v.cite && <b>{v.cite}</b>}
          {v.cite && ' · '}
          {v.url ? (
            <a href={v.url} target="_blank" rel="noreferrer noopener">
              {v.label}
            </a>
          ) : (
            v.label
          )}
        </span>
        {v.bib && <span className="jr-zsrc-bib">{v.bib}</span>}
        {v.missing && <span className="jr-zsrc-bib">No longer in Zotero (kept as it was)</span>}
      </span>
      {actions && <span className="jr-zsrc-actions">{actions}</span>}
    </div>
  );
}

// ---------- picking a source, or adding a new one to Zotero ----------

const TYPES: { id: string; label: string; container?: string; containerLabel?: string }[] = [
  { id: 'journalArticle', label: 'Journal article', container: 'publicationTitle', containerLabel: 'Journal' },
  { id: 'conferencePaper', label: 'Conference paper', container: 'proceedingsTitle', containerLabel: 'Proceedings' },
  { id: 'book', label: 'Book', container: 'publisher', containerLabel: 'Publisher' },
  { id: 'bookSection', label: 'Book chapter', container: 'bookTitle', containerLabel: 'Book title' },
  { id: 'report', label: 'Report', container: 'institution', containerLabel: 'Institution' },
  { id: 'thesis', label: 'Thesis', container: 'university', containerLabel: 'University' },
  { id: 'webpage', label: 'Web page', container: 'websiteTitle', containerLabel: 'Website' },
];
const HAS_DOI = new Set(['journalArticle', 'conferencePaper']);
const HAS_ISBN = new Set(['book', 'bookSection', 'conferencePaper']);

const namesToText = (cs: ZoteroDraft['creators']) => (cs ?? []).map((c) => (c.name ? c.name : [c.lastName, c.firstName].filter(Boolean).join(', '))).join('\n');
const textToNames = (t: string) =>
  t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.includes(',') ? { creatorType: 'author', lastName: l.split(',')[0].trim(), firstName: l.split(',').slice(1).join(',').trim() } : { creatorType: 'author', name: l }));

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const haystack = (it: ZoteroItem) => fold([it.title, it.creators.join(' '), it.year, it.publication, it.tags.join(' '), it.doi].join(' '));

export function ZoteroPicker({ store, initial = '', onPick, onClose }: { store: JournalStore; initial?: string; onPick: (key: string) => void; onClose: () => void }) {
  const z = store.zotero;
  const [tab, setTab] = useState<'library' | 'new'>('library');
  const [q, setQ] = useState(initial);
  const items = useMemo(() => Object.values(store.docs.zotero).sort((a, b) => (a.creators[0] ?? a.title).localeCompare(b.creators[0] ?? b.title)), [store.docs.zotero]);
  const found = useMemo(() => {
    const words = fold(q).split(' ').filter(Boolean);
    return words.length ? items.filter((it) => words.every((w) => haystack(it).includes(w))) : items;
  }, [q, items]);

  return (
    <Modal title="Add a source from Zotero" onClose={onClose} wide>
      <div className="jr-zpick">
        <span className="jr-seg jr-zpick-tabs" role="tablist" aria-label="Source">
          <button type="button" role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'is-on' : ''} onClick={() => setTab('library')}>
            From library
          </button>
          <button type="button" role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'is-on' : ''} onClick={() => setTab('new')}>
            New in Zotero
          </button>
        </span>
        {tab === 'library' ? (
          <>
            <div className="jr-zpick-bar">
              <label className="jr-search">
                <Icon name="search" />
                <input type="search" autoFocus value={q} placeholder="Title, author, year, tag…" aria-label="Search the library" onChange={(e) => setQ(e.target.value)} />
              </label>
              <SyncButton store={store} compact />
            </div>
            {z.state?.error && !items.length ? (
              <p className="jr-zpick-note">{z.state.error}</p>
            ) : !items.length ? (
              <p className="jr-zpick-note">{z.busy ? 'Loading the library …' : 'The library is empty, or not loaded yet: sync with Zotero.'}</p>
            ) : (
              <>
                <p className="jr-muted jr-zpick-count">
                  {found.length === items.length ? `${items.length} sources` : `${found.length} of ${items.length} sources`}
                  {(z.state?.noDetails ?? 0) > 0 && ` · ${z.state!.noDetails} without details (files on their own)`}
                  {(z.state?.notes ?? 0) > 0 && ` · ${z.state!.notes} ${z.state!.notes === 1 ? 'note' : 'notes'} left out`}
                </p>
                <ul className="jr-zpick-list">
                  {found.slice(0, 200).map((it) => (
                    <li key={it.key}>
                      <button type="button" className="jr-zpick-item" onClick={() => onPick(it.key)}>
                        <span className="jr-zpick-title">
                          {noDetails(it) ? <span className="jr-zpick-kind">{fileKind(it)}</span> : citeShort(it) && <b>{citeShort(it)}</b>} {it.title}
                        </span>
                        <span className="jr-zpick-meta">
                          {noDetails(it) ? 'No authors or year yet: in Zotero, right-click → “Retrieve Metadata for PDF” or “Create Parent Item”, then sync' : [it.publication, it.doi ? `DOI ${it.doi}` : ''].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!found.length && <li className="jr-muted">No source matches “{q}”.</li>}
                </ul>
              </>
            )}
          </>
        ) : (
          <NewSource store={store} onPick={onPick} />
        )}
      </div>
    </Modal>
  );
}

function NewSource({ store, onPick }: { store: JournalStore; onPick: (key: string) => void }) {
  const z = store.zotero;
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<ZoteroDraft | null>(null);
  const [existing, setExisting] = useState<ZoteroItem | null>(null);
  const [collection, setCollection] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const type = TYPES.find((t) => t.id === draft?.itemType) ?? TYPES[TYPES.length - 1];
  const set = (p: Partial<ZoteroDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const str = (k: string) => (typeof draft?.[k] === 'string' ? (draft[k] as string) : '');

  const lookUp = async () => {
    setBusy('Looking it up …');
    setError(null);
    setExisting(null);
    try {
      const r = await z.preview(input);
      setDraft(r.item);
      setExisting(r.existing ?? null);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!draft) return;
    setBusy('Saving to Zotero …');
    setError(null);
    try {
      const r = await z.create(draft, collection || undefined);
      onPick(r.item.key);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(null);
    }
  };

  if (z.state && z.state.write === false)
    return <p className="jr-zpick-note">The Zotero API key may only read. To add sources from here, give the key write access on zotero.org (Settings → Feeds/API), then sync again.</p>;

  return (
    <div className="jr-znew">
      <form
        className="jr-znew-look"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void lookUp();
        }}
      >
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="DOI, ISBN or web address" aria-label="DOI, ISBN or web address" />
        <button type="submit" className="is-primary" disabled={!input.trim() || !!busy}>
          Look up
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft({ itemType: 'webpage', title: '', creators: [], date: '', url: /^https?:\/\//.test(input.trim()) ? input.trim() : '' });
            setExisting(null);
            setError(null);
          }}
        >
          Enter by hand
        </button>
      </form>
      {busy && (
        <p className="jr-muted" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="jr-zpick-note is-error" role="alert">
          {error}
        </p>
      )}
      {existing && (
        <div className="jr-zpick-note">
          Already in your library: <b>{citeShort(existing)}</b> {existing.title}
          <button type="button" className="is-primary" onClick={() => onPick(existing.key)}>
            Use this one
          </button>
        </div>
      )}
      {draft && (
        <div className="jr-znew-form">
          <label>
            <span>Type</span>
            <select value={draft.itemType} onChange={(e) => set({ itemType: e.target.value })}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="is-wide">
            <span>Title</span>
            <input value={str('title')} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="is-wide">
            <span>Authors, one per line (Last, First)</span>
            <textarea rows={Math.min(5, Math.max(2, (draft.creators ?? []).length))} value={namesToText(draft.creators)} onChange={(e) => set({ creators: textToNames(e.target.value) })} />
          </label>
          <label>
            <span>Date</span>
            <input value={str('date')} placeholder="2024 or 2024-05-12" onChange={(e) => set({ date: e.target.value })} />
          </label>
          {type.container && (
            <label>
              <span>{type.containerLabel}</span>
              <input value={str(type.container)} onChange={(e) => set({ [type.container!]: e.target.value })} />
            </label>
          )}
          {HAS_DOI.has(draft.itemType) && (
            <label>
              <span>DOI</span>
              <input value={str('DOI')} onChange={(e) => set({ DOI: e.target.value })} />
            </label>
          )}
          {HAS_ISBN.has(draft.itemType) && (
            <label>
              <span>ISBN</span>
              <input value={str('ISBN')} onChange={(e) => set({ ISBN: e.target.value })} />
            </label>
          )}
          <label className="is-wide">
            <span>Web address</span>
            <input value={str('url')} placeholder="https://…" onChange={(e) => set({ url: e.target.value })} />
          </label>
          {(z.state?.collections ?? []).length > 0 && (
            <label>
              <span>Zotero collection</span>
              <select value={collection} onChange={(e) => setCollection(e.target.value)}>
                <option value="">None (library only)</option>
                {z.state!.collections!.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.parent ? '– ' : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="jr-znew-foot is-wide">
            <button type="button" className="is-primary" disabled={!str('title').trim() || !!busy} onClick={() => void save()}>
              Save to Zotero & add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- the sync button ----------

export function syncTitle(st: ZoteroState | null) {
  if (!st) return 'Not synced with Zotero yet';
  return [`Last synced ${ago(st.at)}`, `${st.count} sources`, st.noDetails ? `${st.noDetails} without details` : '', st.error ? `Error: ${st.error}` : ''].filter(Boolean).join(' · ');
}

export function SyncButton({ store, compact, full }: { store: JournalStore; compact?: boolean; full?: boolean }) {
  const z = store.zotero;
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setMsg(null);
    try {
      const r = await z.sync(full);
      const parts = [r.added ? `${r.added} new` : '', r.changed ? `${r.changed} changed` : '', r.removed ? `${r.removed} removed` : ''].filter(Boolean);
      setMsg(parts.length ? parts.join(', ') : 'Up to date');
    } catch (e) {
      setMsg(`Not synced: ${String((e as Error).message)}`);
    }
    window.setTimeout(() => setMsg(null), 6000);
  };
  return (
    <span className="jr-zsync">
      <button type="button" className={`jr-zsync-btn${z.busy ? ' is-busy' : ''}${z.state?.error ? ' is-error' : ''}`} disabled={z.busy} title={syncTitle(z.state)} aria-label={`Sync with Zotero. ${syncTitle(z.state)}`} onClick={() => void run()}>
        <Icon name="refresh" />
        {!compact && <span>{z.busy ? 'Syncing …' : 'Zotero'}</span>}
      </button>
      {msg && (
        <span className="jr-zsync-msg" role="status">
          {msg}
        </span>
      )}
    </span>
  );
}

// ---------- older links matched with the library ----------

const normDoi = (s: string) => (s.match(/10\.\d{4,9}\/[^\s"<>?#]+/i)?.[0] ?? '').replace(/[.,;)\]]+$/, '').toLowerCase();
const normUrl = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '');

interface Match {
  id: string; // entryId/taskId|-/index
  entry: Entry;
  task: string | null;
  index: number;
  src: Source;
  item: ZoteroItem;
  by: 'DOI' | 'address' | 'title';
}
function findMatch(s: Source, items: ZoteroItem[]): { item: ZoteroItem; by: Match['by'] } | null {
  const doi = normDoi(`${s.url} ${s.label}`);
  if (doi) {
    const it = items.find((x) => x.doi === doi);
    if (it) return { item: it, by: 'DOI' };
  }
  const u = s.url ? normUrl(s.url) : '';
  if (u) {
    const it = items.find((x) => x.url && normUrl(x.url) === u);
    if (it) return { item: it, by: 'address' };
  }
  const l = fold(s.label);
  if (l.length >= 12) {
    const it = items.find((x) => {
      const t = fold(x.title);
      return t.length >= 12 && (t.includes(l) || l.includes(t));
    });
    if (it) return { item: it, by: 'title' };
  }
  return null;
}
export function linkMatches(entries: Entry[], zotero: Record<string, ZoteroItem>): { matches: Match[]; open: number } {
  const items = Object.values(zotero);
  const matches: Match[] = [];
  let open = 0;
  for (const e of entries) {
    const lists: [string | null, Source[]][] = [[null, e.sources], ...(e.tasks ?? []).map((t): [string, Source[]] => [t.id, t.sources ?? []])];
    for (const [task, list] of lists)
      list.forEach((src, index) => {
        if (src.zotero) return;
        const m = findMatch(src, items);
        if (m) matches.push({ id: `${e.id}/${task ?? '-'}/${index}`, entry: e, task, index, src, ...m });
        else open++;
      });
  }
  return { matches, open };
}

export function MatchDialog({ store, onClose }: { store: JournalStore; onClose: () => void }) {
  const { matches, open } = useMemo(() => linkMatches(Object.values(store.docs.entries), store.docs.zotero), [store.docs.entries, store.docs.zotero]);
  const [on, setOn] = useState<Set<string>>(() => new Set(matches.filter((m) => m.by !== 'title').map((m) => m.id)));
  const toggle = (id: string) => setOn((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const apply = () => {
    const out = new Map<string, Entry>();
    for (const m of matches) {
      if (!on.has(m.id)) continue;
      const e = out.get(m.entry.id) ?? m.entry;
      const link = (list: Source[]) => list.map((s, i) => (i === m.index ? { ...s, zotero: m.item.key } : s));
      out.set(e.id, m.task ? { ...e, tasks: (e.tasks ?? []).map((t) => (t.id === m.task ? { ...t, sources: link(t.sources ?? []) } : t)) } : { ...e, sources: link(e.sources) });
    }
    if (out.size) void store.commit([...out.values()].map((e): Put => ({ coll: 'entries', id: e.id, data: { ...e, updated: Date.now() } })));
    onClose();
  };
  const taskTitle = (m: Match) => (m.task ? (m.entry.tasks ?? []).find((t) => t.id === m.task)?.title || 'Untitled task' : '');
  return (
    <Modal
      title="Match existing links with Zotero"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="is-primary" disabled={!on.size} onClick={apply}>
            Link {on.size} {on.size === 1 ? 'source' : 'sources'}
          </button>
        </>
      }
    >
      <p className="jr-muted">
        Links found in your entries that match a source in the library, by DOI, web address or title. Linked ones then show Zotero’s current data; the old link stays as a fallback. Matches by title only are not ticked: check them first.
        {open > 0 && ` ${open} other ${open === 1 ? 'link has' : 'links have'} no match and stay${open === 1 ? 's' : ''} as ${open === 1 ? 'it is' : 'they are'}.`}
      </p>
      {!matches.length ? (
        <p className="jr-zpick-note">{Object.keys(store.docs.zotero).length ? 'No link without Zotero matches a source in the library.' : 'The library is not loaded yet: sync with Zotero first.'}</p>
      ) : (
        <ul className="jr-zmatch">
          {matches.map((m) => (
            <li key={m.id}>
              <label>
                <input type="checkbox" checked={on.has(m.id)} onChange={() => toggle(m.id)} />
                <span className="jr-zmatch-body">
                  <span className="jr-zmatch-where">
                    {m.entry.title || 'Untitled'}
                    {m.task && ` · ${taskTitle(m)}`}
                    <span className={`jr-zmatch-by is-${m.by}`}>{m.by}</span>
                  </span>
                  <span className="jr-zmatch-old">{m.src.label || m.src.url}</span>
                  <span className="jr-zmatch-new">
                    → <b>{citeShort(m.item)}</b> {m.item.title}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
