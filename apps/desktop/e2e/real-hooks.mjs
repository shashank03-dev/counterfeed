// Guided real-camera Hook test with the bundled demo pack (played in order, not shuffled). The person only watches
// (and smiles during one clip); the script swipes "Test card" after about a second and picks "Color drift" as the
// one they'd post. Then the ranking is checked. Real SDK, about 4 credits. Needs a person at the Mac.
//
//   npm run build && node e2e/real-hooks.mjs
import { join } from 'node:path';
import { ART, launchReal, log, saveRun, settle, speak } from './real-kit.mjs';

// Demo pack, alphabetical: Color drift, Fractal dive, Life, Slow reveal, Test card.
const ASK = { 2: { say: 'Smile at this one', voice: 'Smile at this one.' }, 5: { say: 'This one gets swiped', voice: 'This one gets skipped.' } };

const r = await launchReal();
const { app, page, errors, say, text } = r;
await say('Real hook test', 'Get ready', 'Sit facing the screen in good light', 'starting in 5 s');
speak('Real hook test starting in five seconds.');
await page.waitForTimeout(5000);

await page.click('[data-testid="start-hooks"]');
await page.click('[data-testid="demo-pack"]');
await page.waitForFunction(() => document.querySelectorAll('[data-testid="clip-item"][data-state="ok"]').length === 5, null, { timeout: 20000 });
if ((await page.getAttribute('[data-testid="shuffle"]', 'aria-checked').catch(() => null)) === 'true') await page.click('[data-testid="shuffle"]');
await page.fill('[data-testid="project-title"]', 'Real hook test').catch(() => {});
await page.click('[data-testid="consent-camera"]');
if (await page.isVisible('[data-testid="consent-pictures"]')) await page.click('[data-testid="consent-pictures"]');
await page.click('[data-testid="consent-wellness"]');
await page.click('[data-testid="start"]');

if (!(await settle(r, '[data-testid="clip-feed"][aria-hidden="false"]'))) {
  await app.close();
  process.exit(1);
}

let current = 0;
let swiped = false;
const seenAt = {};
while (await page.isVisible('[data-testid="clip-feed"][aria-hidden="false"]').catch(() => false)) {
  const m = /Clip (\d+) of/.exec((await text('[data-testid="clip-counter"]')) ?? '');
  const n = m ? Number(m[1]) : current;
  if (n !== current) {
    current = n;
    seenAt[n] = Date.now();
    log(`clip ${n}`);
    if (ASK[n]) speak(ASK[n].voice);
  }
  await say('Step 2 · watching', ASK[current]?.say ?? 'Just watch', 'Like you would in a feed', `clip ${current} of 5`);
  if (current === 5 && !swiped && Date.now() - seenAt[5] > 1200) {
    await page.keyboard.press('ArrowDown');
    swiped = true;
    log('swiped clip 5');
  }
  await page.waitForTimeout(200);
}
speak('Done. Thank you.');
await say('Done', 'Thanks! Building the report', 'You can relax');
await page.waitForSelector('[data-testid="pick"]', { timeout: 20000 });
await page.click('[data-testid="pick-0"]').catch(() => {});
await page.click('[data-testid="see-report"]');
await page.waitForSelector('[data-testid="hook-ranking"]', { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(ART, 'hooks-report-top.png') });
const report = await saveRun(page, 'rec-hooks', { asked: { smileAtClip: 2, swipedClip: 5 } });

console.log('\n=== Ranking ===');
console.table(report.clips.map((c) => ({ rank: c.rank, clip: c.name, status: c.status, first3s: c.hook, score: c.score, grabbedAt: c.grabbedAtMs === null ? '–' : `${(c.grabbedAtMs / 1000).toFixed(1)} s`, parts: c.parts.map((p) => `${p.key}=${p.value.toFixed(2)}`).join(' ') })));
const tc = report.clips.find((c) => c.name.startsWith('Test card'));
console.log('Swiped clip ranked last and lost in the first 3 s:', tc && tc.status === 'skipped' && tc.hook === 'lost' && tc.rank === 5 ? 'yes' : 'NO', tc ? `(${tc.status}, ${tc.hook}, rank ${tc.rank})` : '');
console.log('Smile clip shows a face part:', report.clips.find((c) => c.index === 1)?.parts.find((p) => p.key === 'face')?.value ?? 'none');
console.log('Summary:', report.summary);
console.log('Suggestion:', report.suggestion?.text);
console.log('Notes:', report.notes);
console.log('Page errors:', errors.length ? errors : 'none');
await app.evaluate(() => globalThis.__prompter?.close());
await app.close();
