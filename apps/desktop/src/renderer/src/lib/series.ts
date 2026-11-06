/**
 * Fixed-capacity time series backed by typed arrays (no per-sample allocation, so a 30 Hz stream for a
 * whole session never churns the GC). Samples must arrive in time order; late ones are dropped.
 */
export class Series {
  readonly t: Float64Array;
  readonly v: Float64Array;
  /** Bit flags per sample (meaning is up to the owner). */
  readonly f: Uint8Array;
  private head = 0;
  private len = 0;

  constructor(readonly capacity: number) {
    this.t = new Float64Array(capacity);
    this.v = new Float64Array(capacity);
    this.f = new Uint8Array(capacity);
  }

  get length() {
    return this.len;
  }

  push(t: number, v: number, flags = 0): boolean {
    if (this.len && t <= this.lastT) return false;
    const i = (this.head + this.len) % this.capacity;
    this.t[i] = t;
    this.v[i] = v;
    this.f[i] = flags;
    if (this.len < this.capacity) this.len++;
    else this.head = (this.head + 1) % this.capacity;
    return true;
  }

  private idx(k: number) {
    return (this.head + k) % this.capacity;
  }

  get lastT(): number {
    return this.len ? this.t[this.idx(this.len - 1)]! : -Infinity;
  }
  get firstT(): number {
    return this.len ? this.t[this.head]! : Infinity;
  }
  at(k: number): { t: number; v: number; f: number } {
    const i = this.idx(k);
    return { t: this.t[i]!, v: this.v[i]!, f: this.f[i]! };
  }
  tAt(k: number) {
    return this.t[this.idx(k)]!;
  }
  vAt(k: number) {
    return this.v[this.idx(k)]!;
  }
  fAt(k: number) {
    return this.f[this.idx(k)]!;
  }

  /** First index with t >= time (binary search). */
  lowerBound(time: number): number {
    let lo = 0;
    let hi = this.len;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tAt(mid) < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Copy of the samples in [from, to] as plain arrays. */
  slice(from = -Infinity, to = Infinity): { t: number[]; v: number[]; f: number[] } {
    const out = { t: [] as number[], v: [] as number[], f: [] as number[] };
    for (let k = this.lowerBound(from); k < this.len; k++) {
      const t = this.tAt(k);
      if (t > to) break;
      out.t.push(t);
      out.v.push(this.vAt(k));
      out.f.push(this.fAt(k));
    }
    return out;
  }

  clear() {
    this.head = 0;
    this.len = 0;
  }
}
