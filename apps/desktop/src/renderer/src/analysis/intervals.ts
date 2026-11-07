/** Half-open time intervals [start, end) in microseconds. Pure helpers, unit-tested. */
export interface Interval {
  start: number;
  end: number;
}

export const len = (i: Interval) => Math.max(0, i.end - i.start);
export const total = (list: Interval[]) => list.reduce((s, i) => s + len(i), 0);

/** Sorted, non-overlapping union. Intervals closer than `gap` are joined. */
export function merge(list: Interval[], gap = 0): Interval[] {
  const s = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end + gap) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** a ∩ b for two sorted, merged lists. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i]!.start, b[j]!.start);
    const e = Math.min(a[i]!.end, b[j]!.end);
    if (e > s) out.push({ start: s, end: e });
    if (a[i]!.end < b[j]!.end) i++;
    else j++;
  }
  return out;
}

/** a minus b for two sorted, merged lists. */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    let cur = x.start;
    for (const y of b) {
      if (y.end <= cur || y.start >= x.end) continue;
      if (y.start > cur) out.push({ start: cur, end: y.start });
      cur = Math.max(cur, y.end);
      if (cur >= x.end) break;
    }
    if (cur < x.end) out.push({ start: cur, end: x.end });
  }
  return out;
}

/** Shrink every interval by `us` at both ends (dropping any that vanish): a margin after the view comes back. */
export function erode(list: Interval[], us: number): Interval[] {
  return merge(list)
    .map((i) => ({ start: i.start + us, end: i.end - us }))
    .filter((i) => i.end > i.start);
}

export function contains(list: Interval[], t: number): boolean {
  return list.some((i) => t >= i.start && t < i.end);
}

/** Overlap (us) of [s, e) with a sorted list. */
export function overlap(list: Interval[], s: number, e: number): number {
  let o = 0;
  for (const i of list) {
    if (i.start >= e) break;
    o += Math.max(0, Math.min(e, i.end) - Math.max(s, i.start));
  }
  return o;
}

/** Time from `from` to `t` that falls inside `list` (e.g. active watching time before an event). */
export function elapsedWithin(list: Interval[], from: number, t: number): number {
  return overlap(list, from, t);
}
