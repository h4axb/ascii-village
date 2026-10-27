// A new Tally export against the stored one, as changes to check
// (changes.ts): the file itself, then per participant what their answers
// would become. Rows are recognised by their submission (Tally's submission
// id, else submit time and test id), so manual pairings follow them into the
// new file. Keeping the current answers puts the old row into the new file.
import { buildModel, type Model } from './model';
import { fmtBerlin, ZONE_LABEL, type TallyZone } from './match';
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
    if (same) continue;
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
  return out;
}

// "Neu zuordnen": every participant's survey row as the rules alone give it
// (times read in the file's zone and compared in UTC; rows without a test id
// by German submit time, the earliest to P001), against the current one.
// Taking the new one clears a manual pairing; keeping pins the current row.
export function planRematch(docs: StudyDocs, game: GameData, zone: TallyZone): Change[] {
  return planPairing(docs, game, {
    label: 'Zuordnungsregel speichern',
    fields: [
      ['Zeitzone der Datei', ZONE_LABEL[zone]],
      ['Reihenfolge', 'P-ID; Antworten ohne Test-ID nach Abgabezeit (deutsche Zeit), früheste zuerst'],
    ],
    patch: (w) => {
      w.settings.matchOrder = { by: 'pid' };
      w.settings.tallyZone = { zone };
    },
    rematch: true,
  });
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
  return out;
}
