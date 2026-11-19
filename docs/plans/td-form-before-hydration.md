# Tech debt — a form submitted before the page hydrates reaches its Server Action

> Debt row: [tech-debt.md](../tech-debt.md) → "The add-athlete form cannot be submitted without
> hydration — Next refuses the request" (added 2026-11-10). Branch: `fix/td-add-athlete-unhydrated`.
> No `plan.md` row: a tech-debt payoff, queued by the board (2026-11-19).

_Roadmap alignment (2026-11-19): checked against the private roadmap; nothing to add here. Gates
nothing._

## The cause, measured (2026-11-19)

The entry said the cause was not established. A diagnostic run against the production build on
`e2e:local` established it. The add form was posted with the app's chunks blocked, and the probe
was a throwaway spec, never committed.

- The browser's native POST carried `Origin: null`, with the expected `$ACTION_REF_1` /
  `$ACTION_KEY` fields.
- Next answered 500, and the server logged:
  `` `x-forwarded-host` header with value `localhost:…` does not match `origin` header with value
`null` from a forwarded Server Actions request. Aborting the action. ``
  This is Next's CSRF check (`server/app-render/action-handler.js`: origin host ≠ host), which then
  throws `Invalid Server Actions request.`
- `Origin: null` comes from our own header: `proxy.ts:129` sets `Referrer-Policy: no-referrer`. Under
  that policy **every browser** serializes the Origin of a non-CORS POST as `null`, even same-origin
  (Fetch, "append a request `Origin` header"; Chromium, Firefox and WebKit all implement it, per the
  security lens). A `fetch`
  from hydrated React carries a real Origin, which is why only the unhydrated path fails.

**So it is not this form's alone, but it is narrower than "app-wide".** React emits a native POST
only when a form's `action` is a server reference; a client closure gets a `javascript:` action and a
replay script instead. So the forms refused before hydration were the ones on four routes:
`/p/new`, `/p/[id]/edit`, `/p/[id]/routine` and `/settings` (archive, restore). The day page's log
forms (`bodyweight-form`, `life-form`, `single-value-amend`) wrap the action in a closure, so they
always waited for hydration and this does not change them. Neither does the program builder, whose
forms are `onSubmit` with no `action`.

## Design

- **`Referrer-Policy: same-origin`** in `proxy.ts`, named once as a const that the proxy test pins.
  Same-origin requests then carry a real `Origin` (and `Referer`), so Next's CSRF check passes.
  Cross-origin requests still carry **no** referrer, which is what `no-referrer` bought us: no URL
  (profile public ids, days) leaves for a third party. Same-origin requests only go to us.
- **Not** `serverActions.allowedOrigins: ['null']`: that would accept a POST from any opaque origin
  (a sandboxed iframe, a `data:` page), which is exactly what the check exists to refuse.
- **The invariant `same-origin` rests on: no same-origin path relays to a third party.** Clerk's
  frontend-API relay copies every request header to Clerk's API, so it stays disarmed
  (`frontendApiProxy: { enabled: false }`), now pinned in `proxy.test.ts`. There is no Sentry
  `tunnelRoute` and no external `rewrites()`. `lib/sentry-scrub.ts` drops `referer` as the second
  line behind `httpHeaders: false`.
- **Rejected: `strict-origin`.** It fixes the bug too and never puts a path in a Referer, but it
  sends our origin to every cross-origin request (Clerk, `img.clerk.com`).
- `SECURITY.md` → Transport / headers names the policy, the invariant and the rejection, and
  corrects a sentence that read as if the relay were armed on the `*.vercel.app` alias.
  `data-inventory.md` gets a dated §8 entry; a read of whether Vercel's logs record `Referer` is
  owed.
- **What this does not promise:** a pre-hydration submit reaches its action while the Clerk session
  token is fresh. clerk-js refreshes it, and before hydration it is not running, so after an expired
  token the action's `requireSession` redirects to `/sign-in` with nothing written (fail closed).

## Proofs

- `proxy.test.ts`: the header is `same-origin`, through the const.
- **e2e, its own file `form-before-hydration.spec.ts`** (not the serial `athletes.spec.ts`, whose
  whole-file retry plus this add would pass the household cap). With `**/_next/static/chunks/**`
  aborted it submits the add form and asserts three things:
  - the POST was a navigation with no `next-action` header (native, not a fetch), answered 303 (main:
    500);
  - still unhydrated, the day page's `<h1>` is the name;
  - then, loaded normally, settings lists it.
    The RED is a local `pnpm probe` (`e2e:local`, the const reverted to `no-referrer`); CI only runs the
    green branch.
- **The debt entry is NARROWED, not closed** (correctness lens): a refusal on add or rename,
  unhydrated, re-renders a blank form, the state the reverted a-1d seed handled.

- **Manual, on a preview with real Clerk** (CI has no Clerk keys): with chunks blocked in DevTools,
  submit `/p/new` and expect the 303; a pre-hydration submit on iOS Safari; a hard navigation between two signed-in pages with no 307 to `/v1/client/handshake` (Clerk
  compares a same-origin Referer with its origin); a submit after the token expires (with chunks
  blocked) landing on sign-in with nothing written.

## Files

`apps/web/lib/constants.ts` (`REFERRER_POLICY`), `apps/web/proxy.ts`, `apps/web/proxy.test.ts`,
`apps/web/lib/sentry-scrub.ts` (+ test), `apps/web/e2e/athletes.spec.ts`, `.github/SECURITY.md`,
`docs/privacy/data-inventory.md`, `docs/tech-debt.md` (entry narrowed), `docs/lessons.md` (the new
entry and the stale one), `apps/web/app/p/profile-actions.test.ts` and `apps/web/app/p/new/page.tsx`
(comments), a changelog fragment. `docs/plans/prof-1-athletes.md` is merged history and stays as is.

## Review-response log

Panel (2026-11-19): security + privacy (one lens), correctness. Both on Fable.

| #   | Lens        | Finding                                                                                                      | Response                                                                                             |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| SP0 | sec/priv    | no P0: the root cause is confirmed in all three engines and Next; `same-origin` is right; no override exists | recorded                                                                                             |
| SP1 | sec/priv    | P1: Clerk's same-origin relay would forward `Referer` to Clerk; the option that disarms it was untested      | **accepted**: `proxy.test.ts` asserts `{ frontendApiProxy: { enabled: false } }` (probed red)        |
| SP2 | sec/priv    | P1: the Sentry scrub did not deny `referer`                                                                  | **accepted**: added to `DENIED_HEADERS`, with a test (probed red)                                    |
| SP3 | sec/priv    | P1: the inventory condition evaluated to "no update", but a processor now receives a new header              | **accepted**: a dated §8 entry; the Vercel log read is owed                                          |
| SP4 | sec/priv    | P2: the e2e cannot see Clerk (no keys) and is Chromium only; the expired-token fail-closed path              | **accepted**: "what this does not promise" + three manual preview checks                             |
| SP5 | sec/priv    | P2: "Chromium" understates the cause                                                                         | **accepted**: "every browser, per Fetch"                                                             |
| SP6 | sec/priv    | outside: SECURITY.md said the `*.vercel.app` relay forwards Set-Cookie, but the code disarms it              | **accepted**: corrected in this PR                                                                   |
| SP7 | sec/priv    | outside: `onSubmit`-only forms (program builder) don't reach an action before hydration either               | **accepted**: scope stated; not changed here                                                         |
| C1  | correctness | P1: the e2e proved a row exists, not a native POST or what the parent saw; it raced the redirect             | **accepted**: asserts navigation + no `next-action` + 303, then the unhydrated `<h1>`, then settings |
| C2  | correctness | P1: an unhydrated refusal re-renders a blank form, and the plan closed the entry that owes it                | **accepted**: entry narrowed and rewritten, not closed                                               |
| C3  | correctness | P1: "every Server Action form" is false; closure-wrapped day forms and builder forms are unaffected          | **accepted**: the four routes, everywhere the claim was stated                                       |
| C4  | correctness | P1: the e2e cannot see Clerk's expired-token path                                                            | **accepted**: a manual step, plus the residual in the entry                                          |
| C5  | correctness | P1: in the serial file a whole-file retry passes the household cap                                           | **accepted**: its own file, so a retry costs one slot                                                |
| C6  | correctness | P2: "CI runs it" cannot produce the RED                                                                      | **accepted**: the RED is the local probe, said so                                                    |
| C7  | correctness | P2: three hydrated-client success assumptions                                                                | **accepted**: one line each in the entry                                                             |
| C8  | correctness | P2: four stale statements                                                                                    | **accepted**: three fixed; the merged PROF-1 plan stays history                                      |
