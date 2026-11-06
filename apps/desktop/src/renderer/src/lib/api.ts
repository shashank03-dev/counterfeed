import type { TogetherApi } from '../../../shared/ipc';

declare global {
  interface Window {
    together: TogetherApi;
  }
}

/** The narrow main-process API exposed by the preload (window.together). */
export const api: TogetherApi = window.together;
