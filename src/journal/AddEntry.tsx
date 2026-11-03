// "New entry": the shared entry form in a drawer from the right, covering about
// 60% of the log (its titles stay readable). The form is kept as a draft in this
// browser while it is written — closing the drawer keeps it, the next "New
// Entry" restores it — and stored only with "Save entry" after "Review entry".
import { useEffect, useRef, useState } from 'react';
import type { JournalStore } from './store';
import { shortDate, type Entry } from './types';
import { EntryForm, formChanges, formEmpty, newEntryForm, type Form } from './EntryForm';
import { EntryView } from './EntryView';
import { Icon, IconBtn } from './ui';

const DRAFT_KEY = 'asciia-journal-draft';
interface Draft {
  v: 2;
  form: Form;
  at: number;
}
function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    return d?.v === 2 && d.form?.entry?.id ? d : null;
  } catch {
    return null;
  }
}
const writeDraft = (f: Form) => {
  try {
    if (formEmpty(f)) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 2, form: f, at: Date.now() } satisfies Draft));
    return true;
  } catch {
    return false;
  }
};
const dropDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing kept */
  }
};
const clock = (at: number) => new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export function AddEntryDrawer({ store, section, onClose, onSaved }: { store: JournalStore; section?: string; onClose: (kept: boolean) => void; onSaved: (e: Entry) => void }) {
  const [restored] = useState(readDraft);
  const [f, setF] = useState<Form>(() => restored?.form ?? newEntryForm(section));
  const [showRestored, setShowRestored] = useState(!!restored);
  const [savedAt, setSavedAt] = useState<number | null>(restored?.at ?? null);
  const [storageOk, setStorageOk] = useState(true);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // the draft, kept in this browser a moment after each change
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const ok = writeDraft(f);
      setStorageOk(ok);
      setSavedAt(ok && !formEmpty(f) ? Date.now() : null);
    }, 500);
    return () => clearTimeout(t);
  }, [f]);

  const close = useRef<() => void>(() => {});
  close.current = () => onClose(!formEmpty(f) && writeDraft(f));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);
  useEffect(() => {
    document.body.classList.add('jr-noscroll');
    if (!restored) titleRef.current?.focus();
    return () => document.body.classList.remove('jr-noscroll');
  }, [restored]);

  const review = () => {
    if (!f.entry.title.trim()) {
      setTitleErr(true);
      titleRef.current?.focus();
      return;
    }
    setStep('review');
    bodyRef.current?.scrollTo(0, 0);
  };
  const save = async () => {
    const { put, del, entry } = formChanges(store, f);
    setBusy(true);
    setErr(null);
    try {
      await store.commit(put, del);
      dropDraft();
      onSaved(entry);
    } catch (x) {
      setErr(`Not saved: ${String((x as Error).message)}. Your draft is still kept in this browser – try again.`);
      setBusy(false);
    }
  };
  const status = !storageOk ? 'Draft cannot be kept in this browser' : savedAt ? `Draft saved · ${clock(savedAt)}` : 'Not saved yet';
  const preview = formChanges(store, f).entry;

  return (
    <>
      <div className="jr-drawer-scrim" onClick={() => !busy && close.current()} />
      <aside className="jr-drawer" role="dialog" aria-modal="true" aria-labelledby="jr-dw-h">
        <header className="jr-drawer-head">
          <div>
            <span className="jr-eyebrow">Project Log</span>
            <h2 id="jr-dw-h">{step === 'review' ? 'Review entry' : 'New entry'}</h2>
            <span className={`jr-dw-status${savedAt ? ' is-saved' : ''}`} role="status">
              {savedAt && <Icon name="check" />}
              {status}
            </span>
          </div>
          <IconBtn icon="x" label="Close (the draft is kept)" onClick={() => !busy && close.current()} />
        </header>

        <div className="jr-drawer-body" ref={bodyRef}>
          {step === 'edit' ? (
            <>
              {showRestored && restored && (
                <p className="jr-dw-restored" role="status">
                  <Icon name="history" />
                  <span>{`Draft restored from ${shortDate(new Date(restored.at).toLocaleDateString('sv-SE'))}, ${clock(restored.at)}.`}</span>
                  <button
                    type="button"
                    className="jr-linkbtn"
                    onClick={() => {
                      if (!confirm('Discard this draft and start an empty entry?')) return;
                      dropDraft();
                      setF(newEntryForm(section));
                      setSavedAt(null);
                      setShowRestored(false);
                    }}
                  >
                    Discard draft
                  </button>
                </p>
              )}
              <EntryForm store={store} f={f} set={(fn) => (setF(fn), setTitleErr(false))} titleErr={titleErr} titleRef={titleRef} />
            </>
          ) : (
            <>
              <EntryView store={store} e={preview} ratings={f.ratings ?? undefined} week={f.week} />
              <p className="jr-muted jr-small">Nothing is stored until “Save entry”. Each task appears on the sections chosen for it.</p>
            </>
          )}
        </div>

        <footer className="jr-drawer-foot">
          {err && (
            <p className="jr-dw-err" role="alert">
              {err}
            </p>
          )}
          {step === 'edit' ? (
            <>
              <button type="button" onClick={() => close.current()}>
                Close
              </button>
              <span className="jr-spacer" />
              <button type="button" className="is-primary" onClick={review}>
                Review entry
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => setStep('edit')}>
                Back to edit
              </button>
              <span className="jr-spacer" />
              <button type="button" className="is-primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving …' : 'Save entry'}
              </button>
            </>
          )}
        </footer>
      </aside>
    </>
  );
}
