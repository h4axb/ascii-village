// Teilnehmende & Sessions: each participant's links and sessions, raw
// answers and game events, and the corrections per participant. Each applies everywhere:
// excluded from the analysis, Teil 1 answers swapped, the run-time rule for
// several links, the Tally row, the test group, the age.
import type { PersonDoc } from '../types';
import { personIdOf, type Person } from '../model';
import { fmtDate, fmtMin, LazyInput, logChange, Section, useCtx } from '../ui';

export const VIA: Record<string, string> = { manuell: 'manuell', id: 'nach ID', zeit: 'nach Zeit', reihenfolge: 'nach Reihenfolge' };
const CHANGE_NAME: Record<string, string> = { excluded: 'ausgeschlossen', reason: 'Grund', swapP1: 'Teil 1 vertauscht', runtime: 'Dauer aus', mainLink: 'Hauptlink', tallyRow: 'Tally-Zeile', group: 'Testgruppe', age: 'Alter' };

export default function People() {
  const { model, study } = useCtx();
  const idCol = model.mapping.findIndex((m) => m.role === 'id');
  const rows = study.docs.tally.main?.rows ?? [];
  const set = (p: Person, patch: Partial<PersonDoc>) => {
    study.commit([{ coll: 'people', id: p.id, data: { ...p.doc, id: p.id, ...patch } }]);
    logChange(study, `${p.id}: ${Object.entries(patch).map(([k, v]) => `${CHANGE_NAME[k] ?? k} → ${v === undefined ? 'automatisch' : v === null ? 'keine' : v === true ? 'ja' : v === false ? 'nein' : String(v)}`).join(', ')}`);
  };
  const owner = new Map(model.persons.filter((p) => p.tallyRow != null).map((p) => [p.tallyRow!, p.id]));

  return (
    <>
      <Section title="Teilnehmende & Sessions">
        <div className="st-people">
          {model.persons.map((p) => (
            <article key={p.id} className={`st-person${p.excluded ? ' is-excluded' : ''}`}>
              <header>
                <h3>{p.id}</h3>
                <span className="st-muted">{fmtDate(p.date)}</span>
                {p.tallyConflict && <span className="st-flag">Umfrage-Zeile: andere Gruppe – Zuordnung prüfen</span>}
                {p.groupMismatch && <span className="st-flag">Notizen: {p.notesGroup}, Tracking: {p.trackedGroup}</span>}
                {p.excluded && <span className="st-flag">ausgeschlossen</span>}
              </header>

              <Durations p={p} />

              <div className="st-fields">
                {p.links.length > 1 && (
                  <label>
                    Dauer aus
                    <select value={p.doc.runtime ?? 'sum'} onChange={(e) => set(p, { runtime: e.target.value as 'sum' | 'main' })}>
                      <option value="sum">Summe aller Links</option>
                      <option value="main">nur Hauptlink</option>
                    </select>
                  </label>
                )}
                {p.links.length > 1 && p.doc.runtime === 'main' && (
                  <label>
                    Hauptlink
                    <select value={p.doc.mainLink ?? ''} onChange={(e) => set(p, { mainLink: e.target.value || undefined })}>
                      <option value="">längster</option>
                      {p.links.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Testgruppe
                  <select value={p.doc.group ?? ''} onChange={(e) => set(p, { group: (e.target.value || undefined) as PersonDoc['group'] })}>
                    <option value="">{p.trackedGroup ? `${p.trackedGroup} (Tracking)` : '–'}</option>
                    <option value="AB">AB</option>
                    <option value="BA">BA</option>
                  </select>
                </label>
                <label>
                  Tally-Zeile
                  <select
                    value={p.doc.tallyRow === undefined ? 'auto' : p.doc.tallyRow === null ? 'none' : String(p.doc.tallyRow)}
                    onChange={(e) => set(p, { tallyRow: e.target.value === 'auto' ? undefined : e.target.value === 'none' ? null : Number(e.target.value) })}
                  >
                    <option value="auto">automatisch{p.doc.tallyRow === undefined && p.tallyRow != null ? ` (Zeile ${p.tallyRow + 1} · ${VIA[p.tallyVia ?? 'id']})` : ''}</option>
                    <option value="none">keine</option>
                    {rows.map((r, i) => (
                      <option key={i} value={i} disabled={owner.has(i) && owner.get(i) !== p.id}>
                        Zeile {i + 1}
                        {idCol >= 0 && r[idCol] ? ` (${personIdOf(r[idCol]) ?? r[idCol]})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Alter
                  <LazyInput type="number" min={0} max={120} value={p.doc.age == null ? '' : String(p.doc.age)} placeholder="aus Tally" onSave={(v) => set(p, { age: v === '' ? null : Number(v) })} />
                </label>
                <label className="st-check">
                  <input type="checkbox" checked={!!p.doc.swapP1} onChange={(e) => set(p, { swapP1: e.target.checked })} />
                  Teil 1: A und B vertauscht
                </label>
                <label className="st-check">
                  <input type="checkbox" checked={p.excluded} onChange={(e) => set(p, { excluded: e.target.checked })} />
                  Von der Auswertung ausschließen
                </label>
                {p.excluded && (
                  <label className="st-wide">
                    Grund
                    <LazyInput type="text" value={p.doc.reason ?? ''} onSave={(v) => set(p, { reason: v })} />
                  </label>
                )}
              </div>
              <PersonDetails p={p} />
            </article>
          ))}
        </div>
        {model.unmatchedRows.length > 0 && (
          <p className="st-note">
            Tally-Zeilen ohne Zuordnung: {model.unmatchedRows.map((r) => `${r + 1}${idCol >= 0 && rows[r]?.[idCol] ? ` (${rows[r][idCol]})` : ''}`).join(', ')}
          </p>
        )}
      </Section>
    </>
  );
}

const TYPE_LABEL: Record<string, string> = { craft: 'Crafting', hint: 'Hinweis', step: 'Quest-Schritt', error: 'Fehler', session: 'Sitzung' };
const time = (t: number) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// the raw Tally answers and the game's events of one person
function PersonDetails({ p }: { p: Person }) {
  const { study } = useCtx();
  const game = study.game;
  const tally = study.docs.tally.main;
  const row = p.tallyRow != null ? tally?.rows[p.tallyRow] : undefined;
  const evs = game.events.filter((e) => e.participant === p.id).sort((a, b) => a.at - b.at);
  const label = (at: number, key?: string) => p.links.find((l) => (key ? l.key === key : l.started && at >= l.started - 60000 && (l.end == null || at <= l.end + 60000)))?.label ?? '';
  const counts = Object.entries(evs.reduce<Record<string, number>>((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {}));
  return (
    <>
      {row && tally && (
        <details className="st-details">
          <summary>Rohantworten (Tally-Zeile {p.tallyRow! + 1})</summary>
          <table className="st-table st-kv">
            <tbody>
              {tally.headers.map((h, j) =>
                row[j] ? (
                  <tr key={j}>
                    <th data-notr>{h}</th>
                    <td data-notr>{row[j]}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </details>
      )}
      {evs.length > 0 && (
        <details className="st-details">
          <summary>
            Spielereignisse ({evs.length}: {counts.map(([t, c]) => `${c} ${TYPE_LABEL[t] ?? t}`).join(', ')})
          </summary>
          <ol className="st-events">
            {evs.map((e) => {
              const d = e.data as Record<string, unknown>;
              const what =
                e.type === 'craft'
                  ? `${d.design === 'pre' ? 'A' : d.design === 'post' ? 'B' : String(d.design)} · ${String(d.outcome ?? '')}${d.reworks ? ` · ${String(d.reworks)} Überarb.` : ''}`
                  : e.type === 'step'
                    ? String(d.step ?? e.step ?? '')
                    : e.type === 'session'
                      ? String(d.what ?? '')
                      : String(d.kind ?? d.detail ?? d.id ?? '');
              return (
                <li key={e.id}>
                  <span className="st-muted">{time(e.at)}</span> <span className="st-pid">{label(e.at, e.key)}</span> {TYPE_LABEL[e.type] ?? e.type}
                  {e.part ? ` (${e.part})` : ''}: {what}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </>
  );
}

const clockT = (t: number | null) => (t ? new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–');
const USED: Record<string, string> = { link: 'Link-Dauer', clock: 'Spiel-Uhr', steps: 'Schritte' };

// the three duration measures per link and in total, the one used marked
function Durations({ p }: { p: Person }) {
  const cell = (v: number | null, used: boolean) => <td className={`num${used ? ' is-used' : ''}`}>{fmtMin(v)}</td>;
  const u = p.durationUsed;
  return (
    <div className="st-links">
      {p.links.length ? (
        <table className="st-durations">
          <thead>
            <tr>
              <th>Link</th>
              <th>Zeit</th>
              <th className="num">Spiel-Uhr</th>
              <th className="num">Link-Dauer</th>
              <th className="num">Schritte</th>
            </tr>
          </thead>
          <tbody>
            {p.links.map((l) => (
              <tr key={l.key}>
                <td>
                  <span className="st-pid">{l.label}</span>
                </td>
                <td className="st-muted">
                  {clockT(l.started)}–{clockT(l.end)} · {l.endedBy} · {l.crafts} Crafts
                  {l.gaps.count > 0 && <span className="st-flag"> · {l.gaps.count} Unterbrechung{l.gaps.count > 1 ? 'en' : ''} ({Math.round(l.gaps.minutes)} min)</span>}
                </td>
                {cell(l.clockMinutes, u === 'clock')}
                {cell(l.linkMinutes, u === 'link')}
                {cell(l.stepMinutes, u === 'steps')}
              </tr>
            ))}
            <tr className="st-total">
              <td colSpan={2}>
                Dauer{p.links.length > 1 ? (p.doc.runtime === 'main' ? ' (Hauptlink)' : ' (Summe)') : ''}: <strong>{fmtMin(p.minutes)}</strong>
                {u && <span className="st-muted"> · {USED[u]}</span>}
              </td>
              {cell(p.clockMinutes, u === 'clock')}
              {cell(p.linkMinutes, u === 'link')}
              {cell(p.stepMinutes, u === 'steps')}
            </tr>
          </tbody>
        </table>
      ) : (
        <span className="st-muted">kein Link</span>
      )}
    </div>
  );
}
