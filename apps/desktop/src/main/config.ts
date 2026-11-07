import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { AppConfig } from '../shared/ipc';

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

export interface ConfigInputs {
  env: Record<string, string | undefined>;
  keychainKey: string | null;
  appVersion: string;
  e2e: boolean;
  /** Packaged app: developer-only switches (recording raw samples, test scenarios) are always off. */
  packaged: boolean;
  platform: string;
  keychainAvailable: boolean;
}

/** Pure: merge .env and the Keychain key into the renderer's config. The Keychain wins over .env. */
export function buildConfig(i: ConfigInputs): AppConfig {
  const envKey = i.env.SMARTSPECTRA_API_KEY?.trim() || null;
  const apiKey = i.keychainKey ?? envKey;
  const scale = Number(i.env.COUNTERFEED_TIME_SCALE);
  return {
    appVersion: i.appVersion,
    apiKey,
    apiKeySource: i.keychainKey ? 'keychain' : envKey ? 'env' : null,
    e2e: i.e2e,
    timeScale: i.e2e && scale > 0 && scale <= 1 ? scale : 1,
    testScenario: i.e2e && (i.env.COUNTERFEED_TEST_SCENARIO === 'laptop' || i.env.COUNTERFEED_TEST_SCENARIO === 'focus') ? i.env.COUNTERFEED_TEST_SCENARIO : 'default',
    recordRaw: !i.packaged && i.env.COUNTERFEED_RECORD === '1',
    platform: i.platform,
    keychainAvailable: i.keychainAvailable,
  };
}

/**
 * The Shortcuts command line tool that switches Do Not Disturb, or null when it mustn't be used. Automated runs never
 * touch the real one: they use a stand-in only if the test names one (never in a packaged app), else none.
 */
export function shortcutsBin(i: { e2e: boolean; packaged: boolean; platform: string; env: Record<string, string | undefined> }): string | null {
  if (i.platform !== 'darwin') return null;
  if (i.e2e) return !i.packaged && i.env.COUNTERFEED_SHORTCUTS_BIN ? i.env.COUNTERFEED_SHORTCUTS_BIN : null;
  return '/usr/bin/shortcuts';
}

/** True for a plausible SmartSpectra key (printable ASCII, no spaces). */
export function isPlausibleKey(key: string): boolean {
  return /^[\x21-\x7e]{8,256}$/.test(key);
}

/**
 * Which permission requests the app grants: the camera ('media', video only) and capturing the window you chose
 * ('display-capture': Electron asks for this when a desktop source is opened with getUserMedia), and only for our
 * own page. Everything else, audio included, is denied.
 */
export function allowPermission(permission: string, mediaTypes: string[] | undefined, own: boolean): boolean {
  if (!own || mediaTypes?.includes('audio')) return false;
  return permission === 'media' || permission === 'display-capture';
}
