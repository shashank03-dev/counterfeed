/** Wall-clock microseconds since the Unix epoch, sub-millisecond resolution, same domain as SDK timestamps. */
export function nowUs(): number {
  return Math.round((performance.timeOrigin + performance.now()) * 1000);
}

/** "04:32" */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
