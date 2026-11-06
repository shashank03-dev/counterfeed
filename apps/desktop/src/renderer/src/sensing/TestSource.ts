import type { SignalFrame } from '@together/shared';
import { Emitter } from '../lib/emitter';
import { gaussian, mulberry32 } from '../lib/rng';
import { nowUs } from '../lib/time';
import type { SignalSource, SourceEvents, SourceStatus } from './types';

/**
 * AUTOMATED TESTS ONLY (TOGETHER_E2E=1, never in a packaged app). Emits a deterministic breathing-like
 * signal so the end-to-end suite can drive the whole flow on CI machines without a face in front of a camera.
 * The call video comes from Chromium's fake device; nothing here touches the SmartSpectra SDK, and the UI
 * shows a "Test signal" badge whenever this source is active.
 */
export class TestSource implements SignalSource {
  readonly kind = 'test';
  private ev = new Emitter<SourceEvents>();
  private _stream: MediaStream | null = null;
  private _status: SourceStatus = 'off';
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase = 0;
  private rate: number;
  private g: () => number;
  private t0 = 0;

  constructor(seed: number, private readonly withCamera: boolean) {
    const r = mulberry32(seed);
    this.g = gaussian(r);
    this.rate = 0.22 + r() * 0.06;
  }

  get stream() {
    return this._stream;
  }
  get status() {
    return this._status;
  }
  on<K extends keyof SourceEvents>(event: K, fn: (...args: SourceEvents[K]) => void) {
    return this.ev.on(event, fn);
  }

  async start() {
    this._status = 'running';
    this.ev.emit('status', 'running');
    if (this.withCamera) {
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
        this.ev.emit('stream', this._stream);
      } catch {
        /* no fake camera: the test just runs without video */
      }
    }
    this.ev.emit('quality', { code: 0, hint: '', light: 'ok', framing: 'ok', stillness: 'ok', settling: false });
    this.t0 = nowUs();
    let last = this.t0;
    this.timer = setInterval(() => {
      const now = nowUs();
      const frames: SignalFrame[] = [];
      for (let t = last + 33_333; t <= now; t += 33_333) {
        this.phase += 2 * Math.PI * this.rate * 0.033333;
        this.rate += 0.02 * (0.25 - this.rate) + 0.004 * this.g();
        frames.push({ t: Math.round(t), trace: Math.sin(this.phase) + 0.1 * this.g(), traceStable: t - this.t0 > 3e6 });
        last = t;
      }
      if (!frames.length) return;
      const lastF = frames[frames.length - 1]!;
      lastF.pulse = 68 + 4 * Math.sin(this.phase / 7);
      lastF.pulseConf = 70;
      lastF.talking = false;
      this.ev.emit('frames', frames);
      this.ev.emit('pulse', { t: lastF.t, value: lastF.pulse, confidence: 70, stable: true });
      this.ev.emit('rate', { t: lastF.t, value: this.rate * 60, confidence: lastF.t - this.t0 > 4e6 ? 60 : 0, stable: lastF.t - this.t0 > 4e6 });
      this.ev.emit('talking', { t: lastF.t, detected: false, stable: true });
    }, 100);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this._status = 'off';
    this.ev.emit('status', 'off');
  }
  destroy() {
    void this.stop();
    this.ev.clear();
  }
  stats() {
    return { metricsPerSec: 10, tracePerSec: 30, processing: 'Test signal', lastMetricAgeMs: 0 };
  }
}
