# Counterfeed

**Your feed measures you. Measure it back.**

Counterfeed is a Mac app that watches your breathing, blinking and gaze with the camera (Presage SmartSpectra, on this Mac) while you scroll or review something, then shows you, in one page, what it did to your attention.

- **Feed check.** Scroll Instagram, TikTok, YouTube or anything else (your real phone apps through iPhone Mirroring, or any browser tab). Counterfeed shrinks to a small bar that notices breathing pauses, long stares and looking away as they happen. Then you get a **Pull score**, the moments that hooked you with a picture of what was on screen, and one small suggestion built from your own numbers.
- **Review a project.** For judges and reviewers. Play a demo video inside Counterfeed, or try an app in any window. The report shows **where it held you and where it lost you** along the video, how the first 30 seconds went, and your own scores next to what your body did. Click any moment to play the video from there.
- **Test your hooks.** For creators. Drop in 2 to 6 short clips (or use the bundled demo pack) and scroll them like a feed: each plays once, and you swipe on (↓, scroll, or *Next*) whenever you would. Then pick the one you'd post, and see **which clip held you hardest, the second it grabbed you, and where you swiped away**, with your pick next to what your body chose.
- **Focus on one thing.** Name the task, set a timer (2, 10, 25 or 50 minutes, or until you stop) and work. Counterfeed turns on your Mac's **Do Not Disturb**, shrinks to a bar with a countdown (*Focused · 6:12*, or *Looking away · 12 s*), and notes which app is in front. Then a **Focus score**: how much of the time your eyes stayed on the work, your longest stretch without a break, a map of the session, and **where your focus went, app by app**, next to how focused it felt.

Built for the DEV *Presage SmartSpectra SDK Challenge*.

---

## Setup

Requirements: macOS on Apple Silicon, **Node 24 LTS** (`.nvmrc`), a free SmartSpectra API key from <https://physiology.presagetech.com/>.

```bash
npm install
cp .env.example .env      # then put your key in SMARTSPECTRA_API_KEY (or paste it in Settings later)
npm run dev
```

The key is read by the Electron **main** process only (from `.env`, or saved encrypted to your Keychain from Settings) and handed to the renderer once through a narrow preload API. `.env` is git-ignored and never logged.

On first use macOS asks for **Camera** access (measuring) and, for a feed check, **Screen Recording** (small pictures of the window you pick). Without Screen Recording you can still choose **Without pictures**.

**Credits.** SmartSpectra's free tier is 100 credits, 1 credit per 30 s of measuring. A 5-minute feed check is about 12 credits (40 s settle + 5 min); the setup screen shows the estimate before you start. A 25-minute focus session is about 52 credits; the 2-minute option is there to try it.

**Do Not Disturb (focus sessions).** macOS gives apps no public switch for Focus, so Counterfeed uses Shortcuts. Make two shortcuts once, each with the single action *Set Focus*: **Counterfeed Focus On** (turn Do Not Disturb on, until turned off) and **Counterfeed Focus Off** (turn it off). The setup screen finds them and offers a switch; without them it shows these steps and the session runs the same. Counterfeed turns it off on every way a session ends (time up, stop, cancel, a camera problem, closing the app), and if the app crashed with it on, at the next launch.

### Package

```bash
npm run dist              # release/Counterfeed-*.dmg (arm64)
```

The SmartSpectra native runtime is copied to `Resources/smartspectra/` (a `.dylib` can't load from inside `app.asar`), as in Presage's electron-quickstart.

---

## For judges: the fastest way to see it

1. `npm run dev`, add your key in **Settings**.
2. **Camera check** (sidebar): confirm light and framing; hold your breath and watch the wave go flat.
3. **Review a project** › **A demo video** › pick any demo MP4 (another entry's video works well). Tick the three lines, sit still for ~40 s while it finds your normal, then watch. At the end, rate it; the report puts your scores next to where it actually held you.
4. Or **Check a feed** › pick **iPhone Mirroring** (or a browser tab with Reels/Shorts) › 2 min.
5. Or **Test your hooks** › **Use the demo pack** › Start. About 40 s for your normal, then five 10-second clips; swipe the dull ones. Under 2 minutes, no setup.
6. Or **Focus on one thing** › 2 min › Start, then work in another app. Look down at your phone for 15 seconds halfway: the bar says *Looking away*, and the report shows one break on the map and the apps you used.

No key? Open a report someone exported: **History › Open a report file** shows it read-only (exports never contain pictures).

---

## How it works

```
 camera ─► SmartSpectra renderer SDK (on this Mac) ─► metrics: breathing wave, breath stops, rate,
                                                      pulse, HRV, blinks, talking, expression probabilities
                                                              │
 chosen window / video ─► sampled 2×/s (change) and 1×/s (small picture), in memory only
                                                              │
 settle (your normal) ─► watch (live cues on the bar) ─► questions ─► analysis/ (pure) ─► report
```

```
apps/desktop/src
  main/        window, CSP, permissions, SDK IPC, window list (desktopCapturer), cfmedia:// for the picked
               video (Range requests, only files you chose), compact bar, storage (JSON, 0600), mac.ts (the
               front app's name via lsappinfo; Do Not Disturb via the person's two Shortcuts)
  preload/     SmartSpectra's preload bridge + the narrow `window.counterfeed` API
  renderer/src/
    sensing/   CameraSource (SDK), normalize (SDK payload → samples), quality, TestSource (e2e only)
    content/   ContentCapture: screen change detection and small pictures
    session/   the flow: setup → settle → watch → questions → report, and every way it can end
    analysis/  detectors, score, attention curve, words (summary, suggestion, banned words), hooks, focus
    ui/        screens; charts, waves and icons are hand-made (SVG, canvas)
packages/shared  zod schemas for stored reports and exports
```

### What is measured, and how

- **Your normal.** Each session starts with ~40 s looking at a calm screen. It only counts while the SDK reports a clear view; after 90 s you can continue anyway, and the report then leaves out comparisons with your normal.
- **Breathing pauses.** The breathing wave stays under 30% of your typical breath size (median 8-second peak-to-peak) for 6 s or more, plus any SDK breath-stop detection of 5 s or more. Read only where the SDK is fully satisfied (chest in view), 2 s after the view returns, and never while you're talking or looking away. A flat stretch over 30 s, or one the SDK marked mostly unstable, is a faded signal and is dropped. If the chest was in view for under half the session (typical for a laptop camera), breathing is **left out** of the report, shown as "not readable", not as zero.
- **Unbroken stare.** A gap between blinks longer than 2.5× your usual gap (kept between 8 and 20 s). Blinks are rising edges of the SDK's blink detection.
- **Looked away.** For 1.5 s or more, either the SDK says no face / not facing the screen, or your **head pose** (from the SDK's 478 face landmarks, reduced on arrival to two ratios and never stored) turns more than 0.18 face-widths or tilts down more than 0.10 from *your own* recent pose. The SDK reports one validation code at a time, so "chest not in view" can hide a head turn; head pose catches it anyway. Your normal pose follows posture changes (sitting back is not "looking away"). Light and motion warnings make a stretch *unclear*: excluded, not counted against you. Chest-only warnings keep the face measures.
- **Expressions.** SmartSpectra's facial-expression probabilities (smile, surprise, frown), smoothed over 0.5 s; a moment needs 55+ and 25 points above your own level over the previous 10 s. People rarely smile when alone, so these are rare by design.
- **Pull / Hold score (0-100).** Weighted from what was measured, each against your own normal: blinking drop 30%, breathing pauses 25%, longest stare 20%, eyes on screen 15%, time sense 10% (feed only). Missing parts are left out, never guessed; under two parts or under 20 s of watching, there is no score. Every part is shown under *How the score is built*.
- **Attention curve.** Per bin: share of time facing the screen × (blink suppression, breathing pause, expression). Along the video for a video review, else along your session.
- **Hook test (per clip).** Hold score = 100 × *stayed* × (0.35 + 0.65 × *engagement*). *Stayed* is the share of the clip you watched before swiping (1 if you watched to the end), so a clip you swiped early can never outrank one you watched. *Engagement*, while it played: facing the screen 20, going longer than your usual blink gap 25, a strong smile or surprise 20 (weights relative; unmeasurable parts are left out, and with none it counts as average). Attention second by second is 0.5 while facing, rising to 1 the longer you go without blinking (a blink resets it), plus 0.25 during a strong expression, 0 while looking away. *Grabbed you*: two seconds in a row at 0.9 or more, or a strong expression. *The first 3 seconds*: landed (grabbed within 3 s), slow start (later), kept you (stayed, nothing stood out), lost you (swiped or looked away within 3 s). Clips play in a shuffled order unless you turn that off, positions follow the video (not the wall clock), and clips that can't play or are under 2 s / over 3 min are flagged before you start. The demo pack (`apps/desktop/resources/demo-pack`) is five procedural clips made by `scripts/make-demo-pack.mjs` with ffmpeg: no stock footage, nothing to license.
- **Focus session.** *Focused* = your face toward the screen (the same face check and head pose as above). Looking away for under 10 s (thinking, checking notes) still counts as focused; **10 s or more is a break** and ends a stretch; no face for 30 s or more is *left your desk*. Time the camera can't read is left out of both. The front app's name is read from macOS (`lsappinfo`, no permission needed) once a second; Counterfeed's own bar doesn't count as an app, and a stalled reading covers at most 3 s. **Focus score** = eyes on the work 50%, longest stretch without a break (against the session, up to 25 minutes) 20%, staying in one app 15% (1 / (1 + switches per 10 min / 5)), blinking against your normal 15%; parts that couldn't be measured are left out. The bar's count restarts after a break, not after a glance.
- **Pulse and HRV** are slow (12 s and 60 s windows), so they are shown only for the whole session, never per post.

### Words

Every sentence about your body comes from `analysis/words.ts`, describes what was measured, and never names a feeling, a brain chemical or a health condition. A banned-word list (stress, anxiety, addiction, dopamine, emotion, diagnosis, …) is checked in unit tests over every generated sentence, and on every screen in the e2e suite.

---

## Consent and Data Handling

**Consent.** Nothing starts until you tick each line on the setup screen: measuring with the camera; keeping small pictures of the window you chose (only when there will be pictures); and that this is wellness information. Every session asks again. The person in front of the camera starts the session; if a second face appears, measuring pauses (the SDK reports it).

**On this Mac only**
- Camera frames: analysed by SmartSpectra on this Mac, never stored or sent. The SDK contacts Presage only to validate the API key.
- Screen: the window you picked is sampled in memory while you watch. Only the small pictures at your report's moments (at most 24) are saved.

**Stored** in `~/Library/Application Support/Counterfeed/reports/` (files readable only by you): each report (numbers, short labels, your answers; for a focus session, the names of the apps in front, never what was in them) and its pictures in a separate file.

**Retention and deletion.** Kept until you delete them: one report, or **Delete all** (History or Settings).

**Export.** **History › Export** writes your reports as one JSON file: numbers and your answers, **never pictures**. **Open a report file** shows an export read-only; it is never merged into your History.

**Telemetry.** SmartSpectra's aggregate session telemetry is **disabled** (`enableTelemetry: false`). Counterfeed has no accounts, no analytics, no server, and uses **no AI services** (the SDK's optional LLM Insights are not used).

**Not medical.** Wellness information, not a medical measurement. No diagnosis or treatment claims. The Pull score is a description of attention, not a brain chemical or a health measure, and it never compares you with anyone else.

---

## Limitations

- **Sitting still, even light; chest in view for breathing.** Blinks, stares, expressions and looking away need only the face. Breathing pauses need the upper chest in view and a steady camera; with a laptop camera that sees only your face, they're switched off (the settle checklist says so). Large motion can give wrong readings with high confidence.
- **What real recordings showed** (two guided sessions, replayed in `test/renderer/real-replay.test.ts`): every requested head turn and look down was caught, including ones the SDK's own codes missed. Deliberate 12 s breath holds were found in one session and missed in the other, where the SDK marked the wave unstable or flagged "talking" while nobody spoke; the app stays silent rather than guessing. The SDK's blink detection under-counts (about 6-14 blinks a minute where 15-20 is typical), so "blinked X% less" compares like with like, but absolute rates run low.
- **iPhone Mirroring is not phone-in-hand.** Posture differs from scrolling on the sofa. iPhone Mirroring needs macOS 15+ and is not available in the EU; any browser tab works instead.
- **Screen changes are approximate** (a big frame difference); shown as "about".
- **Expressions are probabilities**, and solo viewers smile little.
- **Fairness.** Camera-based measurement can perform differently across skin tones and lighting; see Presage's model cards (Settings › About).

---

## Testing

```bash
npm run check             # eslint + tsc + vitest
npm run e2e               # builds, then drives the real app end to end
```

**Unit (vitest).** Head pose from landmarks, looking away against your own posture (turns, looking down, sitting back, gaps, very long runs), where each measure is trusted when the chest is out of view, detectors on synthetic signals (a 10 s flat stretch is one pause; normal breathing and 4 s gaps are none; pauses during talking or out of view are not counted), blink edges and stretches split by looking away, expression moments (a smiley resting face is not a moment), a full report build (feed and video review with a pause excluded), the score at its extremes, the time map, thumbnail choice, banned words over every generated sentence, SDK payload decoding through Presage's own protobuf codec, storage (validation, path tricks, corrupt files, exports without pictures, 0600 files), Range requests for the local video, and the focus session (glances vs breaks, leaving the desk, unreadable time, per-app time and switches with Counterfeed's own bar ignored, the score's parts and words, a full focus report built from a synthetic 5-minute session and checked number by number) plus its macOS side (parsing `lsappinfo`, finding the two shortcuts, and Do Not Disturb on and off through a stand-in Shortcuts tool, including quitting and recovering after a crash).

**End to end (189 checks).** The built app with a labelled test signal (never the SDK, never synthetic video into the SDK): a feed check start to finish, including the compact always-on-top bar and its live cues; a video review with pause, ratings, and play-from-moment; stopping after 3 s; cancelling during settle (nothing saved); closing the app mid-session (saved, marked ended early); History, export without pictures, opening an export read-only, Delete all; the camera check wave; white-on-gradient contrast in both themes; banned words on every report; and a **laptop-camera run** where the SDK reports "chest not in view" the whole session (your normal still completes without "Continue anyway", head turns and a look down hidden behind that code are caught live and in the report, and breathing is shown as not readable, never as pauses); and a **hook test** start to finish (the demo pack loads and every clip is checked; a broken file and a 1-second clip are flagged and never played; the 6-clip limit and no duplicates; clips play inside the app with names hidden; a clip that ends moves on by itself; ↓ swipes, and a second swipe straight after is ignored; the 9:16 player never covers its side panel; "which one would you post?" with a still of every clip seen; the ranking puts the clip with the stare and the smile first and the swiped clip last, below every clip watched to the end; your pick next to what held you; second-by-second rows with the swipe marked; play from any clip; reopening from History with its stills but no player; indigo contrast in both themes); and a **focus session** start to finish (the Shortcuts setup when they don't exist; with a stand-in Shortcuts tool, Do Not Disturb on as the session starts and off on every way out: time up, stop during settle, stop on the bar, quitting; the countdown bar; the focused count restarts after a 13 s look down but not after a 2.5 s glance; one break on the map, Code first among the apps, about 8 switches; how it felt next to what was measured; History, with focus over time once two sessions are scored; the app's own version in Settings; plum contrast in both themes). Screenshots go to `apps/desktop/e2e/artifacts/` (git-ignored).

**Real camera (manual, uses credits).** `npm run build && node e2e/real.mjs` runs the real SDK with a prompter window that asks the person at the Mac to breathe normally, hold their breath, stare, smile, turn their head, look down, and sit back, then compares the report with what was asked. It stops on its own if no face appears within 20 s. Two more guided runs check the newer modes: `node e2e/real-focus.mjs` (2 minutes of work with a glance, a look down, an app switch and leaving the desk, prompts also spoken aloud; uses your Do Not Disturb shortcuts if they exist; about 6 credits) and `node e2e/real-hooks.mjs` (the demo pack in order; the script swipes one clip; about 4 credits). Developer runs also keep the eye-contour points of every frame, to check blink detection from eye shape against the SDK's. The raw session is saved to `apps/desktop/e2e/artifacts/real/` (git-ignored: it holds your body signals) and can be replayed by the unit tests.

---

## Demo script (3 minutes)

1. **Home.** "Your feed measures you. Measure it back." Four doors.
2. **Camera check.** Hold your breath: the wave goes flat. That's what gets counted.
3. **Feed check** on iPhone Mirroring, 2 min. The bar shrinks to the corner; scroll Reels; the bar says *Breathing paused · 9 s* while it happens.
4. **Report.** Pull score, one sentence, the Reel that was on screen at each pause, *You guessed 1 min. It was 2*, one thing to try. Open *How the score is built*.
5. **Review a project** with another entry's demo video. *Where it lost you* → click → the video plays from that moment.
6. **Test your hooks** › demo pack. Swipe *Test card* after a second. Pick *Color drift* as the one you'd post. The report: the winner, *Lost you in the first 3 s* on the one you swiped, and *You'd post "Color drift". Your body stayed with "Fractal dive".*
7. **Focus on one thing**, 2 min, Do Not Disturb on. Work in your editor, check Slack once, look down at your phone. The bar counts *Focused · 0:48*, then *Looking away · 12 s*. The report: *Steady focus*, the break on the map, Code first in *Where your focus went*, and *It felt focused. The camera measured 81% focused.*
8. **History › Export**, then **Delete all**.

---

## Credits

- Measurement: **Presage SmartSpectra SDK** (`@smartspectra/node-sdk`). Electron wiring follows Presage's [electron-quickstart](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart) sample: preload bridge, permission handler, `worker-src blob:` CSP, packaged native-runtime path and entitlements.
- Research the design leans on: Nakano et al. 2009 (viewers hold blinks at moments that matter), Fridlund 1991 (people smile little when alone), Linda Stone's "email apnea" (breath holding at screens).
- Built with Electron, electron-vite, React, Tailwind CSS, zustand, zod and vitest.
