// Daten & Validierung: the imports, the data sources, the checks (missing
// values, conflicts, open work), the matching rules, and the change log.
import type { ColumnRole, StudyDocs } from '../types';
import { GAP_MIN, MATCH_ORDER_LABEL, matchOptions, personIdOf, type MatchOrder } from '../model';
import { fmtBerlin, MATCH_STEPS, STEP_LABEL, ZONE_LABEL, type MatchStep, type TallyZone } from '../match';
import { planAssign, planPairing, planRematch } from '../tallyPlan';

const SWAP_INTRO = 'Diese Zuordnung ändert Umfrage-Antworten (bei einem Tausch die beider Personen). Weitere betroffene Personen einzeln entscheiden: „Aktuell behalten“ hält ihre bisherige Zeile fest. Der jetzige Stand wird vorher gesichert.';
import { download } from '../charts';
import { useEffect, useState } from 'react';
import type { Version } from '../store';
import { resolve, restoreChanges, type Change } from '../changes';
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
    const z = model.tallyZone;
    add(
      'Umfrage',
      'Zeitzone der Abgabezeiten geklärt',
      z.setting !== 'auto' || z.sure || !z.n,
      `${ZONE_LABEL[z.zone]}${z.setting !== 'auto' ? ' (fest eingestellt)' : z.n ? ` – erkannt aus ${z.n} Abgaben mit Test-ID, Median ${Math.round(z.gapMin ?? 0)} min nach dem Öffnen der Umfrage${z.sure ? '' : '; nicht eindeutig: unter „Zuordnung“ prüfen'}` : ' (Standard; keine Abgaben mit Test-ID zum Prüfen)'}`,
    );
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
      <Settings />

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
              <td>{study.stand ? `übernommener Stand vom ${berlin(study.stand.at)}` : 'live'}</td>
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

      <Section title="Zuordnungsregeln">
        <ul className="st-rules">
          <li>Teilnehmende: P-ID aus dem persönlichen Link bzw. den Notizen.</li>
          <li>Umfrage-Zeilen ↔ Teilnehmende: wie oben unter „Einstellungen“ ({['von Hand', ...matchOptions(study.docs).steps!.map((x) => STEP_LABEL[x])].join(' → ')}). Abweichende AB/BA-Angaben werden markiert.</li>
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
  // (a new version comes with every import or restore, each logged: the list follows the log)
  const logged = ((study.docs.settings.log as { entries?: LogEntry[] } | undefined)?.entries ?? [])[0]?.at;
  useEffect(() => {
    if (list) void reload();
  }, [logged]); // eslint-disable-line react-hooks/exhaustive-deps
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
          intro="Jede Abweichung zum gespeicherten Stand: für jede entscheiden (oder oben für alle). Der jetzige Stand wird vorher gesichert."
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

// a change that moves survey answers between participants is asked first:
// no one's answers change unasked (nothing moves: stored at once)
const ASK_INTRO = 'Diese Änderung ordnet Umfrage-Antworten anderen Teilnehmenden zu. Für jede Person entscheiden: „Aktuell behalten“ hält die bisherige Zeile fest. Der jetzige Stand wird vorher gesichert.';
function usePairingAsk() {
  const { study } = useCtx();
  const [plan, setPlan] = useState<{ changes: Change[]; title: string; reason: string; intro: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const open = (changes: Change[], title: string, reason: string, intro = ASK_INTRO) => setPlan({ changes, title, reason, intro });
  const ask = (label: string, fields: [string, string][], patch: (w: StudyDocs) => void, reason: string) => {
    const changes = planPairing(study.latest(), study.game, { label, fields, patch });
    if (changes.length > 1) return open(changes, label, reason);
    const { put, del } = resolve(changes, study.latest(), {});
    study.commit(put, del);
    logChange(study, reason);
    setMsg(`${reason}: gespeichert (niemandes Antworten ändern sich).`);
  };
  const modal = plan && (
    <ChangeModal
      title={plan.title}
      changes={plan.changes}
      names={['Aktuell', 'Danach']}
      intro={plan.intro}
      busy={busy}
      onCancel={() => setPlan(null)}
      onApply={(choices) => {
        setBusy('Wird gesichert und übernommen …');
        void applyChanges(study, plan.changes, choices, plan.reason)
          .then((summary) => {
            setMsg(summary);
            setPlan(null);
          })
          .catch((e) => setMsg(`Nicht übernommen: ${String((e as Error).message)}`))
          .finally(() => setBusy(null));
      }}
    />
  );
  return { ask, open, modal, msg };
}

// ---- Einstellungen: how answers find their participants, and the times ----
function Settings() {
  const { model, study } = useCtx();
  const { ask, open, modal, msg } = usePairingAsk();
  const o = matchOptions(study.docs);
  const steps = o.steps!;
  const order = ((study.docs.settings.matchOrder as { by?: MatchOrder } | undefined)?.by ?? 'pid') as MatchOrder;
  const zone = model.tallyZone;
  const viewing = !!study.viewing;
  const stepName = (s: MatchStep) => STEP_LABEL[s] + (s === 'zeit' && !o.useTime ? ' – aus' : '');
  const rules = (st: MatchStep[] = steps): [string, string][] => [['Reihenfolge der Regeln', ['von Hand', ...st.map(stepName)].join(' → ')], ['Teilnehmende in der Reihenfolge', MATCH_ORDER_LABEL[order]], ['Zeitzone der Datei', ZONE_LABEL[zone.zone]]];
  const setSteps = (n: MatchStep[]) => ask('Reihenfolge der Regeln ändern', [['Vorher', ['von Hand', ...steps.map(stepName)].join(' → ')], ['Danach', ['von Hand', ...n.map(stepName)].join(' → ')]], (w) => void (w.settings.matchSteps = { order: n }), `Regeln: ${n.map((x) => STEP_LABEL[x]).join(' → ')}`);
  const move = (k: number, d: -1 | 1) => {
    const n = [...steps];
    [n[k], n[k + d]] = [n[k + d], n[k]];
    setSteps(n);
  };
  const setWindow = (key: 'before' | 'after', v: string) => {
    const x = Math.max(0, Math.round(Number(v.replace(',', '.'))));
    if (!Number.isFinite(x) || x === (key === 'before' ? o.before! : o.after!) / 60000) return;
    const next = { before: o.before! / 60000, after: o.after! / 60000, [key]: x };
    ask('Zeitfenster für den Zeitabgleich ändern', [['Fenster', `${next.before} min vor bis ${next.after} min nach dem Öffnen der Umfrage im Spiel`]], (w) => void (w.settings.matchWindow = next), `Zeitfenster: ${next.before} min vor, ${next.after} min nach`);
  };
  return (
    <Section title="Einstellungen" id="einstellungen">
      <p className="st-note">Was wofür gilt. Jede Änderung, die Umfrage-Antworten anderen Teilnehmenden zuordnen würde, wird vorher pro Person gefragt.</p>
      {modal}
      <div className="st-settings">
        <fieldset disabled={viewing}>
          <legend>Umfrage ↔ Teilnehmende: Reihenfolge der Regeln</legend>
          <ol className="st-steps">
            <li className="is-fixed">
              <span>Von Hand gewählt (Teilnehmende &amp; Sessions, Zuordnungstabelle)</span>
              <span className="st-muted">immer zuerst</span>
            </li>
            {steps.map((st, k) => (
              <li key={st}>
                <span>{STEP_LABEL[st]}</span>
                {st === 'zeit' && (
                  <label className="st-check">
                    <input
                      type="checkbox"
                      checked={!!o.useTime}
                      onChange={(e) => {
                        const on = e.target.checked;
                        ask(`Zeitabgleich ${on ? 'einschalten' : 'ausschalten'}`, [['Zeitabgleich', on ? 'an' : 'aus']], (w) => void (w.settings.matchTime = { on }), `Zuordnung über Zeitabgleich ${on ? 'an' : 'aus'}`);
                      }}
                    />
                    an
                  </label>
                )}
                <span className="st-steps-move">
                  <button type="button" disabled={k === 0} onClick={() => move(k, -1)} aria-label={`${STEP_LABEL[st]} nach oben`}>
                    ↑
                  </button>
                  <button type="button" disabled={k === steps.length - 1} onClick={() => move(k, 1)} aria-label={`${STEP_LABEL[st]} nach unten`}>
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <div className="st-toolbar">
            <button type="button" disabled={steps[steps.length - 1] === 'id'} onClick={() => setSteps([...steps.filter((x) => x !== 'id'), 'id'])}>
              Test-ID ans Ende
            </button>
            <button type="button" disabled={steps.join() === MATCH_STEPS.join()} onClick={() => setSteps(MATCH_STEPS)}>
              Standard (Test-ID, Zeit, Reihenfolge)
            </button>
          </div>
          <p className="st-note">Kommt die Test-ID später, ordnen Zeit und Reihenfolge auch Antworten mit Test-ID zu; die Test-ID entscheidet dann nur noch, was übrig ist.</p>
        </fieldset>

        <fieldset disabled={viewing}>
          <legend>Zeitabgleich: Fenster um das Öffnen der Umfrage im Spiel</legend>
          <div className="st-fields">
            <label>
              Minuten vorher
              <input type="number" min={0} defaultValue={o.before! / 60000} key={`b${o.before}`} onBlur={(e) => setWindow('before', e.target.value)} />
            </label>
            <label>
              Minuten nachher
              <input type="number" min={0} defaultValue={o.after! / 60000} key={`a${o.after}`} onBlur={(e) => setWindow('after', e.target.value)} />
            </label>
          </div>
          <p className="st-note">Eine Abgabe passt zu einer Person, wenn sie in diesem Fenster liegt; die nächste zuerst. Nur wenn der Zeitabgleich an ist.</p>
        </fieldset>

        <fieldset disabled={viewing}>
          <legend>Reihenfolge: welche Teilnehmende zuerst</legend>
          <select
            value={order}
            onChange={(e) => {
              const v = e.target.value as MatchOrder;
              ask('Reihenfolge der Teilnehmenden ändern', [['Teilnehmende in der Reihenfolge', MATCH_ORDER_LABEL[v]]], (w) => void (w.settings.matchOrder = { by: v }), `Zuordnung nach Reihenfolge: ${MATCH_ORDER_LABEL[order]} → ${MATCH_ORDER_LABEL[v]}`);
            }}
            aria-label="Teilnehmende in der Reihenfolge"
          >
            {(Object.keys(MATCH_ORDER_LABEL) as MatchOrder[]).map((k) => (
              <option key={k} value={k}>
                {MATCH_ORDER_LABEL[k]}
              </option>
            ))}
          </select>
          <p className="st-note">Die übrigen Antworten werden nach Abgabezeit (deutsche Zeit, früheste zuerst) an die Teilnehmenden in dieser Reihenfolge gegeben.</p>
        </fieldset>

        <fieldset disabled={viewing}>
          <legend>Zeitzone der Umfrage-Datei</legend>
          <select
            value={zone.setting}
            onChange={(e) => {
              const v = e.target.value;
              const name = v === 'auto' ? 'automatisch' : ZONE_LABEL[v as TallyZone];
              ask('Zeitzone der Umfrage ändern', [['Zeitzone der Datei', name]], (w) => void (w.settings.tallyZone = { zone: v }), `Zeitzone der Umfrage: ${name}`);
            }}
            aria-label="Zeitzone der Umfrage-Datei"
          >
            <option value="auto">automatisch ({ZONE_LABEL[zone.zone]})</option>
            <option value="UTC">UTC</option>
            <option value="Europe/Berlin">deutsche Zeit</option>
          </select>
          <p className="st-note">
            Gelesen als {ZONE_LABEL[zone.zone]}
            {zone.setting === 'auto' ? (zone.n ? ` (erkannt aus ${zone.n} Abgaben mit Test-ID: im Median ${Math.round(zone.gapMin ?? 0)} min nach dem Öffnen der Umfrage${zone.sure ? '' : '; unsicher – bitte prüfen'})` : ' (Standard von Tally)') : ' (fest eingestellt)'}; gespeichert wie exportiert, angezeigt in deutscher Zeit, verglichen in UTC.
          </p>
        </fieldset>

        <fieldset disabled={viewing}>
          <legend>Von Hand festgehaltene Zuordnungen</legend>
          {(() => {
            const pinned = model.included.filter((p) => p.tallyVia === 'manuell' && p.tallyRow != null);
            const idCol = model.mapping.findIndex((m) => m.role === 'id');
            const rowsT = study.docs.tally.main?.rows ?? [];
            return pinned.length ? (
              <>
                <ul className="st-pins">
                  {pinned.map((p) => {
                    const tid = idCol >= 0 ? personIdOf(rowsT[p.tallyRow!]?.[idCol] ?? '') : null;
                    return (
                      <li key={p.id}>
                        <strong>{p.id}</strong> → Zeile {p.tallyRow! + 1}
                        {tid ? ` (Test-ID ${tid})` : ''}
                        {tid && tid !== p.id && <span className="st-flag"> passt nicht zur Test-ID</span>}
                      </li>
                    );
                  })}
                </ul>
                <p className="st-note">Diese Zuordnungen gelten vor allen Regeln – auch ein erneuter Upload ändert sie nicht. Sie entstehen durch eine Wahl von Hand oder durch „Aktuell behalten“ in einer Rückfrage.</p>
                <button type="button" onClick={() => open(planRematch(study.latest(), study.game, rules()), 'Festgehaltene Zuordnungen prüfen', 'Festgehaltene Zuordnungen geprüft', 'Für jede Person, bei der die Regeln eine andere Zeile ergeben: „Danach übernehmen“ hebt das Festhalten auf, „Aktuell behalten“ lässt es. Der jetzige Stand wird vorher gesichert.')}>
                  Prüfen und aufheben …
                </button>
              </>
            ) : (
              <p className="st-note">Keine: alle Antworten werden nach den Regeln oben zugeordnet.</p>
            );
          })()}
        </fieldset>

        <fieldset>
          <legend>Bearbeitungsdauer</legend>
          <DurationSelect />
          <p className="st-note">Spiel-Uhr: erster Quest-Schritt bis Öffnen der Umfrage. Link-Dauer: Öffnen des Links bis Abschluss bzw. letzter Kontakt. Mehrere Links: Summe oder Hauptlink (Teilnehmende &amp; Sessions).</p>
        </fieldset>
      </div>
      <div className="st-toolbar">
        <button type="button" disabled={viewing || !study.docs.tally.main} onClick={() => open(planRematch(study.latest(), study.game, rules()), 'Neu zuordnen nach den eingestellten Regeln', 'Neu zuordnen (Umfrage)', 'Alle Antworten nach den Regeln oben zuordnen; Zuordnungen von Hand werden dabei aufgehoben, außer wo „Aktuell behalten“ gewählt ist. Für jede betroffene Person entscheiden. Der jetzige Stand wird vorher gesichert.')}>
          Neu zuordnen nach diesen Regeln
        </button>
        {msg && <span className="st-muted">{msg}</span>}
      </div>
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
  // the rows in the order they were submitted (file order without a time), with their place
  const sorted = tally.rows
    .map((r, i) => ({ r, i, t: model.submitted[i] ?? null }))
    .sort((a, b) => (a.t != null && b.t != null ? a.t - b.t : a.i - b.i));
  const zone = model.tallyZone;
  const idColM = model.mapping.findIndex((m) => m.role === 'id');
  const { ask, open, modal } = usePairingAsk();
  const rank = new Map<number, number>();
  sorted.filter((x) => !model.ignoredRows.has(x.i)).forEach((x, k) => rank.set(x.i, k + 1));
  return (
    <Section title="Zuordnung Umfrage ↔ Teilnehmende">
      <p className="st-note">Regeln, Zeitfenster, Zeitzone und Reihenfolge stehen oben unter „Einstellungen“. Hier: jede Antwort, wem sie zugeordnet ist und warum; „zuordnen an“ ändert es von Hand (eine Zeile einer anderen Person wird getauscht).</p>
      {modal}
      <table className="st-table">
        <thead>
          <tr>
            <th className="num">Abgabe-Nr.</th>
            <th>Zeile</th>
            <th>Test-ID (Datei)</th>
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
              ask(`Umfrage-Zeile ${i + 1} ${ignored ? 'wieder werten' : 'ignorieren'}`, [['Zeile', String(i + 1)], ['Danach', ignored ? 'gewertet' : 'ignoriert']], (w) => void (w.settings.ignoredRows = { rows }), `Umfrage-Zeile ${i + 1} ${ignored ? 'wieder gewertet' : 'ignoriert'}`);
            };
            return (
              <tr key={i} className={ignored ? 'is-ignored' : !p || p.tallyConflict ? 'is-open' : ''}>
                <td className="num">{rank.get(i) ?? '–'}</td>
                <td className="num">{i + 1}</td>
                <td>
                  {idColM >= 0 && r[idColM] ? (personIdOf(r[idColM]) ?? r[idColM]) : <span className="st-muted">–</span>}
                  {p && idColM >= 0 && personIdOf(r[idColM] ?? '') && personIdOf(r[idColM] ?? '') !== p.id && (
                    <span className="st-flag">{p.tallyVia === 'manuell' ? ' · von Hand anders zugeordnet' : ` · ${p.tallyVia ? VIA[p.tallyVia] : 'anders'} zugeordnet, nicht nach Test-ID`}</span>
                  )}
                </td>
                <td title={timeCol >= 0 ? `in der Datei (${ZONE_LABEL[zone.zone]}): ${r[timeCol]}` : undefined}>{model.submitted[i] != null ? fmtBerlin(model.submitted[i]!) : timeCol >= 0 ? r[timeCol] || '–' : '–'}</td>
                <td>{orderCol >= 0 ? r[orderCol] || '–' : '–'}</td>
                <td>
                  {ignored ? (
                    <span className="st-muted">ignoriert</span>
                  ) : (
                    // (another participant: a row they have is swapped, after asking)
                    <select
                      value={p?.id ?? ''}
                      disabled={!!study.viewing}
                      aria-label={`Zeile ${i + 1} zuordnen an`}
                      onChange={(e) => {
                        const to = e.target.value;
                        if (!to) {
                          if (p) open(planAssign(study.latest(), study.game, p.id, null), `${p.id}: keine Umfrage-Antworten`, `${p.id}: Tally-Zeile → keine`, SWAP_INTRO);
                          return;
                        }
                        const changes = planAssign(study.latest(), study.game, to, i);
                        open(changes, changes[0].label, changes[0].label, SWAP_INTRO);
                      }}
                    >
                      <option value="">{p ? 'keine' : '– keine –'}</option>
                      {model.included.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.id}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
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
