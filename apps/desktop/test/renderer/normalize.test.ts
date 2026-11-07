import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { LM, normalize, poseOf, tsToUs, type DecodedMetrics } from '../../src/renderer/src/sensing/normalize';

// Fixtures go through the SDK's own generated protobuf codec, so they decode exactly as live payloads do
// (int64 timestamps as Long objects, enums as numbers, empty repeated fields as []).
const require = createRequire(import.meta.url);
const { Metrics, decodeMetrics } = require('@smartspectra/node-sdk/messages') as {
  Metrics: { create(o: unknown): unknown; encode(m: unknown): { finish(): Uint8Array } };
  decodeMetrics(b: Uint8Array): DecodedMetrics;
};
const roundTrip = (o: unknown) => decodeMetrics(Metrics.encode(Metrics.create(o)).finish());
const T = 1_731_000_000_000_000;

describe('normalize(decoded SmartSpectra metrics)', () => {
  it('reads the breathing wave, breath stops, blinks, talking, expressions, pulse and HRV', () => {
    const n = normalize(
      roundTrip({
        breathing: {
          upperTrace: [
            { value: 0.75, stable: true, timestamp: T + 33_333 },
            { value: 0.5, stable: false, timestamp: T },
          ],
          rate: [{ value: 14.2, stable: true, confidence: 61, timestamp: T }],
          apnea: [{ detected: true, stable: true, timestamp: T }],
        },
        cardio: { pulseRate: [{ value: 72.4, stable: true, confidence: 55, timestamp: T }], hrv: [{ rmssd: 42.5, meanNn: 830, sdnn: 50, baevsky: 90, confidence: 61, stable: true, timestamp: T }] },
        face: {
          blinking: [{ detected: true, stable: true, timestamp: T }],
          talking: [{ detected: false, stable: true, timestamp: T }],
          expression: [{ stable: true, timestamp: T, scores: [{ type: 5, confidence: 82 }, { type: 8, confidence: 4 }, { type: 1, confidence: 7 }, { type: 3, confidence: 11 }, { type: 6, confidence: 14 }] }],
        },
      }),
    );
    expect(n.trace).toEqual([
      { t: T, v: 0.5, stable: false },
      { t: T + 33_333, v: 0.75, stable: true },
    ]);
    expect(n.apnea).toEqual([{ t: T, detected: true, stable: true }]);
    expect(n.blink).toEqual([{ t: T, detected: true, stable: true }]);
    expect(n.talking).toEqual([{ t: T, detected: false, stable: true }]);
    expect(n.expressions).toEqual([{ t: T, smile: 82, surprise: 4, frown: 11, stable: true }]);
    expect(n.rate[0]).toMatchObject({ value: expect.closeTo(14.2, 3), confidence: 61, stable: true });
    expect(n.pulse[0]).toMatchObject({ value: expect.closeTo(72.4, 3), confidence: 55 });
    expect(n.hrv).toEqual([{ t: T, rmssd: 42.5, confidence: 61, stable: true }]);
  });

  it('handles empty payloads and missing groups', () => {
    for (const d of [roundTrip({}), roundTrip({ breathing: { upperTrace: [], rate: [] } }), null, undefined, {} as DecodedMetrics]) {
      const n = normalize(d);
      expect(Object.values(n).every((a) => Array.isArray(a) && a.length === 0)).toBe(true);
    }
  });

  it('drops invalid values instead of passing them on', () => {
    const n = normalize({
      breathing: { upperTrace: [{ value: Number.NaN, timestamp: T }, { value: 1, timestamp: 0 }], rate: [{ value: 0, confidence: 50, timestamp: T }] },
      cardio: { pulseRate: [{ value: 0, confidence: 0, timestamp: T }], hrv: [{ rmssd: -3, timestamp: T }] },
    });
    expect(n.trace).toEqual([]);
    expect(n.rate).toEqual([]);
    expect(n.pulse).toEqual([]);
    expect(n.hrv).toEqual([]);
  });

  it('reads int64 timestamps in every form protobufjs produces', () => {
    expect(tsToUs({ toNumber: () => 5 })).toBe(5);
    expect(tsToUs(5n)).toBe(5);
    expect(tsToUs('7')).toBe(7);
    expect(Number.isNaN(tsToUs(null))).toBe(true);
  });

  it('reduces 478 face landmarks to head pose, and never keeps the points', () => {
    // A face 0.2 wide centred at x 0.5; the nose tip sits a little left (-0.02 of width) and 40% of the way down.
    const face = (noseX: number, noseY: number) => {
      const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
      pts[LM.faceLeft] = { x: 0.4, y: 0.5 };
      pts[LM.faceRight] = { x: 0.6, y: 0.5 };
      pts[LM.eyeLeft] = { x: 0.45, y: 0.4 };
      pts[LM.eyeRight] = { x: 0.55, y: 0.4 };
      pts[LM.chin] = { x: 0.5, y: 0.6 };
      pts[LM.noseTip] = { x: noseX, y: noseY };
      return pts;
    };
    const p = poseOf(face(0.496, 0.48))!;
    expect(p.yaw).toBeCloseTo(-0.02, 5);
    expect(p.pitch).toBeCloseTo(0.4, 5);
    const n = normalize(roundTrip({ face: { landmarks: [{ value: face(0.56, 0.5), stable: true, timestamp: T }, { value: face(0.5, 0.5).slice(0, 100), stable: true, timestamp: T + 33_000 }] } }));
    expect(n.pose).toHaveLength(1);
    expect(n.pose[0]!.yaw).toBeCloseTo(0.3, 5);
    expect(n.pose[0]!.t).toBe(T);
    expect(Object.keys(n.pose[0]!).sort()).toEqual(['pitch', 'stable', 't', 'yaw']);
    // Degenerate sets are dropped, not passed on.
    expect(poseOf(face(0.5, 0.5).map(() => ({ x: 0.5, y: 0.5 })))).toBeNull();
    expect(poseOf(null)).toBeNull();
  });
});
