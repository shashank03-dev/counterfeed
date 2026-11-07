import type { Mode, Report, Thumbs } from '@counterfeed/shared';
import { useApp } from '../app/store';
import { BREATH_SETTLE_US, breathHolds, breathSize, blinkTimes, faceStateOf, noBlinkThreshold, blinkRate, subtract, talkingIntervals, total, viewIntervals } from '../analysis/detect';
import { contains } from '../analysis/intervals';
import { FOCUS, type AppSample } from '../analysis/focus';
import { clipName, type ClipRun } from '../analysis/hooks';
import { buildReport, pickThumbs, type Capture } from '../analysis/report';
import { playingIntervals, TimeMap } from '../analysis/timemap';
import { ContentCapture, type ContentTarget } from '../content/capture';
import { api } from '../lib/api';
import { nowUs } from '../lib/time';
import { CameraSource } from '../sensing/CameraSource';
import { emptyNormalized, type Normalized, type PoseSample, type TraceSample } from '../sensing/normalize';
import { V } from '../sensing/quality';
import { TestSource } from '../sensing/TestSource';
import type { SignalSource } from '../sensing/types';
import { toast } from '../ui/kit';
import { initialSession, useSession, type Plan, type Problem, type SessionState } from './store';

/*
 * One session, start to finish:
 *   setup -> (feed: how do you feel) -> settle (your normal, ~40 s) -> watch -> a few questions -> report
 * The camera (SmartSpectra) runs only during settle and watch. Screen sampling runs only during watch.
 * Any way it can end (stop, timer, video end, window closed, camera or key problem, quitting the app) ends here,
 * saving a report whenever there was enough to read.
 */

export const SETTLE_MS = 40_000;
export const MAX_SETTLE_WAIT_MS = 90_000;
export const MAX_WATCH_MS = 30 * 60_000;
/** A focus session can run longer than a feed check ("Until I stop" ends here). */
export const MAX_FOCUS_MS = 60 * 60_000;
export const MIN_REPORT_MS = 20_000;

const set = (p: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => useSession.setState(p);
const get = () => useSession.getState();
const scale = () => useApp.getState().config?.timeScale ?? 1;

function appendInto(acc: Normalized, n: Normalized) {
  for (const k of Object.keys(acc) as (keyof Normalized)[]) (acc[k] as unknown[]).push(...(n[k] as unknown[]));
}

/** Estimated SmartSpectra credits (1 credit = 30 s of measurement). */
export function creditEstimate(lengthMs: number | null): number {
  return Math.ceil((SETTLE_MS + (lengthMs ?? 10 * 60_000)) / 30_000);
}

/** "4:05" */
const mins = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Hook test: clip lengths accepted on the setup screen. */
export const CLIP_MIN_MS = 2000;
export const CLIP_MAX_MS = 3 * 60_000;

/** Fisher-Yates, so every order is equally likely (cancels out "the first one always wins"). */
export function shuffled<T>(list: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

class Session {
  private source: SignalSource | null = null;
  private capture: ContentCapture | null = null;
  private samples: Normalized = emptyNormalized();
  private quality: { t: number; code: number }[] = [];
  private live: TraceSample[] = [];
  private timers: number[] = [];
  private offs: (() => void)[] = [];
  private settleSpan = { start: 0, end: 0 };
  private watchSpan = { start: 0, end: 0 };
  private timemap: TimeMap | null = null;
  private notes: string[] = [];
  private forced = false;
  private refSize: number | null = null;
  private baseBlink: number | null = null;
  private video: HTMLVideoElement | null = null;
  /** Kept separately: the player unmounts when watching ends, before the report is built. */
  private videoDurationMs: number | null = null;
  private startedAt = 0;
  private finishing = false;
  private holdSince: number | null = null;
  /** Recent poses judged "facing the screen": the live normal for head pose (follows posture changes). */
  private poseFacing: PoseSample[] = [];
  private poseCheckedTo = 0;
  /** Hook test: every clip that has played (or failed), and the one playing now. */
  private runs: ClipRun[] = [];
  private run: ClipRun | null = null;
  /** Focus session: front-app readings, Do Not Disturb, and the live break tracking for the bar. */
  private apps: AppSample[] = [];
  private appPending = false;
  private dndActive = false;
  private dndResult: 'on' | 'off' | 'failed' = 'off';
  private awayStart: number | null = null;
  private lastBreakEnd = 0;
  /** Bumped on every reset, so a slow step from an old session can tell it no longer applies. */
  private gen = 0;

  constructor() {
    api.onCloseRequest(() => void this.onCloseRequest());
  }

  /** Read by the live wave canvas every frame (never through React). */
  liveTrace(): readonly TraceSample[] {
    return this.live;
  }

  begin(mode: Mode) {
    this.reset();
    const content =
      mode === 'hooks' ? { kind: 'video' as const, id: null, name: 'Hook test', app: null } : mode === 'focus' ? { kind: 'none' as const, id: null, name: 'Focus session', app: null } : { kind: 'none' as const, id: null, name: '', app: null };
    const lengthMs = mode === 'feed' ? 5 * 60_000 : mode === 'focus' ? 25 * 60_000 : null;
    set({ ...initialSession(), step: 'setup', plan: { mode, content, videoUrl: null, lengthMs, nudges: false, title: null, clips: [], shuffle: true, dnd: false, trackApps: true } });
  }

  updatePlan(p: Partial<Plan>) {
    set((s) => ({ plan: s.plan ? { ...s.plan, ...p } : s.plan }));
  }

  /** Setup confirmed (consent given). Feed asks how you feel first; review and hook tests go straight to settle. */
  confirm() {
    const plan = get().plan;
    if (!plan) return;
    if (plan.mode === 'hooks') {
      // Only clips that loaded and fit the length rules play, in a fresh random order unless shuffling is off.
      const ok = plan.clips.filter((c) => c.state === 'ok');
      if (ok.length < 2) return;
      this.updatePlan({ clips: plan.shuffle ? shuffled(ok) : ok });
      set({ clip: 0 });
    }
    if (plan.mode === 'feed') set({ step: 'before' });
    else void this.startSettle();
  }

  setFelt(when: 'before' | 'after', v: number | null) {
    set((s) => ({ felt: { ...s.felt, [when]: v } }));
  }

  async startSettle() {
    const cfg = useApp.getState().config;
    if (!cfg) return;
    if (!cfg.e2e) {
      if (!cfg.apiKey) return this.fail('no-key', 'No access key');
      let access = await api.mediaAccess('camera');
      if (access === 'not-determined') access = (await api.askCameraAccess()) ? 'granted' : 'denied';
      if (access === 'denied' || access === 'restricted') return this.fail('camera-denied', access);
    }
    void api.setBusy(true);
    this.startedAt = Date.now();
    this.samples = emptyNormalized();
    this.quality = [];
    this.live = [];
    set({ step: 'settle', settle: { progress: 0, waitedMs: 0, canForce: false }, quality: null, preview: null });

    // Focus session: Do Not Disturb goes on now (finding your normal is part of the quiet time), and is turned off
    // on every way out (see endFocus). If the session was left while the shortcut ran, turn it straight off again.
    const plan = get().plan;
    if (plan?.mode === 'focus' && plan.dnd) {
      const gen = this.gen;
      const ok = await api.setDnd(true).catch(() => false);
      if (gen !== this.gen || get().step !== 'settle') {
        if (ok) void api.setDnd(false);
        return;
      }
      this.dndActive = ok;
      this.dndResult = ok ? 'on' : 'failed';
      if (!ok) toast({ title: 'Do Not Disturb didn’t turn on', body: 'The “Counterfeed Focus On” shortcut didn’t run. The session goes on without it.', tone: 'warn' });
    }

    const src: SignalSource = cfg.e2e ? new TestSource(7, cfg.testScenario) : new CameraSource(cfg.apiKey!, cfg.recordRaw);
    this.source = src;
    this.offs.push(
      src.on('metrics', (n) => {
        appendInto(this.samples, n);
        if (n.trace.length) {
          this.live.push(...n.trace);
          const cut = nowUs() - 25e6;
          while (this.live.length && this.live[0]!.t < cut) this.live.shift();
        }
      }),
      src.on('quality', (q, t) => {
        this.quality.push({ t, code: q.code });
        set({ quality: q });
      }),
      src.on('stream', (s) => set({ preview: s })),
      src.on('problem', (p, detail) => {
        if (p === 'low-frame-rate') return; // shown by the checklist; not fatal
        void this.onProblem(p, detail);
      }),
    );
    this.settleSpan = { start: nowUs(), end: 0 };
    await src.start();
    if (get().step !== 'settle') return;
    let last = performance.now();
    let okMs = 0;
    let waited = 0;
    this.timers.push(
      window.setInterval(() => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        waited += dt;
        const q = get().quality;
        // Your normal needs a clear view of the face. The chest is optional: a laptop camera usually can't see
        // it, and that only means breathing pauses are left out (see buildReport).
        if (q && faceStateOf(q.code) === 'ok' && src.status === 'running') okMs += dt;
        const need = SETTLE_MS * scale();
        const progress = Math.min(1, okMs / need);
        set({ settle: { progress, waitedMs: waited, canForce: waited >= MAX_SETTLE_WAIT_MS * scale() } });
        if (progress >= 1) this.startWatch();
      }, 200),
    );
  }

  /** "Continue anyway": your normal stays unmeasured, and the report leaves out comparisons with it. */
  forceContinue() {
    this.forced = true;
    this.startWatch();
  }

  /** The review player hands over its <video> so screen sampling and the time map follow playback. */
  attachVideo(el: HTMLVideoElement | null) {
    this.video = el;
  }

  /** Hook test: the player started clip `i` (called once per clip, when it begins playing). */
  clipStart(i: number) {
    if (get().step !== 'watch' || this.run?.clip === i || this.runs.some((r) => r.clip === i)) return;
    if (this.run) this.closeRun('skip');
    this.run = { clip: i, start: nowUs(), end: 0, endedBy: 'stop', marks: [] };
    set({ clip: i });
  }

  /** Hook test: the clip ended, or you swiped on. Moves to the next clip, or ends after the last. */
  clipEnd(reason: 'end' | 'skip') {
    if (get().step !== 'watch') return;
    if (!this.run) {
      // Swiped before the clip started playing: it counts, as a swipe at 0:00.
      const i = get().clip;
      if (reason !== 'skip' || this.runs.some((r) => r.clip === i)) return;
      const t = nowUs();
      this.runs.push({ clip: i, start: t, end: t, endedBy: 'skip', marks: [{ t, c: 0, playing: false }] });
      return this.nextClip(i);
    }
    const i = this.run.clip;
    this.closeRun(reason);
    this.nextClip(i);
  }

  /** Hook test: a clip couldn't play. It's left out (with a note) and the next one plays. */
  clipFailed(i: number) {
    const step = get().step;
    const plan = get().plan;
    if (!plan || (step !== 'settle' && step !== 'watch') || this.runs.some((r) => r.clip === i && r.endedBy === 'error')) return;
    if (this.run?.clip === i) {
      this.run.marks = [];
      this.closeRun('error');
    } else {
      const t = nowUs();
      this.runs.push({ clip: i, start: t, end: t, endedBy: 'error', marks: [] });
    }
    this.notes.push(`${clipName(plan.clips[i]?.name ?? '')} couldn’t be played, so it’s left out.`);
    if (this.runs.filter((r) => r.endedBy === 'error').length >= plan.clips.length) return this.fail('video-error', 'no clip could play');
    if (step === 'settle') set({ clip: i + 1 });
    else this.nextClip(i);
  }

  private nextClip(i: number) {
    const n = get().plan?.clips.length ?? 0;
    if (i + 1 >= n) void this.stopWatch('ended');
    else set({ clip: i + 1 });
  }

  private closeRun(endedBy: ClipRun['endedBy']) {
    const r = this.run;
    if (!r) return;
    const t = nowUs();
    const last = r.marks[r.marks.length - 1];
    const pos = this.video && Number.isFinite(this.video.currentTime) ? this.video.currentTime * 1000 : (last?.c ?? 0);
    if (endedBy !== 'error' && (!last || t >= last.t)) r.marks.push({ t, c: Math.max(pos, last?.c ?? 0), playing: false });
    r.end = t;
    r.endedBy = endedBy;
    this.runs.push(r);
    this.run = null;
  }

  /** Hook test: for each clip, whether it was shown, and a still of it as it played (for "which one would you post?"). */
  clipStills(): { shown: boolean; still: string | null }[] {
    const frames = this.capture?.frames ?? [];
    return (get().plan?.clips ?? []).map((_, i) => {
      const r = this.runs.find((x) => x.clip === i && x.endedBy !== 'error');
      if (!r) return { shown: false, still: null };
      const target = r.start + Math.min(1.5e6, (r.end - r.start) / 2);
      let best: { t: number; url: string } | null = null;
      for (const f of frames) if (f.t >= r.start && f.t <= r.end && (!best || Math.abs(f.t - target) < Math.abs(best.t - target))) best = f;
      return { shown: true, still: best?.url ?? null };
    });
  }

  /** The picked video couldn't be decoded. */
  videoFailed() {
    if (get().step === 'settle' || get().step === 'watch') this.fail('video-error', 'media error');
  }

  /** Player marks (play, pause, seek, and 4x a second while playing). */
  mark(playing: boolean, positionMs: number) {
    if (get().plan?.mode === 'hooks') {
      const r = this.run;
      const t = nowUs();
      const last = r?.marks[r.marks.length - 1];
      if (r && Number.isFinite(positionMs) && (!last || t >= last.t)) r.marks.push({ t, c: Math.max(0, positionMs), playing });
      return;
    }
    const d = this.video?.duration;
    if (d && Number.isFinite(d)) this.videoDurationMs = Math.round(d * 1000);
    this.timemap?.add({ t: nowUs(), c: positionMs, playing });
  }

  private startWatch() {
    if (get().step !== 'settle') return;
    this.clearTimers();
    this.settleSpan.end = nowUs();
    const plan = get().plan!;

    // Your normal, for the live cues (the report recomputes everything from scratch).
    const view = viewIntervals(this.quality, this.settleSpan, this.samples.pose, [], this.samples.pose.length ? this.samples.blink.map((b) => b.t) : undefined);
    const blinks = blinkTimes(this.samples.blink);
    this.baseBlink = this.forced ? null : blinkRate(blinks, this.samples.blink, view.ok);
    const breathValid = subtract(view.breath, talkingIntervals(this.samples.talking));
    this.refSize = total(breathValid) >= 15e6 ? breathSize(this.samples.trace, breathValid) : null;
    this.poseFacing = this.samples.pose.filter((p) => p.t >= this.settleSpan.end - 30e6 && contains(view.ok, p.t));
    this.poseCheckedTo = this.settleSpan.end;

    this.watchSpan = { start: nowUs(), end: 0 };
    this.lastBreakEnd = this.watchSpan.start;
    this.awayStart = null;
    this.timemap = plan.content.kind === 'video' && plan.mode !== 'hooks' ? new TimeMap() : null;
    this.runs = this.runs.filter((r) => r.endedBy === 'error'); // clips that failed while preloading stay failed
    this.run = null;
    set((s) => ({ step: 'watch', watch: { ...s.watch, elapsedMs: 0, startedAt: Date.now(), cue: { kind: 'measuring', text: 'Measuring' } } }));

    let target: ContentTarget = { kind: 'none' };
    if (plan.content.kind === 'video') target = { kind: 'video', el: this.video ?? document.createElement('video') };
    else if ((plan.content.kind === 'window' || plan.content.kind === 'screen') && plan.content.id) target = { kind: plan.content.kind, id: plan.content.id };
    else if (plan.content.kind === 'test') target = { kind: 'test' };
    if (plan.content.kind !== 'video') void api.setCompact(true);

    const cap = new ContentCapture(target);
    this.capture = cap;
    void cap.start().then((ok) => {
      set((s) => ({ watch: { ...s.watch, captureLive: ok } }));
      if (!ok && target.kind !== 'none') this.notes.push('Pictures of the screen weren’t available, so moments are shown without them.');
    });
    cap.on('ended', () => {
      const at = Math.round(get().watch.elapsedMs / 1000);
      this.notes.push(`The window closed at ${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}, so pictures stop there.`);
      set((s) => ({ watch: { ...s.watch, captureLive: false } }));
      toast({ title: 'The window closed', body: 'Measuring continues. Pictures stop here.', tone: 'warn' });
    });

    const maxMs = plan.mode === 'focus' ? MAX_FOCUS_MS : MAX_WATCH_MS;
    const limit = Math.min(maxMs, plan.lengthMs ?? maxMs) * (plan.lengthMs ? scale() : 1);
    if (plan.mode === 'focus' && plan.trackApps) {
      this.apps = [];
      void this.pollApp();
      this.timers.push(window.setInterval(() => void this.pollApp(), 1000));
    }
    this.timers.push(
      window.setInterval(() => {
        const elapsed = this.activeMs();
        set((s) => ({ watch: { ...s.watch, elapsedMs: elapsed, ...this.cue() } }));
        if (plan.content.kind !== 'video' && elapsed >= limit) void this.stopWatch('timer');
        if (plan.content.kind === 'video' && elapsed >= MAX_WATCH_MS) void this.stopWatch('timer');
      }, 250),
    );
  }

  /** Focus session: which app is in front (Counterfeed's own bar counts as none). Skipped while one is pending. */
  private async pollApp() {
    if (this.appPending) return;
    this.appPending = true;
    const gen = this.gen;
    try {
      const a = await api.frontApp();
      if (gen === this.gen && get().step === 'watch') this.apps.push({ t: nowUs(), name: a && !a.self ? a.name : null });
    } catch {
      // A failed reading is a gap in the app lane, nothing more.
    } finally {
      this.appPending = false;
    }
  }

  /** Focus session: Do Not Disturb off (if Counterfeed turned it on). Safe to call more than once. */
  private endFocus() {
    if (!this.dndActive) return;
    this.dndActive = false;
    void api.setDnd(false);
  }

  private activeIntervals(end = nowUs()) {
    if (get().plan?.mode === 'hooks') {
      const all = [...this.runs, ...(this.run ? [this.run] : [])].filter((r) => r.endedBy !== 'error');
      return all
        .flatMap((r) => playingIntervals(r.marks, r.end || end).map((i) => ({ start: Math.max(i.start, r.start), end: Math.min(i.end, r.end || end) })))
        .filter((i) => i.end > i.start)
        .sort((a, b) => a.start - b.start);
    }
    if (this.timemap) return playingIntervals(this.timemap.all, end).map((i) => ({ start: Math.max(i.start, this.watchSpan.start), end: Math.min(i.end, end) })).filter((i) => i.end > i.start);
    return [{ start: this.watchSpan.start, end }];
  }

  private activeMs() {
    return this.activeIntervals().reduce((s, i) => s + (i.end - i.start), 0) / 1000;
  }

  /** The real-time response on the bar: what your body is doing right now, in a few words. */
  private cue(): { cue: SessionState['watch']['cue']; nudge: boolean } {
    const now = nowUs();
    const q = get().quality;
    const plan = get().plan;
    if (plan?.mode === 'focus') return this.focusCue(now);
    if (q && q.code !== 0) {
      const state = faceStateOf(q.code);
      // Chest-only codes ("place more of the chest in view") fall through: the face measures still work.
      if (state !== 'ok') return { cue: { kind: 'face', text: state === 'away' ? 'Looking away' : q.hint || 'Adjusting' }, nudge: false };
    }
    const span = { start: now - 25e6, end: now };
    const pose = this.recentPose(span.start);
    const face = this.liveView(span, pose);
    this.learnPose(pose, face.away, now);
    const lastAway = face.away[face.away.length - 1];
    if (lastAway && now - lastAway.end < 700_000) return { cue: { kind: 'face', text: 'Looking away' }, nudge: false };
    const hold = this.holdNow(now, face, span);
    if (hold !== null) {
      const secs = Math.round((now - hold) / 1e6);
      return { cue: { kind: 'hold', text: `Breathing paused · ${secs} s` }, nudge: !!plan?.nudges && secs >= 8 };
    }
    const blinks = blinkTimes(this.samples.blink.filter((d) => d.t >= now - 40e6));
    const lastBlink = blinks.length ? blinks[blinks.length - 1]! : null;
    const okSince = face.ok.length ? face.ok[face.ok.length - 1]!.start : now;
    const since = now - Math.max(lastBlink ?? this.watchSpan.start, okSince, this.watchSpan.start);
    if (this.samples.blink.length && since >= noBlinkThreshold(this.baseBlink)) return { cue: { kind: 'noblink', text: `No blinks for ${Math.round(since / 1e6)} s` }, nudge: false };
    return { cue: { kind: 'measuring', text: 'Measuring' }, nudge: false };
  }

  /** A breathing pause going on right now: its start, or null. */
  private holdNow(now: number, face: ReturnType<typeof viewIntervals>, span: { start: number; end: number }): number | null {
    // Same settling margin as the report, but only after the view returns: the live edge must stay current.
    const settled = face.breath.map((i) => ({ start: i.start + BREATH_SETTLE_US, end: i.end })).filter((i) => i.end > i.start);
    const valid = subtract(settled, talkingIntervals(this.samples.talking.filter((d) => d.t > span.start - 2e6)));
    const recent = this.live.filter((s) => s.t >= span.start);
    const holds = breathHolds(recent, valid, this.refSize, this.samples.apnea.filter((d) => d.t >= span.start));
    const ongoing = holds.find((h) => now - h.end < 1.5e6);
    if (!ongoing) {
      this.holdSince = null;
      return null;
    }
    this.holdSince ??= ongoing.start;
    return ongoing.start;
  }

  /**
   * Focus session, on the bar: how long you've been focused since your last break, or how long you've been away.
   * Same rules as the report: away 10 s or more is a break and restarts the count; a shorter glance doesn't.
   */
  private focusCue(now: number): { cue: SessionState['watch']['cue']; nudge: boolean } {
    const q = get().quality;
    const plan = get().plan;
    const span = { start: now - 25e6, end: now };
    const pose = this.recentPose(span.start);
    const face = this.liveView(span, pose);
    this.learnPose(pose, face.away, now);
    const state = q && q.code !== 0 ? faceStateOf(q.code) : 'ok';
    const lastAway = face.away[face.away.length - 1];
    if (state === 'away' || (lastAway && now - lastAway.end < 700_000)) {
      this.awayStart ??= lastAway?.start ?? now;
      const awayUs = now - this.awayStart;
      const secs = Math.round(awayUs / 1e6);
      const gone = face.gone[face.gone.length - 1];
      const left = q?.code === V.noFace || (!!gone && now - gone.end < 700_000);
      return { cue: { kind: 'face', text: left ? `Away from the screen · ${secs} s` : `Looking away · ${secs} s` }, nudge: !!plan?.nudges && awayUs >= FOCUS.nudgeUs };
    }
    if (this.awayStart !== null) {
      if (now - this.awayStart >= FOCUS.breakUs) this.lastBreakEnd = now;
      this.awayStart = null;
    }
    if (state === 'unclear') return { cue: { kind: 'face', text: q?.hint || 'Adjusting' }, nudge: false };
    const hold = this.holdNow(now, face, span);
    if (hold !== null) return { cue: { kind: 'hold', text: `Breathing paused · ${Math.round((now - hold) / 1e6)} s` }, nudge: false };
    return { cue: { kind: 'focus', text: `Focused · ${mins((now - Math.max(this.lastBreakEnd, this.watchSpan.start)) / 1000)}` }, nudge: false };
  }

  /** Live view of the face, as the report will judge it. The live edge waits 0.5 s for the next packet. */
  private liveView(span: { start: number; end: number }, pose: PoseSample[]) {
    const b = this.samples.blink;
    let i = b.length;
    while (i > 0 && b[i - 1]!.t >= span.start) i--;
    const faceTimes = this.samples.pose.length ? b.slice(i).map((d) => d.t) : undefined;
    return viewIntervals(this.quality, span, pose, this.poseFacing, faceTimes, 500_000);
  }

  private recentPose(from: number): PoseSample[] {
    const p = this.samples.pose;
    let i = p.length;
    while (i > 0 && p[i - 1]!.t >= from) i--;
    return p.slice(i);
  }

  /** Keep the live head-pose normal current: poses older than 1 s that weren't "away" join it; 60 s are kept. */
  private learnPose(pose: PoseSample[], away: { start: number; end: number }[], now: number) {
    const upTo = now - 1e6;
    for (const p of pose) if (p.t > this.poseCheckedTo && p.t <= upTo && !contains(away, p.t)) this.poseFacing.push(p);
    this.poseCheckedTo = Math.max(this.poseCheckedTo, upTo);
    while (this.poseFacing.length && this.poseFacing[0]!.t < now - 60e6) this.poseFacing.shift();
  }

  /** Stop watching (button, timer, video end) and go to the questions. */
  async stopWatch(reason: 'user' | 'timer' | 'ended') {
    if (get().step !== 'watch') return;
    this.watchSpan.end = nowUs();
    if (reason === 'ended' && this.timemap) this.mark(false, (this.video?.currentTime ?? 0) * 1000);
    if (this.run) this.closeRun(reason === 'ended' ? 'end' : 'stop');
    this.clearTimers();
    this.endFocus();
    this.capture?.stop();
    await this.stopSource();
    void api.setCompact(false);
    set((s) => ({ step: 'after', watch: { ...s.watch, elapsedMs: this.activeMs() } }));
  }

  /** The questions are answered (or skipped): build, save and show the report. */
  async finish(answers: { guessMs: number | null; after: number | null; ratings: Report['ratings']; note: string | null; picked?: number | null }, endedBy: Problem | 'closed' | null = null) {
    if (this.finishing) return;
    this.finishing = true;
    set((s) => ({ step: 'analyzing', felt: { ...s.felt, after: answers.after } }));
    const plan = get().plan!;
    const cap: Capture = {
      mode: plan.mode,
      signal: this.source?.kind === 'test' || useApp.getState().config?.e2e ? 'test' : 'camera',
      startedAt: this.startedAt,
      endedAt: Date.now(),
      settle: this.settleSpan,
      watch: this.watchSpan,
      active: this.activeIntervals(this.watchSpan.end),
      samples: this.samples,
      quality: this.quality,
      timemap: this.timemap,
      diffs: this.capture && this.capture.diffs.length ? this.capture.diffs : null,
      content: { kind: plan.content.kind, name: plan.content.name || 'Untitled', app: plan.content.app, durationMs: this.videoDurationMs },
      title: plan.title,
      partial: endedBy !== null,
      notes: this.notes,
      baselineForced: this.forced,
      felt: { before: get().felt.before, after: answers.after },
      guessMs: answers.guessMs,
      ratings: answers.ratings,
      reviewNote: answers.note,
      clips: plan.mode === 'hooks' ? { info: plan.clips.map((c) => ({ name: c.name, durationMs: c.durationMs })), runs: this.runs } : null,
      picked: plan.mode === 'hooks' ? (answers.picked ?? null) : null,
      focus: plan.mode === 'focus' ? { plannedMs: plan.lengthMs, apps: plan.trackApps ? this.apps : null, dnd: this.dndResult } : null,
    };
    // Let the "Reading your session" state paint before the analysis runs.
    await new Promise((r) => setTimeout(r, 60));
    let report: Report;
    let thumbs: Thumbs;
    try {
      const id = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const built = buildReport(cap, id);
      const frames = this.capture?.frames ?? [];
      const hooks = plan.mode === 'hooks';
      // A hook test keeps one still per clip (its strongest moment); other reports keep pictures of their moments.
      const picks = hooks ? new Map<string, string>() : pickThumbs(built.events, frames);
      const stills = new Map<number, string>();
      for (const [i, t] of built.stills) {
        let best: { t: number; key: string } | null = null;
        for (const f of frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
        if (best && Math.abs(best.t - t) <= 3e6) stills.set(i, best.key);
      }
      const byKey = new Map(frames.map((f) => [f.key, f.url]));
      report = {
        ...built.report,
        events: built.report.events.map((e) => ({ ...e, thumb: picks.get(e.id) ?? null })),
        ...(built.report.clips ? { clips: built.report.clips.map((c) => ({ ...c, thumb: stills.get(c.index) ?? null })) } : {}),
      };
      if (useApp.getState().config?.recordRaw) {
        // Developer runs only (never packaged): the raw session, for checking detectors against real data.
        (window as unknown as { __counterfeedLast?: unknown }).__counterfeedLast = { capture: { ...cap, timemap: null }, report };
      }
      thumbs = Object.fromEntries([...new Set([...picks.values(), ...stills.values()])].map((k) => [k, byKey.get(k)!]).filter(([, v]) => !!v && v.length <= 120 * 1024));
      // A still that was too large to keep must not be referenced.
      if (report.clips) report = { ...report, clips: report.clips.map((c) => (c.thumb && !thumbs[c.thumb] ? { ...c, thumb: null } : c)) };
    } catch (err) {
      console.error('[counterfeed] analysis failed', err);
      this.finishing = false;
      return this.fail('failed', String(err));
    }
    try {
      await api.saveReport(report, thumbs);
      void useApp.getState().refresh();
    } catch (err) {
      console.error('[counterfeed] save failed', err);
      toast({ title: 'Couldn’t save this report', body: 'It’s shown here, but won’t be in History.', tone: 'warn' });
    }
    void api.setBusy(false);
    this.finishing = false;
    set({ step: 'report', report, thumbs, endedBy });
  }

  private async onProblem(p: Problem, detail: string) {
    const step = get().step;
    if (step === 'watch' && this.activeMs() >= MIN_REPORT_MS) {
      // Enough was measured: keep it, with a note, instead of losing the session.
      this.watchSpan.end = nowUs();
      if (this.run) this.closeRun('stop');
      this.notes.push('Measurement stopped early, so this report covers only the part before that.');
      this.clearTimers();
      this.endFocus();
      this.capture?.stop();
      await this.stopSource();
      void api.setCompact(false);
      return this.finish({ guessMs: null, after: null, ratings: null, note: null }, p);
    }
    this.fail(p, detail);
  }

  private async onCloseRequest() {
    const step = get().step;
    if (step === 'watch' && this.activeMs() >= MIN_REPORT_MS) {
      this.watchSpan.end = nowUs();
      if (this.run) this.closeRun('stop');
      this.notes.push('Counterfeed was closed during the session.');
      this.clearTimers();
      this.endFocus();
      this.capture?.stop();
      await this.stopSource();
      await this.finish({ guessMs: null, after: null, ratings: null, note: null }, 'closed');
    }
    this.endFocus();
    await this.stopSource();
    void api.quit();
  }

  private fail(kind: Problem, detail: string) {
    this.clearTimers();
    this.endFocus();
    this.capture?.stop();
    void this.stopSource();
    void api.setCompact(false);
    void api.setBusy(false);
    set({ step: 'problem', problem: { kind, detail } });
  }

  /** Leave the session (setup, problem, or after the report). Nothing half-measured is saved. */
  cancel() {
    this.reset();
    set(initialSession());
  }

  private async stopSource() {
    const src = this.source;
    this.offs.forEach((o) => o());
    this.offs = [];
    this.source = null;
    if (src) {
      await src.stop().catch(() => {});
      src.destroy();
    }
    set({ preview: null });
  }

  private clearTimers() {
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
  }

  private reset() {
    this.gen++;
    this.clearTimers();
    this.endFocus();
    this.capture?.stop();
    this.capture = null;
    void this.stopSource();
    void api.setCompact(false);
    void api.setBusy(false);
    this.samples = emptyNormalized();
    this.quality = [];
    this.live = [];
    this.notes = [];
    this.poseFacing = [];
    this.poseCheckedTo = 0;
    this.runs = [];
    this.run = null;
    this.forced = false;
    this.timemap = null;
    this.refSize = null;
    this.baseBlink = null;
    this.videoDurationMs = null;
    this.finishing = false;
    this.holdSince = null;
    this.apps = [];
    this.appPending = false;
    this.dndResult = 'off';
    this.awayStart = null;
    this.lastBreakEnd = 0;
  }
}

export const session = new Session();
