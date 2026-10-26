// The /feedback statistics against known values.
//   npx vite-node scripts/test-study-stats.mjs
const s = await import('../src/study/stats.ts');
let fails = 0;
const near = (name, got, want, tol = 1e-3) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got} (want ${want})`);
};
// exact binomial: 9 of 12 → two-sided p = 0.14600 ; 10 of 12 → 0.03857
near('binom 9/12', s.binomTest(9, 12), 0.146, 1e-4);
near('binom 10/12', s.binomTest(10, 12), 0.03857, 1e-4);
near('binom 6/12', s.binomTest(6, 12), 1, 1e-9);
near('sign threshold n=12', s.signTestThreshold(12), 10, 0);
// Wilson 95 % for 9/12: 0.4677 – 0.9111
const [lo, hi] = s.wilson(9, 12);
near('wilson lo 9/12', lo, 0.4677, 1e-3);
near('wilson hi 9/12', hi, 0.9111, 1e-3);
// Wilcoxon: x = 125,115,130,140,140,115,140,125,140,135 vs y = 110,122,125,120,140,124,123,137,135,145
// (classic example: 1 zero dropped, n = 9, W+ = 27, W- = 18, exact two-sided p = 0.6523 (R wilcox.test exact with ties approx 0.633); we check W)
const w = s.wilcoxon([125, 115, 130, 140, 140, 115, 140, 125, 140, 135], [110, 122, 125, 120, 140, 124, 123, 137, 135, 145]);
near('wilcoxon n', w.n, 9, 0);
near('wilcoxon W+', w.wPlus, 27, 0);
near('wilcoxon W-', w.wMinus, 18, 0);
// no ties: d = 1..8 all positive → W+ = 36, exact p = 2/256 = 0.0078125
near('wilcoxon all positive p', s.wilcoxon([1, 2, 3, 4, 5, 6, 7, 8], [0, 0, 0, 0, 0, 0, 0, 0]).p, 0.0078125, 1e-9);
near('wilcoxon r all positive', s.wilcoxon([1, 2, 3], [0, 0, 0]).r, 1, 1e-9);
// n = 6 distinct ranks, W+ = 3 → P(W+ <= 3) = 5/64, two-sided 0.15625
near('wilcoxon n6 W+=3 p', s.wilcoxon([1, 2, -3, -4, -5, -6], [0, 0, 0, 0, 0, 0]).p, 0.15625, 1e-9);
// Cronbach's α: items perfectly parallel → 1 ; textbook data α = 0.8
near('alpha parallel', s.cronbachAlpha([[1, 1], [2, 2], [3, 3], [4, 4]]), 1, 1e-9);
// (by hand: item variances 1.3 each, total 9.3 → 1.5 × (1 − 3.9/9.3) = 0.8710)
near('alpha example', s.cronbachAlpha([[3, 4, 3], [4, 4, 5], [2, 3, 2], [5, 5, 4], [3, 2, 3]]), 0.871, 1e-3);
// describe
const d = s.describe([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
near('mean', d.mean, 6.5);
near('sd', d.sd, 3.6056, 1e-4);
near('median', d.median, 6.5);
near('q1 (type 7)', d.q1, 3.75);
// UEQ-S
near('ueqs 7 → +3', s.ueqsScore(7), 3, 0);
near('ueqs reversed 7 → -3', s.ueqsScore(7, true), -3, 0);
console.log(s.ueqsBenchmark('pragmatisch', 1.6), s.ueqsBenchmark('hedonisch', 0.2));
near('mean CI n=12 width', s.meanCI([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])[1] - 6.5, (2.201 * 3.6056) / Math.sqrt(12), 1e-3);
near('detectable d n=12', s.detectableEffect(12), 0.878, 5e-3);
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
