// The check before an import (or a restore) is stored: every change listed
// by participant, conflicts side by side like a merge conflict ("Aktuell"
// left, "Neu" right, the words that differ marked), each with its choice.
// Nothing is stored before "Übernehmen".
import { useEffect, useMemo, useState } from 'react';
import { diffWords, resolve, type Change, type Choice, type DiffSide, type Piece } from './changes';
import type { Study } from './store';
import { logChange } from './ui';

function Words({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((p, i) =>
        p.op === 'same' ? (
          <span key={i}>{p.t}</span>
        ) : p.op === 'del' ? (
          <del key={i} className="st-diff-del">
            {p.t}
          </del>
        ) : (
          <ins key={i} className="st-diff-add">
            {p.t}
          </ins>
        ),
      )}
    </>
  );
}

// the two panes of one conflict, their texts and fields diffed against each other
function Panes({ c, choice, names }: { c: Change; choice: Choice; names: [string, string] }) {
  const cur = c.current ?? {};
  const inc = c.incoming ?? {};
  const text = diffWords(cur.text ?? '', inc.text ?? '');
  const labels = [...new Set([...(cur.fields ?? []).map((f) => f[0]), ...(inc.fields ?? []).map((f) => f[0])])];
  const field = (s: DiffSide, l: string) => s.fields?.find((f) => f[0] === l)?.[1] ?? '';
  const pane = (side: 'alt' | 'neu', s: DiffSide | undefined, pieces: Piece[]) => {
    const on = choice === side || choice === 'beide';
    return (
      <div className={`st-pane is-${side === 'alt' ? 'current' : 'incoming'}${on ? ' is-chosen' : ' is-dropped'}`}>
        <div className="st-pane-head">{side === 'alt' ? names[0] : names[1]}</div>
        {!s || (s.text == null && !s.fields) ? (
          <p className="st-muted">{side === 'alt' ? 'noch nicht vorhanden' : 'nicht mehr in der neuen Fassung'}</p>
        ) : (
          <>
            {s.text != null && (
              <p className="st-pane-text" data-notr>
                <Words pieces={pieces} />
              </p>
            )}
            {labels.length > 0 && (
              <table className="st-pane-fields">
                <tbody>
                  {labels.map((l) => {
                    const a = field(cur, l);
                    const b = field(inc, l);
                    const d = diffWords(a, b);
                    return (
                      <tr key={l} className={a !== b ? 'is-diff' : ''}>
                        <th data-notr>{l}</th>
                        <td data-notr>{a === b ? (side === 'alt' ? a : b) || '–' : <Words pieces={side === 'alt' ? d.left : d.right} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {s.note && (
              <p className="st-pane-note" data-notr>
                {s.note}
              </p>
            )}
          </>
        )}
      </div>
    );
  };
  if (c.kind === 'neu' && !c.incoming) return null;
  return (
    <div className="st-panes">
      {c.kind === 'konflikt' && pane('alt', c.current, text.left)}
      {pane('neu', c.incoming, c.kind === 'neu' ? text.right.map((p) => ({ ...p, op: 'same' as const })) : text.right)}
    </div>
  );
}

export function ChangeModal({
  title,
  changes,
  onApply,
  onCancel,
  busy,
  names = ['Aktuell', 'Neu'],
  intro = 'Bei Konflikten bleibt der aktuelle Stand, wenn nichts anderes gewählt ist. Vor dem Übernehmen wird der jetzige Stand gesichert.',
}: {
  title: string;
  changes: Change[];
  onApply: (choices: Record<string, Choice>) => void;
  onCancel: () => void;
  busy?: string | null;
  names?: [string, string]; // the two sides (a restore: current and saved)
  intro?: string;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(changes.map((c) => [c.id, c.choice])));
  const set = (id: string, v: Choice) => setChoices((x) => ({ ...x, [id]: v }));
  const groups = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of changes) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [changes]);
  const conflicts = changes.filter((c) => c.kind === 'konflikt');
  const fresh = changes.filter((c) => c.kind === 'neu');
  const taken = changes.filter((c) => (choices[c.id] ?? c.choice) !== 'alt').length;
  const all = (v: Choice) => setChoices((x) => ({ ...x, ...Object.fromEntries(conflicts.map((c) => [c.id, v])) }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return (
    <div className="st-modal-back" role="presentation">
      <div className="st-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="st-modal-head">
          <h2>{title}</h2>
          <p className="st-muted">
            {fresh.length} neu · {conflicts.length} {conflicts.length === 1 ? 'Konflikt' : 'Konflikte'}. {intro}
          </p>
          {conflicts.length > 1 && (
            <div className="st-modal-all">
              <span className="st-muted">Alle Konflikte:</span>
              <button type="button" onClick={() => all('alt')}>
                {`${names[0]} behalten`}
              </button>
              <button type="button" onClick={() => all('neu')}>
                {`${names[1]} übernehmen`}
              </button>
            </div>
          )}
        </header>
        <div className="st-modal-body">
          {!changes.length && <p>Keine Änderungen: alles ist schon so gespeichert.</p>}
          {groups.map(([g, cs]) => (
            <section key={g} className="st-modal-group">
              <h3 data-notr>{g}</h3>
              {cs.map((c) => {
                const ch = choices[c.id] ?? c.choice;
                return (
                  <div key={c.id} className={`st-change is-${c.kind}`}>
                    <div className="st-change-head">
                      <span className={`st-badge${c.kind === 'konflikt' ? ' is-conflict' : ''}`}>{c.kind === 'konflikt' ? 'Konflikt' : 'Neu'}</span>
                      <span className="st-change-label">{c.label}</span>
                      <span className="st-change-pick">
                        {c.kind === 'konflikt' ? (
                          <>
                            <button type="button" className={ch === 'alt' ? 'is-on' : ''} onClick={() => set(c.id, 'alt')}>
                              {`${names[0]} behalten`}
                            </button>
                            <button type="button" className={ch === 'neu' ? 'is-on' : ''} onClick={() => set(c.id, 'neu')}>
                              {`${names[1]} übernehmen`}
                            </button>
                            {c.both && (
                              <button type="button" className={ch === 'beide' ? 'is-on' : ''} onClick={() => set(c.id, 'beide')}>
                                Beide behalten
                              </button>
                            )}
                          </>
                        ) : (
                          <label className="st-check">
                            <input type="checkbox" checked={ch === 'neu'} onChange={(e) => set(c.id, e.target.checked ? 'neu' : 'alt')} /> übernehmen
                          </label>
                        )}
                      </span>
                    </div>
                    <Panes c={c} choice={ch} names={names} />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        <footer className="st-modal-foot">
          {busy && <span className="st-muted">{busy}</span>}
          <span className="st-selbar-gap" />
          <button type="button" onClick={onCancel} disabled={!!busy}>
            Abbrechen
          </button>
          <button type="button" className="is-primary" onClick={() => onApply(choices)} disabled={!!busy || !changes.length}>
            {taken} Änderungen übernehmen
          </button>
        </footer>
      </div>
    </div>
  );
}

// store what was chosen: the current state saved first (so it can be opened
// or restored later), then one save of all chosen changes, logged
export async function applyChanges(study: Study, changes: Change[], choices: Record<string, Choice>, reason: string): Promise<string> {
  await study.saveVersion(`vor ${reason}`);
  const { put, del } = resolve(changes, study.latest(), choices);
  const n = changes.filter((c) => (choices[c.id] ?? c.choice) !== 'alt').length;
  const kept = changes.filter((c) => c.kind === 'konflikt' && (choices[c.id] ?? c.choice) === 'alt').length;
  if (put.length || del.length) study.commit(put, del);
  const summary = `${reason}: ${n} Änderungen übernommen${kept ? `, ${kept} Konflikte beim aktuellen Stand belassen` : ''}`;
  logChange(study, summary);
  return summary;
}
