import { describe, expect, it } from 'vitest';
import { analyzePhase, liveChance, liveSync, type PersonSignals } from '../../src/renderer/src/sync/analyze';
import { fft } from '../../src/renderer/src/sync/fft';
import { BAND, bandpass, bandpassGappy, magnitudeResponse } from '../../src/renderer/src/sync/filter';
import { analyticPhase } from '../../src/renderer/src/sync/phase';
import { plv } from '../../src/renderer/src/sync/plv';
import { makeGrid, resample, resampleFlags } from '../../src/renderer/src/sync/resample';
import { surrogateTest } from '../../src/renderer/src/sync/surrogate';
import { bandNoise, breathing, FS, rms, sampled } from './helpers';

const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

describe('fft', () => {
  it('matches a direct DFT and inverts exactly', () => {
    const n = 64;
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7) + (i % 5) / 7);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    let maxErr = 0;
    for (let k = 0; k < n; k++) {
      let dr = 0;
      let di = 0;
      for (let t = 0; t < n; t++) {
        dr += x[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        di += x[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      maxErr = Math.max(maxErr, Math.abs(dr - re[k]!), Math.abs(di - im[k]!));
    }
    expect(maxErr).toBeLessThan(1e-9);
    fft(re, im, true);
    for (let t = 0; t < n; t++) expect(re[t]).toBeCloseTo(x[t]!, 10);
  });
});

describe('band-pass 0.08-0.67 Hz (zero phase)', () => {
  it('has the designed frequency response', () => {
    // Measured |H| of the forward-backward chain.
    expect(magnitudeResponse(0.25, FS)).toBeGreaterThan(0.97); // 15 br/min passes
    expect(magnitudeResponse(0.15, FS)).toBeGreaterThan(0.9); // 9 br/min
    expect(magnitudeResponse(0.5, FS)).toBeGreaterThan(0.75); // 30 br/min
    expect(magnitudeResponse(BAND.low, FS)).toBeCloseTo(0.5, 1); // -6 dB at the corners (filtfilt squares -3 dB)
    expect(magnitudeResponse(BAND.high, FS)).toBeCloseTo(0.5, 1);
    expect(magnitudeResponse(0.02, FS)).toBeLessThan(0.005); // slow drift
    expect(magnitudeResponse(2, FS)).toBeLessThan(0.01); // fast noise
  });

  it('removes 0.02 Hz drift and 2 Hz noise from a breathing signal', () => {
    const clean = sampled(180, (t) => Math.sin(2 * Math.PI * 0.25 * t));
    const dirty = sampled(180, (t) => Math.sin(2 * Math.PI * 0.25 * t) + 2 * Math.sin(2 * Math.PI * 0.02 * t + 1) + 0.8 * Math.sin(2 * Math.PI * 2 * t));
    const out = bandpass(dirty, FS);
    const inner = [150, 1650] as const; // ignore 15 s edges
    const residual = out.map((v, i) => v - clean[i]!);
    const errRatio = rms(residual, ...inner) / rms(clean, ...inner);
    expect(errRatio).toBeLessThan(0.05); // < 5 % of the breathing amplitude left as error
    // Zero phase: the filtered peak lines up with the clean peak (no lag).
    let best = 0;
    let bestLag = 0;
    for (let lag = -10; lag <= 10; lag++) {
      let s = 0;
      for (let i = inner[0]; i < inner[1]; i++) s += out[i]! * clean[i + lag]!;
      if (s > best) [best, bestLag] = [s, lag];
    }
    expect(bestLag).toBe(0);
  });

  it('handles gaps: bridges short ones, splits on long ones, never invents signal', () => {
    const x = sampled(120, (t) => Math.sin(2 * Math.PI * 0.25 * t));
    for (let i = 300; i < 310; i++) x[i] = NaN; // 1 s gap: bridged
    for (let i = 600; i < 900; i++) x[i] = NaN; // 30 s gap: split
    const y = bandpassGappy(x, FS);
    for (let i = 300; i < 310; i++) expect(Number.isNaN(y[i]!)).toBe(true);
    for (let i = 600; i < 900; i++) expect(Number.isNaN(y[i]!)).toBe(true);
    expect(Number.isFinite(y[200]!)).toBe(true);
    expect(Number.isFinite(y[1000]!)).toBe(true);
  });
});

describe('analytic phase (FFT Hilbert)', () => {
  it('recovers sinusoid phase: < 0.15 rad from 3 s in, < 0.06 rad from 10 s in, mean < 0.03 rad', () => {
    // Non-integer cycle counts over 60 s are the hard case for an FFT-based transform.
    for (const f of [0.17, 0.23, 0.25, 0.31]) {
      const x = sampled(60, (t) => Math.cos(2 * Math.PI * f * t + 0.7));
      const ph = analyticPhase(x);
      const err = (i: number) => Math.abs(wrap(ph[i]! - (2 * Math.PI * f * (i / FS) + 0.7)));
      let past3 = 0;
      let past10 = 0;
      let sum = 0;
      let n = 0;
      for (let i = 30; i < x.length - 30; i++) {
        past3 = Math.max(past3, err(i));
        if (i >= 100 && i < x.length - 100) past10 = Math.max(past10, err(i));
        sum += err(i);
        n++;
      }
      expect(past3).toBeLessThan(0.15);
      expect(past10).toBeLessThan(0.06);
      expect(sum / n).toBeLessThan(0.03);
    }
  });
});

describe('phase-locking value', () => {
  const o = { fs: FS, windowS: 30, stepS: 5 };

  it('two in-phase sines: PLV > 0.95', () => {
    const a = analyticPhase(sampled(180, (t) => Math.sin(2 * Math.PI * 0.25 * t)));
    const b = analyticPhase(sampled(180, (t) => 0.4 * Math.sin(2 * Math.PI * 0.25 * t)));
    const r = plv(a, b, o);
    expect(r.plv).toBeGreaterThan(0.95);
    expect(r.windows).toBe(31); // (180-30)/5 + 1
  });

  it('phase-shifted sines (90 deg and 180 deg) are still locked', () => {
    for (const shift of [Math.PI / 2, Math.PI]) {
      const a = analyticPhase(sampled(180, (t) => Math.sin(2 * Math.PI * 0.25 * t)));
      const b = analyticPhase(sampled(180, (t) => Math.sin(2 * Math.PI * 0.25 * t + shift)));
      expect(plv(a, b, o).plv).toBeGreaterThan(0.95);
    }
  });

  it('independent band-limited noise: PLV < 0.3 (measured over 20 seed pairs)', () => {
    const values: number[] = [];
    for (let s = 0; s < 20; s++) {
      const a = analyticPhase(bandpass(bandNoise(180, 100 + s), FS));
      const b = analyticPhase(bandpass(bandNoise(180, 900 + s), FS));
      values.push(plv(a, b, o).plv);
    }
    const avg = values.reduce((x, y) => x + y) / values.length;
    expect(Math.max(...values)).toBeLessThan(0.3);
    expect(avg).toBeLessThan(0.25);
  });

  it('a window without enough valid samples does not count', () => {
    const a = analyticPhase(sampled(60, (t) => Math.sin(2 * Math.PI * 0.25 * t)));
    const valid = Uint8Array.from(a, (_, i) => (i < 400 ? 1 : 0)); // only the first 40 s are valid
    const r = plv(a, a, { fs: FS, windowS: 30, stepS: 5 }, valid);
    // Windows start at 0,5,...,30 s. Coverage >= 60 % holds only for starts 0..20 s.
    expect(r.windows).toBe(5);
    expect(r.series.slice(5).every(Number.isNaN)).toBe(true);
  });
});

describe('surrogate (circular shift) chance level', () => {
  const o = { fs: FS, windowS: 30, stepS: 5, n: 200, minShiftS: 10, seed: 7 };

  it('locked breathing pair: ranks above >= 95 % of surrogates', () => {
    const a = breathing(180, 1, 0.25);
    const b = Float64Array.from(a, (v, i) => v * 0.8 + 0.2 * Math.sin(i));
    const pa = analyticPhase(bandpass(a, FS));
    const pb = analyticPhase(bandpass(b, FS));
    const r = surrogateTest(pa, pb, o);
    expect(r.n).toBe(200);
    expect(r.observed).toBeGreaterThan(0.9);
    expect(r.percentile).toBeGreaterThanOrEqual(95);
    expect(r.ratio).toBeGreaterThan(1.5);
  });

  it('independent breathers: percentile is not systematically high (mean of 30 pairs within 50 +/- 20)', () => {
    const ps: number[] = [];
    let high = 0;
    for (let s = 0; s < 30; s++) {
      const pa = analyticPhase(bandpass(breathing(180, 10 + s, 0.24), FS));
      const pb = analyticPhase(bandpass(breathing(180, 500 + s, 0.26), FS));
      const r = surrogateTest(pa, pb, { ...o, n: 100, seed: s });
      ps.push(r.percentile);
      if (r.percentile >= 95) high++;
    }
    const avg = ps.reduce((x, y) => x + y) / ps.length;
    expect(avg).toBeGreaterThan(30);
    expect(avg).toBeLessThan(70);
    // False-positive rate at the 95th percentile should be near 5 %: allow up to 5 of 30.
    expect(high).toBeLessThanOrEqual(5);
  });

  it('two independent metronomes at the same rate are NOT called above chance (splice bias regression)', () => {
    // Identical frequency, unrelated constant phases: any shift keeps PLV ~1, so it must rank near the middle.
    // Without skipping windows that straddle the circular-shift splice, surrogates were biased low and this
    // pair ranked at the 100th percentile.
    for (const seconds of [45, 90, 180]) {
      const a = analyticPhase(sampled(seconds, (t) => Math.sin(2 * Math.PI * 0.25 * t)));
      const b = analyticPhase(sampled(seconds, (t) => Math.sin(2 * Math.PI * 0.25 * t + 2.1)));
      const r = surrogateTest(a, b, { fs: FS, windowS: 30, stepS: 5, n: 200, minShiftS: 10, seed: 3 });
      expect(r.observed).toBeGreaterThan(0.95);
      if (r.n) expect(r.percentile).toBeLessThan(95);
      expect(r.ratio === r.ratio ? r.ratio < 1.05 : true).toBe(true);
    }
  });

  it('is reproducible for a fixed seed and needs at least 2x the minimum shift of data', () => {
    const pa = analyticPhase(bandpass(breathing(120, 3), FS));
    const pb = analyticPhase(bandpass(breathing(120, 4), FS));
    expect(surrogateTest(pa, pb, o).dist).toEqual(surrogateTest(pa, pb, o).dist);
    const short = surrogateTest(pa.subarray(0, 150), pb.subarray(0, 150), { ...o, windowS: 10 });
    expect(short.n).toBe(0); // 15 s < 2 x 10 s minimum shift: no room for a surrogate
  });
});

describe('resample to a 10 Hz local-clock grid', () => {
  it('linearly interpolates irregular ~30 Hz samples and applies the clock offset', () => {
    const t: number[] = [];
    const v: number[] = [];
    const offset = 2_500_000; // partner clock runs 2.5 s ahead
    for (let k = 0; k < 900; k++) {
      const local = k * 33_333 + (k % 3) * 1000; // jittery 30 Hz
      t.push(local + offset);
      v.push(local / 1e6); // value = local seconds -> perfectly linear
    }
    const g = makeGrid(1_000_000, 20_000_000, 10);
    const r = resample(t, v, g, 500_000, offset);
    expect(g.n).toBe(191);
    for (let i = 0; i < g.n; i++) expect(r[i]).toBeCloseTo(1 + i / 10, 6);
  });

  it('marks gaps longer than 0.5 s as missing', () => {
    const t = [0, 100_000, 200_000, 1_500_000, 1_600_000];
    const v = [1, 1, 1, 1, 1];
    const r = resample(t, v, makeGrid(0, 1_600_000, 10));
    expect(Array.from(r.slice(3, 15), Number.isNaN).every(Boolean)).toBe(true);
    expect(r[0]).toBe(1);
    expect(r[16]).toBe(1);
  });

  it('holds flags for at most 1 s', () => {
    const r = resampleFlags([0, 500_000], [true, false], makeGrid(0, 3_000_000, 10));
    expect(Array.from(r.slice(0, 5))).toEqual([1, 1, 1, 1, 1]);
    expect(Array.from(r.slice(5, 16)).every((x) => x === 0)).toBe(true);
  });
});

function person(trace: Float64Array, startUs: number, opts: { offset?: number; talk?: [number, number][] } = {}): PersonSignals {
  const t: number[] = [];
  const v: number[] = [];
  const talkT: number[] = [];
  const talk: boolean[] = [];
  // Upsample the 10 Hz trace to ~30 Hz with jitter, like the SDK.
  for (let k = 0; k < trace.length * 3; k++) {
    const sec = k / 30;
    const i = Math.min(trace.length - 1, Math.floor(sec * FS));
    const ts = startUs + sec * 1e6 + (opts.offset ?? 0) + ((k * 7919) % 5000);
    t.push(ts);
    v.push(trace[i]!);
    talkT.push(ts);
    talk.push(!!opts.talk?.some(([a, b]) => sec >= a && sec < b));
  }
  return { t, v, talkT, talk };
}

describe('analyzePhase end to end', () => {
  const start = 1_700_000_000_000_000;

  it('people breathing together across a 3.2 s clock offset score high and above chance', () => {
    const shared = breathing(180, 42, 0.22);
    const you = person(shared, start);
    const partner = person(Float64Array.from(shared, (x, i) => x * 1.3 + 0.3 * Math.sin(i * 1.3)), start, { offset: 3_200_000 });
    const r = analyzePhase(you, partner, { start, end: start + 180e6, offsetUs: 3_200_000, seed: 1 })!;
    expect(r.plv).toBeGreaterThan(0.85);
    expect(r.percentile).toBeGreaterThanOrEqual(95);
    expect(r.ratio).toBeGreaterThan(1.5);
    expect(r.coverage).toBeGreaterThan(0.8);
  });

  it('ignoring the clock offset would destroy the lock (the offset is load-bearing)', () => {
    const shared = breathing(180, 42, 0.22, { jitter: 0.004 });
    const you = person(shared, start);
    const partner = person(shared, start, { offset: 1_900_000 });
    const right = analyzePhase(you, partner, { start, end: start + 180e6, offsetUs: 1_900_000, seed: 1 })!;
    const wrong = analyzePhase(you, partner, { start, end: start + 180e6, offsetUs: 0, seed: 1 })!;
    expect(right.plv).toBeGreaterThan(0.95);
    // 1.9 s lag at ~0.22 Hz is ~150 deg: still a *constant* phase relation, so PLV stays fairly high,
    // but it is clearly lower than with the right offset because the rate wanders.
    expect(wrong.plv).toBeLessThan(right.plv);
  });

  it('talking stretches are excluded and reported', () => {
    const shared = breathing(180, 5, 0.25);
    const you = person(shared, start, { talk: [[60, 90]] });
    const partner = person(shared, start);
    const r = analyzePhase(you, partner, { start, end: start + 180e6, offsetUs: 0, seed: 1 })!;
    expect(r.talkingShare).toBeGreaterThan(0.16);
    expect(r.talkingShare).toBeLessThan(0.2);
    expect(r.coverage).toBeLessThan(0.85);
    expect(r.plv).toBeGreaterThan(0.9);
  });

  it('returns null when there is no overlapping signal', () => {
    const you = person(breathing(60, 1), start);
    const partner = person(breathing(60, 2), start + 120e6);
    expect(analyzePhase(you, partner, { start, end: start + 180e6, offsetUs: 0 })).toBeNull();
  });

  it('live meter: high for a locked pair, low for independent breathers, NaN with no data', () => {
    const a = breathing(70, 11, 0.25);
    const locked = liveSync(person(a, start), person(a, start), start + 70e6, 0);
    const apart = liveSync(person(a, start), person(breathing(70, 99, 0.3), start), start + 70e6, 0);
    expect(locked).toBeGreaterThan(0.9);
    expect(apart).toBeLessThan(0.6);
    expect(Number.isNaN(liveSync(person(a, start), person(a, start), start + 500e6, 0))).toBe(true);
  });

  it('live chance: a locked pair sits well above its chance mark; independent breathers have a low mark', () => {
    const a = breathing(100, 11, 0.25);
    const now = start + 100e6;
    const lockedSync = liveSync(person(a, start), person(a, start), now, 0);
    const lockedChance = liveChance(person(a, start), person(a, start), now, 0);
    expect(lockedChance).toBeGreaterThan(0);
    expect(lockedSync - lockedChance).toBeGreaterThan(0.3);
    // Independent breathers at different paces: chance is low (a single 30 s reading swings around it).
    const b = breathing(100, 99, 0.3);
    const indepChance = liveChance(person(a, start), person(b, start), now, 0);
    expect(indepChance).toBeGreaterThan(0.05);
    expect(indepChance).toBeLessThan(0.45);
    // Deterministic (fixed seed), so the mark doesn't jitter between updates with the same data.
    expect(liveChance(person(a, start), person(b, start), now, 0)).toBe(indepChance);
    expect(Number.isNaN(liveChance(person(a, start), person(a, start), start + 500e6, 0))).toBe(true);
  });
});
