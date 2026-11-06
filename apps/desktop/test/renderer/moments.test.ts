import { describe, expect, it } from 'vitest';
import type { Moment } from '@together/shared';
import { describeMoment, MomentDetector, type Detected } from '../../src/renderer/src/moments/detect';

const T0 = 1_731_000_000_000_000;
const FPS = 30;

/** Drive the detector with a happiness curve h(s) and surprise curve u(s) over `seconds`. */
function run(seconds: number, h: (s: number) => number, u: (s: number) => number = () => 5, opts: { partnerTalking?: (s: number) => boolean; selfTalking?: (s: number) => boolean; pulse?: (s: number) => number | null } = {}) {
  const detected: Detected[] = [];
  const resolved: Moment[] = [];
  const d = new MomentDetector(T0, (x) => detected.push(x), (m) => resolved.push(m));
  for (let k = 0; k <= seconds * FPS; k++) {
    const s = k / FPS;
    const t = T0 + Math.round(s * 1e6);
    d.setTalking('partner', opts.partnerTalking ? opts.partnerTalking(s) : true);
    d.setTalking('self', opts.selfTalking ? opts.selfTalking(s) : false);
    const p = opts.pulse?.(s);
    if (p != null && k % 30 === 0) d.pushPulse(t, p, true);
    d.pushExpression({ t, happy: h(s), surprise: u(s) });
  }
  d.tick(T0 + (seconds + 30) * 1e6);
  return { detected, resolved };
}

/** A smooth bump: rises to `peak` around `at` seconds and lasts `width` seconds. */
const bump = (at: number, peak: number, base = 10, width = 1.5) => (s: number) => base + (peak - base) * Math.exp(-(((s - at) / (width / 2)) ** 2));

describe('Moments (listener reactions)', () => {
  it('a clear smile while listening is exactly one event, at the peak, with its peak value', () => {
    const { detected } = run(30, bump(15, 85));
    expect(detected).toHaveLength(1);
    expect(detected[0]!.kind).toBe('smile');
    // The 0.5 s EMA delays the smoothed peak a little behind the raw one (measured ~0.33 s).
    expect(detected[0]!.t - (T0 + 15e6)).toBeGreaterThanOrEqual(0);
    expect(detected[0]!.t - (T0 + 15e6)).toBeLessThan(0.5e6);
    // EMA (0.5 s) lowers the visible peak of a 1.5 s bump a little: 85 raw -> high 70s smoothed.
    expect(detected[0]!.peak).toBeGreaterThanOrEqual(70);
    expect(detected[0]!.peak).toBeLessThanOrEqual(85);
  });

  it('rise below 30 points over the median: no event', () => {
    expect(run(30, bump(15, 38)).detected).toHaveLength(0); // +28 raw
  });

  it('rises >= 30 but peaks below 60: no event', () => {
    expect(run(30, bump(15, 58, 20, 3)).detected).toHaveLength(0);
  });

  it('two smiles 3 s apart: only the first counts (5 s minimum gap); 7 s apart: both count', () => {
    const near = (s: number) => Math.max(bump(12, 85)(s), bump(15, 85)(s));
    expect(run(30, near).detected).toHaveLength(1);
    const far = (s: number) => Math.max(bump(12, 85)(s), bump(19, 85)(s));
    expect(run(30, far).detected).toHaveLength(2);
  });

  it('only while the partner talks and you do not', () => {
    expect(run(30, bump(15, 90), undefined, { partnerTalking: () => false }).detected).toHaveLength(0);
    expect(run(30, bump(15, 90), undefined, { selfTalking: () => true }).detected).toHaveLength(0);
    expect(run(30, bump(15, 90), undefined, { partnerTalking: (s) => s > 14 }).detected).toHaveLength(1);
  });

  it('a high but flat expression is not an event (it is relative to the rolling median)', () => {
    expect(run(30, () => 80).detected).toHaveLength(0);
  });

  it('a surprise is detected as its own kind', () => {
    const { detected } = run(30, () => 10, bump(20, 75));
    expect(detected.map((d) => d.kind)).toEqual(['surprise']);
  });

  it('needs 3 s of history before it can fire', () => {
    expect(run(10, bump(1.2, 90)).detected).toHaveLength(0);
  });

  it('pulse confirmation: +N BPM when both 15 s windows have stable pulse', () => {
    const pulse = (s: number) => (s < 15 ? 70 : s < 22 ? 79 : 72);
    const { resolved } = run(40, bump(15, 85), undefined, { pulse });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.pulseDelta).toBe(9);
    expect(resolved[0]!.atMs).toBeGreaterThan(14_700);
    expect(describeMoment(resolved[0]!)).toMatch(/^at 00:15 you smiled \(\d+%\), pulse \+9 BPM$/);
  });

  it('pulse confirmation: "not enough signal" when a window has no stable samples', () => {
    const { resolved } = run(40, bump(15, 85), undefined, { pulse: (s) => (s > 15 ? 80 : null) });
    expect(resolved[0]!.pulseDelta).toBeNull();
    expect(describeMoment(resolved[0]!)).toContain('pulse: not enough signal');
  });

  it('noisy neutral stream with no reactions produces zero events over 5 minutes', () => {
    let seed = 1;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 16;
    expect(run(300, () => 8 + noise(), () => 3 + noise()).detected).toHaveLength(0);
  });
});
