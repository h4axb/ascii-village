// Wiederkehrende Befunde: findings with their statements and how many of
// the participants named them. The AI bundles similar statements of several
// participants into proposals (checked in FindingsReview before storing);
// every finding stays editable here: name, objective description, and its
// statements (taken out, or added by search). Findings can be merged, deleted.
import { useState } from 'react';
import type { FindingDoc, ItemDoc } from '../types';
import { SECTION_LABEL } from '../types';
import { Bars } from '../charts';
import { distinctPersons, findingsOf, setFindings, withFinding, withoutFinding, type Slice } from '../model';
import { csv, Empty, Fig, LazyArea, logChange, useCtx } from '../ui';
import { itemText, useContentView } from '../translations';
import { FindingsReview, findingId, type Proposal } from '../FindingsReview';

const personsOf = (items: ItemDoc[]) => [...new Set(items.map((i) => i.person))].sort();

export default function Findings() {
  const { study, model, slice } = useCtx();
  const view = useContentView();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const total = model.included.length;
  const findings = Object.values(study.docs.findings);
  const live = model.allItems.filter((i) => i.status !== 'removed');
  const members = (f: FindingDoc) => slice.items.filter((i) => findingsOf(i).includes(f.id));
  const proposed = (f: FindingDoc) => live.filter((i) => i.suggestedFinding === f.id && !findingsOf(i).includes(f.id));
  const rows = findings.map((f) => ({ f, items: members(f), persons: distinctPersons(members(f)) })).sort((a, b) => b.persons - a.persons || a.f.name.localeCompare(b.f.name));
  // (the figure's own slice: the participants left out there are not counted)
  const rowsOf = (s: Slice) => rows.map((r) => ({ ...r, items: r.items.filter((i) => s.persons.some((p) => p.id === i.person)) })).map((r) => ({ ...r, persons: distinctPersons(r.items) }));
  const save = (put: ItemDoc[]) => study.commit(put.map((p) => ({ coll: 'items' as const, id: p.id, data: p })));
  const saveFinding = (f: FindingDoc) => study.commit([{ coll: 'findings', id: f.id, data: f }]);

  // the AI's proposed new findings (from the tag suggestions), grouped by name
  const fresh = new Map<string, ItemDoc[]>();
  for (const i of live) if (i.suggestedNewFinding) fresh.set(i.suggestedNewFinding.trim(), [...(fresh.get(i.suggestedNewFinding.trim()) ?? []), i]);

  const create = (n: string, items: ItemDoc[] = []) => {
    const id = findingId();
    study.commit([
      { coll: 'findings', id, data: { id, name: n } },
      // its statements become proposals, still to be confirmed
      ...items.map((i) => ({ coll: 'items' as const, id: i.id, data: { ...i, suggestedFinding: id, suggestedNewFinding: null } })),
    ]);
  };

  // AI: similar statements of several participants → proposals to check
  async function bundle() {
    setBusy('KI bündelt ähnliche Aussagen …');
    try {
      const items = model.items.map((i) => ({ id: i.id, person: i.person, text: i.de || i.text, section: SECTION_LABEL[i.section], question: i.question }));
      const groups = await study.cluster({ items, findings: findings.map((f) => ({ id: f.id, name: f.name, description: f.description })) });
      setBusy(groups.length ? null : 'KI: keine wiederkehrenden Aussagen gefunden.');
      if (groups.length) setProposals(groups);
    } catch (e) {
      setBusy(`KI nicht verfügbar: ${String((e as Error).message)}`);
    }
  }

  return (
    <>
      {proposals && (
        <FindingsReview
          study={study}
          proposals={proposals}
          items={new Map(model.allItems.map((i) => [i.id, i]))}
          text={(i) => itemText(view, i)}
          onClose={(msg) => {
            setProposals(null);
            setBusy(msg ?? null);
          }}
        />
      )}
      <p className="st-note st-page-hint">Ein Befund bündelt Aussagen, die bei mehreren Testpersonen wiederkehren. Er zählt, wie viele verschiedene Testpersonen ihn genannt haben.</p>
      <div className="st-toolbar">
        <button
          type="button"
          className="is-primary"
          disabled={!!busy?.endsWith('…') || model.items.length < 2}
          onClick={() => void bundle()}
          title={'Die KI sucht Aussagen, die bei mindestens zwei Testpersonen dasselbe sagen, und fasst sie zu Befunden mit sachlicher Beschreibung zusammen. Du prüfst und bearbeitest alles im Fenster, bevor etwas gespeichert wird.\nBeispiel: P001 „Crafting-Menü verwirrend“ + P004 „Crafting schwer zu finden“ → Befund „Crafting-Menü schwer auffindbar“ (2 Testpersonen).'}
        >
          KI: ähnliche Aussagen bündeln …
        </button>
        <span className="st-selbar-gap" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neuer Befund (Name)" onKeyDown={(e) => e.key === 'Enter' && name.trim() && (create(name.trim()), setName(''))} />
        <button type="button" disabled={!name.trim()} onClick={() => (create(name.trim()), setName(''))}>
          Anlegen
        </button>
      </div>
      {busy && <p className="st-note">{busy}</p>}

      {fresh.size > 0 && (
        <details className="st-section st-fresh">
          <summary>{`Einzelne Vorschläge aus den Tag-Vorschlägen (${fresh.size})`}</summary>
          <ul className="st-list">
            {[...fresh].map(([n, items]) => (
              <li key={n}>
                <strong data-notr>{n}</strong> <span className="st-muted">{items.map((i) => i.person).join(', ')}</span>{' '}
                <button type="button" onClick={() => create(n, items)}>
                  Anlegen
                </button>
                <button type="button" onClick={() => save(items.map((i) => ({ ...i, suggestedNewFinding: null })))}>
                  Verwerfen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {rows.some((r) => r.persons) && (
        <Fig id="befunde" valid={(s) => personsOf(rowsOf(s).flatMap((r) => r.items)).length} table={(s) => csv([['Befund', 'Beschreibung', 'Teilnehmende', 'IDs', 'Aussagen'], ...rowsOf(s).map((r) => [r.f.name, r.f.description ?? '', r.persons, personsOf(r.items).join(' '), r.items.length])])}>
          {(s) => <Bars rows={rowsOf(s).filter((r) => r.persons).map((r) => ({ label: r.f.name, values: [r.persons], note: `${r.persons}/${s.persons.length}` }))} max={s.persons.length} />}
        </Fig>
      )}

      {!rows.length && <Empty>Noch keine Befunde. „KI: ähnliche Aussagen bündeln“ schlägt welche vor; oder oben von Hand anlegen.</Empty>}
      {rows.map(({ f, items, persons }) => (
        <FindingCard key={f.id} f={f} items={items} persons={persons} total={total} proposed={proposed(f)} findings={findings} live={live} save={save} saveFinding={saveFinding} />
      ))}
    </>
  );
}

function FindingCard({
  f,
  items,
  persons,
  total,
  proposed,
  findings,
  live,
  save,
  saveFinding,
}: {
  f: FindingDoc;
  items: ItemDoc[];
  persons: number;
  total: number;
  proposed: ItemDoc[];
  findings: FindingDoc[];
  live: ItemDoc[];
  save: (put: ItemDoc[]) => void;
  saveFinding: (f: FindingDoc) => void;
}) {
  const { study, model } = useCtx();
  const view = useContentView();
  const [q, setQ] = useState('');
  const ids = personsOf(items);
  // statements that could be added: not in this finding, found by text or ID
  const hits = q.trim()
    ? model.items
        .filter((i) => !findingsOf(i).includes(f.id) && `${i.person} ${i.link ?? ''} ${i.text} ${i.de ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
        .slice(0, 12)
    : [];
  const add = (i: ItemDoc) => {
    // (a statement can belong to several findings: it stays in its others)
    save([withFinding(i, f.id)]);
    logChange(study, `Befund „${f.name}“: Aussage von ${i.person} hinzugefügt`);
  };
  const takeOut = (i: ItemDoc) => {
    save([withoutFinding(i, f.id)]);
    logChange(study, `Befund „${f.name}“: Aussage von ${i.person} entfernt`);
  };
  return (
    <details className="st-section st-finding" data-anchor={`f-${f.id}`}>
      <summary>
        <span className="st-finding-name" data-notr>
          {f.name}
        </span>
        <span className="st-muted">{`${persons} von ${total} Testpersonen · ${items.length} Aussagen`}</span>
        <span className="st-finding-ids">
          {ids.map((p) => (
            <span key={p} className="st-pid">
              {p}
            </span>
          ))}
        </span>
      </summary>
      <div className="st-finding-body">
        <label className="st-fprop-field">
          <span className="st-cell-label">Name</span>
          <input defaultValue={f.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && saveFinding({ ...f, name: e.target.value.trim() })} aria-label="Name des Befunds" />
        </label>
        <label className="st-fprop-field">
          <span className="st-cell-label">
            Beschreibung (sachlich) {f.description && f.descriptionAuto && <span className="st-badge">KI-Entwurf</span>}
          </span>
          <LazyArea value={f.description ?? ''} onSave={(v) => saveFinding({ ...f, description: v.trim() || undefined, descriptionAuto: false })} placeholder="Was bei mehreren Testpersonen beobachtet wurde, sachlich formuliert …" />
        </label>
        <p className="st-finding-count">
          <strong>{`Genannt von ${persons} von ${total} Testpersonen`}</strong>
          {ids.length ? `: ${ids.join(', ')}` : ''} · {items.length} Aussagen
        </p>
        <ul className="st-fstmts">
          {items.map((i) => (
            <li key={i.id}>
              <span className="st-pid">{i.link ?? i.person}</span>
              <div>
                <div className="st-muted st-fstmt-meta">
                  {SECTION_LABEL[i.section]}
                  {i.question ? ` · „${i.question}“` : ''}
                </div>
                <p data-notr>{itemText(view, i)}</p>
              </div>
              <button type="button" onClick={() => takeOut(i)} title="Aus diesem Befund nehmen (die Aussage bleibt erhalten)">
                Entfernen
              </button>
            </li>
          ))}
          {proposed.map((i) => (
            <li key={i.id} className="is-suggested">
              <span className="st-pid">{i.link ?? i.person}</span>
              <div>
                <div className="st-muted st-fstmt-meta">Vorschlag · {SECTION_LABEL[i.section]}</div>
                <p data-notr>{itemText(view, i)}</p>
              </div>
              <span className="st-inline">
                <button type="button" onClick={() => save([withFinding(i, f.id)])}>
                  Zuordnen
                </button>
                <button type="button" onClick={() => save([{ ...i, suggestedFinding: null }])}>
                  Verwerfen
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="st-finding-add">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Aussage hinzufügen: suchen nach Text oder ID (z. B. P004)" aria-label="Aussage hinzufügen" />
          {hits.length > 0 && (
            <ul className="st-fhits">
              {hits.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => add(i)}>
                    <span className="st-pid">{i.link ?? i.person}</span> <span data-notr>{itemText(view, i)}</span>
                    {findingsOf(i).length > 0 && <span className="st-flag">{`auch in „${findingsOf(i).map((x) => study.docs.findings[x]?.name ?? '?').join('“, „')}“`}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim() && !hits.length && <p className="st-muted">Keine passende Aussage.</p>}
        </div>
        <div className="st-toolbar st-finding-more">
          <select
            value=""
            aria-label="Zusammenführen mit"
            onChange={(e) => {
              const into = e.target.value;
              if (!into) return;
              const moved = live.filter((i) => findingsOf(i).includes(f.id) || i.suggestedFinding === f.id).map((i) => ({ ...setFindings(i, findingsOf(i).map((x) => (x === f.id ? into : x))), suggestedFinding: i.suggestedFinding === f.id ? into : i.suggestedFinding }));
              study.commit(moved.map((i) => ({ coll: 'items' as const, id: i.id, data: i })), [{ coll: 'findings', id: f.id }]);
              logChange(study, `Befund „${f.name}“ zusammengeführt mit „${study.docs.findings[into]?.name}“`);
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
              const freed = live.filter((i) => findingsOf(i).includes(f.id) || i.suggestedFinding === f.id).map((i) => ({ ...withoutFinding(i, f.id), suggestedFinding: i.suggestedFinding === f.id ? null : i.suggestedFinding }));
              study.commit(freed.map((i) => ({ coll: 'items' as const, id: i.id, data: i })), [{ coll: 'findings', id: f.id }]);
              logChange(study, `Befund „${f.name}“ gelöscht`);
            }}
          >
            Befund löschen
          </button>
        </div>
      </div>
    </details>
  );
}
