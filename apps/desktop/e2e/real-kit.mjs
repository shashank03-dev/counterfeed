// Shared plumbing for the guided real-camera runs (real SmartSpectra SDK; uses credits, ~1 per 30 s).
// A prompter window (always on top) tells the person what to do, the key moments are also spoken aloud
// (macOS `say`), settling stops early if nobody is at the camera, and the raw session is saved to the
// git-ignored e2e/artifacts/real/ folder for replay in the unit tests.
import { _electron as electron } from 'playwright-core';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDir } from './launch.mjs';

export const ART = join(appDir, 'e2e', 'artifacts', 'real');
mkdirSync(ART, { recursive: true });
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Speak a short line aloud (so the person can follow without looking at the screen). */
export const speak = (line) => execFile('/usr/bin/say', ['-r', '185', line], () => {});

export async function launchReal() {
  const app = await electron.launch({
    args: [join(appDir, 'out/main/index.js')],
    cwd: appDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', COUNTERFEED_E2E: '', COUNTERFEED_RECORD: '1' },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.waitForSelector('[data-testid="nav-home"]', { timeout: 20000 });
  await app.evaluate(({ BrowserWindow, screen }) => {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    const w = new BrowserWindow({ width: 720, height: 300, x: Math.round(width / 2 - 360), y: 220, alwaysOnTop: true, frame: false, focusable: false, backgroundColor: '#121211', show: true });
    w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;font:600 15px -apple-system,system-ui;color:#eeeeec;background:#121211;display:grid;place-items:center;height:100vh;text-align:center">
      <div><div id=k style="color:#8f8e87;letter-spacing:.08em;text-transform:uppercase;font-size:12px">Real test</div>
      <div id=s style="font-size:40px;margin:14px 0 8px;letter-spacing:-.02em">Get ready</div>
      <div id=u style="color:#b5b3ad;font-weight:500">Sit facing the screen in good light</div>
      <div id=c style="margin-top:18px;color:#ff977d;font-variant-numeric:tabular-nums;font-size:20px"></div></div></body>`));
    globalThis.__prompter = w;
  });
  const say = (k, s, u, c = '') =>
    app.evaluate((_e, a) => globalThis.__prompter?.webContents.executeJavaScript(`k.textContent=${JSON.stringify(a.k)};s.textContent=${JSON.stringify(a.s)};u.textContent=${JSON.stringify(a.u)};c.textContent=${JSON.stringify(a.c)}`), { k, s, u, c }).catch(() => {});
  const text = (sel) => page.textContent(sel, { timeout: 500 }).catch(() => null);
  return { app, page, errors, say, text };
}

/**
 * Wait through settle (your normal) until watching starts (`ready` selector). Stops the run without measuring if no
 * face shows up within 20 s. Returns false if watching never started.
 */
export async function settle({ app, page, say, text }, ready) {
  log('settle: learning your normal');
  speak('Look at the screen and breathe normally.');
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 150000) {
    if (await page.isVisible(ready).catch(() => false)) {
      log(`settle done in ${Math.round((Date.now() - start) / 1000)} s`);
      return true;
    }
    if (await page.isVisible('[data-testid="problem-title"]').catch(() => false)) break;
    const hint = (await text('[data-testid="settle-hint"]'))?.trim() ?? '';
    if (hint !== last) {
      log('settle hint:', hint || '(none)');
      last = hint;
    }
    const progress = await page.evaluate(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? 0)).catch(() => 0);
    if (Date.now() - start > 20000 && /no face|frame/i.test(hint) && progress === 0) {
      log('ABORTED: no face in front of the camera after 20 s. Nothing was measured.');
      await say('Stopped', 'No face found', 'Sit in front of the camera and run the test again');
      await page.waitForTimeout(2500);
      await page.click('[data-testid="cancel"]').catch(() => {});
      await app.close();
      process.exit(2);
    }
    if (await page.isVisible('[data-testid="force-continue"]')) await page.click('[data-testid="force-continue"]');
    await say('Step 1 · learning your normal', 'Breathe and blink normally', hint || 'Look at this screen, sit still', `${Math.round((Date.now() - start) / 1000)} s`);
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: join(ART, 'fail-settle.png') });
  log('FAILED: never reached watching.', (await text('body'))?.slice(0, 300));
  return false;
}

/** Save the newest report, the raw session and the per-frame eye points (all local, git-ignored). */
export async function saveRun(page, name, extra) {
  const list = await page.evaluate(() => window.counterfeed.listReports());
  const report = list.sort((a, b) => b.endedAt - a.endedAt)[0];
  const raw = await page.evaluate(() => ({ last: window.__counterfeedLast ?? null, landmarks: window.__counterfeedRawLandmarks ?? [], eyes: window.__counterfeedRawEyes ?? [] }));
  writeFileSync(join(ART, `${name}.json`), JSON.stringify({ ...extra, report, capture: raw.last?.capture ?? null, landmarks: raw.landmarks, eyes: raw.eyes }));
  log(`saved ${name}.json: raw capture ${raw.last ? 'yes' : 'NO'}, ${raw.landmarks.length} landmark sets, ${raw.eyes.length} eye frames`);
  return report;
}
