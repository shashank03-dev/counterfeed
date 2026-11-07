import type { ContentKind, Mode, Report, ReportEvent } from '@counterfeed/shared';
import type { Normalized } from '../sensing/normalize';
import { V } from '../sensing/quality';
import { heldMoments, opening } from './curve';
import {
  BREATH_SETTLE_US,
  blinkRate,
  codeIntervals,
  blinkTimes,
  breathHolds,
  breathSize,
  expressionEvents,
  lastHrv,
  noBlinkStretches,
  noBlinkThreshold,
  screenChanges,
  steadyBreathRate,
  steadyPulse,
  talkingIntervals,
  viewIntervals,
} from './detect';
import { elapsedWithin, erode, intersect, len, merge, overlap, subtract, total, type Interval } from './intervals';
import { analyzeClips, clipName, hookWords, type ClipInfo, type ClipRun } from './hooks';
import { appUsage, focusCurve, focusParts, focusScore, focusSpans, focusWords, type AppSample } from './focus';
import { band, score, scoreParts } from './score';
import { TimeMap } from './timemap';
import { suggest, summarize } from './words';

/** Everything one session captured, in wall-clock microseconds. */
export interface Capture {
  mode: Mode;
  signal: 'camera' | 'test';
  startedAt: number;
  endedAt: number;
  settle: Interval;
  /** Watching span; `active` is the part that counts (video playing / window watched). */
  watch: Interval;
  active: Interval[];
  samples: Normalized;
  quality: { t: number; code: number }[];
  timemap: TimeMap | null;
  diffs: { t: number; d: number }[] | null;
  content: { kind: ContentKind; name: string; app: string | null; durationMs: number | null };
  title: string | null;
  partial: boolean;
  notes: string[];
  baselineForced: boolean;
  felt: { before: number | null; after: number | null };
  guessMs: number | null;
  ratings: Report['ratings'];
  reviewNote: string | null;
  /** Hook test: the clips in play order and how each one played. */
  clips?: { info: ClipInfo[]; runs: ClipRun[] } | null;
  /** Hook test: the clip the person said they'd post. */
  picked?: number | null;
  /** Focus session: the length set, the front-app readings (null when app tracking was off) and Do Not Disturb. */
  focus?: { plannedMs: number | null; apps: AppSample[] | null; dnd: 'on' | 'off' | 'failed' } | null;
}

/** A report event plus its wall-clock time (used to attach a picture of the screen). */
export interface TimedEvent extends ReportEvent {
  t: number;
}

const msOf = (us: number) => Math.max(0, Math.round(us / 1000));
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export function buildReport(c: Capture, id: string): { report: Report; events: TimedEvent[]; stills: Map<number, number> } {
  const active = merge(intersect(merge(c.active), [c.watch]));
  const activeUs = total(active);
  const activeMin = activeUs / 60e6;
  const s = c.samples;

  // Where each measure can be trusted, across settle and watch. Head pose is judged against how you sat while the
  // camera learned your normal (its last 30 s), then follows your posture as the session goes on.
  // Face data going quiet counts too (no landmarks: head turned beyond the tracker; nothing at all: nobody there).
  const faceTimes = s.pose.length ? s.blink.map((b) => b.t) : undefined;
  const settleView = viewIntervals(c.quality, c.settle, s.pose, [], faceTimes);
  const settleClear = settleView.ok;
  const seed = s.pose.filter((p) => p.t >= c.settle.end - 30e6 && p.t < c.settle.end && overlap(settleClear, p.t, p.t + 1) > 0);
  const view = viewIntervals(c.quality, c.watch, s.pose, seed, faceTimes);
  const clear = intersect(view.ok, active);
  const away = intersect(view.away, active);

  // Your normal (settle). Face measures need the face; breathing also needs the chest in view.
  const blinks = blinkTimes(s.blink);
  const baseBlink = blinkRate(blinks, s.blink, settleClear);
  const basePulse = steadyPulse(s.pulse, [c.settle]);
  const talk = talkingIntervals(s.talking);
  const settleBreathValid = subtract(erode(settleView.breath, BREATH_SETTLE_US), talk);
  const baseBreath = total(settleBreathValid) >= 15e6 ? steadyBreathRate(s.rate, settleBreathValid) : null;
  const baseSize = total(settleBreathValid) >= 15e6 ? breathSize(s.trace, settleBreathValid) : null;
  const baselineGood = !c.baselineForced && total(settleClear) >= 0.6 * len(c.settle) && total(settleClear) >= 15e6;

  // Watching.
  const blinkPerMin = blinkRate(blinks, s.blink, clear);
  const threshold = noBlinkThreshold(baselineGood ? baseBlink : null);
  const hasBlinkData = s.blink.some((d) => d.t >= c.watch.start && d.t < c.watch.end);
  const stares = hasBlinkData ? noBlinkStretches(blinks, clear, threshold) : [];
  // Breathing is only read when the camera could see the chest for most of the session. Otherwise breathing pauses
  // are left out entirely (not reported as zero): a laptop camera that sees only the face gives a wave that is
  // mostly head movement, and calling that a pause would be a guess.
  // The settling margin applies to gaps in the camera's view only: not to pauses in playback, and not around
  // talking (the SDK's talking flag fired a dozen times in a real session with nobody speaking).
  const breathValid = intersect(subtract(erode(view.breath, BREATH_SETTLE_US), talk), active);
  const reference = (baselineGood ? baseSize : null) ?? breathSize(s.trace, breathValid);
  const breathReadable = reference !== null && total(breathValid) >= Math.max(20e6, 0.5 * activeUs);
  const holds = breathReadable ? breathHolds(s.trace, breathValid, reference, s.apnea) : [];
  const holdCount = breathReadable ? holds.length : null;
  const expr = expressionEvents(s.expressions, clear);
  const awayEvents = away.filter((i) => len(i) >= 1.5e6);
  const pulse = steadyPulse(s.pulse, active);
  const changes = c.diffs ? screenChanges(c.diffs, active) : null;

  const contentAt = (t: number) => (c.timemap ? c.timemap.at(t) : null);
  const ev: TimedEvent[] = [];
  const push = (kind: ReportEvent['kind'], i: Interval, peak: number | null) =>
    ev.push({ id: `${kind}-${ev.length + 1}`, kind, t: i.start, atMs: msOf(elapsedWithin(active, c.watch.start, i.start)), contentMs: c.timemap ? (contentAt(i.start) === null ? null : Math.round(contentAt(i.start)!)) : null, durMs: msOf(len(i)), peak: peak === null ? null : Math.round(peak), thumb: null });
  holds.forEach((h) => push('hold', h, null));
  stares.forEach((h) => push('noblink', h, null));
  expr.events.forEach((e) => push(e.kind, { start: e.start, end: Math.max(e.end, e.start + 500_000) }, e.peak));
  awayEvents.forEach((a) => push('away', a, null));
  ev.sort((a, b) => a.t - b.t);
  const events = ev.slice(0, 400);

  // Attention curve.
  const axis: Report['curveAxis'] = c.timemap && c.content.durationMs ? 'content' : 'watch';
  const span = axis === 'content' ? c.content.durationMs! : msOf(activeUs);
  const binMs = Math.max(2000, Math.min(30_000, Math.round(span / 60 / 1000) * 1000 || 2000));
  const nBins = Math.max(1, Math.ceil(span / binMs));
  const acc = Array.from({ length: nBins }, () => ({ total: 0, away: 0, clear: 0, blinks: 0, hold: 0, expr: 0 }));
  const step = 250_000;
  const isIn = (list: Interval[], t: number) => overlap(list, t, t + 1) > 0;
  for (const seg of active) {
    for (let t = seg.start; t < seg.end; t += step) {
      const x = axis === 'content' ? contentAt(t) : elapsedWithin(active, c.watch.start, t) / 1000;
      if (x === null || x < 0) continue;
      const b = acc[Math.min(nBins - 1, Math.floor(x / binMs))]!;
      b.total += step;
      if (isIn(away, t)) b.away += step;
      if (isIn(clear, t)) {
        b.clear += step;
        b.blinks += blinks.filter((bt) => bt >= t && bt < t + step).length;
      }
      if (isIn(holds, t)) b.hold += step;
      if (expr.events.some((e) => t >= e.start && t <= e.end + 1e6)) b.expr += step;
    }
  }
  const base = baselineGood ? baseBlink : null;
  const curve = acc.map((b) => {
    if (b.total < 1e6 || (b.clear + b.away) / b.total < 0.4) return null;
    const facing = 1 - b.away / b.total;
    const rate = b.clear > 0 ? b.blinks / (b.clear / 60e6) : null;
    const suppress = base && rate !== null ? Math.min(1, Math.max(0, 1 - rate / base)) : 0.5;
    const v = breathReadable
      ? facing * (0.6 * suppress + 0.25 * (b.hold > 0 ? 1 : 0) + 0.15 * (b.expr > 0 ? 1 : 0))
      : facing * (0.8 * suppress + 0.2 * (b.expr > 0 ? 1 : 0));
    return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  });

  // Score.
  const longestStare = stares.length ? Math.max(...stares.map(len)) : hasBlinkData && total(clear) > 0 ? 0 : null;
  const facingShare = activeUs > 0 && total(clear) + total(away) > 0.3 * activeUs ? 1 - total(away) / activeUs : null;
  const watchMs = msOf(activeUs);
  const parts = scoreParts({ mode: c.mode, baselineGood, baseBlinkPerMin: baseBlink, blinkPerMin, holds: holdCount, activeMin, longestNoBlinkUs: longestStare, facingShare, watchMs, guessMs: c.guessMs });
  const sc = activeUs >= 20e6 ? score(parts) : null;

  // Words.
  const facts = [...parts]
    .filter((p) => p.value >= 0.25)
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .map((p) => factOf(p.key, { baseBlink, blinkPerMin, holds: holdCount ?? 0, longestStare, facingShare }))
    .filter((x): x is string => !!x);
  const awayAxis = events.filter((e) => e.kind === 'away').map((e) => (axis === 'content' && e.contentMs !== null ? e.contentMs : e.atMs));
  const peaks = heldMoments(curve, binMs, 1);
  const suggestion = suggest({
    mode: c.mode,
    holds: holds.length,
    activeMin,
    blinkDrop: baselineGood && baseBlink && blinkPerMin !== null && baseBlink >= 4 ? (baseBlink - blinkPerMin) / baseBlink : null,
    watchMs,
    guessMs: c.guessMs,
    feltBefore: c.felt.before,
    feltAfter: c.felt.after,
    awayCount: awayAxis.length,
    awaySpan: awayAxis.length ? [Math.min(...awayAxis), Math.max(...awayAxis)] : null,
    opening: opening(curve, binMs),
    peakAt: peaks[0]?.atMs ?? null,
    score: sc,
  });

  const notes = [...c.notes];
  if (!breathReadable && activeUs >= 20e6) notes.push('Your breathing couldn’t be read: the camera needs to see your upper chest. Breathing pauses are left out of this report.');
  if (!baselineGood) notes.push('Your normal couldn’t be measured clearly at the start, so comparisons with it are left out.');
  if (activeUs > 0 && total(clear) / activeUs < 0.5) notes.push('The camera had a clear view of your face for under half the time, so some moments may be missing.');
  const hooks = c.mode === 'hooks';
  if (activeUs < 20e6 && !hooks) notes.push('This session was too short to score.');

  // Focus session: eyes on the work, breaks and stretches, and which app was in front. Its own score and words.
  let focus: Report['focus'];
  let focusText: ReturnType<typeof focusWords> | null = null;
  let focusPull: Report['pull'] | null = null;
  let focusCurveBins: (number | null)[] | null = null;
  if (c.mode === 'focus') {
    const spans = focusSpans(active, view, merge([...codeIntervals(c.quality, c.watch, (code) => code === V.noFace), ...view.gone]));
    const usage = c.focus?.apps ? appUsage(c.focus.apps, active, spans.focused) : null;
    const focusedUs = total(spans.focused);
    const measuredUs = focusedUs + total(spans.breaks);
    const longestUs = spans.stretches.length ? Math.max(...spans.stretches.map(len)) : 0;
    const left = spans.breaks.filter((b) => b.left);
    const measures = {
      activeUs,
      measuredUs,
      focusedUs,
      longestUs,
      breaks: spans.breaks.length,
      leftCount: left.length,
      switches: usage ? usage.switches : null,
      appUs: usage?.knownUs ?? 0,
      baselineGood,
      baseBlinkPerMin: baseBlink,
      blinkPerMin,
    };
    const parts = focusParts(measures);
    const fs = activeUs >= 20e6 ? focusScore(parts) : null;
    focusPull = { score: fs, parts };
    focusText = focusWords({ ...measures, score: fs, holds: holdCount, felt: c.felt.after });
    focusCurveBins = focusCurve(active, spans, binMs * 1000);
    const at = (t: number) => msOf(elapsedWithin(active, c.watch.start, t));
    focus = {
      plannedMs: c.focus?.plannedMs ?? null,
      measuredMs: msOf(measuredUs),
      focusedMs: msOf(focusedUs),
      longestMs: msOf(longestUs),
      breaks: spans.breaks.length,
      leftCount: left.length,
      leftMs: msOf(total(left)),
      stretches: spans.stretches.slice(0, 400).map((i) => ({ startMs: at(i.start), endMs: at(i.end) })),
      breakSpans: spans.breaks.slice(0, 400).map((i) => ({ startMs: at(i.start), endMs: at(i.end), left: i.left })),
      apps: usage ? usage.apps.map((a) => ({ name: a.name.slice(0, 80), ms: msOf(a.us), focusedMs: msOf(a.focusedUs) })) : null,
      appSpans: usage ? usage.spans.slice(0, 2000).map((s) => [at(s.start), at(s.end), s.app] as [number, number, number]) : null,
      switches: usage ? usage.switches : null,
      dnd: c.focus?.dnd ?? 'off',
    };
    if (c.focus?.apps && !usage && activeUs >= 20e6) notes.push('Which app was in front couldn’t be read, so the per-app view is left out.');
    if (c.focus?.dnd === 'failed') notes.push('Do Not Disturb didn’t turn on: the “Counterfeed Focus On” shortcut didn’t run.');
  }

  // Hook test: each clip on its own, ranked. The headline, suggestion and score come from the clips.
  const stills = new Map<number, number>();
  let clips: Report['clips'];
  let hookText: ReturnType<typeof hookWords> | null = null;
  if (hooks && c.clips) {
    const analysed = analyzeClips(c.clips.info, c.clips.runs, {
      clear,
      away,
      blinks,
      hasBlinkData,
      baseBlinkPerMin: baselineGood ? baseBlink : null,
      expressions: expr.events,
    });
    clips = analysed.map((a) => a.result);
    analysed.forEach((a) => a.stillT !== null && stills.set(a.result.index, a.stillT));
    hookText = hookWords(clips, c.picked ?? null);
    for (const x of clips)
      if (x.rank !== null && !x.parts.some((p) => p.key === 'eyes'))
        notes.push(`${clipName(x.name)} was scored mostly on whether you stayed: the camera had little clear view of your face during it.`);
  }
  const winner = clips?.find((x) => x.rank === 1) ?? null;
  const ranked = clips?.filter((x) => x.rank !== null).length ?? 0;

  const report: Report = {
    id,
    version: 1,
    mode: c.mode,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    signal: c.signal,
    content: { ...c.content, name: c.content.name.slice(0, 160), app: c.content.app?.slice(0, 80) ?? null },
    title: c.title?.slice(0, 120) || null,
    partial: c.partial,
    notes: notes.slice(0, 8),
    baseline: { durationMs: msOf(len(c.settle)), quality: baselineGood ? 'good' : 'weak', blinkPerMin: r1(baseBlink), breathPerMin: r1(baseBreath), pulse: r1(basePulse) },
    watchMs,
    metrics: {
      blinkPerMin: r1(blinkPerMin),
      longestNoBlinkMs: longestStare === null ? null : msOf(longestStare),
      holds: holdCount,
      longestHoldMs: holds.length ? msOf(Math.max(...holds.map(len))) : null,
      breathPerMin: breathReadable ? r1(steadyBreathRate(s.rate, breathValid)) : null,
      pulse: r1(pulse),
      pulseDelta: baselineGood && pulse !== null && basePulse !== null ? r1(pulse - basePulse) : null,
      hrvMs: r1(lastHrv(s.hrv, active)),
      smileMs: msOf(expr.smileUs),
      awayCount: awayEvents.length,
      awayMs: msOf(total(away)),
      coverage: activeUs > 0 ? Math.round((total(clear) / activeUs) * 100) / 100 : 0,
      screenChanges: changes ? changes.length : null,
    },
    pull: hooks ? { score: ranked >= 2 ? (winner?.score ?? null) : null, parts: [] } : (focusPull ?? { score: sc, parts }),
    events: events.map(({ t: _t, ...e }) => e),
    curve: focusCurveBins ?? curve,
    curveBinMs: binMs,
    curveAxis: axis,
    felt: c.felt,
    guessMs: c.guessMs,
    ratings: c.ratings,
    reviewNote: c.reviewNote,
    summary: hookText ? hookText.summary : focusText ? focusText.summary : summarize({ mode: c.mode, score: sc, band: band(sc), facts, tooShort: activeUs < 20e6 }),
    suggestion: hookText ? hookText.suggestion : focusText ? focusText.suggestion : suggestion,
    ...(hooks ? { clips: clips ?? [], picked: c.picked ?? null } : {}),
    ...(focus ? { focus } : {}),
  };
  return { report, events, stills };
}

function factOf(key: string, m: { baseBlink: number | null; blinkPerMin: number | null; holds: number; longestStare: number | null; facingShare: number | null }): string | null {
  switch (key) {
    case 'blinking':
      return m.baseBlink && m.blinkPerMin !== null ? `you blinked ${Math.round(((m.baseBlink - m.blinkPerMin) / m.baseBlink) * 100)}% less than your normal` : null;
    case 'pauses':
      return m.holds ? `you paused your breathing ${m.holds} ${m.holds === 1 ? 'time' : 'times'}` : null;
    case 'stare':
      return m.longestStare ? `you went ${Math.round(m.longestStare / 1e6)} s without blinking` : null;
    case 'eyes':
      return m.facingShare !== null ? `your face stayed toward the screen ${Math.round(m.facingShare * 100)}% of the time` : null;
    case 'time':
      return 'it felt shorter than it was';
    default:
      return null;
  }
}

/**
 * Attach pictures: for each event, the frame nearest the middle of its first 3 s (within 3 s). At most `max`,
 * chosen by kind priority (breathing pauses, then stares, expressions, looking away), then by length.
 */
export function pickThumbs(events: TimedEvent[], frames: { t: number; key: string }[], max = 16): Map<string, string> {
  const prio: Record<ReportEvent['kind'], number> = { hold: 0, noblink: 1, smile: 2, surprise: 2, frown: 2, away: 3 };
  const order = [...events].sort((a, b) => prio[a.kind] - prio[b.kind] || b.durMs - a.durMs).slice(0, max);
  const out = new Map<string, string>();
  for (const e of order) {
    const target = e.t + Math.min(e.durMs * 500, 1.5e6);
    let best: { t: number; key: string } | null = null;
    for (const f of frames) if (!best || Math.abs(f.t - target) < Math.abs(best.t - target)) best = f;
    if (best && Math.abs(best.t - target) <= 3e6) out.set(e.id, best.key);
  }
  return out;
}
