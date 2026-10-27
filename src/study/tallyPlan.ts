// A new Tally export against the stored one, as changes to check
// (changes.ts): the file itself, then per participant what their answers
// would become. Rows are recognised by their submission (Tally's submission
// id, else submit time and test id), so manual pairings follow them into the
// new file. Keeping the current answers puts the old row into the new file.
import { buildModel, type Model } from './model';
import { fmtBerlin, timeOf } from './match';
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

function submitted(t: TallyDoc, row: number | null | undefined): string {
  const time = t.mapping.findIndex((m) => m.role === 'time');
  const v = row != null && time >= 0 ? timeOf(t.rows[row]?.[time] ?? '') : null;
  return v ? fmtBerlin(v) : '–';
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
      w.tally.main = { ...next, rows: next.rows.map((r) => [...r]) };
      for (const [id, p] of Object.entries(people)) w.people[id] = p;
    },
  });

  for (const p of mNew.included) {
    const nRow = p.tallyRow;
    const oRow = mOld?.persons.find((x) => x.id === p.id)?.tallyRow ?? null;
    const a = old ? answers(old, oRow) : [];
    const b = answers(next, nRow);
    const head = (t: TallyDoc | undefined, row: number | null, via: string | null | undefined): [string, string][] => (t && row != null ? [['Abgegeben', submitted(t, row)], ['Zuordnung', VIA[via ?? ''] ?? '–']] : []);
    const curFields = [...head(old, oRow, mOld?.persons.find((x) => x.id === p.id)?.tallyVia), ...a];
    const newFields = [...head(next, nRow, p.tallyVia), ...b];
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
        current: { fields: [['Abgegeben', submitted(old, i)], ...answers(old, i)] },
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
      out.push({ id: `tally-free:${row}`, kind: 'neu', group: 'Umfrage', label: 'Antwort ohne Zuordnung (unter „Daten & Validierung“ zuordnen)', incoming: { fields: [['Abgegeben', submitted(next, row)], ...answers(next, row)] }, choice: 'neu', apply: () => undefined });
  return out;
}
