import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ensureLocalSignal, isLocalSignalUrl, isTogetherServer, SignalManager } from '../../src/main/signal';

async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

/** Open a socket, create a room, return the code (proves the server really relays, not just listens). */
async function createRoom(port: number): Promise<string> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
  ws.send(JSON.stringify({ type: 'create' }));
  const msg = await new Promise<{ type: string; code?: string }>((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
  ws.close();
  expect(msg.type).toBe('created');
  return msg.code!;
}

describe('embedded signaling server', () => {
  it('only manages plain ws:// URLs on this machine', () => {
    expect(isLocalSignalUrl('ws://localhost:8787')).toEqual({ port: 8787 });
    expect(isLocalSignalUrl('ws://127.0.0.1:9000')).toEqual({ port: 9000 });
    expect(isLocalSignalUrl('wss://localhost:8787')).toBeNull();
    expect(isLocalSignalUrl('ws://192.168.1.4:8787')).toBeNull();
    expect(isLocalSignalUrl('nonsense')).toBeNull();
  });

  it('starts a working server on a free local port and reports LAN addresses', async () => {
    const port = await freePort();
    const s = await ensureLocalSignal(`ws://localhost:${port}`, { host: '127.0.0.1' });
    try {
      expect(s.host.mode).toBe('embedded');
      expect(s.host.port).toBe(port);
      expect(Array.isArray(s.host.lan)).toBe(true);
      expect(await isTogetherServer(port)).toBe(true);
      expect(await createRoom(port)).toMatch(/^[A-Z]+-\d{2}$/);
    } finally {
      await s.close();
    }
    expect(await isTogetherServer(port, 300)).toBe(false); // closed cleanly, port released
  });

  it('shares a Together server that already owns the port (second instance, or npm run signal)', async () => {
    const port = await freePort();
    const first = await ensureLocalSignal(`ws://localhost:${port}`, { host: '127.0.0.1' });
    const second = await ensureLocalSignal(`ws://localhost:${port}`, { host: '127.0.0.1' });
    expect(second.host.mode).toBe('shared');
    await second.close(); // must not close the owner's server
    expect(await isTogetherServer(port)).toBe(true);
    await first.close();
  });

  it('reports a port taken by something else instead of pretending', async () => {
    const other = createServer((_q, r) => r.end('not together'));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const port = (other.address() as AddressInfo).port;
    try {
      const s = await ensureLocalSignal(`ws://localhost:${port}`, { host: '127.0.0.1' });
      expect(s.host).toMatchObject({ mode: 'failed', reason: 'port-in-use' });
    } finally {
      await new Promise((r) => other.close(r));
    }
  });

  it('leaves remote servers alone', async () => {
    const s = await ensureLocalSignal('wss://signal.example.com');
    expect(s.host).toEqual({ mode: 'remote', port: null, lan: [] });
  });

  it('manager follows URL changes: closes the old server, starts the new one', async () => {
    const [a, b] = [await freePort(), await freePort()];
    const m = new SignalManager();
    expect((await m.sync(`ws://localhost:${a}`)).mode).toBe('embedded');
    expect((await m.sync(`ws://localhost:${a}`)).mode).toBe('embedded'); // idempotent
    expect((await m.sync(`ws://localhost:${b}`)).mode).toBe('embedded');
    expect(await isTogetherServer(a, 300)).toBe(false);
    expect(await isTogetherServer(b)).toBe(true);
    await m.close();
    expect(await isTogetherServer(b, 300)).toBe(false);
  });
});
