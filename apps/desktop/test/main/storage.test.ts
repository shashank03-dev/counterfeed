import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Report } from '@counterfeed/shared';
import { buildConfig, isPlausibleKey } from '../../src/main/config';
import { listDemoPack, MediaRegistry, parseRange } from '../../src/main/media';
import { parseExport, Storage } from '../../src/main/storage';

let dir: string;
let s: Storage;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'counterfeed-test-'));
  s = new Storage(dir);
  await s.init();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const report = (id: string, startedAt: number, thumb: string | null = 't1'): Report => ({
  id, version: 1, mode: 'feed', startedAt, endedAt: startedAt + 1, signal: 'camera',
  content: { kind: 'window', name: 'Instagram', app: null, durationMs: null }, title: null, partial: false, notes: [],
  baseline: { durationMs: 40_000, quality: 'good', blinkPerMin: 18, breathPerMin: 14, pulse: 68 }, watchMs: 300_000,
  metrics: { blinkPerMin: 9, longestNoBlinkMs: 21_000, holds: 3, longestHoldMs: 9000, breathPerMin: 13, pulse: 72, pulseDelta: 4, hrvMs: 40, smileMs: 3000, awayCount: 1, awayMs: 2000, coverage: 0.9, screenChanges: 40 },
  pull: { score: 64, parts: [{ key: 'blinking', value: 0.8, weight: 0.3, detail: 'x' }] },
  events: [{ id: 'hold-1', kind: 'hold', atMs: 1000, contentMs: null, durMs: 9000, peak: null, thumb }],
  curve: [0.2, null, 0.7], curveBinMs: 5000, curveAxis: 'watch',
  felt: { before: 4, after: 3 }, guessMs: 120_000, ratings: null, reviewNote: null, summary: 'Strong pull.', suggestion: { key: 'pauses', text: 'Try three slow breaths out.' },
});

describe('report storage', () => {
  it('saves, lists newest first, reads thumbnails, and deletes both files', async () => {
    await s.saveReport(report('r-aaaaaaaa', 1), { t1: THUMB, t9: THUMB });
    await s.saveReport(report('r-bbbbbbbb', 2, null), {});
    expect((await s.listReports()).map((x) => x.id)).toEqual(['r-bbbbbbbb', 'r-aaaaaaaa']);
    // Only thumbnails the report points at are kept.
    expect(await s.readThumbs('r-aaaaaaaa')).toEqual({ t1: THUMB });
    await s.deleteReport('r-aaaaaaaa');
    expect((await readdir(join(dir, 'reports'))).sort()).toEqual(['r-bbbbbbbb.json', 'r-bbbbbbbb.thumbs.json']);
  });

  it('a hook test keeps the stills its clips point at, and an older report without clips still loads', async () => {
    const clip = { index: 0, name: 'A.mp4', durationMs: 10_000, watchedMs: 10_000, status: 'finished' as const, leftAtMs: null, score: 80, rank: 1, hook: 'landed' as const, grabbedAtMs: 0, bestMs: 2000, awayMs: 0, parts: [{ key: 'stayed' as const, value: 1, weight: 0.35, detail: 'Watched to the end.' }], curve: [0.9, 1, null], thumb: 't4' };
    const hooks: Report = { ...report('r-hooks001', 3, null), mode: 'hooks', clips: [clip, { ...clip, index: 1, name: 'B.mp4', rank: 2, score: 40, thumb: null }], picked: 1 };
    await s.saveReport(hooks, { t4: THUMB, t5: THUMB });
    expect(await s.readThumbs('r-hooks001')).toEqual({ t4: THUMB });
    const back = (await s.listReports()).find((x) => x.id === 'r-hooks001')!;
    expect(back.clips).toHaveLength(2);
    expect(back.picked).toBe(1);
    await s.saveReport(report('r-old00001', 1), {});
    expect((await s.listReports()).find((x) => x.id === 'r-old00001')!.clips).toBeUndefined();
    await expect(s.saveReport({ ...hooks, clips: [{ ...clip, rank: 9 }] }, {})).rejects.toThrow();
  });

  it('validates everything it writes and rejects path tricks', async () => {
    await expect(s.saveReport({ ...report('r-aaaaaaaa', 1), video: 'x' }, {})).rejects.toThrow();
    await expect(s.saveReport(report('../../evil', 1), {})).rejects.toThrow();
    await expect(s.saveReport(report('r-aaaaaaaa', 1), { t1: 'data:image/png;base64,AAAA' })).rejects.toThrow();
    await expect(s.deleteReport('../reports')).rejects.toThrow('invalid id');
    await expect(s.readThumbs('../../etc/passwd')).rejects.toThrow('invalid id');
  });

  it('skips corrupt files instead of breaking History', async () => {
    await s.saveReport(report('r-aaaaaaaa', 1), {});
    await writeFile(join(dir, 'reports', 'r-broken01.json'), '{nope', 'utf8');
    await writeFile(join(dir, 'reports', 'r-broken02.json'), JSON.stringify({ id: 'r-broken02' }), 'utf8');
    expect((await s.listReports()).map((x) => x.id)).toEqual(['r-aaaaaaaa']);
  });

  it('exports numbers only (no pictures), and an export opens again', async () => {
    await s.saveReport(report('r-aaaaaaaa', 1), { t1: THUMB });
    const exp = await s.exportAll(new Date('2026-11-07T00:00:00Z'));
    const text = JSON.stringify(exp);
    expect(text).not.toContain('base64');
    expect(exp.reports).toHaveLength(1);
    const back = parseExport(text);
    expect('file' in back && back.file.reports[0]!.id).toBe('r-aaaaaaaa');
    expect(parseExport('{')).toEqual({ error: expect.stringMatching(/isn’t a Counterfeed report/) });
    expect(parseExport(JSON.stringify({ ...exp, reports: [] }))).toEqual({ error: 'That file has no reports in it.' });
    expect('error' in parseExport(JSON.stringify({ ...exp, extra: 1 }))).toBe(true);
  });

  it('delete all empties the folder and counts reports, not thumbnail files', async () => {
    await s.saveReport(report('r-aaaaaaaa', 1), { t1: THUMB });
    await s.saveReport(report('r-bbbbbbbb', 2), { t1: THUMB });
    expect(await s.deleteAll()).toEqual({ reports: 2 });
    expect(await readdir(join(dir, 'reports'))).toEqual([]);
  });

  it('writes files readable only by you', async () => {
    await s.saveReport(report('r-aaaaaaaa', 1), {});
    const { stat } = await import('node:fs/promises');
    expect((await stat(join(dir, 'reports', 'r-aaaaaaaa.json'))).mode & 0o777).toBe(0o600);
  });
});

describe('config', () => {
  const base = { appVersion: '1.0.0', e2e: false, packaged: false, platform: 'darwin', keychainAvailable: true };
  it('Keychain key wins over .env, and the time scale only applies in automated runs', () => {
    expect(buildConfig({ ...base, env: { SMARTSPECTRA_API_KEY: ' envkey123 ' }, keychainKey: null })).toMatchObject({ apiKey: 'envkey123', apiKeySource: 'env', timeScale: 1 });
    expect(buildConfig({ ...base, env: { SMARTSPECTRA_API_KEY: 'envkey123' }, keychainKey: 'chainkey1' })).toMatchObject({ apiKey: 'chainkey1', apiKeySource: 'keychain' });
    expect(buildConfig({ ...base, env: { COUNTERFEED_TIME_SCALE: '0.2' }, keychainKey: null }).timeScale).toBe(1);
    expect(buildConfig({ ...base, e2e: true, env: { COUNTERFEED_TIME_SCALE: '0.2' }, keychainKey: null }).timeScale).toBe(0.2);
    expect(buildConfig({ ...base, e2e: true, env: { COUNTERFEED_TIME_SCALE: '7' }, keychainKey: null }).timeScale).toBe(1);
  });
  it('developer switches never reach a packaged app, and test scenarios only apply in automated runs', () => {
    expect(buildConfig({ ...base, env: { COUNTERFEED_RECORD: '1' }, keychainKey: null }).recordRaw).toBe(true);
    expect(buildConfig({ ...base, packaged: true, env: { COUNTERFEED_RECORD: '1' }, keychainKey: null }).recordRaw).toBe(false);
    expect(buildConfig({ ...base, env: {}, keychainKey: null }).recordRaw).toBe(false);
    expect(buildConfig({ ...base, env: { COUNTERFEED_TEST_SCENARIO: 'laptop' }, keychainKey: null }).testScenario).toBe('default');
    expect(buildConfig({ ...base, e2e: true, env: { COUNTERFEED_TEST_SCENARIO: 'laptop' }, keychainKey: null }).testScenario).toBe('laptop');
    expect(buildConfig({ ...base, e2e: true, env: { COUNTERFEED_TEST_SCENARIO: 'other' }, keychainKey: null }).testScenario).toBe('default');
  });
  it('rejects implausible keys', () => {
    expect(isPlausibleKey('abc')).toBe(false);
    expect(isPlausibleKey('has space inside')).toBe(false);
    expect(isPlausibleKey('A1b2C3d4e5')).toBe(true);
  });
});

describe('Hook test demo pack', () => {
  it('lists only video files, sorted, and copes with a missing folder', async () => {
    await writeFile(join(dir, 'b clip.mp4'), 'x');
    await writeFile(join(dir, 'A clip.MOV'), 'x');
    await writeFile(join(dir, 'notes.txt'), 'x');
    await writeFile(join(dir, '.hidden.mp4'), 'x');
    expect((await listDemoPack(dir)).map((p) => p.slice(dir.length + 1))).toEqual(['A clip.MOV', 'b clip.mp4']);
    expect(await listDemoPack(join(dir, 'nope'))).toEqual([]);
  });
  it('the shipped demo pack has 5 clips', async () => {
    expect(await listDemoPack(join(__dirname, '..', '..', 'resources', 'demo-pack'))).toHaveLength(5);
  });
});

describe('local video streaming', () => {
  it('parses byte ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual([0, 9]);
    expect(parseRange('bytes=90-', 100)).toEqual([90, 99]);
    expect(parseRange('bytes=-10', 100)).toEqual([90, 99]);
    expect(parseRange('bytes=0-500', 100)).toEqual([0, 99]);
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
  it('serves only picked files, with ranges for seeking', async () => {
    const file = join(dir, 'demo.mp4');
    await writeFile(file, Buffer.from('0123456789'));
    const m = new MediaRegistry();
    const url = m.add(file);
    expect(url).toMatch(/^cfmedia:\/\/video\/[0-9a-f]{32}$/);
    const full = await m.respond(url, null);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(await full.text()).toBe('0123456789');
    const part = await m.respond(url, 'bytes=2-4');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    expect((await m.respond(url, 'bytes=50-')).status).toBe(416);
    expect((await m.respond('cfmedia://video/' + '0'.repeat(32), null)).status).toBe(404);
    expect((await m.respond('cfmedia://video/../../etc/passwd', null)).status).toBe(404);
    expect(await readFile(file, 'utf8')).toBe('0123456789');
  });
});
