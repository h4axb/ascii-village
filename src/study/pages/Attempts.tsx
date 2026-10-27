// "Versuche & Zeiten" on Teilnehmende & Sessions: a participant's links as
// attempts (start, end, active minutes, outcome, source, precision, note) and
// the participant's three durations – each value from the tracking unless set
// here by hand (shown with ↺ to go back to the measured one). Empty input =
// automatic; "kein gültiger Wert" = null (never 0).
import type { Person } from '../model';
import type { AttemptDoc, AttemptOutcome, PersonDoc, TimingDoc, TimingPrecision, TimingSource } from '../types';
import { OUTCOMES, PRECISION_LABEL, SOURCE_LABEL, type Val } from '../timing';
import { berlinTime } from '../match';
import { LazyInput, logChange, useCtx } from '../ui';

const STATUS_LABEL: Record<string, string> = { exakt: 'exakt gemessen', geschätzt: 'geschätzt', wiederholt: 'mehrere Versuche', unterbrochen: 'unterbrochen', unvollständig: 'nicht abgeschlossen' };
const clock = (t: number | null) => (t == null ? '' : new Date(t).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }));
const num = (v: number | null | undefined) => (v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ','));
const parseNum = (v: string): number | undefined => {
  const t = v.trim().replace(',', '.');
  if (!t) return undefined;
  const x = Number(t);
  return Number.isFinite(x) && x >= 0 ? x : undefined;
};
// "11:36" on the day of `day` (German time) → ms
function atClock(v: string, day: number | null): number | undefined {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(v.trim());
  if (!m || day == null) return undefined;
  const d = new Date(day);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((p) => [p.type, Number(p.value)]));
  return berlinTime(parts.year, parts.month - 1, parts.day, Number(m[1]), Number(m[2]));
}

function Reset({ v, onReset }: { v: Val<unknown>; onReset: () => void }) {
  return v.manual ? (
    <button type="button" className="st-linkbtn st-reset" onClick={onReset} title="zurück zum gemessenen Wert">
      ↺
    </button>
  ) : null;
}

export function AttemptsEditor({ p }: { p: Person }) {
  const { study } = useCtx();
  const t = p.timing;
  const save = (patch: Partial<PersonDoc>, what: string) => {
    study.commit([{ coll: 'people', id: p.id, data: { ...p.doc, id: p.id, ...patch } }]);
    logChange(study, `${p.id}: ${what}`);
  };
  const setAttempt = (key: string, label: string, field: keyof AttemptDoc, value: AttemptDoc[keyof AttemptDoc] | undefined, what: string) => {
    const cur: AttemptDoc = { ...(p.doc.attempts?.[key] ?? {}) };
    if (value === undefined) delete cur[field];
    else (cur as Record<string, unknown>)[field] = value;
    const all = { ...(p.doc.attempts ?? {}), [key]: cur };
    if (!Object.keys(cur).length) delete all[key];
    save({ attempts: Object.keys(all).length ? all : undefined }, `${label} ${what}`);
  };
  const setTiming = (field: keyof TimingDoc, value: TimingDoc[keyof TimingDoc] | undefined, what: string) => {
    const cur: TimingDoc = { ...(p.doc.timing ?? {}) };
    if (value === undefined) delete cur[field];
    else (cur as Record<string, unknown>)[field] = value;
    // (the older single "Dauer manuell" becomes the active time once it is edited here)
    const patch: Partial<PersonDoc> = { timing: Object.keys(cur).length ? cur : undefined };
    if (field === 'activeMin') patch.minutes = undefined;
    save(patch, what);
  };
  const numField = (label: string, v: Val<number | null>, field: keyof TimingDoc, opts: { nullable?: boolean } = {}) => (
    <label>
      {label}
      <span className="st-inline">
        <LazyInput
          type="text"
          inputMode="decimal"
          value={v.manual && v.value != null ? num(v.value) : ''}
          placeholder={v.manual && v.value == null ? 'kein gültiger Wert' : v.value == null ? '–' : `${num(v.value)} · auto`}
          onSave={(s) => setTiming(field, parseNum(s), `${label} → ${s.trim() || 'automatisch'}`)}
        />
        {opts.nullable && (
          <button type="button" className="st-linkbtn" onClick={() => setTiming(field, null, `${label} → kein gültiger Wert`)} title="kein gültiger Wert (zählt nicht, nicht 0)">
            kein Wert
          </button>
        )}
        <Reset v={v} onReset={() => setTiming(field, undefined, `${label} → automatisch`)} />
      </span>
    </label>
  );
  if (!t.attempts.length) return null;
  return (
    <details className="st-attempts" open={t.attemptCount > 1}>
      <summary>
        Versuche &amp; Zeiten: {t.attemptCount} {t.attemptCount === 1 ? 'Versuch' : 'Versuche'} · aktiv {t.active.value != null ? `${num(t.active.value)} min` : '–'}
        {t.activeEstimated ? ' (geschätzt)' : ''} · <span className={`st-badge${t.status === 'exakt' ? '' : ' is-conflict'}`}>{STATUS_LABEL[t.status]}</span>
      </summary>
      <dl className="st-kpis">
        {(
          [
            ['Verstrichen', t.elapsed],
            ['Aktiv', t.active],
            ['Unterbrechung', t.interruption],
            ['Sauber', t.clean],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className={v.manual ? 'is-manual' : ''}>
            <dt>{l}</dt>
            <dd>{v.value != null ? `${num(v.value)} min` : '–'}</dd>
          </div>
        ))}
        <div>
          <dt>Neustarts</dt>
          <dd>{t.restartCount}</dd>
        </div>
      </dl>
      <div className="st-table-wrap st-attempt-wrap">
        <table className="st-table st-attempt-table">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Link</th>
              <th>Start</th>
              <th>Ende</th>
              <th>Aktiv (min)</th>
              <th>Ausgang</th>
              <th>Quelle</th>
              <th>Genauigkeit</th>
              <th>Notiz</th>
            </tr>
          </thead>
          <tbody>
            {t.attempts.map((a) => {
              const day = a.start.value ?? a.link.started;
              return (
                <tr key={a.key}>
                  <td data-label="Nr.">
                    <LazyInput type="number" min={1} value={a.n.manual ? String(a.n.value) : ''} placeholder={String(a.n.value)} onSave={(s) => setAttempt(a.key, a.label, 'n', parseNum(s), `Versuch Nr. → ${s || 'automatisch'}`)} aria-label={`${a.label} Nummer`} />
                  </td>
                  <td data-label="Link">
                    <span className="st-pid">{a.label}</span>
                  </td>
                  <td data-label="Start">
                    <LazyInput value={a.start.manual ? clock(a.start.value) : ''} placeholder={clock(a.start.value) || 'hh:mm'} onSave={(s) => (s.trim() && atClock(s, day) === undefined ? undefined : setAttempt(a.key, a.label, 'start', atClock(s, day), `Start → ${s || 'automatisch'}`))} aria-label={`${a.label} Start`} />
                  </td>
                  <td data-label="Ende">
                    <LazyInput value={a.end.manual ? clock(a.end.value) : ''} placeholder={clock(a.end.value) || 'hh:mm'} onSave={(s) => (s.trim() && atClock(s, day) === undefined ? undefined : setAttempt(a.key, a.label, 'end', atClock(s, day), `Ende → ${s || 'automatisch'}`))} aria-label={`${a.label} Ende`} />
                  </td>
                  <td data-label="Aktiv (min)">
                    <LazyInput type="text" inputMode="decimal" value={a.active.manual && a.active.value != null ? num(a.active.value) : ''} placeholder={a.active.value != null ? num(a.active.value) : '–'} onSave={(s) => setAttempt(a.key, a.label, 'activeMin', parseNum(s), `aktiv → ${s || 'automatisch'} min`)} aria-label={`${a.label} aktive Minuten`} />
                  </td>
                  <td data-label="Ausgang">
                    <select value={a.outcome.manual ? a.outcome.value : ''} onChange={(e) => setAttempt(a.key, a.label, 'outcome', (e.target.value || undefined) as AttemptOutcome | undefined, `Ausgang → ${e.target.value || 'automatisch'}`)} aria-label={`${a.label} Ausgang`}>
                      <option value="">{a.outcome.manual ? 'automatisch' : `${a.outcome.value} · auto`}</option>
                      {OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Quelle">
                    <select value={a.source.manual ? a.source.value : ''} onChange={(e) => setAttempt(a.key, a.label, 'source', (e.target.value || undefined) as TimingSource | undefined, `Quelle → ${e.target.value || 'automatisch'}`)} aria-label={`${a.label} Quelle`}>
                      <option value="">{`${SOURCE_LABEL.event_log} · auto`}</option>
                      <option value="observation">{SOURCE_LABEL.observation}</option>
                      <option value="estimate">{SOURCE_LABEL.estimate}</option>
                    </select>
                  </td>
                  <td data-label="Genauigkeit">
                    <select value={a.precision.manual ? a.precision.value : ''} onChange={(e) => setAttempt(a.key, a.label, 'precision', (e.target.value || undefined) as TimingPrecision | undefined, `Genauigkeit → ${e.target.value || 'automatisch'}`)} aria-label={`${a.label} Genauigkeit`}>
                      <option value="">{a.precision.manual ? 'automatisch' : `${PRECISION_LABEL[a.precision.value]} · auto`}</option>
                      {(Object.keys(PRECISION_LABEL) as TimingPrecision[]).map((k) => (
                        <option key={k} value={k}>
                          {PRECISION_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Notiz">
                    <LazyInput value={a.note} placeholder="z. B. Neustart nach Absturz" onSave={(s) => setAttempt(a.key, a.label, 'note', s.trim() || undefined, `Notiz → ${s.trim() || '–'}`)} aria-label={`${a.label} Notiz`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          {t.attemptCount > 1 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Summe</td>
                <td data-label="Aktiv gesamt">{t.active.value != null ? `${num(t.active.value)} min` : '–'}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="st-fields st-timing-fields">
        {numField('Verstrichen (min)', t.elapsed, 'elapsedMin')}
        {numField('Aktiv gesamt (min)', t.active, 'activeMin')}
        {numField('Unterbrechung (min)', t.interruption, 'interruptionMin')}
        {numField('Saubere Erstdurchlaufzeit (min)', t.clean, 'cleanMin', { nullable: true })}
      </div>
      <details className="st-timing-more" open={t.technical.manual || t.eligible.manual || t.exclusionReason.manual || t.source.manual || t.precision.manual}>
        <summary>
          Statistik &amp; Kennzeichnung: {t.eligible.value ? 'zählt in der sauberen Durchlaufzeit' : `ausgeschlossen${t.exclusionReason.value ? ` (${t.exclusionReason.value})` : ''}`} · {SOURCE_LABEL[t.source.value]}, {PRECISION_LABEL[t.precision.value]}
        </summary>
        <div className="st-fields st-timing-fields">
        <label className="st-check">
          <input type="checkbox" checked={t.technical.value} onChange={(e) => setTiming('technical', e.target.checked, `technische Unterbrechung → ${e.target.checked ? 'ja' : 'nein'}`)} />
          technische Unterbrechung
          <Reset v={t.technical} onReset={() => setTiming('technical', undefined, 'technische Unterbrechung → automatisch')} />
        </label>
        <label className="st-check">
          <input type="checkbox" checked={t.eligible.value} onChange={(e) => setTiming('eligible', e.target.checked, `für saubere Durchlaufzeit → ${e.target.checked ? 'ja' : 'nein'}`)} />
          in der sauberen Durchlaufzeit (Mittelwert/SD) zählen
          <Reset v={t.eligible} onReset={() => setTiming('eligible', undefined, 'saubere Durchlaufzeit → automatisch')} />
        </label>
        <label className="st-wide">
          Ausschlussgrund
          <span className="st-inline">
            <LazyInput value={t.exclusionReason.manual ? t.exclusionReason.value : ''} placeholder={t.exclusionReason.value || '–'} onSave={(s) => setTiming('exclusionReason', s.trim() || undefined, `Ausschlussgrund → ${s.trim() || 'automatisch'}`)} />
            <Reset v={t.exclusionReason} onReset={() => setTiming('exclusionReason', undefined, 'Ausschlussgrund → automatisch')} />
          </span>
        </label>
        <label>
          Quelle (gesamt)
          <select value={t.source.manual ? t.source.value : ''} onChange={(e) => setTiming('source', (e.target.value || undefined) as TimingSource | undefined, `Quelle → ${e.target.value || 'automatisch'}`)}>
            <option value="">{t.source.manual ? 'automatisch' : `${SOURCE_LABEL[t.source.value]} · auto`}</option>
            {(Object.keys(SOURCE_LABEL) as TimingSource[]).map((k) => (
              <option key={k} value={k}>
                {SOURCE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Genauigkeit (gesamt)
          <select value={t.precision.manual ? t.precision.value : ''} onChange={(e) => setTiming('precision', (e.target.value || undefined) as TimingPrecision | undefined, `Genauigkeit → ${e.target.value || 'automatisch'}`)}>
            <option value="">{t.precision.manual ? 'automatisch' : `${PRECISION_LABEL[t.precision.value]} · auto`}</option>
            {(Object.keys(PRECISION_LABEL) as TimingPrecision[]).map((k) => (
              <option key={k} value={k}>
                {PRECISION_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        </div>
      </details>
      <p className="st-note">Leeres Feld / „auto“ = gemessen, eigener Wert mit ↺ zurücksetzen. „Aktiv“ ist die Summe der Versuche; „kein Wert“ heißt ungültig, nicht 0.</p>
    </details>
  );
}
