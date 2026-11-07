import { MAX_FOCUS_APPS, type PullPart } from '@counterfeed/shared';
import type { View } from './detect';
import { intersect, len, merge, overlap, subtract, total, type Interval } from './intervals';
import { minutesLabel, score } from './score';

/*
 * Focus sessions: how much of the time your eyes stayed on the work, and in which apps. Built only from what the
 * camera measured (your face toward the screen, against your own normal head pose) and which app was in front.
 *
 *  - A glance (away for under 10 s: thinking, checking notes) still counts as focused.
 *  - A break is 10 s or more away. It ends a stretch. No face for 30 s or more is "left your desk".
 *  - Time the camera couldn't read (light, motion) is left out of both, and doesn't end a stretch.
 */

export const FOCUS = {
  /** Away this long is a break; shorter is a glance. */
  breakUs: 10e6,
  /** No face this long: you left your desk. */
  leftUs: 30e6,
  /** Away this long in a session with nudges on: the bar glows. */
  nudgeUs: 20e6,
  /** Moments away closer than this are one break (a flick back to the screen doesn't reset it). */
  joinUs: 1.5e6,
  /** One front-app reading covers at most this long, so a stalled reading becomes "unknown", not the last app. */
  appHoldUs: 3e6,
  /** The longest stretch is judged against at most this much time: 25 unbroken minutes is as good as it gets. */
  unbrokenCapUs: 25 * 60e6,
  /** Less measured time than this can't be read. */
  minUs: 20e6,
} as const;

export const FOCUS_WEIGHTS = { eyes: 0.5, unbroken: 0.2, steady: 0.15, blinking: 0.15 } as const;

export interface FocusSpans {
  /** Away 10 s or more (merged), each marked when it included 30 s or more with no face. */
  breaks: (Interval & { left: boolean })[];
  /** Eyes on the work: active time minus breaks, minus time the camera couldn't read. */
  focused: Interval[];
  /** Between breaks. */
  stretches: Interval[];
}

/** Breaks, focused time and stretches inside `active`. `noFace`: the SDK found no face (not just turned away). */
export function focusSpans(active: Interval[], view: Pick<View, 'away' | 'unclear'>, noFace: Interval[]): FocusSpans {
  const act = merge(active);
  const away = intersect(merge(view.away, FOCUS.joinUs), act);
  const gone = intersect(merge(noFace, FOCUS.joinUs), act).filter((i) => len(i) >= FOCUS.leftUs);
  const breaks = away.filter((i) => len(i) >= FOCUS.breakUs).map((b) => ({ ...b, left: gone.some((g) => g.start < b.end && g.end > b.start) }));
  const unclear = subtract(intersect(merge(view.unclear), act), away);
  const focused = subtract(subtract(act, breaks), unclear);
  const stretches = subtract(act, breaks).filter((i) => len(i) > 0);
  return { breaks, focused, stretches };
}

/** One front-app reading. `name` null: unknown, or Counterfeed's own bar (neither counts as an app). */
export interface AppSample {
  t: number;
  name: string | null;
}

export interface AppUsage {
  /** Most time first; beyond MAX_FOCUS_APPS the rest are folded into "Other apps" (last). */
  apps: { name: string; us: number; focusedUs: number }[];
  /** Which app was in front when, as an index into `apps`. */
  spans: (Interval & { app: number })[];
  /** Changes from one app to another (Counterfeed's own bar in between doesn't count). */
  switches: number;
  /** Time with a known app in front. */
  knownUs: number;
}

export const OTHER_APPS = 'Other apps';

/** Front-app readings -> time and focused time per app, and how often you switched. null with no readings. */
export function appUsage(samples: AppSample[], active: Interval[], focused: Interval[]): AppUsage | null {
  const act = merge(active);
  const s = [...samples].sort((a, b) => a.t - b.t);
  const raw: (Interval & { name: string })[] = [];
  let switches = 0;
  let prev: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const x = s[i]!;
    if (!x.name) continue;
    if (prev !== null && x.name !== prev) switches++;
    prev = x.name;
    const next = s[i + 1]?.t ?? x.t + FOCUS.appHoldUs;
    const end = Math.min(next, x.t + FOCUS.appHoldUs);
    const last = raw[raw.length - 1];
    if (last && last.name === x.name && x.t <= last.end) last.end = Math.max(last.end, end);
    else raw.push({ start: x.t, end, name: x.name });
  }
  const clipped = raw.flatMap((r) => intersect([{ start: r.start, end: r.end }], act).map((i) => ({ ...i, name: r.name })));
  if (!clipped.length) return null;

  const byName = new Map<string, { us: number; focusedUs: number }>();
  for (const r of clipped) {
    const a = byName.get(r.name) ?? { us: 0, focusedUs: 0 };
    a.us += len(r);
    a.focusedUs += overlap(focused, r.start, r.end);
    byName.set(r.name, a);
  }
  const ranked = [...byName].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.us - a.us || a.name.localeCompare(b.name));
  const top = ranked.slice(0, MAX_FOCUS_APPS);
  const rest = ranked.slice(MAX_FOCUS_APPS);
  const apps = rest.length ? [...top, { name: OTHER_APPS, us: rest.reduce((t, a) => t + a.us, 0), focusedUs: rest.reduce((t, a) => t + a.focusedUs, 0) }] : top;
  const index = new Map(top.map((a, i) => [a.name, i]));
  const spans = clipped.map((r) => ({ start: r.start, end: r.end, app: index.get(r.name) ?? MAX_FOCUS_APPS }));
  return { apps, spans, switches, knownUs: total(clipped) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => Math.round(v * 100);

export interface FocusMeasures {
  activeUs: number;
  measuredUs: number;
  focusedUs: number;
  longestUs: number;
  breaks: number;
  leftCount: number;
  /** null: app tracking was off or nothing could be read. */
  switches: number | null;
  appUs: number;
  baselineGood: boolean;
  baseBlinkPerMin: number | null;
  blinkPerMin: number | null;
}

/** The Focus score's parts. A part that couldn't be measured is left out (not scored as zero). */
export function focusParts(m: FocusMeasures): PullPart[] {
  const parts: PullPart[] = [];
  const add = (key: keyof typeof FOCUS_WEIGHTS, value: number, detail: string) => parts.push({ key, value: clamp01(value), weight: FOCUS_WEIGHTS[key], detail });
  if (m.measuredUs >= FOCUS.minUs) {
    const share = m.focusedUs / m.measuredUs;
    add('eyes', share, `Your eyes were on the work ${pct(share)}% of the time (glances under 10 s count as focused).`);
    add('unbroken', m.longestUs / Math.min(m.activeUs, FOCUS.unbrokenCapUs), `Longest stretch without a break: ${minutesLabel(m.longestUs / 1000)}.`);
  }
  if (m.switches !== null && m.appUs >= FOCUS.minUs) {
    const per10 = m.switches / (m.appUs / 600e6);
    add('steady', 1 / (1 + per10 / 5), m.switches === 0 ? 'You stayed in one app the whole time.' : `You switched apps ${m.switches} ${m.switches === 1 ? 'time' : 'times'}, about every ${minutesLabel(m.appUs / m.switches / 1000)}.`);
  }
  if (m.baselineGood && m.baseBlinkPerMin !== null && m.baseBlinkPerMin >= 4 && m.blinkPerMin !== null) {
    const drop = (m.baseBlinkPerMin - m.blinkPerMin) / m.baseBlinkPerMin;
    const r = Math.round;
    add(
      'blinking',
      drop / 0.5,
      drop >= 0.1
        ? `You blinked ${pct(drop)}% less than your normal (${r(m.blinkPerMin)} a minute, against ${r(m.baseBlinkPerMin)}): steady looking.`
        : drop <= -0.1
          ? `You blinked more than your normal (${r(m.blinkPerMin)} a minute, against ${r(m.baseBlinkPerMin)}).`
          : `You blinked about as often as your normal (${r(m.blinkPerMin)} a minute).`,
    );
  }
  return parts;
}

export function focusScore(parts: PullPart[]): number | null {
  return score(parts);
}

export function focusBand(s: number | null): string {
  if (s === null) return 'Not enough to score';
  if (s < 40) return 'Scattered';
  if (s < 60) return 'Patchy';
  if (s < 80) return 'Steady';
  return 'Deep';
}

/** Durations in sentences: "45 s", "4 min 12 s", and whole minutes from 10 minutes up. */
export function focusDuration(us: number): string {
  const ms = Math.max(0, us / 1000);
  if (ms >= 10 * 60_000) return `${Math.round(ms / 60_000)} min`;
  return minutesLabel(ms);
}

/** Self-report after a focus session, 1-5. */
export const FOCUS_FELT = ['Scattered', 'Distracted', 'Okay', 'Focused', 'Locked in'] as const;

export interface FocusWordsInputs extends FocusMeasures {
  score: number | null;
  /** Breathing pauses, or null when breathing couldn't be read. */
  holds: number | null;
  /** How focused it felt, 1-5, or null. */
  felt: number | null;
}

/** The headline and one suggestion, from the person's own numbers. Plain, descriptive, never about health. */
export function focusWords(i: FocusWordsInputs): { summary: string; suggestion: { key: string; text: string } | null } {
  if (i.activeUs < FOCUS.minUs) return { summary: 'Too short to read. A report needs at least 20 seconds of focus time.', suggestion: null };
  if (i.measuredUs < FOCUS.minUs || i.score === null)
    return { summary: 'There wasn’t enough clear view of your face to read this session. Steady light and staying in view help.', suggestion: null };
  const d = focusDuration;
  const share = i.focusedUs / i.measuredUs;
  const summary = `${focusBand(i.score)} focus: your eyes stayed on the work for ${d(i.focusedUs)} of ${d(i.measuredUs)} (${pct(share)}%), and your longest stretch without a break was ${d(i.longestUs)}.`;

  const c: { key: string; s: number; text: string }[] = [];
  if (i.felt !== null && i.felt <= 2 && share >= 0.8)
    c.push({ key: 'felt', s: 0.9, text: `It felt ${i.felt === 1 ? 'scattered' : 'distracted'}, but your eyes stayed on the work ${pct(share)}% of the time. You may be more focused than it feels.` });
  if (i.felt !== null && i.felt >= 4 && share < 0.6)
    c.push({ key: 'felt', s: 0.9, text: `It felt focused, but your eyes were off the work for ${d(i.measuredUs - i.focusedUs)}. The focus map shows when.` });
  if (i.switches !== null && i.switches >= 3 && i.appUs >= FOCUS.minUs) {
    const per10 = i.switches / (i.appUs / 600e6);
    if (per10 >= 4) c.push({ key: 'switches', s: Math.min(1, per10 / 10), text: `You switched apps about every ${d(i.appUs / i.switches)}. Next time, quit chat and mail before you start, so the work is the only thing open.` });
  }
  if (i.breaks >= 2) {
    const per10 = i.breaks / (i.measuredUs / 600e6);
    if (per10 >= 2) c.push({ key: 'breaks', s: Math.min(1, per10 / 6), text: `Your focus broke ${i.breaks} times, about every ${d(i.measuredUs / i.breaks)}. Next time, put your phone out of reach before you start.` });
  }
  if (i.leftCount >= 1)
    c.push({ key: 'desk', s: 0.4, text: `You left your desk ${i.leftCount === 1 ? 'once' : `${i.leftCount} times`}. If you went to fetch something, keep it within reach next time.` });
  if (i.holds !== null && i.holds >= 3) {
    const perMin = i.holds / (i.activeUs / 60e6);
    if (perMin >= 0.3) c.push({ key: 'pauses', s: Math.min(0.8, perMin), text: `You paused your breathing ${i.holds} times while you worked. When you notice it, let one slow breath out and carry on.` });
  }
  if (!c.length)
    return {
      summary,
      suggestion:
        i.score >= 75
          ? { key: 'keep', text: 'A strong session. Next time, keep the same setup: same length, notifications off.' }
          : { key: 'shorter', text: 'Next time, try a shorter session with one clear goal, and see if the stretches get longer.' },
    };
  c.sort((a, b) => b.s - a.s);
  return { summary, suggestion: { key: c[0]!.key, text: c[0]!.text } };
}

/** Focus along the session, one value per bin: the share of measured time that was focused. null without a reading. */
export function focusCurve(active: Interval[], spans: FocusSpans, binUs: number): (number | null)[] {
  const act = merge(active);
  if (!act.length) return [];
  const start = act[0]!.start;
  const end = act[act.length - 1]!.end;
  const out: (number | null)[] = [];
  for (let t = start; t < end; t += binUs) {
    const e = Math.min(end, t + binUs);
    const f = overlap(spans.focused, t, e);
    const b = overlap(spans.breaks, t, e);
    const a = overlap(act, t, e);
    out.push(a > 0 && (f + b) / a >= 0.4 ? Math.round((f / (f + b)) * 1000) / 1000 : null);
  }
  return out;
}

/** Focus sessions over time (History): the recent scored sessions, averages, and the apps you focus best in. */
export interface FocusTrend {
  /** Oldest first, at most `max`. */
  sessions: { id: string; startedAt: number; title: string; share: number; score: number; longestMs: number }[];
  avgShare: number;
  avgScore: number;
  longestMs: number;
  /** Across all those sessions, apps with at least 2 minutes in front, most focused first (at most 3). */
  bestApps: { name: string; share: number; ms: number }[];
}

export function focusTrend(reports: { id: string; mode: string; startedAt: number; title: string | null; pull: { score: number | null }; focus?: { measuredMs: number; focusedMs: number; longestMs: number; apps: { name: string; ms: number; focusedMs: number }[] | null } }[], max = 12): FocusTrend | null {
  const scored = reports
    .filter((r) => r.mode === 'focus' && r.focus && r.pull.score !== null && r.focus.measuredMs > 0)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-max);
  if (scored.length < 2) return null;
  const sessions = scored.map((r) => ({ id: r.id, startedAt: r.startedAt, title: r.title || 'Focus session', share: r.focus!.focusedMs / r.focus!.measuredMs, score: r.pull.score!, longestMs: r.focus!.longestMs }));
  const apps = new Map<string, { ms: number; focusedMs: number }>();
  for (const r of scored)
    for (const a of r.focus!.apps ?? []) {
      if (a.name === OTHER_APPS) continue;
      const x = apps.get(a.name) ?? { ms: 0, focusedMs: 0 };
      x.ms += a.ms;
      x.focusedMs += a.focusedMs;
      apps.set(a.name, x);
    }
  const bestApps = [...apps]
    .filter(([, v]) => v.ms >= 120_000)
    .map(([name, v]) => ({ name, share: v.focusedMs / v.ms, ms: v.ms }))
    .sort((a, b) => b.share - a.share || b.ms - a.ms)
    .slice(0, 3);
  return {
    sessions,
    avgShare: sessions.reduce((s, x) => s + x.share, 0) / sessions.length,
    avgScore: Math.round(sessions.reduce((s, x) => s + x.score, 0) / sessions.length),
    longestMs: Math.max(...sessions.map((x) => x.longestMs)),
    bestApps,
  };
}
