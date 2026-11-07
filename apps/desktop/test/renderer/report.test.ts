import { describe, expect, it } from 'vitest';
import { ReportSchema } from '@counterfeed/shared';
import { PROBLEMS } from '../../src/renderer/src/app/problems';
import { heldMoments, lulls, opening } from '../../src/renderer/src/analysis/curve';
import { buildReport, pickThumbs, type Capture } from '../../src/renderer/src/analysis/report';
import { band, score, scoreParts } from '../../src/renderer/src/analysis/score';
import { TimeMap, playingIntervals } from '../../src/renderer/src/analysis/timemap';
import { BANNED_WORDS, findBanned, suggest, summarize } from '../../src/renderer/src/analysis/words';
import { emptyNormalized, type Normalized } from '../../src/renderer/src/sensing/normalize';
import { V } from '../../src/renderer/src/sensing/quality';

const S = 1e6;
const T0 = 1_731_000_000 * S;
const at = (s: number) => T0 + s * S;

/**
 * A synthetic session shaped like the e2e test script: 40 s settle with 20 blinks/min and normal breathing, then
 * 120 s of watching with blinks every 7 s (none 60-90), two 8-10 s breathing pauses, a smile and a look away.
 */
function capture(over: Partial<Capture> = {}, watchS = 120): Capture {
  const n: Normalized = emptyNormalized();
  let ph = 0;
  let lastBlink = -99;
  const end = 40 + watchS;
  for (let i = 0; i < end * 30; i++) {
    const s = i / 30;
    ph += (2 * Math.PI * 0.25) / 30;
    const hold = (s >= 60 && s < 70) || (s >= 100 && s < 108);
    n.trace.push({ t: at(s), v: (hold ? 0.02 : 1) * Math.sin(ph), stable: true });
    const every = s < 40 ? 3 : 7;
    const gap = s >= 60 && s < 90;
    const b = !gap && s - lastBlink >= every;
    if (b) lastBlink = s;
    n.blink.push({ t: at(s), detected: b || s - lastBlink < 0.1, stable: true });
    if (i % 3 === 0) n.expressions.push({ t: at(s), smile: s >= 80 && s < 83 ? 88 : 4, surprise: 2, frown: 1, stable: true });
    if (i % 30 === 0) {
      n.pulse.push({ t: at(s), value: s < 40 ? 68 : 74, confidence: 70, stable: true });
      n.rate.push({ t: at(s), value: 15, confidence: 60, stable: true });
      n.talking.push({ t: at(s), detected: false, stable: true });
      if (s > 100) n.hrv.push({ t: at(s), rmssd: 41, confidence: 60, stable: true });
    }
  }
  return {
    mode: 'feed',
    signal: 'test',
    startedAt: 1_731_000_000_000,
    endedAt: 1_731_000_000_000 + end * 1000,
    settle: { start: at(0), end: at(40) },
    watch: { start: at(40), end: at(end) },
    active: [{ start: at(40), end: at(end) }],
    samples: n,
    quality: [
      { t: at(0), code: V.ok },
      { t: at(112), code: V.notForward },
      { t: at(115), code: V.ok },
    ],
    timemap: null,
    diffs: null,
    content: { kind: 'window', name: 'Instagram (iPhone Mirroring)', app: 'iPhone Mirroring', durationMs: null },
    title: null,
    partial: false,
    notes: [],
    baselineForced: false,
    felt: { before: 4, after: 3 },
    guessMs: 60_000,
    ratings: null,
    reviewNote: null,
    ...over,
  };
}

describe('buildReport (feed)', () => {
  const { report: r, events } = buildReport(capture(), 'r-test-0001');

  it('is a valid stored report', () => {
    expect(() => ReportSchema.parse(r)).not.toThrow();
  });
  it('finds the two breathing pauses, the long stare, the smile and the look away', () => {
    expect(r.metrics.holds).toBe(2);
    expect(r.metrics.longestHoldMs! / 1000).toBeGreaterThan(9);
    expect(r.events.filter((e) => e.kind === 'noblink').length).toBeGreaterThanOrEqual(1);
    expect(r.metrics.longestNoBlinkMs! / 1000).toBeGreaterThanOrEqual(30);
    expect(r.events.filter((e) => e.kind === 'smile')).toHaveLength(1);
    expect(r.metrics.awayCount).toBe(1);
    // Event times are on the watching clock: the first pause at ~20 s into watching (60 s minus 40 s settle).
    const first = r.events.find((e) => e.kind === 'hold')!;
    expect(first.atMs / 1000).toBeGreaterThan(18);
    expect(first.atMs / 1000).toBeLessThan(21);
    expect(events.find((e) => e.kind === 'hold')!.t).toBeGreaterThan(at(58));
  });
  it('compares with your normal: blinking dropped, pulse rose', () => {
    expect(r.baseline.quality).toBe('good');
    expect(r.baseline.blinkPerMin).toBe(21); // 14 blinks (every 3 s from 0 to 39 s) in 40 s
    expect(r.metrics.blinkPerMin!).toBeLessThan(8);
    expect(r.metrics.pulseDelta).toBe(6);
    expect(r.metrics.hrvMs).toBe(41);
  });
  it('scores, summarises and suggests in plain words', () => {
    expect(r.pull.score).toBeGreaterThan(50);
    expect(r.pull.parts.map((p) => p.key).sort()).toEqual(['blinking', 'eyes', 'pauses', 'stare', 'time']);
    expect(r.summary).toMatch(/pull:/);
    expect(r.suggestion).not.toBeNull();
    expect(findBanned(JSON.stringify(r))).toEqual([]);
  });
  it('builds an attention curve with a clear peak during the stare', () => {
    expect(r.curveAxis).toBe('watch');
    const peak = heldMoments(r.curve, r.curveBinMs, 1)[0]!;
    expect(peak.atMs / 1000).toBeGreaterThan(15);
    expect(peak.atMs / 1000).toBeLessThan(55);
  });
});

describe('buildReport edge cases', () => {
  it('a session under 20 s is not scored, and says why', () => {
    const { report } = buildReport(capture({}, 15), 'r-test-0002');
    expect(report.pull.score).toBeNull();
    expect(report.notes.join(' ')).toMatch(/too short/);
    expect(() => ReportSchema.parse(report)).not.toThrow();
  });
  it('with "continue anyway" (no normal), comparisons are left out but measuring still works', () => {
    const { report } = buildReport(capture({ baselineForced: true }), 'r-test-0003');
    expect(report.baseline.quality).toBe('weak');
    expect(report.pull.parts.find((p) => p.key === 'blinking')).toBeUndefined();
    expect(report.metrics.pulseDelta).toBeNull();
    expect(report.metrics.holds).toBe(2); // pauses still found against the watch period's own breath size
    expect(report.notes.join(' ')).toMatch(/normal couldn’t be measured/);
  });
  it('no camera view at all: nothing invented', () => {
    const { report } = buildReport(capture({ quality: [{ t: at(0), code: V.noFace }] }), 'r-test-0004');
    expect(report.metrics.holds).toBeNull();
    expect(report.notes.join(' ')).toMatch(/breathing couldn’t be read/);
    expect(report.events.every((e) => e.kind === 'away')).toBe(true);
    expect(report.metrics.coverage).toBe(0);
    expect(report.notes.join(' ')).toMatch(/clear view of your face for under half/);
  });
  it('a video review maps moments to the video, and excludes paused time', () => {
    const tm = new TimeMap();
    tm.add({ t: at(40), c: 0, playing: true });
    tm.add({ t: at(90), c: 50_000, playing: false }); // paused 90-100 s
    tm.add({ t: at(100), c: 50_000, playing: true });
    const c = capture({ mode: 'review', timemap: tm, active: playingIntervals(tm.all, at(160)), content: { kind: 'video', name: 'demo.mp4', app: null, durationMs: 110_000 }, guessMs: null, felt: { before: null, after: null }, ratings: { technology: 4, usability: 3, originality: 5 } });
    const { report } = buildReport(c, 'r-test-0005');
    expect(report.curveAxis).toBe('content');
    expect(report.watchMs).toBe(110_000);
    const second = report.events.filter((e) => e.kind === 'hold')[1]!;
    expect(second.contentMs! / 1000).toBeGreaterThan(48); // wall 100 s = video 50 s
    expect(second.contentMs! / 1000).toBeLessThan(52);
    expect(report.pull.parts.find((p) => p.key === 'time')).toBeUndefined();
    expect(() => ReportSchema.parse(report)).not.toThrow();
  });
});

describe('buildReport with a laptop camera (face in view, chest not)', () => {
  // The real-world case: the SDK says "place more of the chest in view" the whole session. Face measures must
  // still work, breathing must be left out (not reported as zero pauses), and head turns must still be caught.
  const c = capture({ quality: [{ t: at(0), code: V.chestNotVisible }] });
  for (let i = 0; i < 160 * 30; i++) {
    const s = i / 30;
    const turned = s >= 70 && s < 75;
    const down = s >= 120 && s < 126;
    c.samples.pose.push({ t: at(s), yaw: turned ? 0.8 : -0.05, pitch: down ? 0.48 : 0.33, stable: true });
  }
  const { report } = buildReport(c, 'r-test-laptop');
  it('is a valid stored report, with your normal measured from the face', () => {
    expect(() => ReportSchema.parse(report)).not.toThrow();
    expect(report.baseline.quality).toBe('good');
    expect(report.baseline.blinkPerMin).not.toBeNull();
  });
  it('leaves breathing out instead of reporting zero pauses', () => {
    expect(report.metrics.holds).toBeNull();
    expect(report.metrics.breathPerMin).toBeNull();
    expect(report.events.some((e) => e.kind === 'hold')).toBe(false);
    expect(report.pull.parts.some((p) => p.key === 'pauses')).toBe(false);
    expect(report.notes.join(' ')).toMatch(/breathing couldn’t be read/);
    expect(report.summary).not.toMatch(/breath/i);
    expect(report.suggestion?.key).not.toBe('pauses');
  });
  it('still catches the head turn and the look down, with the chest code hiding them', () => {
    const away = report.events.filter((e) => e.kind === 'away').map((e) => Math.round((40_000 + e.atMs) / 1000));
    expect(away).toEqual([70, 120]);
    expect(report.metrics.awayCount).toBe(2);
  });
  it('still reads blinking, stares and the smile', () => {
    expect(report.pull.parts.map((p) => p.key)).toEqual(expect.arrayContaining(['blinking', 'stare', 'eyes']));
    expect(report.events.some((e) => e.kind === 'smile')).toBe(true);
    expect(report.pull.score).not.toBeNull();
  });
});

describe('score', () => {
  const base = { mode: 'feed' as const, baselineGood: true, baseBlinkPerMin: 18, blinkPerMin: 9, holds: 3, activeMin: 5, longestNoBlinkUs: 20e6, facingShare: 0.95, watchMs: 300_000, guessMs: 180_000 };
  it('stays within 0-100 at the extremes and needs two parts', () => {
    expect(score(scoreParts({ ...base, blinkPerMin: 0, holds: 50, longestNoBlinkUs: 600e6, facingShare: 1, guessMs: 0 }))).toBe(100);
    expect(score(scoreParts({ ...base, blinkPerMin: 40, holds: 0, longestNoBlinkUs: 0, facingShare: 0.2, guessMs: 900_000 }))).toBe(0);
    expect(score(scoreParts({ ...base, baselineGood: false, holds: 0, activeMin: 0.1, longestNoBlinkUs: null, facingShare: null, guessMs: null }))).toBeNull();
  });
  it('band words', () => {
    expect([null, 10, 30, 60, 90].map(band)).toEqual(['Not enough to score', 'Light', 'Moderate', 'Strong', 'Very strong']);
  });
});

describe('curve reading', () => {
  it('finds peaks, lulls and the opening', () => {
    const c = [0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.05, 0.05, 0.05, 0.05, null, 0.6];
    expect(heldMoments(c, 5000, 1)[0]!.atMs).toBe(25_000);
    expect(lulls(c, 5000).length).toBeGreaterThanOrEqual(1);
    expect(opening(c, 5000)).toBeCloseTo((0.1 * 4 + 0.9 * 2) / 6, 5);
    expect(opening([null, null, null, 0.5], 10_000)).toBeNull();
  });
});

describe('time map', () => {
  it('maps wall time to video position, null while paused, never past the next mark', () => {
    const tm = new TimeMap();
    tm.add({ t: at(0), c: 0, playing: true });
    tm.add({ t: at(10), c: 10_000, playing: false });
    tm.add({ t: at(20), c: 30_000, playing: true }); // seeked forward while paused
    expect(tm.at(at(5))).toBeCloseTo(5000, 3);
    expect(tm.at(at(15))).toBeNull();
    expect(tm.at(at(25))).toBeCloseTo(35_000, 3);
    expect(tm.at(at(-1))).toBeNull();
    expect(playingIntervals(tm.all, at(30)).map((i) => [(i.start - T0) / S, (i.end - T0) / S])).toEqual([
      [0, 10],
      [20, 30],
    ]);
  });
});

describe('thumbnails', () => {
  it('picks the nearest frame within 3 s, preferring breathing pauses', () => {
    const ev = [
      { id: 'away-1', kind: 'away' as const, t: at(10), atMs: 0, contentMs: null, durMs: 2000, peak: null, thumb: null },
      { id: 'hold-1', kind: 'hold' as const, t: at(30), atMs: 0, contentMs: null, durMs: 8000, peak: null, thumb: null },
      { id: 'hold-2', kind: 'hold' as const, t: at(80), atMs: 0, contentMs: null, durMs: 8000, peak: null, thumb: null },
    ];
    const frames = [10, 31, 32].map((s, i) => ({ t: at(s), key: `t${i}` }));
    const m = pickThumbs(ev, frames, 2);
    expect(m.get('hold-1')).toBe('t1');
    expect(m.has('hold-2')).toBe(false); // nothing within 3 s
    expect(m.has('away-1')).toBe(false); // over the limit of 2
  });
});

describe('words never name feelings, chemicals or conditions', () => {
  it('the banned list catches the obvious ones', () => {
    expect(findBanned('Your dopamine and stress levels')).toEqual(['stress', 'dopamine']);
    expect(findBanned('It is not a brain chemical or a health measure.')).toEqual([]);
    expect(BANNED_WORDS.length).toBeGreaterThan(10);
  });
  it('every suggestion, summary and problem message is clean', () => {
    const texts: string[] = [];
    for (const mode of ['feed', 'review'] as const)
      for (const holds of [0, 5])
        for (const drop of [null, 0.5])
          for (const guess of [null, 60_000])
            for (const felt of [[null, null], [4, 2]] as const)
              for (const away of [0, 4]) {
                const s = suggest({ mode, holds, activeMin: 5, blinkDrop: drop, watchMs: 300_000, guessMs: guess, feltBefore: felt[0], feltAfter: felt[1], awayCount: away, awaySpan: away ? [10_000, 70_000] : null, opening: 0.1, peakAt: 42_000, score: 50 });
                if (s) texts.push(s.text);
              }
    texts.push(summarize({ mode: 'feed', score: 70, band: 'Strong', facts: ['a', 'b'] }), summarize({ mode: 'review', score: null, band: '', facts: [] }));
    texts.push(...Object.values(PROBLEMS).flatMap((p) => [p.title, p.body]));
    expect(texts.length).toBeGreaterThan(20);
    expect(texts.flatMap(findBanned)).toEqual([]);
  });
});
