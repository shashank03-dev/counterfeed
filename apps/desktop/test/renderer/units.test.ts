import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Msg, PhaseResult, SignalFrame } from '@together/shared';
import { Series } from '../../src/renderer/src/lib/series';
import { parseRecording, RecordingPlayer } from '../../src/renderer/src/link/recording';
import { ReplayPeer } from '../../src/renderer/src/link/ReplayPeer';
import { RemotePeer } from '../../src/renderer/src/link/RemotePeer';
import { applyValidation, V } from '../../src/renderer/src/sensing/quality';
import { bandpass } from '../../src/renderer/src/sync/filter';
import { estimateRate } from '../../src/renderer/src/sync/rate';
import { MIN_SURROGATES, verdict } from '../../src/renderer/src/ui/format';
import { breathing, FS } from './helpers';

describe('breathing rate estimate (both people, same method)', () => {
  it('recovers 6, 12, 15, 24 and 36 breaths/min within 0.5 from realistic traces', () => {
    for (const bpm of [6, 12, 15, 24, 36]) {
      const x = bandpass(breathing(120, bpm, bpm / 60, { jitter: 0.001 }), FS);
      expect(Math.abs(estimateRate(x, FS) - bpm)).toBeLessThan(0.5);
    }
  });
  it('needs 30 s of signal and ignores gaps', () => {
    const x = bandpass(breathing(60, 1, 0.25), FS);
    for (let i = 0; i < 350; i++) x[i] = NaN; // 35 s missing -> 25 s left
    expect(Number.isNaN(estimateRate(x, FS))).toBe(true);
    expect(Number.isNaN(estimateRate(new Float64Array(100), FS))).toBe(true);
  });
});

describe('Series ring buffer', () => {
  it('keeps the newest samples, rejects out-of-order ones, and slices by time', () => {
    const s = new Series(5);
    for (let i = 1; i <= 8; i++) expect(s.push(i * 10, i)).toBe(true);
    expect(s.push(50, 0)).toBe(false); // older than the last sample
    expect(s.length).toBe(5);
    expect(s.firstT).toBe(40);
    expect(s.lastT).toBe(80);
    expect(s.slice(55, 75).v).toEqual([6, 7]);
    expect(s.lowerBound(61)).toBe(3);
  });
});

const header = JSON.stringify({ kind: 'together-recording', version: 1, recordedAt: 1_700_000_000_000_000, appVersion: '1.0.0' });
function recording(seconds: number, marks: Record<string, number> = {}) {
  const base = 1_700_000_000_000_000;
  const lines = [header];
  for (let k = 0; k < seconds * 10; k++) {
    const frames: SignalFrame[] = [0, 1, 2].map((j) => ({ t: base + (k * 3 + j) * 33_333, trace: Math.sin((k * 3 + j) / 20) }));
    lines.push(JSON.stringify({ k: 'sig', frames }));
  }
  for (const [name, s] of Object.entries(marks)) lines.push(JSON.stringify({ k: 'phase', name, t: base + s * 1e6 }));
  return lines.join('\n');
}

describe('recordings', () => {
  it('parse: validates the header, skips bad lines, sorts frames', () => {
    const text = recording(2, { apart: 1 }) + '\n{bad json\n' + JSON.stringify({ k: 'sig', frames: [{ t: 1, pixels: 'x' }] });
    const r = parseRecording(text);
    expect(r.frames).toHaveLength(60);
    expect(r.marks).toEqual([{ name: 'apart', t: 1_700_000_001_000_000 }]);
    expect(() => parseRecording('{"kind":"other"}')).toThrow();
  });

  describe('playback', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('plays frames in real time, re-stamped to the local clock, then ends', () => {
      let now = 5_000_000;
      const got: SignalFrame[] = [];
      let ended = false;
      const p = new RecordingPlayer(parseRecording(recording(3)), () => now, (f) => got.push(...f), () => (ended = true));
      p.start();
      now += 1_000_000;
      vi.advanceTimersByTime(1000);
      // ~1 s of 30 Hz frames, stamped from local time 5 s.
      expect(got.length).toBeGreaterThanOrEqual(29);
      expect(got.length).toBeLessThanOrEqual(31);
      expect(got[0]!.t).toBe(5_000_000);
      expect(ended).toBe(false);
      now += 3_000_000;
      vi.advanceTimersByTime(3000);
      expect(got).toHaveLength(90);
      expect(ended).toBe(true);
      p.stop();
    });

    it('seek aligns the recording’s phase mark with the live phase start', () => {
      let now = 0;
      const got: SignalFrame[] = [];
      const p = new RecordingPlayer(parseRecording(recording(10, { together: 6 })), () => now, (f) => got.push(...f));
      p.start();
      expect(p.seek('together', 2_000_000)).toBe(true);
      now = 2_000_000;
      vi.advanceTimersByTime(100);
      // The frame recorded at the mark (6 s) is now stamped ~2 s local.
      const atMark = got.find((f) => Math.abs(f.t - 2_000_000) < 34_000);
      expect(atMark).toBeDefined();
      expect(p.seek('apart', 0)).toBe(false); // no such mark: keeps playing
      p.stop();
    });

    it('loop: wraps around with strictly rising, evenly spaced timestamps and never ends', () => {
      let now = 0;
      const got: SignalFrame[] = [];
      let ended = false;
      const p = new RecordingPlayer(parseRecording(recording(2)), () => now, (f) => got.push(...f), () => (ended = true));
      p.loop = true;
      p.start();
      for (let i = 0; i < 70; i++) {
        now += 100_000;
        vi.advanceTimersByTime(100);
      }
      // 7 s of a 2 s recording: three wraps, ~210 frames, no repeats or gaps across the seams.
      expect(ended).toBe(false);
      expect(p.loops).toBe(3);
      expect(got.length).toBeGreaterThanOrEqual(205);
      expect(got.length).toBeLessThanOrEqual(211);
      let maxGap = 0;
      for (let i = 1; i < got.length; i++) {
        const d = got[i]!.t - got[i - 1]!.t;
        expect(d).toBeGreaterThan(0);
        maxGap = Math.max(maxGap, d);
      }
      expect(maxGap).toBeLessThanOrEqual(33_334);
      p.stop();
    });

    it('ReplayPeer: labels itself, answers pings on the local clock and is ready when asked', async () => {
      const now = 42_000_000;
      const peer = new ReplayPeer(parseRecording(recording(3)), () => now);
      const got: Msg[] = [];
      peer.onMessage((m) => got.push(m));
      peer.start();
      await Promise.resolve();
      expect(got[0]).toMatchObject({ type: 'hello', replay: { recordedAt: 1_700_000_000_000_000 }, video: false });
      peer.send({ type: 'ping', id: 7, t0: now });
      peer.send({ type: 'ready', phase: 'lobby', ready: true });
      vi.advanceTimersByTime(500);
      expect(got).toContainEqual({ type: 'pong', id: 7, t0: now, t1: now, t2: now });
      expect(got).toContainEqual({ type: 'ready', phase: 'lobby', ready: true });
      peer.close();
      const before = got.length;
      vi.advanceTimersByTime(2000);
      expect(got.length).toBe(before); // nothing after close
    });
  });
});

describe('RemotePeer over a data channel', () => {
  function channel(open = true) {
    const sent: string[] = [];
    const ch = { readyState: open ? 'open' : 'connecting', bufferedAmount: 0, send: (d: string) => sent.push(d), onmessage: null as null | ((e: { data: unknown }) => void) };
    return { ch, sent };
  }
  it('schema-checks everything it receives and counts rejects', () => {
    const { ch } = channel();
    const peer = new RemotePeer(ch as unknown as RTCDataChannel);
    const got: Msg[] = [];
    peer.onMessage((m) => got.push(m));
    ch.onmessage!({ data: JSON.stringify({ type: 'ping', id: 1, t0: 5 }) });
    ch.onmessage!({ data: JSON.stringify({ type: 'sig', frames: [{ t: 1, image: 'AAAA' }] }) });
    ch.onmessage!({ data: new ArrayBuffer(4) });
    expect(got).toEqual([{ type: 'ping', id: 1, t0: 5 }]);
    expect(peer.rejected).toBe(1);
  });
  it('drops stale signal batches when the channel is congested, never control messages', () => {
    const { ch, sent } = channel();
    const peer = new RemotePeer(ch as unknown as RTCDataChannel);
    ch.bufferedAmount = 300 * 1024;
    peer.send({ type: 'sig', frames: [{ t: 1 }] });
    peer.send({ type: 'bye' });
    expect(sent).toEqual([JSON.stringify({ type: 'bye' })]);
    expect(peer.dropped).toBe(1);
  });
  it('sends nothing before the channel opens', () => {
    const { ch, sent } = channel(false);
    new RemotePeer(ch as unknown as RTCDataChannel).send({ type: 'bye' });
    expect(sent).toEqual([]);
  });
});

describe('Lobby checklist from validation codes', () => {
  it('maps each code to the right row and OK clears all rows', () => {
    let q = applyValidation(null, V.tooDark, 'Too dark');
    expect(q).toMatchObject({ light: 'warn', framing: 'unknown', stillness: 'unknown', hint: 'Too dark' });
    q = applyValidation(q, V.excessiveMotion, '');
    expect(q).toMatchObject({ light: 'warn', stillness: 'warn', hint: 'Try to stay still.' });
    q = applyValidation(q, V.tooFar, '');
    expect(q.framing).toBe('warn');
    q = applyValidation(q, V.ok, '');
    expect(q).toMatchObject({ light: 'ok', framing: 'ok', stillness: 'ok', hint: '' });
    expect(applyValidation(null, V.cameraTuning, '').settling).toBe(true);
  });
});

describe('verdict wording is honest', () => {
  const r = (o: Partial<PhaseResult>): PhaseResult => ({ plv: 0.7, windows: 20, coverage: 0.9, chance: { mean: 0.4, p95: 0.55, n: 200 }, ratio: 1.75, percentile: 99, series: [], ...o });
  it('claims "x× above chance" only at >= 95th percentile with enough surrogates', () => {
    expect(verdict(r({})).headline).toBe('1.8× more in step than chance');
    expect(verdict(r({}))).toMatchObject({ strong: true });
    expect(verdict(r({ percentile: 94.9 })).strong).toBe(false);
    expect(verdict(r({ chance: { mean: 0.4, p95: 0.5, n: MIN_SURROGATES - 1 } })).headline).toBe('Too short to compare with chance');
    expect(verdict(r({ percentile: 30, ratio: 0.9 })).detail).toMatch(/no sign of syncing/);
    expect(verdict(null).headline).toMatch(/Not enough/);
  });
});
