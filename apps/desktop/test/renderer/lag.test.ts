import { describe, expect, it } from 'vitest';
import { detectRise, type LagSample } from '../../src/renderer/src/sensing/lag';
import { gaussian, mulberry32 } from '../../src/renderer/src/lib/rng';
import { median } from '../../src/renderer/src/lib/stats';

const BEEP = 1_000_000_000;

/** Hold (small noise) until beep + delay, then an inhale ramp. 30 Hz arrivals. */
function trace(delayMs: number, seed: number, polarity = 1): LagSample[] {
  const g = gaussian(mulberry32(seed));
  const out: LagSample[] = [];
  for (let k = -60; k < 200; k++) {
    const at = BEEP + k * 33_333;
    const since = (at - BEEP) / 1000 - delayMs;
    const inhale = since > 0 ? Math.min(1, since / 1500) : 0;
    out.push({ at, v: polarity * inhale + 0.01 * g() });
  }
  return out;
}

describe('lag test rise detection', () => {
  it('measures a known delay within one frame + detection threshold (5 runs, median)', () => {
    for (const delay of [400, 800, 1200]) {
      const runs = [1, 2, 3, 4, 5].map((s) => detectRise(trace(delay, s), BEEP)!);
      const med = median(runs);
      // The ramp needs to clear 5 sigma (~0.05 of a 1.0 inhale over 1.5 s ~= 75 ms) plus up to one 33 ms frame.
      expect(med).toBeGreaterThanOrEqual(delay);
      expect(med).toBeLessThan(delay + 140);
    }
  });

  it('works when the trace goes down on inhale (polarity is not documented)', () => {
    expect(detectRise(trace(600, 9, -1), BEEP)).toBeGreaterThanOrEqual(600);
  });

  it('returns null with no movement, or without a baseline', () => {
    const flat = trace(99_999, 4);
    expect(detectRise(flat, BEEP)).toBeNull();
    expect(detectRise(flat.filter((s) => s.at > BEEP), BEEP)).toBeNull();
  });
});
