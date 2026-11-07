---
title: Counterfeed: your feed measures you, so measure it back
published: false
tags: devchallenge, presagechallenge, electron, privacy
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04)*

## What I Built

**Counterfeed** is a Mac app that turns the camera around. Every feed you scroll measures you: how long you stay, what you replay. Counterfeed measures *you* back, with your own body, on your own Mac.

It uses the SmartSpectra SDK to read your breathing, blinking, gaze and facial-expression probabilities while you do one of four things:

- **Check a feed.** Scroll Instagram, TikTok or YouTube (your real phone apps through iPhone Mirroring, or a browser tab). Counterfeed shrinks to a small bar that says *Breathing paused · 9 s* or *Looking away* as it happens. Afterwards: a **Pull score**, the moments that hooked you with a picture of what was on screen, and one small thing to try.
- **Review a project.** For judges and reviewers: watch a demo video inside the app. The report shows where it held you and where it lost you along the video, and your own scores next to what your body did. Click a moment to replay it.
- **Test your hooks.** For creators: drop in 2 to 6 short clips and scroll them like a feed, swiping whenever you would. See which clip held you hardest, the second it grabbed you, where you swiped, and the clip you *said* you'd post next to the one your body chose.
- **Focus on one thing.** Set a timer and work. Counterfeed turns on Do Not Disturb, notices when your eyes leave the work, and shows how much of the time you were really focused, your longest unbroken stretch, and your focus app by app.

Everything is compared with **your own normal**, measured in the first 40 seconds of every session, never with anyone else.

## Demo

<!-- Replace with your video link (YouTube / Loom / Vimeo). -->
{% embed https://www.youtube.com/watch?v=YOUR_VIDEO_ID %}

What the video shows: the camera check (holding your breath flattens the live wave), a feed check where the bar names a breathing pause live, the report, a hook test with the demo pack, and a 2-minute focus session.

## Code

**https://github.com/shashank03-dev/counterfeed**

Setup is in the README: Node 24, `npm install`, put a free SmartSpectra key in `.env` (or paste it in Settings), `npm run dev`. A Mac `.dmg` builds with `npm run dist`. No key? *History › Open a report file* opens an exported report read-only.

## How It Responds to Human Signals

Counterfeed uses the SmartSpectra Node SDK (`@smartspectra/node-sdk`) in Electron, wired the way Presage's electron-quickstart does it: the SDK's preload bridge, a camera-only permission handler, `worker-src blob:` in the CSP, and the native runtime copied out of `app.asar` for the packaged app.

Live signals and what they drive, in real time:

| Presage signal | What Counterfeed does with it, live |
|---|---|
| Breathing wave and breath-stop detection | The bar says *Breathing paused · 8 s* while it happens; an optional gentle nudge glows past 8 s. Counted as "breathing pauses" (Linda Stone's *screen apnea*). |
| Blink detection | *No blinks for 20 s* on the bar; blink rate against your normal drives the Pull and Focus scores. |
| Face landmarks (478 points) | Reduced on arrival to two head-pose ratios, never stored. Catches turning away and looking down at a phone, judged against *your* posture, even when the SDK's one validation code is busy saying "chest not in view". In a focus session it runs the bar's *Focused · 6:12* count, which restarts after a break of 10 s or more but not after a glance. |
| Validation codes | A live checklist while it learns your normal (light, framing, stillness, chest in view), and "unclear" stretches are left out rather than counted against you. |
| Expression probabilities | Smile and surprise moments in a feed check; part of how strongly a clip held you. |
| Pulse and HRV | Shown for the whole session against your normal (they're slow signals, so never per post). |

Some things I learned from real recordings (two guided sessions, replayed in the unit tests):

- The SDK reports one validation code at a time. On a laptop camera that can't see your chest, "chest not in view" hides head turns, so head pose from landmarks catches them.
- Leaving the desk doesn't always produce a "no face" code: in a real focus session the SDK just stopped sending face data for 33 s while the last code ("chest not in view") stayed up. Counterfeed now treats the face data going quiet as "left your desk", and landmarks dropping out while blinks keep coming as a head turned too far for the tracker.
- A flat breathing wave isn't always a held breath. Counterfeed reads breathing only where the chest is in view for most of the session, and says "not readable" instead of reporting zero.
- Every number has a "How this is measured" panel, and every sentence about your body comes from one file that's checked against a banned-word list (no "stress", "dopamine", "addiction", "emotion"…) in unit tests and on every screen in the end-to-end suite.

It's tested: 165 unit tests and a 189-check end-to-end suite that drives the built app with a labelled test signal (the SDK never sees synthetic video), plus guided real-camera scripts that ask the person at the Mac to hold their breath, look away and leave the desk, then check the report against what they were asked to do.

## Prize Categories

**Best Thoughtful Real-World Use.** People worry about what feeds do to their attention but have nothing to measure it with except screen time. Counterfeed gives them their own body's answer, compared only with themselves, with one small, concrete suggestion. Reviewers get an honest second opinion on demos, creators get a cheap hook test, and anyone can see how focused a work session really was. It was designed around consent and privacy first (below).

## Consent and Data Handling

- **Consent, every session.** Nothing starts until the person ticks each line: measure me with the camera; keep small pictures of the window I chose (only when there will be pictures); I understand this is wellness information. The person in front of the camera starts the session; if a second face appears, the SDK pauses measuring.
- **On this Mac only.** Camera frames are analysed by SmartSpectra on the Mac and never stored or sent; the SDK contacts Presage only to validate the API key. The chosen window is sampled in memory; only the small pictures at a report's moments (at most 24) are saved. Focus sessions keep the *names* of the apps in front, never what was in them.
- **Storage and retention.** Reports are JSON files in `~/Library/Application Support/Counterfeed/reports/`, readable only by you, kept until you delete one or use **Delete all**.
- **Sharing.** Export writes numbers and your answers only, never pictures. Opening an export shows it read-only; it's never merged into your History.
- **Telemetry and AI.** SmartSpectra telemetry is off (`enableTelemetry: false`). No accounts, no analytics, no server, and no AI services.
- **Not medical.** Wellness information, not a medical measurement: no diagnosis, no treatment claims, and the scores describe attention, never health.

## Agent Session

<!-- Optional: upload the Claude Code transcript at https://dev.to/agent_sessions/new, check it for keys, Make Public, and embed it here. -->
