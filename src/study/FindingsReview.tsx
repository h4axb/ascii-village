// The AI's proposed recurring findings, checked before anything is stored:
// each proposal (name, objective description, its statements) can be edited,
// statements ticked off, whole proposals left out. Everything starts selected;
// "Jetzt übernehmen" saves the current state first, then the findings.
import { useEffect, useMemo, useState } from 'react';
import type { FindingDoc, ItemDoc } from './types';
import { SECTION_LABEL } from './types';
import type { Study } from './store';
import { logChange } from './ui';
import { findingsOf, withFinding } from './model';

export interface Proposal {
  name: string;
  description: string;
  ids: string[];
  finding: string | null; // an existing finding it adds to
}
interface Draft {
  on: boolean;
  name: string;
  description: string;
  members: Set<string>;
}
export const findingId = () => `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const personsOf = (items: ItemDoc[]) => [...new Set(items.map((i) => i.person))].sort();

export function FindingsReview({ study, proposals, items, text, onClose }: { study: Study; proposals: Proposal[]; items: Map<string, ItemDoc>; text: (i: ItemDoc) => string; onClose: (msg?: string) => void }) {
  const findings = study.docs.findings;
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    proposals.map((p) => {
      const old = p.finding ? findings[p.finding] : undefined;
      return { on: true, name: old?.name ?? p.name, description: old?.description || p.description, members: new Set(p.ids.filter((id) => items.has(id))) };
    }),
  );
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const toggle = (k: number, id: string) =>
    setDrafts((d) =>
      d.map((x, i) => {
        if (i !== k) return x;
        const members = new Set(x.members);
        if (members.has(id)) members.delete(id);
        else members.add(id);
        return { ...x, members };
      }),
    );
  const chosen = drafts.map((d, k) => ({ d, p: proposals[k], k })).filter(({ d }) => d.on && d.members.size && d.name.trim());
  const stmts = useMemo(() => proposals.map((p) => p.ids.map((id) => items.get(id)).filter((i): i is ItemDoc => !!i)), [proposals, items]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (review) setReview(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, review, onClose]);

  async function apply() {
    setBusy('Stand wird gesichert, Befunde werden übernommen …');
    try {
      await study.saveVersion('vor KI-Befunden');
      const put: Parameters<Study['commit']>[0] = [];
      for (const { d, p } of chosen) {
        const old: FindingDoc | undefined = p.finding ? study.latest().findings[p.finding] : undefined;
        const id = old?.id ?? findingId();
        const description = d.description.trim();
        put.push({ coll: 'findings', id, data: { ...(old ?? {}), id, name: d.name.trim(), description: description || undefined, descriptionAuto: description ? (old?.description === description ? old.descriptionAuto : description === p.description) : undefined, auto: old ? old.auto : true } satisfies FindingDoc });
        for (const iid of d.members) {
          const it = study.latest().items[iid];
          // (added to the findings it already has)
          if (it) put.push({ coll: 'items', id: iid, data: { ...withFinding(it, id), suggestedFinding: null, suggestedNewFinding: null } });
        }
      }
      study.commit(put);
      const n = chosen.reduce((a, { d }) => a + d.members.size, 0);
      logChange(study, `KI-Befunde übernommen: ${chosen.length} Befunde, ${n} Aussagen (${chosen.map(({ d }) => d.name.trim()).join('; ')})`);
      onClose(`${chosen.length} Befunde mit ${n} Aussagen übernommen.`);
    } catch (e) {
      setBusy(`Nicht übernommen: ${String((e as Error).message)}`);
    }
  }

  return (
    <div className="st-modal-back" role="presentation">
      <div className="st-modal" role="dialog" aria-modal="true" aria-label="KI-Befunde prüfen">
        <header className="st-modal-head">
          <h2>{review ? 'Bestätigen: KI-Befunde' : `KI-Befunde prüfen (${proposals.length} Vorschläge)`}</h2>
          <p className="st-muted">
            {review
              ? 'So wird es übernommen. „Zurück“ ändert die Auswahl; erst „Jetzt übernehmen“ speichert (der jetzige Stand wird vorher gesichert).'
              : 'Ähnliche Aussagen mehrerer Testpersonen, von der KI gebündelt. Alles ist vorausgewählt: Name und Beschreibung lassen sich bearbeiten, einzelne Aussagen oder ganze Befunde abwählen. Später bleibt alles unter „Wiederkehrende Befunde“ änderbar.'}
          </p>
          {!review && (
            <div className="st-modal-all">
              <button type="button" onClick={() => setDrafts((d) => d.map((x) => ({ ...x, on: true })))}>
                Alle auswählen
              </button>
              <button type="button" onClick={() => setDrafts((d) => d.map((x) => ({ ...x, on: false })))}>
                Alle abwählen
              </button>
            </div>
          )}
        </header>
        <div className="st-modal-body">
          {review ? (
            <div className="st-review">
              <section>
                <h3 className="is-applied">Wird übernommen ({chosen.length})</h3>
                {chosen.length ? (
                  <ul className="st-review-list">
                    {chosen.map(({ d, p, k }) => {
                      const ps = personsOf(stmts[k].filter((i) => d.members.has(i.id)));
                      return (
                        <li key={k} className="is-applied">
                          <strong data-notr>{d.name}</strong> <span className="st-muted">{p.finding ? '(ergänzt bestehenden Befund)' : '(neu)'}</span>
                          <ul>
                            <li>{`${ps.length} Testpersonen (${ps.join(', ')}) · ${d.members.size} Aussagen`}</li>
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="st-muted">nichts</p>
                )}
              </section>
              <section>
                <h3 className="is-stays">Nicht übernommen ({proposals.length - chosen.length})</h3>
                <p className="st-muted" data-notr>
                  {drafts.filter((d, k) => !chosen.some((c) => c.k === k)).map((d) => d.name).join(' · ') || 'nichts'}
                </p>
              </section>
            </div>
          ) : (
            drafts.map((d, k) => {
              const p = proposals[k];
              const members = stmts[k].filter((i) => d.members.has(i.id));
              const ps = personsOf(members);
              return (
                <section key={k} className={`st-change st-fprop${d.on ? '' : ' is-off'}`}>
                  <div className="st-change-head">
                    <label className="st-check">
                      <input type="checkbox" checked={d.on} onChange={(e) => set(k, { on: e.target.checked })} /> übernehmen
                    </label>
                    <span className={`st-badge${p.finding ? '' : ' is-conflict'}`}>{p.finding ? `ergänzt „${findings[p.finding]?.name}“` : 'neuer Befund'}</span>
                    <span className="st-muted">{`genannt von ${ps.length} ${ps.length === 1 ? 'Testperson' : 'Testpersonen'} (${ps.join(', ') || '–'}) · ${members.length} ${members.length === 1 ? 'Aussage' : 'Aussagen'}`}</span>
                  </div>
                  <label className="st-fprop-field">
                    <span className="st-cell-label">Name</span>
                    <input value={d.name} onChange={(e) => set(k, { name: e.target.value })} />
                  </label>
                  <label className="st-fprop-field">
                    <span className="st-cell-label">Beschreibung (sachlich)</span>
                    <textarea rows={3} value={d.description} onChange={(e) => set(k, { description: e.target.value })} />
                  </label>
                  <ul className="st-fstmts">
                    {stmts[k].map((i) => {
                      const other = findingsOf(i)
                        .filter((x) => x !== p.finding)
                        .map((x) => findings[x]?.name ?? '?')
                        .join('“, „');
                      return (
                        <li key={i.id} className={d.members.has(i.id) ? '' : 'is-off'}>
                          <label className="st-check">
                            <input type="checkbox" checked={d.members.has(i.id)} onChange={() => toggle(k, i.id)} aria-label={`${i.person}: Aussage einbeziehen`} />
                            <span className="st-pid">{i.link ?? i.person}</span>
                          </label>
                          <div>
                            <div className="st-muted st-fstmt-meta">
                              {SECTION_LABEL[i.section]}
                              {i.question ? ` · „${i.question}“` : ''}
                              {other ? <span className="st-flag">{`auch in „${other}“`}</span> : null}
                            </div>
                            <p data-notr>{text(i)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
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
              <button type="button" className="is-primary" onClick={() => void apply()} disabled={!!busy || !chosen.length}>
                Jetzt übernehmen
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => onClose()} disabled={!!busy}>
                Abbrechen
              </button>
              <button type="button" className="is-primary" onClick={() => setReview(true)} disabled={!!busy || !chosen.length}>
                {`${chosen.length} Befunde übernehmen …`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
