/**
 * Maps wall-clock time to a position in the video being reviewed. The player records a mark on play, pause,
 * seek and four times a second while playing. Pure, unit-tested.
 */
export interface TimeMark {
  /** Wall clock, microseconds. */
  t: number;
  /** Video position, ms. */
  c: number;
  playing: boolean;
}

export class TimeMap {
  private marks: TimeMark[] = [];

  add(m: TimeMark) {
    const last = this.marks[this.marks.length - 1];
    if (last && m.t < last.t) return;
    this.marks.push(m);
  }

  get all(): readonly TimeMark[] {
    return this.marks;
  }

  /** Video position at wall time t, or null when paused / before playback / unknown. */
  at(t: number): number | null {
    const m = this.marks;
    if (!m.length || t < m[0]!.t) return null;
    let lo = 0;
    let hi = m.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (m[mid]!.t <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = m[lo]!;
    if (!a.playing) return null;
    const est = a.c + (t - a.t) / 1000;
    const b = m[lo + 1];
    // Never run past the next mark's position (a seek or a stall) when interpolating.
    if (b && b.c >= a.c) return Math.min(est, b.c);
    return est;
  }
}

/** Playing stretches as wall-time intervals (what counts as "watching" in a video review). */
export function playingIntervals(marks: readonly TimeMark[], end: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (const m of marks) {
    if (m.playing && open === null) open = m.t;
    if (!m.playing && open !== null) {
      out.push({ start: open, end: m.t });
      open = null;
    }
  }
  if (open !== null && end > open) out.push({ start: open, end });
  return out;
}
