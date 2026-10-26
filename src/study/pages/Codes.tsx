// Qualitatives Feedback → Codes: per qualitative code how many statements
// and participants, split by design; a code + design filter lists the
// statements, next to the quantitative values linked to that code (in-game
// ratings, Teil 2 items, UEQ-S scales), so both can be read together.
import { useState } from 'react';
import type { Design, ItemDoc } from '../types';
import { distinctPersons, gameRatings, RATING_LABEL } from '../model';
import { part2, part2Single, part3 } from '../analysis';
import { describe, fmt } from '../stats';
import { itemText, useContentView, useSurveyText } from '../translations';
import { Empty, logChange, Section, useCtx } from '../ui';

export const designOfItem = (i: ItemDoc): Design | null => (i.chips.includes('variante-a') && !i.chips.includes('variante-b') ? 'A' : i.chips.includes('variante-b') && !i.chips.includes('variante-a') ? 'B' : null);

interface Measure {
  id: string;
  label: string;
  A: { m: number; n: number } | null;
  B: { m: number; n: number } | null;
  both?: { m: number; n: number } | null; // asked once for both designs
  scale: string;
}

// the default links: words in the code's name → measures whose name has related words
const DEFAULT_LINKS: Record<string, RegExp> = {
  kontrolle: /control|kontroll|influence|einfluss|rating:control/i,
  erwartung: /expect|erwart|imagin|match|rating:match/i,
  feedbackwirkung: /feedback|preference|präferenz|setting|einstellung|after|nachträg/i,
  verstaendlichkeit: /understand|verständ|clear|easy|ease|rating:ease|ueqs:pragmatisch/i,
  'verständlichkeit': /understand|verständ|clear|easy|ease|rating:ease|ueqs:pragmatisch/i,
  spielfluss: /flow|frustrat|rating:frustration|timing|moment/i,
  outputqualitaet: /result|ergebnis|quality|qualität|rating:match/i,
  'outputqualität': /result|ergebnis|quality|qualität|rating:match/i,
  positives: /overall|gesamt|enjoy|fun|spaß|rating:overall|ueqs:hedonisch/i,
};
const slug = (s: string) => s.toLowerCase().split(/\s+/)[0];

export default function Codes() {
  const { study, model, slice } = useCtx();
  const view = useContentView();
  const T = useSurveyText(study);
  const group = model.tags.find((g) => g.id === 'code');
  const [code, setCode] = useState<string>('');
  const [design, setDesign] = useState<'all' | Design | 'none'>('all');
  const [editLinks, setEditLinks] = useState(false);
  if (!group || !group.chips.length) return <Empty>Keine Code-Kategorie (unter „Tags“ eine Kategorie „Code“ anlegen).</Empty>;
  const total = slice.persons.length;
  const items = slice.items;
  const withCode = (c: string) => items.filter((i) => i.chips.includes(c));
  const byDesign = (list: ItemDoc[], d: Design | null) => list.filter((i) => designOfItem(i) === d);
  const current = code || group.chips[0].id;

  // the quantitative measures, per design
  const ratings = gameRatings(slice.feedback);
  const stat = (xs: number[]) => (xs.length ? { m: describe(xs).mean, n: xs.length } : null);
  const measures: Measure[] = [
    ...Object.entries(ratings).map(([q, v]) => ({ id: `rating:${q}`, label: `Bewertung im Spiel: ${RATING_LABEL[q] ?? q}`, A: stat(v.A), B: stat(v.B), scale: '1–5' })),
    ...part2(slice.survey).map((r) => ({ id: `likert:${r.item}`, label: `Teil 2: ${T(r.item)}`, A: r.A.n ? { m: r.A.mean, n: r.A.n } : null, B: r.B.n ? { m: r.B.mean, n: r.B.n } : null, scale: `1–${r.scale}` })),
    ...part2Single(slice.survey).map((r) => ({ id: `likert1:${r.item}`, label: `Teil 2: ${T(r.item)}`, A: null, B: null, both: r.stats.n ? { m: r.stats.mean, n: r.stats.n } : null, scale: `1–${r.scale}` })),
    ...(() => {
      const p3 = part3(slice.survey);
      const name = { pragmatisch: 'Pragmatische Qualität', hedonisch: 'Hedonische Qualität', gesamt: 'UEQ-S gesamt' } as const;
      return [
        ...(p3.answered ? p3.scales.map((s) => ({ id: `ueqs:${s.scale}`, label: `Teil 3: ${name[s.scale]}`, A: s.A.n ? { m: s.A.mean, n: s.A.n } : null, B: s.B.n ? { m: s.B.mean, n: s.B.n } : null, scale: '−3…+3' })) : []),
        ...(p3.overall ?? []).map((o) => ({ id: `ueqs:${o.scale}`, label: `Teil 3: ${name[o.scale]} (gesamt)`, A: null, B: null, both: o.v.n ? { m: o.v.mean, n: o.v.n } : null, scale: '−3…+3' })),
      ];
    })(),
  ];
  const stored = (study.docs.settings.codeLinks as Record<string, string[]> | undefined) ?? {};
  const linksOf = (chipId: string): string[] => {
    if (stored[chipId]) return stored[chipId];
    const label = group.chips.find((c) => c.id === chipId)?.label ?? '';
    const re = DEFAULT_LINKS[slug(label)] ?? DEFAULT_LINKS[chipId.replace(/^c-/, '')];
    return re ? measures.filter((m) => re.test(`${m.id} ${m.label}`)).map((m) => m.id) : [];
  };
  const setLinks = (chipId: string, ids: string[]) => {
    study.commit([{ coll: 'settings', id: 'codeLinks', data: { ...stored, [chipId]: ids } }]);
    logChange(study, `Code „${group.chips.find((c) => c.id === chipId)?.label}“: verknüpfte Messwerte geändert`);
  };

  const shown = withCode(current).filter((i) => design === 'all' || (design === 'none' ? designOfItem(i) == null : designOfItem(i) === design));
  const linked = measures.filter((m) => linksOf(current).includes(m.id));
  const cell = (v: { m: number; n: number } | null | undefined) => (v ? `${fmt(v.m)} (n = ${v.n})` : '–');

  return (
    <>
      <Section title="Codes nach Variante">
        <table className="st-table">
          <thead>
            <tr>
              <th>Code</th>
              <th className="num">Variante A</th>
              <th className="num">Variante B</th>
              <th className="num">ohne Variante</th>
              <th className="num">Teilnehmende</th>
            </tr>
          </thead>
          <tbody>
            {group.chips.map((c) => {
              const list = withCode(c.id);
              const fmtGroup = (l: ItemDoc[]) => (l.length ? `${l.length} (${distinctPersons(l)} TN)` : '–');
              return (
                <tr key={c.id} className={c.id === current ? 'is-picked' : ''} onClick={() => setCode(c.id)} style={{ cursor: 'pointer' }}>
                  <td>{c.label}</td>
                  <td className="num">{fmtGroup(byDesign(list, 'A'))}</td>
                  <td className="num">{fmtGroup(byDesign(list, 'B'))}</td>
                  <td className="num">{fmtGroup(byDesign(list, null))}</td>
                  <td className="num">
                    {distinctPersons(list)}/{total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="st-note">Aussagen (Teilnehmende). Die Variante einer Aussage ist ihr Tag „Variante A/B“. Nur bestätigte Tags zählen.</p>
      </Section>

      <Section title="Aussagen und Messwerte">
        <div className="st-toolbar">
          <select value={current} onChange={(e) => setCode(e.target.value)} aria-label="Code">
            {group.chips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select value={design} onChange={(e) => setDesign(e.target.value as typeof design)} aria-label="Variante">
            <option value="all">alle Varianten</option>
            <option value="A">Variante A</option>
            <option value="B">Variante B</option>
            <option value="none">ohne Variante</option>
          </select>
        </div>
        <div className="st-codes">
          <div>
            <h3>Aussagen ({shown.length})</h3>
            {shown.length ? (
              <ul className="st-list">
                {shown.map((i) => (
                  <li key={i.id}>
                    <span className="st-pid">
                      {i.link ?? i.person}
                      {designOfItem(i) ? ` · ${designOfItem(i)}` : ''}
                    </span>{' '}
                    <span data-notr>{itemText(view, i)}</span>
                    {i.interpretation && (
                      <span className="st-tags">
                        Interpretation: <span data-notr>{i.interpretation}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Keine.</Empty>
            )}
          </div>
          <div>
            <h3>Verknüpfte Messwerte</h3>
            {linked.length ? (
              <table className="st-table">
                <thead>
                  <tr>
                    <th>Messwert</th>
                    {design !== 'B' && <th className="num">A: M</th>}
                    {design !== 'A' && <th className="num">B: M</th>}
                  </tr>
                </thead>
                <tbody>
                  {linked.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.label} <span className="st-muted">({m.scale})</span>
                      </td>
                      {m.both !== undefined ? (
                        <td className="num" colSpan={design === 'all' || design === 'none' ? 2 : 1}>
                          beide: {cell(m.both)}
                        </td>
                      ) : (
                        <>
                          {design !== 'B' && <td className="num">{cell(m.A)}</td>}
                          {design !== 'A' && <td className="num">{cell(m.B)}</td>}
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>Keine Messwerte verknüpft.</Empty>
            )}
            <button type="button" className="st-linkbtn" onClick={() => setEditLinks((x) => !x)}>
              {editLinks ? 'fertig' : 'Verknüpfung bearbeiten'}
            </button>
            {editLinks && (
              <ul className="st-claimpick">
                {measures.map((m) => (
                  <li key={m.id}>
                    <label className="st-check">
                      <input
                        type="checkbox"
                        checked={linksOf(current).includes(m.id)}
                        onChange={(e) => setLinks(current, e.target.checked ? [...linksOf(current), m.id] : linksOf(current).filter((x) => x !== m.id))}
                      />
                      {m.label}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
