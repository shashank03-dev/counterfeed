/**
 * Phase-locking value: PLV = | mean_k exp(i (phiA_k - phiB_k)) |.
 * 1 = the two phases keep a constant relationship (in step, or consistently offset);
 * 0 = no consistent relationship. Computed over 30 s windows with a 5 s step; a window counts
 * only if at least `minCoverage` of it has valid signal from both people.
 */
export interface PlvOptions {
  fs: number;
  windowS?: number;
  stepS?: number;
  minCoverage?: number;
  /**
   * Skip windows that contain this sample index. Used by the surrogate test: a circular shift splices the
   * end of the partner's series onto its start, and a window straddling that splice mixes two unrelated
   * phase offsets, which drags the surrogate PLV down and would inflate significance.
   */
  skipAt?: number;
}

export interface PlvResult {
  /** Mean PLV over valid windows (NaN if none). */
  plv: number;
  /** Per-window PLV (NaN for windows without enough signal). */
  series: number[];
  windows: number;
  /** Share of samples valid for both. */
  coverage: number;
}

/**
 * Unit phasor difference z_k = e^{i phiA_k} * conj(e^{i phiB_(k+shift)}). Samples where either phase is
 * missing, or either person's validity flag is 0, contribute nothing (ok=0). `validB` shifts with B.
 */
export function phasorDiff(phiA: ArrayLike<number>, phiB: ArrayLike<number>, validA?: ArrayLike<number>, validB?: ArrayLike<number>, shift = 0) {
  const n = phiA.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const ok = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const kb = shift ? (k + shift) % n : k;
    const a = phiA[k]!;
    const b = phiB[kb]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if ((validA && !validA[k]) || (validB && !validB[kb])) continue;
    const d = a - b;
    re[k] = Math.cos(d);
    im[k] = Math.sin(d);
    ok[k] = 1;
  }
  return { re, im, ok };
}

export function windowedPlv(z: { re: Float64Array; im: Float64Array; ok: Uint8Array }, o: PlvOptions): PlvResult {
  const n = z.re.length;
  const win = Math.round((o.windowS ?? 30) * o.fs);
  const step = Math.round((o.stepS ?? 5) * o.fs);
  const minCov = o.minCoverage ?? 0.6;
  // Prefix sums so each window is O(1): the surrogate test calls this hundreds of times.
  const sr = new Float64Array(n + 1);
  const si = new Float64Array(n + 1);
  const sc = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    sr[k + 1] = sr[k]! + z.re[k]!;
    si[k + 1] = si[k]! + z.im[k]!;
    sc[k + 1] = sc[k]! + z.ok[k]!;
  }
  const series: number[] = [];
  let sum = 0;
  let count = 0;
  for (let s = 0; s + win <= n; s += step) {
    if (o.skipAt !== undefined && o.skipAt > s && o.skipAt < s + win) {
      series.push(NaN);
      continue;
    }
    const c = sc[s + win]! - sc[s]!;
    if (c < minCov * win) {
      series.push(NaN);
      continue;
    }
    const v = Math.hypot(sr[s + win]! - sr[s]!, si[s + win]! - si[s]!) / c;
    series.push(v);
    sum += v;
    count++;
  }
  return { plv: count ? sum / count : NaN, series, windows: count, coverage: n ? sc[n]! / n : 0 };
}

export function plv(phiA: ArrayLike<number>, phiB: ArrayLike<number>, o: PlvOptions, validA?: ArrayLike<number>, validB?: ArrayLike<number>): PlvResult {
  return windowedPlv(phasorDiff(phiA, phiB, validA, validB), o);
}
