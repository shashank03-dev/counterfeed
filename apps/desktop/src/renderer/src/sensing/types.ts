import type { Normalized } from './normalize';

export type SourceStatus = 'off' | 'starting' | 'running' | 'error';

/** Problems a person can act on, in their words. Technical detail goes to Camera check only. */
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
  /** Raw SDK ValidationCode (Camera check only). */
  code: number;
  /** SDK hint text, designed to be shown as-is (docs/measurement-quality.md). */
  hint: string;
  light: 'ok' | 'warn' | 'unknown';
  framing: 'ok' | 'warn' | 'unknown';
  stillness: 'ok' | 'warn' | 'unknown';
  /** Whether the chest is in view, so the breathing wave can be read. Optional: face measures work without it. */
  breathing: 'ok' | 'warn' | 'unknown';
  settling: boolean;
}

export interface SourceEvents extends Record<string, unknown[]> {
  metrics: [Normalized];
  quality: [Quality, number];
  status: [SourceStatus];
  stream: [MediaStream | null];
  problem: [SensingProblem, string];
}

/** Where body signals come from: the camera (SmartSpectra SDK), or the labelled e2e test signal. */
export interface SignalSource {
  readonly kind: 'camera' | 'test';
  readonly stream: MediaStream | null;
  readonly status: SourceStatus;
  on<K extends keyof SourceEvents>(event: K, fn: (...args: SourceEvents[K]) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
  /** Camera check counters. */
  stats(): { metricsPerSec: number; processing: string; lastMetricAgeMs: number | null };
}
