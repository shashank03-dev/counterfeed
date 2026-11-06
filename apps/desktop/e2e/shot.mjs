import { launch } from './launch.mjs';
const out = process.argv[2] ?? '/tmp';
const theme = process.argv[3] ?? 'dark';
const { app, page, errors } = await launch({ theme });
await page.setViewportSize?.({ width: 1280, height: 840 }).catch(() => {});
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/home-${theme}.png` });
for (const r of ['history', 'diagnostics', 'settings']) {
  await page.click(`[data-testid="nav-${r}"]`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${r}-${theme}.png` });
}
console.log('errors:', JSON.stringify(errors));
await app.close();
