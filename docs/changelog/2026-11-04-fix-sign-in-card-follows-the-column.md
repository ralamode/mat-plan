- **2026-11-04** — **The sign-in card follows the page's column, and the Clerk cascade is pinned**
  (`AUTH-1` 1d PR 0, ahead of the [1d plan](../plans/auth-1d-retire-the-gate.md)). Lands first and on
  its own because every part of it is gate-independent — `apps/web/app/sign-in/` and
  `apps/web/app/globals.css` are owned by no feature guide — and because it fixes a live defect on the
  screen `1d` is about to make the app's only door.
  🔴 **Found by running the lit-screen UX panel that [runbooks.md](../runbooks.md) had owed since 1a**
  and that could never have been run from CI: every harness blanks the Clerk keys
  (`scripts/e2e-local.ts`, `scripts/screenshot-ephemeral.ts`), so every screenshot and every a11y
  assertion this repo has ever taken of `/sign-in` measured the **dark fallback** — a state no family
  sees. Run against the development instance, two defects were measurable immediately: Clerk renders
  the card at a fixed `width: 400px` against this page's 352px column (`max-w-sm` + `px-4`), so it
  **overhung by 48px** wherever the column hits its max — the one action on the screen sitting outside
  the column — and hiding `headerTitle`/`headerSubtitle` left the header's own ~35px container in
  flow, so the card opened with a band of empty bordered box. `rootBox`/`cardBox: 'w-full'` and
  `header: 'hidden'` fix both.
  **The appearance object moved to `lib/clerk.ts` as `SIGN_IN_APPEARANCE`**, which is where that file
  already declares itself the home for "Clerk wiring facts… three call sites must agree" — a route
  module's export surface is reserved, and half the contract (`cssLayerName`) already lived in
  `app/layout.tsx`. `CLERK_CSS_LAYER` now names the layer once for both.
  **`lib/clerk.test.ts` pins what this repo controls**, and one assertion is there for a specific
  trap: `app/globals.css` must declare `@layer clerk` **before** `@import 'tailwindcss'`, or Clerk's
  CSS outranks the `min-h-11` holding the 44px bar on the Google button — and nothing tested that file
  at all. It asserts **positively** (`indexOf` ≥ 0, then `<`), because the obvious
  `indexOf(a) < indexOf(b)` returns `-1 < n` and would have **passed on the exact regression it exists
  for**: the layer deleted. Comments are stripped first, the trap
  `app/design/tokens/token-sets.test.ts` already documents. Both new guards were probed RED.
  ⚠️ **What is measured and what is merely dated.** The pin covers our _input_, not Clerk's rendered
  output: clerk-js ships from a CDN at a floating major and is absent from the lockfile, so a build
  that renames `cl-headerTitle` or changes the button's box model is caught by nothing. The readings
  are recorded on [tech-debt.md](../tech-debt.md)'s existing floating-major row — the button really is
  44.0px, Clerk's `<h1>` really is `display:none` so the a11y tree holds one, no 360px overflow,
  focus-visible is a real 3px ring — to be re-verified on the next `@clerk/nextjs` bump.
  ⚠️ **One failure stands and it is the vendor's:** the "Secured by Clerk" attribution link is 48×14px,
  under the 44px bar and WCAG 2.2 SC 2.5.8. `elements` exposes no key for it and hiding Clerk branding
  is a paid-plan feature, so it is recorded as un-met in one named place rather than left silently
  un-met — and no allowlist was added, which `e2e/a11y.spec.ts` makes an explicit principle.
  **[design.md](../design.md) said "Both themes are scanned… on every route", which is false** and has
  been since UI-4: the dark pass loops `ROUTES`, so no public route gets one. Corrected here rather
  than later because `1d` makes `/sign-in` the only door and its lit card ships its own palette.
