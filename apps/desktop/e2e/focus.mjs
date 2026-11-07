/**
 * End-to-end: Focus session. Drives the built app with the labelled test signal ('focus' scenario: a 13-second look
 * down in the middle, and a 2.5-second glance later) and a stand-in for the Shortcuts tool that only logs what it's
 * asked to run, so the real Do Not Disturb is never touched. Front apps are a fixed scripted cycle in automated runs.
 *
 * Checks: four doors on Home; the Do Not Disturb setup when the shortcuts don't exist, and the switch when they do;
 * Do Not Disturb on as the session starts and off on every way out (time up, stop during settle, stop on the bar,
 * quitting); the bar's countdown and live focus cue (the streak restarts after a break, not after a glance); the
 * focus question; the report (score, sentence, felt-vs-measured, one break, the focus map, apps and switches);
 * History; light theme; contrast of the plum fill; banned words.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ON = 'Counterfeed Focus On';
const OFF = 'Counterfeed Focus Off';

export async function focusSection(h) {
  const { check, shot, vis, text, bannedOnPage, gradientContrast, bounds, consent, launch, ART, SCALE } = h;

  // A stand-in for /usr/bin/shortcuts: lists the two shortcuts and logs every run.
  const dir = mkdtempSync(join(tmpdir(), 'counterfeed-shortcuts-'));
  const log = join(dir, 'runs.log');
  const bin = join(dir, 'shortcuts');
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = list ]; then printf '${ON}\\n${OFF}\\nSomething else\\n'; exit 0; fi\nif [ "$1" = run ]; then echo "$2" >> '${log}'; exit 0; fi\nexit 2\n`, { mode: 0o755 });
  const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const waitRuns = async (page, n, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end && runs().length < n) await page.waitForTimeout(100);
    return runs();
  };

  // ---- Without the shortcuts: the one-minute setup, and the session still works without it.
  const N = await launch({ name: 'focus-noshortcuts', timeScale: SCALE, theme: 'dark' });
  await N.page.click('[data-testid="start-focus"]');
  await N.page.waitForSelector('[data-testid="dnd"][data-state="setup"]', { timeout: 10000 }).catch(() => {});
  const setupText = (await text(N.page, '[data-testid="dnd"]')) ?? '';
  check('without the shortcuts, setup explains the one-minute Shortcuts setup', setupText.includes(ON) && setupText.includes(OFF) && setupText.includes('Set Focus'), setupText.slice(0, 80));
  check('…with Open Shortcuts and Check again', (await N.page.isVisible('[data-testid="open-shortcuts"]')) && (await N.page.isVisible('[data-testid="dnd-recheck"]')));
  check('…and Start still works without it', await (async () => {
    await consent(N.page, false);
    return !(await N.page.isDisabled('[data-testid="start"]'));
  })());
  await shot(N.page, '24b-focus-setup-no-shortcuts');
  check('no errors in the page (focus, no shortcuts)', !N.errors.length, N.errors.slice(0, 3));
  await N.app.close();

  // ---- With the shortcuts: a 2-minute session (48 s here), start to finish.
  const F = await launch({ name: 'focus', timeScale: SCALE, theme: 'dark', env: { COUNTERFEED_TEST_SCENARIO: 'focus', COUNTERFEED_SHORTCUTS_BIN: bin } });
  const fp = F.page;
  check('Home has four doors', (await fp.$$('[data-testid="doors"] [data-testid^="start-"]')).length === 4);
  check('the Focus card says what it is', ((await text(fp, '[data-testid="start-focus"]')) ?? '').includes('Focus on one thing'));
  await shot(fp, '23-home-four-doors');
  await fp.click('[data-testid="start-focus"]');
  check('setup asks what you are focusing on', ((await text(fp, 'h1')) ?? '').includes('What are you focusing on?'));
  await fp.waitForSelector('[data-testid="dnd"][data-state="ready"]', { timeout: 10000 }).catch(() => {});
  check('with both shortcuts, Do Not Disturb is a switch, on by default', (await fp.getAttribute('[data-testid="pref-dnd"]', 'aria-checked')) === 'true');
  check('noting the front app is on by default', (await fp.getAttribute('[data-testid="pref-apps"]', 'aria-checked')) === 'true');
  check('no pictures are asked for', !(await fp.isVisible('[data-testid="consent-pictures"]')));
  check('Start waits for consent', await fp.isDisabled('[data-testid="start"]'));
  await fp.fill('[data-testid="focus-task"]', 'Write the launch post');
  await fp.click('[data-testid="focus-options"] [role="radio"]:has-text("2 min")');
  await consent(fp, false);
  check('Start enables once you agree', !(await fp.isDisabled('[data-testid="start"]')));
  await shot(fp, '24-focus-setup');
  check('nothing runs before Start', runs().length === 0, runs());
  await fp.click('[data-testid="start"]');
  check('Do Not Disturb turns on as the session starts', (await waitRuns(fp, 1)).join() === ON, runs());
  check('settle says your focus time starts next', ((await text(fp, 'body')) ?? '').includes('your focus time starts'));
  check('the progress steps say Focus', ((await text(fp, '[aria-label="Progress"]')) ?? '').includes('Focus'));
  check('focusing shrinks to the small bar', await vis(fp, '[data-testid="watch-bar"]', 40000));
  await fp.waitForTimeout(500);
  const b = await bounds(F.app);
  check('the bar is small and always on top', b.width <= 400 && b.height <= 130 && b.top, b);
  const barTitle = (await text(fp, '[data-testid="watch-bar"]')) ?? '';
  check('the bar names the task and counts down', barTitle.includes('Focus · Write the launch post') && ((await text(fp, '[data-testid="watch-clock"]')) ?? '').includes('left'), barTitle.slice(0, 60));
  // Live cue: focused, then looking away during the look down (26-39 s), then focused again from zero.
  const seen = [];
  let afterBreak = null;
  let afterGlance = null;
  let shotFocused = false;
  let shotAway = false;
  for (let i = 0; i < 220; i++) {
    if (!(await fp.isVisible('[data-testid="watch-bar"]').catch(() => false))) break;
    const cue = ((await text(fp, '[data-testid="cue"]')) ?? '').trim();
    if (cue && seen[seen.length - 1] !== cue.split(' · ')[0]) seen.push(cue.split(' · ')[0]);
    if (!shotFocused && cue.startsWith('Focused · 0:0') && Number(cue.slice(-1)) >= 4) {
      await shot(fp, '25-focus-bar');
      shotFocused = true;
    }
    if (!shotAway && cue.startsWith('Looking away · ') && Number(cue.replace(/\D/g, '')) >= 4) {
      await shot(fp, '25b-focus-bar-away');
      shotAway = true;
    }
    if (afterBreak === null && seen.includes('Looking away') && cue.startsWith('Focused')) afterBreak = cue;
    if (afterGlance === null && seen.filter((s) => s === 'Looking away').length === 2 && cue.startsWith('Focused')) afterGlance = cue;
    await fp.waitForTimeout(250);
  }
  const secsOf = (cue) => { const m = /(\d+):(\d\d)$/.exec(cue ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
  check('the bar says Focused, then Looking away during the look down, then Focused again', seen.includes('Focused') && seen.indexOf('Looking away') > seen.indexOf('Focused') && seen.lastIndexOf('Focused') > seen.indexOf('Looking away'), seen);
  check('after a break the focused count starts again from zero', /^Focused · 0:0\d$/.test(afterBreak ?? ''), afterBreak);
  check('after a glance (2.5 s) it carries on counting', secsOf(afterGlance) >= 10, afterGlance);
  check('the bar names a breathing pause while you work', seen.includes('Breathing paused'), seen);
  check('when the time is up: how focused did that feel?', await vis(fp, '[data-testid="felt-focus"]', 30000));
  check('Do Not Disturb turns off when the time is up', (await waitRuns(fp, 2)).join() === `${ON},${OFF}`, runs());
  await fp.click('[data-testid="felt-focus-4"]');
  await shot(fp, '26-focus-felt');
  await fp.click('[data-testid="see-report"]');

  // ---- The report.
  check('the focus report opens', await vis(fp, '[data-testid="report"][data-mode="focus"]', 20000));
  check('it is titled with the task', ((await text(fp, '[data-testid="report-title"]')) ?? '').trim() === 'Write the launch post');
  const scoreText = ((await text(fp, '[data-testid="score-ring"]')) ?? '').trim();
  check('a Focus score', /^\d+Focus$/.test(scoreText.replace(/\s/g, '')), scoreText);
  const summary = (await text(fp, '[data-testid="summary"]')) ?? '';
  check('one plain sentence with the numbers', /^(Deep|Steady|Patchy|Scattered) focus: your eyes stayed on the work for .+ \(\d+%\), and your longest stretch without a break was .+\.$/.test(summary), summary);
  check('how it felt sits next to what was measured', /^It felt focused\. The camera measured \d+% focused\.$/.test(((await text(fp, '[data-testid="focus-felt"]')) ?? '').trim()), await text(fp, '[data-testid="focus-felt"]'));
  const breaks = ((await text(fp, '[data-testid="tile-breaks"]')) ?? '').replace(/\s+/g, ' ');
  check('one break (the 13-second look down); the 2.5-second glance is not one', /Breaks ?1 ?away 10 s or more/.test(breaks), breaks);
  // The 13-second look down leaves under half of this 48-second session with a clear view of the chest, so
  // breathing is (rightly) not read here: the tile must say why rather than show a number.
  const holdsTile = ((await text(fp, '[data-testid="tile-holds"]')) ?? '').replace(/\s+/g, ' ');
  check('breathing pauses: a count, or why there isn’t one', /while you worked ?(\d+ ?(longest|none)|– ?not readable: needs a clear view of your chest)/.test(holdsTile), holdsTile);
  const mapBreaks = (await fp.$$('[data-testid="map-break"]')).length;
  const mapStretches = (await fp.$$('[data-testid="map-stretch"]')).length;
  check('the focus map shows two stretches around one break', mapBreaks === 1 && mapStretches === 2, { mapBreaks, mapStretches });
  check('…and the app lane', (await fp.$$('[data-testid="map-app"]')).length >= 4);
  const box = await fp.$eval('[data-testid="focus-map"] svg', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  await fp.mouse.move(box.x + 52 + (box.w - 52) * 0.3, box.y + 10);
  const tip = (await text(fp, '[data-testid="map-tip"]')) ?? '';
  check('hovering the map says what was happening, and in which app', /\d:\d\d(Break|Focused stretch|Left your desk)/.test(tip) && /(Code|Safari|Slack)/.test(tip), tip);
  const apps = await fp.$$eval('[data-testid="focus-app"]', (els) => els.map((e) => e.getAttribute('data-name')));
  check('where your focus went: Code first, then Safari and Slack', apps[0] === 'Code' && apps.includes('Safari') && apps.includes('Slack') && apps.length === 3, apps);
  const sw = Number(((await text(fp, '[data-testid="tile-switches"]')) ?? '').replace(/\D+/g, ' ').trim().split(' ')[0]);
  check('app switches are counted (the scripted cycle switches 4 times every 20 s: about 8 in 48 s)', sw >= 6 && sw <= 10, sw);
  check('Do Not Disturb is shown as on', await fp.isVisible('[data-testid="dnd-badge"]'));
  await fp.click('[data-testid="how-built"] button');
  const built = (await text(fp, '[data-testid="how-built"]')) ?? '';
  check('how the score is built: eyes, stretch, apps, blinking', ['Eyes on the work', 'Longest stretch', 'Staying in one app', 'Blinking'].every((k) => built.includes(k)), built.slice(0, 120));
  check('focus report copy is free of banned words', !(await bannedOnPage(fp)).length, await bannedOnPage(fp));
  check('the map has a legend that names the apps', ((await text(fp, '[data-testid="map-legend"]')) ?? '').includes('Code'), await text(fp, '[data-testid="map-legend"]'));
  await fp.evaluate(() => document.querySelector('[data-testid="focus-map"]')?.scrollIntoView({ block: 'start' }));
  await fp.waitForTimeout(500);
  await shot(fp, '27b-focus-report-map-apps');
  await fp.evaluate(() => document.querySelectorAll('.scroll').forEach((e) => (e.scrollTop = 0)));
  await shot(fp, '27-focus-report-top');
  await fp.screenshot({ path: join(ART, '28-focus-report-full.png'), fullPage: true });
  const dark = await gradientContrast(fp);
  check('white on the plum fill keeps >= 3.3:1 (dark)', dark['--focus-fill-1'] >= 3.3 && dark['--focus-fill-2'] >= 3.3, dark);
  await fp.click('[data-testid="done"]');

  // ---- History, and the light theme.
  await fp.click('[data-testid="nav-history"]');
  await fp.click('[role="radio"]:has-text("Focus")');
  const rows = await fp.$$('[data-testid="history-list"] [data-testid="report-row"]');
  const listText = (await text(fp, '[data-testid="history-list"]')) ?? '';
  check('History filters to focus sessions', rows.length === 1 && listText.includes('Write the launch post') && listText.includes('Focus session'), listText.slice(0, 80));
  await fp.click('[data-testid="nav-settings"]');
  await fp.click('[role="radio"]:has-text("Light")');
  await fp.click('[data-testid="nav-history"]');
  await fp.click('[role="radio"]:has-text("Focus")');
  await fp.click('[data-testid="history-list"] [data-testid="open-report"] >> nth=0');
  check('a saved focus session reopens with its map and apps', (await vis(fp, '[data-testid="focus-map"]')) && (await fp.isVisible('[data-testid="focus-apps"]')));
  await shot(fp, '29-focus-report-light');
  const light = await gradientContrast(fp);
  check('white on the plum fill keeps >= 3.3:1 (light)', light['--focus-fill-1'] >= 3.3 && light['--focus-fill-2'] >= 3.3, light);
  await fp.click('[data-testid="nav-settings"]');
  await fp.click('[role="radio"]:has-text("Dark")');

  // ---- Every way out turns Do Not Disturb off.
  const start = async () => {
    await fp.click('[data-testid="nav-home"]');
    await fp.click('[data-testid="start-focus"]');
    await fp.waitForSelector('[data-testid="dnd"][data-state="ready"]', { timeout: 10000 });
    await consent(fp, false);
    await fp.click('[data-testid="start"]');
  };
  await start();
  await waitRuns(fp, 3);
  await fp.click('[data-testid="cancel"]');
  check('stopping while finding your normal turns it off', (await waitRuns(fp, 4)).slice(2).join() === `${ON},${OFF}`, runs());
  await start();
  await waitRuns(fp, 5);
  await vis(fp, '[data-testid="watch-bar"]', 40000);
  await fp.click('[data-testid="watch-bar"] [data-testid="stop"]');
  check('stopping on the bar turns it off', (await waitRuns(fp, 6)).slice(4).join() === `${ON},${OFF}`, runs());
  await vis(fp, '[data-testid="felt-focus"]');
  await fp.click('[data-testid="see-report"]');
  check('a session stopped early still gets a report', await vis(fp, '[data-testid="report"][data-mode="focus"]', 20000));
  await fp.click('[data-testid="done"]');
  await start();
  await waitRuns(fp, 7);
  check('no errors in the page (focus)', !F.errors.length, F.errors.slice(0, 3));
  await F.app.close();
  for (const end = Date.now() + 4000; runs().length < 8 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 100));
  const all = runs();
  check('quitting mid-session turns it off; every On has its Off', all.length === 8 && all[7] === OFF && all.filter((r) => r === ON).length === 4 && all.filter((r) => r === OFF).length === 4, all);
}
