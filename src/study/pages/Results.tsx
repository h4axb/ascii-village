// Ergebnisse & Export: the result statements (editable), hypotheses with
// their interpretation and evidence rating, the study frame (what n can
// show), the figures and their captions, and the exports for the thesis.
// Names from the notes never leave the Notizen page: no export carries them.
import { useState } from 'react';
import type { HypothesisDoc, Design } from '../types';
import { buildClaims, rate, ratingRule, type Claim } from '../claims';
import { getLang } from '../i18n';
import { analysisExport, rawExport } from '../exports';
import { download } from '../charts';
import { detectableEffect, fmt, fmtP, signTestThreshold, wilson } from '../stats';
import { findingsOf } from '../model';
import { csv, Empty, figNumber, FIGURES, LazyInput, Section, useCtx } from '../ui';
import { studyFiles, zip } from '../../feedback/studyExport';

export default function Results() {
  const { model, slice, study } = useCtx();
  const claims = buildClaims(model, slice, study.docs.findings);
  // edited result texts per language (the English one under id.en)
  const cid = (c: Claim) => (getLang() === 'en' ? `${c.id}.en` : c.id);
  const text = (c: Claim) => (study.docs.claims[cid(c)] as { text?: string } | undefined)?.text ?? c.text;
  const hyps = Object.values(study.docs.hypotheses).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const saveH = (h: HypothesisDoc) => study.commit([{ coll: 'hypotheses', id: h.id, data: h }]);
  const nAll = model.included.length;
  const groups = { AB: model.included.filter((p) => p.group === 'AB').length, BA: model.included.filter((p) => p.group === 'BA').length };
  const k = signTestThreshold(nAll);
  const halfCI = nAll ? (wilson(Math.round(nAll / 2), nAll)[1] - wilson(Math.round(nAll / 2), nAll)[0]) / 2 : NaN;
  const dl = (rows: (string | number | null | undefined)[][], name: string) => download(new Blob(['\uFEFF' + csv(rows)], { type: 'text/csv;charset=utf-8' }), name);

  return (
    <>
      <Section title="Ergebnisse">
        {claims.length ? (
          <table className="st-table st-claims">
            <thead>
              <tr>
                <th>Methode</th>
                <th>Ergebnis</th>
                <th>Richtung</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>{c.method}</td>
                  <td>
                    <ClaimText value={text(c)} generated={c.text} onSave={(t) => (t === c.text ? study.commit([], [{ coll: 'claims', id: cid(c) }]) : study.commit([{ coll: 'claims', id: cid(c), data: { text: t } }]))} />
                  </td>
                  <td>{c.direction ? `${c.direction}${c.p != null && c.p < 0.05 ? ' *' : ''}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Noch keine Ergebnisse (Umfrage, Spiel-Tracking oder Befunde).</Empty>
        )}
        <p className="st-note">* p &lt; ,05. Die Texte werden aus den aktuellen Daten erzeugt; eine Bearbeitung bleibt bestehen, bis sie zurückgesetzt wird.</p>
      </Section>

      <Section title="Hypothesen und Evidenzbewertung">
        {hyps.map((h) => {
          const linked = claims.filter((c) => h.claims.includes(c.id));
          const r = rate(linked, h.expect);
          return (
            <article key={h.id} className="st-hyp">
              <header className="st-notes-head">
                <LazyInput className="st-groupname" value={h.text} onSave={(t) => saveH({ ...h, text: t })} aria-label="Hypothese" />
                <select value={h.expect ?? ''} onChange={(e) => saveH({ ...h, expect: (e.target.value || null) as Design | null })} aria-label="Erwartete Richtung">
                  <option value="">ohne Richtung (qualitativ)</option>
                  <option value="A">erwartet: A besser</option>
                  <option value="B">erwartet: B besser</option>
                </select>
                <span className={`st-rating is-${r.rating.replace(' ', '-')}`}>{r.rating}</span>
                <button type="button" onClick={() => confirm('Hypothese löschen?') && study.commit([], [{ coll: 'hypotheses', id: h.id }])}>
                  Löschen
                </button>
              </header>
              <p className="st-note">{r.why}</p>
              <details className="st-details" open={!h.claims.length}>
                <summary>Verknüpfte Ergebnisse ({linked.length})</summary>
                <ul className="st-claimpick">
                  {claims.map((c) => (
                    <li key={c.id}>
                      <label className="st-check">
                        <input type="checkbox" checked={h.claims.includes(c.id)} onChange={(e) => saveH({ ...h, claims: e.target.checked ? [...h.claims, c.id] : h.claims.filter((x) => x !== c.id) })} />
                        <span className="st-muted">{c.method}</span> {text(c)}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
              <label className="st-wide">
                Interpretation
                <NoteArea value={h.note ?? ''} onSave={(note) => saveH({ ...h, note })} />
              </label>
            </article>
          );
        })}
        <div className="st-toolbar">
          <button
            type="button"
            onClick={() => {
              const id = `h-${Date.now().toString(36)}`;
              saveH({ id, text: `H${hyps.length + 1}: `, claims: [], expect: null, order: hyps.length });
            }}
          >
            + Hypothese
          </button>
        </div>
        <ul className="st-rules">
          {ratingRule().map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Section>

      <Section title="Aussagekraft des Usertests">
        <table className="st-table st-kv">
          <tbody>
            <tr>
              <th>Design</th>
              <td>Within-Subject, zwei Varianten (A: Vorab-Klärung, B: Nachträgliche Reflexion), Reihenfolge ausbalanciert (AB/BA)</td>
            </tr>
            <tr>
              <th>Stichprobe</th>
              <td>
                n = {nAll} ({groups.AB} AB, {groups.BA} BA)
              </td>
            </tr>
            <tr>
              <th>Vorzeichentest (α = ,05)</th>
              <td>{k ? `signifikant ab ${k} von ${nAll} gleichgerichteten Urteilen` : 'mit dieser Stichprobe nicht erreichbar'}</td>
            </tr>
            <tr>
              <th>Kleinstes p (Wilcoxon)</th>
              <td>{nAll ? `${fmtP(2 / 2 ** nAll)} (alle ${nAll} Differenzen gleichgerichtet)` : '–'}</td>
            </tr>
            <tr>
              <th>Breite des 95 %-KI</th>
              <td>{Number.isFinite(halfCI) ? `± ${Math.round(halfCI * 100)} Prozentpunkte bei einem Anteil von 50 %` : '–'}</td>
            </tr>
            <tr>
              <th>Nachweisbarer Effekt</th>
              <td>{nAll > 1 ? `d_z ≥ ${fmt(detectableEffect(nAll))} (gepaarter Test, Power ,80, α = ,05)` : '–'}</td>
            </tr>
            <tr>
              <th>Aussagekraft</th>
              <td>Explorativ: große Effekte und wiederkehrende Probleme sind erkennbar, kleine und mittlere Unterschiede nicht abgesichert.</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Abbildungen">
        <table className="st-table">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Abbildung</th>
              <th>Bildunterschrift</th>
            </tr>
          </thead>
          <tbody>
            {FIGURES.map((f) => {
              const stored = (study.docs.captions[f.id] as { caption?: string } | undefined)?.caption;
              return (
                <tr key={f.id}>
                  <td className="num">{figNumber(f.id)}</td>
                  <td>{f.title}</td>
                  <td>
                    <LazyInput value={stored ?? f.caption} onSave={(c) => study.commit([{ coll: 'captions', id: f.id, data: { caption: c } }])} aria-label={`Bildunterschrift ${f.title}`} />
                    {stored != null && stored !== f.caption && (
                      <button type="button" onClick={() => study.commit([], [{ coll: 'captions', id: f.id }])}>
                        Zurücksetzen
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="st-toolbar">
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(FIGURES.map((f) => `Abbildung ${figNumber(f.id)}: ${(study.docs.captions[f.id] as { caption?: string } | undefined)?.caption ?? f.caption}`).join('\n'))
            }
          >
            Alle Bildunterschriften kopieren
          </button>
        </div>
        <p className="st-note">PNG-Export und Bearbeitung an jeder Abbildung; Unterabbildungen (z. B. 4.1) folgen der Nummer ihrer Abbildung.</p>
      </Section>

      <Section title="Exporte">
        <div className="st-exports">
          <button type="button" onClick={() => download(rawExport(study.docs, study.game), 'Rohdaten.zip')} title="Originale unverändert: Notizen (ohne Namen), Aussagen im ersten Wortlaut, Tally-Export, Spiel-Tracking">
            Rohdaten (ZIP)
          </button>
          <button type="button" onClick={() => download(analysisExport(study.docs, model), 'Analyse.zip')} title="Deutsche Fassungen, Interpretationen, Codes, Befunde und die Messwerte je Teilnehmer">
            Analyse (ZIP)
          </button>
          <button type="button" onClick={() => dl([['Methode', 'Ergebnis', 'Richtung', 'p', 'n'], ...claims.map((c) => [c.method, text(c), c.direction ?? '', c.p == null ? '' : fmtP(c.p), c.n])], 'Ergebnisse.csv')}>
            Ergebnisse (CSV)
          </button>
          <button
            type="button"
            onClick={() =>
              dl(
                [
                  ['Hypothese', 'Erwartung', 'Bewertung', 'Begründung', 'Interpretation', 'Ergebnisse'],
                  ...hyps.map((h) => {
                    const linked = claims.filter((c) => h.claims.includes(c.id));
                    const r = rate(linked, h.expect);
                    return [h.text, h.expect ?? '', r.rating, r.why, h.note ?? '', linked.map(text).join(' | ')];
                  }),
                ],
                'Hypothesen.csv',
              )
            }
          >
            Hypothesen (CSV)
          </button>
          <button
            type="button"
            onClick={() =>
              dl(
                [
                  ['Teilnehmende', 'Link', 'Abschnitt', 'Frage', 'Aussage', 'Tags', 'Befund', 'geprüft'],
                  ...model.items.map((i) => [i.person, i.link ?? '', i.section, i.question ?? '', i.text, i.chips.map((c) => model.chipLabel.get(c)).join(', '), findingsOf(i).map((f) => study.docs.findings[f]?.name ?? '').filter(Boolean).join('; '), i.confirmed ? 'ja' : 'nein']),
                ],
                'Aussagen.csv',
              )
            }
          >
            Aussagen, codiert (CSV)
          </button>
          <button
            type="button"
            onClick={() =>
              dl(
                [
                  ['Teilnehmende', 'Gruppe', 'Datum', 'Dauer (min)', 'Links', 'ausgeschlossen', 'Grund', 'Teil 1 vertauscht', 'Teil 1 von Hand'],
                  ...model.persons.map((p) => [p.id, p.group ?? '', p.date ? new Date(p.date).toISOString().slice(0, 10) : '', p.minutes == null ? '' : fmt(p.minutes, 1), p.links.map((l) => l.label).join(' '), p.excluded ? 'ja' : '', p.doc.reason ?? '', p.doc.swapP1 ? 'ja' : '', Object.keys(p.doc.p1 ?? {}).join('; ')]),
                ],
                'Teilnehmende.csv',
              )
            }
          >
            Teilnehmende (CSV)
          </button>
          <button
            type="button"
            onClick={() => {
              // everything, pseudonymised: the names from the notes left out
              const { notesMeta, ...settings } = study.docs.settings as Record<string, unknown>;
              const meta = Object.fromEntries(Object.entries((notesMeta ?? {}) as Record<string, Record<string, unknown>>).map(([id, m]) => [id, { ...m, name: undefined }]));
              const { notes: _raw, ...docs } = study.docs;
              const files = [
                { name: 'studie.json', text: JSON.stringify({ exportedAt: new Date().toISOString(), ...docs, settings: { ...settings, notesMeta: meta } }, null, 1) },
                ...studyFiles(study.game.events, study.game.feedback, study.game.invites).map((f) => ({ ...f, name: `spiel/${f.name}` })),
              ];
              download(zip(files), 'Studie.zip');
            }}
          >
            Gesamtdaten (ZIP, pseudonymisiert)
          </button>
        </div>
      </Section>
    </>
  );
}

function ClaimText({ value, generated, onSave }: { value: string; generated: string; onSave: (t: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!edit)
    return (
      <span className="st-claim" onDoubleClick={() => (setDraft(value), setEdit(true))} title="Doppelklick: bearbeiten">
        <span data-notr>{value}</span>
        {value !== generated && <span className="st-flag"> bearbeitet</span>}
      </span>
    );
  return (
    <span className="st-claim-edit">
      <textarea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => (setEdit(false), draft !== value && onSave(draft))} />
      {value !== generated && (
        <button type="button" onMouseDown={(e) => (e.preventDefault(), setEdit(false), onSave(generated))}>
          Zurücksetzen
        </button>
      )}
    </span>
  );
}

function NoteArea({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  return <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} />;
}
