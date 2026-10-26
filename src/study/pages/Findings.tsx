// Wiederkehrende Befunde: findings with their statements and how many of
// the participants named them. The AI proposes members and new findings;
// only confirmed members count. Findings can be renamed, merged, deleted.
import { useState } from 'react';
import type { FindingDoc, ItemDoc } from '../types';
import { Bars } from '../charts';
import { distinctPersons } from '../model';
import { csv, Empty, Fig, Section, useCtx } from '../ui';

const slugId = () => `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export default function Findings() {
  const { study, model, slice } = useCtx();
  const [name, setName] = useState('');
  const total = model.included.length;
  const findings = Object.values(study.docs.findings);
  const live = model.allItems.filter((i) => i.status !== 'removed');
  const members = (f: FindingDoc) => slice.items.filter((i) => i.finding === f.id);
  const proposed = (f: FindingDoc) => live.filter((i) => i.suggestedFinding === f.id && i.finding !== f.id);
  const rows = findings.map((f) => ({ f, items: members(f), persons: distinctPersons(members(f)) })).sort((a, b) => b.persons - a.persons || a.f.name.localeCompare(b.f.name));
  const save = (put: ItemDoc[]) => study.commit(put.map((p) => ({ coll: 'items' as const, id: p.id, data: p })));

  // the AI's proposed new findings, grouped by name
  const fresh = new Map<string, ItemDoc[]>();
  for (const i of live) if (i.suggestedNewFinding && !i.finding) fresh.set(i.suggestedNewFinding.trim(), [...(fresh.get(i.suggestedNewFinding.trim()) ?? []), i]);

  const create = (n: string, items: ItemDoc[] = []) => {
    const id = slugId();
    study.commit([
      { coll: 'findings', id, data: { id, name: n } },
      // its statements become proposals, still to be confirmed
      ...items.map((i) => ({ coll: 'items' as const, id: i.id, data: { ...i, suggestedFinding: id, suggestedNewFinding: null } })),
    ]);
  };

  return (
    <>
      <div className="st-toolbar">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neuer Befund" onKeyDown={(e) => e.key === 'Enter' && name.trim() && (create(name.trim()), setName(''))} />
        <button type="button" disabled={!name.trim()} onClick={() => (create(name.trim()), setName(''))}>
          Anlegen
        </button>
      </div>

      {fresh.size > 0 && (
        <Section title="Vorgeschlagene Befunde">
          <ul className="st-list">
            {[...fresh].map(([n, items]) => (
              <li key={n}>
                <strong>{n}</strong> <span className="st-muted">{items.map((i) => i.person).join(', ')}</span>{' '}
                <button type="button" onClick={() => create(n, items)}>
                  Anlegen
                </button>
                <button type="button" onClick={() => save(items.map((i) => ({ ...i, suggestedNewFinding: null })))}>
                  Verwerfen
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {rows.some((r) => r.persons) && (
        <Fig id="befunde" table={() => csv([['Befund', 'Teilnehmende', 'Aussagen'], ...rows.map((r) => [r.f.name, r.persons, r.items.length])])}>
          <Bars rows={rows.filter((r) => r.persons).map((r) => ({ label: r.f.name, values: [r.persons], note: `${r.persons}/${total}` }))} max={total} />
        </Fig>
      )}

      {!rows.length && <Empty>Noch keine Befunde. Befunde entstehen aus den Aussagen (Spalte „Befund“) oder hier.</Empty>}
      {rows.map(({ f, items, persons }) => {
        const prop = proposed(f);
        return (
          <section key={f.id} className="st-section st-finding">
            <header className="st-notes-head">
              <input className="st-groupname" defaultValue={f.name} onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && study.commit([{ coll: 'findings', id: f.id, data: { ...f, name: e.target.value.trim() } }])} aria-label="Name des Befunds" />
              <span className="st-muted">
                {persons}/{total} Teilnehmende · {items.length} Aussagen
              </span>
              <select
                value=""
                aria-label="Zusammenführen mit"
                onChange={(e) => {
                  const into = e.target.value;
                  if (!into) return;
                  const moved = live.filter((i) => i.finding === f.id || i.suggestedFinding === f.id).map((i) => ({ ...i, finding: i.finding === f.id ? into : i.finding, suggestedFinding: i.suggestedFinding === f.id ? into : i.suggestedFinding }));
                  study.commit(moved.map((i) => ({ coll: 'items' as const, id: i.id, data: i })), [{ coll: 'findings', id: f.id }]);
                }}
              >
                <option value="">Zusammenführen mit …</option>
                {findings
                  .filter((x) => x.id !== f.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`Befund „${f.name}“ löschen? Die Aussagen bleiben erhalten.`)) return;
                  const freed = live.filter((i) => i.finding === f.id || i.suggestedFinding === f.id).map((i) => ({ ...i, finding: i.finding === f.id ? null : i.finding, suggestedFinding: i.suggestedFinding === f.id ? null : i.suggestedFinding }));
                  study.commit(freed.map((i) => ({ coll: 'items' as const, id: i.id, data: i })), [{ coll: 'findings', id: f.id }]);
                }}
              >
                Löschen
              </button>
            </header>
            <ul className="st-list">
              {items.map((i) => (
                <li key={i.id}>
                  <span className="st-pid">{i.link ?? i.person}</span> {i.text}{' '}
                  <button type="button" title="Aus dem Befund lösen (Teilen)" onClick={() => save([{ ...i, finding: null }])}>
                    Lösen
                  </button>
                </li>
              ))}
              {prop.map((i) => (
                <li key={i.id} className="is-suggested">
                  <span className="st-pid">{i.link ?? i.person}</span> {i.text}{' '}
                  <button type="button" onClick={() => save([{ ...i, finding: f.id, suggestedFinding: null }])}>
                    Zuordnen
                  </button>
                  <button type="button" onClick={() => save([{ ...i, suggestedFinding: null }])}>
                    Verwerfen
                  </button>
                </li>
              ))}
            </ul>
            {prop.length > 1 && (
              <button type="button" onClick={() => save(prop.map((i) => ({ ...i, finding: f.id, suggestedFinding: null })))}>
                Alle {prop.length} Vorschläge zuordnen
              </button>
            )}
          </section>
        );
      })}
    </>
  );
}
