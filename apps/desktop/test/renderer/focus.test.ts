import { describe, expect, it } from 'vitest';
import { MAX_FOCUS_APPS, ReportSchema } from '@counterfeed/shared';
import { appUsage, FOCUS, focusBand, focusTrend, focusCurve, focusDuration, focusParts, focusSpans, focusWords, OTHER_APPS, type AppSample, type FocusMeasures } from '../../src/renderer/src/analysis/focus';
import { buildReport, type Capture } from '../../src/renderer/src/analysis/report';
import { findBanned } from '../../src/renderer/src/analysis/words';
import { emptyNormalized, type Normalized } from '../../src/renderer/src/sensing/normalize';
import { V } from '../../src/renderer/src/sensing/quality';

const S = 1e6;
const T0 = 1_731_000_000 * S;
const at = (s: number) => T0 + s * S;
const iv = (a: number, b: number) => ({ start: at(a), end: at(b) });

describe('focusSpans', () => {
  const active = [iv(0, 100)];
  it('a glance under 10 s is still focused; 10 s or more is a break that ends the stretch', () => {
    const r = focusSpans(active, { away: [iv(10, 14), iv(40, 52)], unclear: [] }, []);
    expect(r.breaks.map((b) => [(b.start - T0) / S, (b.end - T0) / S])).toEqual([[40, 52]]);
    expect(r.breaks[0]!.left).toBe(false);
    expect(r.focused.reduce((t, i) => t + i.end - i.start, 0) / S).toBe(88);
    expect(r.stretches.map((i) => [(i.start - T0) / S, (i.end - T0) / S])).toEqual([
      [0, 40],
      [52, 100],
    ]);
  });
  it('moments away a flick apart are one break, and the flick back is not counted as focused', () => {
    const r = focusSpans(active, { away: [iv(20, 25), iv(26, 31)], unclear: [] }, []);
    expect(r.breaks).toHaveLength(1);
    expect((r.breaks[0]!.end - r.breaks[0]!.start) / S).toBe(11);
    expect(r.focused.reduce((t, i) => t + i.end - i.start, 0) / S).toBe(89);
  });
  it('time the camera could not read is neither focused nor a break, and does not end a stretch', () => {
    const r = focusSpans(active, { away: [], unclear: [iv(30, 40)] }, []);
    expect(r.breaks).toHaveLength(0);
    expect(r.focused.reduce((t, i) => t + i.end - i.start, 0) / S).toBe(90);
    expect(r.stretches).toHaveLength(1);
  });
  it('no face for 30 s or more inside a break is "left your desk"', () => {
    const r = focusSpans(active, { away: [iv(10, 22), iv(50, 85)], unclear: [] }, [iv(50, 85)]);
    expect(r.breaks.map((b) => b.left)).toEqual([false, true]);
    const short = focusSpans(active, { away: [iv(50, 70)], unclear: [] }, [iv(50, 70)]);
    expect(short.breaks[0]!.left).toBe(false);
  });
  it('only counts inside the session', () => {
    const r = focusSpans([iv(10, 50)], { away: [iv(0, 15), iv(45, 70)], unclear: [] }, []);
    expect(r.breaks).toHaveLength(0); // 5 s at each edge: glances, so still focused
    expect(r.focused.reduce((t, i) => t + i.end - i.start, 0) / S).toBe(40);
  });
});

describe('appUsage', () => {
  const secs = (from: number, to: number, name: string | null): AppSample[] => Array.from({ length: to - from }, (_, i) => ({ t: at(from + i), name }));
  it('adds up time per app, counts switches, and ignores Counterfeed’s own bar between two readings of one app', () => {
    const s = [...secs(0, 30, 'Code'), ...secs(30, 31, null), ...secs(31, 50, 'Code'), ...secs(50, 60, 'Safari'), ...secs(60, 100, 'Code')];
    const u = appUsage(s, [iv(0, 100)], [iv(0, 100)])!;
    expect(u.switches).toBe(2);
    expect(u.apps.map((a) => [a.name, a.us / S])).toEqual([
      ['Code', 89],
      ['Safari', 10],
    ]);
    expect(u.knownUs / S).toBe(99);
    expect(u.spans.every((x) => x.app === 0 || x.app === 1)).toBe(true);
  });
  it('a stalled reading covers at most 3 s (the rest is unknown, not the last app)', () => {
    const u = appUsage([{ t: at(0), name: 'Code' }, { t: at(20), name: 'Code' }], [iv(0, 30)], [iv(0, 30)])!;
    expect(u.apps[0]!.us / S).toBe(6);
    expect(u.switches).toBe(0);
  });
  it('focused time per app follows the focus spans', () => {
    const s = [...secs(0, 50, 'Code'), ...secs(50, 100, 'Mail')];
    const u = appUsage(s, [iv(0, 100)], [iv(0, 40), iv(60, 100)])!;
    expect(u.apps.find((a) => a.name === 'Code')!.focusedUs / S).toBe(40);
    expect(u.apps.find((a) => a.name === 'Mail')!.focusedUs / S).toBe(40);
  });
  it(`keeps the top ${MAX_FOCUS_APPS} apps and folds the rest into "${OTHER_APPS}"`, () => {
    // Twelve apps, each in front once: App 0 for 12 s, App 1 for 11 s, ... App 11 for 1 s.
    const s: AppSample[] = [];
    let t = 0;
    for (let i = 0; i < 12; i++) {
      s.push(...secs(t, t + 12 - i, `App ${i}`));
      t += 12 - i;
    }
    const u = appUsage(s, [iv(0, t)], [iv(0, t)])!;
    expect(u.apps.slice(0, 3).map((a) => a.name)).toEqual(['App 0', 'App 1', 'App 2']);
    expect(u.apps[MAX_FOCUS_APPS]!.us / S).toBe(4 + 3 + 2 + 1);
    expect(u.apps).toHaveLength(MAX_FOCUS_APPS + 1);
    expect(u.apps[MAX_FOCUS_APPS]!.name).toBe(OTHER_APPS);
    expect(u.spans.some((x) => x.app === MAX_FOCUS_APPS)).toBe(true);
    expect(u.switches).toBe(11);
  });
  it('null without a reading inside the session', () => {
    expect(appUsage([], [iv(0, 10)], [])).toBeNull();
    expect(appUsage([{ t: at(50), name: 'Code' }], [iv(0, 10)], [])).toBeNull();
    expect(appUsage([{ t: at(1), name: null }], [iv(0, 10)], [])).toBeNull();
  });
});

const M = (o: Partial<FocusMeasures> = {}): FocusMeasures => ({
  activeUs: 600 * S,
  measuredUs: 600 * S,
  focusedUs: 540 * S,
  longestUs: 300 * S,
  breaks: 2,
  leftCount: 0,
  switches: 4,
  appUs: 600 * S,
  baselineGood: true,
  baseBlinkPerMin: 20,
  blinkPerMin: 12,
  ...o,
});

describe('focus score', () => {
  it('weighs eyes on the work most, and leaves out what could not be measured', () => {
    const all = focusParts(M());
    expect(all.map((p) => p.key)).toEqual(['eyes', 'unbroken', 'steady', 'blinking']);
    expect(all.find((p) => p.key === 'eyes')!.value).toBeCloseTo(0.9);
    expect(all.find((p) => p.key === 'unbroken')!.value).toBeCloseTo(0.5);
    expect(all.find((p) => p.key === 'blinking')!.value).toBeCloseTo(0.8);
    const noApps = focusParts(M({ switches: null }));
    expect(noApps.map((p) => p.key)).not.toContain('steady');
    const noBase = focusParts(M({ baselineGood: false }));
    expect(noBase.map((p) => p.key)).not.toContain('blinking');
    expect(focusParts(M({ measuredUs: 10 * S, focusedUs: 10 * S, switches: null, baselineGood: false }))).toEqual([]);
  });
  it('the longest stretch is judged against the session, up to 25 minutes', () => {
    expect(focusParts(M({ activeUs: 120 * S, measuredUs: 120 * S, focusedUs: 120 * S, longestUs: 120 * S })).find((p) => p.key === 'unbroken')!.value).toBe(1);
    expect(focusParts(M({ activeUs: 3000 * S, longestUs: 1500 * S })).find((p) => p.key === 'unbroken')!.value).toBe(1);
  });
  it('fewer app switches score higher; none is the best', () => {
    const v = (switches: number) => focusParts(M({ switches })).find((p) => p.key === 'steady')!.value;
    expect(v(0)).toBe(1);
    expect(v(5)).toBeGreaterThan(v(30));
    expect(v(5)).toBeCloseTo(0.5);
  });
  it('bands', () => {
    expect([focusBand(null), focusBand(20), focusBand(50), focusBand(70), focusBand(90)]).toEqual(['Not enough to score', 'Scattered', 'Patchy', 'Steady', 'Deep']);
  });
});

describe('focus words', () => {
  const W = (o: Partial<Parameters<typeof focusWords>[0]> = {}) => focusWords({ ...M(), score: 70, holds: 0, felt: null, ...o });
  it('one plain headline with the numbers', () => {
    expect(W().summary).toBe('Steady focus: your eyes stayed on the work for 9 min of 10 min (90%), and your longest stretch without a break was 5 min.');
    expect(W({ activeUs: 10 * S }).summary).toMatch(/^Too short to read/);
    expect(W({ measuredUs: 5 * S, score: null }).summary).toMatch(/clear view of your face/);
  });
  it('sets how it felt against what was measured, both ways', () => {
    expect(W({ felt: 1, focusedUs: 560 * S }).suggestion!.key).toBe('felt');
    expect(W({ felt: 1, focusedUs: 560 * S }).suggestion!.text).toMatch(/^It felt scattered, but your eyes stayed on the work 93%/);
    expect(W({ felt: 5, focusedUs: 300 * S }).suggestion!.text).toMatch(/^It felt focused, but your eyes were off the work for 5 min/);
  });
  it('picks the strongest of switching, breaks, leaving the desk and breathing pauses', () => {
    expect(W({ switches: 40, breaks: 1 }).suggestion!.key).toBe('switches');
    expect(W({ switches: 0, breaks: 12 }).suggestion!.key).toBe('breaks');
    expect(W({ switches: 0, breaks: 1, leftCount: 2 }).suggestion!.text).toMatch(/left your desk 2 times/);
    expect(W({ switches: 0, breaks: 0, holds: 9 }).suggestion!.key).toBe('pauses');
    expect(W({ switches: 0, breaks: 0, score: 90 }).suggestion!.key).toBe('keep');
    expect(W({ switches: 0, breaks: 0, score: 50 }).suggestion!.key).toBe('shorter');
  });
  it('never uses a banned word, across many inputs', () => {
    for (const felt of [null, 1, 2, 3, 4, 5])
      for (const switches of [null, 0, 3, 40])
        for (const breaks of [0, 2, 12])
          for (const holds of [null, 0, 9]) {
            const w = W({ felt, switches, breaks, holds, leftCount: breaks > 5 ? 1 : 0, focusedUs: felt && felt < 3 ? 580 * S : 300 * S });
            expect(findBanned(`${w.summary} ${w.suggestion?.text ?? ''}`)).toEqual([]);
          }
  });
  it('durations read naturally', () => {
    expect([focusDuration(45 * S), focusDuration(252 * S), focusDuration(1264 * S)]).toEqual(['45 s', '4 min 12 s', '21 min']);
  });
});

describe('focusCurve', () => {
  it('the focused share of each bin, null without a reading', () => {
    const spans = focusSpans([iv(0, 30)], { away: [iv(10, 20)], unclear: [iv(20, 30)] }, []);
    expect(focusCurve([iv(0, 30)], spans, 10 * S)).toEqual([1, 0, null]);
  });
});

/**
 * A synthetic focus session: 40 s settle (20 blinks/min), then 300 s of work (10 blinks/min). A 4 s look down
 * (glance), a 15 s turn away, two turns 0.8 s apart (one 10 s break), 40 s with no face (left the desk) and 5 s the
 * camera couldn't read. Apps: Code, with Safari at 120-140 and Slack at 260-265; Counterfeed's bar at 180; no
 * reading at 300-305.
 */
function focusCapture(over: Partial<Capture> = {}): Capture {
  const n: Normalized = emptyNormalized();
  let ph = 0;
  let lastBlink = -99;
  const end = 340;
  for (let i = 0; i < end * 30; i++) {
    const s = i / 30;
    ph += (2 * Math.PI * 0.25) / 30;
    n.trace.push({ t: at(s), v: Math.sin(ph), stable: true });
    const every = s < 40 ? 3 : 6;
    const b = s - lastBlink >= every;
    if (b) lastBlink = s;
    // Away from the desk the SDK sends no face data at all (the last samples land at 200 s and 240 s).
    const noFace = s > 200 && s < 240;
    if (!noFace) n.blink.push({ t: at(s), detected: b || s - lastBlink < 0.1, stable: true });
    const turned = (s >= 100 && s < 115) || (s >= 150 && s < 151.2) || (s >= 152 && s < 160);
    if (i % 3 === 0 && !noFace) n.pose.push({ t: at(s), yaw: turned ? 0.8 : -0.05, pitch: s >= 60 && s < 64 ? 0.48 : 0.33, stable: true });
    if (i % 30 === 0) {
      n.pulse.push({ t: at(s), value: 70, confidence: 70, stable: true });
      n.rate.push({ t: at(s), value: 15, confidence: 60, stable: true });
      n.talking.push({ t: at(s), detected: false, stable: true });
    }
  }
  const apps: AppSample[] = [];
  for (let s = 40; s < end; s++) {
    if (s >= 300 && s < 305) continue;
    apps.push({ t: at(s), name: s === 180 ? null : s >= 120 && s < 140 ? 'Safari' : s >= 260 && s < 265 ? 'Slack' : 'Code' });
  }
  return {
    mode: 'focus',
    signal: 'test',
    startedAt: 1_731_000_000_000,
    endedAt: 1_731_000_000_000 + end * 1000,
    settle: iv(0, 40),
    watch: iv(40, end),
    active: [iv(40, end)],
    samples: n,
    quality: [
      { t: at(0), code: V.ok },
      { t: at(100), code: V.notForward },
      { t: at(115), code: V.ok },
      { t: at(150), code: V.notForward },
      { t: at(151.2), code: V.ok },
      { t: at(152), code: V.notForward },
      { t: at(160), code: V.ok },
      { t: at(200), code: V.noFace },
      { t: at(240), code: V.ok },
      { t: at(270), code: V.cameraTuning },
      { t: at(275), code: V.ok },
    ],
    timemap: null,
    diffs: null,
    content: { kind: 'none', name: 'Focus session', app: null, durationMs: null },
    title: 'Write the launch post',
    partial: false,
    notes: [],
    baselineForced: false,
    felt: { before: null, after: 3 },
    guessMs: null,
    ratings: null,
    reviewNote: null,
    focus: { plannedMs: 300_000, apps, dnd: 'on' },
    ...over,
  };
}

describe('buildReport (focus)', () => {
  const { report: r } = buildReport(focusCapture(), 'r-focus-0001');
  const f = r.focus!;

  it('is a valid stored report, with focus results and nothing from other modes', () => {
    expect(() => ReportSchema.parse(r)).not.toThrow();
    expect(r.mode).toBe('focus');
    expect(r.clips).toBeUndefined();
    expect(r.title).toBe('Write the launch post');
  });
  it('a glance stays focused; three breaks, one of them leaving the desk', () => {
    expect(f.breaks).toBe(3);
    expect(f.leftCount).toBe(1);
    expect(f.leftMs).toBe(40_000);
    expect(f.breakSpans.map((b) => [b.startMs, b.endMs, b.left])).toEqual([
      [60_000, 75_000, false],
      [110_000, 120_000, false],
      [160_000, 200_000, true],
    ]);
  });
  it('focused and measured time leave out what the camera could not read', () => {
    expect(f.measuredMs).toBe(295_000);
    expect(f.focusedMs).toBe(230_000);
    expect(f.longestMs).toBe(100_000);
    expect(f.stretches).toHaveLength(4);
  });
  it('time and focus per app, and four switches (the bar in between doesn’t count)', () => {
    expect(f.switches).toBe(4);
    expect(f.apps!.map((a) => a.name)).toEqual(['Code', 'Safari', 'Slack']);
    expect(f.apps!.map((a) => a.ms / 1000)).toEqual([271, 20, 5]);
    expect(f.apps![0]!.focusedMs).toBe(201_000);
    expect(f.apps![1]!.focusedMs).toBe(20_000);
    expect(f.appSpans!.length).toBeGreaterThanOrEqual(5);
  });
  it('scores from all four parts and words it plainly', () => {
    expect(r.pull.parts.map((p) => p.key)).toEqual(['eyes', 'unbroken', 'steady', 'blinking']);
    expect(r.pull.score).toBeGreaterThanOrEqual(64);
    expect(r.pull.score).toBeLessThanOrEqual(68);
    expect(r.summary).toBe('Steady focus: your eyes stayed on the work for 3 min 50 s of 4 min 55 s (78%), and your longest stretch without a break was 1 min 40 s.');
    expect(r.suggestion!.key).toBe('breaks');
    expect(f.dnd).toBe('on');
    expect(f.plannedMs).toBe(300_000);
    expect(findBanned(JSON.stringify(r))).toEqual([]);
  });
  it('the curve is the focused share along the session', () => {
    expect(r.curve.length).toBeGreaterThan(5);
    expect(Math.min(...(r.curve.filter((v) => v !== null) as number[]))).toBeLessThan(0.5);
    expect(Math.max(...(r.curve.filter((v) => v !== null) as number[]))).toBe(1);
  });
  it('without app tracking: no apps, no switch part, still scored', () => {
    const { report } = buildReport(focusCapture({ focus: { plannedMs: null, apps: null, dnd: 'off' } }), 'r-focus-0002');
    expect(report.focus!.apps).toBeNull();
    expect(report.focus!.switches).toBeNull();
    expect(report.focus!.appSpans).toBeNull();
    expect(report.pull.parts.map((p) => p.key)).not.toContain('steady');
    expect(report.pull.score).not.toBeNull();
    expect(() => ReportSchema.parse(report)).not.toThrow();
  });
  it('says so when Do Not Disturb didn’t turn on, or when no app could be read', () => {
    const { report } = buildReport(focusCapture({ focus: { plannedMs: 300_000, apps: [], dnd: 'failed' } }), 'r-focus-0003');
    expect(report.notes.join(' ')).toMatch(/Do Not Disturb didn’t turn on/);
    expect(report.notes.join(' ')).toMatch(/Which app was in front couldn’t be read/);
    expect(report.focus!.dnd).toBe('failed');
  });
  it('a very short session is not scored', () => {
    const { report } = buildReport(focusCapture({ watch: iv(40, 55), active: [iv(40, 55)] }), 'r-focus-0004');
    expect(report.pull.score).toBeNull();
    expect(report.summary).toMatch(/^Too short to read/);
    expect(() => ReportSchema.parse(report)).not.toThrow();
  });
  it('thresholds are what the report and the bar say', () => {
    expect(FOCUS.breakUs).toBe(10 * S);
    expect(FOCUS.leftUs).toBe(30 * S);
    expect(FOCUS.nudgeUs).toBe(20 * S);
  });
});

describe('focusTrend (History)', () => {
  const rep = (id: string, startedAt: number, score: number | null, focusedMs: number, apps: { name: string; ms: number; focusedMs: number }[] | null = null, mode = 'focus') => ({
    id, mode, startedAt, title: null, pull: { score }, focus: { measuredMs: 600_000, focusedMs, longestMs: focusedMs / 2, apps },
  });
  it('needs two scored focus sessions; ignores other modes and unscored ones', () => {
    expect(focusTrend([rep('a', 1, 70, 400_000)])).toBeNull();
    expect(focusTrend([rep('a', 1, 70, 400_000), rep('b', 2, null, 400_000), rep('c', 3, 60, 1, null, 'feed')])).toBeNull();
  });
  it('oldest first, averages, and the apps you focus best in (2 minutes or more)', () => {
    const t = focusTrend([
      rep('b', 2, 80, 540_000, [{ name: 'Code', ms: 500_000, focusedMs: 480_000 }, { name: 'Slack', ms: 100_000, focusedMs: 20_000 }]),
      rep('a', 1, 60, 300_000, [{ name: 'Code', ms: 300_000, focusedMs: 200_000 }, { name: 'Safari', ms: 300_000, focusedMs: 100_000 }, { name: OTHER_APPS, ms: 999_000, focusedMs: 999_000 }]),
    ])!;
    expect(t.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(t.avgShare).toBeCloseTo(0.7);
    expect(t.avgScore).toBe(70);
    expect(t.longestMs).toBe(270_000);
    expect(t.bestApps.map((a) => a.name)).toEqual(['Code', 'Safari']);
    expect(t.bestApps[0]!.share).toBeCloseTo(0.85);
  });
  it('keeps the latest sessions only', () => {
    const many = Array.from({ length: 20 }, (_, i) => rep(`r${i}`, i, 50, 300_000));
    expect(focusTrend(many, 12)!.sessions.map((s) => s.id)[0]).toBe('r8');
  });
});
