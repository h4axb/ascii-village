// The journal's small building blocks: inline editing of short fields,
// Markdown fields (read, edit, preview), a dialog, attachments, the
// private/shared switch. Every field can be edited; nothing is locked.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Markdown } from './markdown';
import { fileBlobUrl, type JournalStore } from './store';
import type { FileMeta, Source, Visibility } from './types';

export function Icon({ name }: { name: 'edit' | 'up' | 'down' | 'trash' | 'eye' | 'eyeoff' | 'plus' | 'x' | 'menu' | 'lock' | 'globe' | 'clip' | 'link' | 'history' | 'minus' | 'check' | 'calendar' | 'target' | 'hourglass' | 'flag' | 'layers' | 'sprout' | 'doc' | 'flask' | 'branch' | 'scale' | 'chat' | 'list' | 'grid' | 'filter' | 'more' | 'expand' | 'search' | 'note' }) {
  const d: Record<string, string> = {
    edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
    eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.2 6.3C3.6 8.1 2 12 2 12s4 7 10 7a10 10 0 004.2-.9',
    plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    menu: 'M4 7h16M4 12h16M4 17h16',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
    globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    clip: 'M15 7l-6.5 6.5a2 2 0 003 3L18 10a4 4 0 00-6-6l-6.5 6.5a6 6 0 008.5 8.5L20 13',
    link: 'M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1',
    history: 'M3 12a9 9 0 103-6.7L3 8M3 3v5h5M12 7v5l3 2',
    minus: 'M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
    target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11.5v1',
    hourglass: 'M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9',
    flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
    layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
    doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    flask: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7.5 15h9',
    branch: 'M12 21v-6M12 15l-6-5M12 15l6-5M6 10a2 2 0 100-4 2 2 0 000 4zM18 10a2 2 0 100-4 2 2 0 000 4zM12 21a1.5 1.5 0 100-3',
    scale: 'M12 4v16M7 20h10M5 7h14M5 7l-3 6a3 3 0 006 0L5 7zM19 7l-3 6a3 3 0 006 0l-3-6z',
    chat: 'M4 5h16v11H9l-5 4z',
    list: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    filter: 'M4 5h16l-6 8v6l-4-2v-4z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
    search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
    note: 'M5 4h14v16H5zM9 9h6M9 13h6',
    sprout: 'M12 21v-8M12 13c0-4 3-7 8-7 0 4-3 7-8 7zM12 13c0-3-2-5-6-5 0 3 2 5 6 5z',
  };
  return (
    <svg className="jr-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d[name]} />
    </svg>
  );
}

export function IconBtn({ icon, label, onClick, disabled, danger }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className={`jr-iconbtn${danger ? ' is-danger' : ''}`} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

// a short field shown as text, edited in place (Enter saves, Esc cancels)
export function InlineText({ value, onSave, placeholder, className, as = 'span', label, type = 'text' }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string; as?: 'span' | 'h1' | 'h2' | 'h3'; label: string; type?: 'text' | 'date' | 'month' }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (edit)
    return (
      <span className={`jr-inline is-editing ${className ?? ''}`}>
        <input
          autoFocus
          type={type}
          value={v}
          aria-label={label}
          placeholder={placeholder}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSave(v.trim());
              setEdit(false);
            }
            if (e.key === 'Escape') {
              setV(value);
              setEdit(false);
            }
          }}
          onBlur={() => {
            if (v.trim() !== value) onSave(v.trim());
            setEdit(false);
          }}
        />
      </span>
    );
  const Tag = as;
  return (
    <Tag className={`jr-inline ${className ?? ''}`}>
      <button type="button" className="jr-inline-btn" onClick={() => setEdit(true)} title={`Edit ${label.toLowerCase()}`}>
        {value || <span className="jr-muted">{placeholder ?? 'Add …'}</span>}
      </button>
    </Tag>
  );
}

// a Markdown field: read, or edit with a preview; Save / Cancel
export function MdField({ md, onSave, placeholder, rows = 6, label }: { md: string; onSave: (v: string) => void; placeholder?: string; rows?: number; label: string }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(md);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!edit) setV(md);
  }, [md, edit]);
  if (!edit)
    return (
      <div className="jr-mdfield">
        {md.trim() ? <Markdown md={md} /> : <p className="jr-muted">{placeholder ?? 'Nothing written yet.'}</p>}
        <button type="button" className="jr-linkbtn" onClick={() => setEdit(true)}>
          <Icon name="edit" /> Edit {label.toLowerCase()}
        </button>
      </div>
    );
  const dirty = v !== md;
  return (
    <div className="jr-mdfield is-editing">
      <MdEditor value={v} onChange={setV} rows={rows} preview={preview} setPreview={setPreview} label={label} placeholder={placeholder} />
      <div className="jr-actions">
        <button
          type="button"
          onClick={() => {
            if (dirty && !confirm('Discard the changes?')) return;
            setV(md);
            setEdit(false);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={!dirty}
          onClick={() => {
            onSave(v);
            setEdit(false);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function MdEditor({ value, onChange, rows = 6, preview, setPreview, label, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; preview: boolean; setPreview: (b: boolean) => void; label: string; placeholder?: string }) {
  return (
    <div className="jr-mdedit">
      <div className="jr-mdedit-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!preview} className={!preview ? 'is-on' : ''} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? 'is-on' : ''} onClick={() => setPreview(true)}>
          Preview
        </button>
        <span className="jr-muted jr-mdhint">Markdown: **bold**, - list, [ ] / [x], [link](https://…)</span>
      </div>
      {preview ? (
        <div className="jr-mdpreview">{value.trim() ? <Markdown md={value} /> : <p className="jr-muted">Nothing to preview.</p>}</div>
      ) : (
        <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder} spellCheck />
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // the latest onClose, without re-running the effect: a new onClose every
  // render used to move the focus back to the dialog after each keystroke
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('jr-noscroll');
    // focus the dialog once, on opening, unless a field asked for it (autoFocus)
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('jr-noscroll');
    };
  }, []);
  return (
    <div className="jr-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`jr-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <header className="jr-modal-head">
          <h2>{title}</h2>
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="jr-modal-body">{children}</div>
        {footer && <footer className="jr-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function VisibilitySwitch({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <button
      type="button"
      className={`jr-vis is-${value}`}
      onClick={() => onChange(value === 'private' ? 'shared' : 'private')}
      title={value === 'private' ? 'Private: only you. Click to mark for a shared view (nothing is published yet).' : 'Marked for a shared view (nothing is published yet). Click to make private.'}
    >
      <Icon name={value === 'private' ? 'lock' : 'globe'} />
      {value === 'private' ? 'Private' : 'Shared'}
    </button>
  );
}

// a chip list with toggles; suggested ones dashed, added with one click
export function Chips({ all, chosen, suggested = [], onToggle, label }: { all: { id: string; label: string }[]; chosen: string[]; suggested?: string[]; onToggle: (id: string) => void; label: string }) {
  return (
    <div className="jr-chips" role="group" aria-label={label}>
      {all.map((c) => {
        const on = chosen.includes(c.id);
        const sug = !on && suggested.includes(c.id);
        return (
          <button key={c.id} type="button" className={`jr-chip${on ? ' is-on' : ''}${sug ? ' is-suggested' : ''}`} aria-pressed={on} onClick={() => onToggle(c.id)} title={sug ? 'Suggested from the type and content – click to add' : undefined}>
            {sug && <Icon name="plus" />}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

// a file: images shown, others as a link (fetched with the password)
export function FileThumb({ meta, onRemove }: { meta: FileMeta; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const image = /^image\//.test(meta.type);
  useEffect(() => {
    let u: string | null = null;
    if (image)
      void fileBlobUrl(meta.id)
        .then((x) => setUrl((u = x)))
        .catch(() => setErr(true));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [meta.id, image]);
  const open = async () => {
    try {
      const u = url ?? (await fileBlobUrl(meta.id));
      const a = document.createElement('a');
      a.href = u;
      a.target = '_blank';
      if (!/^image\/|pdf$/.test(meta.type)) a.download = meta.name;
      a.rel = 'noreferrer';
      a.click();
    } catch {
      setErr(true);
    }
  };
  return (
    <div className="jr-file">
      <button type="button" className="jr-file-open" onClick={() => void open()} title={`Open ${meta.name}`}>
        {image && url ? <img src={url} alt={meta.name} /> : <span className="jr-file-icon"><Icon name="clip" /></span>}
        <span className="jr-file-name">{meta.name}</span>
        <span className="jr-muted">{err ? 'not available' : `${Math.max(1, Math.round(meta.size / 1024))} KB`}</span>
      </button>
      {onRemove && <IconBtn icon="trash" label={`Remove ${meta.name}`} danger onClick={onRemove} />}
    </div>
  );
}

// attachments: uploaded files and links, both editable
export function Attachments({ store, files, links, onChange }: { store: JournalStore; files: string[]; links: Source[]; onChange: (files: string[], links: Source[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="jr-attach">
      {files.length > 0 && (
        <div className="jr-files">
          {files.map((id) =>
            store.docs.files[id] ? (
              <FileThumb
                key={id}
                meta={store.docs.files[id]}
                onRemove={() => {
                  if (!confirm(`Remove ${store.docs.files[id].name}? The file is deleted.`)) return;
                  onChange(
                    files.filter((x) => x !== id),
                    links,
                  );
                  void store.removeFile(id);
                }}
              />
            ) : null,
          )}
        </div>
      )}
      {links.length > 0 && (
        <ul className="jr-links">
          {links.map((l, i) => (
            <li key={i}>
              <Icon name="link" />
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.label || l.url}
              </a>
              <IconBtn icon="trash" label="Remove link" danger onClick={() => onChange(files, links.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}
      <div className="jr-attach-add">
        <label className="jr-btn">
          <Icon name="clip" /> Upload file
          <input
            type="file"
            multiple
            onChange={async (e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = '';
              const ids: string[] = [];
              for (const f of list) {
                setBusy(`Uploading ${f.name} …`);
                try {
                  ids.push((await store.upload(f)).id);
                } catch (err) {
                  setBusy(`${f.name}: ${String((err as Error).message)}`);
                  return;
                }
              }
              setBusy(null);
              onChange([...files, ...ids], links);
            }}
          />
        </label>
        <span className="jr-attach-link">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Link name" aria-label="Link name" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link address" />
          <button
            type="button"
            disabled={!/^https?:\/\/\S+/.test(url.trim())}
            onClick={() => {
              onChange(files, [...links, { label: name.trim(), url: url.trim() }]);
              setUrl('');
              setName('');
            }}
          >
            Add link
          </button>
        </span>
      </div>
      {busy && <p className="jr-muted" role="status">{busy}</p>}
    </div>
  );
}
