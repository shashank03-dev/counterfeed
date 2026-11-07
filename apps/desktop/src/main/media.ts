import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';

/**
 * Local video playback for Review. The renderer never gets a file path: main hands out an unguessable token
 * for a file the person picked in the open dialog, and `cfmedia://video/<token>` streams only that file, with
 * Range support so the player can seek. Pure Node apart from the Response type, so it is unit-tested.
 */

export const MEDIA_SCHEME = 'cfmedia';
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm'];

const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

export class MediaRegistry {
  private files = new Map<string, string>();

  /** Allow one picked file; returns its URL. Older picks stay valid until quit (History can't replay them). */
  add(path: string): string {
    const token = randomBytes(16).toString('hex');
    this.files.set(token, path);
    return `${MEDIA_SCHEME}://video/${token}`;
  }

  async respond(url: string, range: string | null): Promise<Response> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return new Response('bad url', { status: 400 });
    }
    const token = u.pathname.replace(/^\//, '');
    const path = u.host === 'video' && /^[0-9a-f]{32}$/.test(token) ? this.files.get(token) : undefined;
    if (!path) return new Response('not found', { status: 404 });
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return new Response('gone', { status: 404 });
    }
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
    const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    const r = parseRange(range, size);
    if (r === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    const [start, end] = r ?? [0, size - 1];
    const body = size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream);
    headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
    if (r) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(body, { status: r ? 206 : 200, headers });
  }
}

/** The demo pack's clips (full paths), sorted by name. Missing folder: none. */
export async function listDemoPack(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => !n.startsWith('.') && VIDEO_EXTENSIONS.includes(extname(n).slice(1).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** "bytes=a-b" -> [a, b] inclusive, clamped. null = no range header; 'invalid' = unsatisfiable. */
export function parseRange(h: string | null, size: number): [number, number] | null | 'invalid' {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return [start, end];
}
