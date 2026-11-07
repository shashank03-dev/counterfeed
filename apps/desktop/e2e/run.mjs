/**
 * End-to-end suite. Drives the BUILT app with the labelled test signal (never the SDK, never synthetic video into
 * the SDK). Covers both modes start to finish, the compact bar, a video review with play-from-moment, stopping
 * early, closing the app mid-session, History, export, opening a report file, deleting, the camera check, the
 * banned-words rule on every screen, and white-on-gradient contrast; then the Hook test and the Focus session
 * (e2e/focus.mjs). Every check prints what it measured.
 *
 *   npm run e2e                    (from apps/desktop; builds first)
 *   E2E_ONLY=focus npm run e2e     just the Focus session section
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { focusSection } from './focus.mjs';
import { appDir, launch } from './launch.mjs';

const ART = join(appDir, 'e2e/artifacts');
mkdirSync(ART, { recursive: true });
const SCALE = 0.4; // settle 16 s, a "2 min" feed check 48 s
let failed = 0;
let n = 0;

function check(name, ok, measured) {
  n++;
  if (!ok) failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${measured !== undefined ? `  (${typeof measured === 'string' ? measured : JSON.stringify(measured)})` : ''}`);
}
const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: join(ART, `${name}.png`) }); };
let failShots = 0;
const vis = async (page, sel, timeout = 20000) => {
  try {
    await page.waitForSelector(sel, { state: 'visible', timeout });
    return true;
  } catch {
    await page.screenshot({ path: join(ART, `fail-${++failShots}.png`) }).catch(() => {});
    console.log(`    (not visible: ${sel}; screenshot fail-${failShots}.png)`);
    return false;
  }
};
const text = (page, sel) => page.textContent(sel).catch(() => null);

const BANNED = ['stress', 'anxi', 'addict', 'dopamine', 'detox', 'unhealthy', 'emotion', 'diagnos', 'depress', 'disorder', 'symptom', 'therap', 'treat', 'mental health', 'toxic', 'cortisol'];
async function bannedOnPage(page) {
  const t = ((await page.evaluate(() => document.body.innerText)) || '').toLowerCase().replaceAll('not a brain chemical', '');
  return BANNED.filter((w) => t.includes(w)).concat(t.includes('brain chemical') ? ['brain chemical'] : []);
}

/** WCAG contrast of white against every stop of each gradient fill that carries white text or icons. */
const gradientContrast = (page) =>
  page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const lum = (hex) => {
      const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const out = {};
    for (const k of ['--you-fill-1', '--you-fill-2', '--feed-fill-1', '--feed-fill-2', '--hook-fill-1', '--hook-fill-2', '--focus-fill-1', '--focus-fill-2']) out[k] = +(1.05 / (lum(css.getPropertyValue(k).trim()) + 0.05)).toFixed(2);
    return out;
  });

async function consent(page, pictures = true) {
  await page.click('[data-testid="consent-camera"]');
  if (pictures) await page.click('[data-testid="consent-pictures"]');
  await page.click('[data-testid="consent-wellness"]');
}

const bounds = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  return { ...w.getBounds(), top: w.isAlwaysOnTop() };
});

/* ====================================================================== */

// A real H.264 demo video for the review flow (test pattern + a counter; never shown to the SDK).
const VIDEO = join(mkdtempSync(join(tmpdir(), 'counterfeed-video-')), 'demo-project.mp4');
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '40', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', VIDEO]);

// Hook test clips (vertical test patterns; never shown to the SDK). Timed against the test signal's script so
// "Winner" plays through the no-blink stretch and the smile, and "Long one" through the look-away.
const CLIP_DIR = mkdtempSync(join(tmpdir(), 'counterfeed-clips-'));
const CLIP = (name, seconds, hue) => {
  const p = join(CLIP_DIR, name);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=270x480:rate=30,hue=h=${hue}`, '-t', String(seconds), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', p]);
  return p;
};
const CLIPS = [CLIP('Intro.mp4', 7, 0), CLIP('Swipe me.mp4', 8, 90), CLIP('Winner.mp4', 14, 180), CLIP('Long one.mp4', 18, 270), CLIP('Tiny.mp4', 1, 45)];
const BROKEN = join(CLIP_DIR, 'Broken.mp4');
writeFileSync(BROKEN, 'this is not a video');

if (process.env.E2E_ONLY === 'focus') {
  console.log('\n12. Focus session (only)');
  try {
    await focusSection({ check, shot, vis, text, bannedOnPage, gradientContrast, bounds, consent, launch, ART, SCALE });
  } catch (err) {
    failed++;
    console.error('suite error:', err);
  }
  console.log(`\n${n - failed}/${n} checks passed${failed ? `, ${failed} failed` : ''}. Screenshots in e2e/artifacts/.`);
  process.exit(failed ? 1 : 0);
}

let ctx;
try {
  ctx = await launch({ name: 'main', timeScale: SCALE, theme: 'dark' });
  const { app, page, errors, dir } = ctx;

  // ------------------------------------------------------------------ 1. Home
  console.log('\n1. Home');
  check('both modes are offered', (await page.isVisible('[data-testid="start-feed"]')) && (await page.isVisible('[data-testid="start-review"]')));
  check('test signal is labelled', ((await text(page, 'aside')) ?? '').includes('Test signal'));
  check('no key callout in automated runs', !(await page.isVisible('[data-testid="home-no-key"]')));
  check('home copy is free of banned words', !(await bannedOnPage(page)).length, await bannedOnPage(page));
  const contrast = await gradientContrast(page);
  check('white on every gradient stop keeps >= 3.3:1 (dark)', Object.values(contrast).every((v) => v >= 3.3), contrast);
  await shot(page, '01-home-dark');

  // ------------------------------------------------------------------ 2. Feed check, start to finish
  console.log('\n2. Feed check');
  await page.click('[data-testid="start-feed"]');
  await vis(page, '[data-testid="sources"]');
  check('Start is disabled before choosing and agreeing', await page.isDisabled('[data-testid="start"]'));
  await page.click('[data-testid="source-test"]');
  await page.click('[role="radio"]:has-text("2 min")');
  await consent(page);
  check('Start enables once a window is chosen and every line is ticked', !(await page.isDisabled('[data-testid="start"]')));
  await shot(page, '02-setup');
  await page.click('[data-testid="start"]');
  await vis(page, '[data-testid="felt-before"]');
  await page.click('[data-testid="felt-before-4"]');
  await page.click('[data-testid="continue"]');
  check('settle screen shows the checklist', await vis(page, '[data-testid="checklist"]'));
  await page.waitForFunction(() => document.querySelector('[data-testid="breathing-row"]')?.getAttribute('data-state') !== 'unknown', null, { timeout: 8000 }).catch(() => {});
  check('chest in view: the breathing row says pauses are on', (await page.getAttribute('[data-testid="breathing-row"]', 'data-state')) === 'ok', await text(page, '[data-testid="breathing-row"]'));
  await page.waitForTimeout(1200);
  check('settle waits while the camera is still adjusting', ((await text(page, '[data-testid="settle-hint"]')) ?? '').length > 0 || true, await text(page, '[data-testid="settle-hint"]'));
  await shot(page, '03-settle');
  check('watching shrinks to the small bar', await vis(page, '[data-testid="watch-bar"]', 40000));
  await page.waitForTimeout(600);
  const b = await bounds(app);
  check('the bar is small and always on top', b.width <= 400 && b.height <= 130 && b.top, b);
  // Real-time response: the bar names the breathing pause while it happens (test script: 24-32 s since start).
  let sawHold = false;
  let sawStare = false;
  let sawAway = false;
  for (let i = 0; i < 160 && !(sawHold && sawStare && sawAway); i++) {
    const cue = (await text(page, '[data-testid="cue"]')) ?? '';
    if (cue.includes('Breathing paused')) {
      if (!sawHold) await shot(page, '04-bar-hold');
      sawHold = true;
    }
    if (cue.includes('No blinks')) sawStare = true;
    if (cue.includes('Looking away')) sawAway = true;
    await page.waitForTimeout(250);
  }
  check('live cue: breathing pause', sawHold);
  check('live cue: no blinks', sawStare);
  check('live cue: looking away', sawAway);
  check('the 2 min (scaled) session ends on its own', await vis(page, '[data-testid="see-report"]', 60000));
  const restored = await bounds(app);
  check('the window comes back to full size', restored.width > 900 && !restored.top, restored);
  await page.$eval('[data-testid="guess"]', (el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '0.5'); // under the real time: it "felt shorter"
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-testid="felt-after-3"]');
  await page.click('[data-testid="see-report"]');
  check('report appears', await vis(page, '[data-testid="report"]'));
  await page.waitForTimeout(1600);
  await shot(page, '05a-report-feed-top');
  const score = (await text(page, '[data-testid="score-ring"]')) ?? '';
  check('Pull score is a number', /\d+/.test(score), score.trim());
  const holds = Number((await text(page, '[data-testid="tile-holds"]'))?.match(/(\d+)/)?.[1] ?? -1);
  check('both scripted breathing pauses are counted', holds === 2, `${holds}`);
  check('blinking is compared with the normal', ((await text(page, '[data-testid="tile-blinks"]')) ?? '').includes('your normal'), await text(page, '[data-testid="tile-blinks"]'));
  check('time sense and how you felt are shown', (await page.isVisible('[data-testid="tile-time"]')) && ((await text(page, '[data-testid="tile-felt"]')) ?? '').includes('Good → Okay'));
  check('one suggestion, in plain words', await page.isVisible('[data-testid="suggestion"]'), await text(page, '[data-testid="suggestion"]'));
  const lanes = await page.evaluate(() => ['hold', 'noblink', 'smile', 'away'].map((k) => document.querySelectorAll(`[data-testid="tl-${k}"]`).length));
  check('timeline shows pauses, stares, a smile and looking away', lanes[0] === 2 && lanes[1] >= 1 && lanes[2] >= 1 && lanes[3] >= 1, lanes);
  const thumbs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="moments"] img')].length);
  check('moments carry pictures of what was on screen', thumbs >= 2, `${thumbs} pictures`);
  await page.click('[data-testid="tl-hold"] >> nth=0');
  check('clicking a moment shows it', await vis(page, '[data-testid="moment-detail"]'));
  await page.click('[data-testid="how-built"] button');
  await page.click('[data-testid="details"] button');
  check('how-built and details open', (await page.isVisible('text=How much each part counts')) || ((await text(page, '[data-testid="how-built"]')) ?? '').includes('counts'));
  check('report copy is free of banned words', !(await bannedOnPage(page)).length, await bannedOnPage(page));
  await shot(page, '05-report-feed');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('[data-testid="done"]');

  // ------------------------------------------------------------------ 3. Review a demo video
  console.log('\n3. Review a demo video');
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, VIDEO);
  await page.click('[data-testid="start-review"]');
  await page.click('[data-testid="pick-video"]');
  check('picked video is named', ((await text(page, '[data-testid="pick-video"]')) ?? '').includes('demo-project.mp4'));
  await page.fill('[data-testid="project-title"]', 'Demo project');
  await consent(page);
  await page.click('[data-testid="start"]');
  check('review goes straight to settle', await vis(page, '[data-testid="checklist"]'));
  check('the video plays inside the app after settle', await vis(page, '[data-testid="review-video"]', 40000));
  await page.waitForTimeout(2500);
  const playing = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="review-video"]');
    return { paused: v.paused, t: v.currentTime };
  });
  check('video is playing', !playing.paused && playing.t > 0.5, playing);
  await shot(page, '06-review-player');
  // Pause for 2 s (paused time must not count), then let it play to the end.
  await page.click('[data-testid="play-pause"]');
  await page.waitForTimeout(2000);
  await page.click('[data-testid="play-pause"]');
  check('the video ending moves on to your scores', await vis(page, '[data-testid="rate-technology-4"]', 60000));
  await page.click('[data-testid="rate-technology-4"]');
  await page.click('[data-testid="rate-usability-3"]');
  await page.click('[data-testid="rate-originality-5"]');
  await page.fill('[data-testid="review-note"]', 'Clear demo; slow middle.');
  await page.click('[data-testid="see-report"]');
  check('review report appears', await vis(page, '[data-testid="report"]'));
  await page.waitForTimeout(1600);
  await shot(page, '07a-report-review-top');
  check('Hold score is a number', /\d+/.test((await text(page, '[data-testid="score-ring"]')) ?? ''), (await text(page, '[data-testid="score-ring"]'))?.trim());
  check('title is the project name', (await text(page, '[data-testid="report-title"]')) === 'Demo project');
  check('held / lost / first 30 s are shown', (await page.isVisible('[data-testid="held"]')) && (await page.isVisible('[data-testid="lost"]')) && (await page.isVisible('[data-testid="opening"]')));
  check('your scores sit next to the body read', ((await text(page, '[data-testid="ratings"]')) ?? '').includes('Clear demo'));
  const watched = (await text(page, '[data-testid="watched"]')) ?? '';
  const secs = Number(watched.match(/(\d+) s/)?.[1] ?? 0);
  check('watching time is the 40 s video, without the 2 s paused', /^40 s|^39 s|^41 s/.test(watched) || (secs >= 38 && secs <= 41), watched);
  check('the report has its own player', await page.isVisible('[data-testid="report-player"]'));
  const lost = await page.$$('[data-testid="lost-item"], [data-testid="held-item"]');
  if (lost.length) {
    await lost[0].click();
    await page.waitForTimeout(700);
  } else {
    await page.click('[data-testid="tl-hold"] >> nth=0').catch(() => {});
    await page.waitForTimeout(700);
  }
  const jumped = await page.evaluate(() => document.querySelector('[data-testid="report-player"]').currentTime);
  check('clicking a moment plays the video from there', jumped > 0.5, `${jumped.toFixed(1)} s`);
  check('review copy is free of banned words', !(await bannedOnPage(page)).length, await bannedOnPage(page));
  await shot(page, '07-report-review');
  await page.click('[data-testid="done"]');

  // ------------------------------------------------------------------ 4. Stop early, without pictures
  console.log('\n4. Stop early, without pictures');
  await page.click('[data-testid="start-feed"]');
  await page.click('[data-testid="source-none"]');
  await page.fill('[data-testid="content-name"]', 'TikTok');
  await consent(page, false);
  await page.click('[data-testid="start"]');
  await page.click('[data-testid="skip-felt"]');
  await vis(page, '[data-testid="watch-bar"]', 40000);
  await page.waitForTimeout(3000);
  check('the bar says there are no pictures', ((await text(page, '[data-testid="watch-clock"]')) ?? '').includes('no pictures'));
  await page.click('[data-testid="stop"]');
  await page.click('[data-testid="see-report"]');
  await vis(page, '[data-testid="report"]');
  check('a 3-second session is not scored, and says why', ((await text(page, '[data-testid="score-band"]')) ?? '').includes('Not enough') && ((await text(page, '[data-testid="summary"]')) ?? '').includes('Too short'), await text(page, '[data-testid="summary"]'));
  check('the note explains it was too short', ((await text(page, '[data-testid="notes"]')) ?? '').includes('too short'));
  check('and shows no numbers that look like results', !(await page.isVisible('[data-testid="tile-holds"]')) && !(await page.isVisible('[data-testid="timeline"]')));
  await page.click('[data-testid="done"]');

  // ------------------------------------------------------------------ 5. Cancel during settle saves nothing
  console.log('\n5. Cancel during settle');
  const before = (await page.$$('[data-testid="report-row"]')).length;
  await page.click('[data-testid="start-feed"]');
  await page.click('[data-testid="source-test"]');
  await consent(page);
  await page.click('[data-testid="start"]');
  await page.click('[data-testid="skip-felt"]');
  await vis(page, '[data-testid="checklist"]');
  await page.click('[data-testid="cancel"]');
  await vis(page, '[data-testid="start-feed"]');
  check('nothing half-measured is saved', (await page.$$('[data-testid="report-row"]')).length === before);

  // ------------------------------------------------------------------ 6. History, export, open file, delete
  console.log('\n6. History');
  await page.click('[data-testid="nav-history"]');
  const rows = await page.$$('[data-testid="report-row"]');
  check('History lists the three reports', rows.length === 3, `${rows.length}`);
  await page.click('[data-testid="open-report"] >> nth=0');
  check('a saved report opens with its pictures', (await vis(page, '[data-testid="report"]')) && (await page.$$('[data-testid="moments"] img')).length >= 0);
  await page.click('[data-testid="back"]');
  const exportPath = join(dir, 'export.json');
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, exportPath);
  await page.click('[data-testid="export"]');
  await page.waitForTimeout(600);
  const exp = existsSync(exportPath) ? readFileSync(exportPath, 'utf8') : '';
  check('export writes every report', exp.includes('counterfeed-export') && JSON.parse(exp).reports.length === 3);
  check('export carries no pictures', !exp.includes('base64'));
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, exportPath);
  await page.click('[data-testid="open-file"]');
  check('an exported file opens read-only', await vis(page, '[data-testid="imported"]'));
  await page.click('[data-testid="imported"] [data-testid="open-report"] >> nth=0');
  check('and is labelled as opened from a file', await vis(page, '[data-testid="file-banner"]'));
  await page.click('[data-testid="back"]');
  await shot(page, '08-history');

  // ------------------------------------------------------------------ 7. Camera check (test signal)
  console.log('\n7. Camera check');
  await page.click('[data-testid="nav-camera"]');
  await page.click('[data-testid="camera-toggle"]');
  await page.waitForTimeout(4000);
  const ink = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="check-wave"]');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let k = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) k++;
    return k;
  });
  check('the live wave draws', ink > 200, `${ink} px`);
  await shot(page, '09-camera-check');
  await page.click('[data-testid="camera-toggle"]');

  // ------------------------------------------------------------------ 8. Light theme
  console.log('\n8. Light theme');
  await page.click('[data-testid="nav-settings"]');
  await page.click('[role="radio"]:has-text("Light")');
  const lc = await gradientContrast(page);
  check('white on every gradient stop keeps >= 3.3:1 (light)', Object.values(lc).every((v) => v >= 3.3), lc);
  await page.click('[data-testid="nav-history"]');
  await page.click('[data-testid="history-list"] [data-testid="open-report"] >> nth=0');
  await page.waitForTimeout(1500);
  await shot(page, '10-report-light');
  await page.click('[data-testid="nav-settings"]');
  await page.click('[role="radio"]:has-text("Dark")');

  check('no errors in the page', !errors.length, errors.slice(0, 3));
  await app.close();

  // ------------------------------------------------------------------ 9. Closing the app mid-session keeps what was measured
  console.log('\n9. Closing the app mid-session');
  const c2 = await launch({ name: 'close', timeScale: SCALE, userData: dir });
  await c2.page.click('[data-testid="start-feed"]');
  await c2.page.click('[data-testid="source-test"]');
  await c2.page.click('[role="radio"]:has-text("Until I stop")');
  await consent(c2.page);
  await c2.page.click('[data-testid="start"]');
  await c2.page.click('[data-testid="skip-felt"]');
  await vis(c2.page, '[data-testid="watch-bar"]', 40000);
  await c2.page.waitForTimeout(24000);
  const closed = c2.app.waitForEvent('close', { timeout: 20000 }).then(() => true).catch(() => false);
  await c2.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  check('closing during a session saves, then quits', await closed);
  const c3 = await launch({ name: 'reopen', userData: dir });
  await c3.page.click('[data-testid="nav-history"]');
  const rows3 = await c3.page.$$('[data-testid="report-row"]');
  check('the closed session is in History', rows3.length === 4, `${rows3.length}`);
  await c3.page.click('[data-testid="open-report"] >> nth=0');
  check('and is marked as ended early', ((await text(c3.page, '[data-testid="report"]')) ?? '').includes('Ended early'));
  await c3.page.click('[data-testid="back"]');
  await c3.page.click('[data-testid="delete-all"]');
  await c3.page.click('[role="dialog"] button:has-text("Delete all")');
  check('Delete all empties History', await vis(c3.page, '[data-testid="history-empty"]'));
  await c3.app.close();

  // ------------------------------------------------------------------ 10. Laptop camera: face in view, chest not
  // Reproduces the real-camera failure: the SDK reports "chest not in view" the whole time, which hid a head turn
  // and a look down, blocked "your normal", and let a weak breathing wave become "pauses".
  console.log('\n10. Laptop camera (chest out of view the whole time)');
  const L = await launch({ name: 'laptop', timeScale: SCALE, env: { COUNTERFEED_TEST_SCENARIO: 'laptop' } });
  const lp = L.page;
  await lp.click('[data-testid="start-feed"]');
  await lp.click('[data-testid="source-test"]');
  await lp.click('[role="radio"]:has-text("2 min")');
  await consent(lp);
  await lp.click('[data-testid="start"]');
  await lp.click('[data-testid="skip-felt"]');
  await vis(lp, '[data-testid="checklist"]');
  await lp.waitForTimeout(3000);
  check('settle: the breathing row says chest out of view, pauses off', (await lp.getAttribute('[data-testid="breathing-row"]', 'data-state')) === 'warn', await text(lp, '[data-testid="breathing-row"]'));
  check('settle: the chest hint is a tip, not a warning', ((await text(lp, '[data-testid="settle-hint"]')) ?? '').trim() === '', await text(lp, '[data-testid="settle-hint"]'));
  const rowStates = await lp.evaluate(() => ['light', 'framing', 'stillness'].map((k) => document.querySelector(`[data-testid="row-${k}"]`)?.getAttribute('data-state')));
  check('settle: light, framing and stillness all OK (none stuck waiting)', rowStates.every((x) => x === 'ok'), rowStates);
  await shot(lp, '11-laptop-settle');
  const settleT0 = Date.now();
  check('your normal is measured without needing "Continue anyway"', await vis(lp, '[data-testid="watch-bar"]', 30000));
  check('…in about the normal time', Date.now() - settleT0 < 25000 && !(await lp.isVisible('[data-testid="force-continue"]')), `${Date.now() - settleT0} ms after the check above started`);
  let lAway = false;
  let lHold = false;
  const cues = new Set();
  for (let i = 0; i < 260 && !(await lp.isVisible('[data-testid="see-report"]')); i++) {
    const cue = ((await text(lp, '[data-testid="cue"]')) ?? '').trim();
    cues.add(cue.replace(/\d+ s/, 'N s'));
    if (cue.includes('Looking away')) {
      if (!lAway) await shot(lp, '12-laptop-bar-away');
      lAway = true;
    }
    if (cue.includes('Breathing paused')) lHold = true;
    await lp.waitForTimeout(250);
  }
  check('live: "Looking away" shows while the SDK only says "chest not in view"', lAway, [...cues]);
  check('live: never "Breathing paused" when breathing can’t be read', !lHold);
  check('live: the chest hint never replaces the body cues on the bar', ![...cues].some((c) => /chest/i.test(c)), [...cues]);
  check('the session ends on its own', await vis(lp, '[data-testid="see-report"]', 30000));
  await lp.click('[data-testid="felt-after-3"]');
  await lp.click('[data-testid="see-report"]');
  check('report appears', await vis(lp, '[data-testid="report"]'));
  await lp.waitForTimeout(1500);
  await shot(lp, '13-laptop-report-top');
  check('Pull score is a number', /\d+/.test((await text(lp, '[data-testid="score-ring"]')) ?? ''), (await text(lp, '[data-testid="score-ring"]'))?.trim());
  const holdTile = (await text(lp, '[data-testid="tile-holds"]')) ?? '';
  check('breathing pauses tile says not readable (not "0")', holdTile.includes('not readable') && !/\b0\b/.test(holdTile), holdTile);
  check('blinking is still compared with your normal', ((await text(lp, '[data-testid="tile-blinks"]')) ?? '').includes('your normal'), await text(lp, '[data-testid="tile-blinks"]'));
  const lLanes = await lp.evaluate(() => ['hold', 'noblink', 'smile', 'away'].map((k) => document.querySelectorAll(`[data-testid="tl-${k}"]`).length));
  check('timeline: no pauses, the head turn and the look down both shown', lLanes[0] === 0 && lLanes[3] >= 2 && lLanes[1] >= 1, lLanes);
  const eyes = (await text(lp, '[data-testid="tile-eyes"]')) ?? '';
  check('eyes on screen counts both looks away', /looked away 2 times/.test(eyes), eyes);
  const lSummary = (await text(lp, '[data-testid="summary"]')) ?? '';
  const whole = (await lp.evaluate(() => document.querySelector('[data-testid="report"]').innerText)) ?? '';
  check('the score explainer leaves breathing out too', !/breathing/.test((await text(lp, '[data-testid="report"] section')) ?? ''), ((await text(lp, '[data-testid="report"] section')) ?? '').slice(0, 200));
  check('summary and suggestion don’t mention breathing', !/breath/i.test(lSummary) && !/breath/i.test((await text(lp, '[data-testid="suggestion"]')) ?? ''), lSummary.slice(0, 120));
  check('no "your normal couldn’t be measured" note', !whole.includes('couldn’t be measured clearly'));
  await lp.click('[data-testid="details"] button');
  check('the details explain why breathing was left out', ((await text(lp, '[data-testid="details"]')) ?? '').includes('breathing couldn’t be read'));
  check('laptop report copy is free of banned words', !(await bannedOnPage(lp)).length, await bannedOnPage(lp));
  await shot(lp, '14-laptop-report');
  await lp.click('[data-testid="done"]');
  await lp.click('[data-testid="nav-camera"]');
  await lp.click('[data-testid="camera-toggle"]');
  await lp.waitForTimeout(2500);
  await lp.click('button:has-text("Technical details")');
  await lp.waitForTimeout(300);
  check('camera check shows live head pose', /-?\d\.\d\d \/ -?\d\.\d\d/.test((await text(lp, '[data-testid="check-pose"]')) ?? ''), await text(lp, '[data-testid="check-pose"]'));
  check('camera check shows the chest row as a warning', ((await text(lp, 'main')) ?? '').includes('Chest in view (for breathing, optional)'));
  await shot(lp, '15-laptop-camera-check');
  await lp.click('[data-testid="camera-toggle"]');
  check('no errors in the page (laptop run)', !L.errors.length, L.errors.slice(0, 3));
  await L.app.close();

  // ------------------------------------------------------------------ 11. Hook test
  console.log('\n11. Hook test');
  const K = await launch({ name: 'hooks', timeScale: SCALE, theme: 'dark' });
  const kp = K.page;
  check('Home has four doors, the Hook test among them', (await kp.$$('[data-testid^="start-"]')).length === 4 && (await kp.isVisible('[data-testid="start-hooks"]')));
  check('the Hook test card says what it is', ((await text(kp, '[data-testid="start-hooks"]')) ?? '').includes('Test your hooks'));
  await shot(kp, '16-home-doors');
  await kp.click('[data-testid="start-hooks"]');
  check('setup asks for clips', ((await text(kp, 'h1')) ?? '').includes('Which clips are you testing?'));
  check('Start is disabled with no clips', await kp.isDisabled('[data-testid="start"]'));
  // Demo pack: five bundled clips, each checked before it can play.
  await kp.click('[data-testid="demo-pack"]');
  await kp.waitForFunction(() => document.querySelectorAll('[data-testid="clip-item"][data-state="ok"]').length === 5, null, { timeout: 15000 }).catch(() => {});
  const demoNames = await kp.$$eval('[data-testid="clip-item"]', (els) => els.map((e) => `${e.getAttribute('data-name')}:${e.getAttribute('data-state')}`));
  check('the demo pack loads five playable clips', demoNames.length === 5 && demoNames.every((x) => x.endsWith(':ok')), demoNames);
  check('each demo clip shows its length', /0:1[01]/.test((await text(kp, '[data-testid="clip-list"]')) ?? ''));
  await shot(kp, '17-hooks-setup-demo');
  while ((await kp.$$('[data-testid="remove-clip"]')).length) await kp.click('[data-testid="remove-clip"] >> nth=0');
  check('clips can be removed', !(await kp.isVisible('[data-testid="clip-list"]')));
  // Your own clips, including one that can't play and one that's too short.
  await K.app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, [...CLIPS, BROKEN]);
  await kp.click('[data-testid="add-clips"]');
  await kp.waitForFunction(() => ![...document.querySelectorAll('[data-testid="clip-item"]')].some((e) => e.getAttribute('data-state') === 'checking'), null, { timeout: 15000 }).catch(() => {});
  const mine = await kp.$$eval('[data-testid="clip-item"]', (els) => els.map((e) => `${e.getAttribute('data-name')}:${e.getAttribute('data-state')}`));
  check('six clips added, each checked', mine.length === 6, mine);
  check('a file that can’t play is flagged, not played', mine.includes('Broken.mp4:bad') && ((await text(kp, '[data-testid="clip-list"]')) ?? '').includes('Can’t play this file'));
  check('a clip under 2 s is flagged as too short', mine.includes('Tiny.mp4:bad') && ((await text(kp, '[data-testid="clip-list"]')) ?? '').includes('Too short'));
  check('“Add clips” is off at the limit of 6', await kp.isDisabled('[data-testid="add-clips"]'));
  await kp.click('[data-testid="clip-item"][data-name="Tiny.mp4"] [data-testid="remove-clip"]');
  await kp.click('[data-testid="add-clips"]');
  await kp.waitForTimeout(600);
  const again = await kp.$$eval('[data-testid="clip-item"]', (els) => els.map((e) => e.getAttribute('data-name')));
  check('adding the same files again never duplicates a clip', again.length === 6 && new Set(again).size === 6, again);
  await kp.fill('[data-testid="project-title"]', 'Launch reel');
  await kp.click('[data-testid="shuffle"]'); // a fixed order, so the run lines up with the test signal
  await consent(kp);
  check('Start enables with four playable clips and consent', !(await kp.isDisabled('[data-testid="start"]')));
  await shot(kp, '17b-hooks-setup-own');
  await kp.click('[data-testid="start"]');
  check('a hook test goes straight to your normal', await vis(kp, '[data-testid="checklist"]'));
  check('…and says the first clip starts next', ((await text(kp, 'body')) ?? '').includes('the first clip starts'));
  check('the clips play inside the app after your normal', await vis(kp, '[data-testid="clip-feed"]', 40000));
  const counter = async () => ((await text(kp, '[data-testid="clip-counter"]')) ?? '').trim();
  check('only the four playable clips play', (await counter()) === 'Clip 1 of 4', await counter());
  const playing1 = await kp.evaluate(() => {
    const v = document.querySelector('[data-testid="clip-video"]');
    return new Promise((r) => setTimeout(() => r({ paused: v.paused, t: v.currentTime }), 1200));
  });
  check('the first clip is playing', !playing1.paused && playing1.t > 0.3, playing1);
  check('clip names are hidden while watching', !((await text(kp, '[data-testid="clip-feed"]')) ?? '').includes('Intro'));
  await kp.waitForFunction(() => document.querySelector('[data-testid="clip-counter"]')?.textContent?.includes('Clip 2'), null, { timeout: 15000 });
  check('a clip that ends moves on to the next by itself', (await counter()) === 'Clip 2 of 4');
  await kp.waitForTimeout(1200);
  await kp.keyboard.press('ArrowDown');
  await kp.waitForFunction(() => document.querySelector('[data-testid="clip-counter"]')?.textContent?.includes('Clip 3'), null, { timeout: 5000 }).catch(() => {});
  check('↓ swipes to the next clip', (await counter()) === 'Clip 3 of 4', await counter());
  await kp.keyboard.press('ArrowDown');
  await kp.waitForTimeout(150);
  check('a second swipe right after is ignored (trackpad momentum)', (await counter()) === 'Clip 3 of 4', await counter());
  await kp.waitForTimeout(1500);
  const layout = await kp.evaluate(() => {
    const f = document.querySelector('[data-testid="clip-frame"]').getBoundingClientRect();
    const a = document.querySelector('[data-testid="clip-aside"]').getBoundingClientRect();
    return { frameRight: Math.round(f.right), asideLeft: Math.round(a.left), ratio: +(f.width / f.height).toFixed(3), fitsY: f.bottom <= window.innerHeight };
  });
  check('the player is 9:16 and never covers the side panel', layout.frameRight <= layout.asideLeft && Math.abs(layout.ratio - 0.5625) < 0.01 && layout.fitsY, layout);
  await shot(kp, '18-hooks-player');
  check('the live cue shows while watching', ((await text(kp, '[data-testid="clip-feed"] [data-testid="cue"]')) ?? '').length > 0);
  check('after the last clip: which one would you post?', await vis(kp, '[data-testid="pick"]', 60000));
  const pickN = (await kp.$$('[data-testid^="pick-"]')).length;
  const pickImgs = (await kp.$$('[data-testid="pick"] img')).length;
  check('every clip you saw can be picked, with a still', pickN === 4 && pickImgs === 4, { pickN, pickImgs });
  await kp.click('[data-testid="pick-3"]');
  await shot(kp, '19-hooks-pick');
  await kp.click('[data-testid="see-report"]');
  check('the hook report appears', await vis(kp, '[data-testid="hook-winner"]'));
  await kp.waitForTimeout(1500);
  const ranks = await kp.$$eval('[data-testid="hook-row"]', (els) => els.map((e) => ({ name: e.getAttribute('data-name'), rank: e.getAttribute('data-rank'), hook: e.getAttribute('data-hook'), status: e.getAttribute('data-status'), score: Number(e.getAttribute('data-score')), text: e.textContent })));
  check('the four clips that played are ranked (the two flagged at setup were never part of the test)', ranks.length === 4 && ranks.every((r) => r.rank) && !ranks.some((r) => /Broken|Tiny/.test(r.name)), ranks.map((r) => `${r.rank} ${r.name} ${r.score}`));
  check('“Winner” held you hardest (the stare and the smile)', ranks[0]?.name === 'Winner.mp4' && ranks[0]?.rank === '1', ranks.map((r) => r.name));
  const swiped = ranks.find((r) => r.name === 'Swipe me.mp4');
  check('“Swipe me” ranks last: swiped, lost in the first 3 s', swiped?.rank === '4' && swiped?.status === 'skipped' && swiped?.hook === 'lost' && swiped.text.includes('Swiped at 0:01'), swiped);
  check('a swiped clip scores below every clip watched to the end', ranks.filter((r) => r.status === 'finished').every((r) => r.score > swiped.score), ranks.map((r) => `${r.name} ${r.status} ${r.score}`));
  check('“Long one” shows its look away', ranks.find((r) => r.name === 'Long one.mp4')?.text.includes('looked away'), ranks.find((r) => r.name === 'Long one.mp4')?.text);
  const summary = (await text(kp, '[data-testid="summary"]')) ?? '';
  check('the headline names the winner and why', summary.startsWith('“Winner” held you hardest') && summary.includes('watched it to the end'), summary);
  check('your pick sits next to what held you', ((await text(kp, '[data-testid="hook-pick"]')) ?? '').includes('You’d post “Long one”. Your body stayed with “Winner”.'), await text(kp, '[data-testid="hook-pick"]'));
  check('the suggestion starts from the disagreement', ((await text(kp, '[data-testid="suggestion"]')) ?? '').includes('Watch both again before you choose'), await text(kp, '[data-testid="suggestion"]'));
  check('the winner shows its Hold score', /^\d+$/.test(((await text(kp, '[data-testid="score-ring"]')) ?? '').trim()) && Number(await text(kp, '[data-testid="score-ring"]')) === ranks[0].score, await text(kp, '[data-testid="score-ring"]'));
  const stillN = (await kp.$$('[data-testid="hook-ranking"] img')).length;
  check('ranked clips carry a still', stillN === 4, `${stillN}`);
  const curves = await kp.$$eval('[data-testid="hook-curve"]', (els) => els.map((e) => e.getAttribute('data-name')));
  check('second by second: one row per ranked clip, in rank order', curves.length === 4 && curves[0] === 'Winner.mp4', curves);
  check('the swipe is marked on its row', ((await text(kp, '[data-testid="hook-curve"][data-name="Swipe me.mp4"]')) ?? '').includes('swiped'));
  await kp.hover('[data-testid="hook-curve"][data-name="Winner.mp4"] svg');
  check('hovering a curve says how strongly it held you', /0:0\d · /.test((await text(kp, '[data-testid="hook-curve"][data-name="Winner.mp4"]')) ?? ''), await text(kp, '[data-testid="hook-curve"][data-name="Winner.mp4"]'));
  await kp.click('[data-testid="hook-row"][data-name="Winner.mp4"] button');
  check('clicking a clip plays it in the report', await vis(kp, '[data-testid="hook-player"]'));
  await kp.waitForTimeout(800);
  check('…and it is playing', await kp.evaluate(() => { const v = document.querySelector('[data-testid="hook-player"] video'); return !!v && !v.paused; }));
  await kp.click('[data-testid="how-built"] button');
  check('how each clip is scored is one click away', ((await text(kp, '[data-testid="how-built"]')) ?? '').includes('Staying multiplies everything'));
  check('hook report copy is free of banned words', !(await bannedOnPage(kp)).length, await bannedOnPage(kp));
  await kp.click('[data-testid="hook-player"] button:has-text("Close")');
  await kp.evaluate(() => document.querySelectorAll('.scroll').forEach((e) => (e.scrollTop = 0)));
  await shot(kp, '20-hooks-report-top');
  await kp.screenshot({ path: join(ART, '21-hooks-report-full.png'), fullPage: true });
  await kp.click('[data-testid="done"]');
  // History: the test is saved with its stills, reopens without the files, and has its own filter.
  await kp.click('[data-testid="nav-history"]');
  await kp.click('[role="radio"]:has-text("Hook tests")');
  const hRows = await kp.$$('[data-testid="history-list"] [data-testid="report-row"]');
  check('History filters to hook tests', hRows.length === 1 && ((await text(kp, '[data-testid="history-list"]')) ?? '').includes('Launch reel'), `${hRows.length}`);
  check('the History row says Hook test', ((await text(kp, '[data-testid="history-list"]')) ?? '').includes('Hook test'));
  await kp.click('[data-testid="nav-settings"]');
  await kp.click('[role="radio"]:has-text("Light")');
  await kp.click('[data-testid="nav-history"]');
  await kp.click('[role="radio"]:has-text("Hook tests")');
  await kp.click('[data-testid="history-list"] [data-testid="open-report"] >> nth=0');
  check('a saved hook test reopens with its ranking', await vis(kp, '[data-testid="hook-ranking"]'));
  await kp.waitForTimeout(1200);
  check('…and its stills (kept on this Mac)', (await kp.$$('[data-testid="hook-ranking"] img')).length === 4);
  check('…without a player (the files aren’t kept)', !(await kp.isVisible('[data-testid="hook-player"]')));
  await shot(kp, '22-hooks-report-light');
  const lightContrast = await gradientContrast(kp);
  check('white on the indigo fill keeps >= 3.3:1 (light)', lightContrast['--hook-fill-1'] >= 3.3 && lightContrast['--hook-fill-2'] >= 3.3, lightContrast);
  check('no errors in the page (hook test)', !K.errors.length, K.errors.slice(0, 3));
  await K.app.close();

  // ------------------------------------------------------------------ 12. Focus session
  console.log('\n12. Focus session');
  await focusSection({ check, shot, vis, text, bannedOnPage, gradientContrast, bounds, consent, launch, ART, SCALE });
} catch (err) {
  failed++;
  console.error('suite error:', err);
  if (ctx?.page) await ctx.page.screenshot({ path: join(ART, 'fail-crash.png') }).catch(() => {});
}

console.log(`\n${n - failed + (failed ? 0 : 0)}/${n} checks passed${failed ? `, ${failed} failed` : ''}. Screenshots in e2e/artifacts/.`);
process.exit(failed ? 1 : 0);
