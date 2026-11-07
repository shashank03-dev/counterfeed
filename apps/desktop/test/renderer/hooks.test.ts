import { describe, expect, it } from 'vitest';
import { ClipResultSchema, ReportSchema } from '@counterfeed/shared';
import { analyzeClip, analyzeClips, clipName, hookWords, isCloseCall, usualGapUs, type ClipInfo, type ClipRun, type HookSignals } from '../../src/renderer/src/analysis/hooks';
import { buildReport, type Capture } from '../../src/renderer/src/analysis/report';
import { findBanned } from '../../src/renderer/src/analysis/words';
import type { TimeMark } from '../../src/renderer/src/analysis/timemap';
import { emptyNormalized } from '../../src/renderer/src/sensing/normalize';
import { V } from '../../src/renderer/src/sensing/quality';

const S = 1e6;
const T0 = 1_731_000_000 * S;
const at = (s: number) => T0 + s * S;

/** A clip playing from wall second `from` to `to`, marks 4x a second, ending with a stop mark. */
function run(clip: number, from: number, to: number, endedBy: ClipRun['endedBy'], stall?: [number, number]): ClipRun {
  const marks: TimeMark[] = [];
  let pos = 0;
  let last = from;
  for (let t = from; t < to; t += 0.25) {
    const stalled = !!stall && t >= stall[0] && t < stall[1];
    if (!stalled) pos += (t - last) * 1000;
    last = t;
    marks.push({ t: at(t), c: pos, playing: !stalled });
  }
  pos += (to - last) * 1000;
  marks.push({ t: at(to), c: pos, playing: false });
  return { clip, start: at(from), end: at(to), endedBy, marks };
}

/*
 * Five clips, watched like a feed, with a usual blink every 2 s:
 *   A 10 s  0-10      no blinks at all, a big smile at 5 s           -> held you from the start
 *   B  8 s  10-11.5   swiped after 1.5 s                              -> lost you, ranked last
 *   C 10 s  11.5-21.5 looked away 13-14.5 (its 1.5-3 s), usual blinks -> lost you in the first 3 s
 *   D 12 s  21.5-33.5 usual blinks until 26 s, then none              -> slow start, grabbed you at 0:06
 *   E  9 s  never played (the session ended)                          -> not ranked
 */
const CLIPS: ClipInfo[] = [
  { name: 'A.mp4', durationMs: 10_000 },
  { name: 'B.mp4', durationMs: 8_000 },
  { name: 'C.mp4', durationMs: 10_000 },
  { name: 'D.mp4', durationMs: 12_000 },
  { name: 'E.mp4', durationMs: 9_000 },
];
const RUNS: ClipRun[] = [run(0, 0, 10, 'end'), run(1, 10, 11.5, 'skip'), run(2, 11.5, 21.5, 'end'), run(3, 21.5, 33.5, 'end')];
const blinks: number[] = [];
for (let s = -20; s <= 40; s += 2) if (!(s > -2 && s <= 10) && !(s > 27.5 && s <= 33.5)) blinks.push(at(s));
const SIGNALS: HookSignals = {
  clear: [
    { start: at(-20), end: at(13) },
    { start: at(14.5), end: at(40) },
  ],
  away: [{ start: at(13), end: at(14.5) }],
  blinks,
  hasBlinkData: true,
  baseBlinkPerMin: 30,
  expressions: [{ kind: 'smile', start: at(5), end: at(6), peak: 80 }],
};

describe('hook test: each clip', () => {
  const out = analyzeClips(CLIPS, RUNS, SIGNALS);
  const [A, B, C, D, E] = out.map((o) => o.result);

  it('every result is a valid stored clip', () => {
    for (const o of out) expect(() => ClipResultSchema.parse(o.result)).not.toThrow();
  });
  it('a clip that held you within its first 3 s landed, and wins', () => {
    // Held within its first 3 s; the stare is counted from the clip's start, so it shows at 0:02, not 0:00.
    expect(A).toMatchObject({ status: 'finished', hook: 'landed', grabbedAtMs: 2000, rank: 1, leftAtMs: null });
    expect(A!.score).toBeGreaterThanOrEqual(90);
    expect(A!.curve).toHaveLength(10);
  });
  it('a clip swiped after 1.5 s lost you, and ranks last however you looked at it', () => {
    expect(B).toMatchObject({ status: 'skipped', hook: 'lost', leftAtMs: 1500, rank: 4, grabbedAtMs: null });
    expect(B!.score!).toBeLessThan(20);
    expect(B!.parts.find((p) => p.key === 'stayed')!.value).toBeCloseTo(1.5 / 8, 2);
  });
  it('looking away in the first 3 s loses the hook even when you watched to the end', () => {
    expect(C).toMatchObject({ status: 'finished', hook: 'lost', awayMs: 1500 });
    expect(C!.parts.find((p) => p.key === 'eyes')!.value).toBeCloseTo((0.85 - 0.6) / 0.4, 2);
  });
  it('a clip that only held you later is a slow start, grabbed at 0:06', () => {
    expect(D).toMatchObject({ status: 'finished', hook: 'slow', grabbedAtMs: 6000, rank: 2 });
    expect(D!.score!).toBeGreaterThan(C!.score!);
    expect(D!.bestMs!).toBeGreaterThanOrEqual(6000);
  });
  it('a clip that never played is listed, not ranked', () => {
    expect(E).toMatchObject({ status: 'unwatched', score: null, rank: null, hook: 'unclear', watchedMs: 0 });
  });
  it('ranks A, D, C, B', () => {
    expect([A, B, C, D].map((x) => x!.rank)).toEqual([1, 4, 3, 2]);
  });
  it('gives a still time inside each played clip', () => {
    for (const o of out.slice(0, 4)) {
      const r = RUNS[o.result.index]!;
      expect(o.stillT!).toBeGreaterThanOrEqual(r.start);
      expect(o.stillT!).toBeLessThan(r.end);
    }
    expect(out[4]!.stillT).toBeNull();
  });
});

describe('hook test: edge cases', () => {
  it('paused or buffering time is not watching, and positions follow the video, not the wall clock', () => {
    const a = analyzeClip(0, { name: 'x.mp4', durationMs: 8000 }, run(0, 0, 11, 'end', [3, 6]), SIGNALS).result;
    expect(a.watchedMs).toBeGreaterThan(7800);
    expect(a.watchedMs).toBeLessThan(8300);
    expect(a.curve).toHaveLength(8);
  });
  it('a clip that failed to play is listed as failed, never ranked', () => {
    const r = analyzeClips([{ name: 'bad.mov', durationMs: null }, ...CLIPS.slice(0, 1)], [{ clip: 0, start: at(0), end: at(0.2), endedBy: 'error', marks: [] }, { ...RUNS[0]!, clip: 1 }], SIGNALS);
    expect(r[0]!.result).toMatchObject({ status: 'failed', rank: null, score: null });
    expect(r[1]!.result.rank).toBe(1);
  });
  it('no view of the face: scored on staying alone, with engagement counted as average', () => {
    const none: HookSignals = { ...SIGNALS, clear: [], away: [], blinks: [], hasBlinkData: false, expressions: [] };
    const a = analyzeClip(0, CLIPS[0]!, RUNS[0], none).result;
    expect(a.parts.map((p) => p.key)).toEqual(['stayed']);
    expect(a.score).toBe(Math.round(100 * (0.35 + 0.65 * 0.5)));
    expect(a.hook).toBe('unclear');
  });
  it('no blink data: staring is not guessed', () => {
    const a = analyzeClip(0, CLIPS[0]!, RUNS[0], { ...SIGNALS, blinks: [], hasBlinkData: false }).result;
    expect(a.parts.some((p) => p.key === 'stare')).toBe(false);
  });
  it('swiped before it started playing: scored 0, ranked, and the hook was lost', () => {
    const t = at(50);
    const r = analyzeClips([CLIPS[0]!, CLIPS[1]!], [RUNS[0]!, { clip: 1, start: t, end: t, endedBy: 'skip', marks: [{ t, c: 0, playing: false }] }], SIGNALS).map((x) => x.result);
    expect(r[1]).toMatchObject({ status: 'skipped', score: 0, rank: 2, hook: 'lost', leftAtMs: 0, watchedMs: 0 });
  });
  it('the session ending mid-clip is "stopped", with where it stopped', () => {
    const a = analyzeClip(0, CLIPS[0]!, run(0, 0, 4, 'stop'), SIGNALS).result;
    expect(a).toMatchObject({ status: 'stopped', leftAtMs: 4000 });
  });
  it('a usual gap between blinks stays within 2-12 s', () => {
    expect(usualGapUs(null)).toBe(4e6);
    expect(usualGapUs(60)).toBe(2e6);
    expect(usualGapUs(3)).toBe(12e6);
    expect(usualGapUs(15)).toBe(4e6);
  });
});

describe('hook test: words', () => {
  const clips = analyzeClips(CLIPS, RUNS, SIGNALS).map((o) => o.result);
  it('names the winner and why, in plain words', () => {
    const w = hookWords(clips, null);
    expect(w.summary).toBe('“A” held you hardest: you watched it to the end and it held you from the first 3 seconds.');
    expect(w.suggestion).toEqual({ key: 'slow', text: '“D” grabbed you at 0:06. Try opening with that moment.' });
  });
  it('when your pick differs from what held you, says so first', () => {
    expect(hookWords(clips, 3).suggestion!.text).toBe('You’d post “D”, but your body stayed with “A”. Watch both again before you choose.');
    expect(hookWords(clips, 0).suggestion!.key).toBe('slow');
    expect(hookWords(clips, 4).suggestion!.key).toBe('slow'); // an unwatched pick isn't compared
  });
  it('a close call is called a close call', () => {
    const close = clips.map((c) => (c.rank === 2 ? { ...c, score: clips.find((x) => x.rank === 1)!.score! - 3 } : c));
    expect(isCloseCall(close)).toBe(true);
    expect(hookWords(close, null).summary).toContain('just ahead of “D”');
    expect(isCloseCall(clips)).toBe(false);
  });
  it('fewer than two watched clips: nothing to compare', () => {
    expect(hookWords(clips.map((c) => (c.index === 0 ? c : { ...c, rank: null, score: null })), null)).toEqual({ summary: 'Watch at least two clips to compare them.', suggestion: null });
  });
  it('clip names lose their extension and stay short', () => {
    expect(clipName('Fractal dive.mp4')).toBe('“Fractal dive”');
    expect(clipName('x'.repeat(60) + '.mov')).toHaveLength(42);
    expect(clipName('.mp4')).toBe('“Untitled clip”');
  });
  it('every sentence is free of banned words', () => {
    for (const p of [null, 0, 1, 2, 3]) {
      const w = hookWords(clips, p);
      expect(findBanned(w.summary + ' ' + (w.suggestion?.text ?? ''))).toEqual([]);
    }
    for (const c of clips) for (const p of c.parts) expect(findBanned(p.detail)).toEqual([]);
  });
});

describe('hook test: the whole report', () => {
  function capture(): Capture {
    const n = emptyNormalized();
    // Settle -40..0 with a blink every 2 s, then the same blinks as SIGNALS during the clips.
    for (let i = -40 * 30; i < 40 * 30; i++) {
      const s = i / 30;
      n.blink.push({ t: at(s), detected: blinks.some((b) => at(s) >= b && at(s) < b + 120_000), stable: true });
      if (i % 3 === 0) n.expressions.push({ t: at(s), smile: s >= 5 && s < 6.5 ? 85 : 3, surprise: 1, frown: 1, stable: true });
    }
    return {
      mode: 'hooks',
      signal: 'test',
      startedAt: 1_731_000_000_000 - 40_000,
      endedAt: 1_731_000_000_000 + 34_000,
      settle: { start: at(-40), end: at(0) },
      watch: { start: at(0), end: at(33.5) },
      active: RUNS.map((r) => ({ start: r.start, end: r.end })),
      samples: n,
      quality: [
        { t: at(-40), code: V.ok },
        { t: at(13), code: V.notForward },
        { t: at(14.5), code: V.ok },
      ],
      timemap: null,
      diffs: null,
      content: { kind: 'video', name: 'Hook test', app: null, durationMs: null },
      title: 'Reel hooks',
      partial: false,
      notes: [],
      baselineForced: false,
      felt: { before: null, after: null },
      guessMs: null,
      ratings: null,
      reviewNote: null,
      clips: { info: CLIPS, runs: RUNS },
      picked: 3,
    };
  }
  const { report, stills } = buildReport(capture(), 'r-test-hooks');
  it('is a valid stored report with every clip', () => {
    expect(() => ReportSchema.parse(report)).not.toThrow();
    expect(report.mode).toBe('hooks');
    expect(report.clips).toHaveLength(5);
    expect(report.picked).toBe(3);
  });
  it('the score is the winner’s, and the words come from the clips', () => {
    const w = report.clips!.find((c) => c.rank === 1)!;
    expect(w.name).toBe('A.mp4');
    expect(report.pull.score).toBe(w.score);
    expect(report.pull.parts).toEqual([]);
    expect(report.summary.startsWith('“A” held you hardest')).toBe(true);
    expect(report.suggestion!.key).toBe('pick');
  });
  it('hands back a still time for every played clip', () => {
    expect([...stills.keys()].sort()).toEqual([0, 1, 2, 3]);
  });
  it('feed and review reports carry no clip fields; old reports without them still load', () => {
    const feed = buildReport({ ...capture(), mode: 'feed', clips: null, picked: null }, 'r-test-feed1').report;
    expect('clips' in feed).toBe(false);
    expect(() => ReportSchema.parse(feed)).not.toThrow();
  });
});

describe('hook test: nothing carries over from the clip before (real run, Nov 2026)', () => {
  // Someone who blinks rarely, and a smile held through clip 1 that ends just after clip 2 begins.
  const clips: ClipInfo[] = [
    { name: 'One.mp4', durationMs: 10_000 },
    { name: 'Two.mp4', durationMs: 10_000 },
  ];
  const runs: ClipRun[] = [run(0, 0, 10, 'end'), run(1, 10, 20, 'end')];
  const sig: HookSignals = {
    clear: [{ start: at(-20), end: at(25) }],
    away: [],
    blinks: [at(-15), at(13), at(16)],
    hasBlinkData: true,
    baseBlinkPerMin: 5,
    expressions: [{ kind: 'smile', start: at(2), end: at(10.3), peak: 100 }],
  };
  const [one, two] = analyzeClips(clips, runs, sig).map((o) => o.result);
  it('the smile counts for the clip it started in only', () => {
    expect(one!.parts.find((p) => p.key === 'face')!.value).toBe(1);
    expect(two!.parts.find((p) => p.key === 'face')!.value).toBe(0);
    expect(one!.rank).toBe(1);
  });
  it('a stare that began in the clip before does not "grab" at 0:00', () => {
    expect(two!.grabbedAtMs).toBeNull();
    expect(two!.hook).toBe('steady');
  });
});
