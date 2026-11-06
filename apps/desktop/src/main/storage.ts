import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RecordingHeaderSchema, RecordingLineSchema, SessionRecordSchema, type SessionRecord } from '@together/shared';
import type { RecordingInfo } from '../shared/ipc';

/**
 * Local storage under app.getPath('userData'):
 *   sessions/<id>.json     one finished session (results, moods, own moments)
 *   recordings/<id>.jsonl  outgoing SignalFrames only (no video, no audio)
 * Nothing here ever leaves the device unless the person exports it.
 * Pure Node (no Electron import) so it is unit-tested against a temp dir.
 */

const ID_RE = /^[a-z0-9-]{8,64}$/;
const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const MAX_APPEND_LINES = 500;

export class StorageError extends Error {}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new StorageError('invalid id');
}

export class Storage {
  private readonly sessionsDir: string;
  private readonly recordingsDir: string;
  /** Recordings belong to another profile (peer 2): read them, never delete them. */
  private readonly sharedRecordings: boolean;
  /** Recordings currently being written: id -> bytes so far. */
  private readonly open = new Map<string, number>();

  /** `recordingsDir` lets the peer-2 dev instance replay the recordings made by the main profile. */
  constructor(root: string, recordingsDir?: string) {
    this.sessionsDir = join(root, 'sessions');
    this.recordingsDir = recordingsDir ?? join(root, 'recordings');
    this.sharedRecordings = !!recordingsDir;
  }

  async init() {
    await mkdir(this.sessionsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.recordingsDir, { recursive: true, mode: 0o700 });
  }

  /* ---- sessions ---- */

  async saveSession(input: unknown): Promise<void> {
    const rec = SessionRecordSchema.parse(input);
    const file = join(this.sessionsDir, `${rec.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(rec), { mode: 0o600 });
    await rename(tmp, file); // atomic: a crash never leaves half a session
  }

  async listSessions(): Promise<SessionRecord[]> {
    const names = (await readdir(this.sessionsDir)).filter((n) => n.endsWith('.json'));
    const out: SessionRecord[] = [];
    for (const n of names) {
      try {
        const r = SessionRecordSchema.safeParse(JSON.parse(await readFile(join(this.sessionsDir, n), 'utf8')));
        if (r.success) out.push(r.data);
      } catch {
        /* unreadable file: skip it rather than break History */
      }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  async deleteSession(id: unknown) {
    assertId(id);
    await rm(join(this.sessionsDir, `${id}.json`), { force: true });
  }

  /** Everything stored, as one JSON document (what "Export" writes). */
  async exportAll() {
    const sessions = await this.listSessions();
    const recordings = await this.listRecordings();
    return {
      kind: 'together-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      note: 'Breathing-sync results, self-reported moods and your own Moments. No video, audio or face data is ever stored.',
      sessions,
      recordings,
    };
  }

  async deleteAll() {
    const sessions = (await readdir(this.sessionsDir)).filter((n) => n.endsWith('.json')).length;
    const recordings = this.sharedRecordings ? 0 : (await readdir(this.recordingsDir)).filter((n) => n.endsWith('.jsonl')).length;
    this.open.clear();
    await rm(this.sessionsDir, { recursive: true, force: true });
    if (!this.sharedRecordings) await rm(this.recordingsDir, { recursive: true, force: true });
    await this.init();
    return { sessions, recordings };
  }

  /* ---- recordings ---- */

  async recordingStart(appVersion: string, now = Date.now()): Promise<string> {
    const id = `rec-${now.toString(36)}-${randomUUID().slice(0, 8)}`;
    const header = RecordingHeaderSchema.parse({ kind: 'together-recording', version: 1, recordedAt: now * 1000, appVersion });
    const line = JSON.stringify(header) + '\n';
    await writeFile(join(this.recordingsDir, `${id}.jsonl`), line, { mode: 0o600 });
    this.open.set(id, line.length);
    return id;
  }

  async recordingAppend(id: unknown, lines: unknown) {
    assertId(id);
    const size = this.open.get(id);
    if (size === undefined) throw new StorageError('recording not open');
    if (!Array.isArray(lines) || lines.length > MAX_APPEND_LINES) throw new StorageError('bad lines');
    let chunk = '';
    for (const l of lines) {
      if (typeof l !== 'string') throw new StorageError('bad line');
      // Each line is re-validated: only SignalFrames and phase marks can be written.
      const parsed = RecordingLineSchema.safeParse(JSON.parse(l));
      if (!parsed.success) throw new StorageError('bad line');
      chunk += JSON.stringify(parsed.data) + '\n';
    }
    if (size + chunk.length > MAX_RECORDING_BYTES) throw new StorageError('recording too large');
    await appendFile(join(this.recordingsDir, `${id}.jsonl`), chunk);
    this.open.set(id, size + chunk.length);
  }

  async recordingFinish(id: unknown): Promise<RecordingInfo | null> {
    assertId(id);
    this.open.delete(id);
    const info = await this.recordingInfo(`${id}.jsonl`);
    // A recording with no signal in it is useless for replay: drop it.
    if (info && info.durationMs < 5_000) {
      await rm(join(this.recordingsDir, `${id}.jsonl`), { force: true });
      return null;
    }
    return info;
  }

  async listRecordings(): Promise<RecordingInfo[]> {
    const names = (await readdir(this.recordingsDir)).filter((n) => n.endsWith('.jsonl'));
    const out: RecordingInfo[] = [];
    for (const n of names) {
      if (this.open.has(n.slice(0, -6))) continue;
      const info = await this.recordingInfo(n);
      if (info) out.push(info);
    }
    return out.sort((a, b) => b.recordedAt - a.recordedAt);
  }

  async readRecording(id: unknown): Promise<string> {
    assertId(id);
    return readFile(join(this.recordingsDir, `${id}.jsonl`), 'utf8');
  }

  async deleteRecording(id: unknown) {
    assertId(id);
    if (this.sharedRecordings) throw new StorageError('recordings belong to another profile');
    this.open.delete(id);
    await rm(join(this.recordingsDir, `${id}.jsonl`), { force: true });
  }

  private async recordingInfo(name: string): Promise<RecordingInfo | null> {
    const file = join(this.recordingsDir, name);
    try {
      const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      const lines = text.split('\n').filter(Boolean);
      const header = RecordingHeaderSchema.safeParse(JSON.parse(lines[0] ?? 'null'));
      if (!header.success) return null;
      let first = Infinity;
      let last = -Infinity;
      for (let i = 1; i < lines.length; i++) {
        const l = RecordingLineSchema.safeParse(JSON.parse(lines[i]!));
        if (!l.success || l.data.k !== 'sig') continue;
        for (const f of l.data.frames) {
          if (f.t < first) first = f.t;
          if (f.t > last) last = f.t;
        }
      }
      return {
        id: name.slice(0, -6),
        recordedAt: Math.round(header.data.recordedAt / 1000),
        durationMs: Number.isFinite(first) ? Math.round((last - first) / 1000) : 0,
        bytes: st.size,
      };
    } catch {
      return null;
    }
  }
}
