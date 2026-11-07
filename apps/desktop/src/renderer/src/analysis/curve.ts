import type { Report } from '@counterfeed/shared';

/*
 * Reading the attention curve (pure, shared by the report builder and the report screen).
 * The curve is 0-1 per bin; null where there was no clear signal.
 */

/** 3-bin moving average that skips nulls (keeps a null where the bin itself had no signal). */
export function smooth(curve: (number | null)[]): (number | null)[] {
  return curve.map((v, i) => {
    if (v === null) return null;
    const w = [curve[i - 1], v, curve[i + 1]].filter((x): x is number => typeof x === 'number');
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

export interface Peak {
  atMs: number;
  value: number;
}

/** Up to `n` strongest bins (>= 0.45), at least 3 bins apart. */
export function heldMoments(curve: (number | null)[], binMs: number, n = 3): Peak[] {
  const s = smooth(curve);
  const order = s.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null && x.v >= 0.45).sort((a, b) => b.v - a.v);
  const picked: { v: number; i: number }[] = [];
  for (const x of order) {
    if (picked.every((p) => Math.abs(p.i - x.i) >= 3)) picked.push(x);
    if (picked.length >= n) break;
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => ({ atMs: p.i * binMs, value: p.v }));
}

export interface Lull {
  startMs: number;
  endMs: number;
}

/** Runs of 3+ bins under 0.15 (attention light), the "it lost you here" stretches. */
export function lulls(curve: (number | null)[], binMs: number): Lull[] {
  const s = smooth(curve);
  const out: Lull[] = [];
  let start: number | null = null;
  s.forEach((v, i) => {
    const low = v !== null && v < 0.15;
    if (low && start === null) start = i;
    if (!low && start !== null) {
      if (i - start >= 3) out.push({ startMs: start * binMs, endMs: i * binMs });
      start = null;
    }
  });
  if (start !== null && s.length - start >= 3) out.push({ startMs: start * binMs, endMs: s.length * binMs });
  return out;
}

/** Mean of the curve over the first `ms` (default 30 s). null if under half of it had signal. */
export function opening(curve: (number | null)[], binMs: number, ms = 30_000): number | null {
  const n = Math.max(1, Math.round(ms / binMs));
  const head = curve.slice(0, n);
  const v = head.filter((x): x is number => x !== null);
  if (head.length < n || v.length < n / 2) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Position of an event on the report's axis (video time for a video review, else watching time). */
export function axisMs(r: Pick<Report, 'curveAxis'>, e: { atMs: number; contentMs: number | null }): number {
  return r.curveAxis === 'content' && e.contentMs !== null ? e.contentMs : e.atMs;
}
