import { contextBridge, ipcRenderer } from 'electron';
import { CLOSE_REQUEST, IPC, type CounterfeedApi } from '../shared/ipc';

// SmartSpectra's preload bridge (exposes window.__smartspectraBridge for the renderer SDK).
// "If the app already has a preload script, require this module from it" (docs/nodejs.md, Preload).
import '@smartspectra/node-sdk/preload';

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const api = {
  ...Object.fromEntries(Object.entries(IPC).map(([name, channel]) => [name, call(channel)])),
  onCloseRequest(fn: () => void) {
    const h = () => fn();
    ipcRenderer.on(CLOSE_REQUEST, h);
    return () => ipcRenderer.removeListener(CLOSE_REQUEST, h);
  },
} as unknown as CounterfeedApi;

contextBridge.exposeInMainWorld('counterfeed', api);
