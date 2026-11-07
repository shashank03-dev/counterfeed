import { app, desktopCapturer, dialog, ipcMain, safeStorage, shell, systemPreferences, type BrowserWindow } from 'electron';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AppConfig, ContentSourceInfo, MediaAccess, MediaKind, SourceList } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { buildConfig, isPlausibleKey, type ConfigInputs } from './config';
import { MAX_CLIPS } from '@counterfeed/shared';
import { frontApp, scriptedFrontApp, type Dnd } from './mac';
import { listDemoPack, VIDEO_EXTENSIONS, type MediaRegistry } from './media';
import { parseExport, type Storage } from './storage';

const EXTERNAL = {
  'presage-docs': 'https://smartspectra.presagetech.com/docs/measurement-quality',
  'presage-keys': 'https://physiology.presagetech.com/',
  'model-cards': 'https://smartspectra.presagetech.com/docs/model-cards-and-limitations',
} as const;

const PRIVACY_PANES: Record<MediaKind, string> = {
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

interface Deps {
  storage: Storage;
  media: MediaRegistry;
  window: () => BrowserWindow | null;
  /** Folder holding the Hook test demo pack. */
  demoDir: string;
  base: Omit<ConfigInputs, 'keychainKey' | 'keychainAvailable'>;
  setCompact(on: boolean): void;
  setBusy(busy: boolean): void;
  quit(): void;
  /** Do Not Disturb for focus sessions (through the person's Shortcuts). */
  dnd: Dnd;
}

const str = (v: unknown, max = 512): string | null => (typeof v === 'string' && v.length <= max ? v.trim() || null : null);

export function registerIpc({ storage, media, window, demoDir, base, setCompact, setBusy, quit, dnd }: Deps) {
  const keyFile = join(app.getPath('userData'), 'access-key.bin');
  let keychainKey: string | null = null;
  let keychainOk = false;

  async function load() {
    keychainOk = await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
    try {
      if (keychainOk) keychainKey = (await safeStorage.decryptStringAsync(await readFile(keyFile))).result || null;
    } catch {
      keychainKey = null; // no key saved yet, or the Keychain item was removed
    }
  }
  const config = (): AppConfig => buildConfig({ ...base, keychainKey, keychainAvailable: keychainOk });

  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      // Only our own window may call in.
      const w = window();
      if (!w || event.sender !== w.webContents) throw new Error('forbidden');
      return fn(...args);
    });

  handle(IPC.getConfig, async () => {
    await load();
    return config();
  });

  handle(IPC.setApiKey, async (raw) => {
    const key = str(raw, 256);
    if (!key) {
      keychainKey = null;
      await rm(keyFile, { force: true });
      return config();
    }
    if (!isPlausibleKey(key)) throw new Error('That does not look like an access key');
    if (!keychainOk) throw new Error('Secure storage is unavailable; put the key in .env instead');
    await writeFile(keyFile, await safeStorage.encryptStringAsync(key), { mode: 0o600 });
    keychainKey = key;
    return config();
  });

  handle(IPC.saveReport, (r, t) => storage.saveReport(r, t));
  handle(IPC.listReports, () => storage.listReports());
  handle(IPC.readThumbs, (id) => storage.readThumbs(id));
  handle(IPC.deleteReport, (id) => storage.deleteReport(id));
  handle(IPC.deleteAll, () => storage.deleteAll());
  handle(IPC.exportAll, async () => {
    const data = await storage.exportAll();
    const w = window();
    const opts = { title: 'Export Counterfeed reports', defaultPath: `counterfeed-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] };
    const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { saved: false, count: data.reports.length };
    await writeFile(res.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    return { saved: true, path: res.filePath, count: data.reports.length };
  });
  handle(IPC.openReportFile, async () => {
    const w = window();
    const opts = { title: 'Open a Counterfeed report', properties: ['openFile' as const], filters: [{ name: 'Counterfeed report', extensions: ['json'] }] };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    const path = res.filePaths[0];
    if (res.canceled || !path) return null;
    if ((await stat(path)).size > MAX_IMPORT_BYTES) return { error: 'That file is too large to be a Counterfeed report.' };
    const parsed = parseExport(await readFile(path, 'utf8'));
    return 'error' in parsed ? parsed : { file: parsed.file, name: basename(path) };
  });

  handle(IPC.listSources, async (): Promise<SourceList> => {
    const access = mediaAccess('screen');
    let sources: ContentSourceInfo[];
    try {
      const raw = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
      sources = raw
        .filter((s) => s.name && !/^Counterfeed$/i.test(s.name))
        .map((s) => {
          const kind: 'window' | 'screen' = s.id.startsWith('screen:') ? 'screen' : 'window';
          const iphone = /iphone mirroring/i.test(s.name);
          return { id: s.id, kind, name: kind === 'screen' ? (raw.filter((x) => x.id.startsWith('screen:')).length > 1 ? s.name : 'Entire screen') : s.name, app: iphone ? 'iPhone Mirroring' : null, thumb: s.thumbnail.isEmpty() ? null : `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString('base64')}`, iphone };
        })
        .sort((a, b) => Number(b.iphone) - Number(a.iphone) || (a.kind === b.kind ? 0 : a.kind === 'window' ? -1 : 1));
    } catch {
      sources = [];
    }
    // Automated runs add a labelled test window drawn by the app itself (never fed to the SDK).
    if (base.e2e) sources.unshift({ id: 'test:content', kind: 'test', name: 'Test content (automated run)', app: null, thumb: null, iphone: false });
    return { access, sources };
  });

  handle(IPC.pickVideo, async () => {
    const w = window();
    const opts = { title: 'Choose a demo video', properties: ['openFile' as const], filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }] };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    const path = res.filePaths[0];
    if (res.canceled || !path) return null;
    return { url: media.add(path), name: basename(path) };
  });

  handle(IPC.pickClips, async () => {
    const w = window();
    const opts = { title: `Choose 2 to ${MAX_CLIPS} clips`, properties: ['openFile' as const, 'multiSelections' as const], filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }] };
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths.length) return null;
    const paths = [...new Set(res.filePaths)];
    return { clips: paths.slice(0, MAX_CLIPS).map((p) => ({ url: media.add(p), name: basename(p) })), dropped: Math.max(0, paths.length - MAX_CLIPS) };
  });

  handle(IPC.demoPack, async () => (await listDemoPack(demoDir)).slice(0, MAX_CLIPS).map((p) => ({ url: media.add(p), name: basename(p) })));

  handle(IPC.setCompact, (on) => setCompact(on === true));
  handle(IPC.setBusy, (b) => setBusy(b === true));
  handle(IPC.quit, () => quit());

  // Focus sessions. Automated runs get a scripted app sequence (never the real front app).
  let scriptStart: number | null = null;
  handle(IPC.frontApp, () => {
    if (base.e2e) {
      scriptStart ??= Date.now();
      return scriptedFrontApp(Date.now() - scriptStart);
    }
    return frontApp(process.pid);
  });
  handle(IPC.focusShortcuts, () => dnd.check());
  handle(IPC.setDnd, (on) => dnd.set(on === true));
  handle(IPC.openShortcuts, () => {
    if (!base.e2e) void shell.openExternal('shortcuts://');
  });

  function mediaAccess(k: MediaKind): MediaAccess {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown';
    try {
      return systemPreferences.getMediaAccessStatus(k) as MediaAccess;
    } catch {
      return 'unknown';
    }
  }
  const kind = (k: unknown): MediaKind => {
    if (k !== 'camera' && k !== 'screen') throw new Error('bad media kind');
    return k;
  };
  handle(IPC.mediaAccess, (k) => mediaAccess(kind(k)));
  handle(IPC.askCameraAccess, async () => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess('camera') : true));
  handle(IPC.openPrivacySettings, async (k) => {
    if (process.platform === 'darwin') await shell.openExternal(PRIVACY_PANES[kind(k)]);
  });
  handle(IPC.openExternal, async (which) => {
    const url = EXTERNAL[which as keyof typeof EXTERNAL];
    if (url) await shell.openExternal(url);
  });
}
