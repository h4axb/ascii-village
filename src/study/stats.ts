// The statistics behind /feedback, written out so every number can be
// checked: small-sample methods (n = 12), exact where it matters.
//
// Sources for the methods:
//   Wilson interval: Wilson (1927); exact binomial (sign) test; exact
//   Wilcoxon signed-rank test (zero differences dropped, tied ranks
//   averaged, exact null distribution over the actual ranks) with the
//   matched-pairs rank-biserial correlation (Kerby 2014) as effect size;
//   Cronbach's α; UEQ-S scales and benchmark (Schrepp, Hinderks &
//   Thomaschewski 2017).

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
// sample standard deviation (n − 1)
export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}
export const variance = (xs: number[]) => sd(xs) ** 2;
// quantile, linear interpolation between order statistics (R type 7)
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? s[lo]) - s[lo]);
}
export const median = (xs: number[]) => quantile(xs, 0.5);
export const iqr = (xs: number[]) => [quantile(xs, 0.25), quantile(xs, 0.75)] as const;

export interface Describe {
  n: number;
  mean: number;
  sd: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
}
export function describe(xs: number[]): Describe {
  const v = xs.filter((x) => Number.isFinite(x));
  return {
    n: v.length,
    mean: mean(v),
    sd: sd(v),
    median: median(v),
    q1: quantile(v, 0.25),
    q3: quantile(v, 0.75),
    min: v.length ? Math.min(...v) : NaN,
    max: v.length ? Math.max(...v) : NaN,
  };
}

// two-sided 97.5 % quantiles of Student's t (df 1–30), for 95 % intervals
const T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const t975 = (df: number) => (df >= 1 && df <= 30 ? T975[Math.round(df)] : 1.96);
// 95 % interval of a mean (t distribution)
export function meanCI(xs: number[]): [number, number] {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length < 2) return [NaN, NaN];
  const h = (t975(v.length - 1) * sd(v)) / Math.sqrt(v.length);
  return [mean(v) - h, mean(v) + h];
}

// Wilson score interval for a proportion k/n (95 %)
export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (!n) return [NaN, NaN];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
export const binomPmf = (k: number, n: number, p = 0.5) => Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
// exact two-sided binomial test (p = .5: the sign test), doubling the smaller tail
export function binomTest(k: number, n: number): number {
  if (!n) return NaN;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i <= n; i++) {
    const pr = binomPmf(i, n);
    if (i <= k) lo += pr;
    if (i >= k) hi += pr;
  }
  return Math.min(1, 2 * Math.min(lo, hi));
}
// the fewest of n that must agree for a two-sided sign test p < alpha
export function signTestThreshold(n: number, alpha = 0.05): number | null {
  for (let k = Math.ceil(n / 2); k <= n; k++) if (binomTest(k, n) < alpha) return k;
  return null;
}

export interface Wilcoxon {
  n: number; // pairs with a non-zero difference
  zeros: number; // pairs left out (no difference)
  wPlus: number;
  wMinus: number;
  p: number; // exact, two-sided
  r: number; // matched-pairs rank-biserial correlation (Kerby 2014), −1…1
}
// exact Wilcoxon signed-rank test for paired x, y (x − y)
export function wilcoxon(x: number[], y: number[]): Wilcoxon {
  const d = x.map((v, i) => v - y[i]).filter((v) => Number.isFinite(v));
  const nz = d.filter((v) => v !== 0);
  const zeros = d.length - nz.length;
  const n = nz.length;
  if (!n) return { n, zeros, wPlus: 0, wMinus: 0, p: 1, r: 0 };
  // average ranks of |d|
  const order = nz.map((v, i) => ({ a: Math.abs(v), i })).sort((p, q) => p.a - q.a);
  const ranks = new Array<number>(n);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && order[j + 1].a === order[i].a) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[order[k].i] = r;
    i = j + 1;
  }
  const wPlus = sum(nz.map((v, i) => (v > 0 ? ranks[i] : 0)));
  const total = (n * (n + 1)) / 2;
  const wMinus = total - wPlus;
  // exact null distribution of W+ over all 2^n sign patterns (ranks ×2: integers)
  const r2 = ranks.map((r) => Math.round(r * 2));
  const max = sum(r2);
  let dist = new Float64Array(max + 1);
  dist[0] = 1;
  for (const r of r2) {
    const next = new Float64Array(max + 1);
    for (let s = 0; s <= max; s++) {
      if (!dist[s]) continue;
      next[s] += dist[s];
      if (s + r <= max) next[s + r] += dist[s];
    }
    dist = next;
  }
  const all = 2 ** n;
  const w = Math.round(wPlus * 2);
  let lo = 0;
  let hi = 0;
  for (let s = 0; s <= max; s++) {
    if (s <= w) lo += dist[s];
    if (s >= w) hi += dist[s];
  }
  return { n, zeros, wPlus, wMinus, p: Math.min(1, (2 * Math.min(lo, hi)) / all), r: (wPlus - wMinus) / total };
}

// Cronbach's α: rows = participants, columns = items (complete rows only)
export function cronbachAlpha(rows: number[][]): number {
  const full = rows.filter((r) => r.length && r.every((v) => Number.isFinite(v)));
  const k = full[0]?.length ?? 0;
  if (full.length < 2 || k < 2) return NaN;
  const itemVar = sum(Array.from({ length: k }, (_, j) => variance(full.map((r) => r[j]))));
  const totalVar = variance(full.map((r) => sum(r)));
  return totalVar ? (k / (k - 1)) * (1 - itemVar / totalVar) : NaN;
}

// ---- UEQ-S ----
// 8 items on a 7-point scale, answered 1…7 with the negative pole on the left
// (a reversed item is flipped first); scored −3…+3. Items 1–4 pragmatic,
// 5–8 hedonic quality.
export const UEQS_ITEMS: [string, string][] = [
  ['behindernd', 'unterstützend'],
  ['kompliziert', 'einfach'],
  ['ineffizient', 'effizient'],
  ['verwirrend', 'übersichtlich'],
  ['langweilig', 'spannend'],
  ['uninteressant', 'interessant'],
  ['konventionell', 'originell'],
  ['herkömmlich', 'neuartig'],
];
export const ueqsScore = (answer: number, reversed = false) => (reversed ? 8 - answer : answer) - 4;
export type UeqScale = 'pragmatisch' | 'hedonisch' | 'gesamt';
export const UEQS_SCALE_ITEMS: Record<UeqScale, number[]> = { pragmatisch: [0, 1, 2, 3], hedonisch: [4, 5, 6, 7], gesamt: [0, 1, 2, 3, 4, 5, 6, 7] };
// benchmark category boundaries (lower limits): exzellent, gut, überdurchschnittlich, unterdurchschnittlich; below: schlecht
export const UEQS_BENCHMARK: Record<UeqScale, [number, number, number, number]> = {
  pragmatisch: [1.73, 1.55, 1.25, 0.73],
  hedonisch: [1.55, 1.25, 0.88, 0.4],
  gesamt: [1.58, 1.39, 1.05, 0.59],
};
export function ueqsBenchmark(scale: UeqScale, value: number): string {
  if (!Number.isFinite(value)) return '–';
  const [ex, good, above, below] = UEQS_BENCHMARK[scale];
  return value >= ex ? 'exzellent' : value >= good ? 'gut' : value >= above ? 'überdurchschnittlich' : value >= below ? 'unterdurchschnittlich' : 'schlecht';
}

// ---- what a sample of n can show ----
// smallest standardized effect (Cohen's d_z) a two-sided paired test can
// detect with 80 % power at α = .05 (normal approximation with t quantile)
export const detectableEffect = (n: number) => (n > 1 ? (t975(n - 1) + 0.8416) / Math.sqrt(n) : NaN);

// ---- formatting (German, APA-like) ----
// (English: decimal point and "12%"; set by i18n.ts)
let EN_NUMBERS = false;
export const setNumberLang = (l: 'de' | 'en') => {
  EN_NUMBERS = l === 'en';
};
const dec = (t: string) => (EN_NUMBERS ? t : t.replace('.', ','));
export const fmt = (x: number, digits = 2) => (Number.isFinite(x) ? dec(x.toFixed(digits)) : '–');
export const fmtP = (p: number) => (!Number.isFinite(p) ? '–' : p < 0.001 ? (EN_NUMBERS ? '< .001' : '< ,001') : fmt(p, 3).replace(/^0/, '').replace(/^-0/, '-'));
export const pct = (x: number, digits = 0) => (Number.isFinite(x) ? `${dec((x * 100).toFixed(digits))}${EN_NUMBERS ? '%' : ' %'}` : '–');
