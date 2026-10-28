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
function Panes({ c, choice, names }: { c: Change; choice: Choice | undefined; names: [string, string] }) {
  const cur = c.current ?? {};
  const inc = c.incoming ?? {};
  const text = diffWords(cur.text ?? '', inc.text ?? '');
  const labels = [...new Set([...(cur.fields ?? []).map((f) => f[0]), ...(inc.fields ?? []).map((f) => f[0])])];
  const field = (s: DiffSide, l: string) => s.fields?.find((f) => f[0] === l)?.[1] ?? '';
  const pane = (side: 'alt' | 'neu', s: DiffSide | undefined, pieces: Piece[]) => {
    // (undecided: both panes as they are)
    const on = choice === side || choice === 'beide';
    return (
      <div className={`st-pane is-${side === 'alt' ? 'current' : 'incoming'}${choice == null ? '' : on ? ' is-chosen' : ' is-dropped'}`}>
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
  // (unchanged: only what is there)
  if (c.kind === 'gleich') return <div className="st-panes is-same">{pane('alt', c.current, text.left.map((p) => ({ ...p, op: 'same' as const })))}</div>;
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
  intro = 'Alle Änderungen sind vorausgewählt: abwählen oder „Aktuell behalten“ wählen, was nicht übernommen werden soll. Vor dem Übernehmen wird der jetzige Stand gesichert.',
}: {
  title: string;
  changes: Change[];
  onApply: (choices: Record<string, Choice>) => void;
  onCancel: () => void;
  busy?: string | null;
  names?: [string, string]; // the two sides (a restore: current and saved)
  intro?: string;
}) {
  // every change starts selected (the new side); what should not be applied is deselected
  const [choices, setChoices] = useState<Record<string, Choice | undefined>>(() => Object.fromEntries(changes.map((c) => [c.id, c.kind === 'gleich' ? 'alt' : 'neu'])));
  // the last step: what will be applied, what stays, what was already so, before anything is stored
  const [review, setReview] = useState(false);
  const set = (id: string, v: Choice) => setChoices((x) => ({ ...x, [id]: v }));
  const byGroup = (cs: Change[]) => {
    const m = new Map<string, Change[]>();
    for (const c of cs) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  };
  const groups = useMemo(() => byGroup(changes), [changes]);
  const conflicts = changes.filter((c) => c.kind === 'konflikt');
  const fresh = changes.filter((c) => c.kind === 'neu');
  const same = changes.filter((c) => c.kind === 'gleich');
  const actionable = changes.length - same.length;
  const open = conflicts.filter((c) => !choices[c.id]).length;
  const applied = changes.filter((c) => c.kind !== 'gleich' && choices[c.id] != null && choices[c.id] !== 'alt');
  const stays = changes.filter((c) => c.kind !== 'gleich' && choices[c.id] === 'alt');
  const all = (v: Choice) => setChoices((x) => ({ ...x, ...Object.fromEntries(conflicts.map((c) => [c.id, v])) }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (review) setReview(false);
      else onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel, review]);
  const what = (c: Change) => (c.kind === 'konflikt' ? (choices[c.id] === 'beide' ? 'beide behalten' : choices[c.id] === 'neu' ? `${names[1]} übernehmen` : `${names[0]} behalten`) : choices[c.id] === 'neu' ? 'neu' : 'nicht übernommen');
  const list = (cs: Change[], cls: string) =>
    byGroup(cs).map(([g, items]) => (
      <li key={g} className={cls}>
        <strong data-notr>{g}</strong>
        <ul>
          {items.map((c) => (
            <li key={c.id}>
              {c.label} <span className="st-muted">({what(c)})</span>
            </li>
          ))}
        </ul>
      </li>
    ));
  return (
    <div className="st-modal-back" role="presentation">
      <div className="st-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="st-modal-head">
          <h2>{review ? `Bestätigen: ${title}` : title}</h2>
          <p className="st-muted">
            {review
              ? 'Zum Schluss: so wird es übernommen. „Zurück“ ändert die Auswahl; erst „Jetzt übernehmen“ speichert (der jetzige Stand wird vorher gesichert).'
              : `${fresh.length} neu · ${conflicts.length} ${conflicts.length === 1 ? 'Konflikt' : 'Konflikte'} · ${same.length} unverändert. ${intro}`}
          </p>
          {!review && conflicts.length > 1 && (
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
          {review ? (
            <div className="st-review">
              <section>
                <h3 className="is-applied">Wird übernommen ({applied.length})</h3>
                {applied.length ? <ul className="st-review-list">{list(applied, 'is-applied')}</ul> : <p className="st-muted">nichts</p>}
              </section>
              <section>
                <h3 className="is-stays">Bleibt wie bisher ({stays.length})</h3>
                {stays.length ? <ul className="st-review-list">{list(stays, 'is-stays')}</ul> : <p className="st-muted">nichts</p>}
              </section>
              <section>
                <h3 className="is-same">Unverändert ({same.length})</h3>
                {same.length ? (
                  <ul className="st-review-list">
                    {byGroup(same).map(([g, items]) => (
                      <li key={g} className="is-same">
                        <strong data-notr>{g}</strong> <span className="st-muted">{items.map((c) => c.label).join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="st-muted">nichts</p>
                )}
              </section>
            </div>
          ) : (
            <>
              {!actionable && <p>Keine Änderungen: alles ist schon so gespeichert.</p>}
              {groups.map(([g, cs]) => {
                const todo = cs.filter((c) => c.kind !== 'gleich');
                const kept = cs.filter((c) => c.kind === 'gleich');
                return (
                  <section key={g} className="st-modal-group">
                    <h3 data-notr>{g}</h3>
                    {todo.map((c) => {
                      const ch = choices[c.id];
                      return (
                        <div key={c.id} className={`st-change is-${c.kind}${c.kind === 'konflikt' && !ch ? ' is-open' : ''}`}>
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
                    {kept.length > 0 && (
                      <details className="st-same">
                        <summary>{`Unverändert (${kept.length})`}</summary>
                        {kept.map((c) => (
                          <div key={c.id} className="st-change is-gleich">
                            <div className="st-change-head">
                              <span className="st-badge is-same">Unverändert</span>
                              <span className="st-change-label">{c.label}</span>
                            </div>
                            <Panes c={c} choice={undefined} names={names} />
                          </div>
                        ))}
                      </details>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </div>
        <footer className="st-modal-foot">
          {busy && <span className="st-muted">{busy}</span>}
          <span className="st-selbar-gap" />
          {review ? (
            <>
              <button type="button" onClick={() => setReview(false)} disabled={!!busy}>
                Zurück
              </button>
              <button type="button" className="is-primary" onClick={() => onApply(choices as Record<string, Choice>)} disabled={!!busy || !applied.length}>
                Jetzt übernehmen
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onCancel} disabled={!!busy}>
                Abbrechen
              </button>
              {open > 0 && <span className="st-flag">{open === 1 ? 'Noch 1 Konflikt zu entscheiden' : `Noch ${open} Konflikte zu entscheiden`}</span>}
              <button type="button" className="is-primary" onClick={() => setReview(true)} disabled={!!busy || !actionable || open > 0}>
                {`${applied.length} Änderungen übernehmen …`}
              </button>
            </>
          )}
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
