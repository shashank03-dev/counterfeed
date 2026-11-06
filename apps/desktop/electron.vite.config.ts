import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

/**
 * Content Security Policy for the renderer.
 * - worker-src blob: is required by SmartSpectra: "The renderer runs a Web Worker from a `blob:` URL.
 *   If your app sets a CSP, allow `blob:` in `worker-src`" (docs/nodejs.md, Content Security Policy).
 * - connect-src ws:/wss: for the signaling server (its URL is configurable).
 * - Dev additionally needs inline scripts and the Vite HMR socket for React Refresh.
 */
function csp(): Plugin {
  let dev = false;
  return {
    name: 'together-csp',
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
        "media-src 'self' blob: mediastream:",
        "worker-src 'self' blob:",
        'connect-src \'self\' ws: wss:',
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
      ].join('; ');
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

// Workspace TypeScript and the SDK preload are bundled (a sandboxed preload can only require 'electron').
const bundled = ['@together/shared', '@smartspectra/node-sdk'];

export default defineConfig({
  main: {
    // The signaling server (and ws) are bundled into main so the packaged app carries its own backend.
    plugins: [externalizeDepsPlugin({ exclude: ['@together/shared', '@together/signal', 'ws'] })],
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
