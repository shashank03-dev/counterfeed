import { create } from 'zustand';
import type { SignalFrame } from '@together/shared';
import { api } from '../lib/api';
import { useApp } from '../app/store';
import type { AppConfig } from '../../../shared/ipc';
import { median } from '../lib/stats';
import { nowUs } from '../lib/time';
import { Buffers } from '../session/controller';
import { CameraSource } from '../sensing/CameraSource';
import { detectRise, type LagSample } from '../sensing/lag';
import type { Quality, SensingProblem, SignalSource, SourceStatus } from '../sensing/types';
import { TestSource } from '../sensing/TestSource';

export interface ProbeState {
  running: boolean;
  status: SourceStatus;
  problem: { kind: SensingProblem; detail: string } | null;
  quality: Quality | null;
  raw: {
    trace: number | null;
    traceStable: boolean;
    rate: number | null;
    rateConf: number;
    rateStable: boolean;
    pulse: number | null;
    pulseConf: number;
    pulseStable: boolean;
    talking: boolean | null;
    talkingStable: boolean;
    happy: number | null;
    surprise: number | null;
    /** Arrival time minus sample timestamp, median over the last 2 s (ms). */
    pipelineMs: number | null;
  };
  stats: { metricsPerSec: number; tracePerSec: number; processing: string; lastMetricAgeMs: number | null } | null;
  lag: { phase: 'idle' | 'hold' | 'beep' | 'rest' | 'done'; trial: number; results: (number | null)[]; median: number | null };
  stream: MediaStream | null;
  /** Span of breathing trace measured so far (ms), for "save as practice partner". */
  recordedMs: number;
  save: 'idle' | 'saving' | 'saved' | 'failed';
  /** Measured breathing needed before the check can be kept (60 s; shortened only in automated runs). */
  practiceMinMs: number;
}

/** Minimum measured breathing before a check can be kept as a practice partner. */
export const PRACTICE_MIN_MS = 60_000;
const KEEP_MAX_MS = 10 * 60_000;

const blank = (): ProbeState => ({
  running: false,
  status: 'off',
  problem: null,
  quality: null,
  raw: { trace: null, traceStable: false, rate: null, rateConf: 0, rateStable: false, pulse: null, pulseConf: 0, pulseStable: false, talking: null, talkingStable: false, happy: null, surprise: null, pipelineMs: null },
  stats: null,
  lag: { phase: 'idle', trial: 0, results: [], median: null },
  stream: null,
  recordedMs: 0,
  save: 'idle',
  practiceMinMs: PRACTICE_MIN_MS,
});

export const useProbe = create<ProbeState>(() => blank());

/**
 * Camera check outside a session (the Diagnostics page): raw SDK values, rates, confidence, and a lag test.
 * Runs the same CameraSource a session uses; nothing is sent anywhere.
 */
export class Probe {
  static current: Probe | null = null;
  readonly you = new Buffers();
  readonly partner = null;
  private source: SignalSource | null = null;
  private lagSamples: LagSample[] = [];
  private lagDelays: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubs: (() => void)[] = [];
  private cancelled = false;
  private kept: SignalFrame[] = [];

  window() {
    return { now: nowUs(), offsetUs: 0 };
  }

  static async start(config: AppConfig) {
    Probe.current?.stop();
    const p = new Probe();
    Probe.current = p;
    useProbe.setState({ ...blank(), running: true, practiceMinMs: config.e2e ? Math.round(PRACTICE_MIN_MS * config.phaseScale) : PRACTICE_MIN_MS });
    await p.run(config);
    return p;
  }

  private set(p: Partial<ProbeState>) {
    if (Probe.current === this) useProbe.setState(p);
  }
  private raw(p: Partial<ProbeState['raw']>) {
    this.set({ raw: { ...useProbe.getState().raw, ...p } });
  }

  private async run(config: AppConfig) {
    const src: SignalSource = config.e2e ? new TestSource(9, true) : new CameraSource(config.apiKey ?? '');
    this.source = src;
    this.unsubs.push(
      src.on('frames', (frames) => {
        const arrived = nowUs();
        this.you.add(frames);
        for (const f of frames) this.kept.push(f);
        if (this.kept.length && this.kept[this.kept.length - 1]!.t - this.kept[0]!.t > KEEP_MAX_MS * 1000) this.kept.splice(0, Math.ceil(this.kept.length / 10));
        let last: (typeof frames)[number] | undefined;
        for (const f of frames) {
          if (f.trace === undefined) continue;
          last = f;
          this.lagSamples.push({ at: arrived, v: f.trace });
          this.lagDelays.push((arrived - f.t) / 1000);
        }
        if (this.lagSamples.length > 3000) this.lagSamples.splice(0, 1000);
        if (this.lagDelays.length > 60) this.lagDelays.splice(0, this.lagDelays.length - 60);
        if (last) this.raw({ trace: last.trace!, traceStable: !!last.traceStable, pipelineMs: Math.round(median(this.lagDelays)) });
      }),
      src.on('rate', (r) => this.raw({ rate: r.value, rateConf: r.confidence, rateStable: r.stable })),
      src.on('pulse', (p) => this.raw({ pulse: p.value, pulseConf: p.confidence, pulseStable: p.stable })),
      src.on('talking', (t) => this.raw({ talking: t.detected, talkingStable: t.stable })),
      src.on('expressions', (e) => {
        const l = e[e.length - 1];
        if (l) this.raw({ happy: l.happy, surprise: l.surprise });
      }),
      src.on('quality', (q) => this.set({ quality: q })),
      src.on('status', (s) => this.set({ status: s })),
      src.on('stream', (s) => this.set({ stream: s })),
      src.on('problem', (kind, detail) => this.set({ problem: { kind, detail } })),
    );
    this.timer = setInterval(() => this.set({ stats: src.stats(), recordedMs: this.traceSpanMs() }), 500);
    await src.start();
  }

  private traceSpanMs() {
    let first = -1;
    let last = -1;
    for (const f of this.kept) {
      if (f.trace === undefined) continue;
      if (first < 0) first = f.t;
      last = f.t;
    }
    return first < 0 ? 0 : Math.round((last - first) / 1000);
  }

  /**
   * Keep this check as a practice partner: the measured signal frames (never video) go into a recording,
   * the same format a session writes, and Home offers it under Practice, always labelled as a replay.
   */
  async saveAsPractice() {
    const st = useProbe.getState();
    if (this.traceSpanMs() < st.practiceMinMs || st.save === 'saving') return;
    this.set({ save: 'saving' });
    const frames = this.kept.slice();
    try {
      const id = await api.recordingStart();
      const lines: string[] = [];
      for (let i = 0; i < frames.length; i += 120) lines.push(JSON.stringify({ k: 'sig', frames: frames.slice(i, i + 120) }));
      for (let i = 0; i < lines.length; i += 200) await api.recordingAppend(id, lines.slice(i, i + 200));
      const info = await api.recordingFinish(id);
      if (!info) throw new Error('recording rejected');
      this.set({ save: 'saved' });
      void useApp.getState().refresh();
    } catch {
      this.set({ save: 'failed' });
    }
  }

  /** Five trials: hold after breathing out, tone, breathe in. Reports the median delay until the wave moves. */
  async lagTest() {
    this.cancelled = false;
    const results: (number | null)[] = [];
    const ctx = new AudioContext();
    try {
      for (let trial = 1; trial <= 5 && !this.cancelled; trial++) {
        this.set({ lag: { phase: 'hold', trial, results: [...results], median: null } });
        await sleep(3000 + Math.random() * 1500); // unpredictable, so people react instead of anticipating
        if (this.cancelled) break;
        const beepAt = nowUs();
        beep(ctx);
        this.set({ lag: { phase: 'beep', trial, results: [...results], median: null } });
        await sleep(6000);
        results.push(detectRise(this.lagSamples, beepAt));
        this.set({ lag: { phase: 'rest', trial, results: [...results], median: null } });
        if (trial < 5) await sleep(4000);
      }
    } finally {
      void ctx.close();
    }
    const ok = results.filter((r): r is number => r !== null);
    this.set({ lag: { phase: 'done', trial: 5, results, median: ok.length ? Math.round(median(ok)) : null } });
  }

  cancelLag() {
    this.cancelled = true;
    this.set({ lag: { phase: 'idle', trial: 0, results: [], median: null } });
  }

  stop() {
    this.cancelled = true;
    if (this.timer) clearInterval(this.timer);
    for (const u of this.unsubs.splice(0)) u();
    void this.source?.stop().finally(() => this.source?.destroy());
    if (Probe.current === this) {
      Probe.current = null;
      useProbe.setState(blank());
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function beep(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}
