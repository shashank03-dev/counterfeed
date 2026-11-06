import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionRecord } from '@together/shared';
import { Storage } from '../../src/main/storage';

let dir: string;
let s: Storage;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'together-test-'));
  s = new Storage(dir);
  await s.init();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const session = (id: string, startedAt: number): SessionRecord => ({
  id, version: 1, startedAt, endedAt: startedAt + 1, role: 'host', replay: null, partial: false, apart: null,
  together: { plv: 0.7, windows: 31, coverage: 0.9, chance: { mean: 0.4, p95: 0.55, n: 200 }, ratio: 1.75, percentile: 99, series: [0.6, 0.7] },
  breathingRate: { you: 12, partner: 13 }, pulse: { you: 70, partner: null },
  moods: { you: { start: 'Tense', end: 'Calm' }, partner: { start: null, end: null } }, moments: [], sharedWithMe: [],
});

describe('local storage', () => {
  it('saves, lists newest first, and deletes sessions', async () => {
    await s.saveSession(session('s-aaaaaaaa', 1));
    await s.saveSession(session('s-bbbbbbbb', 2));
    expect((await s.listSessions()).map((x) => x.id)).toEqual(['s-bbbbbbbb', 's-aaaaaaaa']);
    await s.deleteSession('s-aaaaaaaa');
    expect((await s.listSessions()).map((x) => x.id)).toEqual(['s-bbbbbbbb']);
  });

  it('validates everything it writes and rejects path tricks', async () => {
    await expect(s.saveSession({ ...session('s-aaaaaaaa', 1), video: 'x' })).rejects.toThrow();
    await expect(s.saveSession({ ...session('../../evil', 1) })).rejects.toThrow();
    await expect(s.deleteSession('../sessions')).rejects.toThrow('invalid id');
    await expect(s.readRecording('../../etc/passwd')).rejects.toThrow('invalid id');
  });

  it('skips corrupt files instead of breaking History', async () => {
    await s.saveSession(session('s-aaaaaaaa', 1));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'sessions', 'broken.json'), '{nope');
    expect(await s.listSessions()).toHaveLength(1);
  });

  it('records only SignalFrames and phase marks as JSONL, and measures duration', async () => {
    const id = await s.recordingStart('1.0.0', 1_700_000_000_000);
    const frames = Array.from({ length: 300 }, (_, i) => ({ t: 1_700_000_000_000_000 + i * 33_333, trace: Math.sin(i / 10) }));
    await s.recordingAppend(id, [JSON.stringify({ k: 'phase', name: 'call', t: frames[0]!.t })]);
    await s.recordingAppend(id, [JSON.stringify({ k: 'sig', frames: frames.slice(0, 150) }), JSON.stringify({ k: 'sig', frames: frames.slice(150) })]);
    await expect(s.recordingAppend(id, [JSON.stringify({ k: 'sig', frames: [{ t: 1, pixels: 'AAAA' }] })])).rejects.toThrow('bad line');
    expect(await s.listRecordings()).toEqual([]); // still open
    const info = await s.recordingFinish(id);
    expect(info).toMatchObject({ id, recordedAt: 1_700_000_000_000, durationMs: 9967 });
    const lines = (await s.readRecording(id)).trim().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: 'together-recording', version: 1 });
    expect(lines).toHaveLength(4);
    expect(await s.listRecordings()).toHaveLength(1);
  });

  it('drops recordings shorter than 5 s (nothing to replay)', async () => {
    const id = await s.recordingStart('1.0.0');
    await s.recordingAppend(id, [JSON.stringify({ k: 'sig', frames: [{ t: 1, trace: 0 }, { t: 2_000_000, trace: 1 }] })]);
    expect(await s.recordingFinish(id)).toBeNull();
    expect(await readdir(join(dir, 'recordings'))).toEqual([]);
  });

  it('exports everything as one JSON document and Delete All wipes it', async () => {
    await s.saveSession(session('s-aaaaaaaa', 1));
    const id = await s.recordingStart('1.0.0');
    await s.recordingAppend(id, [JSON.stringify({ k: 'sig', frames: [{ t: 1, trace: 0 }, { t: 9_000_000, trace: 1 }] })]);
    await s.recordingFinish(id);
    const exp = await s.exportAll();
    expect(exp.sessions).toHaveLength(1);
    expect(exp.recordings).toHaveLength(1);
    // Only results, moods and moments: no media fields anywhere in the stored data.
    expect(JSON.stringify({ sessions: exp.sessions, recordings: exp.recordings })).not.toMatch(/video|audio|image|pixel|landmark/i);
    expect(await s.deleteAll()).toEqual({ sessions: 1, recordings: 1 });
    expect(await s.listSessions()).toEqual([]);
    expect(await s.listRecordings()).toEqual([]);
  });

  it('peer 2 reads another profile’s recordings but can never delete them', async () => {
    const id = await s.recordingStart('1.0.0');
    await s.recordingAppend(id, [JSON.stringify({ k: 'sig', frames: [{ t: 1, trace: 0 }, { t: 9_000_000, trace: 1 }] })]);
    await s.recordingFinish(id);
    const peer2Dir = await mkdtemp(join(tmpdir(), 'together-p2-'));
    const p2 = new Storage(peer2Dir, join(dir, 'recordings'));
    await p2.init();
    expect(await p2.listRecordings()).toHaveLength(1);
    await expect(p2.deleteRecording(id)).rejects.toThrow('another profile');
    expect(await p2.deleteAll()).toEqual({ sessions: 0, recordings: 0 });
    expect(await s.listRecordings()).toHaveLength(1);
    await rm(peer2Dir, { recursive: true, force: true });
  });

  it('writes files readable only by the user', async () => {
    await s.saveSession(session('s-aaaaaaaa', 1));
    const { stat } = await import('node:fs/promises');
    expect((await stat(join(dir, 'sessions', 's-aaaaaaaa.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(dir, 'sessions', 's-aaaaaaaa.json'), 'utf8')).id).toBe('s-aaaaaaaa');
  });
});
