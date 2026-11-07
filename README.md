# Counterfeed

**Your feed measures you. Measure it back.**

Every app you scroll measures you: how long you stay, what makes you stop. Counterfeed turns the camera around.
It watches your breathing, your blinks and where you look while you scroll, then shows you what the feed did to
your attention. Everything runs on your Mac with [Presage SmartSpectra](https://physiology.presagetech.com/).

## Demo

[![Counterfeed demo: click to watch with sound](https://github.com/shashank03-dev/counterfeed/releases/download/v1.0.0/counterfeed-preview.gif)](https://github.com/shashank03-dev/counterfeed/releases/download/v1.0.0/counterfeed-demo.mp4)

**[▶ Watch the full demo (1 min, with sound)](https://github.com/shashank03-dev/counterfeed/releases/download/v1.0.0/counterfeed-demo.mp4)**

In the video I scroll X for 10 minutes. Counterfeed gives it a **Pull score of 56**. I went **57 seconds without
blinking** and blinked **19% less than my normal**. It felt like 7 minutes. It was 10.

## What it does

Counterfeed first spends about 40 seconds learning **your normal**: how you breathe and blink when nothing is
pulling at you. After that, everything is you against you.

| Mode | For | What you get |
|---|---|---|
| **Check a feed** | anyone | Scroll any app or browser tab. A small bar calls out long stares, breathing pauses and looking away as they happen. Then a **Pull score**, the moments that grabbed you (with a picture of what was on screen) and how long it really was. |
| **Review a project** | judges | Watch a demo video inside the app. See **where it held you and where it lost you**, and click any moment to replay it. |
| **Test your hooks** | creators | Swipe 2 to 6 video openings like a feed. Your body ranks them: which one held you, the second it grabbed you, where you swiped away. |
| **Focus on one thing** | deep work | Set a timer. Do Not Disturb turns on. A glance away is fine, 10 seconds on your phone is a break. Get a **Focus score** and where your focus went, app by app. |

## Run it

You need a Mac with Apple Silicon, **Node 24** and a free SmartSpectra API key from
<https://physiology.presagetech.com/>.

```bash
npm install
cp .env.example .env    # put your key in SMARTSPECTRA_API_KEY (or paste it in Settings later)
npm run dev
```

macOS asks for **Camera** access. For a feed check it also asks for **Screen Recording**, so it can keep small
pictures of the window you chose. You can say no and pick *Without pictures*.

**Fastest way to try it:** open **Test your hooks** and choose **Use the demo pack**. It takes under 2 minutes
and needs no setup.

**Credits:** the free key has 100 credits, and 1 credit is 30 seconds of measuring. A 5-minute feed check costs
about 12. The app shows the cost before you start.

**Do Not Disturb (optional):** macOS has no public switch for it, so make two Shortcuts once, each with one
*Set Focus* action: **Counterfeed Focus On** and **Counterfeed Focus Off**. The app finds them on its own.

To build a `.dmg`: `npm run dist`.

## How it works

```
camera ──► SmartSpectra (on your Mac) ──► breathing, blinks, face direction, expressions
                                                    │
window you chose ──► looked at in memory, a few small pictures kept
                                                    │
learn your normal ──► watch (live bar) ──► a few questions ──► your report
```

- **Breathing pause:** your breath stays much smaller than usual for 6 seconds or more.
- **Unbroken stare:** a gap between blinks much longer than your usual gap.
- **Looking away:** your face turns away or down from your own usual position for 1.5 seconds or more.
- **Pull score (0 to 100):** built from the measures above, each compared with your own normal, never with
  anyone else. The report shows exactly how it was built.

If something can't be measured well (bad light, chest out of view), the app leaves it out instead of guessing.

## Your data stays on your Mac

- Camera frames are analysed on your Mac and never saved or sent anywhere.
- Reports are saved only on your Mac, and you can delete one or all of them at any time.
- No account, no server, no analytics. SmartSpectra telemetry is turned off. No AI services are used.
- This is wellness information, not a medical measurement.

## Code

```
apps/desktop/src
  main/       Electron: window, permissions, the API key, storage, macOS helpers
  preload/    the small bridge between Electron and the page
  renderer/   the app: sensing, the session flow, the analysis and every screen
packages/shared   data formats for saved reports
```

The API key is read only by Electron's main process (from `.env` or your Keychain) and is never logged.

## Tests

```bash
npm run check   # lint, types and 166 unit tests
npm run e2e     # builds the app and drives it end to end (189 checks, on a labelled test signal)
```

The tests never use the real camera SDK, so they cost no credits.

## Credits

- Measurement by the **Presage SmartSpectra SDK**. The Electron setup follows Presage's
  [electron-quickstart](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart).
- Built with Electron, React, Tailwind CSS, zustand, zod and vitest.
- Made for the DEV **Presage SmartSpectra SDK Challenge**.
