/**
 * Breathing band-pass: linear detrend, then 2nd-order Butterworth high-pass (0.08 Hz) and
 * low-pass (0.67 Hz) biquads run forwards and backwards (zero phase, effectively 4th order).
 * 0.08-0.67 Hz is 5-40 breaths/min, the SDK's documented breathing range.
 *
 * Real traces have gaps (face lost, talking). The filter runs on each contiguous stretch;
 * gaps up to `bridgeS` are linearly bridged first, longer gaps split the signal, and stretches
 * shorter than `minSegS` are dropped (NaN) because the filter can't settle on them.
 */

export const BAND = { low: 0.08, high: 0.67 } as const;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook biquads, Q = 1/sqrt(2) (Butterworth). */
export function butter2(kind: 'lowpass' | 'highpass', fc: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const k = kind === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  return {
    b0: k / a0,
    b1: (kind === 'lowpass' ? 1 - cos : -(1 + cos)) / a0,
    b2: k / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function runBiquad(c: Biquad, x: Float64Array): Float64Array {
  const y = new Float64Array(x.length);
  // Start in steady state for the first input value to avoid a step transient.
  let x1 = x[0] ?? 0;
  let x2 = x1;
  const dcGain = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
  let y1 = x1 * dcGain;
  let y2 = y1;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Zero-phase filtering with odd-reflection padding (like scipy's filtfilt). */
export function filtfilt(c: Biquad, x: Float64Array, pad: number): Float64Array {
  const n = x.length;
  const p = Math.min(pad, n - 1);
  const ext = new Float64Array(n + 2 * p);
  for (let i = 0; i < p; i++) ext[i] = 2 * x[0]! - x[p - i]!;
  ext.set(x, p);
  for (let i = 0; i < p; i++) ext[p + n + i] = 2 * x[n - 1]! - x[n - 2 - i]!;
  const fwd = runBiquad(c, ext);
  fwd.reverse();
  const back = runBiquad(c, fwd);
  back.reverse();
  return back.subarray(p, p + n);
}

export function detrend(x: Float64Array): Float64Array {
  const n = x.length;
  if (n < 2) return Float64Array.from(x, () => 0);
  const mx = (n - 1) / 2;
  let my = 0;
  for (let i = 0; i < n; i++) my += x[i]!;
  my /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (x[i]! - my);
    den += (i - mx) ** 2;
  }
  const slope = num / den;
  return Float64Array.from(x, (v, i) => v - (my + slope * (i - mx)));
}

/** Detrend + band-pass one gap-free stretch. */
export function bandpass(x: Float64Array, fs: number, band: { low: number; high: number } = BAND): Float64Array {
  if (x.length < 4) return new Float64Array(x.length);
  const d = detrend(x);
  const pad = Math.round(fs * 12); // a few time constants of the 0.08 Hz high-pass
  const hp = filtfilt(butter2('highpass', band.low, fs), d, pad);
  return filtfilt(butter2('lowpass', band.high, fs), hp, pad);
}

export interface Segment {
  start: number;
  end: number; // exclusive
}

/** Contiguous runs of finite values, after bridging short NaN gaps. */
export function segments(x: Float64Array, fs: number, bridgeS = 2, minSegS = 20): { filled: Float64Array; segs: Segment[] } {
  const filled = Float64Array.from(x);
  const n = x.length;
  // Bridge short gaps.
  let i = 0;
  while (i < n) {
    if (Number.isFinite(filled[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !Number.isFinite(filled[j]!)) j++;
    const before = i - 1;
    if (before >= 0 && j < n && j - i <= bridgeS * fs) {
      const a = filled[before]!;
      const b = filled[j]!;
      for (let k = i; k < j; k++) filled[k] = a + ((b - a) * (k - before)) / (j - before);
    }
    i = j;
  }
  const segs: Segment[] = [];
  i = 0;
  while (i < n) {
    if (!Number.isFinite(filled[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && Number.isFinite(filled[j]!)) j++;
    if (j - i >= minSegS * fs) segs.push({ start: i, end: j });
    i = j;
  }
  return { filled, segs };
}

/** Band-pass a gappy signal. Output is NaN outside usable stretches. */
export function bandpassGappy(x: Float64Array, fs: number, opts: { bridgeS?: number; minSegS?: number } = {}): Float64Array {
  const out = new Float64Array(x.length).fill(NaN);
  const { filled, segs } = segments(x, fs, opts.bridgeS, opts.minSegS);
  for (const s of segs) out.set(bandpass(filled.subarray(s.start, s.end), fs), s.start);
  // Bridged points carry no real information: mask them out again.
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i]!)) out[i] = NaN;
  return out;
}

/** |H(f)| of the full zero-phase chain, for tests and docs. */
export function magnitudeResponse(f: number, fs: number, band: { low: number; high: number } = BAND): number {
  const g = (c: Biquad) => {
    const w = (2 * Math.PI * f) / fs;
    const re = (b0: number, b1: number, b2: number) => b0 + b1 * Math.cos(-w) + b2 * Math.cos(-2 * w);
    const im = (b0: number, b1: number, b2: number) => b1 * Math.sin(-w) + b2 * Math.sin(-2 * w);
    const nr = re(c.b0, c.b1, c.b2);
    const ni = im(c.b0, c.b1, c.b2);
    const dr = re(1, c.a1, c.a2);
    const di = im(1, c.a1, c.a2);
    return Math.hypot(nr, ni) / Math.hypot(dr, di);
  };
  return (g(butter2('highpass', band.low, fs)) * g(butter2('lowpass', band.high, fs))) ** 2;
}
