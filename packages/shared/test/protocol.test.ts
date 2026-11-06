import { describe, expect, it } from 'vitest';
import { makeRoomCode, MAX_MSG_BYTES, normalizeRoomCode, parseClientMsg, parseMsg, parseServerMsg, ROOM_CODE_RE, ROOM_WORDS, SessionRecordSchema } from '../src/index.ts';

const ok = (m: unknown) => parseMsg(JSON.stringify(m));

describe('data channel protocol', () => {
  it('accepts every well-formed message type', () => {
    const valid = [
      { type: 'hello', appVersion: '1.0.0', sharing: { expressions: false } },
      { type: 'hello', appVersion: '1.0.0', sharing: { expressions: true }, replay: { recordedAt: 1 }, video: false },
      { type: 'ping', id: 1, t0: 1_731_000_000_000_000 },
      { type: 'pong', id: 1, t0: 1, t1: 2, t2: 3 },
      { type: 'sig', frames: [{ t: 1, trace: -0.4, traceStable: true }, { t: 2, pulse: 71, pulseConf: 60 }, { t: 3, talking: true }] },
      { type: 'phase', name: 'together', startAt: 5, elapsedMs: 1000 },
      { type: 'phase', name: 'apart', startAt: 5, durationMs: 60_000 },
      { type: 'ready', phase: 'lobby', ready: true },
      { type: 'mood', when: 'start', label: 'Calm' },
      { type: 'moment', moment: { id: 'm-1', t: 1, atMs: 272000, kind: 'smile', peak: 84, pulseDelta: 9 } },
      { type: 'bye' },
      { type: 'bye', reason: 'ended' },
    ];
    for (const m of valid) expect(ok(m), JSON.stringify(m)).toEqual(m);
  });

  it('rejects malformed messages', () => {
    const bad: unknown[] = [
      null,
      42,
      'hello',
      {},
      { type: 'nope' },
      { type: 'ping', id: -1, t0: 1 },
      { type: 'ping', id: 1.5, t0: 1 },
      { type: 'ping', id: 1, t0: 'now' },
      { type: 'sig', frames: [{ t: 1, trace: 'x' }] },
      { type: 'sig', frames: [{ t: -5 }] },
      { type: 'sig', frames: [{ t: 1, pulse: 900 }] },
      { type: 'sig', frames: [{ t: 1, pulseConf: 101 }] },
      { type: 'sig', frames: [{ t: 1, video: 'base64...' }] }, // unknown fields are rejected: only derived numbers cross the wire
      { type: 'sig', frames: Array.from({ length: 241 }, (_, i) => ({ t: i })) },
      { type: 'phase', name: 'party', startAt: 1 },
      { type: 'phase', name: 'apart', startAt: 1, durationMs: 0 },
      { type: 'phase', name: 'apart', startAt: 1, durationMs: 4_000_000 },
      { type: 'mood', when: 'start', label: 'Ecstatic' },
      { type: 'moment', moment: { id: 'x', t: 1, atMs: 1, kind: 'anger', peak: 50, pulseDelta: null } },
      { type: 'hello', appVersion: '1', sharing: {} },
      { type: 'hello', appVersion: '1', sharing: { expressions: false }, extra: true },
      { type: 'bye', reason: 'because' },
    ];
    for (const m of bad) expect(ok(m), JSON.stringify(m)).toBeNull();
    expect(parseMsg('{not json')).toBeNull();
    expect(parseMsg('x'.repeat(MAX_MSG_BYTES + 1))).toBeNull();
  });

  it('a full 10 Hz batch with 30 Hz frames is far under the size limit', () => {
    const frames = Array.from({ length: 6 }, (_, i) => ({ t: 1_731_000_000_000_000 + i * 33_333, trace: -0.123456789, traceStable: true, pulse: 72.3, pulseConf: 61.2, talking: false }));
    const bytes = JSON.stringify({ type: 'sig', frames }).length;
    expect(bytes).toBeLessThan(800);
    expect(ok({ type: 'sig', frames })).not.toBeNull();
  });
});

describe('signaling protocol', () => {
  it('relays only offer, answer, ice, leave and room control', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'create' }))).toEqual({ type: 'create' });
    expect(parseClientMsg(JSON.stringify({ type: 'join', code: 'TIDE-42' }))).toEqual({ type: 'join', code: 'TIDE-42' });
    expect(parseClientMsg(JSON.stringify({ type: 'offer', sdp: 'v=0' }))).not.toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: 'ice', candidate: null }))).not.toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: 'ice', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } }))).not.toBeNull();
    for (const bad of [{ type: 'join', code: 'tide-42' }, { type: 'join', code: 'TIDE42' }, { type: 'chat', text: 'hi' }, { type: 'offer', sdp: '' }, { type: 'offer', sdp: 'x'.repeat(40_000) }, { type: 'rejoin', code: 'TIDE-42', token: 'short' }]) {
      expect(parseClientMsg(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(parseServerMsg(JSON.stringify({ type: 'error', code: 'room-full' }))).not.toBeNull();
    expect(parseServerMsg(JSON.stringify({ type: 'error', code: 'oops' }))).toBeNull();
  });
});

describe('room codes', () => {
  it('generated codes are WORD-00 and normalise from casual typing', () => {
    for (let i = 0; i < 500; i++) expect(makeRoomCode()).toMatch(ROOM_CODE_RE);
    expect(normalizeRoomCode(' tide 42 ')).toBe('TIDE-42');
    expect(normalizeRoomCode('Moss-07')).toBe('MOSS-07');
    expect(normalizeRoomCode('moss_7')).toBeNull();
    expect(normalizeRoomCode('ZZZZ-11')).toBeNull(); // not a room word
    expect(new Set(ROOM_WORDS).size).toBe(ROOM_WORDS.length);
  });
});

describe('session record', () => {
  it('rejects records with out-of-range or extra fields', () => {
    const base = {
      id: 's-abcdef12', version: 1, startedAt: 1, endedAt: 2, role: 'host', replay: null, partial: false, apart: null, together: null,
      breathingRate: { you: 14, partner: null }, pulse: { you: 70, partner: 66 },
      moods: { you: { start: 'Calm', end: null }, partner: { start: null, end: null } }, moments: [], sharedWithMe: [],
    };
    expect(SessionRecordSchema.safeParse(base).success).toBe(true);
    expect(SessionRecordSchema.safeParse({ ...base, id: '../../etc' }).success).toBe(false);
    expect(SessionRecordSchema.safeParse({ ...base, video: 'x' }).success).toBe(false);
    expect(SessionRecordSchema.safeParse({ ...base, together: { plv: 1.2 } }).success).toBe(false);
  });
});
