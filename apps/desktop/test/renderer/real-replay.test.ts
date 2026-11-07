import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReportSchema } from '@counterfeed/shared';
import { buildReport, type Capture } from '../../src/renderer/src/analysis/report';

/*
 * Replays REAL guided recordings (made with `node e2e/real.mjs`: a person following a prompter in front of a
 * laptop camera) through the same report code the app uses, and checks the report against what the person was
 * asked to do. Recordings hold one person's body signals, so they stay local (e2e/artifacts is git-ignored) and
 * each suite is skipped when its file is missing.
 *
 * Every expectation below was checked against the raw samples (head pose, breathing wave, SDK codes and flags),
 * including the misses, which are listed with their cause. The rule the app follows: when the signal can't
 * support a claim, say nothing (a missed pause) rather than guess (an invented one).
 */

interface Step {
  from: number;
  to: number;
  say: string;
  kind?: string;
}
interface Recording {
  plan: Step[];
  capture: Capture;
}
interface Expect {
  name: string;
  /** Seconds after watching starts. */
  holdsFound: [number, number][];
  /** Deliberate holds the report is not required to find, with why (from the raw data). */
  holdsMissed: { at: [number, number]; why: string }[];
  /** "Looking away" outside the turn/look-down prompts that really happened (raw head pose), with why. */
  extraAway: { at: [number, number]; why: string }[];
  smile: boolean;
}

const RECORDINGS: Expect[] = [
  {
    name: 'rec-guided-1.json',
    holdsFound: [
      [18, 31],
      [123, 136],
    ],
    holdsMissed: [],
    extraAway: [],
    smile: true,
  },
  {
    name: 'rec-guided-2.json',
    holdsFound: [],
    holdsMissed: [
      { at: [18, 30], why: 'the SDK flagged talking at 15-20 s and 24-28 s (nobody spoke) and the person moved while breathing out' },
      { at: [123, 135], why: 'the wave was flat at 126-131 s, but the SDK marked the whole sat-back stretch (114-144 s) unstable' },
    ],
    extraAway: [{ at: [64, 70], why: 'the head really turned during the smile prompt: yaw -0.52 at 65-69 s, as large as the deliberate turn' }],
    smile: false, // the SDK's smile probability was 0 for the whole smile prompt
  },
];

const dir = join(__dirname, '..', '..', 'e2e', 'artifacts', 'real');
const load = (name: string): Recording | null => {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  const r = JSON.parse(readFileSync(p, 'utf8')) as Recording;
  return r.capture ? { ...r, capture: { ...r.capture, timemap: null } } : null;
};
type Span = { from: number; to: number };
const ev = (r: ReturnType<typeof buildReport>['report'], kind: string): Span[] => r.events.filter((e) => e.kind === kind).map((e) => ({ from: e.atMs / 1000, to: (e.atMs + e.durMs) / 1000 }));
const near = (list: Span[], from: number, to: number) => list.filter((e) => e.to >= from && e.from <= to);
const overlaps = (list: Span[], from: number, to: number) => list.filter((e) => e.to > from && e.from < to);

for (const x of RECORDINGS) {
  const rec = load(x.name);
  describe.skipIf(!rec)(`real recording ${x.name}`, () => {
    const { report } = buildReport(rec!.capture, 'r-real-replay');
    const away = ev(report, 'away');
    const holds = ev(report, 'hold');
    const awaySteps = rec!.plan.filter((p) => p.kind === 'away');

    it('builds a valid report, with your normal measured', () => {
      expect(ReportSchema.safeParse(report).success).toBe(true);
      expect(report.baseline.quality).toBe('good');
    });

    it('catches every head turn and look down it was asked for', () => {
      for (const s of awaySteps) expect(near(away, s.from, s.to + 8).length, `${s.say} ${s.from}-${s.to} s vs ${JSON.stringify(away)}`).toBeGreaterThan(0);
    });

    it('says "looking away" only when the head really moved', () => {
      const allowed = [...awaySteps.map((s): [number, number] => [s.from, s.to + 8]), ...x.extraAway.map((e) => e.at)];
      const unexplained = away.filter((a) => !allowed.some(([f, t]) => a.to > f && a.from < t));
      expect(unexplained, JSON.stringify(away)).toEqual([]);
    });

    it('finds the breath holds the signal supports', () => {
      for (const [f, t] of x.holdsFound) expect(near(holds, f, t).length, `hold ${f}-${t} s vs ${JSON.stringify(holds)}`).toBeGreaterThan(0);
    });

    it('never reports a pause while looking away, or one longer than 30 s', () => {
      for (const h of holds) {
        expect(overlaps(away, h.from, h.to), `hold ${JSON.stringify(h)} vs away ${JSON.stringify(away)}`).toEqual([]);
        expect(h.to - h.from).toBeLessThanOrEqual(30);
      }
    });

    it('smile', () => {
      expect(near(ev(report, 'smile'), 61, 71).length > 0).toBe(x.smile);
    });
  });
}

/*
 * Real guided focus session (`node e2e/real-focus.mjs`, 2 min, second run on Nov 7 2026), switching desktops on
 * one screen. What the raw data shows:
 * - short head turns while working (each 0.5-1.6 s): glances, not breaks; the asked-for glance at 22-24 s too.
 * - 40.7-54.6 s (asked: look down 38-53): pitch up, the SDK's "not facing forward" on and off. A break.
 * - 79.5-114.2 s (asked: step away 75-110): the SDK sent no face data at all and never said "no face" (its codes
 *   were "chest not in view", then "too low"). Landmarks returned at 114.2 s, blinks only at 117.2 s.
 */
const focusRec = load('rec-focus.json');
describe.skipIf(!focusRec)('real recording: focus session', () => {
  const { report } = buildReport(focusRec!.capture, 'real-focus');
  const f = report.focus!;
  const b = f.breakSpans.map((x) => ({ from: x.startMs / 1000, to: x.endMs / 1000, left: x.left }));
  it('the glance is not a break', () => {
    expect(overlaps(b, 18, 30)).toEqual([]);
  });
  it('looking down at the lap is a break', () => {
    expect(overlaps(b, 42, 52).length).toBe(1);
  });
  it('stepping away is "left your desk", ending when the face data comes back (not when blinks restart)', () => {
    const left = b.filter((x) => x.left);
    expect(left).toHaveLength(1);
    expect(left[0]!.from).toBeGreaterThan(78);
    expect(left[0]!.to).toBeLessThan(115);
  });
  it('no breaks that weren\'t asked for, and a valid report', () => {
    expect(b).toHaveLength(2);
    expect(ReportSchema.safeParse(report).success).toBe(true);
  });
});

/*
 * Real guided hook test (`node e2e/real-hooks.mjs`): demo pack in order, a smile asked for during clip 2 (held
 * 12-20 s, ending just after clip 3 began), clip 5 swiped after about a second. The person blinked about 5 times
 * a minute, and the eye shapes agree with the SDK's blinks (none missed).
 */
const hookRec = load('rec-hooks.json');
describe.skipIf(!hookRec)('real recording: hook test', () => {
  const { report } = buildReport(hookRec!.capture, 'real-hooks');
  const byName = (n: string) => report.clips!.find((c) => c.name.startsWith(n))!;
  it('the swiped clip lost you in its first 3 s and ranks last', () => {
    expect(byName('Test card')).toMatchObject({ status: 'skipped', hook: 'lost', rank: 5 });
  });
  it('the smile counts for clip 2 only, and clip 2 ranks first', () => {
    expect(byName('Fractal dive').parts.find((p) => p.key === 'face')!.value).toBe(1);
    expect(byName('Life').parts.find((p) => p.key === 'face')!.value).toBe(0);
    expect(byName('Fractal dive').rank).toBe(1);
  });
  it('no clip "grabbed" at 0:00 from a stare that began before it', () => {
    expect(report.clips!.filter((c) => c.grabbedAtMs === 0)).toEqual([]);
  });
});
