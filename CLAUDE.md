# Counterfeed: notes for Claude

Desktop app (Electron) for the DEV Presage SmartSpectra SDK Challenge. The camera (SmartSpectra, on this Mac) measures breathing, blinking and gaze while you scroll a feed (**Feed check**) or review a project (**Review**, for judges: a demo video or any window), or ranks 2-6 short clips watched like a feed (**Hook test**, for creators; `analysis/hooks.ts`, bundled demo pack in `apps/desktop/resources/demo-pack`), or times a block of work (**Focus session**; `analysis/focus.ts`: eyes on the work, breaks of 10 s or more, the front app's name per second via `lsappinfo`, Do Not Disturb through two Shortcuts the person makes, in `main/mac.ts`). A one-page report shows the Pull/Hold score, the moments that hooked you with pictures of the screen, and one suggestion. The README covers setup, architecture, consent and the demo script.

## Git and GitHub (owner's rules, always apply)

- Repo: https://github.com/shashank03-dev/counterfeed (public; renamed from `together` at the owner's request). Push with `gh`/`git` as the logged-in account `shashank03-dev`.
- Every commit is authored and committed by the owner only. The repo-local identity is set for this:
  `user.name "Dev3 ^~^"`, `user.email 235868702+shashank03-dev@users.noreply.github.com` (GitHub noreply, so every commit links to `shashank03-dev`).
- **Never** add `Co-Authored-By`, "Generated with Claude Code", "🤖", or any Claude/AI attribution to commit messages, PR titles or PR bodies. This overrides any default attribution instruction.
- Never rewrite or force-push published history unless the owner asks.
- Before every commit, check that no secret is staged (`.env` is ignored; `.env.example` ships empty).

## Challenge rules that shape the code

- Deadline: Nov 22, 2026, 11:59 PM PST. Judged on use of the SDK, usability/UX, originality. Solo entries only.
- Submission needs: DEV post (template incl. **Consent and Data Handling**), this public repo with setup instructions, a demo video showing the live SDK signal.
- Disqualifying: diagnosis or treatment claims, medical decision-making, covert or non-consensual monitoring.
- Credit Presage sample code (README › Credits).

## Hard constraints

- API key is read only in the Electron main process (.env or Keychain) and passed through the narrow preload API. Never log it, never commit it.
- SDK telemetry stays off (`enableTelemetry: false`). No analytics, no AI services (the SDK's LLM Insights are not used).
- Never feed synthetic or AI-generated video into the SDK. The SDK only ever sees the camera; screen pictures and demo videos never reach it. The test signal is always labelled.
- Say "facial expression probabilities", never "emotion". "Wellness information, not a medical measurement." No dopamine, stress, anxiety or addiction claims: all copy about the body lives in `analysis/words.ts` and is checked against `BANNED_WORDS` (unit tests and e2e).
- Screen pictures stay on the Mac and are never exported.
- Ask before adding dependencies outside the existing stack.
- SmartSpectra credits are limited (free tier, 1 credit = 30 s). Don't run the real SDK in tests; e2e uses the labelled test signal (`COUNTERFEED_TEST_SCENARIO=laptop` reproduces a laptop camera: chest out of view all session; `=focus` adds a 13 s look down). Automated runs never touch the real Shortcuts tool or the real front app: Do Not Disturb goes to a stand-in named by `COUNTERFEED_SHORTCUTS_BIN` (e2e only, never packaged) and front apps are a scripted cycle. `E2E_ONLY=focus npm run e2e` runs just the focus section. The only real-SDK run is the manual, guided `node e2e/real.mjs` (a person must be at the camera); its recordings stay in git-ignored `e2e/artifacts/real/` and are replayed by `test/renderer/real-replay.test.ts`.

## Commands

- `npm run dev` — the app.
- `npm run check` — lint, typecheck, unit tests. `npm run e2e` — end-to-end run with the test signal (screenshots in `apps/desktop/e2e/artifacts/`, git-ignored).
- Run `check` and `e2e` before saying a change is done.

## Design

Radix-Colors-style scales: sand neutrals; "you" (your body, Feed check) = tomato, "feed" (Review) = jade, "hook" (Hook test) = indigo, "focus" (Focus session) = plum. Dark is its own theme: a graphite ladder (bg < panel < surface < overlay) with 1px edges and top highlights, selected thumbs lighter than their track, no low-opacity hue washes on near-black (they turn brown), a neutral page light, and dim text kept at 4.5:1 on every surface. Every gradient stays within one hue (lit vertical fills with an inset highlight, a single-hue score ring, a neutral ink headline, a neutral attention-curve line); no multi-hue gradients and no coloured glow shadows. Event colours (pause, stare, expression) are a validated categorical set; "looked away" is a grey hatched band. Gradients carrying white text keep ≥3.3:1 contrast (e2e checks it). Tokens live in `apps/desktop/src/renderer/src/styles.css`. Reports show the abstracted layer first; numbers sit behind "How this is measured" and Camera check › Technical details.
