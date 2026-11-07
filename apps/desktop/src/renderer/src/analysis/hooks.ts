import type { ClipResult } from '@counterfeed/shared';
import { smooth } from './curve';
import type { ExprEvent } from './detect';
import { contains, intersect, merge, overlap, total, type Interval } from './intervals';
import { playingIntervals, TimeMap, type TimeMark } from './timemap';

/*
 * Hook test: a few short clips watched like a feed (each plays once; you can swipe on), ranked by how strongly
 * each one held you. Pure and unit-tested.
 *
 * Hold score = 100 × stayed × (0.35 + 0.65 × engagement)
 *   stayed: share of the clip you watched before swiping (1 if you watched it to the end). It multiplies
 *     everything, so a clip you swiped early can never outrank one you watched, however you looked at it.
 *   engagement: while it played, a weighted mean of facing the screen (SDK face check + head pose, which held up
 *     in real recordings), going without blinking compared with your own usual gap, and strong smile or
 *     surprise probabilities. Unmeasurable parts are left out; with none measurable it counts as average (0.5).
 * Blinks weigh less than staying because the SDK misses some blinks, and a short clip may hold only one or two.
 */

export interface ClipInfo {
  name: string;
  /** From the file's metadata; null if it never loaded. */
  durationMs: number | null;
}

/** One clip playing: wall-clock span (µs) and the player's position marks inside it. */
export interface ClipRun {
  clip: number;
  start: number;
  end: number;
  endedBy: 'end' | 'skip' | 'stop' | 'error';
  marks: TimeMark[];
}

export interface HookSignals {
  /** Face clearly in view and toward the screen. */
  clear: Interval[];
  away: Interval[];
  /** Blink times (µs), sorted. */
  blinks: number[];
  hasBlinkData: boolean;
  /** Your usual blink rate, from "your normal" (null if it couldn't be measured). */
  baseBlinkPerMin: number | null;
  expressions: ExprEvent[];
}

export const HOOK = {
  /** stayed is the base share; the other three split the engagement share (0.65) in these proportions. */
  weights: { stayed: 0.35, eyes: 0.2, stare: 0.25, face: 0.2 },
  /** Engagement when none of its parts could be measured. */
  neutral: 0.5,
  /** "The hook": the first 3 seconds of a clip. */
  openingMs: 3000,
  /** A second counts as "held you strongly" at this attention level or more… */
  grab: 0.9,
  /** …for this many seconds in a row. */
  grabBins: 2,
  /** Sampling step along the clip. */
  stepUs: 100_000,
  /** Blinks and expressions are only read with this much clear view of the face. */
  minClearUs: 3e6,
  /** Top two within this many points: a close call. */
  closeCall: 8,
  /** Usual gap between blinks when your normal couldn't be measured. */
  defaultGapUs: 4e6,
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Your usual gap between blinks (µs), kept between 2 and 12 s. */
export function usualGapUs(baseBlinkPerMin: number | null): number {
  if (!baseBlinkPerMin || baseBlinkPerMin <= 0) return HOOK.defaultGapUs;
  return Math.min(12e6, Math.max(2e6, 60e6 / baseBlinkPerMin));
}

/** Index of the last blink at or before t, or -1. */
function lastBlinkIdx(blinks: number[], t: number): number {
  let lo = 0;
  let hi = blinks.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blinks[mid]! <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface ClipAnalysis {
  result: ClipResult;
  /** Wall time (µs) of the clip's strongest moment, for picking a still; null if it never played. */
  stillT: number | null;
}

/**
 * Attention at wall time t while facing the screen: 0.5 for "watching", rising to 1 the longer you go without
 * blinking (relative to your usual gap; a blink resets it), plus 0.25 during a strong smile or surprise.
 */
function attention(t: number, s: HookSignals, gapUs: number, faces: ExprEvent[]): number {
  let a = 0.5;
  if (s.hasBlinkData) {
    const i = lastBlinkIdx(s.blinks, t);
    const since = i < 0 ? gapUs : t - s.blinks[i]!;
    a = 0.5 + 0.5 * Math.min(1, since / gapUs);
  }
  if (faces.some((e) => t >= e.start && t <= e.end + 1e6)) a = Math.min(1, a + 0.25);
  return a;
}

export function analyzeClip(index: number, info: ClipInfo, run: ClipRun | undefined, s: HookSignals): ClipAnalysis {
  const base: ClipResult = {
    index,
    name: info.name.slice(0, 160),
    durationMs: Math.max(0, Math.round(info.durationMs ?? 0)),
    watchedMs: 0,
    status: 'unwatched',
    leftAtMs: null,
    score: null,
    rank: null,
    hook: 'unclear',
    grabbedAtMs: null,
    bestMs: null,
    awayMs: 0,
    parts: [],
    curve: [],
    thumb: null,
  };
  if (!run) return { result: base, stillT: null };
  if (run.endedBy === 'error') return { result: { ...base, status: 'failed' }, stillT: null };

  const map = new TimeMap();
  for (const m of run.marks) map.add(m);
  const end = run.end || run.marks[run.marks.length - 1]?.t || run.start;
  const active = merge(intersect(playingIntervals(map.all, end), [{ start: run.start, end }]));
  const watchedUs = total(active);
  const maxPos = Math.max(0, ...run.marks.map((m) => m.c));
  const durationMs = info.durationMs && info.durationMs > 0 ? info.durationMs : maxPos;
  const status: ClipResult['status'] = run.endedBy === 'end' ? 'finished' : run.endedBy === 'skip' ? 'skipped' : 'stopped';
  const leftAtMs = status === 'finished' ? null : Math.round(Math.min(maxPos, durationMs || maxPos));
  const stayed = status === 'finished' ? 1 : durationMs > 0 ? clamp01(maxPos / durationMs) : 0;

  const gapUs = usualGapUs(s.baseBlinkPerMin);
  const faces = s.expressions.filter((e) => (e.kind === 'smile' || e.kind === 'surprise') && overlap(active, e.start, e.end + 1e6) > 0);

  // Second-by-second along the clip.
  const nBins = Math.max(1, Math.ceil(Math.max(durationMs, 1) / 1000));
  const bins = Array.from({ length: nBins }, () => ({ n: 0, seen: 0, sum: 0, away: 0, firstT: null as number | null }));
  let clearN = 0;
  let stareSum = 0;
  for (const seg of active) {
    for (let t = seg.start; t < seg.end; t += HOOK.stepUs) {
      const pos = map.at(t);
      if (pos === null) continue;
      const b = bins[Math.min(nBins - 1, Math.max(0, Math.floor(pos / 1000)))]!;
      b.n++;
      if (contains(s.away, t)) {
        b.seen++;
        b.away++;
        b.firstT ??= t;
      } else if (contains(s.clear, t)) {
        const a = attention(t, s, gapUs, faces);
        b.seen++;
        b.sum += a;
        b.firstT ??= t;
        clearN++;
        if (s.hasBlinkData) {
          const i = lastBlinkIdx(s.blinks, t);
          stareSum += Math.min(1, (i < 0 ? gapUs : t - s.blinks[i]!) / gapUs);
        }
      }
    }
  }
  const curve = bins.map((b) => (b.n >= 3 && b.seen >= 0.5 * b.n ? Math.round((b.sum / b.seen) * 1000) / 1000 : null));
  const clearUs = clearN * HOOK.stepUs;
  const awayUs = total(intersect(merge(s.away), active));

  // Parts of the score.
  const parts: ClipResult['parts'] = [];
  const add = (key: ClipResult['parts'][number]['key'], value: number, detail: string) => parts.push({ key, value: clamp01(value), weight: HOOK.weights[key], detail });
  add('stayed', stayed, status === 'finished' ? 'Watched to the end.' : status === 'skipped' ? `Swiped at ${mmss(leftAtMs ?? 0)} of ${mmss(durationMs)}.` : `The session ended at ${mmss(leftAtMs ?? 0)} of ${mmss(durationMs)}.`);
  if (watchedUs >= 1e6 && clearUs + awayUs >= 0.4 * watchedUs) {
    const facing = 1 - Math.min(1, awayUs / watchedUs);
    add('eyes', (facing - 0.6) / 0.4, awayUs >= 500_000 ? `Looked away for ${Math.max(1, Math.round(awayUs / 1e6))} s.` : 'Faced the screen the whole time.');
  }
  if (s.hasBlinkData && clearUs >= HOOK.minClearUs) {
    const v = (stareSum / clearN - 0.5) / 0.5;
    add('stare', v, v >= 0.5 ? 'Blinked much less than your usual.' : v > 0.15 ? 'Blinked a little less than your usual.' : 'Blinked about as often as usual.');
  }
  if (clearUs >= HOOK.minClearUs) {
    const top = faces.reduce<ExprEvent | null>((m, e) => (!m || e.peak > m.peak ? e : m), null);
    add('face', top ? (top.peak - 40) / 50 : 0, top ? `${top.kind === 'smile' ? 'Smile' : 'Surprise'} probability peaked at ${Math.round(top.peak)}%.` : 'No strong facial expression.');
  }
  const eng = parts.filter((p) => p.key !== 'stayed');
  const ew = eng.reduce((a, p) => a + p.weight, 0);
  const engagement = ew > 0 ? eng.reduce((a, p) => a + p.weight * p.value, 0) / ew : HOOK.neutral;
  // Swiped before it even played is still an answer: it scores 0 and ranks last.
  const score = watchedUs > 0 || status === 'skipped' ? Math.round(100 * stayed * (HOOK.weights.stayed + (1 - HOOK.weights.stayed) * engagement)) : null;

  // When it grabbed you: 2 s in a row at a strong level, or the start of a strong expression.
  let grabbed: number | null = null;
  for (let i = 0; i + HOOK.grabBins - 1 < curve.length; i++) {
    if (curve.slice(i, i + HOOK.grabBins).every((v) => v !== null && v >= HOOK.grab)) {
      grabbed = i * 1000;
      break;
    }
  }
  for (const e of faces) {
    const p = map.at(Math.max(e.start, active[0]?.start ?? e.start));
    if (p !== null && (grabbed === null || p < grabbed)) grabbed = Math.round(p);
  }
  const sm = smooth(curve);
  let best: number | null = null;
  for (let i = 0; i < sm.length; i++) {
    const v = sm[i];
    if (v != null && v >= 0.6 && (best === null || v > sm[best]!)) best = i;
  }

  // The hook: the first 3 seconds.
  const openBins = bins.slice(0, Math.ceil(HOOK.openingMs / 1000));
  const openN = openBins.reduce((a, b) => a + b.n, 0);
  const openSeen = openBins.reduce((a, b) => a + b.seen, 0);
  const openAwayUs = openBins.reduce((a, b) => a + b.away, 0) * HOOK.stepUs;
  let hook: ClipResult['hook'];
  if ((status === 'skipped' && (leftAtMs ?? 0) < HOOK.openingMs) || openAwayUs >= 1e6) hook = 'lost';
  else if (openN < 20 || openSeen < 0.5 * openN) hook = 'unclear';
  else if (grabbed !== null && grabbed < HOOK.openingMs) hook = 'landed';
  else if (grabbed !== null) hook = 'slow';
  else hook = 'steady';
  // A clip that lost you in its first 3 s didn't grab you there (a stare carried over from the clip before can
  // look like one).
  if (hook === 'lost' && grabbed !== null && grabbed < HOOK.openingMs) grabbed = null;

  const bestBin = best === null ? null : bins[best]!;
  const stillT = bestBin?.firstT ?? (active.length ? active[0]!.start + Math.min(1.5e6, watchedUs / 2) : null);

  return {
    result: {
      ...base,
      durationMs: Math.round(durationMs),
      watchedMs: Math.round(watchedUs / 1000),
      status,
      leftAtMs,
      score,
      hook,
      grabbedAtMs: grabbed,
      bestMs: best === null ? null : best * 1000,
      awayMs: Math.round(awayUs / 1000),
      parts,
      curve,
    },
    stillT,
  };
}

/** Every clip, in play order, ranked (1 = held you hardest). Unwatched and failed clips aren't ranked. */
export function analyzeClips(clips: ClipInfo[], runs: ClipRun[], s: HookSignals): ClipAnalysis[] {
  const out = clips.map((info, i) => analyzeClip(i, info, runs.find((r) => r.clip === i), s));
  const stayedOf = (r: ClipResult) => r.parts.find((p) => p.key === 'stayed')?.value ?? 0;
  const ranked = out.map((a) => a.result).filter((r) => r.score !== null);
  ranked.sort((a, b) => b.score! - a.score! || stayedOf(b) - stayedOf(a) || a.index - b.index);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return out;
}

/** "“Fractal dive”": the name without its extension, at most 40 characters. */
export function clipName(name: string): string {
  const n = name.replace(/\.[a-z0-9]{2,4}$/i, '').trim() || 'Untitled clip';
  return `“${n.length > 40 ? `${n.slice(0, 39)}…` : n}”`;
}

export const HOOK_LABEL: Record<ClipResult['hook'], string> = {
  landed: 'Landed in the first 3 s',
  slow: 'Slow start',
  steady: 'Kept you, nothing stood out',
  lost: 'Lost you in the first 3 s',
  unclear: 'Not enough view to tell',
};

export function isCloseCall(clips: ClipResult[]): boolean {
  const r = clips.filter((c) => c.rank !== null).sort((a, b) => a.rank! - b.rank!);
  return r.length >= 2 && r[0]!.score! - r[1]!.score! < HOOK.closeCall;
}

/** The headline and one suggestion for a hook test, from its own numbers. */
export function hookWords(clips: ClipResult[], picked: number | null): { summary: string; suggestion: { key: string; text: string } | null } {
  const ranked = clips.filter((c) => c.rank !== null).sort((a, b) => a.rank! - b.rank!);
  if (ranked.length < 2) return { summary: 'Watch at least two clips to compare them.', suggestion: null };
  const w = ranked[0]!;
  const second = ranked[1]!;
  const close = isCloseCall(clips);
  const why: string[] = [];
  if (w.status === 'finished') why.push('you watched it to the end');
  else why.push(`you stayed for ${mmss(w.leftAtMs ?? 0)}`);
  if (w.hook === 'landed') why.push('it held you from the first 3 seconds');
  else if (w.grabbedAtMs !== null) why.push(`it grabbed you at ${mmss(w.grabbedAtMs)}`);
  const summary = `${clipName(w.name)} held you hardest${close ? `, just ahead of ${clipName(second.name)}` : ''}: ${why.join(' and ')}.`;

  const c: { key: string; s: number; text: string }[] = [];
  const p = picked === null ? null : clips.find((x) => x.index === picked && x.rank !== null);
  if (p && p.index !== w.index) c.push({ key: 'pick', s: 0.9, text: `You’d post ${clipName(p.name)}, but your body stayed with ${clipName(w.name)}. Watch both again before you choose.` });
  const slow = ranked.filter((x) => x.hook === 'slow' && x.grabbedAtMs !== null)[0];
  if (slow) c.push({ key: 'slow', s: 0.8, text: `${clipName(slow.name)} grabbed you at ${mmss(slow.grabbedAtMs!)}. Try opening with that moment.` });
  const lost = ranked.filter((x) => x.hook === 'lost').sort((a, b) => b.rank! - a.rank!)[0];
  if (lost)
    c.push({
      key: 'lost',
      s: 0.6,
      text: lost.status === 'skipped' && (lost.leftAtMs ?? 0) < HOOK.openingMs ? `You swiped ${clipName(lost.name)} after ${Math.max(1, Math.round((lost.leftAtMs ?? 0) / 1000))} s. Its first seconds are the part to rework.` : `You looked away from ${clipName(lost.name)} in its first 3 seconds. Its opening is the part to rework.`,
    });
  if (close) c.push({ key: 'close', s: 0.5, text: `${clipName(w.name)} and ${clipName(second.name)} were close. Try them on someone else too.` });
  c.push({ key: 'lead', s: 0.1, text: `${clipName(w.name)} is the one to lead with.` });
  c.sort((a, b) => b.s - a.s);
  return { summary, suggestion: { key: c[0]!.key, text: c[0]!.text } };
}
