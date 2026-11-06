import { gaussian, mulberry32 } from '../../src/renderer/src/lib/rng';

export const FS = 10;

/** Samples of f(t) on a uniform grid of `seconds` at `fs` Hz. */
export function sampled(seconds: number, f: (t: number) => number, fs = FS): Float64Array {
  return Float64Array.from({ length: Math.round(seconds * fs) }, (_, i) => f(i / fs));
}

/** Band-limited Gaussian noise via a sum of random-phase sinusoids in [lo, hi] Hz. */
export function bandNoise(seconds: number, seed: number, lo = 0.1, hi = 0.6, fs = FS): Float64Array {
  const rand = mulberry32(seed);
  const comps = Array.from({ length: 40 }, () => ({ f: lo + rand() * (hi - lo), p: rand() * 2 * Math.PI, a: 0.5 + rand() }));
  return sampled(seconds, (t) => comps.reduce((s, c) => s + c.a * Math.sin(2 * Math.PI * c.f * t + c.p), 0), fs);
}

export function whiteNoise(n: number, seed: number, sd = 1) {
  const g = gaussian(mulberry32(seed));
  return Float64Array.from({ length: n }, () => g() * sd);
}

export function rms(x: ArrayLike<number>, from = 0, to = x.length) {
  let s = 0;
  let n = 0;
  for (let i = from; i < to; i++) {
    if (!Number.isFinite(x[i]!)) continue;
    s += x[i]! ** 2;
    n++;
  }
  return Math.sqrt(s / n);
}

/** A realistic breathing trace: slightly varying rate (breath-to-breath), amplitude wobble, noise. */
export function breathing(seconds: number, seed: number, baseHz = 0.25, opts: { phase?: number; jitter?: number; noise?: number; drift?: number } = {}) {
  const rand = mulberry32(seed);
  const g = gaussian(rand);
  const n = Math.round(seconds * FS);
  const out = new Float64Array(n);
  let ph = opts.phase ?? 0;
  let f = baseHz;
  for (let i = 0; i < n; i++) {
    // Rate wanders slowly (an Ornstein-Uhlenbeck walk around baseHz).
    // Default jitter gives a breath-rate SD of ~0.03 Hz (~12 %), in line with normal resting variability.
    f += 0.02 * (baseHz - f) + (opts.jitter ?? 0.006) * g();
    ph += (2 * Math.PI * f) / FS;
    out[i] = Math.sin(ph) * (1 + 0.15 * Math.sin(i / 97)) + (opts.noise ?? 0.15) * g() + (opts.drift ?? 0) * (i / FS);
  }
  return out;
}
