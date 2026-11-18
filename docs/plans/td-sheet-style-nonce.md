# Tech debt — an open sheet's scroll lock is not blocked by the CSP

> No `plan.md` row: an unowned cross-cutting defect the board routed to the Tech Debt lane
> (found by lane B outside #575's diff). Branch: `fix/td-sheet-style-nonce`.

_Roadmap alignment (2026-11-18): checked against the private roadmap; nothing to add here. Advances
no milestone; gates nothing._

## Goal

In production, opening any sheet (every picker and dialog, `components/ui/sheet.tsx`, Radix
`Dialog`) logs `Applying inline style violates … style-src`. Radix's scroll lock
(`react-remove-scroll` → `react-remove-scroll-bar` → `react-style-singleton`) injects a `<style>` tag
and stamps it with `getNonce()` from `get-nonce`. Nothing in `apps/web` calls `setNonce`, so the tag
has no nonce, and `style-src 'self' 'nonce-…'` (`proxy.ts` → `buildCsp`) blocks it.

**What the blocked style is** (`react-remove-scroll-bar`'s `getStyles`):
`body[data-scroll-locked] { overflow: hidden; overscroll-behavior: contain; … }`, plus the
scrollbar-gap margin. The `wheel` and non-passive `touchmove` listeners that also lock scroll are
script, not style, and still run (`react-remove-scroll`'s `SideEffect.js:139-141`). **Expected user
effect, to be confirmed, not asserted:**

- ~~the page behind an open sheet can still be scrolled with the keyboard~~ **measured false in
  Chromium** (the mid-build section); dragging the scrollbar on desktop is still _unverified_;
- touch-dragging behind a sheet is already blocked on `main` by the listener and the always-rendered
  overlay (`sheet.tsx:23-26`), and the listener's `preventDefault` normally suppresses
  pull-to-refresh too, so the phone effect may be small (_unverified_ on a real device);
- nothing shifts on desktop today: the blocked style is what would hide the scrollbar and add the
  compensating margin. After the fix that margin keeps content in place.

The fix gives the injector the request nonce instead of loosening the CSP. **What is established**
is the defect itself: the console logs a CSP error on every sheet open, and the lock's style is
missing (`body` overflow is not `hidden`). How much a person notices beyond that is not.

## Acceptance

- Opening a sheet under the production CSP raises **zero** `securitypolicyviolation` events, and the
  injected `<style>` carries the request's nonce.
- While a sheet is open, `getComputedStyle(document.body).overflow` is `hidden`.
- `style-src` is unchanged: no `'unsafe-inline'`, no hash.

## File-by-file changes

| Path                                              | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/package.json`, `pnpm-lock.yaml`         | EDIT   | Declare `get-nonce` at **exactly** the version Radix's tree resolves (`1.0.1`), so pnpm links one copy and the app's `setNonce` and the injector's `getNonce` share module state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/components/layout/style-nonce.tsx`      | NEW    | `'use client'`. `StyleNonce()` takes **no prop**. In a mount effect (browser only, so it never touches the server's shared module state) it reads the nonce of the document that was actually loaded, `document.querySelector('script[nonce]')?.nonce` (the IDL property, which Chrome keeps after it clears the attribute), and calls `setNonce` **once**, guarded by a module-level flag. The layout re-renders with a fresh `x-nonce` on every `router.refresh()` and Server Action response, but the page's CSP keeps the first document's, so a prop-fed value would go stale after the first refresh (security P0). Renders nothing.                                                                         |
| `apps/web/app/layout.tsx`                         | EDIT   | Render `<StyleNonce />` in `<body>`. No nonce prop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/components/layout/style-nonce.test.tsx` | NEW    | (a) with a `<script nonce>` in the document, `setNonce` receives its nonce; (b) none present → no call; (c) a second mount with a different nonce is ignored; (d) **one copy**: `fs.realpathSync` of `get-nonce` resolved from `apps/web` and from `react-style-singleton`'s directory are the same file.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/e2e/sheet-csp.spec.ts`                  | NEW    | In the default (CSP-live) project, never the `a11y` one (`bypassCSP`), with `test.use({ viewport: 390×844, isMobile: true, hasTouch: true })`. Record `securitypolicyviolation` from an init script (the `theme.spec.ts` recorder), print the full list, and assert **no `style-src*` violation after the open click** (zod's JIT probe already raises a `script-src` one on every page). Assert the injected `<style>`'s `.nonce` equals the CSP header's nonce from the `goto` response, `body` overflow is `hidden` and `overscrollBehaviorY` is `contain`. (An after-refresh case was planned here and removed: see the mid-build checks.) (A keyboard case was planned and removed: see the mid-build check.) |
| `docs/features/movement-picker.md`                | —      | **Not edited here**: lane B's #575 edits it and `sheet.tsx`. The line "the sheet's scroll lock depends on `StyleNonce` in the root layout" and the stale `sheet.tsx:181-183` comment go to lane B through the board.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/privacy/data-inventory.md`                  | —      | No change: a dependency with no I/O, and the nonce already reaches the client through `ThemeProvider`. Recorded here for the privacy lens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/changelog/…`                                | NEW    | Fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

`components/ui/sheet.tsx` is **not** touched (lane B's #575 edits it).

## Test plan

- Unit: `style-nonce.test.tsx` as above.
- e2e: `sheet-csp.spec.ts`. Proved RED first with the layout line removed (each assertion's RED run
  shown; the keyboard case was dropped when its RED run passed), before trusting it green. Runs in CI's
  `e2e` job. Locally `pnpm e2e:local e2e/sheet-csp.spec.ts`, only with the heavy-run slot.
- **Manual, real device** (Chromium emulation has no URL bar, no pull-to-refresh, and only Chromium is
  installed): Android Chrome, on a short sheet pull down on the list and the page must not refresh;
  iOS Safari, open the picker, focus search, close it, and the page keeps its scroll position. Done
  by the maintainer when convenient; the PR says it has not been done.

## Risks / rollback

- **Two copies of `get-nonce`.** If pnpm links the app's declared copy separately from Radix's,
  `setNonce` sets a variable the injector never reads, and nothing fails until production. The
  one-copy unit test and the e2e assertion both catch it.
- **A stale nonce after a refresh** (security P0): avoided by reading the loaded document's nonce
  once and never overwriting it; unit case (c) pins it; an e2e refresh case was tried and could not observe a refresh (mid-build checks).
- **The nonce in client JS.** Script already running can read `.nonce` from any script tag, and
  `ThemeProvider` already receives it as a prop, so this adds nothing.
- **A future style injector** that does not read `get-nonce` (another library) would still be blocked.
  Out of scope; the e2e recorder would show it.
- **Rollback:** revert. No data, no schema.

## Out-of-scope / deferred

- Any `style-src` change.
- Other inline-style sources, such as server-rendered `style="…"` attributes from React `style`
  props: **not examined here** (_unverified_ how this policy treats them). The e2e recorder would
  surface one on the page it opens; anything it finds becomes its own row.

## Open questions

None.

## Review-response log (adversarial panel)

> Models: security, UX, privacy all on `opus` (the Fable spend limit runs until 2026-11-19 03:00 ET).

| Lens         | Sev | Critique                                                                                                                                                                                     | Response                                                                                                                                                                   |
| ------------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| security     | P0  | The layout re-renders with a fresh `x-nonce` on every refresh / action response; the page's CSP keeps the first, so a prop-fed `setNonce` goes stale.                                        | **Accepted.** No prop: read the loaded document's nonce once, browser-only, never overwritten. Unit (c) and an e2e refresh case (e2e case later removed: mid-build check). |
| security     | P1  | Chrome hides the `nonce` attribute; compare the IDL `.nonce` with the response header's nonce.                                                                                               | **Accepted.**                                                                                                                                                              |
| security     | P1  | "Zero violations" is false today (zod's `script-src` probe).                                                                                                                                 | **Accepted.** No `style-src*` violation after the click; full list printed.                                                                                                |
| security, UX | P1  | The PageDown check passes on `main` too unless the page is taller than the viewport and focus is outside the sheet's list.                                                                   | **Accepted, then removed.** Both preconditions were asserted and it still passed RED: the case was vacuous in Chromium (mid-build check).                                  |
| UX           | P1  | The default project is Desktop Chrome, so the gap code runs and no phone is emulated.                                                                                                        | **Accepted.** `test.use` a 390×844 touch viewport.                                                                                                                         |
| UX           | P1  | The phone cases (pull-to-refresh, iOS URL bar) are out of emulation's reach.                                                                                                                 | **Accepted.** A manual real-device step; the bullet is marked unverified.                                                                                                  |
| UX, security | P2  | The "page shifts on desktop" effect was backwards; pull-to-refresh overstated.                                                                                                               | **Accepted.** Rewritten.                                                                                                                                                   |
| UX           | P2  | The lock now depends on `StyleNonce`, and `sheet.tsx:181-183` says it applies.                                                                                                               | **Accepted, routed.** Both the guide line and the `sheet.tsx` comment go to lane B, whose #575 edits both files.                                                           |
| UX, security | P2  | The server render would write the shared module variable on every request.                                                                                                                   | **Accepted.** Browser-only effect.                                                                                                                                         |
| security     | P2  | Compare `realpathSync` in the one-copy test.                                                                                                                                                 | **Accepted.**                                                                                                                                                              |
| privacy      | —   | No personal data held, logged or sent; `get-nonce` is one variable with no I/O (read in full). The inventory's re-review triggers (`data-inventory.md:314-320`) were checked and none fired. | **No change.**                                                                                                                                                             |

Checked and sound (UX): the `a11y` project has always run with `bypassCSP`, so its 360px and sheet
tests already describe the locked state; at 360px the gap is 0 and body margins are 0, so nothing
moves; sticky footers stick to their own scroller; one sheet at a time is enforced.

### Mid-build check: the keyboard case was vacuous (2026-11-18)

The e2e spec was run RED first, with `<StyleNonce />` removed from the layout. The CSP case failed
as it should (`style-src-elem inline` on opening the picker). The keyboard case **passed**: with the
lock's style blocked, `PageDown` with focus on the sheet's title did not move the page in Chromium.
The case proved nothing and was removed; the "keyboard can scroll the page behind" effect is struck
from the Goal, the changelog and the PR. Recorded as the finding the security and UX lenses
predicted (their P1 on this check).

### Mid-build check: the after-refresh case could not be observed (2026-11-18)

The second-pass security review (PR #613, P2-1) found the after-refresh e2e case could not fail: its
wait matched Link prefetches, and nothing proved a refresh had delivered a new nonce. Hardened (the
editor's own non-prefetch RSC response, then a poll for a fresh `script[nonce]` in the DOM), it was
run with the fix and against a prop-fed `StyleNonce`: the poll failed both times. No refreshed nonce
ever reached the DOM, so from the page the two cannot be told apart. The case was removed rather
than kept. "Set once, from the loaded document" is pinned by `style-nonce.test.tsx`'s second-mount
case, and the design is safe whether or not a refresh changes the nonce. Whether it does is left
_unverified_.

Same review: the shared CSP recorder moved to `e2e/csp.ts` (`theme.spec.ts` uses it), the spec
imports `MOBILE_VIEWPORT`, and `package.json`'s unrelated escape rewrite is reverted.
