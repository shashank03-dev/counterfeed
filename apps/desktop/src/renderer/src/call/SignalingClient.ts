import { parseServerMsg, type ClientMsg, type Relay, type ServerMsg, type SignalErrorCode } from '@together/shared';
import { Emitter } from '../lib/emitter';

export type SignalingEvents = {
  room: [{ code: string; role: 'host' | 'guest' }];
  'peer-joined': [];
  'peer-away': [];
  'peer-back': [];
  relay: [Relay];
  error: [SignalErrorCode | 'unreachable'];
  /** Socket state: 'open' after (re)connecting, 'lost' when it dropped and is retrying. */
  link: ['open' | 'lost'];
} & Record<string, unknown[]>;

/**
 * WebSocket client for the signaling server: create/join a room, then relay offer/answer/ice.
 * If the socket drops while in a room it reconnects with backoff and reclaims its seat with the
 * secret token the server issued (rejoin), so a brief Wi-Fi blip doesn't end the call.
 */
export class SignalingClient extends Emitter<SignalingEvents> {
  private ws: WebSocket | null = null;
  private code: string | null = null;
  private token: string | null = null;
  private role: 'host' | 'guest' | null = null;
  private closed = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: ClientMsg[] = [];

  constructor(private readonly url: string) {
    super();
  }

  get roomCode() {
    return this.code;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch {
        reject(new Error('unreachable'));
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error('unreachable'));
        }
      }, 6000);
      ws.onopen = () => {
        settled = true;
        clearTimeout(timeout);
        this.retry = 0;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('unreachable'));
        }
      };
      ws.onmessage = (e) => {
        const m = typeof e.data === 'string' ? parseServerMsg(e.data) : null;
        if (m) this.handle(m);
      };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        if (!this.closed && this.code && this.token) {
          this.emit('link', 'lost');
          this.scheduleRejoin();
        }
      };
    });
  }

  private handle(m: ServerMsg) {
    switch (m.type) {
      case 'created':
        this.code = m.code;
        this.token = m.token;
        this.role = 'host';
        this.emit('room', { code: m.code, role: 'host' });
        break;
      case 'joined':
        this.code = m.code;
        this.token = m.token;
        this.role = 'guest';
        this.emit('room', { code: m.code, role: 'guest' });
        break;
      case 'rejoined':
        this.emit('link', 'open');
        if (m.peerPresent) this.emit('peer-back');
        this.flush();
        break;
      case 'peer-joined':
        this.emit('peer-joined');
        break;
      case 'peer-away':
        this.emit('peer-away');
        break;
      case 'peer-back':
        this.emit('peer-back');
        break;
      case 'error':
        if (m.code === 'expired') this.code = this.token = null;
        this.emit('error', m.code);
        break;
      default:
        this.emit('relay', m);
    }
  }

  private scheduleRejoin() {
    if (this.retryTimer) return;
    const delay = Math.min(4000, 400 * 2 ** this.retry++);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (this.closed || !this.code || !this.token) return;
      try {
        await this.connect();
        this.raw({ type: 'rejoin', code: this.code, token: this.token });
      } catch {
        this.scheduleRejoin();
      }
    }, delay);
  }

  private raw(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.type === 'offer' || m.type === 'answer' || m.type === 'ice') this.queue.push(m);
  }

  private flush() {
    const q = this.queue.splice(0);
    for (const m of q) this.raw(m);
  }

  async create() {
    await this.connect().catch(() => {
      this.emit('error', 'unreachable');
      throw new Error('unreachable');
    });
    this.raw({ type: 'create' });
  }

  async join(code: string) {
    await this.connect().catch(() => {
      this.emit('error', 'unreachable');
      throw new Error('unreachable');
    });
    this.raw({ type: 'join', code });
  }

  send(m: Relay) {
    this.raw(m);
  }

  get isHost() {
    return this.role === 'host';
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.ws?.readyState === WebSocket.OPEN && this.code) this.ws.send(JSON.stringify({ type: 'leave' }));
    this.ws?.close();
    this.ws = null;
    this.clear();
  }
}
