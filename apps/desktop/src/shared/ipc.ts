import type { ExportFile, Report, Thumbs } from '@counterfeed/shared';

/** Everything the renderer learns about its environment, sent once at startup. */
export interface AppConfig {
  appVersion: string;
  /** SmartSpectra key (from .env or the Keychain). Never logged. */
  apiKey: string | null;
  apiKeySource: 'env' | 'keychain' | null;
  /** Automated end-to-end test run. Never true in a packaged app. */
  e2e: boolean;
  /** Phase length multiplier (1 normally; smaller only in e2e runs). */
  timeScale: number;
  /** Which scripted test signal an e2e run uses ('laptop': chest out of view, head turns hidden behind it;
   *  'focus': a long look down in the middle of a focus session). */
  testScenario: 'default' | 'laptop' | 'focus';
  /** Developer runs only (never packaged): keep the raw samples of the last session on the page for inspection. */
  recordRaw: boolean;
  platform: string;
  keychainAvailable: boolean;
}

/** A window or screen that can be watched. The thumbnail is a small preview for the picker only. */
export interface ContentSourceInfo {
  id: string;
  kind: 'window' | 'screen' | 'test';
  name: string;
  app: string | null;
  thumb: string | null;
  /** iPhone Mirroring: your real phone apps on the Mac. Shown first. */
  iphone: boolean;
}

export interface SourceList {
  /** macOS Screen Recording permission. Without it only this app's own windows are listed. */
  access: MediaAccess;
  sources: ContentSourceInfo[];
}

export interface PickedVideo {
  /** cfmedia://video/<token>: streams only the file the person picked. */
  url: string;
  name: string;
}

/** The app in front (focus sessions). `self`: Counterfeed's own bar was clicked. */
export interface FrontApp {
  name: string;
  self: boolean;
}

export type MediaKind = 'camera' | 'screen';
export type MediaAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

/** The narrow API the preload exposes as `window.counterfeed`. */
export interface CounterfeedApi {
  getConfig(): Promise<AppConfig>;
  setApiKey(key: string | null): Promise<AppConfig>;

  saveReport(r: Report, thumbs: Thumbs): Promise<void>;
  listReports(): Promise<Report[]>;
  readThumbs(id: string): Promise<Thumbs>;
  deleteReport(id: string): Promise<void>;
  deleteAll(): Promise<{ reports: number }>;
  exportAll(): Promise<{ saved: boolean; path?: string; count: number }>;
  /** Open a Counterfeed export file. Reports are shown read-only and never merged into History. */
  openReportFile(): Promise<{ file: ExportFile; name: string } | { error: string } | null>;

  listSources(): Promise<SourceList>;
  pickVideo(): Promise<PickedVideo | null>;
  /** Hook test: pick several clips at once (at most MAX_CLIPS; `dropped` counts any beyond that). */
  pickClips(): Promise<{ clips: PickedVideo[]; dropped: number } | null>;
  /** Hook test: the bundled demo pack (short procedural clips shipped with the app). */
  demoPack(): Promise<PickedVideo[]>;
  /** Shrink to a small always-on-top bar while you scroll another window, and back. */
  setCompact(on: boolean): Promise<void>;
  /** Tell main a session is running, so closing the window asks the page to finish first. */
  setBusy(busy: boolean): Promise<void>;
  /** Close after the page has saved what it had. */
  quit(): Promise<void>;

  /** Focus session: the app in front right now (names only). null when it can't be read. */
  frontApp(): Promise<FrontApp | null>;
  /** Focus session: whether the two Shortcuts that switch Do Not Disturb exist. */
  focusShortcuts(): Promise<{ ready: boolean; missing: string[] }>;
  /** Turn Do Not Disturb on or off through those Shortcuts. False if it failed (or isn't set up). */
  setDnd(on: boolean): Promise<boolean>;
  /** Open the Shortcuts app, to make the two shortcuts. */
  openShortcuts(): Promise<void>;

  mediaAccess(kind: MediaKind): Promise<MediaAccess>;
  askCameraAccess(): Promise<boolean>;
  openPrivacySettings(kind: MediaKind): Promise<void>;
  openExternal(url: 'presage-docs' | 'presage-keys' | 'model-cards'): Promise<void>;

  /** Main asks the page to wrap up (window close during a session). Returns an unsubscribe. */
  onCloseRequest(fn: () => void): () => void;
}

export const IPC = {
  getConfig: 'cf:config',
  setApiKey: 'cf:api-key',
  saveReport: 'cf:report-save',
  listReports: 'cf:report-list',
  readThumbs: 'cf:report-thumbs',
  deleteReport: 'cf:report-delete',
  deleteAll: 'cf:delete-all',
  exportAll: 'cf:export',
  openReportFile: 'cf:open-file',
  listSources: 'cf:sources',
  pickVideo: 'cf:pick-video',
  pickClips: 'cf:pick-clips',
  demoPack: 'cf:demo-pack',
  setCompact: 'cf:compact',
  setBusy: 'cf:busy',
  quit: 'cf:quit',
  frontApp: 'cf:front-app',
  focusShortcuts: 'cf:focus-shortcuts',
  setDnd: 'cf:dnd',
  openShortcuts: 'cf:open-shortcuts',
  mediaAccess: 'cf:media-access',
  askCameraAccess: 'cf:camera-ask',
  openPrivacySettings: 'cf:privacy',
  openExternal: 'cf:open-external',
} as const satisfies Record<Exclude<keyof CounterfeedApi, 'onCloseRequest'>, string>;

export const CLOSE_REQUEST = 'cf:close-request';
