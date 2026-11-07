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
