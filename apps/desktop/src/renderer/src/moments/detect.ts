import type { Moment, MomentKind } from '@together/shared';
import { median } from '../lib/stats';

/**
 * Listener reactions ("Moments"). Runs only while the partner is talking and you are not
 * (both stable). Signal: the SDK's facial-expression probabilities for happiness and surprise (0-100),
 * smoothed with a 0.5 s EMA. An event fires when the smoothed value rises >= 30 points above its
 * rolling 10 s median and peaks >= 60, at least 5 s after the previous event. Pulse is checked
 * afterwards: max stable pulse in the next 15 s minus the median of the previous 15 s.
 *
 * These are facial-expression probabilities, never "emotion detection".
 */
export const MOMENT_RULES = {
  emaTauS: 0.5,
  medianWindowS: 10,
  minHistoryS: 3,
  rise: 30,
  peak: 60,
  /** Excursion ends when the smoothed value falls back under median + this. */
  release: 15,
  minGapS: 5,
  pulseWindowS: 15,
} as const;

const KINDS: { kind: MomentKind; key: 'happy' | 'surprise' }[] = [
  { kind: 'smile', key: 'happy' },
  { kind: 'surprise', key: 'surprise' },
];

interface Track {
  ema: number | null;
  lastT: number;
  hist: { t: number; v: number }[];
  /** Active excursion. */
  ex: { baseline: number; peak: number; peakT: number } | null;
}

export interface Detected {
  id: string;
  kind: MomentKind;
  t: number;
  peak: number;
}

export class MomentDetector {
  private tracks = new Map<MomentKind, Track>();
  private selfTalking: boolean | null = null;
  private partnerTalking: boolean | null = null;
  private lastEventT = -Infinity;
  private pulse: { t: number; v: number }[] = [];
  private pending: Detected[] = [];
  private seq = 0;

  constructor(
    /** Session start (us, local clock) for the "at 04:32" offset. */
    private readonly sessionStart: number,
    private readonly onDetected: (d: Detected) => void,
    private readonly onResolved: (m: Moment) => void,
  ) {
    for (const k of KINDS) this.tracks.set(k.kind, { ema: null, lastT: 0, hist: [], ex: null });
  }

  /** Talking state from the SDK (self) or from the partner's frames. Unstable readings are "unknown". */
  setTalking(who: 'self' | 'partner', detected: boolean, stable = true) {
    const v = stable ? detected : null;
    if (who === 'self') this.selfTalking = v;
    else this.partnerTalking = v;
  }

  get listening(): boolean {
    return this.partnerTalking === true && this.selfTalking === false;
  }

  pushPulse(t: number, bpm: number, stable: boolean) {
    if (!stable || !Number.isFinite(bpm)) return;
    this.pulse.push({ t, v: bpm });
    const keep = t - (MOMENT_RULES.pulseWindowS * 2 + 30) * 1e6;
    while (this.pulse.length && this.pulse[0]!.t < keep) this.pulse.shift();
  }

  pushExpression(s: { t: number; happy: number; surprise: number }) {
    for (const { kind, key } of KINDS) this.step(kind, s.t, s[key]);
    this.resolve(s.t);
  }

  /** Resolve pending pulse checks once 15 s have passed (call periodically with the local clock). */
  tick(now: number) {
    this.resolve(now);
  }

  private step(kind: MomentKind, t: number, raw: number) {
    const tr = this.tracks.get(kind)!;
    if (tr.ema === null) tr.ema = raw;
    else {
      const dt = Math.max(0, (t - tr.lastT) / 1e6);
      const a = 1 - Math.exp(-dt / MOMENT_RULES.emaTauS);
      tr.ema += a * (raw - tr.ema);
    }
    tr.lastT = t;
    const v = tr.ema;

    const windowStart = t - MOMENT_RULES.medianWindowS * 1e6;
    while (tr.hist.length && tr.hist[0]!.t < windowStart) tr.hist.shift();
    const enoughHistory = tr.hist.length > 0 && t - tr.hist[0]!.t >= MOMENT_RULES.minHistoryS * 1e6;
    const med = enoughHistory ? median(tr.hist.map((h) => h.v)) : NaN;

    if (tr.ex) {
      if (v > tr.ex.peak) {
        tr.ex.peak = v;
        tr.ex.peakT = t;
      }
      if (v < tr.ex.baseline + MOMENT_RULES.release) {
        const ex = tr.ex;
        tr.ex = null;
        if (ex.peak >= MOMENT_RULES.peak && ex.peakT - this.lastEventT >= MOMENT_RULES.minGapS * 1e6) {
          this.lastEventT = ex.peakT;
          const d: Detected = { id: `m-${Math.round(ex.peakT / 1000).toString(36)}-${this.seq++}`, kind, t: ex.peakT, peak: Math.round(ex.peak) };
          this.pending.push(d);
          this.onDetected(d);
        }
      }
    } else if (enoughHistory && this.listening && v - med >= MOMENT_RULES.rise) {
      // The baseline is frozen at onset so a long smile can't raise its own reference.
      tr.ex = { baseline: med, peak: v, peakT: t };
    }
    // Excursion samples are kept out of the rolling median.
    if (!tr.ex) tr.hist.push({ t, v });
  }

  private resolve(now: number) {
    const w = MOMENT_RULES.pulseWindowS * 1e6;
    while (this.pending.length && now - this.pending[0]!.t >= w) {
      const d = this.pending.shift()!;
      const before = this.pulse.filter((p) => p.t >= d.t - w && p.t < d.t).map((p) => p.v);
      const after = this.pulse.filter((p) => p.t > d.t && p.t <= d.t + w).map((p) => p.v);
      const pulseDelta = before.length && after.length ? Math.round(Math.max(...after) - median(before)) : null;
      this.onResolved({
        id: d.id,
        t: d.t,
        atMs: Math.max(0, Math.round((d.t - this.sessionStart) / 1000)),
        kind: d.kind,
        peak: d.peak,
        pulseDelta,
      });
    }
  }
}

/** "at 04:32 you smiled (84%), pulse +9 BPM" */
export function describeMoment(m: Pick<Moment, 'atMs' | 'kind' | 'peak' | 'pulseDelta'>, who: 'you' | 'they' = 'you'): string {
  const s = Math.round(m.atMs / 1000);
  const at = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const verb = m.kind === 'smile' ? `${who} smiled` : `${who} looked surprised`;
  const pulse = m.pulseDelta === null ? 'pulse: not enough signal' : `pulse ${m.pulseDelta >= 0 ? '+' : '−'}${Math.abs(m.pulseDelta)} BPM`;
  return `at ${at} ${verb} (${Math.round(m.peak)}%), ${pulse}`;
}
