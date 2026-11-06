import type { SignalFrame } from '@together/shared';

/**
 * Decoded SmartSpectra metrics -> Together's own small shapes. Pure and unit-tested.
 *
 * Each 'metrics' event carries only the samples produced since the previous one ("Each `metrics` event
 * delivers the WINDOWED slice since the previous emit", Presage electron-quickstart renderer.js), so
 * the caller appends. Repeated fields may be empty between updates ("keep last valid value").
 * Timestamps are int64 microseconds since the epoch and decode as protobufjs Long objects.
 */

type Ts = number | bigint | string | { toNumber(): number } | null | undefined;
interface M {
  value?: number | null;
  stable?: boolean | null;
  timestamp?: Ts;
}
interface MC extends M {
  confidence?: number | null;
}
interface D {
  detected?: boolean | null;
  stable?: boolean | null;
  timestamp?: Ts;
}
interface E {
  stable?: boolean | null;
  timestamp?: Ts;
  scores?: { type?: number | string | null; confidence?: number | null }[] | null;
}
export interface DecodedMetrics {
  breathing?: { upperTrace?: M[] | null; rate?: MC[] | null } | null;
  cardio?: { pulseRate?: MC[] | null } | null;
  face?: { talking?: D[] | null; expression?: E[] | null } | null;
}

export interface RateSample {
  t: number;
  value: number;
  confidence: number;
  stable: boolean;
}
export interface TalkingSample {
  t: number;
  detected: boolean;
  stable: boolean;
}
/** Facial-expression probabilities (0-100). Local only: never sent unless the person shares a Moment. */
export interface ExpressionSample {
  t: number;
  happy: number;
  surprise: number;
  stable: boolean;
}

export interface Normalized {
  /** Outgoing frames: trace samples, pulse and talking merged on timestamp. */
  frames: SignalFrame[];
  breathingRate: RateSample | null;
  pulse: RateSample | null;
  talking: TalkingSample | null;
  expressions: ExpressionSample[];
}

// ExpressionType enum (docs/data-types.md): HAPPY = 5, SURPRISE = 8.
const HAPPY = 5;
const SURPRISE = 8;

export function tsToUs(ts: Ts): number {
  if (ts == null) return NaN;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'bigint') return Number(ts);
  if (typeof ts === 'string') return Number(ts);
  if (typeof ts.toNumber === 'function') return ts.toNumber();
  return Number(ts);
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function lastRate(list: MC[] | null | undefined): RateSample | null {
  if (!list?.length) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]!;
    const t = tsToUs(m.timestamp);
    if (!fin(m.value) || !fin(t) || t <= 0) continue;
    return { t, value: m.value, confidence: clamp(fin(m.confidence) ? m.confidence : 0, 0, 100), stable: !!m.stable };
  }
  return null;
}

function typeIs(type: number | string | null | undefined, num: number, name: string) {
  return type === num || type === name;
}

export function normalize(d: DecodedMetrics | null | undefined): Normalized {
  const byT = new Map<number, SignalFrame>();
  const frame = (t: number) => {
    let f = byT.get(t);
    if (!f) byT.set(t, (f = { t }));
    return f;
  };

  for (const m of d?.breathing?.upperTrace ?? []) {
    const t = tsToUs(m.timestamp);
    if (!fin(m.value) || !fin(t) || t <= 0) continue;
    const f = frame(t);
    f.trace = m.value;
    f.traceStable = !!m.stable;
  }
  for (const m of d?.cardio?.pulseRate ?? []) {
    const t = tsToUs(m.timestamp);
    if (!fin(m.value) || !fin(t) || t <= 0 || m.value <= 0) continue;
    const f = frame(t);
    f.pulse = clamp(m.value, 0, 250);
    f.pulseConf = clamp(fin(m.confidence) ? m.confidence : 0, 0, 100);
  }
  let talking: TalkingSample | null = null;
  for (const m of d?.face?.talking ?? []) {
    const t = tsToUs(m.timestamp);
    if (!fin(t) || t <= 0) continue;
    const s = { t, detected: !!m.detected, stable: !!m.stable };
    // Only stable detections are sent: an unstable "not talking" must not count as silence.
    if (s.stable) frame(t).talking = s.detected;
    if (!talking || t >= talking.t) talking = s;
  }

  const expressions: ExpressionSample[] = [];
  for (const e of d?.face?.expression ?? []) {
    const t = tsToUs(e.timestamp);
    if (!fin(t) || t <= 0) continue;
    let happy = 0;
    let surprise = 0;
    for (const s of e.scores ?? []) {
      const c = fin(s.confidence) ? clamp(s.confidence, 0, 100) : 0;
      if (typeIs(s.type, HAPPY, 'HAPPY')) happy = c;
      else if (typeIs(s.type, SURPRISE, 'SURPRISE')) surprise = c;
    }
    expressions.push({ t, happy, surprise, stable: !!e.stable });
  }
  expressions.sort((a, b) => a.t - b.t);

  return {
    frames: [...byT.values()].sort((a, b) => a.t - b.t),
    breathingRate: lastRate(d?.breathing?.rate),
    pulse: lastRate(d?.cardio?.pulseRate),
    talking,
    expressions,
  };
}
