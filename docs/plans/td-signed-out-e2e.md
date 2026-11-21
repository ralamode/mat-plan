# A signed-out visitor is refused, proved at runtime again (tech debt, AUTH-1 1d)

## Where this sits

- **Row:** `docs/tech-debt.md` → "Two runtime auth proofs went with the gate, and the harness cannot
  replace them" (AUTH-1 1d, P3). The maintainer approved it for lane E (orchestrator's chat,
  2026-11-20). It is tagged Beta 0 and `tech-debt`, and gates nothing.
- **Roadmap alignment (2026-11-20):** checked against the private roadmap; nothing to add here. Two
  public rows bind the design:
  - `docs/plan.md:672`: a signed-out visitor gets a public landing page;
  - `docs/plan.md:1393`: a future unauthenticated `/h/<handle>` subtree.

  So "public" is `isPublicPath()` (`lib/public-paths.ts:56`): `PUBLIC_PATHS` plus `PUBLIC_PATH_TREES`.
  A later leaf inherits both proofs below. A later tree inherits the exclusion and brings its own
  positive fixture.

## Goal

Restore a **runtime** proof that a request with no session is **refused, writes nothing, and gets
no household data back**. This is restated from the first draft's "does no work", which the design
cannot show (security, B2; see the log).

What the suite proves today:

- **Unit-proved:** `requireSession()` on every page, pinned by `app/pages-need-a-session.test.ts`;
  `enterMutation` → `sessionUserOrNull()` in every action; the session check in both route handlers.
- **Not runtime-proved:** since AUTH-1 1d the e2e suite never sends a request without a principal.
  The one server arms `E2E_SESSION_BYPASS_USER_ID` (`lib/env.ts:196`).

What still holds, and must keep holding: no session and no permission give **byte-identical**
refusals by design (ADR 0006; `app/p/mutation-entry.ts`). So no runtime proof can say _which_
layer refused, or that the database was not read. "The entry check runs before any lookup" stays
unit-owned (`app/p/[profileId]/actions.test.ts`: `getProfileByPublicId` is not called). 🔴 **The
tech-debt row's "do not cite 'no unauthenticated request reaches the DB' as a property this suite
demonstrates" STAYS** (see Docs).

### Done when

Each proof restores a deleted one where its tombstone sits. Each has a named mutation that turns it
red, run once and recorded in the spec's header (correctness S6).

| #   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Where                                                                                          | Turns red when                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Every protected page refuses a stranger.** One browser test loops over every `app/**/page.tsx` whose route is not `isPublicPath()` (12 today, design previews included; a count floor stops an empty glob passing, S4; dynamic segments get `newId()`). For each it asserts two things. **(a) Where it lands:** the main-frame chain, built from the navigation response's `request().redirectedFrom()` walk plus main-frame `framenavigated` URLs for client hops, normalised to pathname with consecutive duplicates collapsed, is exactly `[route, SIGN_IN_PATH]` (S3; correctness round 2). A baseline probe on one loading route (`/programs`) and one 307 route (`/settings`) is run first, and both chains are recorded in the spec header. **(b) What is on the wire:** `request.get(route, { maxRedirects: 0 })`'s body holds none of proof 2's fixture strings (the seeded athlete's name, the leak list), so a 200 shell from a loading boundary is checked against the Goal's "no household data" (security round 2).                               | `landing.spec.ts`, replacing the deleted "the app itself is still gated"                       | (a) `await requireSession()` deleted from `app/programs/page.tsx` (it bounces through `/p`, an extra hop); (b) a layout rendering the athlete's name ahead of the check                                                                                                  |
| 2   | **A real Server Action POST, sent as-is, is refused and writes nothing.** The existing replay test's `variants` becomes `{ headers, targets, origin, expect }` per arm (correctness round 2). The spoofed arm is unchanged (`x-action-forwarded`, `PUBLIC_PATHS` only, bypassed origin, no `"ok":` at all). The **as-is arm** comes back: the captured Save **un-spoofed** to `[the routine path, ...PUBLIC_PATHS]` on the signed-out origin, with only `next-action`, `content-type` and `accept` (S1; security 6: a copied `origin` meets Next's CSRF check and 500s). Its per-response checks are **`expect.soft`**: status 200, no `x-nextjs-action-not-found`, the exact `NO_PROFILE_SAVE` copy (`lib/constants.ts:1072`), no fixture data, and a non-null `postDataBuffer()`. Being soft, they let the test's existing tail ("a fresh load still has the original order", on the bypassed origin) run, so the tail is the no-write proof. The capture runs on the bypassed origin, outside the `describe('public')` blocks that move to the signed-out one. | `landing.spec.ts:120`, the deleted variant 1                                                   | the `''` override is dropped, so server 2 is armed and the Save really runs. **Both** the soft copy check and the tail ("a replay ran: the routine was saved") go red, and both are recorded. Run under `e2e:local` only, because it really writes to the throwaway seed |
| 3   | **The export answers a member and refuses a stranger.** The same seeded athlete's export URL gets **200 with a zip on the bypassed origin, then 404 on the signed-out one**, in one test. A fresh id can't fail this test, since it answers 404 either way (B1, three lenses). Even so, deleting the handler's own session line stays green, because the DAL's scope refuses too, so this proof claims "a stranger gets 404 where a member gets 200" and nothing more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `export-csv.spec.ts`, replacing the deleted "a request without the access cookie gets nothing" | server 2 is armed                                                                                                                                                                                                                                                        |
| 4   | **Public paths stay public.** The existing `describe('public')` blocks in `landing.spec.ts` and `privacy.spec.ts` move to the signed-out origin (`test.use({ baseURL })`), so every existing public test becomes a real stranger test. One loop over `PUBLIC_PATHS` and the `PUBLIC_PATH_TREES` roots checks `request.get(path, { maxRedirects: 0 })` answers 200 with no `__next-page-redirect`, then `toHaveURL(path)` in a browser (S5: a followed redirect to `/sign-in` also renders an `<h1>`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `landing.spec.ts`, `privacy.spec.ts`                                                           | `await requireSession()` is added to `app/privacy/page.tsx`                                                                                                                                                                                                              |

## The two constraints the tech-debt row recorded, answered

**C1. "A second server proves the dark-deployment branch, not the one under test."** True, and it
stays recorded. With no Clerk keys:

- `getCurrentUser()` returns `null` at `lib/dal/session.ts:77`, before `auth()` (`:80`);
- the proxy returns at `proxy.ts:172`, before `clerkMiddleware` is composed (architecture 4,
  security 7).

So this PR proves the refusal from `null` onwards through the real build, routing and action
dispatch, and through the **dark** proxy: headers and the tombstone. It does **not** prove the
Clerk-composed proxy, or a real `auth()` with no session.

The `:80` branch is unit-proved already; these are cited, not re-added (reuse 7):

- `session.test.ts:66`, configured but no session → `null`;
- `:174`, the armed bypass wins, and `auth()` is never called;
- `:194`, a disarmed bypass doesn't rescue a missing session.

The tech-debt row is **narrowed** to that residual, not closed (see Docs). Runtime proof of it is Q1.

**C2. "`webServer.env` can only SET a key, so the config must name the bypass variable."** True.
The pin grows deliberately rather than being dodged.

- **Server 2's `env` is exactly `{ E2E_SESSION_BYPASS_USER_ID: '' }`.** Why `''` cannot arm it, link
  by link (security, C2):
  - Playwright 1.64.1 spreads `options.env` over `process.env` (`playwright/lib/runner/index.js:872-876`);
  - `pnpm --filter … exec` keeps a present empty key;
  - `@next/env` 16.4.5 applies a `.env*` value only when the key is `undefined`;
  - `lib/env.ts:198` returns `null` on a falsy value, pinned by `lib/env-session-bypass.test.ts:135-139`.
- **The failure modes:**
  - **an absent key** inherits the armed parent; server 2 is then bypassed and proofs 1 to 3 go red,
    which fails loud;
  - **`undefined`** would be silent, which is why the pin below demands `''`.
- **No credential blanks are copied.** Under `e2e:local` both servers inherit the harness's blanks
  (`e2e-local.ts:131-135`), and CI has no keys, so parity holds. A fourth copy of that list would
  drift, and Q1 would have to unwind it (reuse 5, scope 5, architecture 6).
- **`test/bypass-is-contained.test.ts`** gains a separate **`DISARMS = ['playwright.config.ts']`**
  category. It does not join `INJECTORS`, since the config disarms rather than injects (architecture
  6). Its assertion is shaped like the `ci.yml` pin (`:113-128`):
  - in `code(playwright.config.ts)` there is exactly **one** match of `/E2E_SESSION_BYPASS_USER/`; the
    prefix also catches an import of the fixture constant;
  - that match's line fits `^\s*E2E_SESSION_BYPASS_USER_ID: '',?$`;
  - the file is added to the "still exists" loop.

  A `'' || …`, a second entry or an `undefined` all fail it (security 4).

## Design

- **`apps/web/e2e/contexts.ts`:** the two origins, defined once and imported by the config and every
  spec that needs them (reuse 8, architecture 5):
  - `APP_ORIGIN`: `E2E_PORT ?? 3100`, today's;
  - `SIGNED_OUT_ORIGIN`: `E2E_SIGNED_OUT_PORT ?? 3101`.

  The module already sits on the config's import path and is dependency-light.

- **`apps/web/playwright.config.ts`:**
  - `webServer` becomes an array, and the existing entry is unchanged;
  - the second entry runs `next start` on the **same build**, after the first. Playwright 1.64.1 runs
    the entries in order and waits for each URL (`runner/index.js:6331-6341`, `:838-846`; scope,
    architecture, correctness), so there is no second build and no health-URL workaround;
  - the second entry has `reuseExistingServer: false`, **always**: a server whose env this run did
    not set is not a signed-out proof (architecture 2, security 5, correctness S7);
  - **no new project:** the specs above reach the second origin by `test.use({ baseURL })` or absolute
    URLs (scope 2).
- **`apps/web/scripts/e2e-local.ts`:** passes `E2E_SIGNED_OUT_PORT` from a second `freePort()`
  (`scripts/embedded-pg.ts:74`), asserted to differ from the app port.
- **Shared helpers**, moved rather than copied:
  - `routeOf`, `pages` and the floor move out of `app/pages-need-a-session.test.ts` into a new
    `e2e/app-routes.ts`, and both the vitest file and proof 1 import it (reuse 2). Its functions take
    the app directory **as an argument**, and the module reads no `import.meta` of its own. **Probed
    2026-11-20:** Playwright 1.64.1's transform cannot load a module that reads `import.meta` at module
    scope (`test/source-scan.ts`; `SyntaxError: Cannot use 'import.meta' outside a module` under
    `playwright test --list`). So `source-scan.ts` is not the home. The vitest file passes its own
    `import.meta`-derived path, and the spec passes one built from `__dirname`, which Playwright's
    CommonJS transform provides.
    **As built, it lives in `e2e/`, not `test/`:** `test/program-imports.test.ts` forbids any file
    outside `apps/web/test/` from importing a test helper, and the spec is outside it.
  - `routineOrder`, the Save capture and the leak list stay inside the one replay test that uses them.
    Proof 2 extends that test rather than copying it (scope 1), so nothing is hoisted.
- **`app/p/[profileId]/routine` capture:** the capture page runs on the **bypassed** origin
  explicitly. `page.route` resolves against the context's `baseURL`, so a capture on the wrong origin
  isn't intercepted and the Save would really write (correctness S1). The replay test keeps the
  `setup` dependency, so the bypassed server is warm.
- **`e2e/landing.spec.ts:155`:** `postDataBuffer() ?? undefined` becomes an assertion that the body
  is non-null. An empty fallback matters once the action really runs (correctness, outside the diff).

## Alternatives considered

- **Real Clerk development-instance keys in CI**, so server 2 takes the configured branch:
  - **for:** it would prove the Clerk-composed proxy and a real `auth()` with no session;
  - **against:** it adds a live secret to a job that runs PR code, makes every e2e run depend on
    Clerk's network, and contradicts the runbook's deliberate blanks (`docs/runbooks.md:143-145`).

  **Q1.** The seam is ready for it: keys would go to server 2 only, so `theme.spec.ts`'s zero-egress
  check stays on server 1 (architecture).

- **A new `signed-out.spec.ts` and project:** the first draft had them. Rejected in favour of
  restoring each proof at its tombstone, because a new spec would copy the capture flow, leak list
  and tail assertion (scope 1–2, reuse 3).
- **The "How to" handler** (`programs/how-to/[optionId]`): not in the row, and unit-proved signed out
  (`route.test.ts:38`). Left out (scope 7).
- **A launcher that strips the variable by prefix:** it would satisfy the pin while defeating it (C2).
- **A per-request bypass toggle:** it would make the bypass reachable by request. Rejected; the
  design selects by process and port, never by request (security).

## Risks / rollback

- **Server 2 holds the same database as server 1.** Proof 2's action is refused before any write;
  its tail asserts that, and its probe (run under `e2e:local`) shows the tail reddens on a real write.
- **Cost:** one more `next start`, 12 page navigations in one test, and a few requests. It
  starts on every run, even a single-spec one (security). Measured in the PR against the Speed
  budget.
  - **Earned below the browser?** Pages: real navigation and redirects. The action: a Server Action
    round trip. Public paths: the static test's `sessioned || isPublic` can't catch a public page
    that gains a session. The export: it restores the deleted proof (scope 7).
- **Rollback:** revert. No migration, no data, and the only non-test edits are comments.

## Docs, in the same PR

- **`docs/tech-debt.md`:** the row is **narrowed**, not deleted, to "the Clerk-composed proxy and a
  real `auth()` with no session are unit-proved only (Q1)". Its "do not cite" sentence is **kept, still scoped to the whole suite**: no runtime proof here, on any branch, shows that no unauthenticated request reaches the database (security round 2). Its "what is lost" line becomes "refused, writes nothing, no household data", and it links this plan. The `landing.spec.ts:112-114` warning is kept by the comment rewrite.
- **Comments that this PR makes false**, because they say no context can be unauthenticated or point
  at the missing server:
  - `playwright.config.ts:7-13`
  - `e2e/contexts.ts:9-14`
  - `e2e/landing.spec.ts:21-26`, `:60-64`, `:104-116`
  - `e2e/export-csv.spec.ts:39-54`
  - `e2e/global.setup.ts:16`
  - `e2e/privacy.spec.ts:20`
  - `scripts/e2e-local.ts:48`
- **Two comments the fact sheet found wrong:**
  - `landing.spec.ts` and the row's Impact paragraph say "the in-action `requireSession()`"; it is
    `enterMutation` → `sessionUserOrNull()`;
  - `lib/dal/session.ts:7`'s path to `mutation-entry.ts` is wrong.
- **`docs/architecture.md` § 2b:** a line naming the runtime proofs beside the static test.
- **A changelog fragment** saying what replaced each deleted proof.
- **`docs/definition-of-done.md`:** no edit.

## Out of scope

- The Clerk-composed branch at runtime (Q1).
- `.github/SECURITY.md` does not mention the test session bypass at all, though it bypasses
  authentication in production code (security, outside the diff; since #319). Raised with the
  Tech Debt lane as its own row, not folded in here.
- `ai-1-nl-logging.md`'s spend argument: the "do not cite" sentence still stands after this PR, and
  that plan is its owner's.

## Decided

- **Approved** by the maintainer _(orchestrator's chat, 2026-11-20, relayed by the board)_: "Approve; no
  Clerk keys in CI (Recommended)".
- **Q1, decided: runtime proof through the no-Clerk path is enough for now.** The narrowed tech-debt
  row keeps the Clerk-composed branch visible.
- **Re-checked at Playwright 1.65.1** (#794 bumped it from 1.64.1; the maintainer asked for this). The
  three internals this plan relies on are unchanged:
  - `options.env` is spread over `process.env` (`playwright/lib/runner/index.js:943-947`);
  - entries start in order, each awaiting its URL (`:913-915`, task loop `:6425`);
  - with `reuseExistingServer: false`, a port already answering throws "is already used" (`:933-936`).

## Review-response log

### Engineering panel (round 1, 2026-11-20)

> Five lenses on Fable: security, correctness, scope, architecture, reuse. Each read commit
> `b861151a`.

| #   | Lens                                              | Critique (short)                                                                                                                                                                | Verdict      | Resolution                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | architecture, security, correctness               | The handler proof uses a fresh id, so it answers 404 with or without a session                                                                                                  | **accepted** | Proof 3: the seeded athlete's export, 200 on the bypassed origin, then 404 on the signed-out one; the claim narrowed to that                                                                                                                                                                                                       |
| B2  | security                                          | "Does no work" can't be shown: no-session and no-permission refusals are byte-identical by design, and a null scope refuses on its own                                          | **accepted** | The Goal is restated as refused, nothing written, no household data; "no lookup" stays unit-owned; the "do not cite" sentence stays; the Out-of-scope invitation to the AI spend argument is dropped                                                                                                                               |
| S-a | reuse, scope, architecture, security, correctness | The skip list is hand-typed; the design previews call `requireSession()`; `/sign-in` is a tree                                                                                  | **accepted** | `!isPublicPath(route)` only, design previews included, a count floor                                                                                                                                                                                                                                                               |
| S-b | reuse, scope, architecture, correctness           | The plan cites "the SEC-1 witness" for the capture and the leak list; they're in the forwarded-spoofed test                                                                     | **accepted** | The citation is fixed, and proof 2 extends that test                                                                                                                                                                                                                                                                               |
| S-c | scope, architecture                               | A new spec and project would copy the capture flow                                                                                                                              | **accepted** | Each proof is restored where its tombstone sits; no new project                                                                                                                                                                                                                                                                    |
| S-d | reuse                                             | The expected refusal is `NO_PROFILE_SAVE`, not the contract's `not_found`; a bare `"ok":false` matches other refusals too                                                       | **accepted** | The exact constant is imported and asserted                                                                                                                                                                                                                                                                                        |
| S-e | reuse, scope, architecture, security, correctness | `PORT + 1` is unchecked, and `reuseExistingServer` can adopt a stranger's process                                                                                               | **accepted** | A second `freePort()` in `e2e-local`; `reuseExistingServer: false` on server 2; both origins in `contexts.ts`                                                                                                                                                                                                                      |
| S-f | reuse, scope, architecture                        | Copying the credential blanks into the config makes a fourth copy, and does nothing                                                                                             | **accepted** | Only the one key; the inheritance is cited                                                                                                                                                                                                                                                                                         |
| S-g | architecture, security                            | The config would join `INJECTORS`, and "empty only" was unspecified                                                                                                             | **accepted** | A separate `DISARMS` category: exactly one match, fitting the empty-value line, plus the exists loop                                                                                                                                                                                                                               |
| S-h | architecture, security, correctness               | "Through the real proxy" overclaims (`proxy.ts:172`), and the "new" unit case already exists                                                                                    | **accepted** | C1 names the dark proxy and cites `session.test.ts:66`, `:174`, `:194`; the row is narrowed, not closed                                                                                                                                                                                                                            |
| S-i | correctness                                       | A final-URL check misses `/programs` losing its check (it redirects through `/p`), and the loading boundaries may stream the redirect                                           | **accepted** | Assert the navigation chain is exactly `[route, SIGN_IN_PATH]`                                                                                                                                                                                                                                                                     |
| S-j | correctness                                       | The public-path `<h1>` check passes on a followed redirect to `/sign-in`                                                                                                        | **accepted** | `maxRedirects: 0` with no `__next-page-redirect`, then `toHaveURL(path)`                                                                                                                                                                                                                                                           |
| S-k | correctness                                       | The replay as specified would carry the captured `origin` (a CSRF 500), aim at the wrong path, capture on the wrong origin, and has no control showing the tail can see a write | **accepted** | Un-spoofed, to the routine path plus `PUBLIC_PATHS`, three headers only, capture on the bypassed origin; probed red once by arming server 2                                                                                                                                                                                        |
| S-l | correctness                                       | No proof is probed red                                                                                                                                                          | **accepted** | Every proof has a named mutation in Done-when, run once and recorded in the spec header                                                                                                                                                                                                                                            |
| S-m | scope, architecture                               | The docs list misses most comments this PR falsifies                                                                                                                            | **accepted** | Listed under Docs                                                                                                                                                                                                                                                                                                                  |
| S-n | scope                                             | The all-pages sweep grows past the one page that was lost                                                                                                                       | **rejected** | One test, and it is the only runtime check that **each** protected page refuses a stranger through real routing. That a page's check comes before its data read stays unit-owned and unproved at runtime: a redirect chain cannot show it (security round 2 corrected the first reason given here). The cost is measured in the PR |
| S-o | scope                                             | The "How to" handler is new and unit-proved already                                                                                                                             | **accepted** | Left out (Alternatives)                                                                                                                                                                                                                                                                                                            |
| N   | several                                           | The fact-sheet references dangle; `emptyStringAsUndefined` is the wrong cite; `:74` should be `:75`; `SIGN_IN_PATH` and `newId()` should be named                               | **accepted** | Fixed in the text                                                                                                                                                                                                                                                                                                                  |
| —   | security (outside the diff)                       | `SECURITY.md` never mentions the test bypass                                                                                                                                    | **deferred** | Raised with the Tech Debt lane as its own row                                                                                                                                                                                                                                                                                      |

### Re-review (round 2, 2026-11-20)

> Security and correctness, the lenses whose BLOCKINGs reshaped v1, at medium effort against `11528c6e`.

| #   | Lens              | Critique (short)                                                                   | Verdict      | Resolution                                                                            |
| --- | ----------------- | ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| R1  | security          | "Kept and re-scoped" could narrow the "do not cite" sentence to the Clerk residual | **accepted** | Kept, still scoped to the whole suite; "what is lost" restated                        |
| R2  | security          | Proof 1 can't show "no household data", and S-n's reason claimed an ordering proof | **accepted** | Proof 1 (b), a body check with its own red mutation; S-n re-justified                 |
| R3  | correctness       | Proof 2's red probe fails on the copy check before the tail runs                   | **accepted** | The per-response checks are `expect.soft`; both reddenings recorded; `e2e:local` only |
| R4  | correctness       | The navigation recorder is undefined; 307 and streamed redirects differ            | **accepted** | Recorder named; baseline probes on `/programs` and `/settings` recorded first         |
| R5  | correctness (NIT) | One `variants` body cannot serve both arms                                         | **accepted** | `{ headers, targets, origin, expect }` per arm                                        |
| —   | both              | B1, B2 and every round-1 SHOULD                                                    | **resolved** | Confirmed in the text                                                                 |
