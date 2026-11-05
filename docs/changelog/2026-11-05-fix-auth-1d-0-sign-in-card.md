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
  🔴 **`SIGN_IN_APPEARANCE` carries exactly ONE key, and the route is reversed from where this PR
  started** _(maintainer, 2026-11-05)_. A first pass stripped the card's shadow, fill and padding and
  matched its button to this app's outline button. It worked, and it still lost: the thing that makes
  the card read as foreign is Clerk's **"Secured by Clerk"** mark, and removing **that** is a
  **paid-tier** feature. Styling around a mark that stays buys a half-integrated component whose every
  CDN build can break the arrangement, for no gain. So the card is left exactly as Clerk designed it.
  **What survives, and why it has to.** Measured with the map emptied: Clerk's social button renders
  at **32px**, under `MIN_TAP_TARGET_PX`, on the primary control of what `1d` makes the app's only
  door — a parent on a phone on a gym floor. `elements` is the only lever (`variables` expose no
  control height), so `socialButtonsBlockButton: 'min-h-11'` stays. ✅ 44.0px with it.
  **What was removed instead of overridden.** With no overrides the page has **two** visible `<h1>`s —
  ours and the card's "Sign in to MatPlan". Hiding Clerk's costs three `header*` keys; yielding ours
  costs none, so the page renders no heading while lit and the card's is the only one. The privacy
  link moved **below** the card in the same pass: a lone underlined line above a self-contained card
  read as a stray fragment. ⚠️ `lib/constants.ts` records why it sat above — "put the fact next to the
  control", because Google's consent appears only after the tap — and that argument is weakened, not
  void: the disclosure is still on this screen, still before anything irreversible, and
  [notice.md](../privacy/notice.md) carries the facts in full.
  🔴 **And the card was never cramped by choice — Tailwind's preflight had been stripping Clerk's own
  spacing since `1a`.** `globals.css` declared `@layer clerk;` ahead of the Tailwind import, which put
  Clerk's CSS in the **lowest** layer. Tailwind's preflight resets `margin: 0; padding: 0; border: 0`
  on `*` inside `@layer base` — so it outranked every spacing rule Clerk ships. `.cl-card` computed
  `padding: 0`, the button sat flush to the card's edge and the "Secured by Clerk" row flush to the
  button. The layer is now named in order, `@layer theme, base, clerk, components, utilities`, which
  fixes it in **both** directions: Clerk's padding beats preflight (`padding: 0` → `32px 40px`, the
  button-to-footer gap `0` → `24px`) while `min-h-11` still beats Clerk (button stays 44.0px).
  ⚠️ This was invisible for three chunks and could only ever be found by eye, because no CI run
  renders the lit card. The guard now pins the **relative** order and was probed RED both ways — below
  `base` (the original bug) and above `utilities` (which would break the tap-target bar).
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
