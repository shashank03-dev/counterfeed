/**
 * End-to-end suite. Drives the BUILT app (two isolated instances) against the REAL signaling server over a
 * REAL WebRTC connection on this machine. Sensing uses the e2e test signal (never the SDK with fake video);
 * the call uses Chromium's fake camera/mic. Every check prints what it measured.
 *
 *   npm run e2e            (from apps/desktop, after npm run build)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startSignalServer } from '../../signal/src/server.ts';
import { _electron } from 'playwright-core';
import { appDir, launch } from './launch.mjs';

const ART = join(appDir, 'e2e/artifacts');
mkdirSync(ART, { recursive: true });
const results = [];
const metrics = {};
let failed = 0;

function check(name, ok, measured) {
  results.push({ name, ok: !!ok, measured });
  if (!ok) failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${measured !== undefined ? `  — ${typeof measured === 'string' ? measured : JSON.stringify(measured)}` : ''}`);
}
const shot = (page, name) => page.screenshot({ path: join(ART, `${name}.png`) });
let failShots = 0;
const vis = async (page, sel, timeout = 15000) => {
  try {
    await page.waitForSelector(sel, { state: 'visible', timeout });
    return true;
  } catch {
    await page.screenshot({ path: join(ART, `fail-${++failShots}.png`) }).catch(() => {});
    console.log(`    (not visible: ${sel}; screenshot fail-${failShots}.png)`);
    return false;
  }
};

async function consent(page, { share = false, record = false } = {}) {
  await page.waitForSelector('[data-testid="consent-accept"]');
  for (const id of ['media', 'signals', 'local', 'stored', 'telemetry', 'end']) await page.click(`[data-testid="consent-${id}"]`);
  if (share) await page.click('[data-testid="pref-share"]');
  if (record) await page.click('[data-testid="pref-record"]');
  await page.click('[data-testid="consent-accept"]');
}

/** Non-transparent pixels in the wave canvas (proof that something is being drawn). */
const inked = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="waves"]');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return n;
  });

/** CPU % (averaged over `ms`) and memory per Electron process. */
async function sample(app, ms = 5000) {
  await app.evaluate(({ app }) => app.getAppMetrics());
  await new Promise((r) => setTimeout(r, ms));
  return app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, name: m.name ?? m.serviceName ?? '', cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, memMB: Math.round(m.memory.workingSetSize / 1024) })),
  );
}

/** Frame pacing in the renderer for `ms`: mean/p95 frame interval and long tasks. */
const framePacing = (page, ms = 4000) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const gaps = [];
        let long = 0;
        const po = new PerformanceObserver((l) => (long += l.getEntries().length));
        po.observe({ type: 'longtask', buffered: false });
        let last = performance.now();
        const end = last + ms;
        const f = (t) => {
          gaps.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(f);
          else {
            po.disconnect();
            gaps.sort((a, b) => a - b);
            const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
            resolve({ frames: gaps.length, meanMs: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), p95Ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), longTasks: long, heapMB: heap });
          }
        };
        requestAnimationFrame(f);
      }),
    ms,
  );

/* ====================================================================== */

let A, B;
const server = await startSignalServer({ port: 0 });
try {
const url = server.url;
console.log(`signal server ${url}`);

// ---------------------------------------------------------------- 1. idle footprint
console.log('\n1. Idle app footprint');
{
  // Baseline: a bare Electron window with a static page, measured the same way on this machine.
  const bareMain = join(ART, 'bare-main.cjs');
  writeFileSync(bareMain, "require('electron').app.whenReady().then(()=>{new (require('electron').BrowserWindow)({width:1280,height:840}).loadURL('data:text/html,blank')})");
  const bare = await _electron.launch({ args: [bareMain], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  await bare.firstWindow();
  await new Promise((r) => setTimeout(r, 4000));
  const bareMem = Math.round(await bare.evaluate(({ app }) => app.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize / 1024, 0)));
  await bare.close();

  const { app, page, errors } = await launch({ name: 'idle', signalUrl: url });
  await page.waitForTimeout(1500);
  const m = await sample(app, 3000);
  const total = m.reduce((s, x) => s + x.cpu, 0);
  const mem = m.reduce((s, x) => s + x.memMB, 0);
  metrics.idle = { cpuPct: +total.toFixed(1), memMB: mem, bareElectronMB: bareMem, overheadMB: mem - bareMem, processes: m };
  check('idle CPU across all processes < 5%', total < 5, `${total.toFixed(1)}%`);
  check('idle memory within 150 MB of a bare Electron window', mem - bareMem < 150, `${mem} MB vs bare ${bareMem} MB (+${mem - bareMem})`);
  check('no console errors on start', errors.length === 0, errors);
  await app.close();
}

// ---------------------------------------------------------------- 2. full two-person session
console.log('\n2. Full session: host + guest over real signaling and WebRTC');
// The host runs a Short session (1 + 1.5 min) at 0.8x: 48 s apart, 72 s together. The guest keeps the Full
// default, so finishing in step with the host proves it follows the host's durations.
A = await launch({ name: 'host', signalUrl: url, phaseScale: 0.8, env: { TOGETHER_TEST_SEED: '11' } });
B = await launch({ name: 'guest', signalUrl: url, phaseScale: 0.8, env: { TOGETHER_TEST_SEED: '22' } });
{
  const { page: a } = A;
  const { page: b } = B;
  await a.getByRole('radio', { name: 'Short' }).click();
  const plan = await a.textContent('[data-testid="session-plan"]');
  check('choosing Short updates the session plan on Home', /apart · 1 min/.test(plan) && /together · 1\.5 min/.test(plan), plan);
  await a.click('[data-testid="start-room"]');
  check('consent shown before anything starts', await vis(a, '[data-testid="consent-accept"]'));
  check('accept is disabled until every line is ticked', await a.isDisabled('[data-testid="consent-accept"]'));
  const camBefore = await a.evaluate(() => document.querySelectorAll('video').length);
  check('no video elements before consent', camBefore === 0, camBefore);
  await a.waitForTimeout(700); // let the entrance animation settle
  await shot(a, '01-consent');
  await consent(a, { share: true, record: true });
  check('host gets a WORD-00 room code', await vis(a, '[data-testid="room-code"]'));
  const code = (await a.textContent('[data-testid="room-code"]')).replace(/[^A-Z0-9-]/g, '');
  check('code format', /^[A-Z]{3,5}-\d{2}$/.test(code), code);
  await a.waitForTimeout(600);
  await shot(a, '02-waiting');

  await b.fill('[data-testid="join-code"]', code.toLowerCase().replace('-', ' '));
  await b.click('[data-testid="join-room"]');
  await consent(b, { share: true });
  const t0 = Date.now();
  const lobbyA = await vis(a, '[data-testid="ready"]', 20000);
  const lobbyB = await vis(b, '[data-testid="ready"]', 20000);
  check('both reach the lobby (peer connection + data channel open)', lobbyA && lobbyB, `${Date.now() - t0} ms`);
  await a.waitForTimeout(1500);
  await shot(a, '03-lobby');

  check('host cannot start before both are ready', await a.isDisabled('[data-testid="start-call"]'));
  await a.click('[data-testid="ready"]');
  await b.click('[data-testid="ready"]');
  await a.waitForSelector('[data-testid="start-call"]:not([disabled])', { timeout: 5000 });
  await a.click('[data-testid="start-call"]');
  check('call starts on both sides', (await vis(a, '[data-testid="begin-breathing"]')) && (await vis(b, '[data-testid="partner-video"]')));
  await a.waitForTimeout(3000);
  const remoteVideo = await a.evaluate(() => {
    const v = document.querySelector('[data-testid="partner-video"] video');
    return v && v.srcObject ? { w: v.videoWidth, h: v.videoHeight, tracks: v.srcObject.getTracks().map((t) => t.kind).sort() } : null;
  });
  check('host receives the guest’s video and audio tracks', remoteVideo && remoteVideo.w > 0 && remoteVideo.tracks.includes('audio') && remoteVideo.tracks.includes('video'), remoteVideo);
  const heart = await a.textContent('[data-testid="partner-heart"]');
  check('partner pulse arrives over the data channel', /\d+bpm/.test(heart.replace(/\s/g, '')), heart);
  await shot(a, '04-call');
  await a.click('[data-testid="toggle-moments"]');
  await a.waitForTimeout(300);
  await shot(a, '05-call-moments');
  await a.click('[data-testid="toggle-moments"]');

  // Mic toggle really disables the outgoing audio track.
  await a.waitForFunction(() => !!window.__together.session()?.mic, null, { timeout: 5000 });
  const micBefore = await a.evaluate(() => {
    const t = window.__together.session()?.mic?.getAudioTracks()[0];
    return t ? t.enabled : null;
  });
  await a.click('[data-testid="toggle-mic"]');
  await a.waitForTimeout(200);
  const micAfter = await a.evaluate(() => window.__together.session()?.mic?.getAudioTracks()[0]?.enabled ?? null);
  const label = await a.getAttribute('[data-testid="toggle-mic"]', 'aria-label');
  check('mute disables the outgoing mic track and the button says so', micBefore === true && micAfter === false && label === 'Unmute microphone', { micBefore, micAfter, label });
  await a.click('[data-testid="toggle-mic"]');

  await a.click('[data-testid="begin-breathing"]');
  check('both see the mood pick', (await vis(a, '[data-testid="mood-Tense"]')) && (await vis(b, '[data-testid="mood-Calm"]')));
  await shot(a, '06-mood');
  await a.click('[data-testid="mood-Tense"]');
  await a.click('[data-testid="mood-share"]');
  await a.click('[data-testid="mood-continue"]');
  await b.click('[data-testid="mood-Calm"]');
  await b.click('[data-testid="mood-continue"]');

  const apartA = await vis(a, '[data-testid="phase-apart"]', 15000);
  const apartB = await vis(b, '[data-testid="phase-apart"]', 15000);
  check('both switch to Apart', apartA && apartB);
  await a.waitForTimeout(4000);
  const inkApart = await inked(a);
  check('Apart draws your wave', inkApart > 500, `${inkApart} px`);
  await shot(a, '07-apart');

  const togA = await vis(a, '[data-testid="phase-together"]', 70000);
  const togB = await vis(b, '[data-testid="phase-together"]', 5000);
  check('both switch to Together (host-driven, aligned clock)', togA && togB);
  await a.waitForTimeout(2500);
  const inkTog = await inked(a);
  check('Together draws both waves', inkTog > inkApart, `${inkTog} px (apart ${inkApart})`);

  // Measure while the most demanding screen is up: video both ways + two waves + live sync.
  const [mA, fA] = await Promise.all([sample(A.app, 5000), framePacing(a, 5000)]);
  const cpuA = mA.reduce((s, x) => s + x.cpu, 0);
  const memA = mA.reduce((s, x) => s + x.memMB, 0);
  const rend = mA.find((x) => x.type === 'Tab') ?? {};
  metrics.together = { cpuPctAllProcesses: +cpuA.toFixed(1), rendererCpuPct: rend.cpu, memMB: memA, rendererMemMB: rend.memMB, frames: fA, processes: mA };
  check('renderer keeps ~45 fps wave rendering (mean frame < 24 ms)', fA.meanMs < 24, fA);
  check('no long tasks (>50 ms) on the renderer during Together', fA.longTasks === 0, fA.longTasks);
  check('renderer JS heap < 120 MB', (fA.heapMB ?? 0) < 120, `${fA.heapMB} MB`);
  check('whole app CPU during Together < 150% (sum over processes)', cpuA < 150, `${cpuA.toFixed(1)}% (renderer ${rend.cpu}%)`);
  await a.waitForTimeout(25000);
  const meter = await a.getAttribute('[data-testid="sync-meter"]', 'aria-valuenow');
  check('live sync meter shows a value after 30 s of Together', meter !== null, meter);
  const chanceMark = await vis(a, '[data-testid="sync-meter-chance"]', 6000);
  check('live meter shows the chance mark and value', chanceMark && (await vis(a, '[data-testid="sync-meter-chance-value"]', 1000)), await a.textContent('[data-testid="sync-meter"]'));
  await shot(a, '08-together');
  await shot(b, '08b-together-guest');

  check('both reach the end mood pick', (await vis(a, '[data-testid="mood-Calm"]', 60000)) && (await vis(b, '[data-testid="mood-Light"]', 5000)));
  await a.click('[data-testid="mood-Calm"]');
  await a.click('[data-testid="mood-continue"]');
  await b.click('[data-testid="mood-Light"]');
  await b.click('[data-testid="mood-continue"]');
  check('both see results', (await vis(a, '[data-testid="results"]', 20000)) && (await vis(b, '[data-testid="results"]', 20000)));
  await a.waitForTimeout(800);
  const verdictA = await a.textContent('[data-testid="verdict"]');
  const verdictB = await b.textContent('[data-testid="verdict"]');
  check('results state a verdict', verdictA.length > 10, verdictA);
  check('host and guest reach the same verdict', verdictA === verdictB || /chance/.test(verdictA) === /chance/.test(verdictB), `${verdictA} | ${verdictB}`);
  check('Apart and Together bars are present', (await vis(a, '[data-testid="bar-apart"]')) && (await vis(a, '[data-testid="bar-together"]')));
  const barT = await a.textContent('[data-testid="bar-together"]');
  check('result bars state the chance level and the Short length', /chance \d+/.test(barT) && /Together · 1 min/.test(barT), barT);
  const camAfter = await a.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length);
  check('camera and call media stopped at the end', camAfter === 0, camAfter);
  await shot(a, '09-results');
  await shot(b, '09b-results-guest');

  await a.click('[data-testid="done"]');
  await b.click('[data-testid="done"]');
  await a.click('[data-testid="nav-history"]');
  const rows = await a.locator('[data-testid="history-row"]').count();
  check('session saved to History', rows === 1, rows);
  const stored = JSON.parse(readFileSync(join(A.dir, 'sessions', (await import('node:fs')).readdirSync(join(A.dir, 'sessions'))[0]), 'utf8'));
  check('stored record has the guest’s shared mood but no media', stored.moods.partner.start === null && stored.moods.you.start === 'Tense' && !/video|frame|pixel/i.test(JSON.stringify(stored)), stored.moods);
  const storedB = JSON.parse(readFileSync(join(B.dir, 'sessions', (await import('node:fs')).readdirSync(join(B.dir, 'sessions'))[0]), 'utf8'));
  check('guest received the host’s shared mood word', storedB.moods.partner.start === 'Tense', storedB.moods.partner);
  check('host and guest both ran the host’s Short lengths (guest default is Full)', stored.lengths?.apart === 48000 && stored.lengths?.together === 72000 && JSON.stringify(storedB.lengths) === JSON.stringify(stored.lengths), { host: stored.lengths, guest: storedB.lengths });
  const recs = (await import('node:fs')).readdirSync(join(A.dir, 'recordings'));
  check('host recording saved (signals only)', recs.length === 1, recs);
  await a.waitForTimeout(500);
  await shot(a, '10-history');

  const exportPath = join(ART, 'export.json');
  await A.app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, exportPath);
  await a.click('[data-testid="export"]');
  await a.waitForTimeout(800);
  const exp = existsSync(exportPath) ? JSON.parse(readFileSync(exportPath, 'utf8')) : null;
  check('Export writes one JSON with the session', exp?.sessions?.length === 1 && exp.kind === 'together-export', exp ? `${exp.sessions.length} sessions, ${exp.recordings.length} recordings` : 'missing');

  // Peer 2 (the second dev instance): no camera, replays the host's recording over the real network.
  {
    const { mkdtempSync, mkdirSync, copyFileSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const p2dir = mkdtempSync(join(tmpdir(), 'together-e2e-peer2-'));
    mkdirSync(join(p2dir, 'recordings'));
    const rec = readdirSync(join(A.dir, 'recordings'))[0];
    copyFileSync(join(A.dir, 'recordings', rec), join(p2dir, 'recordings', rec));
    const C = await launch({ name: 'peer2', signalUrl: url, userData: p2dir, env: { TOGETHER_PEER: '2' } });
    await a.click('[data-testid="nav-home"]');
    await a.click('[data-testid="start-room"]');
    await consent(a);
    await vis(a, '[data-testid="room-code"]');
    const code2 = (await a.textContent('[data-testid="room-code"]')).replace(/[^A-Z0-9-]/g, '');
    await C.page.fill('[data-testid="join-code"]', code2);
    await C.page.click('[data-testid="join-room"]');
    await consent(C.page);
    check('peer 2 connects with a replayed signal', await vis(a, '[data-testid="ready"]', 20000));
    check('host sees the "Replayed session" banner for peer 2', await vis(a, '[data-testid="replay-banner"]', 8000));
    check('peer 2 says it sends a recording, not a live measurement', await vis(C.page, 'text=This instance sends a recording', 5000));
    await a.waitForTimeout(2500);
    const age = await a.evaluate(() => window.__together.session()?.st.live.partner.ageMs ?? null);
    check('peer 2 frames arrive live over the data channel', age !== null && age < 1000, `${age === null ? 'none' : Math.round(age)} ms since last frame`);
    await shot(a, '10b-peer2-lobby');
    await a.click('[data-testid="end"]');
    await a.getByRole('button', { name: 'Leave' }).click();
    await a.getByRole('button', { name: 'Back to home' }).click();
    check('leaving from the lobby stops the camera', (await a.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)) === 0);
    await C.app.close();
  }

  // Practice with the recording just made (replay partner, clearly labelled).
  await a.click('[data-testid="nav-home"]');
  await a.waitForSelector('[data-testid="practice"]');
  await a.click('[data-testid="practice"]');
  await consent(a);
  check('practice shows the permanent replay banner', await vis(a, '[data-testid="replay-banner"]', 10000));
  check('practice reaches the lobby with a replayed partner', await vis(a, '[data-testid="ready"]', 10000));
  await a.click('[data-testid="ready"]');
  await a.waitForSelector('[data-testid="start-call"]:not([disabled])', { timeout: 5000 });
  await a.click('[data-testid="start-call"]');
  await vis(a, '[data-testid="begin-breathing"]');
  await shot(a, '11-practice-call');
  await a.click('[data-testid="end"]');
  await a.getByRole('button', { name: 'End session' }).click();
  check('ending practice early leaves a clear ended state', (await vis(a, '[data-testid="ended"]', 5000)) || (await vis(a, '[data-testid="results"]', 5000)));
  await a.getByRole('button', { name: /Back to home|Done/ }).first().click();

  // Delete all.
  await a.click('[data-testid="nav-history"]');
  await a.click('[data-testid="delete-all"]');
  await a.getByRole('button', { name: 'Delete everything' }).click();
  check('Delete All empties History', await vis(a, '[data-testid="history-empty"]', 5000));
  const left = (await import('node:fs')).readdirSync(join(A.dir, 'sessions')).length + (await import('node:fs')).readdirSync(join(A.dir, 'recordings')).length;
  check('Delete All removes files from disk', left === 0, `${left} files left`);

  // Gradients: every gradient that carries white text/icons keeps >= 3:1 contrast at every stop,
  // and the shared "in step" gradient is actually rendered (not silently dropped by the CSS engine).
  const grad = {};
  for (const r of ['home', 'history', 'diagnostics', 'settings']) {
    await a.click(`[data-testid="nav-${r}"]`);
    await a.waitForTimeout(300);
    grad[r] = await a.evaluate(() => {
      const lum = ([r, g, b]) => {
        const c = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      let worst = Infinity;
      let filled = 0;
      let duoText = 0;
      for (const el of document.querySelectorAll('*')) {
        const cs = window.getComputedStyle(el);
        if (!/gradient/.test(cs.backgroundImage)) continue;
        if (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') {
          duoText++;
          continue;
        }
        if (!/rgb\(255, 255, 255\)/.test(cs.color) || !el.textContent?.trim() && !el.querySelector('svg')) continue;
        filled++;
        for (const m of cs.backgroundImage.matchAll(/rgba?\((\d+), (\d+), (\d+)/g)) worst = Math.min(worst, 1.05 / (lum([+m[1], +m[2], +m[3]]) + 0.05));
      }
      return { filled, duoText, worstContrast: worst === Infinity ? null : +worst.toFixed(2) };
    });
  }
  check('white-on-gradient fills keep >= 3:1 contrast at every stop', Object.values(grad).every((g) => g.worstContrast === null || g.worstContrast >= 3), grad);
  check('the shared "in step" gradient renders on Home', grad.home.duoText >= 1 && grad.home.filled >= 2, grad.home);

  // Solo demo path: camera check -> keep it as a practice partner -> practise against it.
  await a.click('[data-testid="nav-diagnostics"]');
  await a.click('[data-testid="probe-start"]');
  check('camera check shows live readouts', await vis(a, '[data-testid="probe-verdict"]', 10000));
  await a.waitForTimeout(3000);
  check('camera check draws the breathing wave', (await inked(a)) > 300, `${await inked(a)} px`);
  const tSave = Date.now();
  await a.waitForSelector('[data-testid="practice-save"]:not([disabled])', { timeout: 75000 });
  check('"Keep as partner" unlocks after the minimum measured time (60 s x 0.8)', Date.now() - tSave < 60000, `${Math.round((Date.now() - tSave) / 1000)} s`);
  await a.click('[data-testid="practice-save"]');
  check('camera check is saved as a practice partner', await vis(a, '[data-testid="practice-card"] >> text=Saved', 8000));
  await shot(a, '16-camera-check');
  await a.click('[data-testid="probe-stop"]');
  check('stopping the camera check releases the camera', (await a.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)) === 0);
  await a.click('[data-testid="nav-home"]');
  await a.click('[data-testid="practice"]');
  await consent(a);
  check('practice against the saved check reaches the lobby, labelled as a replay', (await vis(a, '[data-testid="ready"]', 10000)) && (await vis(a, '[data-testid="replay-banner"]', 2000)));
  await a.click('[data-testid="end"]');
  await a.getByRole('button', { name: 'Leave' }).click();
  check('leaving early shows no completed phases', (await vis(a, '[data-testid="ended"]', 5000)) && (await a.locator('nav[aria-label="Session progress"]').count()) === 0);
  await a.getByRole('button', { name: 'Back to home' }).click();
  check('back on Home after leaving', await vis(a, '[data-testid="start-room"]', 5000));

  check('no renderer errors during the session (host)', A.errors.length === 0, A.errors.slice(0, 3));
  check('no renderer errors during the session (guest)', B.errors.length === 0, B.errors.slice(0, 3));
}

// ---------------------------------------------------------------- 3. leaving and dropping
console.log('\n3. Ending, dropping and bad codes');
{
  const { page: a } = A;
  const { page: b } = B;
  await a.click('[data-testid="nav-home"]');
  await a.click('[data-testid="start-room"]');
  await consent(a);
  await vis(a, '[data-testid="room-code"]');
  const code = (await a.textContent('[data-testid="room-code"]')).replace(/[^A-Z0-9-]/g, '');
  await b.click('[data-testid="nav-home"]');
  await b.fill('[data-testid="join-code"]', code);
  await b.click('[data-testid="join-room"]');
  await consent(b);
  await vis(a, '[data-testid="ready"]', 20000);
  await a.click('[data-testid="ready"]');
  await b.click('[data-testid="ready"]');
  await a.waitForSelector('[data-testid="start-call"]:not([disabled])');
  await a.click('[data-testid="start-call"]');
  await vis(b, '[data-testid="partner-video"]');
  // Guest ends: host must be told and stop everything.
  await b.click('[data-testid="end"]');
  await b.getByRole('button', { name: 'End session' }).click();
  const t = Date.now();
  check('partner End reaches the host', await vis(a, '[data-testid="ended"]', 8000), `${Date.now() - t} ms`);
  const live = await a.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length);
  check('host media stopped after partner ended', live === 0, live);
  await shot(a, '12-partner-ended');
  await a.getByRole('button', { name: 'Back to home' }).first().click();
  await b.getByRole('button', { name: 'Back to home' }).first().click();

  // A room code that doesn't exist.
  await b.fill('[data-testid="join-code"]', 'MOSS-99');
  await b.click('[data-testid="join-room"]');
  await consent(b);
  check('unknown code -> clear "no room" message', await vis(b, '[data-testid="problem-room-not-found"]', 8000));
  await shot(b, '13-room-not-found');
  await b.getByRole('button', { name: 'Back to home' }).first().click();

  // Typo protection.
  await b.fill('[data-testid="join-code"]', 'hello');
  await b.click('[data-testid="join-room"]');
  check('malformed code is rejected before connecting', await vis(b, 'text=Codes look like TIDE-42', 2000));

  // Guest's laptop dies mid-session (process killed during Apart).
  await b.fill('[data-testid="join-code"]', '');
  await a.click('[data-testid="start-room"]');
  await consent(a);
  await vis(a, '[data-testid="room-code"]');
  const code3 = (await a.textContent('[data-testid="room-code"]')).replace(/[^A-Z0-9-]/g, '');
  await b.fill('[data-testid="join-code"]', code3);
  await b.click('[data-testid="join-room"]');
  await consent(b);
  await vis(a, '[data-testid="ready"]', 20000);
  await a.click('[data-testid="ready"]');
  await b.click('[data-testid="ready"]');
  await a.waitForSelector('[data-testid="start-call"]:not([disabled])');
  await a.click('[data-testid="start-call"]');
  await vis(a, '[data-testid="begin-breathing"]');
  await a.click('[data-testid="begin-breathing"]');
  for (const p of [a, b]) {
    await p.waitForSelector('[data-testid="mood-Steady"]');
    await p.click('[data-testid="mood-Steady"]');
    await p.click('[data-testid="mood-continue"]');
  }
  await vis(a, '[data-testid="phase-apart"]', 15000);
  await a.waitForTimeout(8000);
  B.app.process().kill('SIGKILL');
  const tDrop = Date.now();
  check('host shows "Connection lost" and pauses within 6 s of the drop', await vis(a, 'text=Connection lost.', 6000), `${Date.now() - tDrop} ms`);
  const r1 = await a.getAttribute('[role="timer"]', 'aria-label');
  await a.waitForTimeout(3000);
  const r2 = await a.getAttribute('[role="timer"]', 'aria-label');
  check('the phase timer is paused while waiting', r1 === r2, `${r1} -> ${r2}`);
  const ended = (await vis(a, '[data-testid="results"]', 30000)) || (await vis(a, '[data-testid="ended"]', 1000));
  const waited = Date.now() - tDrop;
  check('after the 20 s window the session ends on its own', ended && waited >= 19000 && waited < 32000, `${Math.round(waited / 1000)} s after the drop`);
  check('partial results are kept and labelled', (await vis(a, 'text=Ended early', 3000)) || (await vis(a, '[data-testid="ended"]', 500)));
  await shot(a, '15-partner-dropped');
  check('host media stopped after the drop', (await a.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)) === 0);
}
await A.app.close();
await B.app.close().catch(() => {});

// ---------------------------------------------------------------- 4. unreachable server
console.log('\n4. Signaling unreachable');
{
  const { app, page } = await launch({ name: 'offline', signalUrl: 'ws://127.0.0.1:9' });
  await page.click('[data-testid="start-room"]');
  await consent(page);
  check('unreachable server -> clear message', await vis(page, '[data-testid="problem-signal-unreachable"]', 10000));
  await shot(page, '14-unreachable');
  await app.close();
}

await server.close();
} catch (err) {
  failed++;
  console.log(`  ✗ suite aborted: ${String(err.message).split('\n')[0]}`);
  await Promise.all([A?.page, B?.page].filter(Boolean).map((p, i) => p.screenshot({ path: join(ART, `abort-${i}.png`) }).catch(() => {})));
}
writeFileSync(join(ART, 'report.json'), JSON.stringify({ when: new Date().toISOString(), passed: results.length - failed, failed, results, metrics }, null, 2));
console.log(`\n${results.length - failed} passed, ${failed} failed. Report: e2e/artifacts/report.json`);
console.log('Metrics:', JSON.stringify({ idle: { cpu: metrics.idle?.cpuPct, mem: metrics.idle?.memMB }, together: { cpu: metrics.together?.cpuPctAllProcesses, renderer: metrics.together?.rendererCpuPct, mem: metrics.together?.memMB, frames: metrics.together?.frames } }));
process.exit(failed ? 1 : 0);
