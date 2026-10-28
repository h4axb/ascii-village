// The check of the AI's proposals before anything is stored: per statement
// the current version (left) and the new one (right, editable by hand), each
// with "Aktuell behalten" / "Neu übernehmen" – the new one preselected. Then a
// summary; "Jetzt übernehmen" saves the current state first.
//   RewriteReview  statements reworded (the German version is what changes)
//   TagReview      tags and finding suggested for statements
import { useEffect, useState, type ReactNode } from 'react';
import type { ItemDoc, TagGroup } from './types';
import type { Study } from './store';
import type { Put } from './store';
import { diffWords } from './changes';
import { Words } from './ChangeModal';
import { logChange } from './ui';

type Pick = 'alt' | 'neu';
interface Row {
  id: string;
  group: string; // the participant
  label: string; // a short name of the statement
}

// the frame both share: rows with their two sides, the choice, the summary step
function Shell({
  title,
  intro,
  rows,
  picks,
  setPick,
  render,
  onApply,
  onCancel,
  busy,
}: {
  title: string;
  intro: string;
  rows: Row[];
  picks: Record<string, Pick>;
  setPick: (id: string, p: Pick) => void;
  render: (id: string) => ReactNode;
  onApply: () => void;
  onCancel: () => void;
  busy: string | null;
}) {
  const [review, setReview] = useState(false);
  const taken = rows.filter((r) => picks[r.id] === 'neu');
  const kept = rows.filter((r) => picks[r.id] !== 'neu');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (review) setReview(false);
      else onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, review, onCancel]);
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const summary = (list: Row[], cls: string) =>
    list.length ? (
      <ul className="st-review-list">
        {groups
          .filter((g) => list.some((r) => r.group === g))
          .map((g) => (
            <li key={g} className={cls}>
              <strong data-notr>{g}</strong>
              <ul>
                {list
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <li key={r.id} data-notr>
                      {r.label}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
      </ul>
    ) : (
      <p className="st-muted">nichts</p>
    );
  return (
    <div className="st-modal-back" role="presentation">
      <div className="st-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="st-modal-head">
          <h2>{review ? `Bestätigen: ${title}` : title}</h2>
          <p className="st-muted">{review ? 'So wird es übernommen. „Zurück“ ändert die Auswahl; erst „Jetzt übernehmen“ speichert (der jetzige Stand wird vorher gesichert).' : intro}</p>
          {!review && rows.length > 1 && (
            <div className="st-modal-all">
              <span className="st-muted">Alle:</span>
              <button type="button" onClick={() => rows.forEach((r) => setPick(r.id, 'alt'))}>
                Aktuell behalten
              </button>
              <button type="button" onClick={() => rows.forEach((r) => setPick(r.id, 'neu'))}>
                Neu übernehmen
              </button>
            </div>
          )}
        </header>
        <div className="st-modal-body">
          {review ? (
            <div className="st-review">
              <section>
                <h3 className="is-applied">Wird übernommen ({taken.length})</h3>
                {summary(taken, 'is-applied')}
              </section>
              <section>
                <h3 className="is-stays">Bleibt wie bisher ({kept.length})</h3>
                {summary(kept, 'is-stays')}
              </section>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g} className="st-modal-group">
                <h3 data-notr>{g}</h3>
                {rows
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <div key={r.id} className="st-change is-konflikt">
                      <div className="st-change-head">
                        <span className="st-change-label st-muted">{picks[r.id] === 'neu' ? 'wird übernommen' : 'bleibt wie bisher'}</span>
                        <span className="st-change-pick">
                          <button type="button" className={picks[r.id] === 'alt' ? 'is-on' : ''} onClick={() => setPick(r.id, 'alt')}>
                            Aktuell behalten
                          </button>
                          <button type="button" className={picks[r.id] === 'neu' ? 'is-on' : ''} onClick={() => setPick(r.id, 'neu')}>
                            Neu übernehmen
                          </button>
                        </span>
                      </div>
                      {render(r.id)}
                    </div>
                  ))}
              </section>
            ))
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
              <button type="button" className="is-primary" onClick={onApply} disabled={!!busy || !taken.length}>
                Jetzt übernehmen
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onCancel} disabled={!!busy}>
                Abbrechen
              </button>
              <button type="button" className="is-primary" onClick={() => setReview(true)} disabled={!!busy || !taken.length}>
                {`${taken.length} ${taken.length === 1 ? 'Änderung' : 'Änderungen'} übernehmen …`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

const short = (t: string) => (t.length > 70 ? `${t.slice(0, 70)} …` : t);
// the version a statement is shown and reworded in
export const workingText = (i: ItemDoc) => i.de || i.text;

async function store(study: Study, put: Put[], reason: string, what: string) {
  await study.saveVersion(`vor ${reason}`);
  if (put.length) study.commit(put);
  logChange(study, what);
}

// ---- statements reworded ----
export interface Rewrite {
  id: string;
  text: string;
}
export function RewriteReview({ study, items, rewrites, onClose }: { study: Study; items: Map<string, ItemDoc>; rewrites: Rewrite[]; onClose: (msg?: string) => void }) {
  const list = rewrites.filter((r) => items.has(r.id) && r.text.trim() !== workingText(items.get(r.id)!).trim());
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(list.map((r) => [r.id, r.text])));
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(list.map((r) => [r.id, 'neu' as Pick])));
  const [busy, setBusy] = useState<string | null>(null);
  const setPick = (id: string, p: Pick) => setPicks((x) => ({ ...x, [id]: p }));
  const rows: Row[] = list.map((r) => {
    const i = items.get(r.id)!;
    return { id: r.id, group: i.link ?? i.person, label: short(workingText(i)) };
  });
  const apply = () => {
    setBusy('Stand wird gesichert, wird übernommen …');
    const put: Put[] = list
      .filter((r) => picks[r.id] === 'neu' && texts[r.id].trim())
      .map((r) => {
        const i = study.latest().items[r.id] ?? items.get(r.id)!;
        // (the original note stays as it is; the German version is the reworded one)
        return { coll: 'items' as const, id: r.id, data: { ...i, de: texts[r.id].trim(), deAuto: false, deStale: false } };
      });
    void store(study, put, 'KI-Umformulierung', `KI-Umformulierung: ${put.length} Aussagen übernommen`)
      .then(() => onClose(`${put.length} Aussagen umformuliert übernommen.`))
      .catch((e) => setBusy(`Nicht übernommen: ${String((e as Error).message)}`));
  };
  if (!list.length) {
    queueMicrotask(() => onClose('KI: keine Änderungen an den Aussagen vorgeschlagen.'));
    return null;
  }
  return (
    <Shell
      title={`KI-Umformulierung prüfen (${list.length} Aussagen)`}
      intro="Links die jetzige Fassung, rechts der Vorschlag der KI – rechts frei bearbeitbar. Alle Vorschläge sind vorausgewählt; „Aktuell behalten“, wo nichts geändert werden soll. Übernommen wird in die deutsche Fassung; die Originalnotiz bleibt unverändert."
      rows={rows}
      picks={picks}
      setPick={setPick}
      busy={busy}
      onCancel={() => onClose('KI-Umformulierung verworfen: nichts übernommen.')}
      onApply={apply}
      render={(id) => {
        const cur = workingText(items.get(id)!);
        const d = diffWords(cur, texts[id]);
        const on = picks[id];
        return (
          <div className="st-panes">
            <div className={`st-pane is-current${on === 'alt' ? ' is-chosen' : ' is-dropped'}`}>
              <div className="st-pane-head">Aktuell</div>
              <p className="st-pane-text" data-notr>
                <Words pieces={d.left} />
              </p>
            </div>
            <div className={`st-pane is-incoming${on === 'neu' ? ' is-chosen' : ' is-dropped'}`}>
              <div className="st-pane-head">Neu (bearbeitbar)</div>
              <textarea
                className="st-pane-edit"
                rows={3}
                value={texts[id]}
                onChange={(e) => {
                  setTexts((x) => ({ ...x, [id]: e.target.value }));
                  setPick(id, 'neu');
                }}
                aria-label="Neue Fassung bearbeiten"
              />
              <p className="st-pane-text st-pane-diff" data-notr>
                <Words pieces={d.right} />
              </p>
            </div>
          </div>
        );
      }}
    />
  );
}

// ---- tags suggested ----
export interface TagProposal {
  id: string;
  chips: string[]; // the whole set it would carry
  finding: string | null;
  newFinding: string | null;
}
export function TagReview({ study, tags, items, proposals, onClose }: { study: Study; tags: TagGroup[]; items: Map<string, ItemDoc>; proposals: TagProposal[]; onClose: (msg?: string) => void }) {
  const list = proposals.filter((p) => items.has(p.id));
  const [sets, setSets] = useState<Record<string, { chips: string[]; finding: string | null }>>(() => Object.fromEntries(list.map((p) => [p.id, { chips: p.chips, finding: p.finding }])));
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(list.map((p) => [p.id, 'neu' as Pick])));
  const [busy, setBusy] = useState<string | null>(null);
  const setPick = (id: string, p: Pick) => setPicks((x) => ({ ...x, [id]: p }));
  const findings = Object.values(study.docs.findings).sort((a, b) => a.name.localeCompare(b.name));
  const groupOf = (c: string) => tags.find((g) => g.chips.some((x) => x.id === c));
  const label = (c: string) => tags.flatMap((g) => g.chips).find((x) => x.id === c)?.label ?? c;
  const edit = (id: string, f: (s: { chips: string[]; finding: string | null }) => { chips: string[]; finding: string | null }) => {
    setSets((x) => ({ ...x, [id]: f(x[id]) }));
    setPick(id, 'neu');
  };
  const add = (id: string, chip: string) =>
    edit(id, (s) => {
      const g = groupOf(chip);
      // (a single-choice group: the new tag replaces the group's other one)
      const rest = g && !g.multi ? s.chips.filter((c) => !g.chips.some((x) => x.id === c)) : s.chips;
      return { ...s, chips: [...rest, chip] };
    });
  const rows: Row[] = list.map((p) => {
    const i = items.get(p.id)!;
    return { id: p.id, group: i.link ?? i.person, label: short(workingText(i)) };
  });
  const apply = () => {
    setBusy('Stand wird gesichert, wird übernommen …');
    const put: Put[] = list
      .filter((p) => picks[p.id] === 'neu')
      .map((p) => {
        const i = study.latest().items[p.id] ?? items.get(p.id)!;
        const s = sets[p.id];
        return { coll: 'items' as const, id: p.id, data: { ...i, chips: s.chips, suggested: i.suggested.filter((c) => !s.chips.includes(c)), finding: s.finding, suggestedFinding: null, suggestedNewFinding: p.newFinding ?? i.suggestedNewFinding ?? null } };
      });
    void store(study, put, 'KI-Tags', `KI-Tags: ${put.length} Aussagen übernommen`)
      .then(() => onClose(`Tags für ${put.length} Aussagen übernommen.`))
      .catch((e) => setBusy(`Nicht übernommen: ${String((e as Error).message)}`));
  };
  if (!list.length) {
    queueMicrotask(() => onClose('KI: keine neuen Tags vorgeschlagen.'));
    return null;
  }
  return (
    <Shell
      title={`KI-Tags prüfen (${list.length} Aussagen)`}
      intro="Links die jetzigen Tags, rechts der Vorschlag der KI (neu hinzukommende hervorgehoben). Rechts lässt sich alles anpassen: × entfernt einen Tag, „+ Tag“ fügt einen hinzu, der Befund ist wählbar. Alle Vorschläge sind vorausgewählt; „Aktuell behalten“, wo nichts geändert werden soll."
      rows={rows}
      picks={picks}
      setPick={setPick}
      busy={busy}
      onCancel={() => onClose('KI-Tags verworfen: nichts übernommen.')}
      onApply={apply}
      render={(id) => {
        const i = items.get(id)!;
        const s = sets[id];
        const p = list.find((x) => x.id === id)!;
        const on = picks[id];
        const free = tags.filter((g) => g.chips.some((c) => !s.chips.includes(c.id)));
        return (
          <>
            <p className="st-pane-text st-tagrev-text" data-notr>
              {workingText(i)}
            </p>
            <div className="st-panes">
              <div className={`st-pane is-current${on === 'alt' ? ' is-chosen' : ' is-dropped'}`}>
                <div className="st-pane-head">Aktuell</div>
                <div className="st-tagrev">
                  {i.chips.length ? i.chips.map((c) => <span key={c} className="st-chip is-on is-small" title={groupOf(c)?.name}>{label(c)}</span>) : <span className="st-muted">keine Tags</span>}
                </div>
                <p className="st-muted st-tagrev-finding">{`Befund: ${i.finding ? (study.docs.findings[i.finding]?.name ?? '?') : '–'}`}</p>
              </div>
              <div className={`st-pane is-incoming${on === 'neu' ? ' is-chosen' : ' is-dropped'}`}>
                <div className="st-pane-head">Neu (bearbeitbar)</div>
                <div className="st-tagrev">
                  {s.chips.map((c) => (
                    <span key={c} className={`st-chip is-on is-small${i.chips.includes(c) ? '' : ' is-added'}`} title={groupOf(c)?.name}>
                      {label(c)}
                      <button type="button" className="st-chip-x" onClick={() => edit(id, (x) => ({ ...x, chips: x.chips.filter((y) => y !== c) }))} aria-label={`${label(c)} entfernen`}>
                        ×
                      </button>
                    </span>
                  ))}
                  {free.length > 0 && (
                    <select className="st-chip-add" value="" onChange={(e) => e.target.value && add(id, e.target.value)} aria-label="Tag hinzufügen">
                      <option value="">+ Tag</option>
                      {free.map((g) => (
                        <optgroup key={g.id} label={g.name}>
                          {g.chips
                            .filter((c) => !s.chips.includes(c.id))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </div>
                <label className="st-tagrev-finding">
                  <span className="st-muted">Befund</span>{' '}
                  <select value={s.finding ?? ''} onChange={(e) => edit(id, (x) => ({ ...x, finding: e.target.value || null }))} aria-label="Befund">
                    <option value="">–</option>
                    {findings.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                {p.newFinding && <p className="st-muted">{`Vorschlag neuer Befund: „${p.newFinding}“ (unter Wiederkehrende Befunde anlegen)`}</p>}
              </div>
            </div>
          </>
        );
      }}
    />
  );
}
