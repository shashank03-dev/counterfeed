import { fft, nextPow2 } from './fft';
import { segments } from './filter';

/**
 * Instantaneous phase via the analytic signal (FFT Hilbert transform):
 * X(f) -> keep DC and Nyquist, double positive frequencies, zero negative ones, inverse FFT.
 * The FFT buffer is filled by even reflection so the circular wrap adds no discontinuity;
 * the error that remains decays ~1/t from each end (measured: < 0.15 rad from 3 s in, < 0.06 rad from 10 s in),
 * so the first/last `edgeS` (3 s) of each stretch are trimmed.
 */
export function analyticPhase(x: Float64Array): Float64Array {
  const n = x.length;
  if (n < 2) return new Float64Array(n);
  const total = nextPow2(2 * n);
  const left = (total - n) >> 1;
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  // Fill the whole FFT buffer with the signal and its repeated even reflection, so the circular
  // FFT never sees a jump (zero padding would put one at each end and smear the phase).
  const period = 2 * (n - 1);
  for (let i = 0; i < total; i++) {
    let j = (((i - left) % period) + period) % period;
    if (j >= n) j = period - j;
    re[i] = x[j]!;
  }
  fft(re, im);
  const half = total >> 1;
  for (let k = 1; k < half; k++) {
    re[k] = re[k]! * 2;
    im[k] = im[k]! * 2;
  }
  for (let k = half + 1; k < total; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  fft(re, im, true);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.atan2(im[left + i]!, re[left + i]!);
  return out;
}

/** Phase of a band-passed, gappy signal; NaN where there was no usable signal or near segment edges. */
export function phaseGappy(filtered: Float64Array, fs: number, edgeS = 3): Float64Array {
  const out = new Float64Array(filtered.length).fill(NaN);
  const { segs } = segments(filtered, fs, 0, 8);
  const edge = Math.round(edgeS * fs);
  for (const s of segs) {
    const ph = analyticPhase(filtered.subarray(s.start, s.end));
    for (let i = edge; i < ph.length - edge; i++) out[s.start + i] = ph[i]!;
  }
  return out;
}
