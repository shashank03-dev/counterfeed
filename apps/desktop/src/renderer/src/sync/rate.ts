import { fft, nextPow2 } from './fft';

/**
 * Breathing rate (breaths/min) from a band-passed trace: the strongest spectral peak in 5-40 br/min,
 * refined by parabolic interpolation. Used for both people identically so the Results compare like with like.
 * NaN unless at least 30 s of signal is present.
 */
export function estimateRate(filtered: ArrayLike<number>, fs: number): number {
  const vals: number[] = [];
  for (let i = 0; i < filtered.length; i++) if (Number.isFinite(filtered[i]!)) vals.push(filtered[i]!);
  if (vals.length < 30 * fs) return NaN;
  const n = nextPow2(vals.length * 4); // zero-pad x4 for a finer grid
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // Hann window to keep leakage from neighbouring bins down.
  for (let i = 0; i < vals.length; i++) re[i] = vals[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (vals.length - 1)));
  fft(re, im);
  const lo = Math.ceil((5 / 60 / fs) * n);
  const hi = Math.floor((40 / 60 / fs) * n);
  let best = -1;
  let bestP = 0;
  const p = (k: number) => re[k]! ** 2 + im[k]! ** 2;
  for (let k = lo; k <= hi; k++) {
    if (p(k) > bestP) {
      bestP = p(k);
      best = k;
    }
  }
  if (best < 0 || bestP === 0) return NaN;
  const a = p(best - 1);
  const b = p(best);
  const c = p(best + 1);
  const delta = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
  return ((best + delta) * fs * 60) / n;
}
