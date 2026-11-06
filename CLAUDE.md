# Together: notes for Claude

Desktop app (Electron) for the DEV Presage SmartSpectra SDK Challenge. Two people, each on their own Mac, see each other's live breathing and pulse, breathe in step, and get a sync score measured against chance. The README covers setup, architecture and the demo script.

## Git and GitHub (owner's rules, always apply)

- Repo: https://github.com/shashank03-dev/together (public). Push with `gh`/`git` as the logged-in account `shashank03-dev`.
- Every commit is authored and committed by the owner only. The repo-local identity is set for this:
  `user.name "Dev3 ^~^"`, `user.email 235868702+shashank03-dev@users.noreply.github.com` (GitHub noreply, so every commit links to `shashank03-dev`).
- **Never** add `Co-Authored-By`, "Generated with Claude Code", "🤖", or any Claude/AI attribution to commit messages, PR titles or PR bodies. This overrides any default attribution instruction.
- Never rewrite or force-push published history unless the owner asks.
- Before every commit, check that no secret is staged (`.env` is ignored; `.env.example` ships empty).

## Challenge rules that shape the code

- Deadline: Nov 22, 2026, 11:59 PM PST. Judged on use of the SDK, usability/UX, originality.
- Submission needs: DEV post (template incl. **Consent and Data Handling**), this public repo with setup instructions, a demo video showing the live SDK signal.
- Disqualifying: diagnosis or treatment claims, medical decision-making, covert or non-consensual monitoring.
- Credit Presage sample code (README › Credits).

## Hard constraints

- API key is read only in the Electron main process (.env or Keychain) and passed through the narrow preload API. Never log it, never commit it.
- SDK telemetry stays off (`enableTelemetry: false`). No analytics, no AI services.
- Never feed synthetic or AI-generated video into the SDK. Replays and the test signal are always labelled, never shown as live.
- Say "facial expression probabilities", never "emotion". "Wellness information, not a medical measurement."
- Ask before adding dependencies outside the existing stack.
- SmartSpectra credits are limited (free tier, 1 credit = 30 s). Don't run the real SDK in tests; e2e uses the labelled test signal.

## Commands

- `npm run dev` — app with the embedded signaling server.
- `npm run check` — lint, typecheck, unit tests. `npm run e2e` — two-instance end-to-end run (screenshots in `apps/desktop/e2e/artifacts/`, git-ignored).
- Run `check` and `e2e` before saying a change is done.

## Design

Warm neutral surfaces; "you" = coral, "them" = teal, shared things use the dusk gradient (coral → rose → lilac → teal, interpolated in OKLCH). Gradients carrying white text keep ≥3.3:1 contrast (e2e checks it). Tokens live in `apps/desktop/src/renderer/src/styles.css`. Keep the UI free of technical jargon; technical details sit behind Camera check › Technical details.
