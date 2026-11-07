import { breathingMetrics, cardioMetrics, MetricType, ProcessingStatus, SmartSpectraErrorCode, SmartSpectraSDK } from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { Emitter } from '../lib/emitter';
import { normalize, tsToUs, type DecodedMetrics } from './normalize';
import { nowUs } from '../lib/time';
import { applyValidation, V } from './quality';
import type { Quality, SensingProblem, SignalSource, SourceEvents, SourceStatus } from './types';

/**
 * Body signals measured on this Mac by the SmartSpectra renderer SDK.
 *
 * - `await sdk.start()` acquires the front camera (1280x720 / 30 fps) and emits 'streamAvailable'; that stream
 *   is only shown as a small framing preview. No frame is stored or sent anywhere by Counterfeed.
 * - Requested: the breathing bundle (wave, rate, breath-stop detection), the cardio bundle (pulse, HRV) and the
 *   face bundle (landmarks, blinking, talking, expressions). The 478 face landmarks are reduced on arrival to two
 *   head-pose ratios (see normalize.ts) and never kept: they tell "turned away" apart from "chest out of view",
 *   which the SDK's single validation code can't (it reports one problem at a time).
 * - Telemetry is off (`enableTelemetry: false`).
 */
export class CameraSource implements SignalSource {
  readonly kind = 'camera';
  private ev = new Emitter<SourceEvents>();
  private sdk: SmartSpectraSDK | null = null;
  private _stream: MediaStream | null = null;
  private _status: SourceStatus = 'off';
  private processing = 'Uninitialized';
  private quality: Quality | null = null;
  private pendingCode: { code: number; hint: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private counters = { metrics: 0, since: performance.now(), lastAt: 0, rateMetrics: 0 };

  constructor(
    private readonly apiKey: string,
    /** Developer runs only: keep one raw landmark set a second on the page, to check the pose maths. */
    private readonly recordRaw = false,
  ) {}
  private lastRawAt = 0;

  get stream() {
    return this._stream;
  }
  get status() {
    return this._status;
  }
  on<K extends keyof SourceEvents>(event: K, fn: (...args: SourceEvents[K]) => void) {
    return this.ev.on(event, fn);
  }

  private setStatus(s: SourceStatus) {
    if (this._status === s) return;
    this._status = s;
    this.ev.emit('status', s);
  }

  private problem(p: SensingProblem, detail: string) {
    this.setStatus('error');
    this.ev.emit('problem', p, detail);
  }

  private build() {
    const sdk = new SmartSpectraSDK({
      apiKey: this.apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics, MetricType.FACE_LANDMARKS, MetricType.BLINKING, MetricType.TALKING, MetricType.EXPRESSIONS],
      enableTelemetry: false,
    });
    const statusName = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k.slice(1)]));

    sdk.on('streamAvailable', (stream: MediaStream) => {
      this._stream = stream;
      this.ev.emit('stream', stream);
    });
    sdk.on('processingStatus', (s) => {
      this.processing = statusName[s] ?? String(s);
      if (s === ProcessingStatus.kRunning) this.setStatus('running');
      else if (s === ProcessingStatus.kStarting) this.setStatus('starting');
    });
    sdk.on('validationStatus', (code, _ts, hint) => this.onValidation(code, hint));
    sdk.on('metrics', (buf) => {
      let decoded: DecodedMetrics;
      try {
        decoded = decodeMetrics(buf) as unknown as DecodedMetrics;
      } catch {
        return; // a malformed packet is skipped, never fatal
      }
      this.counters.metrics++;
      this.counters.lastAt = performance.now();
      if (this.recordRaw) this.keepRaw(decoded);
      this.ev.emit('metrics', normalize(decoded));
    });
    sdk.on('error', (code, message) => {
      this.problem(mapSdkError(code), message);
    });
    return sdk;
  }

  private keepRaw(d: DecodedMetrics) {
    // Every frame: the 12 eye-contour points (MediaPipe 33,160,158,133,153,144 and 362,385,387,263,373,380), to
    // check blink detection from eye shape against the SDK's own. Developer runs only (recordRaw is never on when
    // packaged); kept in the page, saved by the guided real-camera scripts to a git-ignored folder.
    const eyes = window as unknown as { __counterfeedRawEyes?: unknown[] };
    for (const f of d.face?.landmarks ?? []) {
      const v = f.value;
      if (!v || v.length < 468) continue;
      const pts = [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380].flatMap((i) => [v[i]?.x ?? null, v[i]?.y ?? null]);
      const t = tsToUs(f.timestamp);
      (eyes.__counterfeedRawEyes ??= []).push({ t: Number.isFinite(t) ? t : nowUs(), p: pts });
    }
    const l = d.face?.landmarks?.at(-1);
    const now = performance.now();
    if (!l?.value?.length || now - this.lastRawAt < 1000) return;
    this.lastRawAt = now;
    const w = window as unknown as { __counterfeedRawLandmarks?: unknown[] };
    (w.__counterfeedRawLandmarks ??= []).push({ t: nowUs(), n: l.value.length, points: l.value.map((p) => [p.x, p.y]) });
  }

  /** The SDK may flicker between OK and a borderline code; only report a code that holds for 400 ms. */
  private onValidation(code: number, hint: string) {
    if (code === V.frameRateTooLow) this.ev.emit('problem', 'low-frame-rate', hint);
    if (this.pendingCode?.code === code) return;
    if (this.pendingCode) clearTimeout(this.pendingCode.timer);
    if (this.quality && this.quality.code === code) {
      this.pendingCode = null;
      return;
    }
    const timer = setTimeout(() => {
      this.pendingCode = null;
      this.quality = applyValidation(this.quality, code, hint);
      this.ev.emit('quality', this.quality, nowUs());
    }, this.quality ? 400 : 0);
    this.pendingCode = { code, hint, timer };
  }

  async start() {
    if (this._status === 'starting' || this._status === 'running') return;
    if (!this.apiKey) return this.problem('no-key', 'No access key');
    this.setStatus('starting');
    try {
      this.sdk ??= this.build();
      await this.sdk.start();
      if ((this._status as SourceStatus) === 'starting') this.setStatus('running');
    } catch (err) {
      const e = err as Error & { code?: unknown; cause?: { name?: string } };
      const name = e.cause?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') this.problem('camera-denied', e.message);
      else if (name === 'NotReadableError' || name === 'AbortError') this.problem('camera-busy', e.message);
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') this.problem('camera-missing', e.message);
      else if (e.code === 'SMARTSPECTRA_IPC_TIMEOUT') this.problem('unavailable', e.message);
      else if (typeof e.code === 'number') this.problem(mapSdkError(e.code), e.message);
      else this.problem('failed', e.message);
    }
  }

  async stop() {
    if (this.pendingCode) clearTimeout(this.pendingCode.timer);
    this.pendingCode = null;
    try {
      await this.sdk?.stop();
    } catch {
      /* already stopped */
    }
    // The SDK releases the camera it acquired on stop().
    this._stream = null;
    this.ev.emit('stream', null);
    this.setStatus('off');
  }

  destroy() {
    if (this.pendingCode) clearTimeout(this.pendingCode.timer);
    try {
      this.sdk?.destroy();
    } catch {
      /* idempotent */
    }
    this.sdk = null;
    this._stream = null;
    this._status = 'off';
    this.ev.clear();
  }

  stats() {
    const now = performance.now();
    const dt = (now - this.counters.since) / 1000;
    if (dt >= 1) {
      this.counters.rateMetrics = this.counters.metrics / dt;
      this.counters.metrics = 0;
      this.counters.since = now;
    }
    return {
      metricsPerSec: this.counters.rateMetrics,
      processing: this.processing,
      lastMetricAgeMs: this.counters.lastAt ? now - this.counters.lastAt : null,
    };
  }
}

export function mapSdkError(code: number): SensingProblem {
  switch (code) {
    case SmartSpectraErrorCode.kAuthenticationFailed:
      return 'invalid-key';
    case SmartSpectraErrorCode.kCreditExhausted:
      return 'credit';
    case SmartSpectraErrorCode.kNetworkError:
    case SmartSpectraErrorCode.kServerError:
      return 'network';
    case SmartSpectraErrorCode.kInputUnavailable:
      return 'camera-busy';
    default:
      return 'failed';
  }
}
