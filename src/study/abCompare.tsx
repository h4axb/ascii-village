// Qualitatives Feedback → A/B-Vergleich & Gestaltungsableitung:
//   Gesamtbewertung     the leading variant in Tally (the preference question)
//                       and in-game (the overall rating, compared per person)
//   Einzelbewertungen   Tally (Teil 1: Direkter Vergleich) or In-Game (the five
//                       rating questions after each variant), one row per
//                       criterion: the leading variant and A · Gleich · B; Tally
//                       values are never changed here; a click on a Tally row
//                       filters the hypotheses by that research dimension
//   2. Hypothesen       own interpretations, each with linked statements from
//                       Beobachtungen & Feedback (supporting, contradicting or
//                       complementary); weakly backed ones are flagged
//   3. Redesign         design decisions: the hypotheses considered, the proposal
//                       and why; a hypothesis can also be "Nicht berücksichtigt"
// The dashboard's A/B tiles can show the people with preference A or B.
// Stored in settings/abCompare.
import { useEffect, useMemo, useRef, useState } from 'react';
import { part1 } from './analysis';
import type { ItemDoc } from './types';
import { SECTION_LABEL } from './types';
import { itemText, memoryOf, pick as pickText, useContentView } from './translations';
import { FIGURES, figNumber, logChange, useCtx } from './ui';
import { FoldBtn } from './notesDashboard';
import { RATING_LABEL, scopeLabel } from './model';
import { designOf } from '../feedback/schema';
import { RATING_QUESTIONS } from '../quest/quests';

export type EvKind = 'support' | 'contra' | 'extra';
export const EV_KIND: [EvKind, string][] = [
  ['support', 'stützend'],
  ['contra', 'widersprechend'],
  ['extra', 'ergänzend'],
];
export type HypStatus = 'open' | 'selected' | 'rejected';
export const HYP_STATUS: [HypStatus, string][] = [
  ['open', 'Offen'],
  ['selected', 'Für Redesign ausgewählt'],
  ['rejected', 'Nicht berücksichtigt'],
];
// a Beleg of a hypothesis: a person, how it bears on the hypothesis (stützend,
// ergänzend, widersprechend), its own interpretation text and, optionally,
// the statement from Beobachtungen & Feedback it rests on
export interface AbBeleg {
  id: string;
  item?: string;
  person?: string;
  kind: EvKind;
  text: string;
}
// an interpretation of a hypothesis: for one test person (or general), its text
// and its own Belege
export interface AbInterp {
  id: string;
  person?: string;
  text: string;
  belege: AbBeleg[];
}
export interface AbHyp {
  id: string;
  code: string; // H1, H2 …
  title: string;
  dims: string[]; // (older: the Tally questions it was about; hypotheses are general now)
  factors: string[]; // (older: possible influences; no longer shown)
  text: string; // the interpretation
  evidence: { item: string; kind: EvKind }[]; // kept in step with the interpretations' Belege, for older readers
  belege?: AbBeleg[]; // (all Belege, kept in step)
  interps?: AbInterp[]; // the interpretations, each for a person, each with its own Belege

  status: HypStatus;
  reason?: string; // why not considered
}
export interface AbDecision {
  id: string;
  title: string;
  proposal: string; // the design proposal
  why: string; // the reason for the decision
  hyps: string[];
}
interface AbDoc {
  dims?: Record<string, string>; // question → short name of its research dimension
  prefQ?: string; // the overall preference question
  hyps?: AbHyp[];
  decisions?: AbDecision[];
}


// a hypothesis's Belege (older hypotheses: their linked statements)
const oldBelege = (h: AbHyp): AbBeleg[] => h.belege ?? h.evidence.map((e, i) => ({ id: `e${i}`, item: e.item, kind: e.kind, text: '' }));
// a hypothesis's interpretations (older ones: its text and Belege as one, general)
export const interpsOf = (h: AbHyp): AbInterp[] => h.interps ?? (h.text || oldBelege(h).length ? [{ id: 'i0', text: h.text, belege: oldBelege(h) }] : []);
export const belegeOf = (h: AbHyp): AbBeleg[] => interpsOf(h).flatMap((x) => x.belege);
// the interpretations, with the text, Belege and statements kept in step for older readers
const withInterps = (h: AbHyp, interps: AbInterp[]): AbHyp => {
  const belege = interps.flatMap((x) => x.belege);
  return { ...h, interps, text: interps.map((x) => x.text).filter(Boolean).join('\n\n'), belege, evidence: belege.filter((b) => b.item).map((b) => ({ item: b.item!, kind: b.kind })) };
};
const hcode = (c: string) => `H${(c.replace(/\D/g, '') || '0').padStart(2, '0')}`;

// links to the dashboard's figures in a text: [Wort](abb:teil1)
const FIG_ROUTE: Record<string, string> = { alter: 'uebersicht', gruppe: 'uebersicht', laufzeit: 'uebersicht', teil4: 'uebersicht', ablauf: 'uebersicht', kategorien: 'uebersicht', befunde: 'qualitativ/befunde' };
// the Übersicht's other visuals (no figure number): linked by their section
const SECTION_LINKS: { id: string; title: string; caption: string; nav: string }[] = [
  { id: 'kennzahlen', title: 'Kennzahlen', caption: 'Teilnehmende, Testgruppen, Zeitraum und Spieldauer im Überblick.', nav: 'Kennzahlen' },
  { id: 'umfrage', title: 'Umfrage', caption: 'Ergebnisse der Umfrage (Tally) je Teil.', nav: 'Umfrage' },
  { id: 'tracking', title: 'Spiel-Tracking', caption: 'Kennzahlen des Spiel-Trackings je Variante.', nav: 'Spiel-Tracking' },
  { id: 'spielverhalten', title: 'Spielverhalten', caption: 'Bewertungen, Like-Rate und Spielverhalten der Teilnehmenden.', nav: 'Spielverhalten' },
  { id: 'crafting', title: 'Crafting-Ergebnisse', caption: 'Erzeugte Ergebnisse je Durchgang.', nav: 'Crafting-Ergebnisse' },
  { id: 'rueckmeldungen', title: 'Usability-Probleme & Rückmeldungen', caption: 'Kritische Usability-Probleme, positive Rückmeldungen, unerwartete Beobachtungen und Moderationseingriffe.', nav: 'Qualitatives Feedback' },
];
// every link target, grouped by page (in the dashboard's order)
// (name: the sidebar page · the category in its page head · the figure's name · its number)
type LinkTarget = { id: string; title: string; caption: string; label: string; page: string; cat: string; name: string };
const pageOf = (id: string) => ({ uebersicht: 'Übersicht', quantitativ: 'Quantitative Analyse' } as Record<string, string>)[FIG_ROUTE[id] ?? 'quantitativ'] ?? 'Qualitatives Feedback';
const catOf = (id: string) =>
  id === 'ablauf' ? 'Spielablauf'
  : pageOf(id) === 'Übersicht' ? 'Teilnehmerprofil'
  : id === 'befunde' ? 'Wiederkehrende Befunde'
  : id.startsWith('teil1') ? 'Teil 1: Direkter Vergleich'
  : id.startsWith('teil2') ? 'Teil 2: Likert-Skala'
  : id.startsWith('teil3') ? 'Teil 3: UEQ-S'
  : 'In-Game-Ratings und Telemetrie';
const figTarget = (f: (typeof FIGURES)[number]): LinkTarget => {
  const page = pageOf(f.id), cat = catOf(f.id), label = `Abb. ${figNumber(f.id)}`;
  return { ...f, label, page, cat, name: `${page} · ${cat} · ${f.title} · ${label}` };
};
const LINK_TARGETS: LinkTarget[] = [
  ...FIGURES.filter((f) => pageOf(f.id) === 'Übersicht').map(figTarget),
  ...SECTION_LINKS.map((x) => ({ id: x.id, title: x.title, caption: x.caption, label: 'Abschnitt', page: 'Übersicht', cat: x.title, name: `Übersicht · ${x.title} · Abschnitt` })),
  ...FIGURES.filter((f) => pageOf(f.id) !== 'Übersicht').map(figTarget),
];
const linkTarget = (id: string) => LINK_TARGETS.find((x) => x.id === id);
export function goFigure(id: string) {
  const n = figNumber(id);
  const sec = SECTION_LINKS.find((x) => x.id === id);
  if (!n && !sec) return;
  window.location.hash = `#${sec ? 'uebersicht' : (FIG_ROUTE[id] ?? 'quantitativ')}`;
  const sel = sec ? `[data-nav="${sec.nav}"]` : `[data-anchor="fig-${n}"], [data-anchor^="fig-${n}."]`;
  const until = Date.now() + 3000;
  const step = () => {
    const el = document.querySelector(sel);
    if (el) {
      const head = document.querySelector('.st-pagehead');
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - (head ? head.getBoundingClientRect().height : 0) - 12, behavior: 'smooth' });
    } else if (Date.now() < until) window.setTimeout(step, 120);
  };
  window.setTimeout(step, 350);
}
// [word](abb:id) links a figure, [word](bel:id) a Beleg of the same hypothesis
const LINK_RE = /\[([^\]]+)\]\((abb|bel):([a-z0-9]+)\)/g;
function RichText({ text, belege, onBeleg }: { text: string; belege?: AbBeleg[]; onBeleg?: (id: string) => void }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[2] === 'abb') {
      const f = linkTarget(m[3]);
      out.push(
        <button key={m.index} type="button" className="st-ab-lk is-fig" title={f ? f.name : 'Abbildung'} onClick={() => goFigure(m[3])}>
          {m[1]}
        </button>,
      );
    } else {
      // (a Beleg removed since: the word stays, without the link)
      const bel = belege?.find((x) => x.id === m[3]);
      out.push(
        bel && onBeleg ? (
          <button key={m.index} type="button" className={`st-ab-lk is-bel ${KIND_FILL[bel.kind]}`} title={`Beleg: ${EV_KIND.find(([k]) => k === bel.kind)?.[1] ?? ''}`} onClick={() => onBeleg(bel.id)}>
            {m[1]}
          </button>
        ) : (
          m[1]
        ),
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
// (for search and previews: the text without the link syntax)
const plain = (t: string) => t.replace(LINK_RE, '$1');

// a small search over the dashboard's figures
function FigPicker({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = LINK_TARGETS.filter((f) => words.every((w) => `${f.name} ${f.caption}`.toLowerCase().includes(w)));
  return (
    <div className="st-modal-back" role="presentation" onClick={onClose}>
      <div className="st-modal st-ab-picker" role="dialog" aria-modal="true" aria-label="Abbildung verlinken" onClick={(e) => e.stopPropagation()}>
        <header className="st-modal-head">
          <h2>Abbildung verlinken</h2>
          <div className="st-ab-pickbar">
            <input type="search" autoFocus value={q} placeholder="Suchen, z. B. Direkter Vergleich …" aria-label="Abbildungen durchsuchen" onChange={(e) => setQ(e.target.value)} />
          </div>
        </header>
        <div className="st-modal-body">
          {!hits.length && <p className="st-muted">Keine Abbildung gefunden.</p>}
          <ul className="st-ab-hits">
            {hits.map((f) => (
              <li key={f.id}>
                <span>
                  <small>{`${f.page} · ${f.cat}`}</small>
                  {f.label === 'Abschnitt' ? `${f.title} · Abschnitt` : `${f.title} · ${f.label}`}
                </span>
                <button type="button" className="st-cx-btn is-pri" onClick={() => onPick(f.id)}>
                  Verlinken
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// a text field that can link a word to a figure: the selected word, or the figure's name.
// With belegPicker, a selected word shows a popover: link it to a figure or to a Beleg
// (belegPicker gets link(id) – the text with the word linked – and close)
function LinkText({ value, onChange, rows, label, placeholder, belegPicker }: { value: string; onChange: (v: string) => void; rows: number; label: string; placeholder?: string; belegPicker?: (link: (id: string) => string, close: () => void) => React.ReactNode }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pick, setPick] = useState<'fig' | 'bel' | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const sel = useRef<[number, number]>([value.length, value.length]);
  const remember = () => {
    if (!ref.current) return;
    sel.current = [ref.current.selectionStart, ref.current.selectionEnd];
    setHasSel(ref.current.selectionEnd > ref.current.selectionStart && !!value.slice(ref.current.selectionStart, ref.current.selectionEnd).trim());
  };
  const linked = (kind: 'abb' | 'bel', id: string, fallback: string) => {
    const [a, b] = sel.current;
    const word = value.slice(a, b).trim() || fallback;
    return `${value.slice(0, a)}[${word}](${kind}:${id})${value.slice(b)}`;
  };
  const close = () => (setPick(null), setHasSel(false));
  const word = value.slice(...sel.current).trim();
  return (
    <div className="st-ab-ltext">
      <textarea ref={ref} rows={rows} value={value} placeholder={placeholder} aria-label={label} onChange={(e) => (onChange(e.target.value), setHasSel(false))} onSelect={remember} onKeyUp={remember} onMouseUp={remember} onBlur={() => window.setTimeout(() => document.activeElement !== ref.current && !pick && setHasSel(false), 150)} />
      {belegPicker && hasSel && !pick && (
        <div className="st-ab-selpop" role="toolbar" aria-label={`„${word}“ verlinken`}>
          <span className="st-ab-selword">{`„${word.length > 28 ? `${word.slice(0, 28)} …` : word}“ verlinken:`}</span>
          <button type="button" className="st-cx-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setPick('fig')}>
            Abbildung
          </button>
          <button type="button" className="st-cx-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setPick('bel')}>
            Beleg
          </button>
        </div>
      )}
      <button type="button" className="st-linkbtn st-ab-figbtn" onMouseDown={remember} onClick={() => setPick('fig')}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
        </svg>
        Abbildung verlinken
      </button>
      {pick === 'fig' && (
        <FigPicker
          onClose={close}
          onPick={(id) => {
            onChange(linked('abb', id, linkTarget(id)?.title || 'Abbildung'));
            close();
          }}
        />
      )}
      {pick === 'bel' && belegPicker?.((id) => linked('bel', id, 'Beleg'), close)}
    </div>
  );
}

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const pText = (p: number) => (Number.isFinite(p) ? `p = ${p < 0.001 ? '< 0,001' : p.toFixed(2).replace('.', ',')}` : '');
const lead = (q: string) => q.replace(/[\s?:.]+$/, '');
const PREF_RE = /insgesamt|gefallen|präferenz|bevorzug|lieber|overall|prefer/i;
// (the direct question on continued use comes first: "which would you prefer to use")
const USE_RE = /prefer to use|continued? (playing|use)|weiter(spielen|nutzen)|weiterhin nutzen/i;
const pickPref = (results: { question: string }[], stored?: string) =>
  stored && results.some((r) => r.question === stored) ? stored : (results.find((r) => USE_RE.test(r.question)) ?? results.find((r) => PREF_RE.test(r.question)) ?? results[results.length - 1])?.question;

function useAb() {
  const { study } = useCtx();
  const doc = (study.docs.settings.abCompare ?? {}) as AbDoc;
  const latest = () => (study.latest().settings.abCompare ?? {}) as AbDoc;
  const save = (p: Partial<AbDoc>, what: string) => {
    study.commit([{ coll: 'settings', id: 'abCompare', data: { ...latest(), ...p } }]);
    logChange(study, `A/B-Vergleich: ${what}`);
  };
  return { doc, latest, save };
}

export type AbView = 'A' | 'B' | 'hyp' | 'red' | null;
type View = AbView;

// the figures for the tiles: people preferring A or B (in the preference
// question), hypotheses (and those chosen for the redesign), decisions
export function useAbSummary() {
  const { slice } = useCtx();
  const { doc } = useAb();
  const results = useMemo(() => part1(slice.survey).filter((r) => r.n), [slice.survey]);
  const prefQ = pickPref(results, doc.prefQ);
  const rows = slice.survey.filter((r) => r.person && prefQ && r.p1[prefQ] != null);
  const hyps = doc.hyps ?? [];
  return {
    results: results.length,
    of: rows.length,
    A: rows.filter((r) => r.p1[prefQ!] === 'A').length,
    B: rows.filter((r) => r.p1[prefQ!] === 'B').length,
    hyps: hyps.length,
    selected: hyps.filter((h) => h.status === 'selected').length,
    decisions: (doc.decisions ?? []).length,
  };
}

export function AbSection({ folded, onFold, show: shown, setShow: setShown }: { folded: boolean; onFold: () => void; show?: AbView; setShow?: (v: AbView) => void }) {
  const { slice, study, scope } = useCtx();
  const view = useContentView();
  const { doc, latest, save } = useAb();
  const [own, setOwn] = useState<View>(null);
  const show = shown !== undefined ? shown : own;
  const setShow = setShown ?? setOwn;
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const results = useMemo(() => part1(slice.survey).filter((r) => r.n), [slice.survey]);
  const label = (q: string) => doc.dims?.[q]?.trim() || lead(q);
  const prefQ = pickPref(results, doc.prefQ);
  const hyps = doc.hyps ?? [];
  const decisions = doc.decisions ?? [];
  const items = useMemo(() => new Map(slice.items.map((i) => [i.id, i])), [slice.items]);
  const allItems = study.docs.items;
  const byPref = (v: 'A' | 'B') => slice.survey.filter((r) => r.person && prefQ && r.p1[prefQ] === v);
  const qWords = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shownHyps = qWords.length
    ? hyps.filter((h) => {
        const hay = [h.code, hcode(h.code), h.title, ...interpsOf(h).flatMap((x) => [x.person ?? '', plain(x.text)]), ...belegeOf(h).flatMap((b) => [b.person ?? '', plain(b.text), b.item ? (items.get(b.item) ?? allItems[b.item])?.text ?? '' : ''])].join(' ').toLowerCase();
        return qWords.every((w) => hay.includes(w));
      })
    : hyps;
  const putHyp = (h: AbHyp, what: string) => save({ hyps: (latest().hyps ?? []).some((x) => x.id === h.id) ? (latest().hyps ?? []).map((x) => (x.id === h.id ? h : x)) : [...(latest().hyps ?? []), h] }, what);
  const delHyp = (h: AbHyp) =>
    save({ hyps: (latest().hyps ?? []).filter((x) => x.id !== h.id), decisions: (latest().decisions ?? []).map((d) => ({ ...d, hyps: d.hyps.filter((x) => x !== h.id) })) }, `Hypothese ${h.code} gelöscht`);
  const putDec = (d: AbDecision, what: string) => save({ decisions: (latest().decisions ?? []).some((x) => x.id === d.id) ? (latest().decisions ?? []).map((x) => (x.id === d.id ? d : x)) : [...(latest().decisions ?? []), d] }, what);
  const nextCode = () => `H${Math.max(0, ...hyps.map((h) => Number(h.code.replace(/\D/g, '')) || 0)) + 1}`;
  const [fresh, setFresh] = useState<string | null>(null);
  const [src, setSrc] = useState<'tally' | 'game'>('tally');
  const game = useMemo(() => gameVotes(slice.feedback), [slice.feedback]);
  const tallyRows: Vote[] = results.map((r) => ({
    key: r.question,
    title: label(r.question),
    sub: r.question,
    A: r.A,
    B: r.B,
    tie: r.neutral,
    pref: r.question === prefQ,
    hint: r.winner ? `Mehrheit ${r.winner} · ${pText(r.p)}` : 'keine Mehrheit',
    tcalc: slice.survey
      .filter((x) => x.p1[r.question] != null)
      .map((x) => ({ who: x.person ?? `Zeile ${x.row + 1}`, v: x.p1[r.question] === 'A' ? ('A' as const) : x.p1[r.question] === 'B' ? ('B' as const) : null, swapped: x.swapped }))
      .sort((a, b) => a.who.localeCompare(b.who)),
    test: r.decided ? `Binomialtest (ohne „Gleich“): ${r.k} von ${r.decided} · ${pText(r.p)}` : undefined,
  }));
  // Teil 2's single-choice question on the timing of the support: "before
  // generating" is Variante A (clarification first), "after seeing the result"
  // Variante B (feedback after), "both" a tie, "neither" no vote
  const timingRows: Vote[] = useMemo(() => {
    const qs = [...new Set(slice.survey.flatMap((x) => Object.keys(x.choice)))];
    return qs
      .map((q) => {
        const ans = slice.survey.filter((x) => x.choice[q]).map((x) => ({ x, a: x.choice[q], v: timingSide(x.choice[q]) }));
        if (!ans.length || !TIMING_Q.test(q)) return null;
        const v: Vote = {
          key: q,
          title: doc.dims?.[q]?.trim() || 'Zeitpunkt der Unterstützung',
          sub: q,
          A: ans.filter((y) => y.v === 'A').length,
          B: ans.filter((y) => y.v === 'B').length,
          tie: ans.filter((y) => y.v === 'tie').length,
          none: ans.filter((y) => y.v === 'none').length,
          hint: 'Teil 2 · vorher = A, nachher = B, beides = Gleich',
          tcalc: ans.map((y) => ({ who: y.x.person ?? `Zeile ${y.x.row + 1}`, v: y.v === 'A' || y.v === 'B' ? y.v : null, swapped: false, answer: y.a, none: y.v === 'none' })).sort((a, b) => a.who.localeCompare(b.who)),
        };
        return v;
      })
      .filter((v): v is Vote => !!v);
  }, [slice.survey, doc.dims]);
  const rows = src === 'tally' ? [...tallyRows, ...timingRows] : game;
  const tallyAll = tallyRows.find((r) => r.pref) ?? null;
  const gameAll = game.find((r) => r.key === 'overall') ?? null;
  const nPeople = new Set([...slice.survey.filter((r) => r.person && Object.keys(r.p1).length).map((r) => r.person), ...slice.feedback.filter((r) => r.rating && r.participant).map((r) => r.participant)]).size;

  return (
    <section className={`st-lcard st-ab${folded ? ' is-folded' : ''}`} data-nav="A/B-Vergleich" aria-label="A/B-Vergleich & Gestaltungsableitung">
      <div className="st-lc-title">
        <h2>A/B-Vergleich & Gestaltungsableitung</h2>
        <span className="st-muted st-lc-who">{`${scopeLabel(scope)} · n = ${nPeople}`}</span>
        <FoldBtn folded={folded} label="A/B-Vergleich" onClick={onFold} />
      </div>
      {!folded && (
        <>
          <div className="st-ab-step">
            <b>Gesamtbewertung</b>
          </div>
          <div className="st-ab-tiles is-two">
            <OverallTile source="Tally" v={tallyAll} unit="Person" what={prefQ ? label(prefQ) : 'Direkte Nutzungspräferenz'} />
            <OverallTile source="In-Game" v={gameAll} unit="Person" what="Crafting-Erfahrung 1–5 · Gesamteindruck" />
          </div>

          <div className="st-ab-step st-ab-rhead">
            <i>1</i>
            <b>Einzelbewertungen</b>
            <span className="st-ab-rtools">
              <span className="st-seg st-cx-seg" role="group" aria-label="Quelle">
                {(
                  [
                    ['tally', 'Tally'],
                    ['game', 'In-Game'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" className={src === v ? 'is-on' : ''} aria-pressed={src === v} onClick={() => setSrc(v)}>
                    {l}
                  </button>
                ))}
              </span>
            </span>
          </div>
          {rows.length ? (
            <>
              <div className="st-ab-rows">
                {rows.map((r) =>
                    src === 'tally' ? (
                      <VoteRow
                        key={r.key}
                        r={r}
                        renaming={rename === r.key}
                        onRename={() => setRename(r.key)}
                        onRenamed={(v) => {
                          setRename(null);
                          if (v !== null) save({ dims: { ...(latest().dims ?? {}), [r.key]: v.trim() } }, `Kurzname für „${lead(r.key)}“`);
                        }}
                      />
                    ) : (
                      <VoteRow key={r.key} r={r} />
                    ),
                  )}
              </div>
              <div className="st-ab-under">
                <span className="st-muted">
                  {src === 'tally'
                    ? 'Werte aus Tally, hier nicht veränderbar.'
                    : 'Je Person gezählt: die höhere Bewertung ist eine Stimme für die Variante, bei Frustration die niedrigere. Gleiche Werte zählen als „Gleich“.'}
                </span>
                {src === 'tally' && (
                  <label className="st-ab-prefsel">
                    Präferenzfrage
                    <select value={prefQ ?? ''} onChange={(e) => save({ prefQ: e.target.value }, 'Präferenzfrage gewählt')}>
                      {results.map((r) => (
                        <option key={r.question} value={r.question}>
                          {label(r.question)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </>
          ) : (
            <p className="st-muted st-ab-empty">
              {src === 'tally' ? 'Noch keine Tally-Vergleichsfragen: unter Daten & Validierung → Zuordnung die Spalten als „Teil 1“ zuordnen.' : 'Noch keine In-Game-Bewertungen (die 5 Fragen nach jeder Variante).'}
            </p>
          )}

          {(show === 'A' || show === 'B') && (
            <div className="st-ab-people">
              <div className="st-ab-step">
                <b>{`Präferenz ${show}`}</b>
                <span className="st-muted">{`${byPref(show).length} Personen · ihre Tally-Antworten und verknüpften Aussagen`}</span>
                <button type="button" className="st-cx-btn st-ab-add" onClick={() => setShow(null)}>
                  Schließen
                </button>
              </div>
              {!byPref(show).length && <p className="st-muted st-ab-empty">Niemand mit dieser Präferenz.</p>}
              {byPref(show).map((row) => {
                const linked = hyps.flatMap((h) => belegeOf(h).filter((b) => b.item && (items.get(b.item) ?? allItems[b.item])?.person === row.person).map((b) => ({ h, e: { item: b.item!, kind: b.kind }, i: items.get(b.item!) ?? allItems[b.item!] })));
                return (
                  <div key={row.person!} className="st-ab-person">
                    <div className="st-ab-phead">
                      <strong>{row.person}</strong>
                      <span className="st-ab-answers">
                        {results.map((r) => (
                          <span key={r.question} className={`st-ab-ans is-${row.p1[r.question] ?? 'none'}`} title={r.question}>
                            {label(r.question)}
                            <b>{row.p1[r.question] === 'neutral' ? '–' : (row.p1[r.question] ?? '·')}</b>
                          </span>
                        ))}
                      </span>
                    </div>
                    {linked.length ? (
                      <ul className="st-ab-evlist">
                        {linked.map(({ h, e, i }) => (
                          <li key={`${h.id}-${e.item}`}>
                            <span className="st-ab-code">{hcode(h.code)}</span>
                            <span>{i ? itemText(view, i) : 'Aussage gelöscht'}</span>
                            <span className={`st-ab-kind is-${e.kind}`}>{EV_KIND.find(([k]) => k === e.kind)?.[1]}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="st-muted st-ab-none">Keine Aussage mit einer Hypothese verknüpft.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(show === null || show === 'hyp') && (
            <>
              <div className={`st-ab-hhead${searching ? ' is-searching' : ''}`}>
                <h3>Hypothesen &amp; Belege</h3>
                <label className="st-ab-hsearch">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={q}
                    placeholder="Suchen …"
                    aria-label="Hypothesen durchsuchen"
                    onChange={(e) => setQ(e.target.value)}
                    onFocus={() => setSearching(true)}
                    onBlur={() => setSearching(false)}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                </label>
                <span className="st-ab-tipwrap">
                  <button
                    type="button"
                    className="st-lc-add"
                    aria-label="Hypothese hinzufügen"
                    onClick={() => {
                      const h: AbHyp = { id: uid('h'), code: nextCode(), title: '', dims: [], factors: [], text: '', evidence: [], belege: [], interps: [{ id: uid('i'), text: '', belege: [] }], status: 'open' };
                      putHyp(h, `Hypothese ${h.code} angelegt`);
                      setFresh(h.id);
                    }}
                  >
                    <PlusIcon />
                  </button>
                  <span className="st-ab-tip" role="tooltip">
                    Hypothese hinzufügen
                  </span>
                </span>
              </div>
              {!shownHyps.length && <p className="st-muted st-ab-empty">{qWords.length ? 'Keine Hypothese gefunden.' : 'Noch keine Hypothese: mit + anlegen.'}</p>}
              {shownHyps.map((h) => (
                <HypCard key={h.id} h={h} items={items} allItems={allItems} persons={slice.persons.map((x) => x.id)} startEdit={fresh === h.id} onSave={(x, what) => putHyp(x, what)} onDelete={() => delHyp(h)} />
              ))}
              <p className="st-muted st-ab-note">Hypothesen sind Interpretationen, keine bestätigten Erkenntnisse. Tally-Werte und Originalaussagen bleiben unverändert.</p>
            </>
          )}

          {(show === null || show === 'red') && (
            <>
              <div className="st-ab-step">
                <i>3</i>
                <b>Redesign-Entscheidungen</b>
                <span className="st-muted">Hypothesen auswählen · Lösung · Begründung</span>
                <button
                  type="button"
                  className="st-cx-btn st-ab-add"
                  onClick={() => {
                    const d: AbDecision = { id: uid('d'), title: '', proposal: '', why: '', hyps: hyps.filter((h) => h.status === 'selected').map((h) => h.id) };
                    putDec(d, 'Redesign-Entscheidung angelegt');
                    setFresh(d.id);
                  }}
                >
                  + Entscheidung
                </button>
              </div>
              {!decisions.length && <p className="st-muted st-ab-empty">Noch keine Redesign-Entscheidung.</p>}
              {decisions.map((d) => (
                <DecCard key={d.id} d={d} hyps={hyps} startEdit={fresh === d.id} onSave={(x, what) => putDec(x, what)} onDelete={() => save({ decisions: (latest().decisions ?? []).filter((x) => x.id !== d.id) }, 'Redesign-Entscheidung gelöscht')} />
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}

// one criterion, A against B: votes per person (Tally answers, or the in-game
// ratings compared per person), the leading variant and a small distribution bar
interface Vote {
  key: string;
  title: string;
  sub: string;
  A: number;
  B: number;
  tie: number;
  pref?: boolean;
  nHyp?: number;
  hint?: string;
  means?: { A: number | null; B: number | null; nA: number; nB: number };
  scale?: { low: string; high: string; lower?: boolean }; // in-game: what 1 and 5 mean
  calc?: { who: string; a: number; b: number; v: 'A' | 'B' | null }[]; // in-game: the comparison per person
  tcalc?: { who: string; v: 'A' | 'B' | null; swapped: boolean; answer?: string; none?: boolean }[]; // Tally: each person's answer
  none?: number; // a choice question: "neither" (no vote, not a tie)
  test?: string; // Tally: the binomial test of the majority
}
const TIMING_Q = /when would you .*prefer to receive|wann .*unterstützung/i;
function timingSide(a: string): 'A' | 'B' | 'tie' | 'none' | null {
  if (/neither|no additional|keine|weder/i.test(a)) return 'none';
  if (/both|beides|depending/i.test(a)) return 'tie';
  if (/before|vor (dem|der)|vorher/i.test(a)) return 'A';
  if (/after|nach (dem|der)|nachher/i.test(a)) return 'B';
  return null;
}
// how telling a result is: the leading variant's share of everyone who answered
// (a tie, "neither" and the other variant all count against it)
function strength(v: Vote) {
  const n = v.A + v.B + v.tie + (v.none ?? 0);
  const w = lead2(v);
  if (!n) return null;
  if (!w) return { label: 'keine Mehrheit', text: `${n} ${n === 1 ? 'Antwort' : 'Antworten'}, keine Variante vorn`, k: 0, n };
  const k = v[w];
  const share = k / n;
  const label = share >= 0.8 ? 'deutlich' : share >= 0.6 ? 'mäßig' : 'schwach';
  const rest = [v.tie && `${v.tie} Gleich`, v.none && `${v.none} keine`, v[w === 'A' ? 'B' : 'A'] && `${v[w === 'A' ? 'B' : 'A']} ${w === 'A' ? 'B' : 'A'}`].filter(Boolean).join(', ');
  return { label, text: `${k} von ${n} für ${w} (${Math.round(share * 100)} %)${rest ? ` · ${rest}` : ''}`, k, n };
}
const lead2 = (v: Pick<Vote, 'A' | 'B'>) => (v.A > v.B ? 'A' : v.B > v.A ? 'B' : null);
const num = (x: number | null) => (x == null ? '–' : x.toFixed(1).replace('.', ','));
const val = (x: number) => (Number.isInteger(x) ? String(x) : num(x)); // a person's rating (a mean if rated twice)

// the in-game rating questions: per person the mean of each design's ratings,
// the higher one is a vote for that design (frustration: the lower one)
export function gameVotes(feedback: { participant?: string; rating?: Record<string, number | null>; cond?: string }[]): Vote[] {
  const per = new Map<string, Record<string, { A: number[]; B: number[] }>>();
  for (const r of feedback) {
    if (!r.rating || !r.participant) continue;
    const d = designOf(r.cond);
    if (!d) continue;
    const p = per.get(r.participant) ?? {};
    per.set(r.participant, p);
    for (const [q, v] of Object.entries(r.rating)) if (typeof v === 'number') (p[q] ??= { A: [], B: [] })[d].push(v);
  }
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return RATING_QUESTIONS.map((q) => {
    const out: Vote = { key: q.id, title: RATING_LABEL[q.id] ?? q.id, sub: q.text, A: 0, B: 0, tie: 0, scale: { low: q.low, high: q.high, lower: q.id === 'frustration' }, calc: [] };
    const all = { A: [] as number[], B: [] as number[] };
    for (const [who, p] of [...per.entries()].sort(([x], [y]) => x.localeCompare(y))) {
      const x = p[q.id];
      if (!x) continue;
      all.A.push(...x.A);
      all.B.push(...x.B);
      const a = avg(x.A);
      const b = avg(x.B);
      if (a == null || b == null) continue;
      const d = q.id === 'frustration' ? a - b : b - a;
      if (d > 0) out.B++;
      else if (d < 0) out.A++;
      else out.tie++;
      out.calc!.push({ who, a, b, v: d > 0 ? 'B' : d < 0 ? 'A' : null });
    }
    out.means = { A: avg(all.A), B: avg(all.B), nA: all.A.length, nB: all.B.length };
    return out;
  }).filter((v) => v.A + v.B + v.tie > 0);
}

function OverallTile({ source, v, unit, what }: { source: string; v: Vote | null; unit: string; what: string }) {
  const of = v ? v.A + v.B + v.tie : 0;
  const w = v ? lead2(v) : null;
  return (
    <div className="st-ab-otile">
      <span className="st-ab-olabel">{source}</span>
      {of && v && (v.calc || v.tcalc) ? (
        <span className="st-ab-wwrap st-ab-owrap">
          <button type="button" className={`st-ab-ovalue is-${w ?? 'tie'}`} aria-describedby={`ocalc-${v.key}`}>
            {w ?? '='}
          </button>
          <CalcPop r={v} id={`ocalc-${v.key}`} />
        </span>
      ) : (
        <span className={`st-ab-ovalue is-${w ?? 'tie'}`}>{!of ? '–' : (w ?? '=')}</span>
      )}
      <span className="st-ab-otext">{!of ? 'noch keine Antworten' : w ? `Variante ${w} · ${v![w]} von ${of} ${of === 1 ? unit : `${unit}en`}` : `Gleichstand · A ${v!.A} · Gleich ${v!.tie} · B ${v!.B}`}</span>
      <span className="st-muted st-ab-owhat">{what}</span>
    </div>
  );
}

const counts = (r: Vote) => `A ${r.A} · Gleich ${r.tie} · B ${r.B}${r.none ? ` · Keine ${r.none}` : ''}`;
// how telling the result is (the popup's last line)
function Strength({ r }: { r: Vote }) {
  const st = strength(r);
  if (!st) return null;
  return (
    <span className="st-ab-cstr">
      <b>{`Aussagekraft: ${st.label}`}</b>
      <span>{st.text}</span>
      {st.n < 10 && <span className="st-muted">{`kleine Stichprobe (n = ${st.n})`}</span>}
    </span>
  );
}
// how a result was calculated (the popup over a variant letter): in-game the
// comparison per person, Tally each person's answer
function CalcPop({ r, id }: { r: Vote; id: string }) {
  const w = lead2(r);
  if (r.calc)
    return (
<span className="st-ab-calc" role="tooltip" id={id}>
            <b>So berechnet</b>
            {r.scale && (
              <span className="st-ab-cscale">
                <span>
                  <b>1</b> {r.scale.low}
                </span>
                <span>
                  <b>5</b> {r.scale.high}
                </span>
              </span>
            )}
            <span className="st-muted">{r.scale?.lower ? 'je Person: der niedrigere Wert gewinnt' : 'je Person: der höhere Wert gewinnt'}</span>
            <span className="st-ab-ctbl">
              {r.calc.map((c) => (
                <span key={c.who} className="st-ab-crow">
                  <span>{c.who}</span>
                  <span>{`A ${val(c.a)}`}</span>
                  <span>{c.v === 'A' ? (r.scale?.lower ? '<' : '>') : c.v === 'B' ? (r.scale?.lower ? '>' : '<') : '='}</span>
                  <span>{`B ${val(c.b)}`}</span>
                  <span className={`st-ab-cv is-${c.v ?? 'tie'}`}>{`→ ${c.v ?? 'Gleich'}`}</span>
                </span>
              ))}
            </span>
            <span className="st-ab-csum">{`${counts(r)} → ${w ? `Variante ${w}` : 'Gleichstand'}`}</span>
            <Strength r={r} />
          </span>
    );
  if (!r.tcalc) return null;
  return (
<span className="st-ab-calc" role="tooltip" id={id}>
            <b>So berechnet</b>
            {r.pref && <span className="st-ab-cbasis">{`Gesamtbewertung = Antworten auf die Präferenzfrage „${r.sub}“`}</span>}
            <span className="st-muted">
              {r.none != null
                ? 'je Person: ihre Antwort (Teil 2) ist eine Stimme – vorher = A, nachher = B, beides = Gleich, keines = keine Stimme'
                : 'je Person: ihre Antwort in der Umfrage (Teil 1) ist eine Stimme; die Variante mit mehr Stimmen gewinnt'}
            </span>
            <span className="st-ab-ctbl is-tally">
              {r.tcalc.map((c, i) => (
                <span key={`${c.who}-${i}`} className="st-ab-crow">
                  <span>{c.who}</span>
                  <span title={c.answer}>{c.answer ?? (c.swapped ? 'A/B getauscht' : '')}</span>
                  <span className={`st-ab-cv is-${c.v ?? 'tie'}`}>{`→ ${c.v ?? (c.none ? 'Keine' : 'Gleich')}`}</span>
                </span>
              ))}
            </span>
            <span className="st-ab-csum">{`${counts(r)} → ${w ? `Variante ${w}` : 'Gleichstand'}`}</span>
            {r.test && <span className="st-muted">{r.test}</span>}
            <Strength r={r} />
          </span>
  );
}

function VoteRow({ r, on, renaming, onClick, onRename, onRenamed }: { r: Vote; on?: boolean; renaming?: boolean; onClick?: () => void; onRename?: () => void; onRenamed?: (v: string | null) => void }) {
  const [v, setV] = useState(r.title);
  useEffect(() => setV(r.title), [r.title, renaming]);
  const of = r.A + r.B + r.tie + (r.none ?? 0);
  const w = lead2(r);
  const body = (
    <>
      <span className="st-ab-rname">
        {renaming ? (
          <input
            autoFocus
            value={v}
            aria-label="Kurzname der Forschungsdimension"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenamed?.(v);
              if (e.key === 'Escape') (e.stopPropagation(), onRenamed?.(null));
            }}
            onBlur={() => onRenamed?.(v)}
          />
        ) : (
          <b>
            {r.title}
            {r.pref && <span className="st-ab-prefchip" title="Diese Frage bestimmt die Tally-Gesamtbewertung oben (unten unter „Präferenzfrage“ wählbar)">Gesamtbewertung</span>}
            {(r.nHyp ?? 0) > 0 && <span className="st-ab-nh">{`${r.nHyp} H`}</span>}
          </b>
        )}
        <span className="st-muted" title={r.sub}>
          {r.sub}
        </span>
      </span>
      {r.calc || r.tcalc ? (
        <span className="st-ab-wwrap">
          <button type="button" className={`st-ab-win is-${w ?? 'tie'}`} aria-describedby={`calc-${r.key}`}>
            {w ?? 'Gleich'}
          </button>
          <CalcPop r={r} id={`calc-${r.key}`} />
        </span>
      ) : (
        <span className={`st-ab-win is-${w ?? 'tie'}`}>{w ?? 'Gleich'}</span>
      )}
      <span className="st-ab-count">
        {counts(r)}
        {r.means && <small title="Mittelwert aller Bewertungen (1–5) je Variante">{`Ø A ${num(r.means.A)} (n=${r.means.nA}) · Ø B ${num(r.means.B)} (n=${r.means.nB})`}</small>}
      </span>
      <span className="st-ab-bar" aria-hidden="true">
        <i className="is-a" style={{ width: `${of ? (r.A / of) * 100 : 0}%` }} />
        <i className="is-n" style={{ width: `${of ? (r.tie / of) * 100 : 0}%` }} />
        <i className="is-b" style={{ width: `${of ? (r.B / of) * 100 : 0}%` }} />
        {!!r.none && <i className="is-x" style={{ width: `${(r.none / of) * 100}%` }} />}
      </span>
    </>
  );
  if (!onRename) return <div className={`st-ab-r${r.scale ? ' is-game' : ''}`}>{body}</div>;
  // a Tally row: its short name can be changed (the pen, light like every edit icon)
  return (
    <div className={`st-ab-r is-click${on ? ' is-on' : ''}`} title={r.hint} onDoubleClick={onClick}>
      {body}
      <button
        type="button"
        className="st-ab-ren"
        aria-label={`Kurzname für ${r.title} ändern`}
        title="Kurzname ändern"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
    </div>
  );
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const PenIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const KIND_FILL: Record<EvKind, string> = { support: 'is-support', extra: 'is-extra', contra: 'is-contra' };

// a hypothesis: H01, its title, and its interpretations – each for a test person
// (the chip before its first line), with its own Belege as boxes in the colour
// of their kind (from two on folded: the first fades out, the arrow over it);
// the + beside an interpretation adds a Beleg to it; the pen edits this one;
// the status (Redesign) is the whole hypothesis's
function HypCard({ h, items, allItems, persons, startEdit, onSave, onDelete }: { h: AbHyp; items: Map<string, ItemDoc>; allItems: Record<string, ItemDoc>; persons: string[]; startEdit: boolean; onSave: (h: AbHyp, what: string) => void; onDelete: () => void }) {
  const view = useContentView();
  const { study } = useCtx();
  // (a survey free-text answer: the question it answers, in the chosen language)
  const questionOf = (it?: ItemDoc) => (it?.section === 'survey' && it.question ? pickText(view, it.question, memoryOf(study)[it.question]?.de) : '');
  const [edit, setEdit] = useState(startEdit);
  const [draft, setDraft] = useState(h);
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const itemOf = (id?: string) => (id ? (items.get(id) ?? allItems[id]) : undefined);
  const interps = interpsOf(h);
  const dInterps = interpsOf(draft);
  const start = () => (setDraft(withInterps(h, interpsOf(h))), setEdit(true));
  const setI = (id: string, p: Partial<AbInterp>) => setDraft(withInterps(draft, dInterps.map((x) => (x.id === id ? { ...x, ...p } : x))));
  const setB = (iid: string, bid: string, p: Partial<AbBeleg>) => setDraft(withInterps(draft, dInterps.map((x) => (x.id === iid ? { ...x, belege: x.belege.map((b) => (b.id === bid ? { ...b, ...p } : b)) } : x))));
  const commit = () => {
    onSave(withInterps({ ...draft, title: draft.title.trim() || 'Ohne Titel', reason: draft.reason?.trim() || undefined }, dInterps.map((x) => ({ ...x, text: x.text.trim(), belege: x.belege.map((b) => ({ ...b, text: b.text.trim() })) }))), `Hypothese ${h.code} bearbeitet`);
    setEdit(false);
  };
  const who = (b: AbBeleg) => itemOf(b.item)?.person ?? b.person;
  // the test person of an interpretation: a dropdown, "Allgemein" by default
  const personPick = (value: string | undefined, onPick: (p: string | undefined) => void, label: string) => (
    <select className="st-ab-psel" value={value ?? ''} aria-label={label} onChange={(e) => onPick(e.target.value || undefined)}>
      <option value="">Allgemein</option>
      {[...new Set([...persons, ...(value ? [value] : [])])].map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
  if (edit)
    return (
      <div className="st-ab-hyp is-edit">
        <div className="st-ab-chead st-ab-edtop">
          <span className="st-ab-code">{hcode(h.code)}</span>
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={() => setEdit(false)}>
            Abbrechen
          </button>
          <button type="button" className="st-cx-btn is-pri" onClick={commit}>
            Speichern
          </button>
        </div>
        <div className="st-ab-chead">
          <input className="st-ab-in" value={draft.title} placeholder="Kurzer Titel, z. B. Präferenz durch Ergebnisqualität beeinflusst" aria-label="Titel der Hypothese" autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div className="st-ab-legend">
          {EV_KIND.map(([k, l]) => (
            <span key={k}>
              <i className={KIND_FILL[k]} />
              {l}
            </span>
          ))}
          <span>
            <i className="is-fig" />
            verlinkte Abbildung
          </span>
        </div>
        {dInterps.map((x, n) => (
          <div key={x.id} className="st-ab-ied">
            <div className="st-ab-iedhead">
              <span className="st-cx-lab">{dInterps.length > 1 ? `Interpretation ${n + 1}` : 'Interpretation'}</span>
              {dInterps.length > 1 && (
                <button type="button" className="st-cx-x is-small" aria-label={`Interpretation ${n + 1} entfernen`} title="Interpretation entfernen" onClick={() => setDraft(withInterps(draft, dInterps.filter((y) => y.id !== x.id)))}>
                  ×
                </button>
              )}
            </div>
            {personPick(x.person, (p) => setI(x.id, { person: p }), `Testperson der Interpretation ${n + 1}`)}
            <LinkText
              rows={3}
              value={x.text}
              label={`Interpretation ${n + 1}`}
              placeholder="Was die Ergebnisse erklären könnte – als Annahme formuliert"
              onChange={(v) => setI(x.id, { text: v })}
              belegPicker={(link, close) => (
                <EvidencePicker
                  h={draft}
                  askKind
                  linked={new Set(x.belege.map((b) => b.item).filter((v): v is string => !!v))}
                  start={x.person ?? ''}
                  items={[...items.values()]}
                  onClose={close}
                  onPick={(item, kind) => {
                    // (a statement already a Beleg here: that Beleg, with the kind now chosen)
                    const had = x.belege.find((b) => b.item === item);
                    const id = had?.id ?? uid('b');
                    const belege = had ? x.belege.map((b) => (b.id === id ? { ...b, kind } : b)) : [...x.belege, { id, item, person: itemOf(item)?.person, kind, text: '' }];
                    setI(x.id, { text: link(id), belege });
                    close();
                  }}
                />
              )}
            />
            {x.belege.map((b) => {
              const it = itemOf(b.item);
              return (
                <div key={b.id} className={`st-ab-beled ${KIND_FILL[b.kind]}`}>
                  <div className="st-ab-beledhead">
                    {/* (a Beleg from a statement: its P-ID is the statement's, not editable) */}
                    {it ? (
                      <span className="st-ab-ichip" title="Testperson der Aussage">{it.person}</span>
                    ) : (
                      <select value={b.person ?? ''} aria-label="Person" onChange={(e) => setB(x.id, b.id, { person: e.target.value || undefined })}>
                        <option value="">Allgemein</option>
                        {persons.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="st-ab-kinds" role="radiogroup" aria-label="Art des Belegs">
                      {EV_KIND.map(([k, l]) => (
                        <button key={k} type="button" role="radio" aria-checked={b.kind === k} className={b.kind === k ? 'is-on' : ''} title={l} aria-label={l} onClick={() => setB(x.id, b.id, { kind: k })}>
                          <i className={KIND_FILL[k]} />
                        </button>
                      ))}
                    </span>
                    {it && <span className="st-muted st-ab-belsrc">{SECTION_LABEL[it.section]}</span>}
                    {!it && b.item && <span className="st-muted st-ab-belsrc">Aussage gelöscht</span>}
                    <button type="button" className="st-cx-x is-small" aria-label="Beleg entfernen" title="Beleg entfernen" onClick={() => setI(x.id, { belege: x.belege.filter((y) => y.id !== b.id) })}>
                      ×
                    </button>
                  </div>
                  {/* (a Beleg from a statement: the statement itself, not editable) */}
                  {it ? (
                    <div className="st-ab-belro" aria-label={`Aussage ${it.person}`}>
                      {questionOf(it) && <p className="st-ab-belq" data-notr>{questionOf(it)}</p>}
                      <p>{`„${itemText(view, it)}“`}</p>
                    </div>
                  ) : (
                    <LinkText rows={2} value={b.text} label={`Beleg ${who(b) ?? ''}`} placeholder="Was dieser Beleg für die Interpretation zeigt" onChange={(v) => setB(x.id, b.id, { text: v })} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div className="st-ab-row">
          <button type="button" className="st-cx-btn" onClick={() => setDraft(withInterps(draft, [...dInterps, { id: uid('i'), text: '', belege: [] }]))}>
            + Interpretation
          </button>
        </div>
        <span className="st-cx-lab">Status (Redesign, für die ganze Hypothese)</span>
        <span className="st-ab-chips" role="radiogroup" aria-label="Status der Hypothese">
          {HYP_STATUS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={draft.status === k} className={`st-fchip${draft.status === k ? ' is-on' : ''}`} onClick={() => setDraft({ ...draft, status: k })}>
              {l}
            </button>
          ))}
        </span>
        {draft.status === 'rejected' && <textarea rows={2} value={draft.reason ?? ''} placeholder="Warum nicht berücksichtigt (z. B. zu wenig Evidenz, Projektumfang)" aria-label="Grund" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />}
        <div className="st-ab-foot">
          <button type="button" className="st-linkbtn st-cx-del" onClick={() => confirm(`Hypothese ${hcode(h.code)} löschen? Sie wird auch aus den Redesign-Entscheidungen genommen.`) && onDelete()}>
            Löschen
          </button>
        </div>
      </div>
    );
  const pickFor = interps.find((x) => x.id === pick);
  // a Beleg link: unfold the interpretation's Belege, scroll to the Beleg, mark it briefly
  const goBeleg = (iid: string, id: string) => {
    setOpen((o) => new Set(o).add(iid));
    window.setTimeout(() => {
      const el = document.querySelector(`[data-bel="${id}"]`);
      if (!el) return;
      const head = document.querySelector('.st-pagehead');
      const top = window.scrollY + el.getBoundingClientRect().top - (head ? head.getBoundingClientRect().height : 0) - 24;
      window.scrollTo({ top, behavior: 'smooth' });
      setFlash(id);
      window.setTimeout(() => setFlash(null), 1400);
    }, 60);
  };
  return (
    <article className={`st-ab-hyp is-${h.status}`}>
      <span className="st-ab-hcode">{hcode(h.code)}</span>
      <button type="button" className="st-iconbtn st-ab-hedit" aria-label={`${hcode(h.code)} bearbeiten`} title="Bearbeiten" onClick={start}>
        <PenIcon />
      </button>
      <h4 className="st-ab-htitle">{h.title || 'Ohne Titel'}</h4>
      {!interps.length && <p className="st-ab-htext st-muted">Noch keine Interpretation.</p>}
      {h.status === 'rejected' && h.reason && <p className="st-ab-reason">{`Nicht berücksichtigt: ${h.reason}`}</p>}
      {interps.map((x) => {
        const folded = x.belege.length >= 2 && !open.has(x.id);
        return (
          <div key={x.id} className="st-ab-interp">
            {x.person && (
              <span className="st-ab-irow">
                <span className="st-ab-ichip">{x.person}</span>
              </span>
            )}
            <p className="st-ab-htext">{x.text ? <RichText text={x.text} belege={x.belege} onBeleg={(id) => goBeleg(x.id, id)} /> : <span className="st-muted">Noch kein Text.</span>}</p>
            <span className="st-ab-tipwrap st-ab-hplus">
              <button type="button" className="st-lc-add" aria-label="Beleg hinzufügen" onClick={() => setPick(x.id)}>
                <PlusIcon />
              </button>
              <span className="st-ab-tip" role="tooltip">
                Beleg hinzufügen
              </span>
            </span>
            {x.belege.length > 0 && (
              <div className={`st-ab-belege${folded ? ' is-folded' : ''}`}>
                {x.belege.map((b) => {
                  const it = itemOf(b.item);
                  return (
                    <div key={b.id} className={`st-ab-bel ${KIND_FILL[b.kind]}${flash === b.id ? ' is-flash' : ''}`} data-bel={b.id}>
                      <div className="st-ab-belhead">
                        {(it?.person || b.person) && <span className="st-ab-ichip">{it?.person || b.person}</span>}
                        {it && SECTION_LABEL[it.section]}
                        <span className="st-ab-vh">{EV_KIND.find(([k]) => k === b.kind)?.[1]}</span>
                      </div>
                      {questionOf(it) && <p className="st-ab-belq" data-notr>{questionOf(it)}</p>}
                      {/* (a Beleg from a statement: the statement; otherwise its own text) */}
                      {it ? (
                        <p className="st-ab-beltext">{`„${itemText(view, it)}“`}</p>
                      ) : (
                        b.text && (
                          <p className="st-ab-beltext">
                            <RichText text={b.text} />
                          </p>
                        )
                      )}
                      {!it && b.item && <span className="st-ab-src">Aussage gelöscht</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {x.belege.length >= 2 && (
              <div className="st-ab-unfold">
                <button
                  type="button"
                  className="st-iconbtn"
                  aria-expanded={!folded}
                  aria-label={folded ? `Alle ${x.belege.length} Belege anzeigen` : 'Belege einklappen'}
                  title={folded ? `Alle ${x.belege.length} Belege anzeigen` : 'Einklappen'}
                  onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={folded ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} />
                  </svg>
                </button>
              </div>
            )}
          </div>
        );
      })}
      {pickFor && (
        <EvidencePicker
          h={h}
          linked={new Set(pickFor.belege.map((b) => b.item).filter((v): v is string => !!v))}
          start={pickFor.person ?? ''}
          items={[...items.values()]}
          onClose={() => setPick(null)}
          onPick={(item, kind) => {
            const next = interpsOf(h).map((x) =>
              x.id !== pickFor.id ? x : { ...x, belege: x.belege.some((b) => b.item === item) ? x.belege.map((b) => (b.item === item ? { ...b, kind } : b)) : [...x.belege, { id: uid('b'), item, person: itemOf(item)?.person, kind, text: '' }] },
            );
            onSave(withInterps(h, next), `Beleg zu ${h.code}`);
          }}
        />
      )}
    </article>
  );
}

// a small search over Beobachtungen & Feedback to link statements
// (askKind: a statement is picked first, then its kind is asked)
function EvidencePicker({ h, items, linked, start = '', askKind, onClose, onPick }: { h: AbHyp; items: ItemDoc[]; linked: Set<string>; start?: string; askKind?: boolean; onClose: () => void; onPick: (item: string, kind: EvKind) => void }) {
  const view = useContentView();
  const [q, setQ] = useState(start);
  const [kind, setKind] = useState<EvKind>('support');
  const [chosen, setChosen] = useState<ItemDoc | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items.filter((i) => words.every((w) => `${i.person} ${i.text} ${i.de ?? ''} ${i.question ?? ''}`.toLowerCase().includes(w))).slice(0, 40);
  return (
    <div className="st-modal-back" role="presentation" onClick={onClose}>
      <div className="st-modal st-ab-picker" role="dialog" aria-modal="true" aria-label={`Belege für ${hcode(h.code)}`} onClick={(e) => e.stopPropagation()}>
        <header className="st-modal-head">
          <h2>{`Beleg hinzufügen · ${hcode(h.code)}${h.title ? ` · ${h.title}` : ''}`}</h2>
          <div className="st-ab-pickbar">
            <input type="search" autoFocus value={q} placeholder="Suchen: P-ID oder Wort …" aria-label="Aussagen durchsuchen" onChange={(e) => setQ(e.target.value)} />
            {!askKind && (
              <span className="st-ab-chips" role="radiogroup" aria-label="Art des Belegs">
                {EV_KIND.map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} className={`st-fchip${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)}>
                    {l}
                  </button>
                ))}
              </span>
            )}
          </div>
        </header>
        {chosen ? (
          <div className="st-modal-body st-ab-askkind">
            <div className="st-ab-chosen">
              <small>{`${chosen.person} · ${SECTION_LABEL[chosen.section]}`}</small>
              {itemText(view, chosen)}
            </div>
            <span className="st-cx-lab">Wie steht diese Aussage zur Interpretation?</span>
            <div className="st-ab-kindbtns">
              {EV_KIND.map(([k, l]) => (
                <button key={k} type="button" className="st-cx-btn" onClick={() => onPick(chosen.id, k)}>
                  <i className={KIND_FILL[k]} />
                  {l}
                </button>
              ))}
            </div>
            <button type="button" className="st-linkbtn" onClick={() => setChosen(null)}>
              Andere Aussage wählen
            </button>
          </div>
        ) : (
        <div className="st-modal-body">
          {!hits.length && <p className="st-muted">Keine Aussage gefunden.</p>}
          <ul className="st-ab-hits">
            {hits.map((i) => (
              <li key={i.id}>
                <span>
                  <small>{`${i.person} · ${SECTION_LABEL[i.section]}`}</small>
                  {itemText(view, i)}
                </span>
                <button type="button" className={`st-cx-btn${linked.has(i.id) && !askKind ? '' : ' is-pri'}`} onClick={() => (askKind ? setChosen(i) : onPick(i.id, kind))}>
                  {askKind ? 'Auswählen' : linked.has(i.id) ? 'Verknüpft ✓' : 'Verknüpfen'}
                </button>
              </li>
            ))}
          </ul>
        </div>
        )}
        <footer className="st-modal-foot">
          <span className="st-muted">{askKind ? 'Die Aussage wird als Beleg hinzugefügt und verlinkt.' : `${linked.size} verknüpft`}</span>
          <span className="st-selbar-gap" />
          <button type="button" onClick={onClose}>
            {askKind ? 'Abbrechen' : 'Fertig'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// a redesign decision: the hypotheses considered, the proposal, why
function DecCard({ d, hyps, startEdit, onSave, onDelete }: { d: AbDecision; hyps: AbHyp[]; startEdit: boolean; onSave: (d: AbDecision, what: string) => void; onDelete: () => void }) {
  const [edit, setEdit] = useState(startEdit);
  const [draft, setDraft] = useState(d);
  const [copied, setCopied] = useState(false);
  const linked = hyps.filter((h) => d.hyps.includes(h.id));
  const copy = async () => {
    const t = [`Redesign: ${d.title || 'Ohne Titel'}`, `Berücksichtigte Hypothesen: ${linked.map((h) => `${hcode(h.code)} ${h.title}`).join('; ') || '–'}`, `Gestaltungsvorschlag: ${d.proposal || '–'}`, `Begründung: ${d.why || '–'}`].join('\n');
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Zum Kopieren:', t);
    }
  };
  if (edit)
    return (
      <div className="st-ab-card is-edit">
        <input className="st-ab-in" value={draft.title} placeholder="Maßnahme, z. B. Wirkung des Feedbacks vorab zeigen" aria-label="Titel der Maßnahme" autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <span className="st-cx-lab">Berücksichtigte Hypothesen</span>
        <div className="st-ab-chips">
          {hyps.map((h) => {
            const on = draft.hyps.includes(h.id);
            return (
              <button key={h.id} type="button" className={`st-fchip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setDraft({ ...draft, hyps: on ? draft.hyps.filter((x) => x !== h.id) : [...draft.hyps, h.id] })}>
                {`${hcode(h.code)} · ${h.title || 'Ohne Titel'}`}
              </button>
            );
          })}
          {!hyps.length && <span className="st-muted">Noch keine Hypothese.</span>}
        </div>
        <span className="st-cx-lab">Gestaltungsvorschlag</span>
        <textarea rows={3} value={draft.proposal} aria-label="Gestaltungsvorschlag" placeholder="Was im Redesign geändert wird" onChange={(e) => setDraft({ ...draft, proposal: e.target.value })} />
        <span className="st-cx-lab">Begründung der Entscheidung</span>
        <textarea rows={3} value={draft.why} aria-label="Begründung der Entscheidung" placeholder="Warum – mit Bezug auf Ergebnisse und Belege" onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
        <div className="st-ab-foot">
          <button type="button" className="st-linkbtn st-cx-del" onClick={() => confirm('Diese Redesign-Entscheidung löschen?') && onDelete()}>
            Löschen
          </button>
          <span className="st-cx-sp" />
          <button type="button" className="st-cx-btn" onClick={() => setEdit(false)}>
            Abbrechen
          </button>
          <button
            type="button"
            className="st-cx-btn is-pri"
            onClick={() => {
              onSave({ ...draft, title: draft.title.trim() || 'Ohne Titel', proposal: draft.proposal.trim(), why: draft.why.trim() }, `Redesign „${draft.title.trim() || 'Ohne Titel'}“ gespeichert`);
              setEdit(false);
            }}
          >
            Speichern
          </button>
        </div>
      </div>
    );
  return (
    <div className="st-ab-card">
      <div className="st-ab-chead">
        <strong>{d.title || 'Ohne Titel'}</strong>
      </div>
      <span className="st-cx-lab">Berücksichtigte Hypothesen</span>
      <div className="st-ab-chips">
        {linked.length ? (
          linked.map((h) => (
            <span key={h.id} className="st-ab-tag is-dim">
              {`${hcode(h.code)} · ${h.title || 'Ohne Titel'}`}
            </span>
          ))
        ) : (
          <span className="st-muted">keine</span>
        )}
      </div>
      <span className="st-cx-lab">Gestaltungsvorschlag</span>
      <p className="st-ab-text">{d.proposal || '–'}</p>
      <span className="st-cx-lab">Begründung der Entscheidung</span>
      <p className="st-ab-text">{d.why || '–'}</p>
      <div className="st-ab-row">
        <span className="st-muted">{`${linked.length} ${linked.length === 1 ? 'Hypothese' : 'Hypothesen'} verknüpft`}</span>
        <span className="st-cx-sp" />
        <button type="button" className="st-cx-btn" onClick={() => void copy()}>
          {copied ? 'Kopiert ✓' : 'Kopieren'}
        </button>
        <button type="button" className="st-cx-btn" onClick={() => (setDraft(d), setEdit(true))}>
          Bearbeiten
        </button>
      </div>
    </div>
  );
}
