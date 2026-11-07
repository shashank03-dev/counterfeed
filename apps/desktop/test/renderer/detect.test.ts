import { describe, expect, it } from 'vitest';
import {
  blinkRate,
  blinkTimes,
  breathHolds,
  breathSize,
  codeIntervals,
  expressionEvents,
  faceIntervals,
  faceStateOf,
  MAX_HOLD_US,
  POSE,
  poseAway,
  viewIntervals,
  noBlinkStretches,
  noBlinkThreshold,
  screenChanges,
  steadyPulse,
  talkingIntervals,
} from '../../src/renderer/src/analysis/detect';
import { erode, intersect, merge, subtract, total } from '../../src/renderer/src/analysis/intervals';
import type { Detection, ExpressionSample, PoseSample, TraceSample } from '../../src/renderer/src/sensing/normalize';
import { applyValidation, V } from '../../src/renderer/src/sensing/quality';
import { gaussian, mulberry32 } from '../../src/renderer/src/lib/rng';

const S = 1e6;
const T0 = 1_731_000_000 * S;
const at = (s: number) => T0 + s * S;

/** Breathing at ~15/min, 30 Hz, slight rate wobble and noise; flat (amplitude 2%) inside `flat` windows (s). */
function breathing(seconds: number, flat: [number, number][] = [], seed = 1): TraceSample[] {
  const g = gaussian(mulberry32(seed));
  const out: TraceSample[] = [];
  let ph = 0;
  for (let i = 0; i < seconds * 30; i++) {
    const s = i / 30;
    ph += (2 * Math.PI * (0.25 + 0.02 * Math.sin(s / 9))) / 30;
    const amp = flat.some(([a, b]) => s >= a && s < b) ? 0.02 : 1;
    out.push({ t: at(s), v: amp * Math.sin(ph) + 0.03 * g() + 0.002 * s, stable: true });
  }
  return out;
}

/** Blink detection stream at 30 Hz: a blink is ~120 ms of `detected`. */
function blinkStream(seconds: number, blinksAt: number[]): Detection[] {
  const out: Detection[] = [];
  for (let i = 0; i < seconds * 30; i++) {
    const s = i / 30;
    out.push({ t: at(s), detected: blinksAt.some((b) => s >= b && s < b + 0.12), stable: true });
  }
  return out;
}

/**
 * Head pose at 30 Hz, shaped like the real recording: facing = yaw -0.05, pitch 0.33 with ±0.01 noise.
 * `segments` override [from, to, yaw, pitch] in seconds; the first matching segment wins (list inner ones first).
 */
function poses(seconds: number, segments: [number, number, number, number][] = [], seed = 3): PoseSample[] {
  const g = gaussian(mulberry32(seed));
  const out: PoseSample[] = [];
  for (let i = 0; i < seconds * 30; i++) {
    const s = i / 30;
    const seg = segments.find(([a, b]) => s >= a && s < b);
    out.push({ t: at(s), yaw: (seg ? seg[2] : -0.05) + 0.01 * g(), pitch: (seg ? seg[3] : 0.33) + 0.01 * g(), stable: true });
  }
  return out;
}
const secs = (list: { start: number; end: number }[]) => list.map((i) => [Math.round(((i.start - T0) / S) * 10) / 10, Math.round(((i.end - T0) / S) * 10) / 10]);

describe('intervals', () => {
  it('merges, intersects and subtracts', () => {
    const a = merge([{ start: 0, end: 5 }, { start: 4, end: 8 }, { start: 10, end: 12 }]);
    expect(a).toEqual([{ start: 0, end: 8 }, { start: 10, end: 12 }]);
    expect(intersect(a, [{ start: 6, end: 11 }])).toEqual([{ start: 6, end: 8 }, { start: 10, end: 11 }]);
    expect(subtract(a, [{ start: 2, end: 3 }, { start: 7, end: 11 }])).toEqual([{ start: 0, end: 2 }, { start: 3, end: 7 }, { start: 11, end: 12 }]);
    expect(total(a)).toBe(10);
    expect(merge([{ start: 0, end: 1 }, { start: 1.5, end: 2 }], 1)).toEqual([{ start: 0, end: 2 }]);
  });
  it('erodes both ends and drops what vanishes', () => {
    expect(erode([{ start: 0, end: 10 }, { start: 20, end: 23 }], 2)).toEqual([{ start: 2, end: 8 }]);
  });
});

describe('face state from SDK validation codes', () => {
  it('splits a span into clear view, looking away, and unclear (motion, light)', () => {
    const q = [
      { t: at(0), code: V.cameraTuning },
      { t: at(2), code: V.ok },
      { t: at(10), code: V.notForward },
      { t: at(12), code: V.ok },
      { t: at(15), code: V.excessiveMotion },
      { t: at(16), code: V.ok },
    ];
    const f = faceIntervals(q, { start: at(0), end: at(20) });
    expect(total(f.ok) / S).toBeCloseTo(8 + 3 + 4, 5);
    expect(total(f.away) / S).toBeCloseTo(2, 5);
    expect(total(f.unclear) / S).toBeCloseTo(2 + 1, 5);
  });
  it('chest-only codes keep the face measures (a laptop camera rarely sees the chest)', () => {
    for (const c of [V.chestNotVisible, V.tooHigh, V.tooLow, V.tooClose, V.tooFar, V.notCentered]) expect(faceStateOf(c)).toBe('ok');
    for (const c of [V.noFace, V.notForward]) expect(faceStateOf(c)).toBe('away');
    for (const c of [V.excessiveMotion, V.tooDark, V.tooBright, V.cameraTuning, V.multipleFaces]) expect(faceStateOf(c)).toBe('unclear');
    const q = [{ t: at(0), code: V.ok }, { t: at(4), code: V.chestNotVisible }, { t: at(9), code: V.ok }];
    expect(total(faceIntervals(q, { start: at(0), end: at(10) }).ok) / S).toBeCloseTo(10);
    expect(secs(codeIntervals(q, { start: at(0), end: at(10) }, (c) => c === V.ok))).toEqual([[0, 4], [9, 10]]);
  });
  it('treats time before any report as unclear, and no face as away', () => {
    const f = faceIntervals([{ t: at(5), code: V.noFace }], { start: at(0), end: at(10) });
    expect(total(f.unclear) / S).toBeCloseTo(5);
    expect(total(f.away) / S).toBeCloseTo(5);
  });
});

describe('settle checklist from SDK codes', () => {
  it('"chest not in view" all session: face framing, light and stillness are fine; only breathing warns', () => {
    const q = applyValidation(applyValidation(null, V.cameraTuning, ''), V.chestNotVisible, 'Place more of the chest in view.');
    expect(q).toMatchObject({ framing: 'ok', light: 'ok', stillness: 'ok', breathing: 'warn' });
  });
  it('a real problem still warns, and a chest code does not hide an earlier one', () => {
    const dark = applyValidation(null, V.tooDark, '');
    expect(applyValidation(dark, V.chestNotVisible, '').light).toBe('warn');
    expect(applyValidation(null, V.notForward, '').framing).toBe('warn');
    expect(applyValidation(null, V.ok, '')).toMatchObject({ framing: 'ok', light: 'ok', stillness: 'ok', breathing: 'ok' });
  });
});

describe('looking away, from head pose', () => {
  const span = { start: at(0), end: at(120) };
  it('finds a head turn and a look down against your own normal', () => {
    const p = poses(120, [[30, 36, 0.85, 0.16], [60, 67, -0.03, 0.48]]);
    const a = poseAway(p, span);
    expect(a).toHaveLength(2);
    expect(secs(a)[0]![0]).toBeCloseTo(30, 0);
    expect(secs(a)[0]![1]).toBeCloseTo(36, 0);
    expect(secs(a)[1]![0]).toBeCloseTo(60, 0);
    expect(secs(a)[1]![1]).toBeCloseTo(67, 0);
  });
  it('ignores posture changes (sitting back) and very short flickers', () => {
    const p = poses(120, [[80, 80.2, 0.9, 0.33], [40, 120, -0.04, 0.12]]);
    expect(secs(poseAway(p, span))).toEqual([]);
  });
  it('follows a new posture: a look down after sitting back is measured from the new normal', () => {
    // Sat back at 20 s (pitch 0.20); looking down from there reaches 0.33, which was "normal" before.
    const p = poses(120, [[90, 96, -0.04, 0.34], [20, 120, -0.04, 0.2]]);
    const a = secs(poseAway(p, span));
    expect(a).toHaveLength(1);
    expect(a[0]![0]).toBeCloseTo(90, 0);
  });
  it('uses the seed as your normal from the first sample (watching starts already turned away)', () => {
    const seed = poses(30).map((x) => ({ ...x, t: x.t - 30 * S }));
    const p = poses(60, [[0, 5, 0.8, 0.33]]);
    const a = secs(poseAway(p, { start: at(0), end: at(60) }, seed));
    expect(a).toHaveLength(1);
    expect(a[0]![0]).toBeCloseTo(0, 0);
    expect(a[0]![1]).toBeCloseTo(5, 0);
  });
  it('re-learns your normal after a very long run, instead of calling the rest of the session "away"', () => {
    const p = poses(200, [[20, 200, -0.04, 0.5]]);
    const a = poseAway(p, { start: at(0), end: at(200) });
    expect(total(a) / S).toBeLessThanOrEqual(POSE.maxRunUs / S + 1);
  });
  it('a gap in the landmark stream ends a run', () => {
    const p = poses(60, [[10, 30, 0.8, 0.33]]).filter((x) => x.t < at(15) || x.t >= at(25));
    const a = secs(poseAway(p, { start: at(0), end: at(60) }));
    expect(a[0]![1]).toBeLessThanOrEqual(15.1);
  });
  it('no landmarks: falls back to the SDK codes alone', () => {
    expect(poseAway([], span)).toEqual([]);
  });
});

describe('where each measure is trusted (viewIntervals)', () => {
  it('a head turn hidden behind "chest not in view" is still caught', () => {
    // The real failure: the SDK said "place more of the chest in view" the whole time, so the turn never surfaced.
    const q = [{ t: at(0), code: V.chestNotVisible }];
    const v = viewIntervals(q, { start: at(0), end: at(60) }, poses(60, [[30, 36, 0.85, 0.16]]));
    expect(secs(v.away)).toHaveLength(1);
    expect(total(v.ok) / S).toBeCloseTo(54, 0);
    expect(v.breath).toEqual([]);
  });
  it('breathing is read only while the SDK is fully happy and the face is toward the screen', () => {
    const q = [{ t: at(0), code: V.ok }, { t: at(20), code: V.chestNotVisible }, { t: at(30), code: V.ok }];
    const v = viewIntervals(q, { start: at(0), end: at(60) }, poses(60, [[40, 45, 0.85, 0.2]]));
    expect(total(v.breath) / S).toBeCloseTo(20 + 10 + 15, 0);
    expect(total(v.ok) / S).toBeCloseTo(55, 0);
  });
});

describe('blinks', () => {
  it('counts rising edges once, and gives a rate over clear view only', () => {
    const d = blinkStream(60, [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57]);
    const b = blinkTimes(d);
    expect(b).toHaveLength(19);
    expect(blinkRate(b, d, [{ start: at(0), end: at(60) }])).toBeCloseTo(19, 5);
    expect(blinkRate(b, d, [{ start: at(0), end: at(10) }])).toBeNull(); // under 15 s: no rate
    expect(blinkRate(b, [], [{ start: at(0), end: at(60) }])).toBeNull(); // no blink data at all
  });
  it('a long stretch without blinking is found, split where the face was out of view', () => {
    const b = blinkTimes(blinkStream(60, [2, 5, 30, 33]));
    const clear = [{ start: at(0), end: at(60) }];
    // 20/min -> a 3 s gap x 2.5 = 7.5 s, raised to the 8 s minimum.
    expect(noBlinkThreshold(20) / S).toBe(8);
    const st = noBlinkStretches(b, clear, 12 * S);
    expect(st.map((i) => [Math.round((i.start - T0) / S), Math.round((i.end - T0) / S)])).toEqual([
      [5, 30],
      [33, 60],
    ]);
    // Looking away 15-17 s breaks the 5-30 stretch into two shorter ones (only 17-30 is still 12 s+).
    const st2 = noBlinkStretches(b, [{ start: at(0), end: at(15) }, { start: at(17), end: at(60) }], 12 * S);
    expect(st2.map((i) => Math.round((i.start - T0) / S))).toEqual([17, 33]);
  });
  it('threshold stays between 8 and 20 s and defaults to 12 s', () => {
    expect(noBlinkThreshold(null) / S).toBe(12);
    expect(noBlinkThreshold(60) / S).toBe(8);
    expect(noBlinkThreshold(3) / S).toBe(20);
  });
});

describe('breathing pauses', () => {
  const all = [{ start: at(0), end: at(120) }];
  it('finds a flat stretch of the wave and nothing in ordinary breathing', () => {
    const tr = breathing(120, [[50, 60]]);
    const ref = breathSize(tr, [{ start: at(0), end: at(40) }]);
    expect(ref).toBeGreaterThan(1.6);
    const h = breathHolds(tr, all, ref, []);
    expect(h).toHaveLength(1);
    expect((h[0]!.start - T0) / S).toBeGreaterThan(48.5);
    expect((h[0]!.start - T0) / S).toBeLessThan(51);
    expect((h[0]!.end - T0) / S).toBeGreaterThan(59);
    expect((h[0]!.end - T0) / S).toBeLessThan(61);
    expect(breathHolds(breathing(120, [], 2), all, ref, [])).toHaveLength(0);
  });
  it('ignores pauses shorter than 6 s (a normal gap between breaths)', () => {
    const tr = breathing(120, [[50, 54]]);
    expect(breathHolds(tr, all, breathSize(tr, [{ start: at(0), end: at(40) }]), [])).toHaveLength(0);
  });
  it('never counts a pause while you were talking or out of view', () => {
    const tr = breathing(120, [[50, 60]]);
    const ref = breathSize(tr, [{ start: at(0), end: at(40) }]);
    const talk = talkingIntervals(Array.from({ length: 40 }, (_, i) => ({ t: at(48 + i * 0.3), detected: true, stable: true })));
    expect(breathHolds(tr, subtract(all, talk), ref, [])).toHaveLength(0);
    expect(breathHolds(tr, [{ start: at(0), end: at(52) }, { start: at(62), end: at(120) }], ref, [])).toHaveLength(0);
  });
  it('adds SDK breath-stop detections of 5 s or more', () => {
    const tr = breathing(60);
    const ap: Detection[] = [
      { t: at(20), detected: true, stable: true },
      { t: at(26), detected: false, stable: true },
      { t: at(40), detected: true, stable: true },
      { t: at(42), detected: false, stable: true },
    ];
    const h = breathHolds(tr, [{ start: at(0), end: at(60) }], breathSize(tr, [{ start: at(0), end: at(60) }]), ap);
    expect(h.map((i) => Math.round((i.start - T0) / S))).toEqual([20]);
  });
  it('a flat stretch longer than 30 s is a faded signal, not a pause', () => {
    const tr = breathing(120, [[40, 40 + MAX_HOLD_US / S + 8]]);
    const ref = breathSize(tr, [{ start: at(0), end: at(35) }]);
    expect(breathHolds(tr, [{ start: at(0), end: at(120) }], ref, [])).toEqual([]);
  });
  it('a flat stretch the SDK marked mostly unstable is not a pause', () => {
    const tr = breathing(90, [[40, 52]]).map((x) => ({ ...x, stable: !(x.t >= at(38) && x.t < at(54)) }));
    const ref = breathSize(tr, [{ start: at(0), end: at(35) }]);
    expect(breathHolds(tr, [{ start: at(0), end: at(90) }], ref, [])).toEqual([]);
    const ok = breathing(90, [[40, 52]]);
    expect(breathHolds(ok, [{ start: at(0), end: at(90) }], ref, [])).toHaveLength(1);
  });
  it('with no reference size, finds nothing rather than guessing', () => {
    expect(breathHolds(breathing(60, [[20, 30]]), [{ start: at(0), end: at(60) }], null, [])).toHaveLength(0);
  });
});

describe('facial-expression moments', () => {
  const clear = [{ start: at(0), end: at(60) }];
  const series = (f: (s: number) => Partial<ExpressionSample>): ExpressionSample[] =>
    Array.from({ length: 60 * 10 }, (_, i) => ({ t: at(i / 10), smile: 3, surprise: 2, frown: 1, stable: true, ...f(i / 10) }));
  it('a smile that rises well above your level is one moment, with its peak', () => {
    const r = expressionEvents(series((s) => ({ smile: s >= 30 && s < 33 ? 85 : 3 })), clear);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: 'smile' });
    expect(r.events[0]!.peak).toBeGreaterThan(80);
    expect(r.smileUs / S).toBeGreaterThan(2);
    expect(r.smileUs / S).toBeLessThan(4);
  });
  it('a face that is always smiley is not a moment; small wobbles are not either', () => {
    expect(expressionEvents(series(() => ({ smile: 70 })), clear).events).toHaveLength(0);
    expect(expressionEvents(series((s) => ({ surprise: 20 + 15 * Math.sin(s) })), clear).events).toHaveLength(0);
  });
  it('only counts while the face is in clear view', () => {
    expect(expressionEvents(series((s) => ({ frown: s >= 30 && s < 33 ? 80 : 1 })), [{ start: at(0), end: at(29) }]).events).toHaveLength(0);
  });
});

describe('pulse and screen changes', () => {
  it('uses only steady pulse readings in the SDK range', () => {
    const p = [
      { t: at(1), value: 70, confidence: 60, stable: true },
      { t: at(2), value: 72, confidence: 60, stable: true },
      { t: at(3), value: 150, confidence: 90, stable: true },
      { t: at(4), value: 71, confidence: 10, stable: false },
      { t: at(5), value: 74, confidence: 60, stable: true },
    ];
    expect(steadyPulse(p, [{ start: at(0), end: at(10) }])).toBe(72);
    expect(steadyPulse(p.slice(0, 2), [{ start: at(0), end: at(10) }])).toBeNull();
  });
  it('counts big on-screen changes at most once per 0.8 s', () => {
    const d = [0.02, 0.3, 0.25, 0.01, 0.05, 0.4, 0.02].map((v, i) => ({ t: at(i * 0.5), d: v }));
    expect(screenChanges(d, [{ start: at(0), end: at(10) }])).toHaveLength(2);
  });
});
