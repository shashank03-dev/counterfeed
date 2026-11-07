// Guided real-camera Focus session: 2 minutes of "work" with a glance, a look down, an app switch and leaving the
// desk, then the report is checked against what was asked. Real SDK, about 6 credits. Needs a person at the Mac.
//
//   npm run build && node e2e/real-focus.mjs
//
// If the two Shortcuts ("Counterfeed Focus On" / "Off") exist, Do Not Disturb is switched on for real and off at
// the end; the run says which.
import { join } from 'node:path';
import { ART, launchReal, log, saveRun, settle, speak } from './real-kit.mjs';

// Seconds since focusing started. `kind` is what the report should show there.
const PLAN = [
  { from: 0, to: 20, say: 'Click into another app and work', sub: 'A browser or editor; read or type, eyes on the screen', voice: 'Click into another app and work as usual.' },
  { from: 20, to: 23, say: 'Glance away for 2 seconds', sub: 'Then straight back to the screen', kind: 'glance', voice: 'Quick glance away, then back.' },
  { from: 23, to: 38, say: 'Keep working', sub: '' },
  { from: 38, to: 53, say: 'Look down at your lap', sub: 'Like checking your phone, for 15 seconds', kind: 'break', voice: 'Look down at your lap, like checking your phone.' },
  { from: 53, to: 60, say: 'Back to work', sub: '', voice: 'Back to work.' },
  { from: 60, to: 70, say: 'Switch to a different app', sub: 'Work there for 10 seconds', voice: 'Switch to a different app for a moment.' },
  { from: 70, to: 75, say: 'Back to your first app', sub: '', voice: 'Back to your first app.' },
  { from: 75, to: 110, say: 'Step away from the camera', sub: 'Out of view for 35 seconds; you will hear when to come back', kind: 'left', voice: 'Now step away from the camera, out of view. I will tell you when to come back.' },
  { from: 110, to: 120, say: 'Come back and keep working', sub: 'Almost done', voice: 'Come back and keep working.' },
];

const r = await launchReal();
const { app, page, errors, say, text } = r;
await say('Real focus test', 'Get ready', 'Sit facing the screen in good light', 'starting in 5 s');
speak('Real focus test starting in five seconds.');
await page.waitForTimeout(5000);

await page.click('[data-testid="start-focus"]');
await page.waitForSelector('[data-testid="dnd"]:not([data-state="checking"])', { timeout: 15000 });
const dndState = await page.getAttribute('[data-testid="dnd"]', 'data-state');
log('Do Not Disturb shortcuts:', dndState === 'ready' ? 'found, switching it on for this run' : 'not set up, running without');
if (dndState === 'ready' && (await page.getAttribute('[data-testid="pref-dnd"]', 'aria-checked')) !== 'true') await page.click('[data-testid="pref-dnd"]');
if ((await page.getAttribute('[data-testid="pref-apps"]', 'aria-checked')) !== 'true') await page.click('[data-testid="pref-apps"]');
await page.fill('[data-testid="focus-task"]', 'Real focus test');
await page.click('[data-testid="focus-options"] [role="radio"]:has-text("2 min")');
await page.click('[data-testid="consent-camera"]');
await page.click('[data-testid="consent-wellness"]');
await page.click('[data-testid="start"]');

if (!(await settle(r, '[data-testid="watch-bar"]'))) {
  await app.close();
  process.exit(1);
}

const t0 = Date.now();
const cues = [];
let lastCue = '';
let lastStep = null;
while (await page.isVisible('[data-testid="watch-bar"]').catch(() => false)) {
  const sec = (Date.now() - t0) / 1000;
  const step = PLAN.find((p) => sec >= p.from && sec < p.to) ?? PLAN.at(-1);
  if (step !== lastStep) {
    if (step.voice) speak(step.voice);
    lastStep = step;
  }
  await say('Step 2 · focusing', step.say, step.sub, `${Math.max(0, Math.ceil(step.to - sec))} s`);
  const cue = (await text('[data-testid="cue"]'))?.trim() ?? '';
  if (cue && cue.split(' · ')[0] !== lastCue) {
    cues.push({ sec: +sec.toFixed(1), cue });
    log(`  ${sec.toFixed(1)} s  bar: ${cue}`);
    lastCue = cue.split(' · ')[0];
  }
  await page.waitForTimeout(250);
}
speak('Done. Thank you.');
await say('Done', 'Thanks! Building the report', 'You can relax');
await page.waitForSelector('[data-testid="felt-focus"]', { timeout: 20000 });
await page.click('[data-testid="felt-focus-3"]');
await page.click('[data-testid="see-report"]');
await page.waitForSelector('[data-testid="report"][data-mode="focus"]', { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(ART, 'focus-report-top.png') });
const report = await saveRun(page, 'rec-focus', { plan: PLAN, watchStartWallMs: t0, cues });

// Compare with the plan.
const f = report.focus;
const TOL = 5000;
const near = (p) => f.breakSpans.filter((b) => b.endMs >= p.from * 1000 - TOL && b.startMs <= p.to * 1000 + TOL);
console.log('\n=== What you were asked to do vs what the report found ===');
console.table(
  PLAN.filter((p) => p.kind).map((p) => {
    const hit = near(p);
    const expect = p.kind === 'glance' ? 'no break (a glance)' : p.kind === 'left' ? 'a break, marked "left your desk"' : 'a break';
    const found = hit.length ? hit.map((b) => `break ${(b.startMs / 1000).toFixed(1)}-${(b.endMs / 1000).toFixed(1)} s${b.left ? ' (left desk)' : ''}`).join('; ') : 'no break';
    const ok = p.kind === 'glance' ? !hit.length : p.kind === 'left' ? hit.some((b) => b.left) : hit.length > 0;
    return { asked: `${p.say} (${p.from}-${p.to} s)`, expected: expect, found, ok: ok ? 'yes' : 'NO' };
  }),
);
console.log('Breaks not asked for:', f.breakSpans.filter((b) => !PLAN.some((p) => p.kind && p.kind !== 'glance' && b.endMs >= p.from * 1000 - TOL && b.startMs <= p.to * 1000 + TOL)).map((b) => `${(b.startMs / 1000).toFixed(1)}-${(b.endMs / 1000).toFixed(1)} s`).join(', ') || 'none');
console.log('Apps:', f.apps?.map((a) => `${a.name} ${Math.round(a.ms / 1000)} s (${Math.round((a.focusedMs / Math.max(1, a.ms)) * 100)}% focused)`).join(', ') ?? 'not tracked', '· switches:', f.switches);
console.log('Do Not Disturb:', f.dnd);
console.log('Focused', Math.round(f.focusedMs / 1000), 's of', Math.round(f.measuredMs / 1000), 's measured · longest', Math.round(f.longestMs / 1000), 's');
console.log('Score:', report.pull.score, report.pull.parts.map((p) => `${p.key}=${p.value.toFixed(2)}`).join(' '));
console.log('Summary:', report.summary);
console.log('Suggestion:', report.suggestion?.text);
console.log('Notes:', report.notes);
console.log('Page errors:', errors.length ? errors : 'none');
await app.evaluate(() => globalThis.__prompter?.close());
await app.close();
