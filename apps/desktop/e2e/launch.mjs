import { _electron as electron } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const appDir = join(here, '..');

/**
 * Launch the built app as an isolated e2e instance: its own userData, the labelled test signal instead of the
 * camera measurement (no video ever reaches the SDK), and optionally shortened settle and session lengths.
 */
export async function launch({ name = 'a', timeScale = 1, theme, userData, env = {} } = {}) {
  const dir = userData ?? mkdtempSync(join(tmpdir(), `counterfeed-e2e-${name}-`));
  const app = await electron.launch({
    args: [join(appDir, 'out/main/index.js')],
    cwd: appDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      COUNTERFEED_E2E: '1',
      COUNTERFEED_USER_DATA: dir,
      COUNTERFEED_TIME_SCALE: String(timeScale),
      SMARTSPECTRA_API_KEY: '',
      ...env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (theme) {
    await page.evaluate((t) => {
      localStorage.setItem('counterfeed.prefs.v1', JSON.stringify({ theme: t }));
    }, theme);
    await page.reload();
  }
  await page.waitForSelector('[data-testid="nav-home"]', { timeout: 15000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return { app, page, dir, errors };
}
