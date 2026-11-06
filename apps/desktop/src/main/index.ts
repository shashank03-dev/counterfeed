import { app, BrowserWindow, nativeTheme, session, shell } from 'electron';
import { join, resolve } from 'node:path';
import { readDotEnv } from './config';
import { SignalManager } from './signal';
import { registerIpc } from './ipc';
import { Storage } from './storage';

/*
 * Together: main process.
 *  - One window; the renderer runs the SmartSpectra renderer SDK, the call and all analysis.
 *  - bindSmartSpectraIpc wires the SDK's private MessagePort channel to its native runtime here.
 *  - The API key is read here (.env or Keychain) and handed to the renderer once, via getConfig.
 */

const PEER2 = process.env.TOGETHER_PEER === '2' || process.argv.includes('--together-peer2');
// The e2e seam can never switch on in a packaged build.
const E2E = process.env.TOGETHER_E2E === '1' && !app.isPackaged;

// Separate profiles: peer2 and every e2e instance get their own userData (and so their own sessions).
const MAIN_PROFILE = join(app.getPath('appData'), 'Together');
if (E2E && process.env.TOGETHER_USER_DATA) app.setPath('userData', resolve(process.env.TOGETHER_USER_DATA));
else if (PEER2) app.setPath('userData', join(app.getPath('appData'), 'Together (peer 2)'));
else app.setPath('userData', MAIN_PROFILE);

// A packaged app loads SmartSpectra's native closure from resources/smartspectra/, because a .dylib cannot be
// dlopen'd from inside app.asar (Presage electron-quickstart main.js). Set unconditionally so it can't be redirected.
if (app.isPackaged) {
  const lib = { darwin: 'libsmartspectra_capi.dylib', win32: 'smartspectra_capi.dll', linux: 'libsmartspectra_capi.so' }[process.platform as string];
  if (lib) process.env.SMARTSPECTRA_CAPI_PATH = join(process.resourcesPath, 'smartspectra', lib);
}

if (E2E) {
  // Tests only: Chromium's built-in fake camera/mic feed the *call* media. Sensing is stubbed in e2e,
  // so no synthetic video ever reaches the SmartSpectra SDK.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

if (!E2E && !PEER2 && !app.requestSingleInstanceLock()) app.quit();

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
let win: BrowserWindow | null = null;

function isOwnOrigin(url: string): boolean {
  if (!url) return false;
  if (DEV_URL && !app.isPackaged) return url.startsWith(new URL(DEV_URL).origin);
  return url.startsWith('file://');
}

async function bindSdk(w: BrowserWindow) {
  try {
    const { bindSmartSpectraIpc } = await import('@smartspectra/node-sdk/main');
    bindSmartSpectraIpc(w, {
      logger: (level, msg) => {
        if (level === 'error') console.error(`[smartspectra] ${msg}`);
        else if (level === 'warn') console.warn(`[smartspectra] ${msg}`);
      },
    });
  } catch (err) {
    // The renderer surfaces this as "measurement unavailable" when start() times out.
    console.error('[together] SmartSpectra native runtime failed to load:', (err as Error).message);
  }
}

function createWindow() {
  const w = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 660,
    show: false,
    title: 'Together',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0b0a' : '#f3f1ed',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // A call must keep its clock-sync pings and signal batches on time when the window is behind others.
      backgroundThrottling: false,
    },
  });
  win = w;
  if (!E2E) void bindSdk(w);

  w.once('ready-to-show', () => w.show());
  w.on('closed', () => (win = null));

  // Never navigate away from the bundled page or open other windows (they would inherit the camera grant).
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, url) => {
    if (!isOwnOrigin(url)) e.preventDefault();
  });

  if (DEV_URL && !app.isPackaged) void w.loadURL(DEV_URL);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
}

const signals = new SignalManager();
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  // Close the embedded server cleanly so the port is free for the next launch.
  quitting = true;
  e.preventDefault();
  void Promise.race([signals.close(), new Promise((r) => setTimeout(r, 1500))]).finally(() => app.quit());
});

app.whenReady().then(async () => {
  app.setName('Together');
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(join(__dirname, '../../build/icon.png'));
  // Peer 2 can't own the camera, so it replays a recording made by the main profile (read only).
  const storage = new Storage(app.getPath('userData'), PEER2 && !E2E ? join(MAIN_PROFILE, 'recordings') : undefined);
  await storage.init();

  const env = { ...readDotEnv([process.cwd(), join(process.cwd(), '..', '..'), app.getPath('userData')]), ...pick(process.env) };
  // The app runs its own signaling server (not in automated runs, which start a real one per test).
  registerIpc({
    storage,
    window: () => win,
    base: { env, appVersion: app.getVersion(), peer2: PEER2, e2e: E2E, platform: process.platform },
    signal: E2E ? undefined : signals,
  });

  // Grant only camera+mic ('media'), only to our own page. Everything else is denied.
  // (SmartSpectra docs/nodejs.md, Permission flow: "Grant only the camera, and only to your own bundled page".)
  // Together also needs the microphone for the call, so audio is allowed alongside video.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details?.requestingUrl || wc?.getURL() || '';
    callback(permission === 'media' && isOwnOrigin(url));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && isOwnOrigin(origin));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
});

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => app.quit());

/** Only the variables Together reads; process.env as a whole is never forwarded. */
function pick(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys = ['SMARTSPECTRA_API_KEY', 'SIGNAL_URL', 'TURN_URL', 'TURN_USER', 'TURN_PASS', 'TOGETHER_PHASE_SCALE', 'TOGETHER_TEST_SEED'];
  return Object.fromEntries(keys.filter((k) => env[k]).map((k) => [k, env[k]!]));
}
