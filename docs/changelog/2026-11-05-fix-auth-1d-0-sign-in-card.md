- **2026-11-05** — **The sign-in screen is sized to Clerk's card, and stops trying to restyle it**
  (`AUTH-1` 1d PR 0, ahead of the [1d plan](../plans/auth-1d-retire-the-gate.md)). Lands on its own
  because every file is gate-independent — `apps/web/app/sign-in/` and `apps/web/app/globals.css` are
  owned by no feature guide — and because it fixes a live defect on the screen `1d` is about to make
  the app's only door.
  🔴 **Found by running the lit-screen UX panel [runbooks.md](../runbooks.md) had owed since 1a**, and
  which CI can never run: every harness blanks the Clerk keys (`scripts/e2e-local.ts`,
  `scripts/screenshot-ephemeral.ts`), so every screenshot and a11y assertion this repo has ever taken
  of `/sign-in` measured the **dark fallback** — a state no family sees. Against the development
  instance the defect was immediate: Clerk's card has a fixed `width: 400px` and the page's column was
  `max-w-sm` (352px content), so the card **overhung its own column by 48px** at every viewport where
  the column hit its max. The one action on the screen sat outside the column.
  **The fix is on this app's side of the boundary: the column is now `max-w-[432px]`** — 400 plus the
  32px of `px-4` — so the page is sized to the card rather than the card squeezed into the page.
  🔴 **A first pass did the opposite and it was the wrong trade** _(reverted, maintainer 2026-11-05)_.
  It stripped the card's shadow, fill and padding and matched its button to this app's own outline
  button; it worked, and it still lost. The thing that actually makes the card read as foreign is
  Clerk's **"Secured by Clerk"** attribution, and removing that is a **paid-tier feature**, not a
  styling choice. Styling around a mark that stays buys a half-integrated component whose every CDN
  build can break the arrangement, for no gain. `SIGN_IN_APPEARANCE` is now pinned to an **exact set**
  of three keys, all a11y rather than cosmetic, so a cosmetic key added later goes red and has to
  argue for itself.
  **Two things removed from the screen.** The access-code button is gone, which resolves the 1d plan's
  Open Question 1 early; it could not simply be deleted, because `e2e/a11y.spec.ts` pins an **exact**
  count of 1 link in `<main>`, CI only renders the dark state, and that button was the only link there
  — so the privacy link is promoted out of the `configured` ternary and the count stays 1. And the
  lit state's 59-word `SIGN_IN_COPY.processor` paragraph is gone _(maintainer, 2026-11-05)_: nothing
  pinned it, and Clerk's own "Require express consent to legal documents" setting is the formal
  consent mechanism. ⚠️ **The facts are not lost and must not be** — [notice.md](../privacy/notice.md)
  carries them verbatim, and the privacy link stays **on this screen, above the button**. If that link
  ever moves to the footer, revisit: the disclosure would then be two taps from the act it describes.
  ⚠️ The gate itself is untouched. `/gate` still exists and the landing still links to it; this screen
  simply stops advertising a second door. `1d` deletes the gate.
  **`lib/clerk.test.ts` pins what this repo controls**, and one assertion is there for a specific
  trap: `app/globals.css` must declare `@layer clerk` **before** `@import 'tailwindcss'`, or Clerk's
  CSS outranks the `min-h-11` holding the 44px bar on the Google button — and nothing tested that file
  at all. It asserts **positively** (`indexOf` ≥ 0, then `<`), because the obvious
  `indexOf(a) < indexOf(b)` returns `-1 < n` and would have **passed on the exact regression it exists
  for**: the layer deleted. Comments are stripped first, the trap
  `app/design/tokens/token-sets.test.ts` already documents. Both new guards were probed RED.
  ⚠️ **What is measured, and what is only dated.** The pin covers our _input_, not Clerk's rendered
  output: clerk-js ships from a CDN at a floating major and is absent from the lockfile, so a build
  that renames `cl-headerTitle` or changes the card's width is caught by nothing. The readings — the
  button is 44.0px, Clerk's `<h1>` is `display:none` so the a11y tree holds one, no 360px overflow,
  focus-visible is a real 3px ring, the card is 400px — are on [tech-debt.md](../tech-debt.md)'s
  existing floating-major row, to be re-verified on the next `@clerk/nextjs` bump. ⚠️ **One failure
  stands and it is the vendor's:** the attribution link is 48×14px, under the 44px bar and WCAG 2.2
  SC 2.5.8, with no `elements` key to reach it — recorded as un-met in one named place rather than
  silently un-met, with no allowlist added.
  **[design.md](../design.md) said "Both themes are scanned… on every route", which is false** and has
  been since UI-4: the dark pass loops `ROUTES`, so no public route gets one. Corrected here because
  `1d` makes `/sign-in` the only door and its lit card ships its own palette.
