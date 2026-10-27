// Shared pieces of the /feedback pages: the context every page reads (model,
// scope, saving), figure numbering and captions, small layout parts.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DURATION_LABEL, omit, type DurationBy, type Model, type Scope, type Slice } from './model';
import type { Study } from './store';
import { Figure } from './charts';
import { getLang, tr } from './i18n';

export interface Ctx {
  study: Study;
  model: Model;
  scope: Scope;
  slice: Slice;
  omitted: string[]; // ticked off in the participants menu (left out of every view)
}
export const StudyCtx = createContext<Ctx | null>(null);
export const useCtx = () => useContext(StudyCtx)!;

// every figure in page order: its number is its place here, so numbers stay
// the same whatever the data or filter
export const FIGURES: { id: string; title: string; caption: string }[] = [
  // Übersicht
  { id: 'alter', title: 'Alter', caption: 'Altersverteilung der Teilnehmenden.' },
  { id: 'gruppe', title: 'Testgruppe', caption: 'Verteilung der Teilnehmenden auf die Testreihenfolgen AB und BA.' },
  { id: 'laufzeit', title: 'Bearbeitungsdauer', caption: 'Bearbeitungsdauer je Teilnehmenden in Minuten.' },
  { id: 'teil4', title: 'Angaben zur Person', caption: 'Angaben der Teilnehmenden (Umfrage, Teil 4).' },
  { id: 'ablauf', title: 'Dauer je Spielabschnitt', caption: 'Dauer je Spielabschnitt in Minuten (Median über die Teilnehmenden).' },
  { id: 'kategorien', title: 'Rückmeldungen nach Kategorie', caption: 'Anzahl der Rückmeldungen je Kategorie und Anzahl der Teilnehmenden, die sie äußerten.' },
  // Quantitative Analyse
  { id: 'teil1', title: 'Teil 1: Direkter Vergleich', caption: 'Bevorzugte Variante je Frage im direkten Vergleich.' },
  { id: 'teil2', title: 'Teil 2: Likert-Skala', caption: 'Antwortverteilung der Likert-Items je Variante.' },
  { id: 'teil2single', title: 'Teil 2: Aussagen zu beiden Varianten', caption: 'Antwortverteilung der Aussagen, die sich auf beide Varianten beziehen.' },
  { id: 'teil2vergleich', title: 'Teil 2: Vergleichsfragen', caption: 'Bevorzugte Variante je Vergleichsfrage in Teil 2.' },
  { id: 'teil2wahl', title: 'Teil 2: Auswahlfrage', caption: 'Verteilung der Antworten (Einfachauswahl).' },
  { id: 'teil3', title: 'Teil 3: UEQ-S', caption: 'UEQ-S-Skalenmittelwerte (−3 bis +3) je Variante mit 95 %-Konfidenzintervall.' },
  { id: 'teil3gesamt', title: 'Teil 3: UEQ-S (gesamtes Spiel)', caption: 'UEQ-S-Skalen- und Itemmittelwerte (−3 bis +3) für das gesamte Spiel mit 95 %-Konfidenzintervall.' },
  { id: 'teil3vergleich', title: 'Teil 3: Vergleichsfragen', caption: 'Bevorzugte Variante je Vergleichsfrage in Teil 3.' },
  { id: 'teil3wahl', title: 'Teil 3: Auswahlfrage', caption: 'Verteilung der Antworten (Einfachauswahl).' },
  { id: 'teil3items', title: 'Teil 3: UEQ-S-Items', caption: 'Mittelwerte der einzelnen UEQ-S-Items je Variante.' },
  { id: 'crafts', title: 'Crafting-Vorgänge je Variante', caption: 'Abgeschlossene Crafting-Vorgänge, Überarbeitungen und Ersatzergebnisse je Variante.' },
  { id: 'votes', title: 'Bewertung der Ergebnisse', caption: 'Bewertungen der erzeugten Ergebnisse je Variante.' },
  { id: 'spielfragen', title: 'Bewertung im Spiel', caption: 'Mittelwerte der Bewertungsfragen im Spiel (1–5) je Variante mit 95 %-Konfidenzintervall.' },
  { id: 'praeferenzen', title: 'Präferenzen in Variante B', caption: 'Gewählte Einstellungen in den Präferenzfragen von Variante B.' },
  // Qualitatives Feedback
  { id: 'befunde', title: 'Wiederkehrende Befunde', caption: 'Wiederkehrende Befunde nach Anzahl der Teilnehmenden.' },
];
// (Teil 4 has one figure per field: 13.1, 13.2, …)
export const figNumber = (id: string) => FIGURES.findIndex((f) => f.id === id) + 1;

// children and table may take the figure's slice: the scope's, without the
// participants left out in this figure (stored per figure, like the caption)
export function Fig({ id, sub, title, children, table }: { id: string; sub?: { n: number; title: string }; title?: string; children: ReactNode | ((s: Slice) => ReactNode); table?: (s: Slice) => string }) {
  const ctx = useCtx();
  const { study, slice } = ctx;
  const figKey = sub ? `${id}.${sub.n}` : id;
  const omitKey = `omit.${figKey}`;
  const stored = ((study.docs.settings[omitKey] as { ids?: string[] } | undefined)?.ids ?? []).filter((x) => slice.persons.some((p) => p.id === x));
  const s = omit(slice, stored);
  const en = getLang() === 'en';
  const f = FIGURES.find((x) => x.id === id)!;
  // captions per language: the German one under the figure's id, the English one under id.en
  const key = figKey + (en ? '.en' : '');
  const storedCaption = (study.docs.captions[key] as { caption?: string } | undefined)?.caption;
  const base = en ? tr(f.caption) : f.caption;
  const caption = storedCaption ?? (sub ? `${base.replace(/\.$/, '')}: ${sub.title}${/[.?!]$/.test(sub.title) ? '' : '.'}` : base);
  const n = figNumber(id);
  return (
    <Figure
      n={sub ? `${n}.${sub.n}` : n}
      title={title ?? (sub ? `${f.title}: ${sub.title}` : f.title)}
      caption={caption}
      onCaption={(c) => study.commit([{ coll: 'captions', id: key, data: { caption: c } }])}
      table={table && (() => table(s))}
      people={slice.persons.length > 1 ? slice.persons.map((p) => p.id) : undefined}
      omitted={stored}
      alsoOmitted={ctx.omitted}
      onOmit={(ids) => study.commit([{ coll: 'settings', id: omitKey, data: { ids } }])}
    >
      {/* (components inside read the figure's slice from the context too) */}
      <StudyCtx.Provider value={{ ...ctx, slice: s }}>{typeof children === 'function' ? children(s) : children}</StudyCtx.Provider>
    </Figure>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="st-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="st-stat">
      <div className="st-stat-label">{label}</div>
      <div className="st-stat-value">{value}</div>
      {sub != null && <div className="st-stat-sub">{sub}</div>}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="st-empty">{children}</p>;

// (the header row in the dashboard's language)
export const csv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r, i) => (i ? r : r.map((c) => (typeof c === 'string' ? tr(c) : c)))).map((r) => r.map((c) => (c == null ? '' : /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(';')).join('\n');

export const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
export const fmtMin = (m: number | null | undefined) => (m == null ? '–' : `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')} min`);

// a text field saved when it loses focus (not on every key)
export function LazyInput({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input {...rest} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

// the change log (Daten & Validierung): imports and corrections, newest first
export interface LogEntry {
  at: number;
  what: string;
}
export function logChange(study: Study, what: string) {
  const old = ((study.latest().settings.log as { entries?: LogEntry[] } | undefined)?.entries ?? []).slice(0, 299);
  study.commit([{ coll: 'settings', id: 'log', data: { entries: [{ at: Date.now(), what }, ...old] } }]);
}

// which measure "Bearbeitungsdauer" uses (applies everywhere)
export function DurationSelect() {
  const { study } = useCtx();
  const by = ((study.docs.settings.durationBy as { by?: DurationBy } | undefined)?.by ?? 'auto') as DurationBy;
  return (
    <label className="st-scope">
      <span>Bearbeitungsdauer =</span>
      <select
        value={by}
        onChange={(e) => {
          const next = e.target.value as DurationBy;
          study.commit([{ coll: 'settings', id: 'durationBy', data: { by: next } }]);
          logChange(study, `Bearbeitungsdauer: ${DURATION_LABEL[by]} → ${DURATION_LABEL[next]}`);
        }}
      >
        {(Object.keys(DURATION_LABEL) as DurationBy[]).map((k) => (
          <option key={k} value={k}>
            {DURATION_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

// a multi-line text saved when it loses focus
export function LazyArea({ value, onSave, placeholder, autoFocus, onDone }: { value: string; onSave: (v: string) => void; placeholder?: string; autoFocus?: boolean; onDone?: () => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className="st-area"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={draft}
      rows={Math.max(2, Math.ceil(draft.length / 70))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft);
        onDone?.();
      }}
      onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
    />
  );
}
