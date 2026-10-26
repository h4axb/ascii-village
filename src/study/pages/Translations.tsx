// Daten & Validierung → Übersetzungen: every German version next to its
// original, editable; AI drafts marked "automatisch" until edited or
// accepted. The originals (notes and survey answers) are never changed.
import { useState } from 'react';
import type { ItemDoc, TranslationMemory } from '../types';
import { memoryOf, tallyTexts, translateNotes, translateTally } from '../translations';
import { LazyArea, logChange, Section, useCtx } from '../ui';

type Filter = 'all' | 'open' | 'missing';

export default function Translations() {
  const { study, model } = useCtx();
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const tally = study.docs.tally.main;
  const mem = memoryOf(study);
  const texts = tally ? tallyTexts(tally) : [];
  const items = model.allItems.filter((i) => i.status !== 'removed');

  const stateOf = (de: string | undefined, auto: boolean | undefined, stale?: boolean) => (!de ? 'missing' : auto || stale ? 'open' : 'done');
  const keep = (st: string) => filter === 'all' || (filter === 'missing' ? st === 'missing' : st !== 'done');
  const counts = {
    tally: { missing: texts.filter((t) => !mem[t]).length, auto: texts.filter((t) => mem[t]?.auto).length },
    notes: { missing: items.filter((i) => !i.de).length, auto: items.filter((i) => i.de && (i.deAuto || i.deStale)).length },
  };

  const saveTally = (orig: string, de: string) => {
    const next: TranslationMemory = { ...memoryOf(study) };
    if (de.trim()) next[orig] = { de: de.trim(), auto: false };
    else delete next[orig];
    study.commit([{ coll: 'tally', id: 'tr', data: next }]);
  };
  const acceptTally = (orig: string) => {
    const next: TranslationMemory = { ...memoryOf(study) };
    if (next[orig]) next[orig] = { ...next[orig], auto: false };
    study.commit([{ coll: 'tally', id: 'tr', data: next }]);
  };
  const saveItem = (i: ItemDoc, de: string) => study.commit([{ coll: 'items', id: i.id, data: { ...i, de: de.trim() || undefined, deAuto: false, deStale: false } }]);

  async function run() {
    setBusy('Übersetzen …');
    try {
      const a = await translateTally(study, (d, n) => setBusy(`Umfrage: ${d} von ${n} …`));
      const b = await translateNotes(study, undefined, (d, n) => setBusy(`Notizen: ${d} von ${n} …`));
      setBusy(`${a + b} Texte übersetzt (automatisch, bitte prüfen).`);
      if (a + b) logChange(study, `Übersetzungen erstellt: ${a} Umfragetexte, ${b} Aussagen`);
    } catch (e) {
      setBusy(`Übersetzung nicht verfügbar: ${String((e as Error).message)}`);
    }
  }

  return (
    <Section title="Übersetzungen">
      <div className="st-toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Anzeige">
          <option value="open">zu prüfen (automatisch / fehlend)</option>
          <option value="missing">nur fehlende</option>
          <option value="all">alle</option>
        </select>
        <button type="button" disabled={!!busy?.endsWith('…')} onClick={() => void run()}>
          Fehlende Übersetzungen erstellen
        </button>
        {busy && <span className="st-muted">{busy}</span>}
      </div>
      <p className="st-note">
        Umfrage: {texts.length} Texte, {counts.tally.missing} ohne, {counts.tally.auto} automatisch · Notizen: {items.length} Aussagen, {counts.notes.missing} ohne, {counts.notes.auto} automatisch. Das Original bleibt immer unverändert; die Antworten
        der Umfrage werden nicht übersetzt, nur ihre Texte angezeigt.
      </p>

      {texts.length > 0 && (
        <details className="st-details" open>
          <summary>Umfrage (Fragen, Antwortoptionen, Freitexte)</summary>
          <table className="st-table st-trtable">
            <thead>
              <tr>
                <th>Original</th>
                <th>Deutsch</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {texts
                .filter((t) => keep(stateOf(mem[t]?.de, mem[t]?.auto)))
                .map((t) => (
                  <tr key={t}>
                    <td data-notr>{t}</td>
                    <td>
                      <LazyArea value={mem[t]?.de ?? ''} onSave={(v) => saveTally(t, v)} placeholder="Deutsche Fassung" />
                    </td>
                    <td>
                      {mem[t]?.auto && (
                        <>
                          <span className="st-badge">automatisch</span>{' '}
                          <button type="button" className="st-linkbtn" onClick={() => acceptTally(t)}>
                            übernehmen
                          </button>
                        </>
                      )}
                      {!mem[t] && <span className="st-flag">fehlt</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}

      {items.length > 0 && (
        <details className="st-details" open>
          <summary>Notizen (Aussagen)</summary>
          <table className="st-table st-trtable">
            <thead>
              <tr>
                <th>TN</th>
                <th>Original</th>
                <th>Deutsch</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items
                .filter((i) => keep(stateOf(i.de, i.deAuto, i.deStale)))
                .map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="st-pid">{i.link ?? i.person}</span>
                    </td>
                    <td data-notr>{i.text}</td>
                    <td>
                      <LazyArea value={i.de ?? ''} onSave={(v) => saveItem(i, v)} placeholder="Deutsche Fassung" />
                    </td>
                    <td>
                      {i.de && i.deAuto && <span className="st-badge">automatisch</span>}
                      {i.deStale && <span className="st-flag"> Original geändert</span>}
                      {i.de && (i.deAuto || i.deStale) && (
                        <>
                          {' '}
                          <button type="button" className="st-linkbtn" onClick={() => study.commit([{ coll: 'items', id: i.id, data: { ...i, deAuto: false, deStale: false } }])}>
                            übernehmen
                          </button>
                        </>
                      )}
                      {!i.de && <span className="st-flag">fehlt</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
    </Section>
  );
}
