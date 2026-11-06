import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConfig, readDotEnv, type ConfigInputs } from '../../src/main/config';

const base: ConfigInputs = { env: {}, settings: {}, keychainKey: null, appVersion: '1.0.0', peer2: false, e2e: false, platform: 'darwin', keychainAvailable: true };

describe('config', () => {
  it('reads the API key from .env without putting it in process.env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'together-env-'));
    await writeFile(join(dir, '.env'), 'SMARTSPECTRA_API_KEY=abc123\nSIGNAL_URL=wss://signal.example\n');
    const env = readDotEnv(['/nonexistent', dir]);
    expect(env.SMARTSPECTRA_API_KEY).toBe('abc123');
    expect(process.env.SMARTSPECTRA_API_KEY).toBeUndefined();
    await rm(dir, { recursive: true });
  });

  it('Keychain key wins over .env; settings win over .env for the server', () => {
    const c = buildConfig({ ...base, env: { SMARTSPECTRA_API_KEY: 'env-key', SIGNAL_URL: 'ws://a:1' }, settings: { signalUrl: 'wss://b' }, keychainKey: 'kc-key' });
    expect(c.apiKey).toBe('kc-key');
    expect(c.apiKeySource).toBe('keychain');
    expect(c.signalUrl).toBe('wss://b');
  });

  it('falls back to localhost and ignores invalid URLs', () => {
    expect(buildConfig({ ...base, env: { SIGNAL_URL: 'http://nope' } }).signalUrl).toBe('ws://localhost:8787');
    expect(buildConfig(base).apiKey).toBeNull();
  });

  it('always has Google STUN, adds TURN only when configured', () => {
    expect(buildConfig(base).iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    const c = buildConfig({ ...base, env: { TURN_URL: 'turn:turn.example:3478', TURN_USER: 'u', TURN_PASS: 'p' } });
    expect(c.iceServers[1]).toEqual({ urls: 'turn:turn.example:3478', username: 'u', credential: 'p' });
    expect(c.turnConfigured).toBe(true);
    expect(buildConfig({ ...base, env: { TURN_URL: 'https://x' } }).turnConfigured).toBe(false);
  });

  it('phase scaling only applies in e2e runs', () => {
    expect(buildConfig({ ...base, env: { TOGETHER_PHASE_SCALE: '0.05' } }).phaseScale).toBe(1);
    expect(buildConfig({ ...base, e2e: true, env: { TOGETHER_PHASE_SCALE: '0.05' } }).phaseScale).toBe(0.05);
    expect(buildConfig({ ...base, e2e: true, env: { TOGETHER_PHASE_SCALE: '5' } }).phaseScale).toBe(1);
  });
});
