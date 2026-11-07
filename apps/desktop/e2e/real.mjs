// Guided real-camera test. Runs the real SmartSpectra SDK (uses credits: ~1 per 30 s, about 8 in total).
// A prompter window tells the person in front of the camera what to do; afterwards the saved report is
// checked against what they were asked to do, and when.
//
//   npm run build && node e2e/real.mjs
//
// Saves the raw session (COUNTERFEED_RECORD=1) to e2e/artifacts/real/capture.json, which is git-ignored.
// Needs a person at the Mac, SMARTSPECTRA_API_KEY in .env (or the Keychain), and camera access.
// The report is saved to the app's normal History (this is the real app, not the isolated test instance).
import { _electron as electron } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDir } from './launch.mjs';

const ART = join(appDir, 'e2e', 'artifacts', 'real');
mkdirSync(ART, { recursive: true });

// What we ask the person to do, in seconds since watching started.
const PLAN = [
  { from: 0, to: 15, say: 'Breathe and blink normally', sub: 'Just look at this screen' },
  { from: 15, to: 18, say: 'Breathe out gently…', sub: 'Get ready to hold', kind: 'prep' },
  { from: 18, to: 30, say: 'HOLD your breath', sub: 'Stay still, keep looking at the screen', kind: 'hold' },
  { from: 30, to: 42, say: 'Breathe normally again', sub: 'Relax' },
  { from: 42, to: 57, say: 'Stare: try not to blink', sub: 'As long as it is comfortable; blink if you need to', kind: 'noblink' },
  { from: 57, to: 62, say: 'Blink and relax', sub: '' },
  { from: 62, to: 70, say: 'Big smile 😀', sub: 'Keep smiling', kind: 'smile' },
  { from: 70, to: 76, say: 'Relax your face', sub: '' },
  { from: 76, to: 84, say: 'Turn your head to the side', sub: 'Look away from the screen, like at someone next to you', kind: 'away' },
  { from: 84, to: 90, say: 'Look back at the screen', sub: '' },
  { from: 90, to: 97, say: 'Look down at your lap', sub: 'Like checking your phone', kind: 'away' },
  { from: 97, to: 103, say: 'Look back at the screen', sub: '' },
  { from: 103, to: 108, say: 'Sit back a little', sub: 'So your shoulders and upper chest are in the camera', kind: 'prep' },
  { from: 108, to: 120, say: 'Stay sat back · breathe normally', sub: 'Look at this screen' },
  { from: 120, to: 123, say: 'Breathe out gently…', sub: 'Get ready to hold (stay sat back)', kind: 'prep' },
  { from: 123, to: 135, say: 'HOLD your breath', sub: 'Stay sat back and still', kind: 'hold' },
  { from: 135, to: 145, say: 'Breathe normally', sub: 'Almost done' },
];
const END = 145;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

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

// Prompter: a separate always-on-top window in the main process.
await app.evaluate(({ BrowserWindow, screen }) => {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const w = new BrowserWindow({ width: 720, height: 300, x: Math.round(width / 2 - 360), y: 220, alwaysOnTop: true, frame: false, focusable: false, backgroundColor: '#151514', show: true });
  w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;font:600 15px -apple-system,system-ui;color:#eeeeec;background:#151514;display:grid;place-items:center;height:100vh;text-align:center">
    <div><div id=k style="color:#7c7b74;letter-spacing:.08em;text-transform:uppercase;font-size:12px">Real test</div>
    <div id=s style="font-size:44px;margin:14px 0 8px;letter-spacing:-.02em">Get ready</div>
    <div id=u style="color:#b5b3ad;font-weight:500">Sit facing the screen in good light</div>
    <div id=c style="margin-top:18px;color:#ff977d;font-variant-numeric:tabular-nums;font-size:20px"></div></div></body>`));
  globalThis.__prompter = w;
});
const say = (k, s, u, c = '') =>
  app.evaluate((_e, a) => globalThis.__prompter?.webContents.executeJavaScript(`k.textContent=${JSON.stringify(a.k)};s.textContent=${JSON.stringify(a.s)};u.textContent=${JSON.stringify(a.u)};c.textContent=${JSON.stringify(a.c)}`), { k, s, u, c }).catch(() => {});
const text = (sel) => page.textContent(sel, { timeout: 500 }).catch(() => null);

await say('Real test', 'Get ready', 'Sit facing the screen in good light', 'starting in 5 s');
await page.waitForTimeout(5000);

// Setup: Feed check, without pictures (no screen recording needed), until I stop.
await page.click('[data-testid="start-feed"]');
await page.waitForSelector('[data-testid="sources"]');
await page.click('[data-testid="source-none"]');
await page.fill('[data-testid="content-name"]', 'Real camera test');
await page.click('[role="radio"]:has-text("Until I stop")');
await page.click('[data-testid="consent-camera"]');
if (await page.isVisible('[data-testid="consent-pictures"]')) await page.click('[data-testid="consent-pictures"]');
await page.click('[data-testid="consent-wellness"]');
await page.click('[data-testid="start"]');
await page.waitForSelector('[data-testid="felt-before"]');
await page.click('[data-testid="felt-before-4"]');
await page.click('[data-testid="continue"]');

// Settle: learn the person's normal.
log('settle: learning your normal');
const settleStart = Date.now();
let watching = false;
let lastHint = '';
while (Date.now() - settleStart < 150000) {
  if (await page.isVisible('[data-testid="watch-bar"]')) { watching = true; break; }
  const prob = await page.isVisible('[data-testid="problem-title"]').catch(() => false);
  if (prob) break;
  const hint = (await text('[data-testid="settle-hint"]'))?.trim() ?? '';
  if (hint !== lastHint) { log('settle hint:', hint || '(none)'); lastHint = hint; }
  // Nobody in front of the camera: stop early instead of spending credits on an empty room.
  if (Date.now() - settleStart > 20000 && /no face/i.test(hint) && !(await page.evaluate(() => document.querySelector('[data-testid="settle-progress"]')?.getAttribute('aria-valuenow') > 0).catch(() => false))) {
    log('ABORTED: no face in front of the camera after 20 s. Nothing was measured.');
    await say('Stopped', 'No face found', 'Sit in front of the camera and run the test again');
    await page.waitForTimeout(3000);
    await app.close();
    process.exit(2);
  }
  if (await page.isVisible('[data-testid="force-continue"]')) { log('settle took > 90 s; pressing Continue anyway'); await page.click('[data-testid="force-continue"]'); }
  const s = Math.round((Date.now() - settleStart) / 1000);
  await say('Step 1 of 2 · learning your normal', 'Breathe and blink normally', hint || 'Look at this screen, sit still', `${s} s`);
  await page.waitForTimeout(500);
}
if (!watching) {
  await page.screenshot({ path: join(ART, 'fail-settle.png') });
  log('FAILED: never reached watching.', (await text('body'))?.slice(0, 400));
  await app.close();
  process.exit(1);
}
log(`settle done in ${Math.round((Date.now() - settleStart) / 1000)} s`);

// Watch: guided actions, logging the live cue the bar shows.
const t0 = Date.now();
const cues = [];
let lastCue = '';
let shotHold = false;
while (true) {
  const sec = (Date.now() - t0) / 1000;
  if (sec >= END) break;
  const step = PLAN.find((p) => sec >= p.from && sec < p.to) ?? PLAN.at(-1);
  await say('Step 2 of 2 · watching', step.say, step.sub, `${Math.ceil(step.to - sec)} s`);
  const cue = (await text('[data-testid="cue"]'))?.trim() ?? '';
  if (cue !== lastCue) { cues.push({ sec: +sec.toFixed(1), cue }); log(`  ${sec.toFixed(1)} s  cue: ${cue}`); lastCue = cue; }
  if (!shotHold && cue.includes('Breathing paused')) { shotHold = true; await page.screenshot({ path: join(ART, 'bar-hold.png') }); }
  await page.waitForTimeout(250);
}
await say('Done', 'Thanks! Building the report', 'You can relax');
await page.click('[data-testid="stop"]');
await page.waitForSelector('[data-testid="see-report"]', { timeout: 20000 });
await page.click('[data-testid="felt-after-3"]');
await page.click('[data-testid="see-report"]');
await page.waitForSelector('[data-testid="report"]', { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(ART, 'report-top.png') });
await page.screenshot({ path: join(ART, 'report-full.png'), fullPage: true });

// Compare the saved report with the plan.
const list = await page.evaluate(() => window.counterfeed.listReports());
const report = (list.reports ?? list).sort((a, b) => b.endedAt - a.endedAt)[0];
writeFileSync(join(ART, 'report.json'), JSON.stringify({ report, cues }, null, 2));
const raw = await page.evaluate(() => ({ last: window.__counterfeedLast ?? null, landmarks: window.__counterfeedRawLandmarks ?? [] }));
// The raw session (local only, git-ignored): replayed by test/renderer/real-replay.test.ts to tune detectors.
writeFileSync(join(ART, 'capture.json'), JSON.stringify({ plan: PLAN, watchStartWallMs: t0, cues, capture: raw.last?.capture ?? null, landmarks: raw.landmarks }));
log('raw capture saved:', raw.last ? 'yes' : 'NO', `${raw.landmarks.length} landmark sets`);
const TOL = 4000;
const rows = PLAN.filter((p) => p.kind && p.kind !== 'prep').map((p) => {
  const lo = p.from * 1000 - TOL;
  const hi = p.to * 1000 + TOL;
  const kinds = p.kind === 'smile' ? ['smile'] : [p.kind];
  const hit = report.events.filter((e) => kinds.includes(e.kind) && e.atMs + e.durMs >= lo && e.atMs <= hi);
  return { asked: `${p.say} (${p.from}-${p.to} s)`, found: hit.length ? hit.map((e) => `${e.kind} @${(e.atMs / 1000).toFixed(1)} s for ${(e.durMs / 1000).toFixed(1)} s`).join('; ') : 'NOT FOUND' };
});
const stray = report.events.filter((e) => !PLAN.some((p) => p.kind && p.kind !== 'prep' && e.kind === p.kind && e.atMs + e.durMs >= p.from * 1000 - TOL && e.atMs <= p.to * 1000 + TOL));
console.log('\n=== What you were asked to do vs what the report found ===');
console.table(rows);
console.log('Other events (not asked for):', stray.map((e) => `${e.kind} @${(e.atMs / 1000).toFixed(1)} s ${(e.durMs / 1000).toFixed(1)} s`).join(', ') || 'none');
console.log('\nBaseline:', report.baseline);
console.log('Metrics:', report.metrics);
console.log('Pull:', report.pull.score, report.pull.parts.map((p) => `${p.key}=${p.value}`).join(' '));
console.log('Summary:', report.summary);
console.log('Suggestion:', report.suggestion);
console.log('Notes:', report.notes);
console.log('Page errors:', errors.length ? errors : 'none');
await app.evaluate(() => globalThis.__prompter?.close());
await app.close();
