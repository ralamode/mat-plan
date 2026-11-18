# Tech debt — Clerk's script stays off the two public pages

> Debt row: [tech-debt.md](../tech-debt.md) → "Clerk's script loads on the PUBLIC pages, including
> the privacy notice" (found 2026-11-03, #326 review). Branch: `fix/td-clerk-off-public-pages`.
> No `plan.md` row: a tech-debt payoff.

_Roadmap alignment (2026-11-18): checked against the private roadmap; nothing to add here. Gates
nothing; touches auth (the provider), so the panel carries a security lens and the privacy lens._

## Goal

`app/layout.tsx` renders `<ClerkProvider dynamic>` around every route whenever the keys are set, so
`clerk.browser.js` loads on `/` and `/privacy` too: a stranger who opens the privacy notice to decide
whether to trust the app has their IP seen by Clerk and by Cloudflare in front of it. Measured against
production on 2026-11-03 and disclosed in `notice.md`; the inventory says the scoping "is not done"
(`data-inventory.md:540-552`). After this PR the two public pages (`PUBLIC_PATHS`,
`lib/public-paths.ts:27`) render no provider and load no Clerk script; every other page keeps it.

**Why the provider stays on every OTHER page, not just the two that call a Clerk hook.** Only `/p`
(`SignOutButton`, `useClerk`) and `/sign-in` (`<SignIn>`) use Clerk on the client. But clerk-js also
refreshes the short-lived session token in the background; without it on a signed-in page, the
middleware refreshes it by a redirect round trip after expiry (_unverified_ how often in this app;
the panel and a measurement settle it). Keeping the provider on all non-public routes keeps today's
behaviour there exactly.

## Design (v2, after the panel)

- **`components/layout/clerk-root.tsx`** (NEW, server component, beside `StyleNonce` and `AppShell`;
  architecture lens): the provider exactly as the root layout renders it today (`dynamic`, the request
  nonce, the four URLs, `appearance`), with the keys-absent pass-through. **It takes no props**: a
  remounted provider skips `clerk.load()` once clerk-js is on the window, so a second segment's props
  would be silently ignored (security P2). Moved comments drop their `7.9.22` version claims
  (installed: `7.9.24`). The `'x-nonce'` literal becomes a named constant shared with `proxy.ts` and the
  root layout (its third copy).
- **A `layout.tsx` in each of `app/p/`, `app/settings/`, `app/sign-in/`, `app/design/`** renders
  `<ClerkRoot>` outermost. **Not `app/programs/`**: it holds actions only, no page (architecture P1),
  so no feature guide's `owns:` is touched. A future rail layout (PICK-1 PR 4) nests inside it.
  **Rejected alternative:** one route group, `app/(clerk)/layout.tsx`, gives the same URLs with one
  provider and no remount (no sign-out flash, no cross-segment sign-in hop). It moves four segment
  directories, which rewrites the `owns:` globs of about five feature guides and collides with every
  lane's open work; the remount's cost (below) is smaller.
- **`app/layout.tsx`** loses the provider; keeps the nonce read for `ThemeProvider`, the theme and
  `StyleNonce`.
- 🔴 **Every link from a provider-less page into a Clerk segment is a plain `<a>`, never `<Link>`**
  (security P0). A soft navigation renders the new segment's layout in an RSC request with a FRESH
  `x-nonce`; clerk-js would load for the first time with it and stamp it on its `<style>` tags, which
  the page's CSP (the first document's nonce) blocks, so the sign-in card would render unstyled in
  production while CI (no keys) and dev (`'unsafe-inline'`) stay green. A full document load gives
  clerk-js the page's own nonce. Today there are exactly two crossings: `app/page.tsx:59` (→
  `/sign-in`) and `app/not-found.tsx:37` (→ `/p`). The shared footer links only to public pages, which
  is safe in both directions.
- **Guard: extend `app/pages-need-a-session.test.ts`** (architecture P1, its crawler and `localGraph`
  are reused; no new file). Classification is by **`PUBLIC_PATHS`** (`/`, `/privacy`), never
  `isPublicPath`, which also covers `/sign-in` (public, but keeps Clerk). It asserts:
  1. every page outside `PUBLIC_PATHS` has an ancestor `layout.tsx` (walking EVERY ancestor segment,
     not only the root and the page's own, which the crawler does today) that renders `<ClerkRoot>`;
  2. no file reachable from the root layout, a `PUBLIC_PATHS` page, `not-found.tsx` or `error.tsx`
     (followed through imports) imports `@clerk/nextjs` or `ClerkRoot`;
  3. those same files render no `next/link` `Link` whose `href` names a Clerk segment (the P0 rule);
  4. every `<ClerkRoot>` is rendered with no props.

## Remount, answered from source (security lens)

On unmount the provider calls `IsomorphicClerk.clearInstance()`; the next mount finds `window.Clerk`
loaded and skips `clerk.load()`, so clerk-js is reused across segments. The visible cost: Clerk's
status restarts at "loading", so the sign-out button briefly shows its disabled loading copy on each
entry to `/p` from another segment. For the UX lens.

## Test plan (v2)

- The extended guard, RED-probed for each of its four rules: delete `app/p/layout.tsx`; import
  `ClerkRoot` into the root layout; turn `page.tsx:59` back into `<Link>`; give one `<ClerkRoot>` a
  prop.
- `e2e:local`: the suite runs dark (no keys) and proves the keys-absent branch still renders every
  route.
- **Merge gate on the Vercel preview (keys present), recorded in the PR:**
  - `/` and `/privacy`, opened directly in a fresh browser: no request to the Clerk host
    (network panel, not `curl`, so prefetch is seen);
  - `/` → click Sign in: the card is styled and there are zero `style-src` violations in the console;
  - sign in → `/p` → `/settings` → `/p` → sign out → `/sign-in`: no errors, no unexpected redirect,
    and the sign-out button is enabled on arrival at `/p` with no visible fade;
  - an unknown URL → its 404 → "All athletes": styled and signed in.

## Docs (v2, privacy lens)

The claim is **not** "the public pages reach no third party": Vercel, the host, sees every request,
and a returning visitor's expired Clerk session can still be handshaken by the middleware, which runs
on every route. The exact wording: _opened directly, before signing in, `/` and `/privacy` load no
Clerk code; the host (Vercel) still sees the request_. Edits:

- `data-inventory.md:543-551` (the "not done" paragraph), `:557` (the `/sign-in` row's "every
  route"), `:758` (the Clerk processor row's "on every page");
- `notice.md:176-185` (the disclosure and its "not done yet"), `:160` (the Clerk row → "the sign-in
  screen and every page once signed in"), `:3` (Last updated, marked new in this version); then
  regenerate `lib/privacy/notice-content.ts`;
- `docs/architecture.md:59-66` (the `UI ==> CLERK` edge now comes from non-public pages);
- about 15 comments that name `app/layout.tsx` as the provider's home (`sign-out.tsx:31,65`,
  `p/page.tsx:170`, `lib/clerk.ts:7,119`, `env.ts:76`, `proxy.ts:67,287`, `globals.css:3`,
  `constants.ts:103`, `safe-redirect.ts:8`, `sign-in/[[...rest]]/page.tsx:47`, `.env.example:33`,
  `sign-out.test.tsx:46`, `pages-need-a-session.test.ts:188`), and `ui-5-app-shell.md:108`'s "No
  nested `layout.tsx` files exist" (a dated plan: a superseding note, not an edit);
- `docs/tech-debt.md` entry removed; changelog fragment.

## Out of scope (recorded)

Skipping `clerkMiddleware` on exact `PUBLIC_PATHS` would also stop the handshake there (security P1's
alternative). It changes the proxy's auth wiring and its CSP path, so it is its own reviewed change;
the wording above is true without it.

## Size

About 4 new layout files, 1 component, 2 link changes, the guard extension, and the docs and
comment sweep. Likely over 400 lines with the docs; if so, split: PR A the code + guard + crossings,
PR B the privacy docs and comment sweep, merged together.

## Review-response log (adversarial panel)

> Models: security, architecture, privacy on `opus` (Fable spend limit until 2026-11-19 03:00 ET).
> UX (one lens, opus) on v2: no P0 or P1.

| Lens         | Sev | Critique                                                                                                                                                                                                                              | Response                                                                                                                                 |
| ------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| security     | P0  | A `<Link>` from a provider-less page into a Clerk segment loads clerk-js with a fresh RSC nonce; its styles are blocked; the sign-in card renders unstyled in production                                                              | **Accepted.** Crossings are plain `<a>` (two today); guard rule 3; a preview merge gate.                                                 |
| security     | P1  | "No third party" overclaims: the middleware's handshake runs on every route, and a soft nav keeps clerk-js                                                                                                                            | **Accepted.** Exact wording; skipping the middleware there is out of scope.                                                              |
| security     | P2  | A remounted provider ignores later props; the sign-out button flashes "loading"                                                                                                                                                       | **Accepted:** no-props rule (guard 4); the flash goes to the UX lens.                                                                    |
| security     | P2  | Moved comments cite 7.9.22                                                                                                                                                                                                            | **Accepted.**                                                                                                                            |
| security     | —   | Server auth unchanged; the four segments are the full list; clerk-js is reused on remount                                                                                                                                             | Recorded.                                                                                                                                |
| architecture | P1  | `app/programs/` has no page                                                                                                                                                                                                           | **Accepted.** Dropped.                                                                                                                   |
| architecture | P1  | "Public" is two sets (`isPublicPath` includes `/sign-in`)                                                                                                                                                                             | **Accepted.** Classify by `PUBLIC_PATHS`.                                                                                                |
| architecture | P1  | The guard must follow imports and walk every ancestor; extend the existing test                                                                                                                                                       | **Accepted.**                                                                                                                            |
| architecture | P2  | Leave room for PICK-1's rail layout; the remount's delicate hops are sign-in and sign-out                                                                                                                                             | **Accepted:** `<ClerkRoot>` outermost; both hops in the merge gate.                                                                      |
| architecture | P2  | Docs and ~15 comments name the root layout                                                                                                                                                                                            | **Accepted:** listed.                                                                                                                    |
| architecture | NIT | `components/auth/` would hold one file; `'x-nonce'` third copy                                                                                                                                                                        | **Accepted:** `components/layout/`; a constant.                                                                                          |
| privacy      | P1  | "No third party" is false (Vercel)                                                                                                                                                                                                    | **Accepted.**                                                                                                                            |
| privacy      | P1  | Six doc spots, not one                                                                                                                                                                                                                | **Accepted:** listed.                                                                                                                    |
| privacy      | P2  | Direct-open only; use a browser check, not `curl`                                                                                                                                                                                     | **Accepted.**                                                                                                                            |
| privacy      | P2  | Nothing tells the visitor at the click to `/sign-in`                                                                                                                                                                                  | **Accepted in part:** the notice says Clerk loads when the sign-in screen opens; a note under the CTA goes to the UX lens.               |
| UX           | —   | Plain `<a>` crossings: the browser keeps the old page with its own progress bar, then `/sign-in` streams; arguably better than a frozen `<Link>`. The remount flash causes no shift (`loading` and `action` copy are the same string) | Recorded.                                                                                                                                |
| UX           | P2  | Check "sign-out enabled on arrival, no fade" in the merge gate                                                                                                                                                                        | **Accepted.**                                                                                                                            |
| UX           | P2  | Record why the `(clerk)` route group was rejected                                                                                                                                                                                     | **Accepted:** Design.                                                                                                                    |
| UX           | —   | The optional note under the landing CTA                                                                                                                                                                                               | **Declined**, as the lens recommends: `/sign-in` discloses above the card before the Google consent tap, and the notice covers the rest. |

## Implementation status (2026-11-18)

Implemented and committed on the branch, **not pushed** (the board is holding new PRs while the
queue clears).

**Fresh review of the code** (security and correctness, opus): no P0. Its P1 is fixed. The notice and
the inventory understated the handshake edge: a signed-in visitor who opens any page directly is
usually sent to Clerk to refresh their sign-in, not only one whose session lapsed. Its P2s are fixed:

- the link rule is an allowlist (`/`, `PRIVACY_PATH`, the footer's `item.href`);
- the Clerk-import rule catches any `@clerk/` package;
- the root's files come from `segmentFiles`;
- the stale runbook line is corrected, and the UI-5 plan has a superseding note;
- `NONCE_HEADER` is documented as Clerk's literal name and pinned in `proxy.test.ts`.

🔴 **Open blocker, found locally: `e2e/theme.spec.ts:151` ("the choice survives a reload") fails on
this branch, consistently (twice), and passes on `main` (6/6, the same machine and load).**

- After the reload the page shows Dark selected: React's state is `dark` and the label is styled as
  selected. The Dark radio carries the `checked` attribute, but its DOM `checked` property is
  `false`, so `toBeChecked()` fails.
- The radios are controlled (`components/theme/theme-toggle.tsx`, `checked={selected}`, all
  `name="theme"`).
- The cause is not yet found. Two leads:
  - The new `app/p/layout.tsx` (an async server component) changes when the page hydrates, and a
    same-name radio group's checked state desyncs across the `useSyncExternalStore` hydration flip
    (`system` on the server render, then `dark`).
  - Or a second `name="theme"` group is present in the document.
- **Must be resolved before this ships.** The other three failures in the first full run
  (`day-page.spec.ts` ×2, `log-bodyweight.spec.ts`) passed on a re-run, with the machine's load
  average over 50; they are treated as load flakes, not as this change.
