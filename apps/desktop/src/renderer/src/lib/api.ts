import type { CounterfeedApi } from '../../../shared/ipc';

declare global {
  interface Window {
    counterfeed: CounterfeedApi;
  }
}

/** The narrow main-process API exposed by the preload (window.counterfeed). */
export const api: CounterfeedApi = window.counterfeed;
