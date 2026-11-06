import type { SignalFrame } from '@together/shared';
import { Emitter } from '../lib/emitter';
import { nowUs } from '../lib/time';
import { RecordingPlayer, type ParsedRecording } from '../link/recording';
import type { SignalSource, SourceEvents, SourceStatus } from './types';

/**
 * "Your" signals replayed from a recording: used by the second dev instance (`npm run dev:peer2`), which
 * cannot own the camera. The partner is told (hello.replay) and labels it as a replay. No video.
 */
export class ReplaySource implements SignalSource {
  readonly kind = 'replay';
  readonly stream = null;
  private ev = new Emitter<SourceEvents>();
  private player: RecordingPlayer;
  private _status: SourceStatus = 'off';
  private counted = { n: 0, since: performance.now(), rate: 0 };

  constructor(readonly rec: ParsedRecording) {
    this.player = new RecordingPlayer(rec, nowUs, (frames) => this.onFrames(frames));
  }

  get status() {
    return this._status;
  }
  get recordedAt() {
    return this.rec.header.recordedAt;
  }
  on<K extends keyof SourceEvents>(event: K, fn: (...args: SourceEvents[K]) => void) {
    return this.ev.on(event, fn);
  }

  private onFrames(frames: SignalFrame[]) {
    this.counted.n += frames.length;
    this.ev.emit('frames', frames);
    const p = [...frames].reverse().find((f) => f.pulse !== undefined);
    if (p) this.ev.emit('pulse', { t: p.t, value: p.pulse!, confidence: p.pulseConf ?? 0, stable: (p.pulseConf ?? 0) >= 40 });
    const tk = [...frames].reverse().find((f) => f.talking !== undefined);
    if (tk) this.ev.emit('talking', { t: tk.t, detected: !!tk.talking, stable: true });
  }

  seek(phase: Parameters<RecordingPlayer['seek']>[0], atLocal: number) {
    return this.player.seek(phase, atLocal);
  }

  async start() {
    this._status = 'running';
    this.ev.emit('status', 'running');
    this.ev.emit('quality', { code: 0, hint: '', light: 'ok', framing: 'ok', stillness: 'ok', settling: false });
    this.player.start();
  }
  async stop() {
    this.player.stop();
    this._status = 'off';
    this.ev.emit('status', 'off');
  }
  destroy() {
    this.player.stop();
    this.ev.clear();
  }
  stats() {
    const now = performance.now();
    const dt = (now - this.counted.since) / 1000;
    if (dt >= 1) {
      this.counted.rate = this.counted.n / dt;
      this.counted.n = 0;
      this.counted.since = now;
    }
    return { metricsPerSec: 10, tracePerSec: this.counted.rate, processing: 'Replay', lastMetricAgeMs: 0 };
  }
}
