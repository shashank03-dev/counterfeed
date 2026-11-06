export function median(values: ArrayLike<number>): number {
  const a = Array.from(values).filter((x) => Number.isFinite(x));
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function mean(values: ArrayLike<number>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) {
      s += v;
      n++;
    }
  }
  return n ? s / n : NaN;
}

export function quantile(values: ArrayLike<number>, q: number): number {
  const a = Array.from(values).filter((x) => Number.isFinite(x));
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo]! + (a[hi]! - a[lo]!) * (pos - lo);
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
