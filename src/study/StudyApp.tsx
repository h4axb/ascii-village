// /feedback: the user test's evaluation for the thesis. Six pages in a
// sidebar (a drawer on phones), one participant filter for all of them, and
// one model (model.ts) recomputed on every change.
import { useEffect, useMemo, useRef, useState } from 'react';
import { setLang, useLang, useTranslator } from './i18n';
import { buildModel, omit, slice as sliceOf, type Scope } from './model';
import { useStudy } from './store';
import { StudyCtx } from './ui';
import Overview from './pages/Overview';
import Survey from './pages/Survey';
import Notes, { ContentSwitch, Priority, Tags } from './pages/Notes';
import Findings from './pages/Findings';
import Codes from './pages/Codes';
import People from './pages/People';
import Data from './pages/Data';
import Results from './pages/Results';
import { GameReview } from './GameReview';
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
      { id: 'codes', title: 'Codes' },
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
// participants left out of "Alle" (ticked off in the participants menu)
const OMIT_KEY = 'asciia-study-omit';
function readOmit(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OMIT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function readScope(): string {
  try {
    return localStorage.getItem(SCOPE_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

// the scroll position of this tab, so a reload comes back to it (the page
// loads its data first, too late for the browser's own restoring)
const SCROLL_KEY = 'asciia-study-scroll';
function readScroll(): { route: string; y: number } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null') as { route?: unknown; y?: unknown } | null;
    return v && typeof v.route === 'string' && typeof v.y === 'number' ? { route: v.route, y: v.y } : null;
  } catch {
    return null;
  }
}
const savedScroll = readScroll();

export default function StudyApp() {
  const study = useStudy();
  const [[page, sub], setRoute] = useState(readHash);
  const [scopeKey, setScopeKey] = useState(readScope);
  const [omitIds, setOmitIds] = useState(readOmit);
  const [drawer, setDrawer] = useState(false);
  const [typed, setTyped] = useState('');
  const lang = useLang();
  const rootRef = useRef<HTMLDivElement>(null);
  useTranslator(rootRef, lang);

  useEffect(() => {
    document.title = lang === 'en' ? 'User test evaluation' : 'Auswertung Usertest';
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [lang]);
  // a sub-page that is a section: scroll to it (not on a reload that restores its place)
  const restoring = useRef(!!savedScroll && savedScroll.route === window.location.hash && savedScroll.y > 0);
  useEffect(() => {
    if (restoring.current) return;
    const p = PAGES.find((x) => x.id === page);
    if (sub && p?.sub?.find((s) => s.id === sub)?.anchor) window.setTimeout(() => document.getElementById(sub)?.scrollIntoView({ block: 'start' }), 50);
    else window.scrollTo(0, 0);
  }, [page, sub]);

  // remember the place (from when the page is shown, so the loading screen's 0 never counts)
  const ready = study.state === 'ready';
  useEffect(() => {
    if (!ready) return;
    try {
      history.scrollRestoration = 'manual';
    } catch {
      // (the browser's own)
    }
    let frame = 0;
    const save = () => {
      if (restoring.current) return;
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ route: window.location.hash, y: Math.round(window.scrollY) }));
      } catch {
        // (not remembered)
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(save);
    };
    // back to the saved place: the figures grow after the first paint, so try until it fits
    if (restoring.current && savedScroll) {
      const target = savedScroll.y;
      const until = Date.now() + 1500;
      const stop = () => {
        restoring.current = false;
        for (const t of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(t, stop);
      };
      for (const t of ['wheel', 'touchstart', 'keydown']) window.addEventListener(t, stop, { passive: true });
      const step = () => {
        if (!restoring.current) return;
        window.scrollTo(0, target);
        if (Math.abs(window.scrollY - target) < 2 || Date.now() > until) stop();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
    };
  }, [ready]);

  const model = useMemo(() => buildModel(study.docs, study.game), [study.docs, study.game]);
  const scope: Scope = useMemo(() => {
    if (scopeKey === 'all') return { kind: 'all' };
    const link = model.links.find((l) => l.key === scopeKey);
    if (link && link.label !== link.person) return { kind: 'link', id: link.label, key: link.key };
    if (model.included.some((p) => p.id === scopeKey)) return { kind: 'person', id: scopeKey };
    return { kind: 'all' };
  }, [scopeKey, model]);
  // (only ids still among the participants; a single person or link shows in full)
  const omitted = useMemo(() => (scope.kind === 'all' ? omitIds.filter((id) => model.included.some((p) => p.id === id)) : []), [omitIds, model, scope]);
  const slice = useMemo(() => omit(sliceOf(model, scope), omitted), [model, scope, omitted]);
  const setOmit = (ids: string[]) => {
    setOmitIds(ids);
    try {
      localStorage.setItem(OMIT_KEY, JSON.stringify(ids));
    } catch {
      // (not remembered)
    }
  };
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
        return sub === 'prioritaet' ? <Priority /> : sub === 'befunde' ? <Findings /> : sub === 'codes' ? <Codes /> : sub === 'tags' ? <Tags /> : <Notes />;
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
    <StudyCtx.Provider value={{ study, model, scope, slice, omitted, resetFilter: () => (setScope('all'), setOmit([])) }}>
      {/* (a language change rebuilds the page, so the translator starts from the German text) */}
      <div key={lang} ref={rootRef} className={`st-root st-app${drawer ? ' has-drawer' : ''}`} lang={lang}>
        {study.viewing && (
          <div className="st-viewbar" role="status">
            <strong>
              Gespeicherter Stand{study.viewing.at ? ` vom ${new Date(study.viewing.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
            </strong>
            {study.viewing.reason && <span data-notr>{study.viewing.reason}</span>}
            <span>nur ansehen</span>
            <span className="st-selbar-gap" />
            <a href={`/feedback?restore=${encodeURIComponent(study.viewing.id)}#daten`}>Wiederherstellen …</a>
            <a href={`/feedback${window.location.hash}`}>Zum aktuellen Stand</a>
          </div>
        )}
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
            <span className="st-build" title="Version des Dashboards (Commit · Bauzeit, deutsche Zeit)" data-notr>
              Version {__STUDY_BUILD__.split(' · ')[0]} · {(() => {
                const t = Date.parse(__STUDY_BUILD__.split(' · ')[1] ?? '');
                return Number.isFinite(t) ? new Date(t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
              })()}
            </span>
            {study.saveError && <span className="st-flag">{study.saveError}</span>}
            <div className="st-seg st-lang" role="group" aria-label="Sprache / Language">
              <button type="button" className={lang === 'de' ? 'is-on' : ''} onClick={() => setLang('de')}>
                DE
              </button>
              <button type="button" className={lang === 'en' ? 'is-on' : ''} onClick={() => setLang('en')}>
                EN
              </button>
            </div>
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
            <div className="st-pagetools">
            <ContentSwitch />
            <ScopePicker model={model} scope={scope} omitted={omitted} onScope={setScope} onOmit={setOmit} />
            </div>
          </div>
          <GameReview />
          {body}
        </main>
      </div>
    </StudyCtx.Provider>
  );
}

// the participants menu: all (each with a checkbox to leave them out), or
// one person or one of their links alone
function ScopePicker({ model, scope, omitted, onScope, onOmit }: { model: ReturnType<typeof buildModel>; scope: Scope; omitted: string[]; onScope: (k: string) => void; onOmit: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  const n = model.included.length;
  const label = scope.kind !== 'all' ? scope.id : omitted.length ? `${n - omitted.length} von ${n}` : `Alle (${n})`;
  const toggle = (id: string, on: boolean) => {
    if (scope.kind !== 'all') onScope('all');
    onOmit(on ? omitted.filter((x) => x !== id) : [...omitted, id]);
  };
  return (
    <div className="st-scope" ref={ref}>
      <span>Teilnehmende</span>
      <button type="button" className={`st-scope-btn${omitted.length || scope.kind !== 'all' ? ' is-on' : ''}`} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        {label} ▾
      </button>
      {open && (
        <div className="st-scope-menu" role="dialog" aria-label="Teilnehmende">
          <label className="st-scope-row is-all">
            <input type="checkbox" checked={scope.kind === 'all' && !omitted.length} ref={(el) => el && (el.indeterminate = scope.kind === 'all' && omitted.length > 0 && omitted.length < n)} onChange={(e) => (onScope('all'), onOmit(e.target.checked ? [] : model.included.map((p) => p.id)))} />
            Alle ({n})
          </label>
          {model.included.map((p) => (
            <div key={p.id}>
              <div className={`st-scope-row${scope.kind === 'person' && scope.id === p.id ? ' is-current' : ''}`}>
                <input type="checkbox" checked={scope.kind === 'all' ? !omitted.includes(p.id) : scope.kind === 'person' ? scope.id === p.id : false} onChange={(e) => toggle(p.id, e.target.checked)} aria-label={`${p.id} einbeziehen`} />
                <span className="st-pid">{p.id}</span>
                <button type="button" className="st-linkbtn" onClick={() => (onScope(p.id), setOpen(false))}>
                  nur diese
                </button>
              </div>
              {p.links.length > 1 &&
                p.links.map((l) => (
                  <div key={l.key} className={`st-scope-row is-link${scope.kind === 'link' && scope.key === l.key ? ' is-current' : ''}`}>
                    <span className="st-muted">{l.label}</span>
                    <button type="button" className="st-linkbtn" onClick={() => (onScope(l.key), setOpen(false))}>
                      nur dieser Link
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
