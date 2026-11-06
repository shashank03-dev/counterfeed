import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { makeRoomCode, MAX_SIGNAL_BYTES, parseClientMsg, type ServerMsg, type SignalErrorCode } from '@together/shared';

/**
 * Together's signaling server.
 *
 * - Rooms hold at most two people: the creator ("host", seat 0) and one guest.
 * - Between them it relays exactly four message kinds: offer, answer, ice, leave.
 * - It never logs payloads (SDP, candidates) and keeps nothing on disk.
 * - A room is removed after `roomTtlMs` with no activity (default 10 min).
 * - create/join/rejoin are rate limited per IP so codes can't be brute-forced.
 * - A dropped connection keeps its seat (with a secret token) until the room
 *   expires, so the desktop app can reconnect inside its 20 s window.
 */

export type LogFn = (event: string, fields?: Record<string, number | string | boolean>) => void;

export interface SignalServerOptions {
  port?: number;
  host?: string;
  /** Idle time after which a room is removed. */
  roomTtlMs?: number;
  /** How often expired rooms and dead sockets are swept. */
  sweepMs?: number;
  /** create/join/rejoin attempts allowed per IP per window. */
  joinLimit?: { max: number; windowMs: number };
  /** Hard cap on concurrent rooms (memory guard). */
  maxRooms?: number;
  /** Use the first X-Forwarded-For hop as the client IP (only behind a trusted proxy). */
  trustProxy?: boolean;
  now?: () => number;
  log?: LogFn;
}

interface Seat {
  token: string;
  ws: WebSocket | null;
}
interface Room {
  code: string;
  seats: [Seat | null, Seat | null];
  lastActive: number;
}
interface Conn {
  ip: string;
  room?: Room;
  seat?: 0 | 1;
  alive: boolean;
}

export interface SignalServer {
  port: number;
  url: string;
  close(): Promise<void>;
  /** Counters for tests and the health endpoint. Contains no room codes. */
  stats(): { rooms: number; sockets: number };
  /** Run the expiry sweep now (tests). */
  sweep(): void;
}

const DEFAULTS = {
  roomTtlMs: 10 * 60_000,
  sweepMs: 30_000,
  joinLimit: { max: 20, windowMs: 60_000 },
  maxRooms: 5_000,
};

export async function startSignalServer(opts: SignalServerOptions = {}): Promise<SignalServer> {
  const now = opts.now ?? Date.now;
  const log: LogFn = opts.log ?? (() => {});
  const ttl = opts.roomTtlMs ?? DEFAULTS.roomTtlMs;
  const limit = opts.joinLimit ?? DEFAULTS.joinLimit;
  const maxRooms = opts.maxRooms ?? DEFAULTS.maxRooms;

  const rooms = new Map<string, Room>();
  const conns = new Map<WebSocket, Conn>();
  const attempts = new Map<string, number[]>();

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('Together signaling: connect with a WebSocket.\n');
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_SIGNAL_BYTES });
  // ws re-emits the HTTP server's errors (e.g. EADDRINUSE); without a listener that throw would escape and
  // the start promise below would never settle. Listen errors are handled there; later ones are logged.
  wss.on('error', (e) => log('server.error', { code: (e as NodeJS.ErrnoException).code ?? 'unknown' }));

  const send = (ws: WebSocket | null | undefined, msg: ServerMsg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const fail = (ws: WebSocket, code: SignalErrorCode) => send(ws, { type: 'error', code });
  const other = (c: Conn) => (c.room && c.seat !== undefined ? c.room.seats[c.seat === 0 ? 1 : 0] : null);

  function clientIp(req: IncomingMessage): string {
    if (opts.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  /** Sliding-window limiter. Returns false when the IP is over its budget. */
  function allow(ip: string): boolean {
    const t = now();
    const list = (attempts.get(ip) ?? []).filter((x) => t - x < limit.windowMs);
    if (list.length >= limit.max) {
      attempts.set(ip, list);
      return false;
    }
    list.push(t);
    attempts.set(ip, list);
    return true;
  }

  function newToken() {
    return randomBytes(18).toString('base64url');
  }

  function uniqueCode(): string | null {
    for (let i = 0; i < 64; i++) {
      const code = makeRoomCode(() => randomBytes(4).readUInt32BE() / 0x1_0000_0000);
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  function detach(c: Conn) {
    c.room = undefined;
    c.seat = undefined;
  }

  function removeRoom(room: Room, reason: SignalErrorCode | null) {
    rooms.delete(room.code);
    for (const seat of room.seats) {
      if (!seat?.ws) continue;
      if (reason) fail(seat.ws, reason);
      const c = conns.get(seat.ws);
      if (c) detach(c);
    }
    log('room.closed', { reason: reason ?? 'empty', rooms: rooms.size });
  }

  wss.on('connection', (ws, req) => {
    const conn: Conn = { ip: clientIp(req), alive: true };
    conns.set(ws, conn);
    ws.on('pong', () => (conn.alive = true));

    ws.on('message', (data, isBinary) => {
      if (isBinary) return fail(ws, 'bad-message');
      const msg = parseClientMsg(data.toString());
      if (!msg) return fail(ws, 'bad-message');

      switch (msg.type) {
        case 'create': {
          if (conn.room) return fail(ws, 'bad-message');
          if (!allow(conn.ip)) return fail(ws, 'rate-limited');
          if (rooms.size >= maxRooms) return fail(ws, 'rate-limited');
          const code = uniqueCode();
          if (!code) return fail(ws, 'rate-limited');
          const token = newToken();
          const room: Room = { code, seats: [{ token, ws }, null], lastActive: now() };
          rooms.set(code, room);
          conn.room = room;
          conn.seat = 0;
          log('room.created', { rooms: rooms.size });
          return send(ws, { type: 'created', code, token });
        }
        case 'join': {
          if (conn.room) return fail(ws, 'bad-message');
          if (!allow(conn.ip)) return fail(ws, 'rate-limited');
          const room = rooms.get(msg.code);
          if (!room) return fail(ws, 'room-not-found');
          if (room.seats[1]) return fail(ws, 'room-full');
          const token = newToken();
          room.seats[1] = { token, ws };
          room.lastActive = now();
          conn.room = room;
          conn.seat = 1;
          log('room.joined');
          send(ws, { type: 'joined', code: room.code, token });
          return send(room.seats[0]?.ws, { type: 'peer-joined' });
        }
        case 'rejoin': {
          if (conn.room) return fail(ws, 'bad-message');
          if (!allow(conn.ip)) return fail(ws, 'rate-limited');
          const room = rooms.get(msg.code);
          if (!room) return fail(ws, 'expired');
          const idx = room.seats.findIndex((s) => s?.token === msg.token);
          if (idx < 0) return fail(ws, 'expired');
          const seat = room.seats[idx]!;
          // A stale socket on the same seat (the old connection that never closed) is replaced.
          if (seat.ws && seat.ws !== ws) {
            const old = conns.get(seat.ws);
            if (old) detach(old);
            seat.ws.terminate();
          }
          seat.ws = ws;
          conn.room = room;
          conn.seat = idx as 0 | 1;
          room.lastActive = now();
          const peer = room.seats[idx === 0 ? 1 : 0];
          log('room.rejoined');
          send(ws, { type: 'rejoined', code: room.code, peerPresent: !!peer?.ws });
          return send(peer?.ws, { type: 'peer-back' });
        }
        case 'offer':
        case 'answer':
        case 'ice': {
          if (!conn.room) return fail(ws, 'not-in-room');
          conn.room.lastActive = now();
          // Relay verbatim (already validated); never logged.
          return send(other(conn)?.ws, msg);
        }
        case 'leave': {
          const room = conn.room;
          if (!room || conn.seat === undefined) return fail(ws, 'not-in-room');
          send(other(conn)?.ws, { type: 'leave' });
          room.seats[conn.seat] = null;
          detach(conn);
          log('room.left');
          if (!room.seats[0] && !room.seats[1]) removeRoom(room, null);
          return;
        }
      }
    });

    ws.on('close', () => {
      conns.delete(ws);
      const room = conn.room;
      if (!room || conn.seat === undefined) return;
      const seat = room.seats[conn.seat];
      if (seat && seat.ws === ws) {
        seat.ws = null;
        send(other(conn)?.ws, { type: 'peer-away' });
      }
    });
    ws.on('error', () => {
      /* closed right after; nothing to log */
    });
  });

  function sweep() {
    const t = now();
    for (const room of [...rooms.values()]) {
      if (t - room.lastActive > ttl) removeRoom(room, 'expired');
    }
    for (const [ip, list] of attempts) {
      const live = list.filter((x) => t - x < limit.windowMs);
      if (live.length) attempts.set(ip, live);
      else attempts.delete(ip);
    }
    for (const [ws, c] of conns) {
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
    }
  }
  const timer = setInterval(sweep, opts.sweepMs ?? DEFAULTS.sweepMs);
  timer.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(opts.port ?? 0, opts.host ?? '0.0.0.0', () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (e) {
    clearInterval(timer);
    wss.close();
    throw e;
  }
  const port = (http.address() as AddressInfo).port;
  log('server.listening', { port });

  return {
    port,
    url: `ws://127.0.0.1:${port}`,
    stats: () => ({ rooms: rooms.size, sockets: conns.size }),
    sweep,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        for (const ws of conns.keys()) ws.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
