// The result statements (Ergebnisse), written from the analysis in neutral
// thesis wording, and the evidence rating of a hypothesis from the
// statements linked to it. The rule is shown next to every rating.
import type { Model, Slice } from './model';
import { craftStats, distinctPersons, gameRatings, RATING_LABEL } from './model';
import { part1, part2, part3 } from './analysis';
import { describe, fmt, fmtP, pct, wilcoxon } from './stats';
import { getLang, tr } from './i18n';
import type { Design, FindingDoc } from './types';

export interface Claim {
  id: string;
  method: 'Teil 1' | 'Teil 2' | 'Teil 3' | 'Spiel' | 'Notizen';
  text: string; // generated
  direction: Design | null; // the design the result favours
  p: number | null; // test p (null: descriptive)
  large: boolean; // a large effect (share ≥ 75 %, |r| ≥ ,5, or ≥ half of the participants)
  n: number;
}

const pText = (p: number) => (fmtP(p).startsWith('<') ? `p ${fmtP(p)}` : `p = ${fmtP(p)}`);
const other = (d: Design) => (d === 'A' ? 'B' : 'A');
// a question or item as the start of a sentence ("…angenehmer:")
const lead = (q: string) => q.replace(/[\s?:.]+$/, '');

export function buildClaims(m: Model, s: Slice, findings: Record<string, FindingDoc>): Claim[] {
  const out: Claim[] = [];
  const en = getLang() === 'en';
  const rows = s.survey;
  for (const r of part1(rows)) {
    if (!r.n) continue;
    out.push({
      id: `p1:${r.question}`,
      method: 'Teil 1',
      text: r.winner
        ? en
          ? `${lead(r.question)}: ${r.k} of ${r.decided} participants with a preference preferred variant ${r.winner} (${pct(r.share)}, 95% CI ${pct(r.ci[0])}–${pct(r.ci[1])}; exact sign test ${pText(r.p)}${r.neutral ? `; ${r.neutral} without a preference` : ''}).`
          : `${lead(r.question)}: ${r.k} von ${r.decided} Teilnehmenden mit Präferenz bevorzugten Variante ${r.winner} (${pct(r.share)}, 95 %-KI ${pct(r.ci[0])}–${pct(r.ci[1])}; exakter Vorzeichentest ${pText(r.p)}${r.neutral ? `; ${r.neutral} ohne Präferenz` : ''}).`
        : en
          ? `${lead(r.question)}: no majority (A ${r.A}, B ${r.B}, no preference ${r.neutral}).`
          : `${lead(r.question)}: keine Mehrheit (A ${r.A}, B ${r.B}, ohne Präferenz ${r.neutral}).`,
      direction: r.winner,
      p: r.decided ? r.p : null,
      large: r.share >= 0.75,
      n: r.decided,
    });
  }
  for (const r of part2(rows)) {
    if (!r.pairs) continue;
    const d: Design | null = r.test.r > 0 ? 'B' : r.test.r < 0 ? 'A' : null;
    out.push({
      id: `p2:${r.item}`,
      method: 'Teil 2',
      text: `${lead(r.item)}: Median A ${fmt(r.A.median, 1)} (IQR ${fmt(r.A.q1, 1)}–${fmt(r.A.q3, 1)}), B ${fmt(r.B.median, 1)} (IQR ${fmt(r.B.q1, 1)}–${fmt(r.B.q3, 1)}); ${en ? 'Wilcoxon test' : 'Wilcoxon-Test'} ${pText(r.test.p)}, r = ${fmt(r.test.r)} (n = ${r.pairs}).`,
      direction: d,
      p: r.test.p,
      large: Math.abs(r.test.r) >= 0.5,
      n: r.pairs,
    });
  }
  const p3 = part3(rows);
  if (p3.answered)
    for (const sc of p3.scales) {
      const d: Design | null = sc.test.r > 0 ? 'B' : sc.test.r < 0 ? 'A' : null;
      const name = (en ? { pragmatisch: 'Pragmatic quality', hedonisch: 'Hedonic quality', gesamt: 'UEQ-S overall' } : { pragmatisch: 'Pragmatische Qualität', hedonisch: 'Hedonische Qualität', gesamt: 'UEQ-S gesamt' })[sc.scale];
      out.push({
        id: `p3:${sc.scale}`,
        method: 'Teil 3',
        text: `${name}: A M = ${fmt(sc.A.mean)} (${tr(sc.A.bench)}), B M = ${fmt(sc.B.mean)} (${tr(sc.B.bench)}); ${en ? 'Wilcoxon test' : 'Wilcoxon-Test'} ${pText(sc.test.p)}, r = ${fmt(sc.test.r)}.`,
        direction: d,
        p: sc.test.p,
        large: Math.abs(sc.test.r) >= 0.5,
        n: sc.test.n + sc.test.zeros,
      });
    }
  // in-game ratings: per person means per design, paired
  const ratings = gameRatings(s.feedback);
  for (const [q, v] of Object.entries(ratings)) {
    const persons = s.persons.map((p) => p.id);
    const pairs = persons
      .map((id) => {
        const of = (d: Design) => s.feedback.filter((r) => r.participant === id && r.rating && typeof r.rating[q] === 'number' && (d === 'A' ? r.cond === 'pre' : r.cond === 'post')).map((r) => r.rating![q] as number);
        const a = of('A');
        const b = of('B');
        return a.length && b.length ? [describe(a).mean, describe(b).mean] : null;
      })
      .filter((x): x is number[] => !!x);
    const t = wilcoxon(
      pairs.map((p) => p[1]),
      pairs.map((p) => p[0]),
    );
    // (frustration: lower is better)
    const better = q === 'frustration' ? -t.r : t.r;
    out.push({
      id: `g:${q}`,
      method: 'Spiel',
      text: `${en ? 'In-game rating' : 'Bewertung im Spiel'} – ${tr(RATING_LABEL[q] ?? q)}: A M = ${fmt(describe(v.A).mean)}, B M = ${fmt(describe(v.B).mean)}${pairs.length ? `; ${en ? 'Wilcoxon test' : 'Wilcoxon-Test'} ${pText(t.p)}, r = ${fmt(t.r)} (n = ${pairs.length})` : ''}.`,
      direction: better > 0 ? 'B' : better < 0 ? 'A' : null,
      p: pairs.length ? t.p : null,
      large: Math.abs(t.r) >= 0.5,
      n: pairs.length,
    });
  }
  const cs = craftStats(s.events, s.feedback);
  const shareUp = (x: { up: number; down: number }) => (x.up + x.down ? x.up / (x.up + x.down) : NaN);
  if (cs.A.up + cs.A.down + cs.B.up + cs.B.down) {
    const a = shareUp(cs.A);
    const b = shareUp(cs.B);
    out.push({
      id: 'g:votes',
      method: 'Spiel',
      text: en
        ? `Rating of the results: "fits" in A ${pct(a)} (${cs.A.up}/${cs.A.up + cs.A.down}), in B ${pct(b)} (${cs.B.up}/${cs.B.up + cs.B.down}); descriptive.`
        : `Bewertung der Ergebnisse: „Passt“ in A ${pct(a)} (${cs.A.up}/${cs.A.up + cs.A.down}), in B ${pct(b)} (${cs.B.up}/${cs.B.up + cs.B.down}); deskriptiv.`,
      direction: a > b ? 'A' : b > a ? 'B' : null,
      p: null,
      large: Math.abs(a - b) >= 0.25,
      n: cs.A.up + cs.A.down + cs.B.up + cs.B.down,
    });
  }
  // recurring findings
  const total = m.included.length;
  for (const f of Object.values(findings)) {
    const items = s.items.filter((i) => i.finding === f.id);
    const n = distinctPersons(items);
    if (!n) continue;
    const designs = new Set(items.flatMap((i) => i.chips.filter((c) => c === 'variante-a' || c === 'variante-b')));
    out.push({
      id: `f:${f.id}`,
      method: 'Notizen',
      text: en ? `${f.name}: raised by ${n} of the ${total} participants (${pct(n / total)}).` : `${f.name}: von ${n} der ${total} Teilnehmenden geäußert (${pct(n / total)}).`,
      direction: designs.size === 1 ? (designs.has('variante-a') ? 'A' : 'B') : null,
      p: null,
      large: n / total >= 0.5,
      n,
    });
  }
  return out;
}

export type Rating = 'stark' | 'mittel' | 'schwach' | 'nicht gestützt' | 'widersprochen';
export const ratingRule = () => (getLang() === 'en' ? RATING_RULE_EN : RATING_RULE);
const RATING_RULE_EN = [
  'strong: at least one significant result (p < .05) in the expected direction, agreement in at least two methods, no result in the opposite direction',
  'medium: one significant result, or large effects in at least two methods in the expected direction, no significant opposite result',
  'weak: results mostly in the expected direction, but neither significant nor large',
  'not supported: no results in the expected direction, or mixed directions',
  'contradicted: a significant result in the opposite direction',
];
export const RATING_RULE = [
  'stark: mindestens ein signifikantes Ergebnis (p < ,05) in erwarteter Richtung, Übereinstimmung in mindestens zwei Methoden, kein Ergebnis in Gegenrichtung',
  'mittel: ein signifikantes Ergebnis oder große Effekte in mindestens zwei Methoden in erwarteter Richtung, kein signifikantes Gegenergebnis',
  'schwach: Ergebnisse überwiegend in erwarteter Richtung, aber weder signifikant noch groß',
  'nicht gestützt: keine Ergebnisse in erwarteter Richtung, oder Richtung uneinheitlich',
  'widersprochen: ein signifikantes Ergebnis in Gegenrichtung',
];
// qualitative-only hypotheses (no expected design): the findings' reach
export function rate(claims: Claim[], expect: Design | null | undefined): { rating: Rating; why: string } {
  const en = getLang() === 'en';
  if (!claims.length) return { rating: 'nicht gestützt', why: en ? 'no linked results' : 'keine verknüpften Ergebnisse' };
  if (!expect) {
    const big = claims.filter((c) => c.large).length;
    const methods = new Set(claims.map((c) => c.method)).size;
    const rating: Rating = big && methods >= 2 ? 'stark' : big ? 'mittel' : 'schwach';
    return { rating, why: en ? `${big} of ${claims.length} results with a large reach/effect, ${methods} method(s)` : `${big} von ${claims.length} Ergebnissen mit großer Reichweite/großem Effekt, ${methods} Methode(n)` };
  }
  const pro = claims.filter((c) => c.direction === expect);
  const contra = claims.filter((c) => c.direction === other(expect));
  const sigPro = pro.filter((c) => c.p != null && c.p < 0.05);
  const sigContra = contra.filter((c) => c.p != null && c.p < 0.05);
  const methodsPro = new Set(pro.map((c) => c.method)).size;
  const largeMethods = new Set(pro.filter((c) => c.large).map((c) => c.method)).size;
  const why = en
    ? `${pro.length} of ${claims.length} in the expected direction (${sigPro.length} significant), ${contra.length} in the opposite direction (${sigContra.length} significant), ${methodsPro} method(s)`
    : `${pro.length} von ${claims.length} in erwarteter Richtung (${sigPro.length} signifikant), ${contra.length} in Gegenrichtung (${sigContra.length} signifikant), ${methodsPro} Methode(n)`;
  if (sigContra.length) return { rating: 'widersprochen', why };
  if (sigPro.length && methodsPro >= 2 && !contra.length) return { rating: 'stark', why };
  if (sigPro.length || largeMethods >= 2) return { rating: 'mittel', why };
  if (pro.length > contra.length) return { rating: 'schwach', why };
  return { rating: 'nicht gestützt', why };
}
