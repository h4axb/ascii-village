// Import: the Tally export (CSV) with a role for each column, and the notes
// file. Re-importing keeps the column roles (by header) and every tag.
import { useState } from 'react';
import type { ColumnRole, Side, TallyDoc } from '../types';
import { carryMapping, choiceOf, conditionIn, designIn, likertOf, parseCsv, reassignParts, suggestMapping, ueqsItemIn } from '../tally';
import { UEQS_ITEMS } from '../stats';
import { LazyInput, logChange, Section, useCtx } from '../ui';
import { translateTally } from '../translations';
import { NotesImport } from './Notes';

const ROLE_NAME: Record<ColumnRole['role'], string> = {
  ignore: 'ignorieren',
  id: 'Teilnehmer-ID',
  order: 'Reihenfolge',
  time: 'Zeitpunkt',
  p1: 'Teil 1: Vergleich',
  likert: 'Teil 2: Likert',
  ueqs: 'Teil 3: UEQ-S',
  info: 'Teil 4: Angabe',
  text: 'Freitext',
};

function roleFor(role: ColumnRole['role'], header: string, vals: string[]): ColumnRole {
  const distinct = [...new Set(vals)];
  switch (role) {
    case 'p1':
      return { role, question: header, values: Object.fromEntries(distinct.map((v) => [v, choiceOf(v)])) };
    case 'likert':
      return { role, item: header, design: designIn(header) ?? conditionIn(header) ?? null, values: Object.fromEntries(distinct.map((v) => [v, likertOf(v)])) };
    case 'ueqs': {
      const u = ueqsItemIn(header);
      return { role, item: u?.item ?? 0, design: designIn(header) ?? conditionIn(header) ?? null, reversed: u?.reversed ?? false };
    }
    case 'info':
      return { role, label: header, numeric: vals.every((v) => /^-?\d+([.,]\d+)?$/.test(v)) };
    case 'text':
      return { role, label: header };
    default:
      return { role } as ColumnRole;
  }
}

export default function Import() {
  const { study } = useCtx();
  const tally = study.docs.tally.main as TallyDoc | undefined;
  const [msg, setMsg] = useState<string | null>(null);
  const [onlyMapped, setOnlyMapped] = useState(false);

  async function readFile(f: File) {
    const text = await f.text();
    const all = parseCsv(text);
    if (all.length < 2) return setMsg('Die Datei enthält keine Antworten.');
    const [headers, ...rows] = all;
    const suggested = suggestMapping(headers, rows);
    const mapping = tally ? carryMapping(tally.headers, tally.mapping, headers, suggested.mapping) : suggested.mapping;
    const doc: TallyDoc = { file: f.name, importedAt: Date.now(), headers, rows: rows.map((r) => headers.map((_, j) => r[j] ?? '')), mapping, parts: suggested.parts };
    study.commit([{ coll: 'tally', id: 'main', data: doc }]);
    setMsg(`${rows.length} Antworten, ${headers.length} Spalten importiert${tally ? ' (Zuordnung übernommen)' : ''}.`);
    logChange(study, `Tally-Import: ${f.name}, ${rows.length} Antworten, ${headers.length} Spalten`);
    try {
      const n = await translateTally(study, (d, a) => setMsg(`Deutsche Fassungen der Umfragetexte: ${d} von ${a} …`));
      setMsg(`${rows.length} Antworten, ${headers.length} Spalten importiert${tally ? ' (Zuordnung übernommen)' : ''}${n ? `; ${n} Texte automatisch übersetzt (unter „Übersetzungen“ prüfen)` : ''}.`);
    } catch (e) {
      setMsg(`${rows.length} Antworten importiert; Übersetzung nicht verfügbar (${String((e as Error).message)}).`);
    }
  }

  const setRole = (j: number, r: ColumnRole) => {
    if (!tally) return;
    const mapping = [...tally.mapping];
    mapping[j] = r;
    study.commit([{ coll: 'tally', id: 'main', data: { ...tally, mapping } }]);
  };

  return (
    <>
      <Section title="Import: Tally-Export">
        <div className="st-toolbar">
          <label className="st-file">
            CSV-Datei wählen
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
          </label>
          {tally && (
            <span className="st-muted">
              {tally.file} · {tally.rows.length} Antworten · {new Date(tally.importedAt).toLocaleString('de-DE')}
            </span>
          )}
          {tally && (
            <button
              type="button"
              onClick={() => {
                const { mapping, parts } = suggestMapping(tally.headers, tally.rows);
                study.commit([{ coll: 'tally', id: 'main', data: { ...tally, mapping, parts } }]);
              }}
            >
              Zuordnung neu vorschlagen
            </button>
          )}
          {tally && (
            <label className="st-check">
              <input type="checkbox" checked={onlyMapped} onChange={(e) => setOnlyMapped(e.target.checked)} />
              ignorierte ausblenden
            </label>
          )}
        </div>
        {msg && <p className="st-note">{msg}</p>}
        {tally && <PartRanges tally={tally} />}
        {tally && (
          <div className="st-mapping">
            {tally.headers.map((h, j) => {
              const m = tally.mapping[j] ?? { role: 'ignore' };
              if (onlyMapped && m.role === 'ignore') return null;
              const vals = tally.rows.map((r) => (r[j] ?? '').trim()).filter(Boolean);
              return (
                <div key={j} className={`st-col${m.role === 'ignore' ? ' is-ignored' : ''}`}>
                  <div className="st-col-head">
                    <div className="st-col-name">
                      <span className="st-muted">{j + 1}. </span>
                      {h || `Spalte ${j + 1}`}
                    </div>
                    <div className="st-col-sample">{[...new Set(vals)].slice(0, 4).join(' · ') || '(leer)'}</div>
                  </div>
                  <div className="st-col-role">
                    <select value={m.role} onChange={(e) => setRole(j, roleFor(e.target.value as ColumnRole['role'], h, vals))}>
                      {Object.entries(ROLE_NAME).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <RoleDetail m={m} onChange={(r) => setRole(j, r)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <NotesImport />
    </>
  );
}

// A / B by name, or the 1st / 2nd run (A or B by the person's group);
// none: about both designs (Teil 2) or the whole game (Teil 3)
function DesignSelect({ value, onChange }: { value: Side | null; onChange: (d: Side | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as Side | null)} aria-label="Variante">
      <option value="A">Variante A</option>
      <option value="B">Variante B</option>
      <option value="1">1. Durchgang</option>
      <option value="2">2. Durchgang</option>
      <option value="">beide / gesamt</option>
    </select>
  );
}

// where Teil 1–4 start; the roles of columns that move to another part are suggested anew
function PartRanges({ tally }: { tally: TallyDoc }) {
  const { study } = useCtx();
  const parts = tally.parts ?? [null, null, null, null];
  const NAMES = ['Teil 1: Vergleich', 'Teil 2: Likert', 'Teil 3: UEQ-S', 'Teil 4: Angaben'];
  const set = (i: number, v: number | null) => {
    const next = [...parts];
    next[i] = v;
    const mapping = reassignParts(tally.headers, tally.rows, tally.mapping, parts, next);
    study.commit([{ coll: 'tally', id: 'main', data: { ...tally, parts: next, mapping } }]);
    logChange(study, `Tally: ${NAMES[i]} ab ${v == null ? '–' : `Spalte ${v + 1}`}`);
  };
  return (
    <div className="st-parts">
      {NAMES.map((n, i) => (
        <label key={n}>
          {n} ab
          <select value={parts[i] ?? ''} onChange={(e) => set(i, e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">–</option>
            {tally.headers.map((h, j) => (
              <option key={j} value={j}>
                {j + 1}. {h.length > 60 ? `${h.slice(0, 58)}…` : h}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function RoleDetail({ m, onChange }: { m: ColumnRole; onChange: (r: ColumnRole) => void }) {
  switch (m.role) {
    case 'p1':
      return (
        <div className="st-role-detail">
          <LazyInput value={m.question} onSave={(question) => onChange({ ...m, question })} aria-label="Frage (Kurzname)" />
          {Object.entries(m.values).map(([v, c]) => (
            <label key={v}>
              <span className="st-val">{v}</span>
              <select value={c ?? ''} onChange={(e) => onChange({ ...m, values: { ...m.values, [v]: (e.target.value || null) as Side | 'neutral' | null } })}>
                <option value="">ungültig</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="1">1. Durchgang</option>
                <option value="2">2. Durchgang</option>
                <option value="neutral">keine Präferenz</option>
              </select>
            </label>
          ))}
        </div>
      );
    case 'likert':
      return (
        <div className="st-role-detail">
          <LazyInput value={m.item} onSave={(item) => onChange({ ...m, item })} aria-label="Item (gleicher Name für A und B)" />
          <DesignSelect value={m.design} onChange={(design) => onChange({ ...m, design })} />
          {Object.entries(m.values)
            .filter(([v]) => !/^\d+$/.test(v))
            .map(([v, n]) => (
              <label key={v}>
                <span className="st-val">{v}</span>
                <input type="number" min={1} max={7} value={n ?? ''} onChange={(e) => onChange({ ...m, values: { ...m.values, [v]: e.target.value ? Number(e.target.value) : null } })} />
              </label>
            ))}
        </div>
      );
    case 'ueqs':
      return (
        <div className="st-role-detail">
          <select value={m.item} onChange={(e) => onChange({ ...m, item: Number(e.target.value) })} aria-label="UEQ-S-Item">
            {UEQS_ITEMS.map(([a, b], i) => (
              <option key={i} value={i}>
                {i + 1}: {a} – {b}
              </option>
            ))}
          </select>
          <DesignSelect value={m.design} onChange={(design) => onChange({ ...m, design })} />
          <label className="st-check">
            <input type="checkbox" checked={m.reversed} onChange={(e) => onChange({ ...m, reversed: e.target.checked })} />
            Pole vertauscht (positiv links)
          </label>
        </div>
      );
    case 'info':
    case 'text':
      return (
        <div className="st-role-detail">
          <LazyInput value={m.label} onSave={(label) => onChange({ ...m, label })} aria-label="Bezeichnung" />
        </div>
      );
    default:
      return null;
  }
}
