# A weekly check that the live sign-in screen still renders, styled and usable

Tech debt: "Clerk's browser runtime is fetched from a CDN at a floating major, so nothing in CI sees
it", after the maintainer chose not to pin it (2026-11-19).

- `.github/workflows/signin-drift.yml` runs `apps/web/e2e/signin.drift.ts` weekly against production
  `/sign-in`, with the production CSP live. The card renders, the CSP refuses nothing but zod's
  known probe, Clerk's styles arrived, our 44px key still wins, the page has one `<h1>`, no overflow
  at 360px, and 44px controls and links (bar two named Clerk links), and axe A/AA passes. It never signs in or submits.
- A red scheduled or dispatched run opens one issue, or comments on it, through the new
  `.github/scripts/open-or-comment-issue.sh`: bot-authored issues only, the title passed as data,
  fixed text in the body. Its self-test is in `guards:test`.
- AGENTS.md names the check as the one exception to "never tests against production", and lists it
  beside CodeQL as NOT a PR check.
- Clerk's bot-protection probe, refused by the CSP on most runs although every protection is off on
  the production instance, is a known, expected finding matched exactly; anything else still fails.
  The sign-up consent step it may affect is a manual check, owed before the first invite, in
  `runbooks.md`.
- From the build review: only a timeout reads as "the card did not render" (any other error is
  rethrown); the page loads to `domcontentloaded` within a 60s test; the CSP list is read late and
  printed in full; zod's probe is matched on the target's own origin; the issue lookup filters by
  author on the server; a cancelled run opens no issue; and a PR touching any of the check's imports
  runs it.
