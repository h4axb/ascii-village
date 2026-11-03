// ASCIIA BAY · Project Journal (/journal): a hand-kept Overview, one Project
// Log, and pages that show the log's entries by the sections chosen for them.
// An entry is one record: opened from any page (?entry=<id>), edited once.
import { useCallback, useEffect, useState } from 'react';
import './journal.css';
import { useJournal, type Put } from './store';
import { PAGES } from './types';
import { blankEntry, EntryDialog } from './EntryEditor';
import { Overview } from './Overview';
import { EntryList, pageConfig, Timeline } from './pages';
import { Icon, IconBtn } from './ui';

const BASE = '/journal';
const pageOfPath = (p: string) => {
  const seg = p.replace(/^\/journal\/?/, '').replace(/\/$/, '');
  return PAGES.find((x) => x.path === seg)?.id ?? 'overview';
};

export default function JournalApp() {
  const store = useJournal();
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  const [menu, setMenu] = useState(false);
  const [editNav, setEditNav] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof blankEntry> | null>(null);
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((path: string, search = '') => {
    history.pushState(null, '', path + search);
    setLoc({ path, search });
    setMenu(false);
    if (!search) window.scrollTo(0, 0);
  }, []);
  const page = pageOfPath(loc.path);
  const entryId = new URLSearchParams(loc.search).get('entry');
  const openEntry = (id: string) => go(loc.path, `?entry=${encodeURIComponent(id)}`);
  const closeEntry = () => go(loc.path);

  const nav = PAGES.map((p) => pageConfig(store, p.id)).sort((a, b) => a.order - b.order);
  const title = nav.find((p) => p.id === page)?.title ?? 'Overview';
  useEffect(() => {
    document.title = `${title} · ASCIIA BAY Journal`;
  }, [title]);

  if (store.state === 'locked') return <Login onSubmit={store.signIn} />;
  if (store.state === 'loading') return <div className="jr-root jr-center">Loading …</div>;
  if (store.state === 'error')
    return (
      <div className="jr-root jr-center">
        <p>{`The journal could not be loaded: ${store.error}`}</p>
        <button type="button" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );

  const moveNav = (i: number, d: number) => {
    const a = nav[i],
      b = nav[i + d];
    if (!b) return;
    const put: Put[] = [
      { coll: 'pages', id: a.id, data: { ...a, order: b.order } },
      { coll: 'pages', id: b.id, data: { ...b, order: a.order } },
    ];
    void store.commit(put);
  };
  const entry = entryId ? store.docs.entries[entryId] : null;
  const pathOf = (id: string) => `${BASE}${PAGES.find((p) => p.id === id)?.path ? `/${PAGES.find((p) => p.id === id)!.path}` : ''}`;

  return (
    <div className={`jr-root${menu ? ' is-menu' : ''}`}>
      <header className="jr-topbar">
        <button type="button" className="jr-iconbtn jr-menubtn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Icon name="menu" />
        </button>
        <span className="jr-topbar-title">{title}</span>
      </header>
      <nav className="jr-side" aria-label="Journal">
        <a className="jr-brand" href={BASE} onClick={(e) => (e.preventDefault(), go(BASE))}>
          ASCIIA BAY
          <span>Project Journal</span>
        </a>
        <ul>
          {nav
            .filter((p) => editNav || !p.hidden)
            .map((p, i) => (
              <li key={p.id} className={`${p.id === page ? 'is-active' : ''}${p.hidden ? ' is-hidden' : ''}`}>
                <a href={pathOf(p.id)} onClick={(e) => (e.preventDefault(), go(pathOf(p.id)))} aria-current={p.id === page ? 'page' : undefined}>
                  {p.title}
                </a>
                {editNav && (
                  <span className="jr-navtools">
                    <IconBtn icon="up" label={`Move ${p.title} up`} disabled={i === 0} onClick={() => moveNav(i, -1)} />
                    <IconBtn icon="down" label={`Move ${p.title} down`} disabled={i === nav.length - 1} onClick={() => moveNav(i, 1)} />
                    {p.id !== 'overview' && <IconBtn icon={p.hidden ? 'eye' : 'eyeoff'} label={p.hidden ? `Show ${p.title}` : `Hide ${p.title}`} onClick={() => void store.commit([{ coll: 'pages', id: p.id, data: { ...p, hidden: !p.hidden } }])} />}
                  </span>
                )}
              </li>
            ))}
        </ul>
        <div className="jr-side-foot">
          <button type="button" className="jr-linkbtn" onClick={() => setEditNav(!editNav)}>
            {editNav ? 'Done' : 'Edit pages'}
          </button>
          <span className="jr-muted jr-small" role="status">
            {store.saving ? 'Saving …' : 'Saved'}
          </span>
          <a className="jr-muted jr-small" href="/feedback">
            Usertesting dashboard →
          </a>
        </div>
      </nav>
      {menu && <div className="jr-scrim" onClick={() => setMenu(false)} />}
      <main className="jr-main">
        {store.error && (
          <p className="jr-banner" role="alert">
            {store.error}
          </p>
        )}
        {page === 'overview' ? (
          <Overview store={store} openEntry={openEntry} newEntry={(s) => setDraft(blankEntry(s))} go={go} />
        ) : page === 'timeline' ? (
          <Timeline store={store} openEntry={openEntry} />
        ) : (
          <EntryList key={page} store={store} page={page} openEntry={openEntry} newEntry={(s) => setDraft(blankEntry(s))} />
        )}
      </main>
      {entry && <EntryDialog key={entry.id} store={store} entry={entry} onClose={closeEntry} />}
      {entryId && !entry && (
        <div className="jr-banner is-floating" role="alert">
          This entry no longer exists.{' '}
          <button type="button" className="jr-linkbtn" onClick={closeEntry}>
            Close
          </button>
        </div>
      )}
      {draft && <EntryDialog key={draft.id} store={store} entry={draft} isNew onClose={() => setDraft(null)} />}
    </div>
  );
}

function Login({ onSubmit }: { onSubmit: (p: string) => Promise<void> }) {
  const [p, setP] = useState('');
  return (
    <div className="jr-root jr-center">
      <form
        className="jr-login"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(p);
        }}
      >
        <h1>ASCIIA BAY · Project Journal</h1>
        <p className="jr-muted">Sign in with the dashboard password.</p>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} aria-label="Password" autoFocus />
        <button type="submit" className="is-primary" disabled={!p.trim()}>
          Open journal
        </button>
      </form>
    </div>
  );
}
