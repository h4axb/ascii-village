// A new Tally export against the stored one, as changes to check
// (changes.ts): the file itself, then per participant what their answers
// would become. Rows are recognised by their submission (Tally's submission
// id, else submit time and test id), so manual pairings follow them into the
// new file. Keeping the current answers puts the old row into the new file.
import { buildModel, type Model } from './model';
import { fmtBerlin } from './match';
import type { Change } from './changes';
import type { GameData, PersonDoc, StudyDocs, TallyDoc } from './types';

const VIA: Record<string, string> = { manuell: 'von Hand', id: 'Test-ID', zeit: 'Zeit', reihenfolge: 'Reihenfolge (früheste Abgabe zuerst)' };

// a row's identity across exports
function rowKeys(t: TallyDoc): string[] {
  const sub = t.headers.findIndex((h) => /submission\s*id|response\s*id|antwort-?id/i.test(h));
  const time = t.mapping.findIndex((m) => m.role === 'time');
  const id = t.mapping.findIndex((m) => m.role === 'id');
  return t.rows.map((r, i) => (sub >= 0 && r[sub] ? `s:${r[sub]}` : `t:${time >= 0 ? r[time] : i}|${id >= 0 ? r[id] : ''}`));
}

// the answers of one row, by question (the mapped columns only)
function answers(t: TallyDoc, row: number | null | undefined): [string, string][] {
  if (row == null || !t.rows[row]) return [];
  return t.headers.map((h, j) => [h, (t.rows[row][j] ?? '').trim()] as [string, string]).filter((_, j) => (t.mapping[j]?.role ?? 'ignore') !== 'ignore');
}

// a row's submit time in German time (read in the zone the model found for that file)
function submittedIn(m: Model | null, row: number | null | undefined): string {
  const v = m && row != null ? m.submitted[row] : null;
  return v != null ? fmtBerlin(v) : '–';
}

export function planTally(docs: StudyDocs, game: GameData, next: TallyDoc): Change[] {
  const old = docs.tally.main;
  const out: Change[] = [];
  // manual pairings, carried to the same submission in the new file
  const newKeys = rowKeys(next);
  const oldKeys = old ? rowKeys(old) : [];
  const people: Record<string, PersonDoc> = {};
  for (const [id, p] of Object.entries(docs.people))
    if (typeof p.tallyRow === 'number' && old) {
      const at = newKeys.indexOf(oldKeys[p.tallyRow]);
      people[id] = { ...p, tallyRow: at >= 0 ? at : undefined };
    }
  const after: StudyDocs = { ...docs, tally: { ...docs.tally, main: next }, people: { ...docs.people, ...people } };
  const mNew = buildModel(after, game);
  const mOld: Model | null = old ? buildModel(docs, game) : null;
  const isNew = (w: StudyDocs) => w.tally.main?.importedAt === next.importedAt;

  out.push({
    id: 'tally-file',
    kind: old ? 'konflikt' : 'neu',
    group: 'Datei',
    label: old ? 'Neue Umfragedatei (die Zuordnung der Spalten wird übernommen)' : `Umfrage importieren: ${next.rows.length} Antworten, ${next.headers.length} Spalten`,
    current: old ? { fields: [['Datei', old.file], ['Antworten', String(old.rows.length)], ['Spalten', String(old.headers.length)], ['Importiert', fmtBerlin(old.importedAt)]] } : undefined,
    incoming: { fields: [['Datei', next.file], ['Antworten', String(next.rows.length)], ['Spalten', String(next.headers.length)], ['Importiert', fmtBerlin(next.importedAt)]] },
    choice: 'neu',
    apply: (c, w) => {
      if (c !== 'neu') return;
      w.tally.main = { ...next, rows: next.rows.map((r) => [...r]), times: mNew.submitted, timeZone: mNew.tallyZone.zone };
      for (const [id, p] of Object.entries(people)) w.people[id] = p;
    },
  });

  for (const p of mNew.included) {
    const nRow = p.tallyRow;
    const oRow = mOld?.persons.find((x) => x.id === p.id)?.tallyRow ?? null;
    const a = old ? answers(old, oRow) : [];
    const b = answers(next, nRow);
    const head = (m: Model | null, row: number | null, via: string | null | undefined): [string, string][] => (m && row != null ? [['Abgegeben (dt. Zeit)', submittedIn(m, row)], ['Zuordnung', VIA[via ?? ''] ?? '–']] : []);
    const curFields = [...head(mOld, oRow, mOld?.persons.find((x) => x.id === p.id)?.tallyVia), ...a];
    const newFields = [...head(mNew, nRow, p.tallyVia), ...b];
    const same = a.length === b.length && a.every(([h, v], k) => b[k]?.[0] === h && b[k]?.[1] === v);
    if (!old || oRow == null) {
      if (nRow != null) out.push({ id: `tally:${p.id}`, kind: 'neu', group: p.id, label: `Umfrage-Antworten zugeordnet (${VIA[p.tallyVia ?? ''] ?? ''})`, incoming: { fields: newFields }, choice: 'neu', apply: () => undefined });
      continue;
    }
    if (same) {
      out.push({ id: `tally-same:${p.id}`, kind: 'gleich', group: p.id, label: 'Antworten unverändert', current: { fields: curFields.slice(0, 2) }, choice: 'alt', apply: () => undefined });
      continue;
    }
    const oldRow = old.rows[oRow];
    out.push({
      id: `tally:${p.id}`,
      kind: 'konflikt',
      group: p.id,
      label: nRow == null ? 'In der neuen Datei keine Antworten zugeordnet' : 'Andere Umfrage-Antworten als bisher',
      current: { fields: curFields },
      incoming: nRow == null ? undefined : { fields: newFields },
      choice: 'alt',
      // keep: the old answers (mapped by column name) take this person's row in the new file
      apply: (c, w) => {
        if (c !== 'alt' || !isNew(w)) return;
        const t = w.tally.main!;
        const row = t.headers.map((h) => {
          const j = old.headers.indexOf(h);
          return j >= 0 ? (oldRow[j] ?? '') : '';
        });
        if (nRow != null) t.rows[nRow] = row;
        else {
          t.rows.push(row);
          w.people[p.id] = { ...(w.people[p.id] ?? { id: p.id }), tallyRow: t.rows.length - 1 };
        }
      },
    });
  }
  // rows held by hand (also by an earlier "Aktuell behalten") that the rules
  // would give someone else: asked, or a re-upload could never correct them
  const rules = buildModel(after, game, { ignoreManual: true });
  const idCol = next.mapping.findIndex((m) => m.role === 'id');
  const rowSide = (row: number | null): [string, string][] =>
    row == null ? [['Zeile', 'keine Antworten']] : [['Zeile', String(row + 1)], ['Test-ID in der Zeile', idCol >= 0 ? next.rows[row]?.[idCol] || '–' : '–'], ['Abgegeben (dt. Zeit)', submittedIn(mNew, row)], ...answers(next, row).filter(([h]) => next.headers.indexOf(h) !== idCol).slice(0, 3)];
  for (const p of mNew.included) {
    if (p.tallyVia !== 'manuell') continue;
    const r = rules.persons.find((x) => x.id === p.id);
    const ruleRow = r?.tallyRow ?? null;
    if (ruleRow === p.tallyRow) continue;
    out.push({
      id: `pin:${p.id}`,
      kind: 'konflikt',
      group: p.id,
      label: `Von Hand festgehalten (Zeile ${p.tallyRow! + 1}) – nach den Regeln wäre es ${ruleRow == null ? 'keine Zeile' : `Zeile ${ruleRow + 1} (${VIA[r?.tallyVia ?? ''] ?? ''})`}`,
      current: { fields: rowSide(p.tallyRow) },
      incoming: { fields: rowSide(ruleRow) },
      choice: 'alt',
      // take the rules: the hand pairing goes (the rules decide from now on)
      apply: (c, w) => {
        if (c !== 'neu') return;
        const doc = { ...(w.people[p.id] ?? { id: p.id }) };
        delete doc.tallyRow;
        w.people[p.id] = doc;
      },
    });
  }
  // rows of the old file that the new one no longer has
  if (old)
    old.rows.forEach((r, i) => {
      if (newKeys.includes(oldKeys[i])) return;
      const owner = mOld?.persons.find((x) => x.tallyRow === i);
      if (owner && out.some((c) => c.id === `tally:${owner.id}`)) return; // (already asked for that person)
      out.push({
        id: `tally-gone:${i}`,
        kind: 'konflikt',
        group: owner?.id ?? 'Umfrage',
        label: 'Antwort fehlt in der neuen Datei',
        current: { fields: [['Abgegeben (dt. Zeit)', submittedIn(mOld, i)], ...answers(old, i)] },
        choice: 'alt',
        apply: (c, w) => {
          if (c !== 'alt' || !isNew(w)) return;
          const t = w.tally.main!;
          t.rows.push(t.headers.map((h) => {
            const j = old.headers.indexOf(h);
            return j >= 0 ? (r[j] ?? '') : '';
          }));
        },
      });
    });
  // answers nobody is paired with
  for (const row of mNew.unmatchedRows)
    if (!old || !oldKeys.includes(newKeys[row]))
      out.push({ id: `tally-free:${row}`, kind: 'neu', group: 'Umfrage', label: 'Antwort ohne Zuordnung (unter „Daten & Validierung“ zuordnen)', incoming: { fields: [['Abgegeben (dt. Zeit)', submittedIn(mNew, row)], ...answers(next, row)] }, choice: 'neu', apply: () => undefined });
  // the survey statements under Qualitatives Feedback, as the answers will be after this file
  return [...out, ...planFreeText(docs, mNew)];
}

// "Neu zuordnen": every participant's survey row as the rules alone give it
// (times read in the file's zone and compared in UTC; rows without a test id
// by German submit time, the earliest to P001), against the current one.
// Taking the new one clears a manual pairing; keeping pins the current row.
export function planRematch(docs: StudyDocs, game: GameData, rules: [string, string][]): Change[] {
  // (the rules as set under Daten & Validierung → Einstellungen; pairings by hand are left out)
  return planPairing(docs, game, { label: 'Neu zuordnen nach den eingestellten Regeln', fields: rules, patch: () => undefined, rematch: true });
}

// any change that moves survey answers between participants (a rule, the time
// zone, a row ignored, a row chosen by hand): the change itself, and for each
// participant whose answers would change a conflict to decide; keeping pins
// their current row. (rematch: manual pairings are left out of the new
// pairing, and taking it clears them.)
export function planPairing(
  docs: StudyDocs,
  game: GameData,
  o: { label: string; fields: [string, string][]; patch: (w: StudyDocs) => void; rematch?: boolean; skip?: string[] },
): Change[] {
  const t = docs.tally.main;
  const w0: StudyDocs = { ...docs, settings: { ...docs.settings }, people: { ...docs.people } };
  o.patch(w0);
  const cur = buildModel(docs, game);
  const next = buildModel(w0, game, { ignoreManual: o.rematch });
  const freeText = planFreeText(docs, next);
  const timeCol = t ? t.mapping.findIndex((m) => m.role === 'time') : -1;
  const side = (m: Model, row: number | null, via: string | null | undefined): [string, string][] => {
    if (row == null || !t) return [['Zeile', 'keine Antworten zugeordnet']];
    const at = m.submitted[row];
    const sample = answers(t, row)
      .filter(([h]) => t.headers.indexOf(h) !== timeCol)
      .slice(0, 3);
    return [['Zeile', String(row + 1)], ['Abgabe (dt. Zeit)', at != null ? fmtBerlin(at) : '–'], ['In der Datei', timeCol >= 0 ? (t.rows[row]?.[timeCol] ?? '') : '–'], ['Zuordnung', VIA[via ?? ''] ?? '–'], ...sample];
  };
  const out: Change[] = [
    {
      id: 'pairing-rule',
      kind: 'neu',
      group: 'Änderung',
      label: o.label,
      incoming: { fields: o.fields },
      choice: 'neu',
      apply: (c, w) => {
        if (c === 'neu') o.patch(w);
      },
    },
  ];
  for (const p of next.included) {
    if (o.skip?.includes(p.id)) continue;
    const before = cur.persons.find((x) => x.id === p.id);
    const oRow = before?.tallyRow ?? null;
    const nRow = p.tallyRow;
    if (oRow === nRow) continue;
    out.push({
      id: `pairing:${p.id}`,
      kind: 'konflikt',
      group: p.id,
      label: nRow == null ? 'Danach keine Antworten mehr zugeordnet' : oRow == null ? 'Bekommt Antworten zugeordnet' : `Andere Antworten: Zeile ${oRow + 1} → ${nRow + 1}`,
      current: { fields: side(cur, oRow, before?.tallyVia) },
      incoming: { fields: side(next, nRow, p.tallyVia) },
      choice: 'neu',
      apply: (c, w) => {
        const doc = { ...(w.people[p.id] ?? { id: p.id }) };
        if (c === 'neu') {
          if (!o.rematch) return;
          delete doc.tallyRow;
        } else doc.tallyRow = oRow; // (kept: pinned, so the change leaves it)
        w.people[p.id] = doc;
      },
    });
  }
  return [...out, ...freeText];
}

// give a participant a survey row by hand; a row another participant has is
// swapped: they get this participant's row (or none). Every other participant
// whose answers would move is asked as usual.
export function planAssign(docs: StudyDocs, game: GameData, pid: string, row: number | null | undefined): Change[] {
  const m = buildModel(docs, game);
  const mine = m.persons.find((p) => p.id === pid)?.tallyRow ?? null;
  const other = row != null ? m.persons.find((p) => p.id !== pid && p.tallyRow === row) : undefined;
  const name = (r: number | null | undefined) => (r === undefined ? 'automatisch' : r === null ? 'keine' : `Zeile ${r + 1}`);
  const fields: [string, string][] = [[pid, `${name(mine)} → ${name(row)}`]];
  if (other) fields.push([other.id, `${name(row)} → ${name(mine)}`]);
  return planPairing(docs, game, {
    label: other ? `${pid} ↔ ${other.id}: Umfrage-Antworten tauschen` : `${pid}: Tally-Zeile ${name(row)}`,
    fields,
    patch: (w) => {
      w.people[pid] = { ...(w.people[pid] ?? { id: pid }), id: pid, tallyRow: row };
      if (other) w.people[other.id] = { ...(w.people[other.id] ?? { id: other.id }), id: other.id, tallyRow: mine };
    },
    skip: other ? [pid, other.id] : [pid],
  });
}

// the survey's free-text answers as statements (Qualitatives Feedback, section
// "Umfrage", id s-<P-ID>-<column>), against the answers each participant has
// in this model: a statement from an earlier pairing that no longer matches
// is a conflict (taking it keeps tags and edits), a missing one is new, one
// whose participant has no answer any more is asked to keep or remove
export function planFreeText(docs: StudyDocs, m: Model): Change[] {
  const cols = m.mapping.map((c, j) => (c.role === 'text' ? { j, label: c.label } : null)).filter((x): x is { j: number; label: string } => !!x);
  if (!cols.length) return [];
  const out: Change[] = [];
  const answerOf = new Map(m.survey.filter((r) => r.person).map((r) => [r.person!, r]));
  for (const p of m.included)
    for (const c of cols) {
      const id = `s-${p.id}-${c.j}`;
      const old = docs.items[id];
      const text = answerOf.get(p.id)?.text[c.label];
      if (old && text && old.text === text) continue;
      if (!old && !text) continue;
      if (!old && text) {
        out.push({ id: `ft:${id}`, kind: 'neu', group: p.id, label: `Umfrage-Aussage „${c.label}“`, incoming: { text }, choice: 'neu', apply: (ch, w) => void (ch === 'neu' && (w.items[id] = { id, person: p.id, section: 'survey', question: c.label, text, order: 1000 + c.j, chips: [], suggested: [] })) });
        continue;
      }
      out.push({
        id: `ft:${id}`,
        kind: 'konflikt',
        group: p.id,
        label: text ? `Umfrage-Aussage „${c.label}“ passt nicht mehr zur Zuordnung` : `Umfrage-Aussage „${c.label}“: ${p.id} hat keine Antwort mehr`,
        current: { text: old!.text, note: old!.chips.length ? `${old!.chips.length} Tags` : undefined },
        incoming: text ? { text, note: 'Tags und Bearbeitungen bleiben; die deutsche Fassung wird zur Prüfung markiert' } : undefined,
        choice: 'alt',
        apply: (ch, w) => {
          if (ch !== 'neu') return;
          if (!text) delete w.items[id];
          else w.items[id] = { ...(w.items[id] ?? old!), text, original: text, status: 'changed', confirmed: false, deStale: !!old!.de };
        },
      });
    }
  return out;
}
