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
  {
    id: 'daten',
    title: 'Daten & Validierung',
    sub: [
      { id: 'zuordnung', title: 'Zuordnung & Einstellungen' },
      { id: 'pruefung', title: 'Prüfungen' },
      { id: 'versionen', title: 'Versionen & Protokoll' },
    ],
  },
  { id: 'ergebnisse', title: 'Ergebnisse & Export' },
];
// (the page itself, when it has sub-pages: what its first view is called)
const SUB_TITLE: Record<string, string> = { qualitativ: 'Aussagen', daten: 'Hochladen' };

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

// the scroll place of each page in this tab, so a reload or a way back comes to
// it again. Kept as the element at the top of the window ([data-anchor]) and its
// distance from the top: content that grows above it (figures, open editors)
// does not move it. The plain y is the fallback.
const SCROLL_KEY = 'asciia-study-places';
interface Place {
  anchor?: string;
  offset?: number;
  y: number;
}
function readPlaces(): Record<string, Place> {
  try {
    const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, Place>) : {};
  } catch {
    return {};
  }
}
// the first anchor that starts in the window; else the innermost one across its top edge
function placeNow(): Place {
  const y = Math.round(window.scrollY);
  let best: { el: Element; top: number } | null = null;
  let across: { el: Element; top: number } | null = null;
  for (const el of document.querySelectorAll('[data-anchor]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= window.innerHeight || !r.height) continue;
    if (r.top >= 0) {
      if (!best || r.top < best.top) best = { el, top: r.top };
    } else across = { el, top: r.top };
  }
  const pick = best ?? across;
  return pick ? { anchor: pick.el.getAttribute('data-anchor') ?? undefined, offset: Math.round(pick.top), y } : { y };
}
function savePlace(route: string) {
  try {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ ...readPlaces(), [route]: placeNow() }));
  } catch {
    // (not remembered)
  }
}
const firstRoute = window.location.hash;

export default function StudyApp() {
  const study = useStudy();
  const [[page, sub], setRoute] = useState(readHash);
  const [scopeKey, setScopeKey] = useState(readScope);
  const [omitIds, setOmitIds] = useState(readOmit);
  const [drawer, setDrawer] = useState(false);
  const [typed, setTyped] = useState('');
  const lang = useLang();
  const rootRef = useRef<HTMLDivElement>(null);
  // (starts once the page is there: while loading or locked there is no root yet)
  useTranslator(rootRef, lang, study.state);

  useEffect(() => {
    document.title = lang === 'en' ? 'User test evaluation' : 'Auswertung Usertest';
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [lang]);
  // remember the place (from when the page is shown, so the loading screen's 0 never counts)
  const ready = study.state === 'ready';
  const restoring = useRef(false);
  const route = useRef(window.location.hash);
  const firstLoad = useRef(true);
  // back to a saved place: the figures and data grow after the first paint, so the
  // anchor is put back in place on every frame for a while (any input stops it)
  const restore = (pl: Place) => {
    restoring.current = true;
    const until = Date.now() + 1800;
    const stop = () => {
      restoring.current = false;
      for (const t of ['wheel', 'touchstart', 'keydown', 'mousedown']) window.removeEventListener(t, stop);
    };
    for (const t of ['wheel', 'touchstart', 'keydown', 'mousedown']) window.addEventListener(t, stop, { passive: true });
    const step = () => {
      if (!restoring.current) return;
      const el = pl.anchor ? document.querySelector(`[data-anchor="${CSS.escape(pl.anchor)}"]`) : null;
      const target = el ? window.scrollY + el.getBoundingClientRect().top - (pl.offset ?? 0) : pl.y;
      if (Math.abs(window.scrollY - target) >= 1) window.scrollTo(0, target);
      if (Date.now() > until) stop();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  // a new page: its saved place; a sub-page that is a section: that section (when
  // chosen in the menu); otherwise the top. A reload comes back to where it was.
  useEffect(() => {
    if (!ready) return;
    const hash = window.location.hash;
    // (the first showing after loading the tab: a reload, the place comes back even for a section)
    const reload = firstLoad.current && hash === firstRoute;
    firstLoad.current = false;
    route.current = hash;
    const pl = readPlaces()[hash];
    const p = PAGES.find((x) => x.id === page);
    const section = sub && p?.sub?.find((s) => s.id === sub)?.anchor;
    if (pl && (reload || !section)) return restore(pl);
    restoring.current = false;
    if (section) window.setTimeout(() => document.getElementById(sub)?.scrollIntoView({ block: 'start' }), 50);
    else window.scrollTo(0, 0);
  }, [page, sub, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    try {
      history.scrollRestoration = 'manual';
    } catch {
      // (the browser's own)
    }
    let frame = 0;
    const save = () => {
      if (!restoring.current) savePlace(route.current);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(save);
    };
    // (leaving a page: its place is kept under its own route)
    const onHash = () => {
      cancelAnimationFrame(frame);
      // (only while the old page is still shown; React may have switched already)
      if (route.current === window.location.hash) return;
      if (!restoring.current) savePlace(route.current);
      // (no saving until the new page has taken its place)
      restoring.current = true;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    window.addEventListener('hashchange', onHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('hashchange', onHash);
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
        return <Data sub={sub} />;
      case 'ergebnisse':
        return <Results />;
      default:
        return <Overview />;
    }
  })();
  const subTitle = current.sub?.find((s) => s.id === sub && !s.anchor)?.title ?? (SUB_TITLE[page] ?? null);

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
            <a href={`/feedback?restore=${encodeURIComponent(study.viewing.id)}#daten/versionen`}>Wiederherstellen …</a>
            <a href={`/feedback${window.location.hash}`}>Zum aktuellen Stand</a>
          </div>
        )}
        <header className="st-topbar">
          <button type="button" className="st-menu" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} aria-controls="st-nav">
            Menü
          </button>
          <span>{current.title}</span>
        </header>
        <nav id="st-nav" className="st-nav" aria-label="Auswertung Usertest">
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
