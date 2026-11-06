import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMsg } from '@together/shared';
import { startSignalServer, type SignalServer } from '../src/server.ts';

let server: SignalServer | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await server?.close();
  server = null;
});

/** A test client that queues every server message so tests can await them in order. */
async function client(url: string) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const queue: ServerMsg[] = [];
  const waiters: ((m: ServerMsg) => void)[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  await new Promise((r) => ws.once('open', r));
  return {
    ws,
    send: (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    next: (ms = 1000) =>
      new Promise<ServerMsg>((resolve, reject) => {
        const q = queue.shift();
        if (q) return resolve(q);
        const t = setTimeout(() => reject(new Error('timeout waiting for server message')), ms);
        waiters.push((m) => {
          clearTimeout(t);
          resolve(m);
        });
      }),
    silent: async (ms = 150) => {
      await new Promise((r) => setTimeout(r, ms));
      return queue.length === 0;
    },
  };
}

async function room(s: SignalServer) {
  const host = await client(s.url);
  host.send({ type: 'create' });
  const created = await host.next();
  if (created.type !== 'created') throw new Error('not created');
  const guest = await client(s.url);
  guest.send({ type: 'join', code: created.code });
  const joined = await guest.next();
  expect(await host.next()).toEqual({ type: 'peer-joined' });
  return { host, guest, code: created.code, hostToken: created.token, guestToken: (joined as { token: string }).token };
}

describe('signaling server', () => {
  it('creates a WORD-00 room, lets one guest join and relays offer/answer/ice both ways', async () => {
    server = await startSignalServer();
    const { host, guest, code } = await room(server);
    expect(code).toMatch(/^[A-Z]{3,5}-\d{2}$/);
    host.send({ type: 'offer', sdp: 'v=0 offer' });
    expect(await guest.next()).toEqual({ type: 'offer', sdp: 'v=0 offer' });
    guest.send({ type: 'answer', sdp: 'v=0 answer' });
    expect(await host.next()).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    const cand = { candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    guest.send({ type: 'ice', candidate: cand });
    expect(await host.next()).toEqual({ type: 'ice', candidate: cand });
    host.send({ type: 'ice', candidate: null });
    expect(await guest.next()).toEqual({ type: 'ice', candidate: null });
  });

  it('holds at most two people', async () => {
    server = await startSignalServer();
    const { code } = await room(server);
    const third = await client(server.url);
    third.send({ type: 'join', code });
    expect(await third.next()).toEqual({ type: 'error', code: 'room-full' });
  });

  it('rejects unknown rooms, malformed and non-relay messages, and relaying outside a room', async () => {
    server = await startSignalServer();
    const c = await client(server.url);
    c.send({ type: 'join', code: 'TIDE-99' });
    expect(await c.next()).toEqual({ type: 'error', code: 'room-not-found' });
    c.send('{garbage');
    expect(await c.next()).toEqual({ type: 'error', code: 'bad-message' });
    c.send({ type: 'chat', text: 'hello' });
    expect(await c.next()).toEqual({ type: 'error', code: 'bad-message' });
    c.send({ type: 'offer', sdp: 'v=0' });
    expect(await c.next()).toEqual({ type: 'error', code: 'not-in-room' });
  });

  it('drops oversized frames at the socket (maxPayload)', async () => {
    server = await startSignalServer();
    const c = await client(server.url);
    const closed = new Promise<number>((r) => c.ws.once('close', (code) => r(code)));
    c.send({ type: 'offer', sdp: 'x'.repeat(64 * 1024) });
    expect(await closed).toBe(1009); // message too big
  });

  it('rate-limits create/join per IP so codes cannot be brute-forced', async () => {
    server = await startSignalServer({ joinLimit: { max: 5, windowMs: 60_000 } });
    const c = await client(server.url);
    const results: string[] = [];
    for (let i = 0; i < 8; i++) {
      c.send({ type: 'join', code: `TIDE-${String(i).padStart(2, '0')}` });
      const m = await c.next();
      results.push(m.type === 'error' ? m.code : m.type);
    }
    expect(results.slice(0, 5).every((r) => r === 'room-not-found')).toBe(true);
    expect(results.slice(5)).toEqual(['rate-limited', 'rate-limited', 'rate-limited']);
  });

  it('the rate limit window slides: attempts are allowed again after it passes', async () => {
    let now = 0;
    server = await startSignalServer({ joinLimit: { max: 2, windowMs: 10_000 }, now: () => now });
    const c = await client(server.url);
    for (let i = 0; i < 3; i++) c.send({ type: 'join', code: 'TIDE-01' });
    expect((await c.next()).type).toBe('error');
    expect((await c.next()).type).toBe('error');
    expect(await c.next()).toEqual({ type: 'error', code: 'rate-limited' });
    now = 10_001;
    c.send({ type: 'join', code: 'TIDE-01' });
    expect(await c.next()).toEqual({ type: 'error', code: 'room-not-found' });
  });

  it('expires rooms after 10 minutes idle and tells whoever is still there', async () => {
    let now = 0;
    server = await startSignalServer({ now: () => now, sweepMs: 60_000 });
    const { host, guest, code } = await room(server);
    now = 9 * 60_000;
    host.send({ type: 'ice', candidate: null }); // activity resets the idle clock
    await guest.next();
    now = 18 * 60_000;
    server.sweep();
    expect(server.stats().rooms).toBe(1);
    now = 19 * 60_000 + 1;
    server.sweep();
    expect(await host.next()).toEqual({ type: 'error', code: 'expired' });
    expect(await guest.next()).toEqual({ type: 'error', code: 'expired' });
    expect(server.stats().rooms).toBe(0);
    const late = await client(server.url);
    late.send({ type: 'join', code });
    expect(await late.next()).toEqual({ type: 'error', code: 'room-not-found' });
  });

  it('a dropped connection keeps its seat: the other side hears peer-away, then peer-back on rejoin', async () => {
    server = await startSignalServer();
    const { host, guest, code, guestToken } = await room(server);
    guest.ws.terminate();
    expect(await host.next()).toEqual({ type: 'peer-away' });
    const back = await client(server.url);
    back.send({ type: 'rejoin', code, token: guestToken });
    expect(await back.next()).toEqual({ type: 'rejoined', code, peerPresent: true });
    expect(await host.next()).toEqual({ type: 'peer-back' });
    host.send({ type: 'offer', sdp: 'restart' });
    expect(await back.next()).toEqual({ type: 'offer', sdp: 'restart' });
  });

  it('rejoin with a wrong token is refused (seats cannot be stolen)', async () => {
    server = await startSignalServer();
    const { code } = await room(server);
    const thief = await client(server.url);
    thief.send({ type: 'rejoin', code, token: 'A'.repeat(24) });
    expect(await thief.next()).toEqual({ type: 'error', code: 'expired' });
  });

  it('leave frees the seat, tells the other side, and the empty room is deleted', async () => {
    server = await startSignalServer();
    const { host, guest, code } = await room(server);
    guest.send({ type: 'leave' });
    expect(await host.next()).toEqual({ type: 'leave' });
    const newcomer = await client(server.url);
    newcomer.send({ type: 'join', code });
    expect((await newcomer.next()).type).toBe('joined');
    await host.next(); // peer-joined
    host.send({ type: 'leave' });
    newcomer.send({ type: 'leave' });
    await new Promise((r) => setTimeout(r, 50));
    expect(server.stats().rooms).toBe(0);
  });

  it('never logs payloads, codes or tokens', async () => {
    const lines: string[] = [];
    server = await startSignalServer({ log: (e, f) => lines.push(e + ' ' + JSON.stringify(f ?? {})) });
    const { host, guest, code, hostToken } = await room(server);
    host.send({ type: 'offer', sdp: 'v=0 SECRET-SDP 10.1.2.3' });
    await guest.next();
    guest.send({ type: 'ice', candidate: { candidate: 'candidate:9 1 udp 1 192.168.7.7 4444 typ host' } });
    await host.next();
    const all = lines.join('\n');
    for (const secret of ['SECRET-SDP', '10.1.2.3', '192.168.7.7', code, hostToken, '127.0.0.1']) expect(all).not.toContain(secret);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('serves /health for deploys', async () => {
    server = await startSignalServer();
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, rooms: 0 });
  });

  it('handles 200 rooms concurrently with sub-50 ms median relay latency', async () => {
    server = await startSignalServer({ joinLimit: { max: 10_000, windowMs: 60_000 } });
    // Connect in batches: 400 simultaneous connects overflow macOS's default listen backlog (128).
    const pairs: Awaited<ReturnType<typeof room>>[] = [];
    for (let b = 0; b < 10; b++) pairs.push(...(await Promise.all(Array.from({ length: 20 }, () => room(server!)))));
    const t0 = performance.now();
    const lat: number[] = [];
    await Promise.all(
      pairs.map(async ({ host, guest }) => {
        const s = performance.now();
        host.send({ type: 'offer', sdp: 'v=0' });
        await guest.next(3000);
        lat.push(performance.now() - s);
      }),
    );
    lat.sort((a, b) => a - b);
    expect(server.stats().rooms).toBe(200);
    expect(lat[100]).toBeLessThan(50);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('startup failure', () => {
  it('rejects (instead of hanging or throwing uncaught) when the port is taken', async () => {
    const a = await startSignalServer({ port: 0, host: '127.0.0.1' });
    try {
      const t0 = Date.now();
      await expect(startSignalServer({ port: a.port, host: '127.0.0.1' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      await a.close();
    }
  });
});
