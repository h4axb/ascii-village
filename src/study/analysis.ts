// The survey's evaluation per method (Teil 1–4), from the corrected rows of
// the model. The Umfrage page, the Übersicht and the claims all read these.
import type { SurveyRow } from './model';
import type { Design } from './types';
import { binomTest, cronbachAlpha, describe, mean, meanCI, ueqsBenchmark, UEQS_SCALE_ITEMS, wilcoxon, wilson, type Describe, type UeqScale, type Wilcoxon } from './stats';

export interface P1Result {
  question: string;
  A: number;
  B: number;
  neutral: number;
  n: number; // answered
  decided: number; // A + B
  winner: Design | null;
  k: number; // the winner's count
  share: number; // k / decided
  ci: [number, number]; // Wilson, of share
  p: number; // exact sign test over the decided answers
  swapped: number; // corrected rows among the answers
}
export function part1(rows: SurveyRow[]): P1Result[] {
  const qs = [...new Set(rows.flatMap((r) => Object.keys(r.p1)))];
  return qs.map((question) => {
    const ans = rows.map((r) => r.p1[question]).filter((a) => a != null);
    const A = ans.filter((a) => a === 'A').length;
    const B = ans.filter((a) => a === 'B').length;
    const neutral = ans.filter((a) => a === 'neutral').length;
    const decided = A + B;
    const winner: Design | null = A > B ? 'A' : B > A ? 'B' : null;
    const k = Math.max(A, B);
    return {
      question,
      A,
      B,
      neutral,
      n: ans.length,
      decided,
      winner,
      k,
      share: decided ? k / decided : NaN,
      ci: wilson(k, decided),
      p: binomTest(k, decided),
      swapped: rows.filter((r) => r.swapped && r.p1[question] != null).length,
    };
  });
}

export interface P2Result {
  item: string;
  scale: number; // points (5 or 7)
  A: Describe;
  B: Describe;
  countsA: number[];
  countsB: number[];
  pairs: number;
  test: Wilcoxon; // B − A
}
export function part2(rows: SurveyRow[]): P2Result[] {
  const items = [...new Set(rows.flatMap((r) => Object.keys(r.likert)))];
  const maxV = Math.max(5, ...rows.flatMap((r) => Object.values(r.likert).flatMap((v) => [v.A ?? 0, v.B ?? 0])));
  const scale = maxV > 5 ? 7 : 5;
  return items.map((item) => {
    const a = rows.map((r) => r.likert[item]?.A ?? null);
    const b = rows.map((r) => r.likert[item]?.B ?? null);
    const pairs = a.map((v, i) => [v, b[i]] as const).filter(([x, y]) => x != null && y != null) as [number, number][];
    const counts = (xs: (number | null)[]) => Array.from({ length: scale }, (_, i) => xs.filter((v) => v === i + 1).length);
    return {
      item,
      scale,
      A: describe(a.filter((v): v is number => v != null)),
      B: describe(b.filter((v): v is number => v != null)),
      countsA: counts(a),
      countsB: counts(b),
      pairs: pairs.length,
      test: wilcoxon(
        pairs.map((p) => p[1]),
        pairs.map((p) => p[0]),
      ),
    };
  });
}

// Teil 2 statements about both designs (asked once): described only
export interface P2Single {
  item: string;
  scale: number;
  stats: Describe;
  counts: number[];
}
export function part2Single(rows: SurveyRow[]): P2Single[] {
  const items = [...new Set(rows.flatMap((r) => Object.keys(r.likertSingle)))];
  const maxV = Math.max(5, ...rows.flatMap((r) => Object.values(r.likertSingle).map((v) => v ?? 0)));
  const scale = maxV > 5 ? 7 : 5;
  return items.map((item) => {
    const xs = rows.map((r) => r.likertSingle[item]).filter((v): v is number => v != null);
    return { item, scale, stats: describe(xs), counts: Array.from({ length: scale }, (_, i) => xs.filter((v) => v === i + 1).length) };
  });
}

export interface UeqScaleResult {
  scale: UeqScale;
  A: { mean: number; ci: [number, number]; sd: number; n: number; alpha: number; bench: string };
  B: { mean: number; ci: [number, number]; sd: number; n: number; alpha: number; bench: string };
  test: Wilcoxon; // B − A, per person scale scores
}
export interface UeqSide {
  mean: number;
  ci: [number, number];
  sd: number;
  n: number;
  alpha: number;
  bench: string;
}
export interface P3Result {
  answered: boolean; // per design (A and B)
  overall: { scale: UeqScale; v: UeqSide }[] | null; // one UEQ-S for the whole game
  overallItems: number[];
  scales: UeqScaleResult[];
  items: { item: number; A: number; B: number }[];
}
// scores −3…+3 (the rows hold 1…7 with reversals already applied)
const score = (v: number | null) => (v == null ? null : v - 4);
export function part3(rows: SurveyRow[]): P3Result {
  const answered = rows.some((r) => [...r.ueqs.A, ...r.ueqs.B].some((v) => v != null));
  const per = (d: Design | 'O', idx: number[]) =>
    rows.map((r) => {
      const v = idx.map((i) => score(r.ueqs[d][i])).filter((x): x is number => x != null);
      return v.length === idx.length ? mean(v) : null; // complete scales only
    });
  const scales = (Object.keys(UEQS_SCALE_ITEMS) as UeqScale[]).map((scale) => {
    const idx = UEQS_SCALE_ITEMS[scale];
    const side = (d: Design | 'O'): UeqSide => {
      const xs = per(d, idx).filter((x): x is number => x != null);
      const m = mean(xs);
      return {
        mean: m,
        ci: meanCI(xs),
        sd: describe(xs).sd,
        n: xs.length,
        alpha: cronbachAlpha(rows.map((r) => idx.map((i) => score(r.ueqs[d][i]) ?? NaN))),
        bench: ueqsBenchmark(scale, m),
      };
    };
    const a = per('A', idx);
    const b = per('B', idx);
    const both = a.map((x, i) => [x, b[i]] as const).filter(([x, y]) => x != null && y != null) as [number, number][];
    return {
      scale,
      A: side('A'),
      B: side('B'),
      test: wilcoxon(
        both.map((p) => p[1]),
        both.map((p) => p[0]),
      ),
    };
  });
  const items = Array.from({ length: 8 }, (_, item) => ({
    item,
    A: mean(rows.map((r) => score(r.ueqs.A[item])).filter((x): x is number => x != null)),
    B: mean(rows.map((r) => score(r.ueqs.B[item])).filter((x): x is number => x != null)),
  }));
  const hasO = rows.some((r) => r.ueqs.O.some((v) => v != null));
  const overall = hasO
    ? (Object.keys(UEQS_SCALE_ITEMS) as UeqScale[]).map((scale) => {
        const idx = UEQS_SCALE_ITEMS[scale];
        const xs = per('O', idx).filter((x): x is number => x != null);
        const m = mean(xs);
        return { scale, v: { mean: m, ci: meanCI(xs), sd: describe(xs).sd, n: xs.length, alpha: cronbachAlpha(rows.map((r) => idx.map((i) => score(r.ueqs.O[i]) ?? NaN))), bench: ueqsBenchmark(scale, m) } };
      })
    : null;
  const overallItems = Array.from({ length: 8 }, (_, item) => mean(rows.map((r) => score(r.ueqs.O[item])).filter((x): x is number => x != null)));
  return { answered, scales, items, overall, overallItems };
}

export interface P4Field {
  label: string;
  numeric: boolean;
  counts: [string, number][];
  stats: Describe | null;
  n: number;
}
export function part4(rows: SurveyRow[]): P4Field[] {
  const labels = [...new Set(rows.flatMap((r) => Object.keys(r.info)))];
  return labels.map((label) => {
    const vals = rows.map((r) => r.info[label]).filter((v): v is string => !!v);
    const nums = vals.map((v) => Number(v.replace(',', '.')));
    const numeric = vals.length > 0 && nums.every((x) => Number.isFinite(x));
    const counts = new Map<string, number>();
    // (a multi-choice answer "a, b" counts for each)
    for (const v of vals) for (const part of numeric ? [v] : v.split(/\s*,\s*(?=[A-ZÄÖÜ])/)) counts.set(part, (counts.get(part) ?? 0) + 1);
    return {
      label,
      numeric,
      counts: [...counts].sort((a, b) => (numeric ? Number(a[0]) - Number(b[0]) : b[1] - a[1])),
      stats: numeric ? describe(nums) : null,
      n: vals.length,
    };
  });
}
