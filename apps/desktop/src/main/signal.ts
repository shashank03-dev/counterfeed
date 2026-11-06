import { networkInterfaces } from 'node:os';
import { startSignalServer, type SignalServer } from '@together/signal';
import type { SignalHost } from '../shared/ipc';

/**
 * The app carries its own signaling server, so a demo never depends on a separate terminal.
 *
 * When the configured server is on this machine (ws://localhost:PORT, the default), the main process starts
 * the same server `npm run signal` runs, listening on every interface so a second Mac on the same network
 * can join with ws://<this Mac's address>:PORT. If the port is already taken by a Together server (another
 * instance, or `npm run signal`), that one is used instead. A remote URL is left alone.
 */
export function isLocalSignalUrl(u: string): { port: number } | null {
  try {
    const url = new URL(u);
    if (url.protocol !== 'ws:') return null;
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) return null;
    return { port: Number(url.port || 80) };
  } catch {
    return null;
  }
}

/** IPv4 addresses another Mac on the same network could reach this one at. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  // Ordinary home/office LAN ranges first; VPN and carrier ranges (e.g. 100.64/10) after.
  const rank = (ip: string) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((x, y) => rank(x) - rank(y));
}

/** Is a Together signaling server already answering on this port? */
export async function isTogetherServer(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = (await res.json()) as unknown;
    return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true && typeof (body as { rooms?: unknown }).rooms === 'number';
  } catch {
    return false;
  }
}

export interface LocalSignal {
  host: SignalHost;
  close(): Promise<void>;
}

export async function ensureLocalSignal(signalUrl: string, opts: { host?: string } = {}): Promise<LocalSignal> {
  const local = isLocalSignalUrl(signalUrl);
  if (!local) return { host: { mode: 'remote', port: null, lan: [] }, close: async () => {} };
  let server: SignalServer;
  try {
    server = await startSignalServer({ port: local.port, host: opts.host ?? '0.0.0.0' });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE' && (await isTogetherServer(local.port))) {
      return { host: { mode: 'shared', port: local.port, lan: lanAddresses() }, close: async () => {} };
    }
    return { host: { mode: 'failed', port: local.port, lan: [], reason: code === 'EADDRINUSE' ? 'port-in-use' : 'error' }, close: async () => {} };
  }
  const s = server;
  return { host: { mode: 'embedded', port: s.port, lan: lanAddresses() }, close: () => s.close() };
}

/** Keeps the embedded server matched to the configured URL (it can change in Settings). One at a time. */
export class SignalManager {
  private url: string | null = null;
  private current: LocalSignal | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  sync(url: string): Promise<SignalHost> {
    const run = async (): Promise<SignalHost> => {
      // A shared or failed server is re-checked every time: its owner may have quit, freeing the port.
      if (this.current && this.url === url && (this.current.host.mode === 'embedded' || this.current.host.mode === 'remote')) {
        // Addresses can change (Wi-Fi switch) while the server keeps running.
        return this.current.host.mode === 'remote' ? this.current.host : { ...this.current.host, lan: lanAddresses() };
      }
      await this.current?.close();
      this.url = url;
      this.current = await ensureLocalSignal(url);
      return this.current.host;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async close() {
    await this.chain;
    await this.current?.close();
    this.current = null;
    this.url = null;
  }
}
