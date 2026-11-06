import { describe, expect, it } from 'vitest';
import type { Msg } from '@together/shared';
import { ClockSync, estimateOffset, type ClockSample } from '../../src/renderer/src/link/clock';
import { gaussian, mulberry32 } from '../../src/renderer/src/lib/rng';

/** Simulated path: one-way delay = base + |gaussian| * jitter, plus occasional 200 ms queueing spikes. */
function simulate(offsetUs: number, seed: number, opts: { baseMs: number; jitterMs: number; asym?: number; spikes?: number }): ClockSample[] {
  const rand = mulberry32(seed);
  const g = gaussian(rand);
  const delay = (dir: 1 | -1) => {
    const asym = dir === 1 ? 1 + (opts.asym ?? 0) : 1 - (opts.asym ?? 0);
    const spike = rand() < (opts.spikes ?? 0) ? 200_000 : 0;
    return opts.baseMs * 1000 * asym + Math.abs(g()) * opts.jitterMs * 1000 + spike;
  };
  let local = 1_700_000_000_000_000;
  const out: ClockSample[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = local;
    const t1 = t0 + delay(1) + offsetUs;
    const t2 = t1 + 200 + rand() * 300; // partner processing
    const t3 = t2 - offsetUs + delay(-1);
    out.push({ t0, t1, t2, t3 });
    local = t3 + 60_000;
  }
  return out;
}

describe('clock offset estimation', () => {
  it('recovers offset within 20 ms with 40 ms latency and 25 ms jitter (1000 trials)', () => {
    const errors: number[] = [];
    const rand = mulberry32(7);
    for (let trial = 0; trial < 1000; trial++) {
      const offset = (rand() - 0.5) * 2 * 30e6;
      const est = estimateOffset(simulate(offset, 10_000 + trial, { baseMs: 40, jitterMs: 25 }))!;
      errors.push(Math.abs(est.offsetUs - offset) / 1000);
    }
    errors.sort((a, b) => a - b);
    expect(errors[999]).toBeLessThan(20);
    expect(errors[500]).toBeLessThan(5);
  });

  it('stays within 20 ms even with 20 % of packets hit by 200 ms queueing spikes (500 trials)', () => {
    const errors: number[] = [];
    const rand = mulberry32(99);
    for (let trial = 0; trial < 500; trial++) {
      const offset = (rand() - 0.5) * 2 * 30e6; // up to +/- 30 s apart
      const est = estimateOffset(simulate(offset, trial, { baseMs: 40, jitterMs: 25, spikes: 0.2 }))!;
      errors.push(Math.abs(est.offsetUs - offset) / 1000);
    }
    errors.sort((a, b) => a - b);
    const p50 = errors[250]!;
    const p99 = errors[495]!;
    const max = errors[499]!;
    expect(max).toBeLessThan(20);
    expect(p99).toBeLessThan(15);
    expect(p50).toBeLessThan(6);
  });

  it('error is bounded by half the path asymmetry (the known NTP limit)', () => {
    // 60 ms base with 20 % asymmetry: 72 ms out, 48 ms back -> true bias 12 ms.
    const est = estimateOffset(simulate(5e6, 3, { baseMs: 60, jitterMs: 0, asym: 0.2 }))!;
    expect(Math.abs(est.offsetUs - 5e6) / 1000).toBeCloseTo(12, 0);
  });

  it('prefers the lowest-RTT third', () => {
    const fast: ClockSample = { t0: 0, t1: 1_010_000, t2: 1_010_000, t3: 20_000 }; // offset 1 s, rtt 20 ms
    const slow: ClockSample = { t0: 0, t1: 1_300_000, t2: 1_300_000, t3: 320_000 }; // queued outbound: offset estimate 1.14 s
    const est = estimateOffset([fast, slow, slow, slow, slow, slow])!;
    expect(est.offsetUs).toBe(1_000_000);
    expect(est.rttUs).toBe(20_000);
  });

  it('rejects impossible samples and returns null with no data', () => {
    expect(estimateOffset([])).toBeNull();
    expect(estimateOffset([{ t0: 10, t1: 5, t2: 100, t3: 20 }])).toBeNull(); // negative RTT
  });

  it('two ClockSync instances talking over a fake channel agree with the true offset', async () => {
    const offset = 7_250_000;
    let localNow = 1_000_000_000;
    const a: ClockSync = new ClockSync((m) => setTimeout(() => b.handle(m as never), 15), () => localNow);
    const b: ClockSync = new ClockSync((m) => setTimeout(() => a.handle(m as never), 15), () => localNow + offset);
    const tick = setInterval(() => (localNow += 1000), 1);
    const est = await a.measure(10, 0);
    clearInterval(tick);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.offsetUs - offset)).toBeLessThan(20_000);
    expect(est!.samples).toBe(10);
  });

  it('times out unanswered pings instead of hanging', async () => {
    const sent: Msg[] = [];
    const c = new ClockSync((m) => sent.push(m));
    const est = await c.measure(3, 0, 20);
    expect(est).toBeNull();
    expect(sent).toHaveLength(3);
  });
});
