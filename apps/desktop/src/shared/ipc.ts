import type { SessionRecord } from '@together/shared';

/** Everything the renderer learns about its environment, sent once at startup. */
export interface AppConfig {
  appVersion: string;
  /** SmartSpectra key (from .env or the Keychain). Never logged. */
  apiKey: string | null;
  apiKeySource: 'env' | 'keychain' | null;
  signalUrl: string;
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  turnConfigured: boolean;
  /** Second dev instance (`npm run dev:peer2`): no camera; partner signals come from a recording. */
  peer2: boolean;
  /** Automated end-to-end test run. Never true in a packaged app. */
  e2e: boolean;
  /** Phase length multiplier (1 normally; smaller only in e2e runs). */
  phaseScale: number;
  /** Seed for the e2e test signal (0 outside e2e). */
  testSeed: number;
  platform: string;
  keychainAvailable: boolean;
  /** The signaling server this app runs or uses (see main/signal.ts). */
  signalHost: SignalHost;
}

/**
 * embedded: this app runs the server; shared: another Together server on this Mac is used;
 * remote: the configured server is elsewhere; failed: the local port is taken by something else;
 * off: not managed (automated test runs).
 */
export interface SignalHost {
  mode: 'embedded' | 'shared' | 'remote' | 'failed' | 'off';
  port: number | null;
  /** This Mac's network addresses, for a second Mac to connect to. */
  lan: string[];
  reason?: 'port-in-use' | 'error';
}

export interface UserSettings {
  signalUrl?: string | null;
  turnUrl?: string | null;
  turnUser?: string | null;
  turnPass?: string | null;
}

export interface RecordingInfo {
  id: string;
  recordedAt: number;
  durationMs: number;
  bytes: number;
}

export type MediaKind = 'camera' | 'microphone';
export type MediaAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

/** The narrow API the preload exposes as `window.together`. */
export interface TogetherApi {
  getConfig(): Promise<AppConfig>;
  saveSettings(s: UserSettings): Promise<AppConfig>;
  setApiKey(key: string | null): Promise<AppConfig>;

  saveSession(r: SessionRecord): Promise<void>;
  listSessions(): Promise<SessionRecord[]>;
  deleteSession(id: string): Promise<void>;
  exportAll(): Promise<{ saved: boolean; path?: string; count: number }>;
  deleteAll(): Promise<{ sessions: number; recordings: number }>;

  recordingStart(): Promise<string>;
  recordingAppend(id: string, lines: string[]): Promise<void>;
  recordingFinish(id: string): Promise<RecordingInfo | null>;
  listRecordings(): Promise<RecordingInfo[]>;
  readRecording(id: string): Promise<string>;
  deleteRecording(id: string): Promise<void>;

  mediaAccess(kind: MediaKind): Promise<MediaAccess>;
  askMediaAccess(kind: MediaKind): Promise<boolean>;
  openPrivacySettings(kind: MediaKind): Promise<void>;
  openExternal(url: 'presage-docs' | 'presage-keys' | 'model-cards'): Promise<void>;
}

export const IPC = {
  getConfig: 'together:config',
  saveSettings: 'together:settings',
  setApiKey: 'together:api-key',
  saveSession: 'together:session-save',
  listSessions: 'together:session-list',
  deleteSession: 'together:session-delete',
  exportAll: 'together:export',
  deleteAll: 'together:delete-all',
  recordingStart: 'together:rec-start',
  recordingAppend: 'together:rec-append',
  recordingFinish: 'together:rec-finish',
  listRecordings: 'together:rec-list',
  readRecording: 'together:rec-read',
  deleteRecording: 'together:rec-delete',
  mediaAccess: 'together:media-access',
  askMediaAccess: 'together:media-ask',
  openPrivacySettings: 'together:media-settings',
  openExternal: 'together:open-external',
} as const satisfies Record<keyof TogetherApi, string>;
