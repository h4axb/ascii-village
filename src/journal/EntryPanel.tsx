// One entry in the right-side overlay (about 60% of the page, the list's titles
// stay readable beside it). It opens to read; "Edit" makes the whole entry
// editable at once — title, date, tasks and their times, sections, tags and
// blocks, the check-in, the weekly review, references — and "Save" stores it
// all in one go. It is always the one record: a task's change shows on every
// section page the task is assigned to.
import { useEffect, useRef, useState } from 'react';
import type { JournalStore } from './store';
import type { Entry } from './types';
import { EntryDialog } from './EntryEditor';
import { EntryForm, formChanges, formOf, type Form } from './EntryForm';
import { EntryView, type EditAt } from './EntryView';
import { Icon, IconBtn } from './ui';

export function EntryPanel({ store, entry: e, focusTask, onClose }: { store: JournalStore; entry: Entry; focusTask: string | null; onClose: () => void }) {
  const [f, setF] = useState<Form | null>(null); // editing
  const [start, setStart] = useState('');
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dirty = !!f && JSON.stringify(f) !== start;

  const edit = (at: EditAt = {}) => {
    const nf = formOf(e, at);
    setF(nf);
    setStart(JSON.stringify(nf));
    setErr(null);
    setMenu(false);
  };
  const leave = () => !dirty || confirm('Discard the changes to this entry?');
  const close = useRef<() => void>(() => {});
  close.current = () => {
    if (busy || history) return;
    if (f) {
      if (leave()) setF(null);
      return;
    }
    onClose();
  };
  useEffect(() => {
    const onKey = (x: KeyboardEvent) => x.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('jr-noscroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('jr-noscroll');
    };
  }, []);
  const editing = !!f;
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [editing]);

  const save = async () => {
    if (!f) return;
    if (!f.entry.title.trim()) {
      setTitleErr(true);
      bodyRef.current?.scrollTo(0, 0);
      return;
    }
    const { put, del } = formChanges(store, f);
    setBusy(true);
    setErr(null);
    try {
      await store.commit(put, del);
      setF(null);
    } catch (x) {
      setErr(`Not saved: ${String((x as Error).message)}. Your changes are still here – try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="jr-drawer-scrim" onClick={() => (f ? undefined : close.current())} />
      <aside className="jr-drawer is-entry" role="dialog" aria-modal="true" aria-label={`Entry: ${e.title}`}>
        <header className="jr-drawer-head">
          <div>
            <span className="jr-eyebrow">{f ? 'Project Log · editing' : 'Project Log · entry'}</span>
            {f && <h2>Edit entry</h2>}
          </div>
          <span className="jr-panel-tools">
            {!f && (
              <>
                <button type="button" className="is-primary jr-editbtn" onClick={() => edit()}>
                  <Icon name="edit" /> Edit
                </button>
                <span className="jr-menuwrap">
                  <IconBtn icon="more" label="More" onClick={() => setMenu(!menu)} />
                  {menu && (
                    <span className="jr-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                      <button type="button" className="jr-menu-item" role="menuitem" onClick={() => (setMenu(false), setHistory(true))}>
                        Edit history
                      </button>
                      <button
                        type="button"
                        className="jr-menu-item is-danger"
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          if (!confirm(`Delete “${e.title}” with all its tasks? It disappears from every page. (Its earlier states stay in the edit history.)`)) return;
                          onClose();
                          void store.commit([], [{ coll: 'entries', id: e.id }]);
                        }}
                      >
                        Delete entry
                      </button>
                    </span>
                  )}
                </span>
              </>
            )}
            <IconBtn icon="x" label={f ? 'Stop editing' : 'Close'} onClick={() => close.current()} />
          </span>
        </header>

        <div className="jr-drawer-body" ref={bodyRef}>
          {f ? <EntryForm store={store} f={f} set={(fn) => (setF((x) => (x ? fn(x) : x)), setTitleErr(false))} titleErr={titleErr} /> : <EntryView key={focusTask ?? ''} store={store} e={e} focusTask={focusTask} onEdit={edit} />}
        </div>

        <footer className="jr-drawer-foot">
          {err && (
            <p className="jr-dw-err" role="alert">
              {err}
            </p>
          )}
          {f ? (
            <>
              <button type="button" disabled={busy} onClick={() => leave() && setF(null)}>
                Cancel
              </button>
              <span className="jr-muted jr-small">{dirty ? 'Unsaved changes' : 'No changes yet'}</span>
              <span className="jr-spacer" />
              <button type="button" className="is-primary" disabled={busy || !dirty} onClick={() => void save()}>
                {busy ? 'Saving …' : 'Save'}
              </button>
            </>
          ) : (
            <span className="jr-muted jr-small jr-saved-line">
              {`Last edited ${new Date(e.updated).toLocaleString('en-GB', { timeZone: 'Europe/Berlin', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
              <span className={store.saving ? '' : 'is-saved'}>
                {!store.saving && <Icon name="check" />}
                {store.saving ? 'Saving …' : 'Saved'}
              </span>
            </span>
          )}
        </footer>
      </aside>
      {history && <EntryDialog store={store} entry={e} onClose={() => setHistory(false)} />}
    </>
  );
}
