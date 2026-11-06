import { describe, expect, it } from 'vitest';
import { elapsed, initial, reduce, remaining, RECONNECT_MS, SHORT, TIMED, type Ctx, type Event } from '../../src/renderer/src/session/machine';

const run = (events: Event[], from: Ctx = initial()) => events.reduce(reduce, from);
const toLobby: Event[] = [{ type: 'BEGIN', intent: { kind: 'create' } }, { type: 'CONSENT', accepted: true }, { type: 'CONNECTED', role: 'host' }, { type: 'PEER_JOINED' }];

describe('session state machine', () => {
  it('walks the whole happy path in order', () => {
    let c = run(toLobby);
    expect(c.state).toBe('lobby');
    const seen: string[] = [c.state];
    let t = 1000;
    for (const name of ['call', 'moodStart', 'apart', 'together', 'moodEnd', 'results'] as const) {
      c = reduce(c, { type: 'SCHEDULE', name, at: t });
      c = reduce(c, { type: 'TICK', now: t });
      seen.push(c.state);
      t += 1000;
    }
    expect(seen).toEqual(['lobby', 'call', 'moodStart', 'apart', 'together', 'moodEnd', 'results']);
    expect(c.endReason).toBe('finished');
    c = reduce(c, { type: 'END', reason: 'you-ended', now: t });
    expect(c.state).toBe('ended');
    expect(c.partial).toBe(false);
  });

  it('declining consent goes back to idle and nothing connects', () => {
    const c = run([{ type: 'BEGIN', intent: { kind: 'join', code: 'TIDE-42' } }, { type: 'CONSENT', accepted: false }]);
    expect(c.state).toBe('idle');
  });

  it('switches exactly at startAt, not before', () => {
    let c = run(toLobby);
    c = reduce(c, { type: 'SCHEDULE', name: 'call', at: 5000 });
    expect(reduce(c, { type: 'TICK', now: 4999 }).state).toBe('lobby');
    expect(reduce(c, { type: 'TICK', now: 5000 }).state).toBe('call');
  });

  it('never goes backwards and ignores phases before the lobby', () => {
    let c = run([...toLobby, { type: 'SCHEDULE', name: 'call', at: 0 }, { type: 'TICK', now: 0 }]);
    c = reduce(c, { type: 'SCHEDULE', name: 'lobby', at: 10 });
    expect(c.scheduled).toBeNull();
    const pre = run([{ type: 'BEGIN', intent: { kind: 'create' } }, { type: 'SCHEDULE', name: 'apart', at: 0 }]);
    expect(pre.state).toBe('consent');
  });

  it('times apart (2:00) and together (3:00), scaled for tests', () => {
    let c = run([...toLobby, { type: 'SCHEDULE', name: 'apart', at: 0 }, { type: 'TICK', now: 0 }]);
    expect(remaining(c, 30_000)).toBe(90_000);
    c = run([...toLobby, { type: 'SCHEDULE', name: 'together', at: 0 }, { type: 'TICK', now: 0 }]);
    expect(remaining(c, 0)).toBe(180_000);
    const fast = run([{ type: 'BEGIN', intent: { kind: 'create' }, phaseScale: 0.1 }, ...toLobby.slice(1), { type: 'SCHEDULE', name: 'together', at: 0 }, { type: 'TICK', now: 0 }]);
    expect(remaining(fast, 0)).toBe(18_000);
  });

  it('peer drop pauses the timer; the host resume continues from the elapsed time', () => {
    let c = run([...toLobby, { type: 'SCHEDULE', name: 'together', at: 0 }, { type: 'TICK', now: 0 }]);
    c = reduce(c, { type: 'PEER_LOST', now: 60_000 });
    expect(c.reconnectBy).toBe(60_000 + RECONNECT_MS);
    expect(remaining(c, 70_000)).toBe(120_000); // frozen
    c = reduce(c, { type: 'PEER_BACK', now: 70_000 });
    expect(c.reconnectBy).toBeNull();
    c = reduce(c, { type: 'SCHEDULE', name: 'together', at: 72_000, elapsedMs: 60_000 });
    c = reduce(c, { type: 'TICK', now: 72_000 });
    expect(c.state).toBe('together');
    expect(elapsed(c, 72_000)).toBe(60_000);
    expect(remaining(c, 82_000)).toBe(110_000);
  });

  it('after the 20 s reconnect window the session ends and keeps partial results', () => {
    let c = run([...toLobby, { type: 'SCHEDULE', name: 'apart', at: 0 }, { type: 'TICK', now: 0 }]);
    c = reduce(c, { type: 'PEER_LOST', now: 50_000 });
    expect(reduce(c, { type: 'TICK', now: 50_000 + RECONNECT_MS - 1 }).state).toBe('apart');
    c = reduce(c, { type: 'TICK', now: 50_000 + RECONNECT_MS });
    expect(c.state).toBe('ended');
    expect(c.endReason).toBe('partner-lost');
    expect(c.partial).toBe(true);
    expect(c.reached).toContain('apart');
  });

  it('a scheduled switch waits while the partner is away', () => {
    let c = run([...toLobby, { type: 'SCHEDULE', name: 'call', at: 0 }, { type: 'TICK', now: 0 }]);
    c = reduce(c, { type: 'PEER_LOST', now: 1 });
    c = reduce(c, { type: 'SCHEDULE', name: 'moodStart', at: 2 });
    expect(reduce(c, { type: 'TICK', now: 5 }).state).toBe('call');
  });

  it('End from anywhere: before connecting resets, during the call ends', () => {
    expect(run([{ type: 'BEGIN', intent: { kind: 'create' } }, { type: 'END', reason: 'you-ended', now: 0 }]).state).toBe('idle');
    const c = run([...toLobby, { type: 'SCHEDULE', name: 'call', at: 0 }, { type: 'TICK', now: 0 }, { type: 'END', reason: 'partner-ended', now: 1 }]);
    expect(c.state).toBe('ended');
    expect(c.endReason).toBe('partner-ended');
    expect(c.partial).toBe(true);
  });

  it('practice (replay) sessions advance without a live partner', () => {
    let c = run([{ type: 'BEGIN', intent: { kind: 'practice', recordingId: 'rec-abc12345' } }, { type: 'CONSENT', accepted: true }, { type: 'CONNECTED', role: 'practice' }, { type: 'PEER_JOINED' }]);
    c = reduce(c, { type: 'PEER_LOST', now: 0 });
    c = reduce(c, { type: 'SCHEDULE', name: 'call', at: 1 });
    expect(reduce(c, { type: 'TICK', now: 1 }).state).toBe('call');
  });

  it('Short sessions run 1 min apart and 1.5 min together, and record what ran', () => {
    let c = run([{ type: 'BEGIN', intent: { kind: 'create', length: 'short' } }, ...toLobby.slice(1)]);
    expect(c.length).toBe('short');
    for (const [name, t] of [['call', 10], ['moodStart', 20], ['apart', 30]] as const) c = run([{ type: 'SCHEDULE', name, at: t }, { type: 'TICK', now: t }], c);
    expect(remaining(c, 30)).toBe(SHORT.apart);
    c = run([{ type: 'SCHEDULE', name: 'together', at: 100_000 }, { type: 'TICK', now: 100_000 }], c);
    expect(remaining(c, 100_000)).toBe(SHORT.together);
    expect(c.durations).toEqual({ apart: 60_000, together: 90_000 });
  });

  it('a guest follows the duration the host sends, whatever its own default', () => {
    let c = run([{ type: 'BEGIN', intent: { kind: 'join', code: 'TIDE-42' } }, { type: 'CONSENT', accepted: true }, { type: 'CONNECTED', role: 'guest' }, { type: 'PEER_JOINED' }]);
    expect(c.length).toBe('full');
    c = run([{ type: 'SCHEDULE', name: 'apart', at: 50, durationMs: 60_000 }, { type: 'TICK', now: 50 }], c);
    expect(remaining(c, 50)).toBe(60_000);
    // Without a duration (an older host) it falls back to Full.
    c = run([{ type: 'SCHEDULE', name: 'together', at: 70_000 }, { type: 'TICK', now: 70_000 }], c);
    expect(remaining(c, 70_000)).toBe(TIMED.together);
  });
});
