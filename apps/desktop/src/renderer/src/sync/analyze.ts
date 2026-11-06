import { bandpassGappy } from './filter';
import { phaseGappy } from './phase';
import { plv } from './plv';
import { makeGrid, resample, resampleFlags } from './resample';
import { surrogateTest } from './surrogate';

/** One person's raw signals, timestamps (us) on THEIR OWN clock. */
export interface PersonSignals {
  t: ArrayLike<number>;
  v: ArrayLike<number>;
  /** Talking flag samples. */
  talkT: ArrayLike<number>;
  talk: ArrayLike<boolean | number>;
}

export interface AnalyzeOptions {
  /** Local-clock window to analyze. */
  start: number;
  end: number;
  /** partnerClock - localClock, us (from clock sync). */
  offsetUs: number;
  hz?: number;
  surrogates?: number;
  seed?: number;
  /** Extra seconds excluded after talking stops (speech disturbs the next breath). */
  talkTailS?: number;
}

export interface Prepared {
  fs: number;
  n: number;
  phiA: Float64Array;
  phiB: Float64Array;
  validA: Uint8Array;
  validB: Uint8Array;
  /** Share of the grid where either person was talking. */
  talkingShare: number;
}

function dilate(mask: Uint8Array, samples: number): Uint8Array {
  if (samples <= 0) return mask;
  const out = Uint8Array.from(mask);
  let last = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) last = i;
    else if (i - last <= samples) out[i] = 1;
  }
  return out;
}

/** Resample both people onto one 10 Hz local-clock grid, drop talking, band-pass, and extract phase. */
export function prepare(you: PersonSignals, partner: PersonSignals, o: AnalyzeOptions): Prepared {
  const hz = o.hz ?? 10;
  const g = makeGrid(o.start, o.end, hz);
  const tail = Math.round((o.talkTailS ?? 1) * hz);
  const a = resample(you.t, you.v, g, 500_000, 0);
  const b = resample(partner.t, partner.v, g, 500_000, o.offsetUs);
  const talkA = dilate(resampleFlags(you.talkT, you.talk, g, 1_000_000, 0), tail);
  const talkB = dilate(resampleFlags(partner.talkT, partner.talk, g, 1_000_000, o.offsetUs), tail);
  let talking = 0;
  for (let i = 0; i < g.n; i++) {
    if (talkA[i]) a[i] = NaN; // "talking invalidates breathing" (SDK model card)
    if (talkB[i]) b[i] = NaN;
    if (talkA[i] || talkB[i]) talking++;
  }
  const phiA = phaseGappy(bandpassGappy(a, hz), hz);
  const phiB = phaseGappy(bandpassGappy(b, hz), hz);
  const validA = Uint8Array.from(phiA, (x) => (Number.isFinite(x) ? 1 : 0));
  const validB = Uint8Array.from(phiB, (x) => (Number.isFinite(x) ? 1 : 0));
  return { fs: hz, n: g.n, phiA, phiB, validA, validB, talkingShare: g.n ? talking / g.n : 0 };
}

export interface SyncResult {
  plv: number;
  windows: number;
  coverage: number;
  series: number[];
  chance: { mean: number; p95: number; n: number };
  ratio: number;
  percentile: number;
  talkingShare: number;
}

/** Full analysis of one phase: windowed PLV plus the circular-shift chance level. */
export function analyzePhase(you: PersonSignals, partner: PersonSignals, o: AnalyzeOptions): SyncResult | null {
  const p = prepare(you, partner, o);
  const opts = { fs: p.fs, windowS: 30, stepS: 5, minCoverage: 0.6 };
  const res = plv(p.phiA, p.phiB, opts, p.validA, p.validB);
  if (!res.windows) return null;
  const s = surrogateTest(p.phiA, p.phiB, { ...opts, n: o.surrogates ?? 200, minShiftS: 10, seed: o.seed }, p.validA, p.validB);
  return {
    plv: res.plv,
    windows: res.windows,
    coverage: res.coverage,
    series: res.series.map((x) => (Number.isFinite(x) ? x : 0)),
    chance: { mean: s.mean, p95: s.p95, n: s.n },
    ratio: s.ratio,
    percentile: s.percentile,
    talkingShare: p.talkingShare,
  };
}

/**
 * Live sync meter: PLV of the most recent 30 s. The last 60 s are filtered so the
 * band-pass has settled by the time the 30 s window starts. NaN when there isn't enough clean signal.
 */
export function liveSync(you: PersonSignals, partner: PersonSignals, nowLocal: number, offsetUs: number): number {
  const p = prepare(you, partner, { start: nowLocal - 60e6, end: nowLocal, offsetUs });
  const win = 30 * p.fs;
  const from = Math.max(0, p.n - win);
  const r = plv(p.phiA.subarray(from), p.phiB.subarray(from), { fs: p.fs, windowS: 30, stepS: 30, minCoverage: 0.5 }, p.validA.subarray(from), p.validB.subarray(from));
  return r.plv;
}

/**
 * Live chance level for the meter: the circular-shift surrogate mean over the last 90 s, with the same 30 s
 * window as the meter. It answers "how in step would two people breathing at these paces look by accident",
 * so the live number can be read against it. NaN until there is enough clean signal.
 */
export function liveChance(you: PersonSignals, partner: PersonSignals, nowLocal: number, offsetUs: number, n = 60): number {
  const p = prepare(you, partner, { start: nowLocal - 90e6, end: nowLocal, offsetUs });
  const s = surrogateTest(p.phiA, p.phiB, { fs: p.fs, windowS: 30, stepS: 5, minCoverage: 0.5, n, minShiftS: 10, seed: 0x5eed }, p.validA, p.validB);
  return s.n >= 10 ? s.mean : NaN;
}
