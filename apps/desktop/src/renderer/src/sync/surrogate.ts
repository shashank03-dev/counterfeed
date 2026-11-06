import { mulberry32 } from '../lib/rng';
import { mean, quantile } from '../lib/stats';
import { phasorDiff, windowedPlv, type PlvOptions } from './plv';

/**
 * Chance level for the PLV: circularly shift the partner's phase series by a random offset
 * of at least `minShiftS` (default 10 s) and recompute, `n` times (default 200). Shifting keeps
 * each person's own breathing rhythm and gaps intact but breaks any moment-to-moment alignment,
 * so the distribution is "how in step two people breathing like this would look by accident".
 */
export interface SurrogateResult {
  observed: number;
  mean: number;
  p95: number;
  /** observed / mean */
  ratio: number;
  /** Share of surrogates strictly below observed (ties count half), 0-100. */
  percentile: number;
  n: number;
  dist: number[];
}

export function surrogateTest(
  phiA: ArrayLike<number>,
  phiB: ArrayLike<number>,
  o: PlvOptions & { n?: number; minShiftS?: number; seed?: number },
  validA?: ArrayLike<number>,
  validB?: ArrayLike<number>,
): SurrogateResult {
  const len = phiA.length;
  const observed = windowedPlv(phasorDiff(phiA, phiB, validA, validB), o).plv;
  const minShift = Math.round((o.minShiftS ?? 10) * o.fs);
  const n = o.n ?? 200;
  const span = len - 2 * minShift;
  const dist: number[] = [];
  if (Number.isFinite(observed) && span > 0) {
    const rand = mulberry32(o.seed ?? 0x5eed);
    for (let i = 0; i < n; i++) {
      const shift = minShift + Math.floor(rand() * (span + 1));
      // The partner's validity (gaps, talking) moves with their series, so the surrogate keeps their real gaps.
      // Windows straddling the splice point (k = len - shift) are skipped; see PlvOptions.skipAt.
      const r = windowedPlv(phasorDiff(phiA, phiB, validA, validB, shift), { ...o, skipAt: len - shift }).plv;
      if (Number.isFinite(r)) dist.push(r);
    }
  }
  const m = mean(dist);
  let below = 0;
  for (const d of dist) below += d < observed ? 1 : d === observed ? 0.5 : 0;
  return {
    observed,
    mean: m,
    p95: quantile(dist, 0.95),
    ratio: Number.isFinite(m) && m > 0 ? observed / m : NaN,
    percentile: dist.length ? (100 * below) / dist.length : NaN,
    n: dist.length,
    dist,
  };
}
