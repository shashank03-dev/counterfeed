# Together

**See each other breathe, then try breathing as one.**

Together is a desktop video call for two people, each on their own Mac. You talk, then spend five quiet minutes breathing: two minutes apart (you only see your own breathing), then three minutes together (both waves overlaid, with a live "in step" meter). At the end you see how in step you were, measured and compared against chance.

Each laptop measures **only its own person** with the Presage SmartSpectra SDK, on that laptop. Only a few derived numbers per second (breathing wave height, pulse, talking yes/no) cross the network, alongside the normal encrypted call media.

Built for the DEV *Presage SmartSpectra SDK Challenge*.

---

## Setup

Requirements: macOS on Apple Silicon, **Node 24 LTS** (`.nvmrc`), a SmartSpectra API key from <https://physiology.presagetech.com/>.

```bash
npm install
cp .env.example .env      # then put your key in SMARTSPECTRA_API_KEY
```

The key is read by the Electron **main** process only (from `.env`, or saved encrypted to your Keychain from Settings) and handed to the renderer once through a narrow preload API. `.env` is git-ignored and never logged.

## Run

```bash
npm run dev               # the desktop app, with its signaling server built in
```

**The app carries its own backend.** When the connection server is on this Mac (`ws://localhost:8787`, the default), the main process starts the same signaling server `npm run signal` runs, listening on the local network, and stops it on quit. If a Together server already owns the port (a second instance, or `npm run signal`), the app uses that one. If something else owns the port, Settings says so instead of failing silently.

**Two Macs on the same Wi-Fi.** Open Together on both. On the Mac that hosts, **Settings › Connection** shows `This Mac hosts rooms` and an address like `ws://192.168.1.20:8787` with a Copy button. On the other Mac, paste that address into its connection server and Save. Then Start a room on one and Join on the other.

**Different networks.** Run `npm run signal` on a server both can reach (behind TLS it becomes `wss://…`; set `TRUST_PROXY=1` behind a reverse proxy), and point both apps at it with `SIGNAL_URL` in `.env` or in Settings.

Some networks (offices, some hotspots, symmetric NAT) block direct peer-to-peer calls. Set `TURN_URL`, `TURN_USER`, `TURN_PASS` (or fill them in **Settings › Connection › Advanced**) to relay the call through a TURN server. The app says so when a call can't connect.

### Solo demo (one person, one Mac)

1. **Camera check** (sidebar) → **Start camera check**. Plain readouts (breathing, heart rate) and a checklist (light, framing, stillness, breathing signal) confirm the measurement works.
2. After a minute of measured breathing, **Keep as partner** saves that minute as a recording (signal numbers only, never video).
3. **Home › Practice** runs a full session against that replay. It loops for the whole session and is always shown as a **"Replayed session"**, never as a live person.

Credits: SmartSpectra's free tier is 100 credits at 30 s each (about 50 minutes of measurement). A full session is about 6–8 minutes per laptop; a camera check is about 1 minute.

### Two peers on one Mac (development)

Only one app can own the camera, so the second instance replays a recording:

1. In the first instance, turn on **Record my signals** on the consent screen and finish a session (recordings hold numbers only, never video).
2. `npm run dev:peer2` starts a second instance with its own profile. It has no camera and sends the most recent recording as its signal; the other side shows a permanent **"Replayed session"** banner.

### Demo modes (always labelled)

| Mode | What it is | How it's labelled |
| --- | --- | --- |
| **Record my signals** | Writes your outgoing SignalFrames (and phase marks) to JSONL in your profile. No video, no audio. | A red "Rec" dot in the top bar |
| **Practice** (Home) | Breathe with a replay of a recorded session, or of a camera check you kept, through the same `Peer` interface as a live partner. It follows the session's phases when the recording has them, and loops when it runs out. | Permanent "Replayed session (recorded …)" banner; Results and History say "Practice with a replay" |
| **Peer 2** | Second dev instance replays a recording as *its own* signal over the real network. | Both sides show it is a recording |

Never fed into the SDK: synthetic or AI-generated video. The automated test suite uses a clearly labelled **test signal** instead of the SDK (see Testing); that seam is compiled in but cannot switch on in a packaged app.

### Package

```bash
npm run dist              # release/Together-*.dmg (arm64)
```

The SmartSpectra native runtime is copied to `Resources/smartspectra/` (a `.dylib` can't be loaded from inside `app.asar`), as in Presage's electron-quickstart. `Info.plist` carries camera and microphone usage strings; entitlements are in `apps/desktop/build/entitlements.mac.plist`. Sign with your own identity for distribution.

---

## How it works

```
 ┌──────────────────────────── Laptop A ────────────────────────────┐        ┌──────── Laptop B ────────┐
 │ main process                                                     │        │      (same app)          │
 │   bindSmartSpectraIpc ◄── MessagePort ──┐   storage (JSON/JSONL) │        │                          │
 │   .env / Keychain key  ── getConfig ─┐  │   in userData           │        │                          │
 │                                      ▼  │                         │        │                          │
 │ renderer                                                          │        │                          │
 │   SensingService (SmartSpectra renderer SDK, camera 720p30)       │        │                          │
 │      │ metrics ─► normalize ─► SignalFrame {t, trace, pulse, …}   │        │                          │
 │      │ camera MediaStream ──────────────┐                         │        │                          │
 │      ▼                                  ▼                         │        │                          │
 │   Session (state machine, host-driven)  PeerSession (WebRTC)  ◄══╪══ media (DTLS-SRTP, P2P) ══►        │
 │      │  clock sync · batching 10 Hz     data channel "signals" ◄══╪══ SignalFrames / phase / bye ══►    │
 │      ▼                                                           │        │                          │
 │   sync/: resample 10 Hz ─► band-pass ─► Hilbert phase ─► PLV ─► surrogates                          │
 │   moments/: listener reactions (local only)                       │        │                          │
 └──────────────────────────────────┬────────────────────────────────┘        └────────────┬─────────────┘
                                    │  offer / answer / ice / leave only                      │
                                    └────────────────► signaling server ◄─────────────────────┘
                                                      rooms of 2, stores nothing
```

```
apps/signal          ws signaling: WORD-00 rooms of two, relays only offer/answer/ice/leave,
                     10 min idle TTL, per-IP join rate limit, reconnect tokens, no payload logging
packages/shared      zod schemas for the data channel, signaling, recordings and stored sessions
apps/desktop/src
  main/              window, CSP, permission handler, SDK IPC, storage, IPC handlers
  preload/           SmartSpectra's preload bridge + the narrow `window.together` API
  renderer/src/
    sensing/         CameraSource (SDK), normalize, quality, lag test, replay/test sources
    call/            SignalingClient (rejoin on drop), PeerSession (WebRTC, host is the offerer)
    link/            Peer interface, RemotePeer, ReplayPeer, clock sync, recordings
    session/         pure state machine + the Session controller + store
    sync/            resample, filter, FFT/Hilbert phase, PLV, surrogate test, rate
    moments/         listener-reaction detection
    ui/              screens and components (no chart or UI libraries: canvas, SVG, CSS)
```

### The measurement science

1. **Align.** Partner timestamps are moved onto the local clock with an NTP-style offset (10 ping/pongs; median of the lowest-RTT third, minus queued outliers). Both traces are resampled to a 10 Hz grid; gaps over 0.5 s stay empty.
2. **Clean.** Talking stretches (either person, plus 1 s after) are removed, because talking invalidates breathing measurement. Linear detrend, then a zero-phase 0.08–0.67 Hz band-pass (5–40 breaths/min, the SDK's breathing range): 2nd-order Butterworth high- and low-pass run forward and backward.
3. **Phase.** Analytic signal via FFT Hilbert transform; the FFT buffer is filled by even reflection, and 3 s at each segment edge is trimmed.
4. **Sync.** Phase-locking value, `|mean e^{i(φA−φB)}|`, over 30 s windows with a 5 s step. A window counts only with ≥ 60 % clean signal from both.
5. **Chance.** The partner's series is circularly shifted by random offsets ≥ 10 s, 200 times. Windows that straddle the shift's splice point are skipped (otherwise the splice biases chance low and inflates significance; there's a regression test for this). "x× more in step than chance" is claimed only above the 95th percentile with ≥ 100 valid surrogates; otherwise the app says it looks like chance, or that the data was too short to tell.

### Moments (listener reactions)

Only while the partner is talking and you are not (both stable). The SDK's facial-expression probabilities for happiness and surprise are smoothed (0.5 s EMA). An event fires when the value rises ≥ 30 points above its rolling 10 s median and peaks ≥ 60, at least 5 s after the previous one. Then the pulse is checked: max stable pulse in the next 15 s minus the median of the previous 15 s ("pulse: not enough signal" otherwise). Example: *"at 04:32 you smiled (84%), pulse +9 BPM"*. Moments are yours; one is sent only if you tap **Share** on it. These are facial-expression probabilities; Together never claims to detect emotion.

---

## Consent and Data Handling

Before anything turns on, each person ticks every line of a plain list. Nothing is captured or sent until both have agreed.

**Shared with the other person**
- Your **video and voice**: live, peer to peer, DTLS-SRTP encrypted. Never recorded or saved by Together.
- About ten times a second, as numbers: the **height of your breathing wave**, your **pulse** (with confidence) and whether you are **talking**.
- Only if you choose: the **mood word** you pick, and individual **Moments** you tap Share on (requires "Let me share my reactions", off by default).

**Stays on your laptop**
- Camera frames: analyzed by SmartSpectra on this laptop, never sent anywhere. The SDK contacts Presage only to validate the API key.
- Facial-expression probabilities (used for Moments).
- **Stored** in your profile (`~/Library/Application Support/Together/`): finished sessions (sync results, breathing rates, median pulse, moods, your Moments) and, only if you turned it on, signal recordings (numbers only). Files are user-readable only (0600).

**Retention and deletion.** Kept until you delete them. **History › Export JSON** writes everything to one file; **Delete all** (History or Settings) removes every session and recording; single sessions and recordings can be deleted individually.

**Signaling server.** Sees room codes and connection details (SDP, ICE candidates) for two people at a time, relays them and forgets them. It stores nothing on disk, logs events without payloads, codes or tokens, and drops rooms after 10 idle minutes.

**Telemetry.** SmartSpectra's aggregate session telemetry is **disabled** (`enableTelemetry: false`). If enabled it would send one summary per session: SDK version, platform/device model, input kind, outcome, frame-rate and throughput counts, validation-state counts and a coarse error code. It would never include video, measured values, identifiers or file paths. Together itself has no analytics, no accounts, and uses **no AI services**.

**Not medical.** Wellness information only, not a medical device; no diagnosis or treatment claims.

---

## Limitations

- **Light and stillness.** Breathing needs a stable camera (laptop on a table), even light without flicker (not a screen as the main light), and the upper chest in view. Large motion can give wrong readings *with high confidence*; the lobby checklist and hints come straight from the SDK's validation status.
- **Talking invalidates breathing.** Talking stretches are excluded from sync and shown as "this bit won't count".
- **Warm-up.** Breathing-rate confidence is 0 for the first 30 s and pulse for 12 s; the 2-minute Apart phase doubles as warm-up. Pulse is valid at 40–110 BPM. The SDK is validated at 25+ fps.
- **One person per camera.**
- **Short windows.** Two people breathing at similar, steady rates look "in step" over 30 s by accident. That is exactly why every claim is tested against circular-shift surrogates.
- **Fairness.** Camera-based physiology can perform differently across skin tones and lighting; see Presage's model cards (Settings › About links to them) for the validation populations and limits.
- **Network.** Some networks need TURN. If the partner drops, timers pause for up to 20 s, then the session ends and keeps partial results.

---

## Testing

```bash
npm run check             # eslint + tsc (5 projects) + vitest
npm run e2e               # builds the app, then drives two real instances end to end
```

**Unit and integration (vitest, 111 tests).** Assertions are on measured numbers:
- **Filter.** |H| ≥ 0.97 at 15 br/min; ≤ 0.005 at 0.02 Hz drift; ≤ 0.01 at 2 Hz. Reconstruction error < 5 % with zero lag.
- **Hilbert.** Error < 0.15 rad from 3 s in, < 0.06 rad from 10 s in.
- **PLV.**
  - In-phase sines > 0.95.
  - Phase-shifted sines stay locked.
  - Independent band-limited noise < 0.3 (20 seed pairs).
- **Surrogates.**
  - Locked pairs rank ≥ 95th percentile.
  - Independent breathers average 30–70 with ≤ 5/30 false positives.
  - Same-rate metronomes are *not* called above chance (the splice-bias regression).
- **Clock.** Offset within 20 ms over 1,000 simulated runs (40 ms latency, 25 ms jitter), and with 20 % of packets hit by 200 ms spikes.
- **Normalize.** Fixtures go through the SDK's own protobuf codec.
- **Protocol.** zod rejects malformed and extra-field messages.
- **Moments.** Synthetic expression curves produce exactly the expected events.
- **State machine.** Including pause/resume and the 20 s window.
- **Storage.** Path traversal, export, delete, peer-2 isolation.
- **Signaling server.** Real WebSockets: relay, room-full, TTL, rate limit, rejoin, no payload logging, 200 concurrent rooms. A taken port rejects within 1 s (it used to hang).
- **Embedded server.** It starts and creates a real room, shares an existing Together server without closing it, reports a port held by another app, leaves remote URLs alone, and follows URL changes (the old port is released).
- **Replay loop.** 7 s of playback from a 2 s recording wraps 3 times with strictly rising timestamps and no gap larger than one sample.

**End to end (67 checks).** The built app runs as two isolated instances over the real signaling server and a real WebRTC connection. Covered:
- Consent gate and room codes.
- Lobby, call video and audio both ways, partner pulse over the data channel, mute.
- Moods, Apart and Together switching together, results agreeing on both sides, and media stopping at the end.
- History, export and Delete All.
- Peer-2 replay over the network, and Practice with its banner.
- A partner ending the session, and a partner's process being killed (timer pauses, the session ends at 20 s with partial results).
- Unknown codes and an unreachable server.
- Gradients: every gradient fill under white text or icons keeps at least 3:1 contrast at every stop, and the shared gradient really renders. Computed styles are scanned on Home, History, Camera check and Settings.
- Camera check: wave drawn, Keep as partner unlocks on time, the camera is released on Stop, and Practice against the kept check is labelled as a replay.
- Leaving early shows no phases as completed.

In this mode sensing uses a labelled test signal (no SDK) and the call uses Chromium's fake camera and mic.

**Measured performance (Apple Silicon, during Together with video both ways and two live waves):**

| | Value |
| --- | --- |
| Renderer CPU | ~2 % |
| Whole app CPU (all processes) | ~4.5 % |
| Renderer JS heap | 12–18 MB |
| Frame pacing | 16.7 ms mean, 17.3 ms p95, 0 long tasks |
| Idle CPU | ~1.4 % |
| Idle memory over a bare Electron window | ~+100 MB |

The SDK itself (frame capture and processing at 720p30) adds load on a live camera that the e2e suite can't measure; check the Camera check on your machine.

**Camera check › Technical details** shows raw SDK values, confidence, sample rates, measurement delay, and a **lag test**: a tone plays, you breathe in, and it reports the median delay over five tries until the wave moves.

---

## Demo script (3 minutes)

1. **Home.** "Each laptop measures only its own person." Start a room; show the consent list: every line is a promise.
2. **Waiting.** Copy the `TIDE-42`-style code; the partner joins.
3. **Lobby.** Point at the checklist (light, framing, stillness) and the heart settling to a steady reading.
4. **Call.** Talk for a minute. Open Moments: a smile while they talk shows up privately, with what your pulse did next.
5. **Apart.** Only your wave; theirs is hidden.
6. **Together.** Both waves overlaid; the meter climbs as you settle into a shared rhythm.
7. **Results.** Apart vs Together against chance, the minute-by-minute line, moods before and after. Everything is saved on this laptop: show History › Export, then Delete all.

---

## Credits

- Measurement: **Presage SmartSpectra SDK** (`@smartspectra/node-sdk`). Electron wiring follows Presage's [electron-quickstart](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart) sample: preload bridge, permission handler, `worker-src blob:` CSP, packaged native-runtime path and entitlements.
- STUN: `stun.l.google.com`.
- Built with Electron, electron-vite, React, Tailwind CSS, zustand, ws, zod and vitest. Charts, waves and icons are hand-made (canvas and SVG).
