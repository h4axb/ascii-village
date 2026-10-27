// Daten & Validierung: the imports, the data sources, the checks (missing
// values, conflicts, open work), the matching rules, and the change log.
import type { ColumnRole } from '../types';
import { GAP_MIN, MATCH_ORDER_LABEL, personIdOf, type MatchOrder } from '../model';
import { timeOf } from '../match';
import { download } from '../charts';
import { useEffect, useState } from 'react';
import type { Version } from '../store';
import { restoreChanges, type Change } from '../changes';
import { applyChanges, ChangeModal } from '../ChangeModal';
import { csv, DurationSelect, fmtMin, logChange, Section, useCtx, type LogEntry } from '../ui';
import Import from './Import';
import Translations from './Translations';
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
  // notes under a P-ID without a played test link: not counted, so they show here
  const known = new Set(model.persons.map((p) => p.id));
  const strayNotes = [...new Set(model.allItems.map((i) => i.person).filter((id) => !known.has(id)))];
  add('Stichprobe', 'Notizen nur zu gespielten Testlinks', !strayNotes.length, strayNotes.length ? `${strayNotes.join(', ')}: kein gespielter Testlink – nicht gezählt` : '');
  add('Stichprobe', 'Ausschlüsse begründet', excluded.every((p) => p.doc.reason?.trim()), excluded.map((p) => `${p.id}${p.doc.reason ? `: ${p.doc.reason}` : ' (ohne Grund)'}`).join('; '));

  // sessions
  const multi = inc.filter((p) => p.links.length > 1);
  add('Sessions', 'Mehrere Links je Person', true, multi.map((p) => `${p.id}: ${p.links.length} Links, Dauer ${p.doc.runtime === 'main' ? 'Hauptlink' : 'Summe'}`).join('; ') || 'keine');
  const open = inc.flatMap((p) => p.links).filter((l) => l.endedBy === 'läuft' || l.endedBy === 'nicht geöffnet');
  add('Sessions', 'Alle Links beendet', !open.length, open.map((l) => `${l.label} (${l.endedBy})`).join(', '));
  const noTime = inc.filter((p) => p.minutes == null);
  add('Sessions', 'Dauer vorhanden', !noTime.length, noTime.map((p) => p.id).join(', '));
  // the game's clock and the link's time far apart, or pauses: a duration worth a look
  const odd = inc.filter((p) => p.clockMinutes != null && p.linkMinutes != null && Math.abs(p.linkMinutes - p.clockMinutes) > 0.5 * p.clockMinutes);
  add('Sessions', 'Spiel-Uhr und Link-Dauer stimmig (Abweichung ≤ 50 %)', !odd.length, odd.map((p) => `${p.id}: Spiel-Uhr ${fmtMin(p.clockMinutes)}, Link ${fmtMin(p.linkMinutes)}`).join('; '));
  const paused = inc.filter((p) => p.gaps.count);
  add('Sessions', `Keine Unterbrechungen über ${GAP_MIN} min`, !paused.length, paused.map((p) => `${p.id}: ${p.gaps.count}× (${Math.round(p.gaps.minutes)} min)`).join('; '));

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
    const paired = likert.filter((m) => m.design != null);
    const unpaired = [...new Set(paired.map((m) => m.item))].filter((it) => new Set(paired.filter((m) => m.item === it).map((m) => (m.design === '1' || m.design === '2' ? `r${m.design}` : m.design))).size !== 2);
    const single = new Set(likert.filter((m) => m.design == null).map((m) => m.item)).size;
    add('Umfrage', 'Teil 2: Items paarweise (A und B)', !unpaired.length, `${new Set(paired.map((m) => m.item)).size - unpaired.length} Paare${single ? `, ${single} Aussagen zu beiden` : ''}${unpaired.length ? `; ohne Gegenstück: ${unpaired.join(', ')}` : ''}`);
    const ueq = model.mapping.filter((m): m is Extract<ColumnRole, { role: 'ueqs' }> => m.role === 'ueqs');
    if (ueq.length) {
      const per = (d: string | null) => new Set(ueq.filter((m) => (m.design ?? null) === d).map((m) => m.item)).size;
      const sets = ([['A', 'A'], ['B', 'B'], ['1', '1. Durchgang'], ['2', '2. Durchgang'], [null, 'gesamt']] as const).filter(([d]) => per(d));
      add('Umfrage', 'Teil 3: je 8 UEQ-S-Items', sets.every(([d]) => per(d) === 8), `${sets.map(([d, l]) => `${l} ${per(d)}`).join(', ')}; gedreht: ${ueq.filter((m) => m.reversed).length}`);
    }
    const byRun = model.mapping.some((m) => (m.role === 'likert' || m.role === 'ueqs') && (m.design === '1' || m.design === '2'));
    if (byRun) {
      const noGroup = rows.filter((r) => !r.group);
      add('Umfrage', '1./2. Durchgang auflösbar (Testgruppe bekannt)', !noGroup.length, noGroup.map((r) => r.person ?? `Zeile ${r.row + 1}`).join(', '));
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
              <td>{tally ? `${tally.file}, ${new Date(tally.importedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}` : 'nicht importiert'}</td>
            </tr>
            <tr>
              <td>Testnotizen</td>
              <td>
                {Object.keys(study.docs.settings.notesMeta ?? {}).length} Teilnehmende, {model.allItems.length} Aussagen
              </td>
              <td>{notes ? `${notes.file ?? 'eingefügt'}, ${new Date(notes.importedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}` : 'nicht importiert'}</td>
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

      <Section title="Bearbeitungsdauer">
        <DurationSelect />
        <p className="st-note">
          Spiel-Uhr: vom ersten Quest-Schritt bis zum Öffnen der Umfrage (die Uhr des Spiels, über Neuladen hinweg). Link-Dauer: vom Öffnen des Links (inkl. Einwilligung und Intro) bis zum Abschluss der Umfrage bzw. dem letzten Kontakt. Summe der Schritte: die gemessenen
          Dauern der Quest-Schritte. Mehrere Links: Summe oder Hauptlink (Teilnehmende &amp; Sessions).
        </p>
      </Section>

      <Section title="Zuordnungsregeln">
        <ul className="st-rules">
          <li>Teilnehmende: P-ID aus dem persönlichen Link bzw. den Notizen.</li>
          <li>Umfrage-Zeilen ↔ Teilnehmende, in dieser Reihenfolge: 1. manuell gewählt; 2. Teilnehmer-ID (tallyid); 3. Zeit (nur wenn eingeschaltet): Abgabe 10 min vor bis 120 min nach dem Öffnen der Umfrage im Spiel, nächste zuerst; 4. Reihenfolge: übrige Teilnehmende in der gewählten Reihenfolge (Notizen, P-ID oder Sessionstart), übrige Zeilen nach Abgabezeit. Abweichende AB/BA-Angaben werden markiert.</li>
          <li>Mehrere Links einer Person: P009.1, P009.2 … in der Reihenfolge des Starts; Dauer als Summe oder nur Hauptlink.</li>
          <li>Ende einer Sitzung: Abschluss der Umfrage; sonst letzter Kontakt des Spiels vor Ablauf des Links. Unterbrechung: mehr als 10 min ohne Ereignis im Spiel-Tracking.</li>
          <li>Testgruppe: aus dem Link (AB/BA); eine Korrektur überschreibt sie; Abweichungen zu den Notizen werden markiert.</li>
          <li>Teil 1: „vertauscht“ kehrt A und B der betreffenden Person um; „keine Präferenz“ zählt nicht im Vorzeichentest.</li>
          <li>Teil 3: Antworten 1–7, gedrehte Items umgepolt, Werte −3 bis +3; nur vollständige Skalen.</li>
          <li>Rückmeldungen: nur bestätigte Tags zählen; Vorschläge der KI bleiben bis zur Bestätigung unberücksichtigt; „Verworfen“ schließt eine Aussage aus.</li>
          <li>Ausgeschlossene Teilnehmende fehlen in allen Abbildungen, Tests und Listen.</li>
        </ul>
      </Section>

      <Import />

      <Translations />

      <Versions />

      <Section title="Änderungen">
        {log.length ? (
          <ol className="st-log" data-notr>
            {log.slice(0, 100).map((e, i) => (
              <li key={i}>
                <span className="st-muted">{berlin(e.at)}</span> {e.what}
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

const berlin = (t: number) => new Date(t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// the saved states: opened by link (only to look), restored after a check of
// every difference, saved by hand; one is saved before every import
function Versions() {
  const { study } = useCtx();
  const [list, setList] = useState<Version[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [restore, setRestore] = useState<{ v: Version; changes: Change[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () =>
    study
      .versions()
      .then(setList)
      .catch((e) => setMsg(`Versionen nicht verfügbar (${String((e as Error).message)}).`));
  const openRestore = async (v: Version) => {
    setMsg('Stand wird geladen …');
    try {
      const saved = await study.loadVersion(v.id);
      setRestore({ v, changes: restoreChanges(study.latest(), saved) });
      setMsg(null);
    } catch (e) {
      setMsg(`Laden fehlgeschlagen (${String((e as Error).message)}).`);
    }
  };
  useEffect(() => {
    void reload().then(() => {
      // (from a saved state's banner: /feedback?restore=<id>)
      const id = new URLSearchParams(window.location.search).get('restore');
      if (!id) return;
      history.replaceState(null, '', `/feedback${window.location.hash}`);
      void study.versions().then((vs) => {
        const v = vs.find((x) => x.id === id);
        if (v) void openRestore(v);
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const viewing = !!study.viewing;
  return (
    <Section title="Versionen">
      <p className="st-note">Vor jedem Import und jeder Wiederherstellung wird der ganze Stand gesichert. „Ansehen“ öffnet ihn als Link (nur lesen), „Wiederherstellen“ zeigt zuerst jede Abweichung.</p>
      <div className="st-toolbar">
        <button
          type="button"
          disabled={viewing}
          onClick={() => {
            const reason = prompt('Name für diesen Stand (optional):', 'von Hand gesichert');
            if (reason === null) return;
            void study
              .saveVersion(reason || 'von Hand gesichert')
              .then(() => reload())
              .then(() => setMsg('Stand gesichert.'))
              .catch((e) => setMsg(`Sichern fehlgeschlagen (${String((e as Error).message)}).`));
          }}
        >
          Stand jetzt sichern
        </button>
        {msg && <span className="st-muted">{msg}</span>}
      </div>
      {list && !list.length && <p className="st-empty">Noch keine gesicherten Stände.</p>}
      {list && list.length > 0 && (
        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Anlass</th>
                <th className="num">Größe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id} className={study.viewing?.id === v.id ? 'is-picked' : ''}>
                  <td>{berlin(v.at)}</td>
                  <td data-notr>{v.reason}</td>
                  <td className="num">{Math.round(v.size / 1024)} KB</td>
                  <td className="st-actions">
                    <a href={`/feedback?stand=${encodeURIComponent(v.id)}#uebersicht`} target="_blank" rel="noopener">
                      Ansehen
                    </a>{' '}
                    <button type="button" className="st-linkbtn" disabled={viewing} onClick={() => void openRestore(v)}>
                      Wiederherstellen
                    </button>{' '}
                    <button
                      type="button"
                      className="st-linkbtn"
                      onClick={() =>
                        void study.loadVersion(v.id).then((d) => download(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }), `feedback-stand-${v.id}.json`))
                      }
                    >
                      JSON
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {restore && (
        <ChangeModal
          title={`Stand vom ${berlin(restore.v.at)} wiederherstellen`}
          changes={restore.changes}
          names={['Aktuell', 'Gespeicherter Stand']}
          intro="Jede Abweichung zum gespeicherten Stand; übernommen wird der gespeicherte Stand, außer wo „Aktuell behalten“ gewählt ist. Der jetzige Stand wird vorher gesichert."
          busy={busy}
          onCancel={() => setRestore(null)}
          onApply={(choices) => {
            setBusy('Wird gesichert und übernommen …');
            void applyChanges(study, restore.changes, choices, `Wiederherstellung (${berlin(restore.v.at)})`)
              .then((summary) => {
                setMsg(summary);
                setRestore(null);
                return reload();
              })
              .catch((e) => setMsg(`Nicht übernommen: ${String((e as Error).message)}`))
              .finally(() => setBusy(null));
          }}
        />
      )}
    </Section>
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
  const order = ((study.docs.settings.matchOrder as { by?: MatchOrder } | undefined)?.by ?? 'pid') as MatchOrder;
  const useTime = !!(study.docs.settings.matchTime as { on?: boolean } | undefined)?.on;
  // the rows in the order they were submitted (file order without a time), with their place
  const sorted = tally.rows
    .map((r, i) => ({ r, i, t: timeCol >= 0 ? timeOf(r[timeCol] ?? '') : null }))
    .sort((a, b) => (a.t != null && b.t != null ? a.t - b.t : a.i - b.i));
  const rank = new Map<number, number>();
  sorted.filter((x) => !model.ignoredRows.has(x.i)).forEach((x, k) => rank.set(x.i, k + 1));
  return (
    <Section title="Zuordnung Umfrage ↔ Teilnehmende">
      <label className="st-scope">
        <span>Zuordnung nach Reihenfolge:</span>
        <select
          value={order}
          onChange={(e) => {
            study.commit([{ coll: 'settings', id: 'matchOrder', data: { by: e.target.value } }]);
            logChange(study, `Zuordnung nach Reihenfolge: ${MATCH_ORDER_LABEL[order]} → ${MATCH_ORDER_LABEL[e.target.value as MatchOrder]}`);
          }}
        >
          {(Object.keys(MATCH_ORDER_LABEL) as MatchOrder[]).map((k) => (
            <option key={k} value={k}>
              {MATCH_ORDER_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="st-check">
        <input
          type="checkbox"
          checked={useTime}
          onChange={(e) => {
            study.commit([{ coll: 'settings', id: 'matchTime', data: { on: e.target.checked } }]);
            logChange(study, `Zuordnung über Zeitabgleich ${e.target.checked ? 'an' : 'aus'}`);
          }}
        />
        zuerst über Zeitabgleich zuordnen (Abgabezeit ↔ Öffnen der Umfrage im Spiel)
      </label>
      <table className="st-table">
        <thead>
          <tr>
            <th className="num">Abgabe-Nr.</th>
            <th>Zeile</th>
            <th>Abgabe (dt. Zeit)</th>
            <th>AB/BA</th>
            <th>Teilnehmende</th>
            <th className="num">Pos.</th>
            <th>Termin (Notizen)</th>
            <th>Gruppe</th>
            <th>Zuordnung</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ r, i }) => {
            const p = owner.get(i);
            const ignored = model.ignoredRows.has(i);
            const toggle = () => {
              const rows = ignored ? [...model.ignoredRows].filter((x) => x !== i) : [...model.ignoredRows, i];
              study.commit([{ coll: 'settings', id: 'ignoredRows', data: { rows } }]);
              logChange(study, `Umfrage-Zeile ${i + 1} ${ignored ? 'wieder gewertet' : 'ignoriert'}`);
            };
            return (
              <tr key={i} className={ignored ? 'is-ignored' : !p || p.tallyConflict ? 'is-open' : ''}>
                <td className="num">{rank.get(i) ?? '–'}</td>
                <td className="num">{i + 1}</td>
                <td title={timeCol >= 0 ? `in der Datei (UTC): ${r[timeCol]}` : undefined}>{timeCol >= 0 ? localTime(r[timeCol] ?? '') : '–'}</td>
                <td>{orderCol >= 0 ? r[orderCol] || '–' : '–'}</td>
                <td>{ignored ? <span className="st-muted">ignoriert</span> : p ? p.id : <span className="st-flag">keine</span>}</td>
                <td className="num">{p && !ignored ? (model.orderPos.get(p.id) ?? '–') : ''}</td>
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
      <p className="st-note">Nach Abgabezeit sortiert. „Abgabe-Nr.“ und „Pos.“ (Platz der Person in der gewählten Reihenfolge) sind bei der Zuordnung nach Reihenfolge gleich; weichen sie ab, wurde die Zeile anders zugeordnet (siehe „Zuordnung“). Eine Zeile ignorieren (Testlauf, doppelte Abgabe) ordnet die übrigen neu zu. Einzelne Personen: auf „Teilnehmende &amp; Sessions“ die Tally-Zeile wählen.</p>
    </Section>
  );
}

// Tally's export is in UTC; shown in German time, as on tally.so
function localTime(v: string): string {
  const t = timeOf(v);
  return t == null ? v || '–' : new Date(t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
