import { create } from 'zustand';
import type { SessionRecord } from '@together/shared';
import type { AppConfig, RecordingInfo } from '../../../shared/ipc';
import { api } from '../lib/api';

export type Route = 'home' | 'history' | 'diagnostics' | 'settings';
export type Theme = 'system' | 'dark' | 'light';

interface Prefs {
  theme: Theme;
  shareReactions: boolean;
  recordSignals: boolean;
  /** Full (2 + 3 min of breathing) or Short (1 + 1.5 min). Used when you start a room or practise. */
  sessionLength: 'full' | 'short';
}

const PREFS_KEY = 'together.prefs.v1';
function loadPrefs(): Prefs {
  const d: Prefs = { theme: 'system', shareReactions: false, recordSignals: false, sessionLength: 'full' };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return d;
  }
}

interface AppState {
  route: Route;
  config: AppConfig | null;
  prefs: Prefs;
  sessions: SessionRecord[] | null;
  recordings: RecordingInfo[] | null;
  go(route: Route): void;
  setPrefs(p: Partial<Prefs>): void;
  setConfig(c: AppConfig): void;
  refresh(): Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  route: 'home',
  config: null,
  prefs: loadPrefs(),
  sessions: null,
  recordings: null,
  go: (route) => set({ route }),
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
    set({ prefs });
  },
  setConfig: (config) => set({ config }),
  refresh: async () => {
    const [sessions, recordings] = await Promise.all([api.listSessions().catch(() => []), api.listRecordings().catch(() => [])]);
    set({ sessions, recordings });
  },
}));

/** Apply the theme to <html data-theme>, following the system when asked. */
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
