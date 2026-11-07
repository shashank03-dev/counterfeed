import { create } from 'zustand';
import type { Report, Thumbs } from '@counterfeed/shared';
import type { AppConfig } from '../../../shared/ipc';
import { api } from '../lib/api';

export type Route = 'home' | 'history' | 'camera' | 'settings' | 'report';
export type Theme = 'system' | 'dark' | 'light';

interface Prefs {
  theme: Theme;
  /** Last feed length chosen (ms; 0 = until I stop). */
  feedLength: number;
  nudges: boolean;
  /** Focus sessions: last length (ms; 0 = until I stop), Do Not Disturb, app tracking and the nudge. */
  focusLength: number;
  focusDnd: boolean;
  focusApps: boolean;
  focusNudges: boolean;
}

const PREFS_KEY = 'counterfeed.prefs.v1';
function loadPrefs(): Prefs {
  const d: Prefs = { theme: 'system', feedLength: 5 * 60_000, nudges: false, focusLength: 25 * 60_000, focusDnd: true, focusApps: true, focusNudges: false };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return d;
  }
}

/** A report open in the viewer: from History (yours) or from a file someone sent (read-only). */
export interface OpenReport {
  report: Report;
  thumbs: Thumbs;
  from: 'history' | 'file';
  fileName?: string;
}

interface AppState {
  route: Route;
  config: AppConfig | null;
  prefs: Prefs;
  reports: Report[] | null;
  open: OpenReport | null;
  /** Reports from an opened file, shown in History under their own heading. */
  imported: { name: string; reports: Report[] } | null;
  go(route: Route): void;
  setPrefs(p: Partial<Prefs>): void;
  setConfig(c: AppConfig): void;
  refresh(): Promise<void>;
  openReport(o: OpenReport): void;
}

export const useApp = create<AppState>((set, get) => ({
  route: 'home',
  config: null,
  prefs: loadPrefs(),
  reports: null,
  open: null,
  imported: null,
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
    const reports = await api.listReports().catch(() => []);
    set({ reports });
  },
  openReport: (open) => set({ open, route: 'report' }),
}));

/** Apply the theme to <html data-theme>, following the system when asked. */
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
