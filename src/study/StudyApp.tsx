// /feedback: the user test's evaluation for the thesis. Six pages in a
// sidebar (a drawer on phones), one participant filter for all of them, and
// one model (model.ts) recomputed on every change.
import { useEffect, useMemo, useState } from 'react';
import { buildModel, slice as sliceOf, type Scope } from './model';
import { useStudy } from './store';
import { StudyCtx } from './ui';
import Overview from './pages/Overview';
import Survey from './pages/Survey';
import Notes, { Priority, Tags } from './pages/Notes';
import Findings from './pages/Findings';
import People from './pages/People';
import Data from './pages/Data';
import Results from './pages/Results';
import './study.css';

interface Page {
  id: string;
  title: string;
  sub?: { id: string; title: string; anchor?: boolean }[];
}
const PAGES: Page[] = [
  { id: 'uebersicht', title: 'Übersicht' },
  {
    id: 'quantitativ',
    title: 'Quantitative Analyse',
    sub: [
      { id: 'teil1', title: 'Direkter Vergleich', anchor: true },
      { id: 'teil2', title: 'Likert-Skalen', anchor: true },
      { id: 'teil3', title: 'UEQ-S', anchor: true },
      { id: 'spiel', title: 'Ratings & Telemetrie', anchor: true },
    ],
  },
  {
    id: 'qualitativ',
    title: 'Qualitatives Feedback',
    sub: [
      { id: 'prioritaet', title: 'Nach Priorität' },
      { id: 'befunde', title: 'Wiederkehrende Befunde' },
      { id: 'tags', title: 'Tags' },
    ],
  },
  { id: 'teilnehmende', title: 'Teilnehmende & Sessions' },
  { id: 'daten', title: 'Daten & Validierung' },
  { id: 'ergebnisse', title: 'Ergebnisse & Export' },
];
const SUB_TITLE: Record<string, string> = { '': 'Aussagen' };

function readHash(): [string, string] {
  const [p, s] = window.location.hash.replace(/^#/, '').split('/');
  return [PAGES.some((x) => x.id === p) ? p : 'uebersicht', s ?? ''];
}

const SCOPE_KEY = 'asciia-study-scope';
function readScope(): string {
  try {
    return localStorage.getItem(SCOPE_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

export default function StudyApp() {
  const study = useStudy();
  const [[page, sub], setRoute] = useState(readHash);
  const [scopeKey, setScopeKey] = useState(readScope);
  const [drawer, setDrawer] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    document.title = 'Auswertung Usertest';
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // a sub-page that is a section: scroll to it
  useEffect(() => {
    const p = PAGES.find((x) => x.id === page);
    if (sub && p?.sub?.find((s) => s.id === sub)?.anchor) window.setTimeout(() => document.getElementById(sub)?.scrollIntoView({ block: 'start' }), 50);
    else window.scrollTo(0, 0);
  }, [page, sub]);

  const model = useMemo(() => buildModel(study.docs, study.game), [study.docs, study.game]);
  const scope: Scope = useMemo(() => {
    if (scopeKey === 'all') return { kind: 'all' };
    const link = model.links.find((l) => l.key === scopeKey);
    if (link && link.label !== link.person) return { kind: 'link', id: link.label, key: link.key };
    if (model.included.some((p) => p.id === scopeKey)) return { kind: 'person', id: scopeKey };
    return { kind: 'all' };
  }, [scopeKey, model]);
  const slice = useMemo(() => sliceOf(model, scope), [model, scope]);
  const setScope = (k: string) => {
    setScopeKey(k);
    try {
      localStorage.setItem(SCOPE_KEY, k);
    } catch {
      // (not remembered)
    }
  };

  if (study.state === 'locked' || (study.state === 'error' && !study.pass)) {
    return (
      <div className="st-root st-login">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void study.load(typed);
          }}
        >
          <h1>Auswertung Usertest</h1>
          <input type="password" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Passwort" autoFocus />
          <button type="submit">Öffnen</button>
          {study.error && <p className="st-flag">{study.error}</p>}
        </form>
      </div>
    );
  }
  if (study.state === 'loading') return <div className="st-root st-loading">Laden …</div>;
  if (study.state === 'error') return <div className="st-root st-loading">{study.error}</div>;

  const current = PAGES.find((p) => p.id === page)!;
  const go = (p: string, s = '') => {
    window.location.hash = s ? `${p}/${s}` : p;
    setDrawer(false);
  };
  const body = (() => {
    switch (page) {
      case 'quantitativ':
        return <Survey />;
      case 'qualitativ':
        return sub === 'prioritaet' ? <Priority /> : sub === 'befunde' ? <Findings /> : sub === 'tags' ? <Tags /> : <Notes />;
      case 'teilnehmende':
        return <People />;
      case 'daten':
        return <Data />;
      case 'ergebnisse':
        return <Results />;
      default:
        return <Overview />;
    }
  })();
  const subTitle = current.sub?.find((s) => s.id === sub && !s.anchor)?.title ?? (page === 'qualitativ' ? SUB_TITLE[''] : null);

  return (
    <StudyCtx.Provider value={{ study, model, scope, slice }}>
      <div className={`st-root st-app${drawer ? ' has-drawer' : ''}`}>
        <header className="st-topbar">
          <button type="button" className="st-menu" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} aria-controls="st-nav">
            Menü
          </button>
          <span>{current.title}</span>
        </header>
        <nav id="st-nav" className="st-nav">
          <div className="st-brand">Auswertung Usertest</div>
          <ul>
            {PAGES.map((p) => (
              <li key={p.id}>
                <a
                  href={`#${p.id}`}
                  className={page === p.id && !sub ? 'is-current' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    go(p.id);
                  }}
                >
                  {p.title}
                </a>
                {p.sub && (
                  <ul>
                    {p.sub.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${p.id}/${s.id}`}
                          className={page === p.id && sub === s.id ? 'is-current' : ''}
                          onClick={(e) => {
                            e.preventDefault();
                            if (page === p.id && sub === s.id && s.anchor) document.getElementById(s.id)?.scrollIntoView({ block: 'start' });
                            go(p.id, s.id);
                          }}
                        >
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <div className="st-navfoot">
            <span>{study.saving ? 'Speichern …' : study.saveError ? '' : 'Gespeichert'}</span>
            {study.saveError && <span className="st-flag">{study.saveError}</span>}
            <a href="/2/feedback">/2/feedback</a>
          </div>
        </nav>
        {drawer && <div className="st-scrim" onClick={() => setDrawer(false)} />}
        <main className="st-main">
          <div className="st-pagehead">
            <h1>
              {current.title}
              {subTitle && <span className="st-subtitle"> · {subTitle}</span>}
            </h1>
            <label className="st-scope">
              <span>Teilnehmende</span>
              <select value={scope.kind === 'all' ? 'all' : scope.kind === 'link' ? scope.key : scope.id} onChange={(e) => setScope(e.target.value)}>
                <option value="all">Alle ({model.included.length})</option>
                {model.included.map((p) => [
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>,
                  ...(p.links.length > 1
                    ? p.links.map((l) => (
                        <option key={l.key} value={l.key}>
                          {`  ${l.label}`}
                        </option>
                      ))
                    : []),
                ])}
              </select>
            </label>
          </div>
          {body}
        </main>
      </div>
    </StudyCtx.Provider>
  );
}
