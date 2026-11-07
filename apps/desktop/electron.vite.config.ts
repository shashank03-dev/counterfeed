import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

/**
 * Content Security Policy for the renderer.
 * - worker-src blob: is required by SmartSpectra: "The renderer runs a Web Worker from a `blob:` URL.
 *   If your app sets a CSP, allow `blob:` in `worker-src`" (docs/nodejs.md, Content Security Policy).
 * - media-src cfmedia: plays the demo video the person picked (main streams only that file).
 * - mediastream: shows the camera preview and samples the chosen window (screen capture stays in memory).
 * - Dev additionally needs inline scripts and the Vite HMR socket for React Refresh.
 */
function csp(): Plugin {
  let dev = false;
  return {
    name: 'counterfeed-csp',
    configResolved(c) {
      dev = c.command === 'serve';
    },
    transformIndexHtml(html) {
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' blob: mediastream: cfmedia:",
        "worker-src 'self' blob:",
        dev ? "connect-src 'self' ws:" : "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
      ].join('; ');
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

/** The app's own version, baked into main: run unpackaged, Electron would report its own version instead. */
const APP_VERSION = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version;

// Workspace TypeScript and the SDK preload are bundled (a sandboxed preload can only require 'electron').
const bundled = ['@counterfeed/shared', '@smartspectra/node-sdk'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@counterfeed/shared'] })],
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    build: { minify: true, rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundled })],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss(), csp()],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: {
      target: 'chrome140',
      minify: true,
      // One renderer chunk is fine for a desktop app loaded from disk; the SDK's protobuf codec dominates.
      chunkSizeWarningLimit: 1200,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    optimizeDeps: { include: ['@smartspectra/node-sdk/renderer', '@smartspectra/node-sdk/messages'] },
  },
});
