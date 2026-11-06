import { app, dialog, ipcMain, safeStorage, shell, systemPreferences, type BrowserWindow } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC, type AppConfig, type MediaAccess, type MediaKind, type SignalHost, type UserSettings } from '../shared/ipc';
import { buildConfig, isValidSignalUrl, isValidTurnUrl, type ConfigInputs } from './config';
import type { Storage } from './storage';

const EXTERNAL = {
  'presage-docs': 'https://smartspectra.presagetech.com/docs/measurement-quality',
  'presage-keys': 'https://physiology.presagetech.com/',
  'model-cards': 'https://smartspectra.presagetech.com/docs/model-cards-and-limitations',
} as const;

const PRIVACY_PANES: Record<MediaKind, string> = {
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

interface Deps {
  storage: Storage;
  window: () => BrowserWindow | null;
  base: Omit<ConfigInputs, 'settings' | 'keychainKey' | 'keychainAvailable'>;
  /** Runs the local signaling server for the configured URL; absent in automated test runs. */
  signal?: { sync(url: string): Promise<SignalHost> };
}

const str = (v: unknown, max = 512): string | null => (typeof v === 'string' && v.length <= max ? v.trim() || null : null);

export function registerIpc({ storage, window, base, signal }: Deps) {
  const settingsFile = join(app.getPath('userData'), 'settings.json');
  const keyFile = join(app.getPath('userData'), 'access-key.bin');
  let settings: UserSettings = {};
  let keychainKey: string | null = null;
  let keychainOk = false;

  async function load() {
    try {
      settings = JSON.parse(await readFile(settingsFile, 'utf8')) as UserSettings;
    } catch {
      settings = {};
    }
    keychainOk = await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
    try {
      if (keychainOk) keychainKey = (await safeStorage.decryptStringAsync(await readFile(keyFile))).result || null;
    } catch {
      keychainKey = null; // no key saved yet, or the Keychain item was removed
    }
  }

  let signalHost: SignalHost | null = null;
  const config = (): AppConfig => {
    const c = buildConfig({ ...base, settings, keychainKey, keychainAvailable: keychainOk });
    return signalHost ? { ...c, signalHost } : c;
  };
  const syncSignal = async () => {
    if (signal) signalHost = await signal.sync(config().signalUrl);
  };

  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      // Only our own window may call in.
      const w = window();
      if (!w || event.sender !== w.webContents) throw new Error('forbidden');
      return fn(...args);
    });

  handle(IPC.getConfig, async () => {
    await load();
    await syncSignal();
    return config();
  });

  handle(IPC.saveSettings, async (raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const next: UserSettings = { ...settings };
    if ('signalUrl' in s) {
      const v = str(s.signalUrl);
      if (v && !isValidSignalUrl(v)) throw new Error('Signal server must be a ws:// or wss:// address');
      next.signalUrl = v;
    }
    if ('turnUrl' in s) {
      const v = str(s.turnUrl);
      if (v && !isValidTurnUrl(v)) throw new Error('TURN address must start with turn: or turns:');
      next.turnUrl = v;
    }
    if ('turnUser' in s) next.turnUser = str(s.turnUser, 256);
    if ('turnPass' in s) next.turnPass = str(s.turnPass, 256);
    settings = next;
    await writeFile(settingsFile, JSON.stringify(settings), { mode: 0o600 });
    await syncSignal();
    return config();
  });

  handle(IPC.setApiKey, async (raw) => {
    const key = str(raw, 256);
    if (!key) {
      keychainKey = null;
      await rm(keyFile, { force: true });
      return config();
    }
    if (!/^[\x21-\x7e]{8,256}$/.test(key)) throw new Error('That does not look like an access key');
    if (!keychainOk) throw new Error('Secure storage is unavailable; put the key in .env instead');
    await writeFile(keyFile, await safeStorage.encryptStringAsync(key), { mode: 0o600 });
    keychainKey = key;
    return config();
  });

  handle(IPC.saveSession, (r) => storage.saveSession(r));
  handle(IPC.listSessions, () => storage.listSessions());
  handle(IPC.deleteSession, (id) => storage.deleteSession(id));
  handle(IPC.deleteAll, () => storage.deleteAll());
  handle(IPC.exportAll, async () => {
    const data = await storage.exportAll();
    const w = window();
    const opts = { title: 'Export Together data', defaultPath: `together-export-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] };
    const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { saved: false, count: data.sessions.length };
    await writeFile(res.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    return { saved: true, path: res.filePath, count: data.sessions.length };
  });

  handle(IPC.recordingStart, () => storage.recordingStart(base.appVersion));
  handle(IPC.recordingAppend, (id, lines) => storage.recordingAppend(id, lines));
  handle(IPC.recordingFinish, (id) => storage.recordingFinish(id));
  handle(IPC.listRecordings, () => storage.listRecordings());
  handle(IPC.readRecording, (id) => storage.readRecording(id));
  handle(IPC.deleteRecording, (id) => storage.deleteRecording(id));

  const kind = (k: unknown): MediaKind => {
    if (k !== 'camera' && k !== 'microphone') throw new Error('bad media kind');
    return k;
  };
  handle(IPC.mediaAccess, (k): MediaAccess => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown';
    return systemPreferences.getMediaAccessStatus(kind(k)) as MediaAccess;
  });
  handle(IPC.askMediaAccess, async (k) => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess(kind(k));
  });
  handle(IPC.openPrivacySettings, async (k) => {
    if (process.platform === 'darwin') await shell.openExternal(PRIVACY_PANES[kind(k)]);
  });
  handle(IPC.openExternal, async (which) => {
    const url = EXTERNAL[which as keyof typeof EXTERNAL];
    if (url) await shell.openExternal(url);
  });
}
