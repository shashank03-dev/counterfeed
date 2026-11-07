/**
 * Decoded SmartSpectra metrics -> Counterfeed's own small shapes. Pure and unit-tested.
 *
 * Each 'metrics' event carries only the samples produced since the previous one ("Each `metrics` event
 * delivers the WINDOWED slice since the previous emit", Presage electron-quickstart renderer.js), so the
 * caller appends. Repeated fields may be empty between updates. Timestamps are int64 microseconds since the
 * epoch and decode as protobufjs Long objects.
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
interface L {
  value?: { x?: number | null; y?: number | null }[] | null;
  stable?: boolean | null;
  timestamp?: Ts;
}
interface H {
  rmssd?: number | null;
  confidence?: number | null;
  stable?: boolean | null;
  timestamp?: Ts;
}
export interface DecodedMetrics {
  breathing?: { upperTrace?: M[] | null; rate?: MC[] | null; apnea?: D[] | null } | null;
  cardio?: { pulseRate?: MC[] | null; hrv?: H[] | null } | null;
  face?: { blinking?: D[] | null; talking?: D[] | null; expression?: E[] | null; landmarks?: L[] | null } | null;
}

export interface TraceSample {
  t: number;
  v: number;
  stable: boolean;
}
export interface RateSample {
  t: number;
  value: number;
  confidence: number;
  stable: boolean;
}
export interface Detection {
  t: number;
  detected: boolean;
  stable: boolean;
}
/** Facial-expression probabilities (0-100). 'frown' is the largest of the angry, disgust and contempt scores. */
export interface ExpressionSample {
  t: number;
  smile: number;
  surprise: number;
  frown: number;
  stable: boolean;
}
export interface HrvSample {
  t: number;
  rmssd: number;
  confidence: number;
  stable: boolean;
}

/**
 * Head pose from the face landmarks, as plain ratios (no angles, no calibration). Both are ~0 when you face the
 * camera the way you did while it learned your normal; only the change from your own normal is ever used.
 *  - yaw: nose tip offset from the middle of the face, as a share of face width (turning left/right).
 *  - pitch: nose tip height between the eyes and the chin, as a share of that distance (looking down/up).
 */
export interface PoseSample {
  t: number;
  yaw: number;
  pitch: number;
  stable: boolean;
}

export interface Normalized {
  trace: TraceSample[];
  apnea: Detection[];
  blink: Detection[];
  talking: Detection[];
  expressions: ExpressionSample[];
  rate: RateSample[];
  pulse: RateSample[];
  hrv: HrvSample[];
  pose: PoseSample[];
}

export const emptyNormalized = (): Normalized => ({ trace: [], apnea: [], blink: [], talking: [], expressions: [], rate: [], pulse: [], hrv: [], pose: [] });

// Face-mesh landmark indices (478-point MediaPipe topology, as streamed by SmartSpectra FACE_LANDMARKS).
export const LM = { noseTip: 1, faceLeft: 234, faceRight: 454, eyeLeft: 33, eyeRight: 263, chin: 152 } as const;

/** One landmark set -> head pose, or null when the set is incomplete or degenerate. */
export function poseOf(points: { x?: number | null; y?: number | null }[] | null | undefined): { yaw: number; pitch: number } | null {
  if (!points || points.length < 468) return null;
  const p = (i: number) => {
    const q = points[i];
    return q && fin(q.x) && fin(q.y) ? { x: q.x, y: q.y } : null;
  };
  const nose = p(LM.noseTip);
  const l = p(LM.faceLeft);
  const r = p(LM.faceRight);
  const el = p(LM.eyeLeft);
  const er = p(LM.eyeRight);
  const chin = p(LM.chin);
  if (!nose || !l || !r || !el || !er || !chin) return null;
  const width = Math.abs(r.x - l.x);
  const eyesY = (el.y + er.y) / 2;
  const height = chin.y - eyesY;
  if (width <= 1e-6 || Math.abs(height) <= 1e-6) return null;
  const yaw = (nose.x - (l.x + r.x) / 2) / width;
  const pitch = (nose.y - eyesY) / height;
  if (!fin(yaw) || !fin(pitch) || Math.abs(yaw) > 2 || Math.abs(pitch) > 3) return null;
  return { yaw, pitch };
}

// ExpressionType enum (docs/data-types.md).
const EXPR = { ANGRY: 1, CONTEMPT: 2, DISGUST: 3, HAPPY: 5, SURPRISE: 8 } as const;

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
const okT = (t: number) => fin(t) && t > 0;

function rates(list: MC[] | null | undefined, lo: number, hi: number): RateSample[] {
  const out: RateSample[] = [];
  for (const m of list ?? []) {
    const t = tsToUs(m.timestamp);
    if (!fin(m.value) || !okT(t) || m.value < lo || m.value > hi) continue;
    out.push({ t, value: m.value, confidence: clamp(fin(m.confidence) ? m.confidence : 0, 0, 100), stable: !!m.stable });
  }
  return out;
}

function detections(list: D[] | null | undefined): Detection[] {
  const out: Detection[] = [];
  for (const m of list ?? []) {
    const t = tsToUs(m.timestamp);
    if (!okT(t)) continue;
    out.push({ t, detected: !!m.detected, stable: !!m.stable });
  }
  return out.sort((a, b) => a.t - b.t);
}

function typeIs(type: number | string | null | undefined, num: number) {
  const name = Object.entries(EXPR).find(([, v]) => v === num)?.[0];
  return type === num || type === name;
}

export function normalize(d: DecodedMetrics | null | undefined): Normalized {
  const trace: TraceSample[] = [];
  for (const m of d?.breathing?.upperTrace ?? []) {
    const t = tsToUs(m.timestamp);
    if (!fin(m.value) || !okT(t)) continue;
    trace.push({ t, v: m.value, stable: !!m.stable });
  }
  trace.sort((a, b) => a.t - b.t);

  const expressions: ExpressionSample[] = [];
  for (const e of d?.face?.expression ?? []) {
    const t = tsToUs(e.timestamp);
    if (!okT(t)) continue;
    let smile = 0;
    let surprise = 0;
    let frown = 0;
    for (const s of e.scores ?? []) {
      const c = fin(s.confidence) ? clamp(s.confidence, 0, 100) : 0;
      if (typeIs(s.type, EXPR.HAPPY)) smile = c;
      else if (typeIs(s.type, EXPR.SURPRISE)) surprise = c;
      else if (typeIs(s.type, EXPR.ANGRY) || typeIs(s.type, EXPR.DISGUST) || typeIs(s.type, EXPR.CONTEMPT)) frown = Math.max(frown, c);
    }
    expressions.push({ t, smile, surprise, frown, stable: !!e.stable });
  }
  expressions.sort((a, b) => a.t - b.t);

  const hrv: HrvSample[] = [];
  for (const h of d?.cardio?.hrv ?? []) {
    const t = tsToUs(h.timestamp);
    if (!okT(t) || !fin(h.rmssd) || h.rmssd <= 0 || h.rmssd > 400) continue;
    hrv.push({ t, rmssd: h.rmssd, confidence: clamp(fin(h.confidence) ? h.confidence : 0, 0, 100), stable: !!h.stable });
  }

  const pose: PoseSample[] = [];
  for (const l of d?.face?.landmarks ?? []) {
    const t = tsToUs(l.timestamp);
    if (!okT(t)) continue;
    const p = poseOf(l.value);
    if (p) pose.push({ t, ...p, stable: !!l.stable });
  }
  pose.sort((a, b) => a.t - b.t);

  return {
    trace,
    apnea: detections(d?.breathing?.apnea),
    blink: detections(d?.face?.blinking),
    talking: detections(d?.face?.talking),
    expressions,
    rate: rates(d?.breathing?.rate, 1, 60),
    pulse: rates(d?.cardio?.pulseRate, 1, 250),
    hrv,
    pose,
  };
}
