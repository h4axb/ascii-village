// Daten & Validierung: the imports, the data sources, the checks (missing
// values, conflicts, open work), the matching rules, and the change log.
import type { ColumnRole } from '../types';
import { personIdOf } from '../model';
import { download } from '../charts';
import { csv, logChange, Section, useCtx, type LogEntry } from '../ui';
import Import from './Import';
import { VIA } from './People';

interface Check {
  area: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function useChecks(): Check[] {
  const { model, study } = useCtx();
  const tally = study.docs.tally.main;
  const out: Check[] = [];
  const add = (area: string, label: string, ok: boolean, detail = '') => out.push({ area, label, ok, detail });
  const inc = model.included;
  const idCol = model.mapping.findIndex((m) => m.role === 'id');
  const orderCol = model.mapping.findIndex((m) => m.role === 'order');

  // sample
  const ab = inc.filter((p) => p.group === 'AB').length;
  const ba = inc.filter((p) => p.group === 'BA').length;
  add('Stichprobe', 'Ausbalancierte Reihenfolge', Math.abs(ab - ba) <= 1, `AB ${ab}, BA ${ba}`);
  const noGroup = inc.filter((p) => !p.group);
  add('Stichprobe', 'Testgruppe bekannt', !noGroup.length, noGroup.map((p) => p.id).join(', '));
  const excluded = model.persons.filter((p) => p.excluded);
  add('Stichprobe', 'Ausschlüsse begründet', excluded.every((p) => p.doc.reason?.trim()), excluded.map((p) => `${p.id}${p.doc.reason ? `: ${p.doc.reason}` : ' (ohne Grund)'}`).join('; '));

  // sessions
  const multi = inc.filter((p) => p.links.length > 1);
  add('Sessions', 'Mehrere Links je Person', true, multi.map((p) => `${p.id}: ${p.links.length} Links, Dauer ${p.doc.runtime === 'main' ? 'Hauptlink' : 'Summe'}`).join('; ') || 'keine');
  const open = inc.flatMap((p) => p.links).filter((l) => l.endedBy === 'läuft' || l.endedBy === 'nicht geöffnet');
  add('Sessions', 'Alle Links beendet', !open.length, open.map((l) => `${l.label} (${l.endedBy})`).join(', '));
  const noTime = inc.filter((p) => p.minutes == null);
  add('Sessions', 'Dauer vorhanden', !noTime.length, noTime.map((p) => p.id).join(', '));

  // Tally
  add('Umfrage', 'Tally-Export importiert', !!tally, tally ? `${tally.rows.length} Antworten` : '');
  if (tally) {
    const withId = idCol >= 0 ? tally.rows.filter((r) => personIdOf(r[idCol] ?? '')).length : 0;
    add('Umfrage', 'Teilnehmer-ID in der Umfrage', true, withId ? `${withId} von ${tally.rows.length} Zeilen mit ID` : 'keine IDs – Zuordnung nach Zeit bzw. Reihenfolge der Notizen');
    const ids = idCol >= 0 ? tally.rows.map((r) => personIdOf(r[idCol] ?? '')) : [];
    const dup = [...new Set(ids.filter((x, i) => x && ids.indexOf(x) !== i))];
    add('Umfrage', 'Keine doppelten IDs', !dup.length, dup.length ? `${dup.join(', ')} (Zeile auf „Teilnehmende & Sessions“ wählen)` : '');
    add('Umfrage', 'Alle Antworten zugeordnet', !model.unmatchedRows.length, model.unmatchedRows.map((r) => `Zeile ${r + 1}${idCol >= 0 && tally.rows[r]?.[idCol] ? ` (${tally.rows[r][idCol]})` : ''}`).join(', '));
    const noRow = inc.filter((p) => p.tallyRow == null);
    add('Umfrage', 'Alle Teilnehmenden mit Antworten', !noRow.length, noRow.map((p) => p.id).join(', '));
    const byOrder = model.persons.filter((p) => p.tallyVia === 'reihenfolge');
    if (byOrder.length)
      add(
        'Umfrage',
        'Zuordnung nach Reihenfolge: Anzahl Zeilen = Teilnehmende',
        tally.rows.length - model.ignoredRows.size === model.persons.length,
        `${tally.rows.length - model.ignoredRows.size} Zeilen${model.ignoredRows.size ? ` (${model.ignoredRows.size} ignoriert)` : ''}, ${model.persons.length} Teilnehmende; ${byOrder.length} nach Reihenfolge zugeordnet${tally.rows.length - model.ignoredRows.size !== model.persons.length ? ' – Verschiebung möglich, Zuordnung prüfen' : ''}`,
      );
    if (orderCol >= 0) {
      const conflict = model.persons.filter((p) => p.tallyConflict);
      add('Umfrage', 'Reihenfolge in der Umfrage = Testgruppe', !conflict.length, conflict.map((p) => `${p.id}: Umfrage ${tally.rows[p.tallyRow!][orderCol]}, Gruppe ${p.doc.group ?? p.trackedGroup ?? p.notesGroup}`).join('; '));
    }
    const swapped = inc.filter((p) => p.doc.swapP1);
    add('Umfrage', 'Korrekturen Teil 1', true, swapped.length ? `A/B vertauscht: ${swapped.map((p) => p.id).join(', ')}` : 'keine');
    // missing values among the matched rows
    const rows = model.survey.filter((r) => r.person);
    const missing = model.mapping
      .map((m, j) => ({ m, j, n: ['p1', 'likert', 'ueqs', 'info'].includes(m.role) ? rows.filter((r) => !(tally.rows[r.row]?.[j] ?? '').trim()).length : 0 }))
      .filter((x) => x.n);
    add('Umfrage', 'Keine fehlenden Werte', !missing.length, missing.map((x) => `${tally.headers[x.j]}: ${x.n}`).join('; '));
    // Teil 2 pairs and Teil 3 completeness
    const likert = model.mapping.filter((m): m is Extract<ColumnRole, { role: 'likert' }> => m.role === 'likert');
    const unpaired = [...new Set(likert.map((m) => m.item))].filter((it) => !(likert.some((m) => m.item === it && m.design === 'A') && likert.some((m) => m.item === it && m.design === 'B')));
    add('Umfrage', 'Teil 2: Items paarweise (A und B)', !unpaired.length, unpaired.join(', '));
    const ueq = model.mapping.filter((m): m is Extract<ColumnRole, { role: 'ueqs' }> => m.role === 'ueqs');
    if (ueq.length) {
      const per = (d: 'A' | 'B') => new Set(ueq.filter((m) => m.design === d).map((m) => m.item)).size;
      add('Umfrage', 'Teil 3: 8 UEQ-S-Items je Variante', per('A') === 8 && per('B') === 8, `A ${per('A')}, B ${per('B')}; gedreht: ${ueq.filter((m) => m.reversed).length}`);
    }
    const p1Invalid = model.mapping
      .map((m, j) => (m.role === 'p1' ? rows.filter((r) => (tally.rows[r.row]?.[j] ?? '').trim() && m.values[(tally.rows[r.row][j] ?? '').trim()] == null).length : 0))
      .reduce((a, b) => a + b, 0);
    add('Umfrage', 'Teil 1: alle Antworten lesbar', !p1Invalid, p1Invalid ? `${p1Invalid} Antworten ohne Zuordnung (Import)` : '');
  }

  // notes
  const notesMeta = (study.docs.settings.notesMeta ?? {}) as Record<string, unknown>;
  const noNotes = inc.filter((p) => !notesMeta[p.id]);
  add('Notizen', 'Notizen für alle Teilnehmenden', !noNotes.length, noNotes.map((p) => p.id).join(', '));
  const mismatch = model.persons.filter((p) => p.groupMismatch);
  add('Notizen', 'Testgruppe Notizen = Tracking', !mismatch.length, mismatch.map((p) => `${p.id}: Notizen ${p.notesGroup}, Tracking ${p.trackedGroup}`).join('; '));
  const live = model.allItems.filter((i) => i.status !== 'removed');
  const unchecked = live.filter((i) => !i.confirmed);
  add('Notizen', 'Alle Aussagen geprüft', !unchecked.length, unchecked.length ? `${unchecked.length} von ${live.length} offen` : `${live.length} geprüft`);
  const changed = live.filter((i) => i.status === 'changed');
  add('Notizen', 'Geänderte Aussagen geprüft', !changed.length, changed.length ? `${changed.length}` : '');
  const removed = model.allItems.filter((i) => i.status === 'removed');
  add('Notizen', 'Entfernte Aussagen bereinigt', !removed.length, removed.length ? `${removed.length}` : '');
  const noKind = live.filter((i) => i.confirmed && !i.chips.some((c) => ['problem', 'positive', 'surprise', 'remark'].includes(model.chipRole.get(c) ?? '')));
  add('Notizen', 'Geprüfte Aussagen mit „Art“', !noKind.length, noKind.length ? `${noKind.length} ohne Art` : '');
  const problemsNoPrio = live.filter((i) => i.chips.some((c) => model.chipRole.get(c) === 'problem') && !i.chips.some((c) => ['essential', 'tbd', 'nice'].includes(model.chipRole.get(c) ?? '')));
  add('Notizen', 'Probleme mit Priorität', !problemsNoPrio.length, problemsNoPrio.length ? `${problemsNoPrio.length} ohne Priorität` : '');
  return out;
}

export default function Data() {
  const { model, study } = useCtx();
  const checks = useChecks();
  const tally = study.docs.tally.main;
  const notes = study.docs.notes.main;
  const log = ((study.docs.settings.log as { entries?: LogEntry[] } | undefined)?.entries ?? []) as LogEntry[];
  const failed = checks.filter((c) => !c.ok).length;
  return (
    <>
      <Section title="Datenquellen">
        <table className="st-table">
          <thead>
            <tr>
              <th>Quelle</th>
              <th>Umfang</th>
              <th>Stand</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Spiel-Tracking (Links, Ereignisse, Bewertungen)</td>
              <td>
                {study.game.invites.filter((i) => i.participant_id).length} Links, {study.game.events.length} Ereignisse, {study.game.feedback.length} Bewertungen
              </td>
              <td>live</td>
            </tr>
            <tr>
              <td>Tally-Umfrage</td>
              <td>{tally ? `${tally.rows.length} Antworten, ${tally.headers.length} Spalten (${tally.mapping.filter((m) => m.role !== 'ignore').length} zugeordnet)` : '–'}</td>
              <td>{tally ? `${tally.file}, ${new Date(tally.importedAt).toLocaleString('de-DE')}` : 'nicht importiert'}</td>
            </tr>
            <tr>
              <td>Testnotizen</td>
              <td>
                {Object.keys(study.docs.settings.notesMeta ?? {}).length} Teilnehmende, {model.allItems.length} Aussagen
              </td>
              <td>{notes ? `${notes.file ?? 'eingefügt'}, ${new Date(notes.importedAt).toLocaleString('de-DE')}` : 'nicht importiert'}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title={`Prüfergebnisse (${failed ? `${failed} offen` : 'alle erfüllt'})`}>
        <table className="st-table st-checks">
          <thead>
            <tr>
              <th>Bereich</th>
              <th>Prüfung</th>
              <th>Ergebnis</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => (
              <tr key={i} className={c.ok ? '' : 'is-open'}>
                <td>{c.area}</td>
                <td>{c.label}</td>
                <td>{c.ok ? '✓ erfüllt' : '! offen'}</td>
                <td>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="st-toolbar">
          <button type="button" onClick={() => download(new Blob(['\uFEFF' + csv([['Bereich', 'Prüfung', 'Ergebnis', 'Details'], ...checks.map((c) => [c.area, c.label, c.ok ? 'erfüllt' : 'offen', c.detail])])], { type: 'text/csv;charset=utf-8' }), 'Validierungsbericht.csv')}>
            Validierungsbericht (CSV)
          </button>
        </div>
      </Section>

      {tally && <MatchTable />}

      <Section title="Zuordnungsregeln">
        <ul className="st-rules">
          <li>Teilnehmende: P-ID aus dem persönlichen Link bzw. den Notizen.</li>
          <li>Umfrage-Zeilen ↔ Teilnehmende, in dieser Reihenfolge: 1. manuell gewählt; 2. Teilnehmer-ID (tallyid); 3. Zeit: Abgabe 10 min vor bis 120 min nach dem Öffnen der Umfrage im Spiel, nächste zuerst; 4. Reihenfolge: übrige Teilnehmende in der Reihenfolge der Notizen, übrige Zeilen nach Abgabezeit. Abweichende AB/BA-Angaben werden markiert.</li>
          <li>Mehrere Links einer Person: P009.1, P009.2 … in der Reihenfolge des Starts; Dauer als Summe oder nur Hauptlink.</li>
          <li>Ende einer Sitzung: Abschluss der Umfrage; sonst letzter Kontakt des Spiels vor Ablauf des Links.</li>
          <li>Testgruppe: aus dem Link (AB/BA); eine Korrektur überschreibt sie; Abweichungen zu den Notizen werden markiert.</li>
          <li>Teil 1: „vertauscht“ kehrt A und B der betreffenden Person um; „keine Präferenz“ zählt nicht im Vorzeichentest.</li>
          <li>Teil 3: Antworten 1–7, gedrehte Items umgepolt, Werte −3 bis +3; nur vollständige Skalen.</li>
          <li>Rückmeldungen: nur bestätigte Tags zählen; Vorschläge der KI bleiben bis zur Bestätigung unberücksichtigt; „Verworfen“ schließt eine Aussage aus.</li>
          <li>Ausgeschlossene Teilnehmende fehlen in allen Abbildungen, Tests und Listen.</li>
        </ul>
      </Section>

      <Import />

      <Section title="Änderungen">
        {log.length ? (
          <ol className="st-log">
            {log.slice(0, 100).map((e, i) => (
              <li key={i}>
                <span className="st-muted">{new Date(e.at).toLocaleString('de-DE')}</span> {e.what}
              </li>
            ))}
          </ol>
        ) : (
          <p className="st-empty">Noch keine Änderungen.</p>
        )}
      </Section>
    </>
  );
}

// every survey row and who it was matched to
function MatchTable() {
  const { model, study } = useCtx();
  const tally = study.docs.tally.main!;
  const timeCol = model.mapping.findIndex((m) => m.role === 'time');
  const orderCol = model.mapping.findIndex((m) => m.role === 'order');
  const owner = new Map(model.persons.filter((p) => p.tallyRow != null).map((p) => [p.tallyRow!, p]));
  const meta = (study.docs.settings.notesMeta ?? {}) as Record<string, { slot?: string; group?: string }>;
  return (
    <Section title="Zuordnung Umfrage ↔ Teilnehmende">
      <table className="st-table">
        <thead>
          <tr>
            <th>Zeile</th>
            <th>Abgabe</th>
            <th>AB/BA</th>
            <th>Teilnehmende</th>
            <th>Termin (Notizen)</th>
            <th>Gruppe</th>
            <th>Zuordnung</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tally.rows.map((r, i) => {
            const p = owner.get(i);
            const ignored = model.ignoredRows.has(i);
            const toggle = () => {
              const rows = ignored ? [...model.ignoredRows].filter((x) => x !== i) : [...model.ignoredRows, i];
              study.commit([{ coll: 'settings', id: 'ignoredRows', data: { rows } }]);
              logChange(study, `Umfrage-Zeile ${i + 1} ${ignored ? 'wieder gewertet' : 'ignoriert'}`);
            };
            return (
              <tr key={i} className={ignored ? 'is-ignored' : !p || p.tallyConflict ? 'is-open' : ''}>
                <td className="num">{i + 1}</td>
                <td>{timeCol >= 0 ? r[timeCol] : '–'}</td>
                <td>{orderCol >= 0 ? r[orderCol] || '–' : '–'}</td>
                <td>{ignored ? <span className="st-muted">ignoriert</span> : p ? p.id : <span className="st-flag">keine</span>}</td>
                <td>{p ? (meta[p.id]?.slot ?? '–') : ''}</td>
                <td>
                  {p ? (p.doc.group ?? p.trackedGroup ?? p.notesGroup ?? '–') : ''}
                  {p?.tallyConflict && <span className="st-flag"> abweichend</span>}
                </td>
                <td>{p?.tallyVia ? VIA[p.tallyVia] : ''}</td>
                <td>
                  <button type="button" onClick={toggle} title={ignored ? 'Zeile wieder werten' : 'z. B. Testlauf oder doppelte Abgabe: nicht zuordnen und nicht auswerten'}>
                    {ignored ? 'Werten' : 'Ignorieren'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="st-note">Eine Zeile ignorieren (Testlauf, doppelte Abgabe) ordnet die übrigen neu zu. Einzelne Personen: auf „Teilnehmende &amp; Sessions“ die Tally-Zeile wählen.</p>
    </Section>
  );
}
