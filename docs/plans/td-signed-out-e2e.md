# A signed-out visitor is refused, proved at runtime again (tech debt, AUTH-1 1d)

## Where this sits

- **Row:** `docs/tech-debt.md` → "Two runtime auth proofs went with the gate, and the harness cannot
  replace them" (AUTH-1 1d, P3). The maintainer approved it for lane E (orchestrator's chat,
  2026-11-20).
- **Pillar:** none; it is tech debt, tagged Beta 0 and `tech-debt`.
- **Gates nothing.**
- **Roadmap alignment (2026-11-20):** checked against the private roadmap; nothing to add here. Two
  public rows bind the design:
  - `docs/plan.md:672`: a signed-out visitor gets a public landing page;
  - `docs/plan.md:1393`: a future deliberately-unauthenticated `/h/<handle>` namespace.

  So the proof refuses everything **except** `PUBLIC_PATHS`, and reads that list rather than re-typing
  it, so a later public path is inherited, not fought.

## Goal

Restore a **runtime** proof that a request with no session does no work. The in-code checks are
unit-proved today:

- `requireSession()` on every page, pinned by `app/pages-need-a-session.test.ts`;
- `enterMutation` → `sessionUserOrNull()` in every action;
- `sessionUserOrNull()` in both route handlers.

But since AUTH-1 1d, nothing in the e2e suite ever sends a request without a principal: the harness
arms `E2E_SESSION_BYPASS_USER_ID` for the one server (`lib/env.ts:196`), so no browser context can be
unauthenticated.

**Done when** a Playwright project, against a server with no bypass, shows:

1. **Pages:** every protected page (`app/**/page.tsx` outside `PUBLIC_PATHS`, `/sign-in` and the
   design previews) redirects to `/sign-in`.
2. **Server Actions:** a real Server Action POST (a real `next-action` id) answers a refusal and
   writes nothing. This is the old **variant 1** (the as-is replay), the case the gate's removal made
   unprovable.
3. **Route handlers:** both answer 404 — the export (`p/[profileId]/export`) and "How to"
   (`programs/how-to/[optionId]`). There is no `app/api`; these two are the repo's route handlers.
4. **Public paths:** every `PUBLIC_PATHS` entry still renders, signed out.

## The two constraints the tech-debt row recorded, answered

**C1. "A second server proves the dark-deployment branch, not the one under test."** True, and
stated rather than hidden. `getCurrentUser()` (`lib/dal/session.ts:64`):

- returns the bypass principal first (`:74`);
- then `null` when Clerk is not configured (`:77`);
- then asks `auth()` (`:80`).

With no keys, the signed-out server takes `:77`. With keys and no session, it takes `:80` and gets
no `userId`. **Everything after that `null` is the same code.** The page redirect, the action's
refusal and the handler's 404 cannot tell which branch produced the `null`. So:

- **Runtime (this PR):** the whole refusal path from `null` onwards, through the real build, real
  routing, the real proxy and real action dispatch. That is what the deleted proofs covered.
- **Unit (this PR, new):** `session.test.ts` pins that with Clerk configured, an `auth()` answering
  no `userId` makes `getCurrentUser()` return `null`, and that the bypass is consulted before both.
  The `:80` branch is thus proved to reach the same `null`. If a case already exists, it is cited,
  not duplicated.
- **Not done:** real Clerk keys in CI (Alternatives).

**C2. "`webServer.env` can only SET a key, so the config must name the bypass variable, breaking
`test/bypass-is-contained.test.ts`'s pin."** Also true. The fix is to **grow the pin deliberately,
not dodge it.**

- The second server's `env` sets `E2E_SESSION_BYPASS_USER_ID: ''`. An empty value is unset
  (`lib/env.ts:198`; zod's `emptyStringAsUndefined`, `:121`).
- So `playwright.config.ts` joins the pin's allowlist, with its reason.
- The pin **gains** an assertion: in `playwright.config.ts` the variable appears only as a key whose
  value is the empty string. So a config that _arms_ a principal there still fails.

Dodging it (deriving the name, or a launcher that strips `E2E_SESSION_*` by prefix) would satisfy
the pin while defeating its purpose. Rejected.

## Design

- **`apps/web/playwright.config.ts`:** `webServer` becomes an array, with the existing server
  unchanged as the first entry. The second is the **same build**, `next start -p ${SIGNED_OUT_PORT}`,
  with no second `next build`.
  - Its `env` is `{ E2E_SESSION_BYPASS_USER_ID: '' }` plus the same `''` blanks the harnesses already
    give Clerk, Upstash and Sentry (`e2e-local.ts:131-135`), so the stranger server's config matches
    the bypassed one's except for the principal.
  - The port is `E2E_SIGNED_OUT_PORT ?? PORT + 1`.
  - The build step is ordered so the second server only starts after the first finishes building
    (**unverified**: whether Playwright starts array entries in order. The probe: read
    `playwright/lib/plugins/webServerPlugin` at 1.64.1. If they start in parallel, the second command
    waits on the first's health URL instead).
  - A new project, `signed-out`, has `baseURL` on that port, `testMatch: /signed-out\.spec\.ts$/`, and
    no `setup` dependency. The default project's `testIgnore` takes the same spec, so it never runs
    against the bypassed server.
- **`apps/web/e2e/signed-out.spec.ts` (NEW):**
  - **Pages:** enumerate `app/**/page.tsx` as `pages-need-a-session.test.ts` does. Share its route
    helper if it can move to `lib/` or `test/`; otherwise state why it cannot. Skip `PUBLIC_PATHS`,
    `/sign-in` and the design previews.
    - Fill dynamic segments with a fresh UUIDv7: `requireSession()` runs before any param lookup, so
      the id never matters, and a real one would only hide a lookup-before-auth bug.
    - Assert the final URL's path is `/sign-in`.
  - **Action:** capture a real Save POST on the **bypassed** server, as `landing.spec.ts`'s SEC-1
    witness does: `page.route`, the `next-action` id and the body, aborted. Then POST it as-is to the
    signed-out server. Both servers run one build, so the action id is the same (**unverified**; the
    first run settles it, and the spec asserts the id resolves rather than 404s).
    - Expect the typed refusal (`"ok":false`) and no leak (the SEC-1 witness's list).
    - Then, on the bypassed server, a fresh load shows the routine unchanged: no write happened.
  - **Handlers:** a `GET` to each route handler with a fresh id answers 404.
  - **Public paths:** each `PUBLIC_PATHS` entry answers 200 and renders its `<h1>`.
- **`apps/web/test/bypass-is-contained.test.ts`:** `playwright.config.ts` joins the allowlist, and
  the new "empty value only" assertion is added there.
- **`apps/web/lib/dal/session.test.ts`:** the `:80` case, if it isn't already present.
- **`apps/web/scripts/e2e-local.ts`:** nothing, if the config derives the second port. Otherwise it
  passes `E2E_SIGNED_OUT_PORT` from its free-port helper.
- **`.github/workflows/ci.yml`:** nothing: the e2e job runs every project. Confirm the default port
  plus 1 is free on the runner.
- **Docs:**
  - `docs/tech-debt.md`: the row is closed, with what replaced each deleted proof.
  - `e2e/landing.spec.ts`'s comment and `tech-debt.md`'s Impact paragraph: correct "the in-action
    `requireSession()`" to `enterMutation` → `sessionUserOrNull()` (fact sheet, "claimed but not
    wired" 2).
  - `lib/dal/session.ts:16-19`: the wrong `mutation-entry.ts` path (fact sheet, 3).
  - `docs/definition-of-done.md`'s e2e Speed budget is checked: one more project, one server, no
    second build.
  - A changelog fragment.

## Alternatives considered

- **Real Clerk development-instance keys in CI** (a `CLERK_SECRET_KEY` secret on the e2e job), so the
  signed-out server takes `:80`. **Rejected for now:**
  - it adds a live secret to a job that runs PR code;
  - it makes every e2e run depend on Clerk's network;
  - the runbook (`docs/runbooks.md:143-145`) blanks the keys on purpose;
  - and, from C1, it buys proof of one branch the unit case already proves.

  If the maintainer wants the `:80` branch at runtime too, this is the follow-up. **Q1 below.**

- **A launcher script that strips the variable by prefix:** it defeats the containment pin's
  purpose (C2).
- **Re-adding a gate in front of the app for tests:** it would test the gate, not the app.
- **One server, with the bypass switched per request** (a header): it turns the bypass into a
  runtime toggle reachable by request, a security regression. Rejected.

## Risks / rollback

- **The second server is a second process holding the same database.** It reads only; the action
  under test is refused before any write. Proof 2 asserts no write happened.
- **CI time:** one more `next start` and a few requests, with no second build. Measured in the PR.
- **Port collision on a developer's machine:** `e2e-local` already picks free ports.
- **Rollback:** revert. No migration, no data, no production code beyond comments.

## Out of scope

- The `:80` branch at runtime (Q1).
- The design previews' own access rule.
- `ai-1-nl-logging.md`'s spend argument: it may cite this suite again once this lands, but that plan
  is its owner's to amend.

## For the maintainer

- **Q1. Is "runtime proof from `null` onward, plus a unit proof that a configured Clerk with no
  session reaches `null`" enough? Or do you want the configured branch at runtime too,** which needs
  development-instance Clerk keys as a CI secret on the e2e job? Recommended: **enough**, for the
  reasons in Alternatives. Revisit when SEC work puts keys in CI for another reason.

## Review-response log

_(empty until the panel runs)_
