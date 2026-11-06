import type { MsgOf } from '@together/shared';
import { median } from '../lib/stats';
import { nowUs } from '../lib/time';

/**
 * NTP-style clock offset between two machines over the data channel.
 *   local sends ping{t0}; partner stamps t1 on receipt and t2 on reply; local stamps t3.
 *   rtt    = (t3 - t0) - (t2 - t1)
 *   offset = ((t1 - t0) + (t2 - t3)) / 2      (partner clock - local clock)
 * 10 rounds; the lowest-RTT third are the least queued, so the median of their offsets is used.
 * Within that third, rounds whose RTT is far above the best one (a queueing spike that slipped in when
 * few rounds were clean) are dropped too: rtt <= 2 x min + 10 ms.
 */
export interface ClockSample {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}
export interface ClockEstimate {
  /** partnerClock - localClock, microseconds. */
  offsetUs: number;
  rttUs: number;
  samples: number;
}

export function estimateOffset(samples: ClockSample[]): ClockEstimate | null {
  const rows = samples
    .map((s) => ({ rtt: s.t3 - s.t0 - (s.t2 - s.t1), offset: (s.t1 - s.t0 + (s.t2 - s.t3)) / 2 }))
    .filter((r) => Number.isFinite(r.rtt) && Number.isFinite(r.offset) && r.rtt >= 0);
  if (!rows.length) return null;
  rows.sort((a, b) => a.rtt - b.rtt);
  const minRtt = rows[0]!.rtt;
  const best = rows.slice(0, Math.max(1, Math.ceil(rows.length / 3))).filter((r) => r.rtt <= 2 * minRtt + 10_000);
  return { offsetUs: median(best.map((r) => r.offset)), rttUs: median(best.map((r) => r.rtt)), samples: rows.length };
}

type Send = (m: MsgOf<'ping'> | MsgOf<'pong'>) => void;

export class ClockSync {
  private nextId = 1;
  private pending = new Map<number, (s: ClockSample) => void>();
  estimate: ClockEstimate | null = null;

  constructor(
    private readonly send: Send,
    private readonly now: () => number = nowUs,
  ) {}

  /** Answer the partner's pings and collect answers to ours. */
  handle(msg: MsgOf<'ping'> | MsgOf<'pong'>) {
    if (msg.type === 'ping') {
      const t1 = this.now();
      this.send({ type: 'pong', id: msg.id, t0: msg.t0, t1, t2: this.now() });
      return;
    }
    const done = this.pending.get(msg.id);
    if (done) {
      this.pending.delete(msg.id);
      done({ t0: msg.t0, t1: msg.t1, t2: msg.t2, t3: this.now() });
    }
  }

  private round(timeoutMs: number): Promise<ClockSample | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, (s) => {
        clearTimeout(timer);
        resolve(s);
      });
      this.send({ type: 'ping', id, t0: this.now() });
    });
  }

  /** Run `rounds` sequential ping/pongs and update the estimate. */
  async measure(rounds = 10, gapMs = 60, timeoutMs = 2000): Promise<ClockEstimate | null> {
    const samples: ClockSample[] = [];
    for (let i = 0; i < rounds; i++) {
      const s = await this.round(timeoutMs);
      if (s) samples.push(s);
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    }
    const est = estimateOffset(samples);
    if (est) this.estimate = est;
    return est;
  }

  dispose() {
    this.pending.clear();
  }
}
