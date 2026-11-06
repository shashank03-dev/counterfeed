import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { normalize, tsToUs, type DecodedMetrics } from '../../src/renderer/src/sensing/normalize';

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
  it('turns a real decoded payload into SignalFrames, rates and expressions', () => {
    const d = roundTrip({
      breathing: {
        upperTrace: [
          { value: 0.5, stable: false, timestamp: T },
          { value: 0.75, stable: true, timestamp: T + 33_333 },
        ],
        rate: [{ value: 14.2, stable: true, confidence: 61, timestamp: T + 33_333 }],
      },
      cardio: { pulseRate: [{ value: 72.4, stable: true, confidence: 55, timestamp: T + 33_333 }] },
      face: {
        talking: [{ detected: true, stable: true, timestamp: T }],
        expression: [{ stable: true, timestamp: T, scores: [{ type: 5, confidence: 82 }, { type: 8, confidence: 4 }, { type: 6, confidence: 14 }] }],
      },
    });
    const n = normalize(d);
    expect(n.frames).toEqual([
      { t: T, trace: 0.5, traceStable: false, talking: true },
      { t: T + 33_333, trace: 0.75, traceStable: true, pulse: expect.closeTo(72.4, 3), pulseConf: 55 },
    ]);
    expect(n.breathingRate).toMatchObject({ value: expect.closeTo(14.2, 3), confidence: 61, stable: true });
    expect(n.pulse).toMatchObject({ value: expect.closeTo(72.4, 3), stable: true });
    expect(n.expressions).toEqual([{ t: T, happy: 82, surprise: 4, stable: true }]);
    expect(n.talking).toEqual({ t: T, detected: true, stable: true });
  });

  it('handles empty arrays and missing groups (rates absent between updates)', () => {
    for (const d of [roundTrip({}), roundTrip({ breathing: { upperTrace: [], rate: [] } }), null, undefined, {} as DecodedMetrics]) {
      const n = normalize(d);
      expect(n.frames).toEqual([]);
      expect(n.breathingRate).toBeNull();
      expect(n.pulse).toBeNull();
      expect(n.talking).toBeNull();
      expect(n.expressions).toEqual([]);
    }
  });

  it('keeps confidence-0 warm-up samples (the caller decides) but drops invalid values', () => {
    const n = normalize({
      breathing: { rate: [{ value: 12, confidence: 0, stable: false, timestamp: T }], upperTrace: [{ value: Number.NaN, timestamp: T }, { value: 1, timestamp: 0 }] },
      cardio: { pulseRate: [{ value: 0, confidence: 0, timestamp: T }] },
    });
    expect(n.breathingRate).toMatchObject({ value: 12, confidence: 0, stable: false });
    expect(n.frames).toEqual([]);
    expect(n.pulse).toMatchObject({ value: 0 }); // reported as the latest rate, but never sent as a frame
  });

  it('only sends stable talking detections (unstable "not talking" is not silence)', () => {
    const n = normalize({ face: { talking: [{ detected: false, stable: false, timestamp: T }, { detected: true, stable: true, timestamp: T + 1 }] } });
    expect(n.frames).toEqual([{ t: T + 1, talking: true }]);
  });

  it('clamps out-of-range numbers so frames always pass the wire schema', () => {
    const n = normalize({ cardio: { pulseRate: [{ value: 999, confidence: 140, timestamp: T }] } });
    expect(n.frames[0]).toEqual({ t: T, pulse: 250, pulseConf: 100 });
  });

  it('accepts every timestamp encoding: number, bigint, string, Long', () => {
    expect(tsToUs(5)).toBe(5);
    expect(tsToUs(5n)).toBe(5);
    expect(tsToUs('5')).toBe(5);
    expect(tsToUs({ toNumber: () => 5 })).toBe(5);
    expect(Number.isNaN(tsToUs(null))).toBe(true);
  });

  it('accepts enum names as well as numbers for expression types', () => {
    const n = normalize({ face: { expression: [{ timestamp: T, stable: false, scores: [{ type: 'HAPPY', confidence: 40 }, { type: 'SURPRISE', confidence: 70 }] }] } });
    expect(n.expressions[0]).toEqual({ t: T, happy: 40, surprise: 70, stable: false });
  });
});
