import { mean } from '../lib/stats';

/**
 * Lag test: the person breathes out and holds; a tone plays; they breathe in.
 * The delay is from the tone to the moment the chest trace visibly leaves its resting level,
 * measured on arrival time (what the screen shows), so it includes reaction + camera + processing.
 *
 * The SDK docs don't state the trace's polarity, so a departure in either direction counts.
 */
export interface LagSample {
  /** Arrival time on the local clock, us. */
  at: number;
  v: number;
}

export function detectRise(samples: LagSample[], beepAt: number, opts: { baselineS?: number; searchS?: number; k?: number; sustain?: number } = {}): number | null {
  const baselineS = opts.baselineS ?? 1.5;
  const searchS = opts.searchS ?? 6;
  const k = opts.k ?? 5;
  const sustain = opts.sustain ?? 3;
  const base = samples.filter((s) => s.at >= beepAt - baselineS * 1e6 && s.at <= beepAt).map((s) => s.v);
  if (base.length < 5) return null;
  const mu = mean(base);
  const sd = Math.sqrt(mean(base.map((v) => (v - mu) ** 2)));
  const range = Math.max(...base) - Math.min(...base);
  const threshold = Math.max(k * sd, range, 1e-9);
  let run = 0;
  let first = -1;
  let dir = 0;
  for (const s of samples) {
    if (s.at <= beepAt || s.at > beepAt + searchS * 1e6) continue;
    const d = s.v - mu;
    const sign = Math.sign(d);
    if (Math.abs(d) > threshold && (run === 0 || sign === dir)) {
      if (run === 0) {
        first = s.at;
        dir = sign;
      }
      if (++run >= sustain) return Math.round((first - beepAt) / 1000);
    } else run = 0;
  }
  return null;
}
