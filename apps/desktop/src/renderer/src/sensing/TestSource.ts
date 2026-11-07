import { Emitter } from '../lib/emitter';
import { gaussian, mulberry32 } from '../lib/rng';
import { nowUs } from '../lib/time';
import { emptyNormalized, type Normalized } from './normalize';
import { applyValidation, V } from './quality';
import type { Quality, SignalSource, SourceEvents, SourceStatus } from './types';

/**
 * AUTOMATED TESTS ONLY (COUNTERFEED_E2E=1, never in a packaged app). Emits a deterministic, scripted set of body
 * signals so the end-to-end suite can drive the whole flow without a face in front of a camera. Nothing here
 * touches the SmartSpectra SDK, and the UI shows a "Test signal" badge whenever this source is active.
 *
 * Script (seconds since start), timed for the e2e run (settle is 16 s there): blinks every 3 s for the first 18 s
 * (a "normal" of 20/min), then every 7 s with none from 28 to 40; breathing pauses (flat wave) at 24-32 and 44-52;
 * a smile at 36; the face turns away at 56-58.5; the camera is still adjusting for the first 1.5 s. Head pose
 * (from face landmarks) follows the same script.
 *
 * The 'laptop' scenario reproduces what a real laptop camera did: the SDK reports "chest not in view" the whole
 * time (after the first 1.5 s), which hides a head turn at 46-50 and a look down at 54-58 from its codes; only head
 * pose shows them. The breathing wave still has its flat stretches, and they must NOT be reported as pauses.
 *
 * The 'focus' scenario is the default script plus a 13-second look down at 26-39 (a phone in the lap: the SDK still
 * finds the face, only head pose shows it). In a focus session that is one break; the turn at 56-58.5 is a glance.
 */
export const TEST_SCRIPT = {
  normalUntil: 18,
  holds: [
    [24, 32],
    [44, 52],
  ],
  noBlink: [28, 40],
  smileAt: 36,
  away: [56, 58.5],
  laptop: { turn: [46, 50], down: [54, 58] },
  focus: { down: [26, 39] },
} as const;

export class TestSource implements SignalSource {
  readonly kind = 'test';
  private ev = new Emitter<SourceEvents>();
  private _status: SourceStatus = 'off';
  private timer: ReturnType<typeof setInterval> | null = null;
  private g: () => number;
  private t0 = 0;
  private last = 0;
  private phase = 0;
  private quality: Quality | null = null;
  private lastCode = -1;
  private lastBlinkAt = -Infinity;

  constructor(
    seed: number,
    private readonly scenario: 'default' | 'laptop' | 'focus' = 'default',
  ) {
    this.g = gaussian(mulberry32(seed));
  }

  get stream() {
    return null;
  }
  get status() {
    return this._status;
  }
  on<K extends keyof SourceEvents>(event: K, fn: (...args: SourceEvents[K]) => void) {
    return this.ev.on(event, fn);
  }

  private emitQuality(code: number) {
    if (code === this.lastCode) return;
    this.lastCode = code;
    this.quality = applyValidation(this.quality, code, '');
    this.ev.emit('quality', this.quality, nowUs());
  }

  private tick() {
    const now = nowUs();
    const n: Normalized = emptyNormalized();
    const sec = (t: number) => (t - this.t0) / 1e6;
    for (let t = this.last + 33_333; t <= now; t += 33_333) {
      const s = sec(t);
      const holding = TEST_SCRIPT.holds.some(([a, b]) => s >= a && s < b);
      this.phase += 2 * Math.PI * 0.25 * 0.033333;
      const amp = holding ? 0.02 : 1;
      n.trace.push({ t: Math.round(t), v: amp * Math.sin(this.phase) + 0.01 * this.g(), stable: s > 3 });
      const every = s < TEST_SCRIPT.normalUntil ? 3 : 7;
      const inGap = s >= TEST_SCRIPT.noBlink[0] && s < TEST_SCRIPT.noBlink[1];
      const blinkNow = !inGap && s - this.lastBlinkAt >= every;
      if (blinkNow) this.lastBlinkAt = s;
      n.blink.push({ t: Math.round(t), detected: blinkNow || s - this.lastBlinkAt < 0.1, stable: true });
      const L = TEST_SCRIPT.laptop;
      const turned = this.scenario === 'laptop' ? s >= L.turn[0] && s < L.turn[1] : s >= TEST_SCRIPT.away[0] && s < TEST_SCRIPT.away[1];
      const F = TEST_SCRIPT.focus;
      const down = (this.scenario === 'laptop' && s >= L.down[0] && s < L.down[1]) || (this.scenario === 'focus' && s >= F.down[0] && s < F.down[1]);
      n.pose.push({ t: Math.round(t), yaw: (turned ? 0.8 : -0.05) + 0.005 * this.g(), pitch: (down ? 0.48 : 0.33) + 0.005 * this.g(), stable: true });
      this.last = t;
    }
    if (!n.trace.length) return;
    const t = n.trace[n.trace.length - 1]!.t;
    const s = sec(t);
    const smile = Math.max(0, 85 - 40 * Math.abs(s - TEST_SCRIPT.smileAt)) || 3;
    n.expressions.push({ t, smile, surprise: 2, frown: 1, stable: true });
    n.talking.push({ t, detected: false, stable: true });
    n.pulse.push({ t, value: s < TEST_SCRIPT.normalUntil ? 68 : 75, confidence: 70, stable: true });
    n.rate.push({ t, value: 15, confidence: s > 4 ? 60 : 0, stable: s > 4 });
    if (s > TEST_SCRIPT.normalUntil) n.hrv.push({ t, rmssd: 44, confidence: 60, stable: true });
    this.ev.emit('metrics', n);
    const away = s >= TEST_SCRIPT.away[0] && s < TEST_SCRIPT.away[1];
    if (this.scenario === 'laptop') this.emitQuality(s < 1.5 ? V.cameraTuning : V.chestNotVisible);
    else this.emitQuality(s < 1.5 ? V.cameraTuning : away ? V.notForward : V.ok);
  }

  async start() {
    this._status = 'running';
    this.ev.emit('status', 'running');
    this.t0 = nowUs();
    this.last = this.t0;
    this.timer = setInterval(() => this.tick(), 100);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this._status = 'off';
    this.ev.emit('status', 'off');
  }
  destroy() {
    void this.stop();
    this.ev.clear();
  }
  stats() {
    return { metricsPerSec: 10, processing: 'Test signal', lastMetricAgeMs: 0 };
  }
}
