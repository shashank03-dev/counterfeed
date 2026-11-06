import type { SignalFrame } from '@together/shared';
import type { ExpressionSample, RateSample, TalkingSample } from './normalize';

export type SourceStatus = 'off' | 'starting' | 'running' | 'error';

/** Problems a person can act on, in their words. Technical detail goes to Diagnostics only. */
export type SensingProblem =
  | 'invalid-key'
  | 'no-key'
  | 'credit'
  | 'network'
  | 'camera-denied'
  | 'camera-busy'
  | 'camera-missing'
  | 'unavailable'
  | 'low-frame-rate'
  | 'failed';

export interface Quality {
  /** Raw SDK ValidationCode (Diagnostics only). */
  code: number;
  /** SDK hint text, designed to be shown as-is (docs/measurement-quality.md). */
  hint: string;
  light: 'ok' | 'warn' | 'unknown';
  framing: 'ok' | 'warn' | 'unknown';
  stillness: 'ok' | 'warn' | 'unknown';
  settling: boolean;
}

export interface SourceEvents extends Record<string, unknown[]> {
  frames: [SignalFrame[]];
  rate: [RateSample];
  pulse: [RateSample];
  talking: [TalkingSample];
  expressions: [ExpressionSample[]];
  quality: [Quality];
  status: [SourceStatus];
  stream: [MediaStream | null];
  problem: [SensingProblem, string];
}

/** Where "your" signals come from: the camera (SDK), a replayed recording (peer 2), or the e2e test signal. */
export interface SignalSource {
  readonly kind: 'camera' | 'replay' | 'test';
  readonly stream: MediaStream | null;
  readonly status: SourceStatus;
  on<K extends keyof SourceEvents>(event: K, fn: (...args: SourceEvents[K]) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
  /** Diagnostics counters. */
  stats(): { metricsPerSec: number; tracePerSec: number; processing: string; lastMetricAgeMs: number | null };
}
