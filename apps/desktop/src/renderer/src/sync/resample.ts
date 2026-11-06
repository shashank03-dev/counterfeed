/**
 * Put an irregular series on a uniform grid (default 10 Hz) by linear interpolation.
 * Grid points that fall in a gap longer than `maxGapUs` between real samples, or outside
 * the data, become NaN, so later stages can see where signal was missing.
 */
export interface Grid {
  /** Grid start, microseconds on the LOCAL clock. */
  start: number;
  hz: number;
  n: number;
}

export function makeGrid(start: number, end: number, hz = 10): Grid {
  const n = Math.max(0, Math.floor(((end - start) / 1e6) * hz) + 1);
  return { start, hz, n };
}

export function gridTime(g: Grid, i: number) {
  return g.start + (i * 1e6) / g.hz;
}

export function resample(t: ArrayLike<number>, v: ArrayLike<number>, g: Grid, maxGapUs = 500_000, offsetUs = 0): Float64Array {
  const out = new Float64Array(g.n).fill(NaN);
  const m = t.length;
  if (!m) return out;
  let j = 0;
  for (let i = 0; i < g.n; i++) {
    const x = gridTime(g, i) + offsetUs; // grid time expressed in the series' own clock
    while (j < m - 1 && t[j + 1]! <= x) j++;
    const t0 = t[j]!;
    if (x < t0) {
      // Before the first sample: allow only a tiny tolerance.
      if (j === 0 && t0 - x <= maxGapUs / 2 && Number.isFinite(v[0]!)) out[i] = v[0]!;
      continue;
    }
    if (j === m - 1) {
      if (x - t0 <= maxGapUs / 2 && Number.isFinite(v[j]!)) out[i] = v[j]!;
      continue;
    }
    const t1 = t[j + 1]!;
    if (t1 - t0 > maxGapUs) continue;
    const a = v[j]!;
    const b = v[j + 1]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    out[i] = t1 === t0 ? a : a + ((b - a) * (x - t0)) / (t1 - t0);
  }
  return out;
}

/**
 * Step (sample-and-hold) resampling for boolean-ish flags (e.g. talking).
 * A flag holds for at most `holdUs` after its sample; beyond that it's `fallback`.
 */
export function resampleFlags(t: ArrayLike<number>, on: ArrayLike<boolean | number>, g: Grid, holdUs = 1_000_000, offsetUs = 0, fallback = false): Uint8Array {
  const out = new Uint8Array(g.n).fill(fallback ? 1 : 0);
  const m = t.length;
  let j = -1;
  for (let i = 0; i < g.n; i++) {
    const x = gridTime(g, i) + offsetUs;
    while (j < m - 1 && t[j + 1]! <= x) j++;
    if (j >= 0 && x - t[j]! <= holdUs) out[i] = on[j] ? 1 : 0;
  }
  return out;
}
