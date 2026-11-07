import { app, BrowserWindow, nativeTheme, protocol, screen, session, shell, type Rectangle } from 'electron';
import { join, resolve } from 'node:path';
import { allowPermission, readDotEnv, shortcutsBin } from './config';
import { Dnd } from './mac';
import { registerIpc } from './ipc';
import { MEDIA_SCHEME, MediaRegistry } from './media';
import { Storage } from './storage';
import { CLOSE_REQUEST } from '../shared/ipc';

/*
 * Counterfeed: main process.
 *  - One window. The renderer runs the SmartSpectra renderer SDK, screen capture of the chosen window, and all
 *    analysis. bindSmartSpectraIpc wires the SDK's private MessagePort channel to its native runtime here.
 *  - The API key is read here (.env or Keychain) and handed to the renderer once, via getConfig.
 *  - While you scroll another app, the window shrinks to a small always-on-top bar (setCompact).
 */

// The e2e seam can never switch on in a packaged build.
const E2E = process.env.COUNTERFEED_E2E === '1' && !app.isPackaged;
if (E2E && process.env.COUNTERFEED_USER_DATA) app.setPath('userData', resolve(process.env.COUNTERFEED_USER_DATA));
else app.setPath('userData', join(app.getPath('appData'), 'Counterfeed'));

// A packaged app loads SmartSpectra's native closure from resources/smartspectra/, because a .dylib cannot be
// dlopen'd from inside app.asar (Presage electron-quickstart main.js).
if (app.isPackaged) {
  const lib = { darwin: 'libsmartspectra_capi.dylib', win32: 'smartspectra_capi.dll', linux: 'libsmartspectra_capi.so' }[process.platform as string];
  if (lib) process.env.SMARTSPECTRA_CAPI_PATH = join(process.resourcesPath, 'smartspectra', lib);
}

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!E2E && !app.requestSingleInstanceLock()) app.quit();

/** Set at build time from package.json (electron.vite.config.ts). */
declare const __APP_VERSION__: string;

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const media = new MediaRegistry();
let win: BrowserWindow | null = null;
let busy = false;
let closing = false;
let normalBounds: Rectangle | null = null;

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
    console.error('[counterfeed] SmartSpectra native runtime failed to load:', (err as Error).message);
  }
}

const MIN = { width: 1040, height: 700 };
const BAR = { width: 380, height: 112 };

/** Small always-on-top bar in the top-right of the current display, so it never covers the feed. */
function setCompact(on: boolean) {
  const w = win;
  if (!w) return;
  if (on) {
    if (!normalBounds) normalBounds = w.getBounds();
    const area = screen.getDisplayMatching(w.getBounds()).workArea;
    w.setMinimumSize(BAR.width, BAR.height);
    w.setBounds({ x: area.x + area.width - BAR.width - 16, y: area.y + 16, width: BAR.width, height: BAR.height }, true);
    w.setResizable(false);
    w.setAlwaysOnTop(true, 'floating');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === 'darwin') w.setWindowButtonVisibility(false);
  } else {
    w.setAlwaysOnTop(false);
    w.setVisibleOnAllWorkspaces(false);
    w.setResizable(true);
    if (process.platform === 'darwin') w.setWindowButtonVisibility(true);
    w.setMinimumSize(MIN.width, MIN.height);
    if (normalBounds) w.setBounds(normalBounds, true);
    normalBounds = null;
    w.focus();
  }
}

function createWindow() {
  const w = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: MIN.width,
    minHeight: MIN.height,
    show: false,
    title: 'Counterfeed',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0b0a' : '#f2f0ec',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Measurement and screen sampling must keep running while you look at another app.
      backgroundThrottling: false,
    },
  });
  win = w;
  if (!E2E) void bindSdk(w);

  w.once('ready-to-show', () => w.show());
  // Closing during a session: let the page save what it has first, then it calls quit().
  w.on('close', (e) => {
    if (busy && !closing) {
      e.preventDefault();
      w.webContents.send(CLOSE_REQUEST);
    }
  });
  w.on('closed', () => (win = null));

  // Never navigate away from the bundled page or open other windows (they would inherit the camera grant).
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, url) => {
    if (!isOwnOrigin(url)) e.preventDefault();
  });

  if (DEV_URL && !app.isPackaged) void w.loadURL(DEV_URL);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  app.setName('Counterfeed');
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(join(__dirname, '../../build/icon.png'));
  const storage = new Storage(app.getPath('userData'));
  await storage.init();

  protocol.handle(MEDIA_SCHEME, (req) => media.respond(req.url, req.headers.get('range')));

  const env = { ...readDotEnv([process.cwd(), join(process.cwd(), '..', '..'), app.getPath('userData')]), ...pick(process.env) };
  // Do Not Disturb (focus sessions): put right a session that ended without turning it off, and always turn it off
  // when Counterfeed quits.
  const dnd = new Dnd(shortcutsBin({ e2e: E2E, packaged: app.isPackaged, platform: process.platform, env }), app.getPath('userData'));
  void dnd.recover();
  app.on('will-quit', () => dnd.offSync());
  registerIpc({
    dnd,
    storage,
    media,
    window: () => win,
    // Shipped next to the app (electron-builder extraResources); in development, straight from the repo.
    demoDir: app.isPackaged ? join(process.resourcesPath, 'demo-pack') : join(__dirname, '../../resources/demo-pack'),
    base: { env, appVersion: app.isPackaged ? app.getVersion() : __APP_VERSION__, e2e: E2E, packaged: app.isPackaged, platform: process.platform },
    setCompact,
    setBusy: (b) => (busy = b),
    quit: () => {
      closing = true;
      app.quit();
    },
  });

  // Grant only the camera and capturing the chosen window, only to our own page. Everything else is denied.
  // (SmartSpectra docs/nodejs.md, Permission flow: "Grant only the camera, and only to your own bundled page".)
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details?.requestingUrl || wc?.getURL() || '';
    callback(allowPermission(permission, (details as { mediaTypes?: string[] } | undefined)?.mediaTypes, isOwnOrigin(url)));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowPermission(permission, undefined, isOwnOrigin(origin)));

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

/** Only the variables Counterfeed reads; process.env as a whole is never forwarded. */
function pick(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys = ['SMARTSPECTRA_API_KEY', 'COUNTERFEED_TIME_SCALE', 'COUNTERFEED_TEST_SCENARIO', 'COUNTERFEED_RECORD', 'COUNTERFEED_SHORTCUTS_BIN'];
  return Object.fromEntries(keys.filter((k) => env[k]).map((k) => [k, env[k]!]));
}
