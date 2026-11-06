import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type TogetherApi } from '../shared/ipc';

// SmartSpectra's preload bridge (exposes window.__smartspectraBridge for the renderer SDK).
// "If the app already has a preload script, require this module from it" (docs/nodejs.md, Preload).
import '@smartspectra/node-sdk/preload';

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const api = Object.fromEntries(Object.entries(IPC).map(([name, channel]) => [name, call(channel)])) as unknown as TogetherApi;

contextBridge.exposeInMainWorld('together', api);
