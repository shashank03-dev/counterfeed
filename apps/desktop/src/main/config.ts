import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { AppConfig, UserSettings } from '../shared/ipc';

/** Values from a .env file, without touching process.env (so nothing leaks to child processes). */
export function readDotEnv(dirs: string[]): Record<string, string> {
  for (const dir of dirs) {
    const file = join(dir, '.env');
    if (!existsSync(file)) continue;
    try {
      const parsed = parseEnv(readFileSync(file, 'utf8'));
      return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch {
      return {};
    }
  }
  return {};
}

const STUN = 'stun:stun.l.google.com:19302';

export function isValidSignalUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

export function isValidTurnUrl(u: string): boolean {
  return /^turns?:[^\s]+$/.test(u);
}

export interface ConfigInputs {
  env: Record<string, string | undefined>;
  settings: UserSettings;
  keychainKey: string | null;
  appVersion: string;
  peer2: boolean;
  e2e: boolean;
  platform: string;
  keychainAvailable: boolean;
}

/** Pure: merge .env, saved settings and the Keychain key into the renderer's config. Settings win over .env. */
export function buildConfig(i: ConfigInputs): AppConfig {
  const envKey = i.env.SMARTSPECTRA_API_KEY?.trim() || null;
  const apiKey = i.keychainKey ?? envKey;
  const signalUrl = [i.settings.signalUrl, i.env.SIGNAL_URL, 'ws://localhost:8787'].find((u): u is string => !!u && isValidSignalUrl(u))!;
  const turnUrl = [i.settings.turnUrl, i.env.TURN_URL].find((u): u is string => !!u && isValidTurnUrl(u)) ?? null;
  const iceServers: AppConfig['iceServers'] = [{ urls: STUN }];
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: i.settings.turnUser ?? i.env.TURN_USER ?? undefined,
      credential: i.settings.turnPass ?? i.env.TURN_PASS ?? undefined,
    });
  }
  const scale = Number(i.env.TOGETHER_PHASE_SCALE);
  return {
    appVersion: i.appVersion,
    apiKey,
    apiKeySource: i.keychainKey ? 'keychain' : envKey ? 'env' : null,
    signalUrl,
    iceServers,
    turnConfigured: !!turnUrl,
    peer2: i.peer2,
    e2e: i.e2e,
    phaseScale: i.e2e && scale > 0 && scale <= 1 ? scale : 1,
    testSeed: i.e2e ? Number(i.env.TOGETHER_TEST_SEED) || 1 : 0,
    platform: i.platform,
    keychainAvailable: i.keychainAvailable,
    signalHost: { mode: 'off', port: null, lan: [] },
  };
}
