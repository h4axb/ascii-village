// The two exports for the thesis:
//   Rohdaten  – the originals, unchanged: the notes (names removed), every
//               statement as first written, the Tally export as imported,
//               the game's records per participant. No translations, codes
//               or interpretations.
//   Analyse   – the analysis layer: statements with German version,
//               interpretation, later addition, codes and findings, plus
//               each participant's quantitative values per design.
import { fmtBerlin } from './match';
import { studyFiles, zip } from '../feedback/studyExport';
import type { Model } from './model';
import { gameRatings, RATING_LABEL } from './model';
import { UEQS_SCALE_ITEMS, mean, type UeqScale } from './stats';
import type { ItemDoc, NotesMeta, StudyDocs, GameData } from './types';
import { csv } from './ui';
import { designOfItem } from './pages/Codes';

// lines of the notes that carry a participant's name
function withoutNames(text: string, metas: NotesMeta[]): string {
  const names = new Set(metas.map((m) => m.name.trim()).filter(Boolean));
  return text
    .split('\n')
    .map((l) => {
      const c = l.replace(/^\s*[-*•#]*\s*/, '').trim();
      if (/^name\s*[:=]/i.test(c) || names.has(c)) return l.replace(c, '[Name entfernt]');
      let out = l;
      for (const n of names) if (n.length > 2) out = out.split(n).join('[Name]');
      return out;
    })
    .join('\n');
}

// RFC 4180 (comma) for the Tally file, as it came
const csvComma = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');

export function rawExport(docs: StudyDocs, game: GameData): Blob {
  const metas = Object.values((docs.settings.notesMeta ?? {}) as Record<string, NotesMeta>);
  const items = Object.values(docs.items).sort((a, b) => a.person.localeCompare(b.person) || a.order - b.order);
  const meta = (id: string) => metas.find((m) => m.id === id);
  const files = [
    { name: 'LIESMICH.txt', text: 'Rohdaten der Nutzerstudie (unverändert, pseudonymisiert: Namen entfernt).\nnotizen-original.txt – die Testnotizen wie importiert\naussagen-original.csv – jede Aussage im ersten Wortlaut\numfrage-original.csv – der Tally-Export wie importiert\nspiel/ – das Spiel-Tracking je Teilnehmer\n' },
    ...(docs.notes.main ? [{ name: 'notizen-original.txt', text: withoutNames(docs.notes.main.text, metas) }] : []),
    {
      name: 'aussagen-original.csv',
      text:
        '﻿' +
        csv([
          ['Teilnehmende', 'Link', 'Zeitfenster', 'Gruppe (Notizen)', 'Abschnitt', 'Frage', 'Aussage (erster Wortlaut)', 'Aussage (aktuell)', 'nachträglich ergänzt'],
          ...items.map((i) => [i.person, i.link ?? '', meta(i.person)?.slot ?? '', meta(i.person)?.group ?? '', i.section, i.question ?? '', i.original ?? i.text, i.text, i.manual ? 'ja' : '']),
        ]),
    },
    ...(docs.tally.main ? [{ name: 'umfrage-original.csv', text: '﻿' + csvComma([docs.tally.main.headers, ...docs.tally.main.rows]) }] : []),
    ...studyFiles(game.events, game.feedback, game.invites).map((f) => ({ ...f, name: `spiel/${f.name}` })),
  ];
  return zip(files);
}

export function analysisExport(docs: StudyDocs, model: Model): Blob {
  const tags = model.tags;
  const chipsOf = (i: ItemDoc, groupId: string) =>
    i.chips
      .filter((c) => tags.find((g) => g.id === groupId)?.chips.some((x) => x.id === c))
      .map((c) => model.chipLabel.get(c))
      .join(', ');
  const items = model.allItems.filter((i) => i.status !== 'removed');
  const statements = csv([
    ['Teilnehmende', 'Link', 'Variante', 'Abschnitt', 'Frage', 'Original', 'Deutsch', 'Deutsch automatisch', 'Interpretation', 'Nachträgliche Ergänzung', 'Code', 'Bereich', 'Art', 'Priorität', 'Thema', 'Moderation', 'Befund', 'geprüft', 'ausgeschlossen'],
    ...items.map((i) => [
      i.person,
      i.link ?? '',
      designOfItem(i) ?? '',
      i.section,
      i.question ?? '',
      i.text,
      i.de ?? '',
      i.de && i.deAuto ? 'ja' : '',
      i.interpretation ?? '',
      i.addition ?? '',
      chipsOf(i, 'code'),
      chipsOf(i, 'bereich'),
      chipsOf(i, 'art'),
      chipsOf(i, 'prioritaet'),
      chipsOf(i, 'thema'),
      chipsOf(i, 'moderation'),
      i.finding ? (docs.findings[i.finding]?.name ?? '') : '',
      i.confirmed ? 'ja' : '',
      i.chips.some((c) => model.chipRole.get(c) === 'rejected') ? 'verworfen' : '',
    ]),
  ]);

  // per participant: every quantitative value, by design
  const rows = model.survey.filter((r) => r.person);
  const p1q = [...new Set(rows.flatMap((r) => Object.keys(r.p1)))];
  const lik = [...new Set(rows.flatMap((r) => Object.keys(r.likert)))];
  const lik1 = [...new Set(rows.flatMap((r) => Object.keys(r.likertSingle)))];
  const chq = [...new Set(rows.flatMap((r) => Object.keys(r.choice)))];
  const mq = model.optionQuestions.map((q) => q.question);
  const scales = Object.keys(UEQS_SCALE_ITEMS) as UeqScale[];
  const score = (vals: (number | null)[], idx: number[]) => {
    const v = idx.map((k) => vals[k]).filter((x): x is number => x != null);
    return v.length === idx.length ? mean(v.map((x) => x - 4)) : null;
  };
  const ratingQs = Object.keys(gameRatings(model.feedback));
  const ratingOf = (pid: string, q: string, d: 'A' | 'B') => {
    const xs = model.feedback.filter((r) => r.participant === pid && r.rating && typeof r.rating[q] === 'number' && (d === 'A' ? r.cond === 'pre' : r.cond === 'post')).map((r) => r.rating![q] as number);
    return xs.length ? mean(xs) : null;
  };
  const n2 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '' : String(Math.round(x * 100) / 100).replace('.', ','));
  const quant = csv([
    [
      'Teilnehmende',
      'Gruppe',
      'Aktive Spieldauer (min)',
      'Aktiv geschätzt',
      'Verstrichen (min)',
      'Unterbrechung (min)',
      'Versuche',
      'Neustarts',
      'Technische Unterbrechung',
      'Saubere Erstdurchlaufzeit (min)',
      'In sauberer Statistik',
      'Ausschlussgrund',
      'Quelle',
      'Genauigkeit',
      'Umfrage abgegeben (dt. Zeit)',
      'Umfrage abgegeben (UTC)',
      'Umfrage zugeordnet über',
      ...p1q.map((q) => `Teil 1: ${q}`),
      'Teil 1 von Hand',
      ...lik.flatMap((q) => [`Teil 2 A: ${q}`, `Teil 2 B: ${q}`]),
      ...lik1.map((q) => `Teil 2: ${q}`),
      ...chq.map((q) => `Auswahl: ${q}`),
      ...mq.map((q) => `Mehrfachauswahl: ${q}`),
      ...scales.flatMap((s) => [`UEQ-S A ${s}`, `UEQ-S B ${s}`, `UEQ-S gesamt ${s}`]),
      ...ratingQs.flatMap((q) => [`Spiel A ${RATING_LABEL[q] ?? q}`, `Spiel B ${RATING_LABEL[q] ?? q}`]),
    ],
    ...model.included.map((p) => {
      const r = rows.find((x) => x.person === p.id);
      return [
        p.id,
        p.group ?? '',
        n2(p.timing.active.value),
        p.timing.activeEstimated ? 'ja' : 'nein',
        n2(p.timing.elapsed.value),
        n2(p.timing.interruption.value),
        String(p.timing.attemptCount),
        String(p.timing.restartCount),
        p.timing.technical.value ? 'ja' : 'nein',
        n2(p.timing.clean.value),
        p.timing.eligible.value ? 'ja' : 'nein',
        p.timing.exclusionReason.value,
        p.timing.source.value,
        p.timing.precision.value,
        ...(() => {
          const t = r ? model.submitted[r.row] : null;
          return [t != null ? fmtBerlin(t, true) : '', t != null ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '', p.tallyVia ?? ''];
        })(),
        ...p1q.map((q) => (r?.p1[q] === 'neutral' ? 'keine Präferenz' : (r?.p1[q] ?? ''))),
        (r?.p1Manual ?? []).join('; '),
        ...lik.flatMap((q) => [n2(r?.likert[q]?.A), n2(r?.likert[q]?.B)]),
        ...lik1.map((q) => n2(r?.likertSingle[q])),
        ...chq.map((q) => r?.choice[q] ?? ''),
        ...mq.map((q) => (r?.multi[q] ?? []).join(', ')),
        ...scales.flatMap((s) => (r ? [n2(score(r.ueqs.A, UEQS_SCALE_ITEMS[s])), n2(score(r.ueqs.B, UEQS_SCALE_ITEMS[s])), n2(score(r.ueqs.O, UEQS_SCALE_ITEMS[s]))] : ['', '', ''])),
        ...ratingQs.flatMap((q) => [n2(ratingOf(p.id, q, 'A')), n2(ratingOf(p.id, q, 'B'))]),
      ];
    }),
  ]);
  return zip([
    { name: 'LIESMICH.txt', text: 'Analysedaten der Nutzerstudie.\naussagen-analyse.csv – Aussagen mit deutscher Fassung, Interpretation, Ergänzung, Codes, Befund\nteilnehmende-messwerte.csv – je Teilnehmer die quantitativen Werte je Variante (Teil 1–3, Bewertungen im Spiel) und die Zeiten (aktiv, verstrichen, sauber; leer = kein gültiger Wert)\nversuche.csv – je Versuch (Testlink) Start, Ende, aktive Minuten, Ausgang, Quelle, Genauigkeit\nNur bestätigte Tags; ausgeschlossene Teilnehmende sind in den Messwerten nicht enthalten.\n' },
    { name: 'aussagen-analyse.csv', text: '﻿' + statements },
    { name: 'teilnehmende-messwerte.csv', text: '﻿' + quant },
    // one row per attempt (a test link of a participant); raw times in UTC and German time
    {
      name: 'versuche.csv',
      text:
        '﻿' +
        csv([
          ['Teilnehmende', 'Versuch', 'Link', 'Link-Schlüssel', 'Start (UTC)', 'Ende (UTC)', 'Start (dt. Zeit)', 'Ende (dt. Zeit)', 'Aktiv (min)', 'Ausgang', 'Quelle', 'Genauigkeit', 'von Hand', 'Notiz', 'Link-Dauer (min, technisch)'],
          ...model.included.flatMap((p) =>
            p.timing.attempts.map((a) => [
              p.id,
              String(a.n.value),
              a.label,
              a.key,
              a.start.value ? new Date(a.start.value).toISOString() : '',
              a.end.value ? new Date(a.end.value).toISOString() : '',
              a.start.value ? fmtBerlin(a.start.value, true) : '',
              a.end.value ? fmtBerlin(a.end.value, true) : '',
              n2(a.active.value),
              a.outcome.value,
              a.source.value,
              a.precision.value,
              [a.start, a.end, a.active, a.outcome, a.source, a.precision].some((v) => v.manual) ? 'ja' : 'nein',
              a.note,
              n2(a.link.linkMinutes),
            ]),
          ),
        ]),
    },
  ]);
}
