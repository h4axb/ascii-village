// The first process model: the phases (macro), their areas (meso) and methods
// (micro) of the project's methodical framework. Written once (store.ts,
// settings.methodsSeeded); after that every part is edited in the journal.
import type { Put } from './store';
import { ALONGSIDE, type JournalDocs, type Method, type MethodPhase, type MethodType, type PhaseTone } from './types';

type Row = [name: string, desc: string, type: MethodType];
const MODEL: { code: string; name: string; tone: PhaseTone; cols: number; result: string; areas: [string, Row[]][] }[] = [
  { code: 'M1', name: 'Exploration', tone: 'ex', cols: 3, result: 'Machbarkeitsgeprüftes Spielkonzept', areas: [
    ['Explorative Recherche', [['Literaturrecherche', 'Grundlagen zu Lernspielen und LLM-Einsatz', 'W'], ['Marktanalyse', 'Vergleichbare Spiele, Lücken, Zielgruppe', 'H']]],
    ['Konzeptfindung und -selektion', [['Ideenfindung', 'Sammeln und Clustern erster Spielideen', 'D'], ['Machbarkeitsbewertung', 'Technische und zeitliche Einschätzung', 'H'], ['Konzeptbegrenzung', 'Umfang auf das Kernkonzept reduzieren', 'D']]],
    ['Exploratives Prototyping', [['LLM-problemorientierte Konzeptentwicklung', 'Ideen aus konkreten Problemen ableiten', 'D'], ['LLM-gestützte Spielmechanikkonzeption', 'Mechaniken mit dem LLM durchspielen', 'H'], ['Iterative LLM-Mechanikexploration', 'Schnelle Varianten testen und verwerfen', 'D'], ['Inspirationsbasierte Konzeptentwicklung', 'Referenzen als Ausgangspunkt', 'D'], ['Machbarkeitsorientierte Konzeptentwicklung', 'Konzept an Ressourcen ausrichten', 'H']]],
  ] },
  { code: 'M2', name: 'Prototypentwicklung', tone: 'fu', cols: 3, result: 'Spielbarer Prototyp mit zwei Untersuchungsvarianten', areas: [
    ['Wissenschaftliche Recherche', [['Literaturrecherche', 'Feedback, Personalisierung, Motivation', 'W'], ['Theorierecherche', 'Theoretische Grundlagen', 'W']]],
    ['Gestalterische Recherche', [['Naturkulturelle Recherche', 'Setting, Flora, Fauna', 'D'], ['Genrebezogene Spielanalyse', 'Vergleich ähnlicher Spiele', 'H'], ['Visuelle Referenzanalyse', 'ASCII-Stile, Farbwelten', 'D']]],
    ['Narrative Konzeption', [['Referenzanalyse von Intro-Sequenzen', 'Aufbau und Tempo', 'D'], ['Storyboarding', 'Intro und Quests skizzieren', 'D'], ['Visuelle Referenzanalyse', 'Figuren und Szenen', 'D']]],
    ['Interaktionsgestaltung', [['Mechanikkonzeption', 'Crafting und Feedback-Loop', 'D'], ['Variantenentwicklung', 'Variante A und B', 'D'], ['Interaktionsgestaltung', 'Dialoge, Panels, Eingaben', 'D']]],
    ['Quest Design', [['Quest-Konzeption', 'Ablauf und Belohnungen', 'D'], ['Spielerzentrierte Questgestaltung', 'Ziele aus Sicht der Spielenden', 'H']]],
    ['Nutzertestkonzeption', [['Instrumentenrecherche', 'Fragebögen und Skalen', 'W'], ['Untersuchungsdesign', 'Aufbau und Ablauf der Studie', 'W'], ['Fragebogenentwicklung', 'In-Game und Abschluss', 'W']]],
  ] },
  { code: 'M3', name: 'Nutzeruntersuchung', tone: 'fu', cols: 2, result: 'Quantitativer und qualitativer Datensatz', areas: [
    ['Wissenschaftliche Recherche', [['Literaturrecherche', 'Testmethoden und Stichprobe', 'W'], ['Auswertungsmethodenrecherche', 'Kodierung und Statistik', 'W']]],
    ['Testvorbereitung', [['Probandenrekrutierung', 'Aufruf, Termine, P-IDs', 'A'], ['Testorganisation', 'Ablaufplan und Material', 'A'], ['Technische Vorbereitung', 'Test-Links, Tracking, Deploy', 'A']]],
    ['Testdurchführung', [['Vergleichender Nutzertest', 'Variante A gegen B', 'W'], ['Moderierter Remote-Nutzertest', 'Per Call mit Bildschirmfreigabe', 'W'], ['Qualitative Beobachtung', 'Verhalten und Aussagen', 'W']]],
    ['Datenerhebung', [['In-Game Befragung', 'Fragen direkt im Spiel', 'H'], ['Abschlussfragebogen', 'Fragebogen nach dem Test', 'W'], ['Beobachtungsprotokoll', 'Notizen je Teilnehmer', 'W']]],
  ] },
  { code: 'M4', name: 'Datenauswertung', tone: 'fu', cols: 3, result: 'Empirisch abgeleitete Gestaltungsempfehlungen', areas: [
    ['Datenaufbereitung', [['Datenintegration', 'Spiel, Umfrage und Notizen zusammenführen', 'A'], ['Datenvalidierung', 'Konflikte und Lücken prüfen', 'A'], ['Kontextualisierung', 'Zeiten und Versuche zuordnen', 'H']]],
    ['Qualitative Auswertung', [['Qualitative Kodierung', 'Aussagen taggen', 'W'], ['Kategorienbildung', 'Tags zu Kategorien', 'W']]],
    ['Quantitative Auswertung', [['Deskriptive Statistik', 'Mittelwerte, Verteilungen, n', 'W']]],
    ['Datenvisualisierung', [['Dashboard-Entwicklung', 'Auswertungs-Dashboard', 'D'], ['Grafische Ergebnisaufbereitung', 'Abbildungen für die Arbeit', 'D']]],
    ['Ergebnisinterpretation', [['Musteranalyse', 'Wiederkehrende Probleme', 'W'], ['Explorative Subgruppenanalyse', 'Unterschiede nach Profil', 'W'], ['Hypothesengenerierung', 'Annahmen für das Redesign', 'W']]],
    ['Ergebnissynthese', [['Befundintegration', 'Qualitative und quantitative Befunde', 'H'], ['Systematische Befundordnung', 'Nach Priorität ordnen', 'H'], ['Handlungsempfehlungen', 'Konkrete Gestaltungsschritte', 'D']]],
  ] },
  { code: 'M5', name: 'Redesign', tone: 'fu', cols: 3, result: 'Überarbeitetes UI/UX-Konzept und Designsystem', areas: [
    ['Erkenntnisbasierte Gestaltungskonzeption', [['Erkenntnistransfer', 'Befunde in Anforderungen', 'H'], ['Zieldefinition', 'Was das Redesign lösen soll', 'D'], ['Gestaltungsentscheidungen', 'Begründet und dokumentiert', 'D']]],
    ['Systematische Interface-Gestaltung', [['Interface-Prototyping', 'Screens und Abläufe', 'D'], ['Designsystementwicklung', 'Komponenten, Farben, Specs', 'D']]],
    ['Designdokumentation', [['Entscheidungsdokumentation', 'Entscheidungen festhalten', 'A'], ['Vorher-Nachher-Vergleich', 'Aktuell gegen Neu', 'D'], ['Ergebnisdokumentation', 'Für die Arbeit aufbereitet', 'A']]],
  ] },
  { code: 'M6', name: 'Ausarbeitung der Bachelorarbeit', tone: 'wa', cols: 2, result: 'Schriftliche Bachelorarbeit', areas: [
    ['Wissenschaftliche Recherche', [['Vertiefende Literaturrecherche', 'Ergänzung des Forschungsstands', 'W']]],
    ['Wissenschaftliche Reflexion', [['Theoretische Einordnung', 'Befunde im Forschungsstand', 'W'], ['Methodenkritik', 'Grenzen der Untersuchung', 'W'], ['Fazit und Ausblick', 'Beantwortung der Forschungsfrage', 'W']]],
    ['Wissenschaftliche Verschriftlichung', [['Inhaltliche Strukturierung', 'Gliederung der Arbeit', 'W'], ['Methodendokumentation', 'Vorgehen nachvollziehbar', 'W'], ['Ergebnisdarstellung', 'Tabellen und Abbildungen', 'W']]],
    ['Qualitätssicherung', [['Inhaltliche Revision', 'Argumentation prüfen', 'A'], ['Quellenprüfung', 'Zitate und Verzeichnis', 'A'], ['Formale Überarbeitung', 'Layout, Sprache, Abgabe', 'A']]],
  ] },
];
const ALONG: Row[] = [
  ['Project Log', 'Tägliche Dokumentation', 'A'],
  ['Weekly Reviews', 'Wöchentliche Reflexion', 'A'],
  ['Quellenverwaltung', 'Zotero-Bibliothek', 'A'],
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export function seedMethods(d: JournalDocs): Put[] {
  if (Object.keys(d.phases ?? {}).length || Object.keys(d.methods ?? {}).length) return [];
  const now = Date.now();
  const put: Put[] = [];
  const method = (phase: string, area: string, [name, desc, type]: Row, order: number) => {
    const m: Method = { id: `mt-${phase}-${slug(area)}-${slug(name)}`.slice(0, 120), name, desc, type, phase, area, order, created: now };
    put.push({ coll: 'methods', id: m.id, data: m });
  };
  MODEL.forEach((p, i) => {
    const id = p.code.toLowerCase();
    const ph: MethodPhase = { id, code: p.code, name: p.name, tone: p.tone, result: p.result, cols: p.cols, areas: p.areas.map(([a]) => a), order: i + 1 };
    put.push({ coll: 'phases', id, data: ph });
    p.areas.forEach(([a, rows]) => rows.forEach((r, j) => method(id, a, r, j)));
  });
  put.push({ coll: 'phases', id: ALONGSIDE, data: { id: ALONGSIDE, code: '', name: 'Projektbegleitende Tätigkeiten', tone: 'fu', result: '', cols: 3, areas: [''], order: 0 } satisfies MethodPhase });
  ALONG.forEach((r, j) => method(ALONGSIDE, '', r, j));
  return put;
}

// ---- the WDHA reconciliation (settings.methodsV2): what the list names and the
// catalogue does not have yet. Existing methods stay as they are; a name that is
// already in the catalogue (anywhere) is skipped. phase: a code (M1 …) or ALONGSIDE.
type Add = [name: string, type: MethodType, phase: string, area: string, desc: string, source?: string];
const ADDITIONS: Add[] = [
  // W
  ['Standardisierte Befragung', 'W', 'M3', 'Datenerhebung', 'Vergleichbare Bewertungen erheben'],
  ['Qualitative Befragung', 'W', 'M3', 'Datenerhebung', 'Individuelle Erfahrungen und Einschätzungen erfassen'],
  ['Explorative Datenanalyse', 'W', 'M4', 'Ergebnisinterpretation', 'Auffälligkeiten, Muster und Zusammenhänge entdecken'],
  ['Vergleichende Einzelfallanalyse', 'W', 'M4', 'Ergebnisinterpretation', 'Einzelne Teilnehmer und ihre Ergebnisse genauer betrachten'],
  // D
  ['Exploratives Prototyping', 'D', 'M1', 'Exploratives Prototyping', 'Verschiedene Konzepte praktisch erproben', 'Floyd (1984)'],
  ['Experimentelles Prototyping', 'D', 'M1', 'Exploratives Prototyping', 'Technische und gestalterische Lösungsansätze überprüfen'],
  ['Iterative Gestaltung', 'D', 'M1', 'Exploratives Prototyping', 'Entwürfe schrittweise überprüfen und verbessern · auch M2, M5'],
  ['Gestalterische Referenzanalyse', 'D', 'M2', 'Gestalterische Recherche', 'Bestehende Gestaltungslösungen untersuchen · auch M1'],
  ['Visuelle Stilexploration', 'D', 'M2', 'Gestalterische Recherche', 'Unterschiedliche visuelle Richtungen erproben'],
  ['Paper Sketching', 'D', 'M5', 'Systematische Interface-Gestaltung', 'Screens, Layouts und benötigte Elemente schnell vorplanen'],
  ['Wireframing', 'D', 'M5', 'Systematische Interface-Gestaltung', 'Strukturellen Aufbau der Benutzeroberfläche entwickeln'],
  ['Low-Fidelity-Prototyping', 'D', 'M5', 'Systematische Interface-Gestaltung', 'Frühe Interface-Entwürfe mit geringem Detailgrad'],
  ['High-Fidelity-Prototyping', 'D', 'M5', 'Systematische Interface-Gestaltung', 'Visuell und funktional detaillierte Entwürfe'],
  ['Komponentenbasierte Gestaltung', 'D', 'M5', 'Systematische Interface-Gestaltung', 'Wiederverwendbare UI-Elemente systematisch entwickeln', 'Frost (2016)'],
  // H
  ['Forschungsorientiertes Prototyping', 'H', 'M1', 'Exploratives Prototyping', 'Offene Forschungsfragen durch Prototypen untersuchen · auch M2'],
  ['Forschungsorientierte Variantenentwicklung', 'H', 'M2', 'Interaktionsgestaltung', 'Zwei Interface-Varianten für einen kontrollierten Vergleich'],
  ['Research through Design', 'H', 'M2', 'Interaktionsgestaltung', 'Erkenntnisgewinn durch den Gestaltungsprozess · M2–M5, nur wenn nachweisbar'],
  // A
  ['Themenfindung', 'A', 'M1', 'Konzeptfindung und -selektion', 'Mögliche Forschungsschwerpunkte identifizieren'],
  ['Konzeptselektion', 'A', 'M1', 'Konzeptfindung und -selektion', 'Geeignetes Spielkonzept auswählen'],
  ['Anforderungsdefinition', 'A', 'M1', 'Konzeptfindung und -selektion', 'Projekt- und Gestaltungsanforderungen festlegen · auch M2, M5'],
  ['Technische Implementierung', 'A', 'M2', 'Umsetzung', 'Spielmechaniken programmieren'],
  ['Asset-Erstellung', 'A', 'M2', 'Umsetzung', 'Visuelle Spielinhalte erstellen'],
  ['Teilnehmerkategorisierung', 'A', 'M3', 'Testvorbereitung', 'Testpersonen nach relevanten Merkmalen gruppieren'],
  ['Datenbereinigung', 'A', 'M4', 'Datenaufbereitung', 'Fehlerhafte oder unvollständige Daten überprüfen'],
  ['Visuelle Systematisierung', 'A', 'M5', 'Systematische Interface-Gestaltung', 'Farben, Typografie und Abstände vereinheitlichen'],
  ['Komponentenentwicklung', 'A', 'M5', 'Systematische Interface-Gestaltung', 'Einzelne UI-Komponenten erstellen'],
  ['Styleguide-Erstellung', 'A', 'M5', 'Systematische Interface-Gestaltung', 'Gestaltungsrichtlinien dokumentieren'],
  ['Kompetenzerwerb in Figma', 'A', 'M5', 'Systematische Interface-Gestaltung', 'Auto Layout, Variables und Komponenten erlernen'],
  ['Projektplanung', 'A', ALONGSIDE, '', 'Aufgaben, Zeit und Ressourcen organisieren'],
  // I: instruments, techniques and tools (the list's "Typ" as the description)
  ['Within-Subject-Design', 'I', 'M2', 'Nutzertestkonzeption', 'Forschungsdesign'],
  ['AB-/BA-Counterbalancing', 'I', 'M2', 'Nutzertestkonzeption', 'Kontrolle von Reihenfolgeeffekten'],
  ['React', 'I', 'M2', 'Umsetzung', 'Entwicklungswerkzeug'],
  ['UEQ-S', 'I', 'M3', 'Datenerhebung', 'Standardisiertes Erhebungsinstrument'],
  ['Likert-Skalen', 'I', 'M3', 'Datenerhebung', 'Erhebungsinstrument / numerische Bewertungsskalen'],
  ['Tally', 'I', 'M3', 'Datenerhebung', 'Erhebungswerkzeug'],
  ['Visual Information-Seeking Mantra', 'I', 'M4', 'Ergebnisinterpretation', 'Analyse- und Visualisierungsprinzip', 'Shneiderman (1996)'],
  ['Auswertungsdashboard', 'I', 'M4', 'Datenvisualisierung', 'Analysewerkzeug und Artefakt'],
  ['Atomic Design', 'I', 'M5', 'Systematische Interface-Gestaltung', 'Gestaltungsmethodik / konzeptioneller Rahmen', 'Frost (2016)'],
  ['Auto Layout', 'I', 'M5', 'Systematische Interface-Gestaltung', 'Gestaltungstechnik'],
  ['Variables / Design Tokens', 'I', 'M5', 'Systematische Interface-Gestaltung', 'Technik zur visuellen Systematisierung'],
  ['Component Variants', 'I', 'M5', 'Systematische Interface-Gestaltung', 'Gestaltungstechnik'],
  ['Figma', 'I', 'M5', 'Systematische Interface-Gestaltung', 'Gestaltungswerkzeug'],
  ['Zotero', 'I', ALONGSIDE, '', 'Quellenverwaltungswerkzeug'],
];

const norm = (s: string) => slug(s).replace(/-/g, '');
export function addMethods(d: JournalDocs): Put[] {
  const phases = Object.values(d.phases ?? {});
  const methods = Object.values(d.methods ?? {});
  const have = new Set(methods.map((m) => norm(m.name)));
  const now = Date.now();
  const put: Put[] = [];
  const changed = new Map<string, MethodPhase>();
  for (const [name, type, code, area, desc, source] of ADDITIONS) {
    if (have.has(norm(name))) continue;
    const ph = code === ALONGSIDE ? phases.find((p) => p.id === ALONGSIDE) : phases.find((p) => p.code.trim().toUpperCase() === code);
    if (!ph) continue;
    const cur = changed.get(ph.id) ?? ph;
    // an area the phase does not have yet (M2 › Umsetzung) is added at its end
    if (!cur.areas.includes(area)) changed.set(ph.id, { ...cur, areas: [...cur.areas, area] });
    const order = methods.filter((m) => m.phase === ph.id && m.area === area).length + put.filter((p) => p.coll === 'methods' && (p.data as Method).phase === ph.id && (p.data as Method).area === area).length;
    const m: Method = { id: `mt-${ph.id}-${slug(area)}-${slug(name)}`.slice(0, 120), name, desc, type, phase: ph.id, area, order, created: now, ...(source ? { source } : {}) };
    put.push({ coll: 'methods', id: m.id, data: m });
    have.add(norm(name));
  }
  for (const p of changed.values()) put.push({ coll: 'phases', id: p.id, data: p });
  return put;
}
