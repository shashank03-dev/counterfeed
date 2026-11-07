import { median } from '../lib/stats';
import type { Detection, ExpressionSample, HrvSample, PoseSample, RateSample, TraceSample } from '../sensing/normalize';
import { CHEST_CODES, V } from '../sensing/quality';
import { contains, intersect, merge, overlap, subtract, total, type Interval } from './intervals';

/*
 * Detectors: raw SmartSpectra samples -> moments a person can recognise. Pure, unit-tested, and conservative:
 * every detector works only on stretches where the camera had a clear view, and says "no data" (null) rather than
 * guessing when there isn't enough.
 */

export type FaceState = 'ok' | 'away' | 'unclear';

/** Face turned away or out of frame. Other non-OK codes (light, motion, framing) are "unclear": excluded, not "away". */
const AWAY = new Set<number>([V.noFace, V.notForward]);

/**
 * One SDK validation code -> what it means for the face measures (blinks, expressions, gaze). Chest-only codes
 * ("place more of the chest in view", too high/low/close/far) mean the face WAS found, so they count as a clear
 * view of the face; they only make the breathing wave unreadable (see `viewIntervals`).
 */
export function faceStateOf(code: number): FaceState {
  if (code === V.ok || CHEST_CODES.has(code)) return 'ok';
  return AWAY.has(code) ? 'away' : 'unclear';
}

/** Quality timeline -> intervals per state over [span.start, span.end). Before the first report: unclear. */
export function faceIntervals(quality: { t: number; code: number }[], span: Interval): Record<FaceState, Interval[]> {
  const out: Record<FaceState, Interval[]> = { ok: [], away: [], unclear: [] };
  const q = [...quality].sort((a, b) => a.t - b.t);
  let state: FaceState = 'unclear';
  let at = span.start;
  for (const x of q) {
    if (x.t <= span.start) {
      state = faceStateOf(x.code);
      continue;
    }
    if (x.t >= span.end) break;
    out[state].push({ start: at, end: x.t });
    state = faceStateOf(x.code);
    at = x.t;
  }
  out[state].push({ start: at, end: span.end });
  return { ok: merge(out.ok), away: merge(out.away), unclear: merge(out.unclear) };
}

/** Intervals inside `span` where the SDK reported a code matching `pred` (nothing before the first report). */
export function codeIntervals(quality: { t: number; code: number }[], span: Interval, pred: (code: number) => boolean): Interval[] {
  const out: Interval[] = [];
  const q = [...quality].sort((a, b) => a.t - b.t);
  let on = false;
  let at = span.start;
  for (const x of q) {
    if (x.t <= span.start) {
      on = pred(x.code);
      continue;
    }
    if (x.t >= span.end) break;
    if (on) out.push({ start: at, end: x.t });
    on = pred(x.code);
    at = x.t;
  }
  if (on) out.push({ start: at, end: span.end });
  return merge(out);
}

/**
 * The SDK's face streams going quiet. From a real focus recording (Nov 2026): when the person left the desk the SDK
 * simply stopped sending face data for 33 s and never reported "no face" (the last code, "chest not in view", stayed
 * up); when the head turned or tilted beyond the landmark tracker's range, landmarks stopped for 1.5-10 s while
 * blinking kept coming. Facing the screen, the landmark stream had no gap at all.
 */
export const SIGNAL = {
  /** No face data at all for this long: nobody in front of the camera. */
  goneUs: 2e6,
  /** No landmarks for this long while the face is still seen: head turned beyond what the tracker follows. */
  lostUs: 1e6,
} as const;

/**
 * Stretches of `span` at least `minUs` long with no sample in `times` (ascending). A gap still open at the end of
 * the span needs `edgeUs` more, so a live edge isn't flagged while the next packet is on its way.
 */
export function streamGaps(times: number[], span: Interval, minUs: number, edgeUs = 0): Interval[] {
  const out: Interval[] = [];
  let prev = span.start;
  for (const t of times) {
    if (t < span.start) continue;
    if (t >= span.end) break;
    if (t - prev >= minUs) out.push({ start: prev, end: t });
    prev = t;
  }
  if (span.end - prev >= minUs + edgeUs) out.push({ start: prev, end: span.end });
  return out;
}

/**
 * Looking away, from head pose (face landmarks), measured against YOUR OWN recent pose rather than a fixed
 * "straight ahead": people sit differently, and change posture during a session. Tuned on a real recording:
 * facing the screen varied by about ±0.03 in both ratios; turning the head to the side moved yaw by ~0.9;
 * looking down at the lap raised pitch by ~0.15; sitting back lowered pitch by ~0.13 (not looking away).
 */
export const POSE = {
  /** Turned left/right: yaw moves this far from your normal (share of face width). */
  yaw: 0.18,
  /** Looking down (e.g. at a phone in your lap): pitch rises this far above your normal. */
  down: 0.1,
  /** Looking well up: pitch falls this far below your normal. Sitting back moved it by up to 0.25 in the real
   *  recording, and sitting back is what we ask people to do for breathing, so only extreme tilts count. */
  up: 0.4,
  /** A change must hold this long to count, both into and out of "away" (ignores blinks of the tracker). */
  holdUs: 400_000,
  /** Your normal is the median pose over this much recent facing time. */
  windowUs: 60e6,
  /** Samples needed before a normal exists. */
  minSamples: 15,
  /** A gap in the landmark stream this long ends a run (the SDK's own "no face" covers lost faces). */
  gapUs: 2e6,
  /** A run longer than this is treated as a new posture: your normal is re-learned from the latest pose. */
  maxRunUs: 60e6,
} as const;

/** Head turned away from the screen, from head pose against your own normal. `seed` = poses that set the normal first. */
export function poseAway(pose: PoseSample[], span: Interval, seed: PoseSample[] = []): Interval[] {
  const pool: PoseSample[] = [...seed].sort((a, b) => a.t - b.t);
  const recent: PoseSample[] = [];
  let base: { yaw: number; pitch: number } | null = null;
  let baseAt = -Infinity;
  const relearn = (now: number) => {
    while (pool.length && pool[0]!.t < now - POSE.windowUs) pool.shift();
    base = pool.length >= POSE.minSamples ? { yaw: median(pool.map((p) => p.yaw)), pitch: median(pool.map((p) => p.pitch)) } : null;
    baseAt = now;
  };
  relearn(pool.length ? pool[pool.length - 1]!.t : span.start);

  const out: Interval[] = [];
  let away = false;
  let runStart = 0;
  let pendingAt: number | null = null;
  let lastT = -Infinity;
  const close = (end: number) => {
    if (away && end > runStart) out.push({ start: runStart, end });
    away = false;
    pendingAt = null;
  };
  for (const p of [...pose].sort((a, b) => a.t - b.t)) {
    if (p.t < span.start || p.t >= span.end) continue;
    if (p.t - lastT > POSE.gapUs) close(lastT);
    lastT = p.t;
    recent.push(p);
    while (recent.length && recent[0]!.t < p.t - 5e6) recent.shift();
    if (p.t - baseAt >= 1e6) relearn(p.t);
    if (!base) {
      pool.push(p);
      continue;
    }
    const b: { yaw: number; pitch: number } = base;
    const dp = p.pitch - b.pitch;
    const off = Math.abs(p.yaw - b.yaw) > POSE.yaw || dp > POSE.down || dp < -POSE.up;
    if (off !== away) {
      pendingAt ??= p.t;
      if (p.t - pendingAt >= POSE.holdUs) {
        if (off) {
          away = true;
          runStart = pendingAt;
        } else {
          out.push({ start: runStart, end: pendingAt });
          away = false;
        }
        pendingAt = null;
      }
    } else pendingAt = null;
    if (!away && !off) pool.push(p);
    if (away && p.t - runStart > POSE.maxRunUs) {
      // Held this long: a new way of sitting, not a glance away. Re-learn your normal from the latest pose.
      close(p.t);
      pool.length = 0;
      pool.push(...recent);
      relearn(p.t);
    }
  }
  close(lastT);
  return merge(out.map((i) => ({ start: Math.max(span.start, i.start), end: Math.min(span.end, i.end) })).filter((i) => i.end > i.start));
}

export interface View {
  /** Face clearly in view and toward the screen: blinks, expressions and stares are read here. */
  ok: Interval[];
  /** Turned away or out of frame (SDK code, or head pose against your normal). */
  away: Interval[];
  /** Can't tell (light, motion, camera adjusting, several faces). Left out of everything. */
  unclear: Interval[];
  /** Face OK and the SDK fully happy, chest included: the only time the breathing wave is read. */
  breath: Interval[];
  /** No face data at all (also inside `away`): nobody in front of the camera. */
  gone: Interval[];
}

/**
 * Where each measure can be trusted. The SDK reports ONE validation code at a time, so "chest not in view" can
 * hide a head turn; head pose from the landmarks catches turns and looking down regardless of that code.
 */
export function viewIntervals(
  quality: { t: number; code: number }[],
  span: Interval,
  pose: PoseSample[] = [],
  seed: PoseSample[] = [],
  /** Times of samples that need a face (blink detections), even if none. Pass only when the source sends landmarks. */
  faceTimes?: number[],
  edgeUs = 0,
): View {
  const code = faceIntervals(quality, span);
  const turned = pose.length ? poseAway(pose, span, seed) : [];
  // Any face data at all (blinks or landmarks) means someone is there: after a return, landmarks came back 3 s
  // before blinks in a real run. An empty window with face timing on means nobody has been there all along.
  const seen = faceTimes ? [...faceTimes, ...pose.map((p) => p.t)].sort((a, b) => a - b) : [];
  const gone = faceTimes ? streamGaps(seen, span, SIGNAL.goneUs, edgeUs) : [];
  const lost = faceTimes ? lostLandmarks(pose, span, seed, turned, gone, edgeUs) : { away: [], unclear: [] };
  const away = merge([...code.away, ...turned, ...lost.away, ...gone]);
  const unclear = subtract(merge([...code.unclear, ...lost.unclear]), away);
  const ok = subtract(subtract(code.ok, away), unclear);
  return { ok, away, unclear, breath: intersect(ok, codeIntervals(quality, span, (c) => c === V.ok)), gone };
}

/**
 * Landmark gaps while the face is still seen. The tracker loses the face when the head turns or tilts far, but it
 * can also drop out for reasons we can't see. So a gap counts as "away" only when the head was already moving away
 * at either edge (turned, or the few poses next to the gap are off your normal); otherwise it's "can't tell".
 */
function lostLandmarks(pose: PoseSample[], span: Interval, seed: PoseSample[], turned: Interval[], gone: Interval[], edgeUs: number) {
  const sorted = [...pose].sort((a, b) => a.t - b.t);
  const gaps = subtract(streamGaps(sorted.map((p) => p.t), span, SIGNAL.lostUs, edgeUs), gone);
  const out = { away: [] as Interval[], unclear: [] as Interval[] };
  for (const g of gaps) {
    const touchesTurn = turned.some((i) => i.end >= g.start - 500_000 && i.start <= g.end + 500_000);
    const facing = [...seed, ...sorted.filter((p) => p.t >= g.start - POSE.windowUs && p.t < g.start && !contains(turned, p.t))];
    let off = false;
    if (facing.length >= POSE.minSamples) {
      const b = { yaw: median(facing.map((p) => p.yaw)), pitch: median(facing.map((p) => p.pitch)) };
      const edge = (xs: PoseSample[]) => {
        if (!xs.length) return false;
        const dp = median(xs.map((p) => p.pitch)) - b.pitch;
        return Math.abs(median(xs.map((p) => p.yaw)) - b.yaw) > POSE.yaw || dp > POSE.down || dp < -POSE.up;
      };
      const before = sorted.filter((p) => p.t <= g.start && p.t > g.start - 500_000);
      const after = sorted.filter((p) => p.t >= g.end && p.t < g.end + 500_000);
      off = edge(before) || edge(after);
    }
    (touchesTurn || off ? out.away : out.unclear).push(g);
  }
  return out;
}

/** Blink times: rising edges of the SDK's blink detection, at least 150 ms apart. */
export function blinkTimes(d: Detection[]): number[] {
  const out: number[] = [];
  let prev = false;
  for (const x of [...d].sort((a, b) => a.t - b.t)) {
    if (x.detected && !prev && (!out.length || x.t - out[out.length - 1]! >= 150_000)) out.push(x.t);
    prev = x.detected;
  }
  return out;
}

/** Blinks per minute inside `within`. null when there's under 15 s of clear view or no blink data at all. */
export function blinkRate(blinks: number[], detections: Detection[], within: Interval[]): number | null {
  const us = total(within);
  if (us < 15e6) return null;
  if (!detections.some((d) => contains(within, d.t))) return null;
  const n = blinks.filter((t) => contains(within, t)).length;
  return n / (us / 60e6);
}

/** Threshold for a "long stretch without blinking": 2.5 x your usual gap, kept between 8 and 20 s. */
export function noBlinkThreshold(baselinePerMin: number | null): number {
  if (!baselinePerMin || baselinePerMin <= 0) return 12e6;
  return Math.min(20e6, Math.max(8e6, (2.5 * 60e6) / baselinePerMin));
}

/** Stretches without a blink, inside clear view (short flickers of "unclear" under 1 s are bridged). */
export function noBlinkStretches(blinks: number[], clear: Interval[], threshold: number): Interval[] {
  const out: Interval[] = [];
  for (const seg of merge(clear, 1e6)) {
    const inside = blinks.filter((t) => t >= seg.start && t < seg.end);
    const marks = [seg.start, ...inside, seg.end];
    for (let i = 1; i < marks.length; i++) {
      if (marks[i]! - marks[i - 1]! >= threshold) out.push({ start: marks[i - 1]!, end: marks[i]! });
    }
  }
  return out;
}

const BIN = 100_000; // 10 Hz

/** Trace samples -> 10 Hz bins (mean), only inside `valid`. */
function binned(trace: TraceSample[], valid: Interval[]): Map<number, number> {
  const sum = new Map<number, [number, number]>();
  for (const s of trace) {
    if (!contains(valid, s.t)) continue;
    const k = Math.floor(s.t / BIN);
    const c = sum.get(k) ?? [0, 0];
    c[0] += s.v;
    c[1]++;
    sum.set(k, c);
  }
  return new Map([...sum].map(([k, [a, n]]) => [k, a / n]));
}

/** Peak-to-peak of the wave over each `win`-bin window ending at each bin (needs 75% of bins present). */
function rollingPtp(bins: Map<number, number>, win: number): Map<number, number> {
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const out = new Map<number, number>();
  if (!keys.length) return out;
  for (const k of keys) {
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    for (let j = k - win + 1; j <= k; j++) {
      const v = bins.get(j);
      if (v === undefined) continue;
      n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (n >= win * 0.75) out.set(k, hi - lo);
  }
  return out;
}

/** Typical breath size: median peak-to-peak over 8 s windows (each spans at least one breath). */
export function breathSize(trace: TraceSample[], valid: Interval[]): number | null {
  const p = [...rollingPtp(binned(trace, valid), 80).values()];
  if (p.length < 50) return null;
  const m = median(p);
  return m > 0 ? m : null;
}

/** Talking stretches (+1 s after), when breathing can't be read. */
export function talkingIntervals(talking: Detection[]): Interval[] {
  return merge(talking.filter((d) => d.detected && d.stable).map((d) => ({ start: d.t, end: d.t + 1e6 })), 300_000);
}

/** Detection stream -> intervals where it was on, at least `minUs` long. */
export function onIntervals(d: Detection[], minUs: number): Interval[] {
  const out: Interval[] = [];
  let start: number | null = null;
  let lastT = 0;
  for (const x of [...d].sort((a, b) => a.t - b.t)) {
    if (x.detected && start === null) start = x.t;
    else if (!x.detected && start !== null) {
      out.push({ start, end: x.t });
      start = null;
    }
    lastT = x.t;
  }
  if (start !== null) out.push({ start, end: lastT });
  return out.filter((i) => i.end - i.start >= minUs);
}

/** Settling margin: breathing is read only this long after the view of face and chest comes back. */
export const BREATH_SETTLE_US = 2e6;
/** A "pause" longer than this isn't a pause: it's the breathing signal fading (no one stops breathing that long while watching). */
export const MAX_HOLD_US = 30e6;
/** At least this share of the wave inside a pause must be marked stable by the SDK. */
export const MIN_HOLD_STABLE = 0.3;

/**
 * Breathing pauses: the wave stays under 30% of your typical breath size for at least 6 s (a normal breath takes
 * 3-5 s, so this is longer than any ordinary pause between breaths), plus any SDK breath-stop detection of 5 s or
 * more. Only where the chest was in view and you weren't talking. A flat stretch longer than 30 s, or one the
 * SDK itself marked mostly unstable, is a faded signal rather than a pause, and is dropped (real recording: a 38 s
 * "pause" while smiling had 15% stable samples; deliberate 12 s holds had 45% or more).
 */
export function breathHolds(trace: TraceSample[], valid: Interval[], reference: number | null, apnea: Detection[]): Interval[] {
  const own: Interval[] = [];
  if (reference && reference > 0) {
    const ptp = rollingPtp(binned(trace, valid), 40);
    let runStart: number | null = null;
    let prev = -Infinity;
    const close = (end: number) => {
      if (runStart === null) return;
      const s = (runStart - 40 + 1) * BIN;
      const e = (end + 1) * BIN;
      if (e - s >= 6e6) own.push({ start: s, end: e });
      runStart = null;
    };
    for (const k of [...ptp.keys()].sort((a, b) => a - b)) {
      const flat = ptp.get(k)! < 0.3 * reference;
      if (flat && runStart !== null && k - prev > 5) close(prev);
      if (flat && runStart === null) runStart = k;
      if (!flat) close(prev);
      prev = k;
    }
    close(prev);
  }
  const sdk = onIntervals(apnea, 5e6);
  const stableShare = (i: Interval) => {
    let n = 0;
    let st = 0;
    for (const s of trace) {
      if (s.t < i.start || s.t >= i.end) continue;
      n++;
      if (s.stable) st++;
    }
    return n ? st / n : 0;
  };
  return intersect(merge([...own, ...sdk], 500_000), merge(valid)).filter((i) => i.end - i.start >= 5e6 && i.end - i.start <= MAX_HOLD_US && stableShare(i) >= MIN_HOLD_STABLE);
}

export type ExprKind = 'smile' | 'surprise' | 'frown';
export interface ExprEvent {
  kind: ExprKind;
  start: number;
  end: number;
  peak: number;
}

/**
 * Facial-expression moments: the smoothed probability (0.5 s) rises to 55+ and at least 25 points above its own
 * level over the previous 10 s. These are facial-expression probabilities, never a claim about feelings.
 */
export function expressionEvents(samples: ExpressionSample[], clear: Interval[]): { events: ExprEvent[]; smileUs: number } {
  const events: ExprEvent[] = [];
  let smileUs = 0;
  const s = samples.filter((x) => contains(clear, x.t)).sort((a, b) => a.t - b.t);
  for (const kind of ['smile', 'surprise', 'frown'] as const) {
    let ema: number | null = null;
    let lastT = 0;
    const hist: { t: number; v: number }[] = [];
    let open: ExprEvent | null = null;
    let lastEnd = -Infinity;
    for (const x of s) {
      const dt = ema === null ? 0 : Math.max(0, x.t - lastT);
      const a: number = ema === null ? 1 : 1 - Math.exp(-dt / 500_000);
      const v: number = x[kind];
      ema = ema === null ? v : ema + a * (v - ema);
      if (kind === 'smile' && ema >= 50 && dt < 2e6) smileUs += dt;
      lastT = x.t;
      while (hist.length && hist[0]!.t < x.t - 10e6) hist.shift();
      const base = hist.length >= 5 ? median(hist.map((h) => h.v)) : null;
      hist.push({ t: x.t, v: ema });
      if (open) {
        open.peak = Math.max(open.peak, ema);
        if (ema < Math.max(40, open.peak - 25) || x.t - open.end > 2e6) {
          events.push(open);
          lastEnd = open.end;
          open = null;
        } else open.end = x.t;
      } else if (base !== null && ema >= 55 && ema - base >= 25 && x.t - lastEnd >= 4e6) {
        open = { kind, start: x.t, end: x.t, peak: ema };
      }
    }
    if (open) events.push(open);
  }
  return { events: events.sort((a, b) => a.start - b.start), smileUs };
}

/** Median of steady pulse readings (confidence 40+, inside the SDK's 40-110 BPM range). */
export function steadyPulse(pulse: RateSample[], within: Interval[]): number | null {
  const v = pulse.filter((p) => p.stable && p.confidence >= 40 && p.value >= 40 && p.value <= 110 && contains(within, p.t)).map((p) => p.value);
  return v.length >= 3 ? median(v) : null;
}

export function steadyBreathRate(rate: RateSample[], within: Interval[]): number | null {
  const v = rate.filter((p) => p.stable && p.confidence >= 45 && contains(within, p.t)).map((p) => p.value);
  return v.length >= 3 ? median(v) : null;
}

/** The last steady HRV reading (needs a full 60 s window, confidence 50+). */
export function lastHrv(hrv: HrvSample[], within: Interval[]): number | null {
  const v = hrv.filter((h) => h.stable && h.confidence >= 50 && contains(within, h.t)).sort((a, b) => a.t - b.t);
  return v.length ? v[v.length - 1]!.rmssd : null;
}

/** Big on-screen changes (swipes, scrolls, cuts): frame difference above 0.12, at least 0.8 s apart. */
export function screenChanges(diffs: { t: number; d: number }[], within: Interval[]): number[] {
  const out: number[] = [];
  for (const x of [...diffs].sort((a, b) => a.t - b.t)) {
    if (x.d < 0.12 || !contains(within, x.t)) continue;
    if (!out.length || x.t - out[out.length - 1]! >= 800_000) out.push(x.t);
  }
  return out;
}

/** Re-exported so callers can work with the same helpers. */
export { intersect, merge, overlap, subtract, total };
