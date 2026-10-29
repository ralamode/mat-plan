# AUTH-1 chunk 1c-3a — the test session seam

**Backlog:** `AUTH-1` ([plan](./auth-1-clerk-google.md)) · **Milestone:** [beta-1](../milestones/beta-1.md)
**Status:** DRAFT — revised once by a security panel; scope panel pending. No implementation code committed.

## Acceptance

From `auth-1c-pre-login-seam.md`'s reassignment table: _"the session bypass, its env var, its guard"_
→ **1c**. Done when:

- `pnpm e2e:local`, **CI's `e2e` job** and `pnpm --filter web screenshot:ephemeral` can all reach a
  page that calls `requireSession()` with no Clerk keys set. ⚠️ The _egress_ half is proved by
  `apps/web/e2e/theme.spec.ts:211`, which this chunk does not exercise — §6 is what keeps that
  assertion true, and the proof itself lands with the first converted page in 1c-3b.
- The bypass is **inert** without its env var, and a deployment that carries it **fails to boot**
  rather than serving requests.
- A committed guard proves exactly one request-tree module reads it.
- Nothing a visitor sees changes. No call site is converted in this chunk.

## Why this is its own chunk — size, not necessity

⚠️ **An earlier draft argued the split was forced** ("the evidence loop breaks in the commit that
ships the control"). **That is wrong, and the scope panel caught it:** `screenshot:ephemeral` runs
from the working tree, so the seam and the Sign-out button in one PR would produce working
screenshots. The seam was also already assigned to **1c** by
`auth-1c-pre-login-seam.md:50`, so splitting it out is a preference, not an obligation.

The honest argument is **size and one concern**. 1c-3 whole is 4 pages × `requireGatedPage` →
`requireSession`, 7 action sites, a new Sign-out control with tests and three-width screenshots, the
`proxy.ts` loop fix the UX panel found, `NO_HOUSEHOLD_COPY.notYet`'s deletion,
`pages-are-gated.test.ts`'s regex switch, and `data-inventory.md` §7/§8 — roughly **900 insertions**
against 1c-1's 599 and 1c-2's 566. It is also two concerns: _a test seam_ and _moving the auth
boundary_.

This chunk follows 1c-1's shape exactly — **ship the mechanism dark and unit-proved, convert the
consumers in the next PR.**

🔴 **And it carries 1c-1's weakness too, stated rather than footnoted.** The seam's real proof only
exists once a page calls `requireSession()`, which is 1c-3b. This chunk's acceptance is therefore
unit-level, and _"acceptance could not fail"_ is exactly the defect that withdrew 1c-pre's first
draft (`auth-1c-pre-login-seam.md:104`, B4). The mitigation is that the three refusal cases in the
Test plan **can** fail and are proved by mutation; what cannot be proved here is the integration,
and the plan says so instead of implying otherwise.

## 🔴 The decision this plan exists to make: NOT `@clerk/testing`

| Finding                                                                  | Why it rules out the Clerk-credentials path here                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No OAuth strategy** (`password \| ticket \| phone_code \| email_code`) | The instance is Google-only. The only path needs a fixture user **plus a secret key that can mint a session for any user in the instance** — confirmed from pinned source: `@clerk/backend@3.23.2`'s `TestingTokenAPI` posts to `/testing_tokens` through `AbstractAPI`, i.e. it requires `CLERK_SECRET_KEY`. |
| **A lit `e2e` job destroys `theme.spec.ts:211`**                         | That zero-egress assertion is **one-way**: once `connect-src` names the Frontend API, a live egress produces zero violations _by construction_.                                                                                                                                                               |

⚠️ An earlier draft of this table also claimed Clerk's testing token "travels as a query parameter,
which a trace records". **That is a README-level claim and `@clerk/testing` is not installed**, so it
is dropped rather than left resting on nothing. The two rows above carry the decision on their own.

## Design

### 1. The var is declared, validated, and read like every other env var

`apps/web/lib/env.ts:9-10` claims to be _"the single place `process.env` is read"_, and a grep across
`lib`, `app` and `components` confirms it holds at 100% today. The bypass does not break that.

```ts
// lib/env.ts, server block
E2E_SESSION_BYPASS_USER_ID: z.string().regex(/^user_[A-Za-z0-9]+$/).optional(),
```

The regex is load-bearing, not hygiene: `emptyStringAsUndefined` plus a shape turns `' '` into a boot
refusal. Without it a whitespace principal becomes the Redis key in `checkMutationLimit(userId)`
(`lib/rate-limit.ts:144`) and, at 1c-4, the `membershipHousehold(clerkUserId)` lookup.

### 2. 🔴 The gate is a POSITIVE proof of "local throwaway", not a negative probe for Vercel

**The first draft of this plan was wrong, and wrong in a way this repo has already paid for.** It
gated on `if (process.env.VERCEL) throw`, asserting that `VERCEL=1` is set on every Vercel
deployment. It is not. `packages/shared/src/db-environment.ts:24-29`:

> `VERCEL_ENV` is a Vercel _system_ environment variable, **gated on the project's "Enable access to
> System Environment Variables" toggle** — so a rule keyed only on `VERCEL_ENV` would silently no-op
> if that toggle were ever off, leaving exactly the hole OPS-1 exists to close.

So the first draft was **default-OPEN**: toggle off → no throw → `getCurrentUser()` returns the
synthetic principal ahead of `clerkIsConfigured()` for every unauthenticated request. Between 1c-3b
and 1c-4 that reaches the one live household — two minors' logged bodyweight.

🔴 **The maintainer's "a short outage is cheap" does NOT reach this one, and the distinction is the
whole reason §2 and §3 are separate sections.** §3 trades on _availability_, which is now priced near
zero. **This is `confidentiality`:** a default-open bypass does not take the app down, it hands a
stranger a household's data while everything looks healthy. No tolerance for downtime buys any of it,
and the gate stays a positive proof.

OPS-1 solved this by keying off **database locality**, and the helper is already exported:

```ts
const bypassAllowed =
  !process.env.VERCEL_ENV &&
  !process.env.VERCEL && // belt, never the only strap
  isLocalDbHost(process.env.DATABASE_URL ?? ''); // @mat-plan/shared, pure, zero-dep
```

Both harnesses already prove locality to themselves — `scripts/e2e-local.ts:72` (`assertLocalDbUrl`)
and `scripts/screenshot-ephemeral.ts:953` (`assertDbTargetAllowed`) — and OPS-1 makes "production
with a local `DATABASE_URL`" impossible. The `VERCEL*` checks stay as a second belt precisely because
they can silently vanish.

### 3. 🔴 The refusal happens at BOOT, not per request

A request-time throw lets the mis-wired deployment **build green and promote**. It is then live, in
DNS, bypass armed — and the failure is only discovered by whoever happens to hit a gated route,
rather than by the deploy that caused it.

⚠️ **This is not an availability argument.** _(Maintainer, 2026-10-29: nobody uses the app yet, not
even the household's own athletes, so a short outage is cheap and should not buy complexity.)_ The
reason boot beats request here is **attribution, not blast radius**: a build-log failure names the
deployment that introduced it, at the moment it was introduced. It also costs nothing — the same
check, in a module that already runs one.

`apps/web/lib/env.ts:117` already runs `assertDatabaseEnvironment(...)` unconditionally at module
scope, deliberately outside `SKIP_ENV_VALIDATION`, and `db-environment.ts:108-112` says why: a
module-import throw becomes a **build-log failure**, so the deployment never serves a request.

So the refusal joins it there: _the var is set and `bypassAllowed` is false → throw at import_. The
per-request code in `session.ts` is then a pure `if (bypassAllowed && id) return { userId: id }` with
no production-only branch at all.

**On the DoS objection — moot twice over.** Anyone who can set a Vercel env var already holds deploy
access and, per `.github/scripts/check-preview-isolation.mjs:17-21`, a Vercel token has **no
read-only scope**: it _"can decrypt every production environment variable in the project and create
deployments"_. And the maintainer has priced downtime at roughly zero for now. Keep the throw; do not
soften it to `return null`.

### 4. Containment: one equality assertion, on the helper 1b-bis already extracted

⚠️ `apps/web/test/source-scan.ts` is 1b-bis's actual output — `code()` (`:23`), `appSources()`
(`:59`), `WEB_DIR` (`:20`) — and its docblock says why: _"`code()` lands here because the same helper
had **five** copies … AGENTS.md makes the second occurrence the trigger to extract."_ This guard
**uses it** rather than cloning a sixth copy.

```ts
const namers = appSources().filter((f) => /E2E_SESSION_BYPASS_USER_ID/.test(code(f)));
expect(namers.sort()).toEqual([
  'lib/dal/session.ts',
  'lib/env.ts',
  'scripts/e2e-local.ts',
  'scripts/screenshot-ephemeral.ts',
]);
```

**One assertion, not two.** An earlier draft had an equality set _and_ a separate "no `app/`,
`components/` or `packages/` file names it" negative. Exact equality over all sources already implies
the negative, and two assertions for one invariant is how one of them quietly weakens.

It also needs, from the precedents: a **re-export / alias check** (`scope.test.ts:105-119`) —
otherwise `export const bypassId = env.E2E_SESSION_BYPASS_USER_ID` lets a second module read the
principal while the guard stays green — plus the **dead-entry `existsSync`**
(`pages-are-gated.test.ts:242-244`) and the **non-vacuity floor** (`scope.test.ts:84-87`).

⚠️ **Two limits, named rather than papered over.** `appSources()` is rooted at `apps/web`, so it
covers both harness scripts and **not** `.github/workflows/ci.yml` — that needs its own glob, stated
deliberately instead of letting the glob decide. And `process.env[dynamicKey]` or a split string
literal defeats any source scan; §3's boot assertion is what actually contains that, because a second
reader still passes through one validated declaration.

### 5. Four injectors, not two — and CI is the one the first draft missed

| Injector                          | How                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/e2e-local.ts`            | beside the DB URL and gate password it already injects                                                                                                                                                                                                                                                                                         |
| `scripts/screenshot-ephemeral.ts` | same                                                                                                                                                                                                                                                                                                                                           |
| **`.github/workflows/ci.yml`**    | 🔴 CI does **not** go through `e2e-local.ts`: `ci.yml:487` runs `pnpm --filter web e2e` directly with a **job-level** env block at `:388-393`. Inject **step-level**, per this repo's own rule at `ci.yml:266-270` (_"Step-level, never job-level: … a job-level one would leak"_) — a job-level var is in reach of `actions/upload-artifact`. |
| `apps/web/.env.example`           | documented, mirroring the `ALLOW_LIVE_DB` block's _"must NEVER be set in a Vercel scope"_ note                                                                                                                                                                                                                                                 |

**The value is a fixed, obviously-fake constant** (e.g. `user_00000000000000000000000e2e`), the
`E2E_LOCAL_GATE_PASSWORD` idiom (`e2e-local.ts:54-57`: _"low-entropy on purpose — a random-looking
placeholder trips gitleaks"_). 🔴 **It must never be a real Clerk id**: that would be personal data
committed to a public repo (AGENTS.md → privacy, a P0), would collide with that person's real
`mat-plan:mutate:<id>` bucket, and under a §2 failure would resolve a **real household** rather than
degrading to the no-household screen.

### 6. The harnesses must BLANK third-party env, or the acceptance criterion is false

Both scripts spread `...process.env` and remove nothing (`e2e-local.ts:96-102`,
`screenshot-ephemeral.ts:966-971`), and `next start` additionally loads `.env.local` — which
`lib/env.ts:64-65` says will hold dev Clerk keys from 1c onward. So "no Clerk keys, no egress" is
currently a property of _whatever is in `.env.local`_, not of the harness, and
`e2e/theme.spec.ts:237-241` would go **red locally** the moment those keys exist.

So the injected env explicitly blanks `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `SENTRY_DSN`. That also stops `e2e:local`
reaching the real Upstash (real quota, and a stable synthetic id accumulating toward 120/5m once
1c-3b wires the limiter) and the real Sentry.

### 7. Inject into `next start`, not `next build`

`playwright.config.ts:39` runs `build && next start` and both halves inherit the env. With the bypass
short-circuiting ahead of `auth()`, Next's prerender-bailout signal is never raised — and
`session.ts:60-73` exists precisely to preserve it. A gated page could then be **statically
prerendered with a principal baked in** under the harness while production renders it dynamically:
the harness would prove a shape production never takes, which is the same objection §1 raises against
a boolean flag, turned on this design.

⚠️ Related: `screenshot-ephemeral.ts:972` reuses an existing `.next` unless `--build`. A `.next` built
without the bypass and served with it captures the signed-out shell — silently wrong evidence.

**Named test obligation for 1c-3b** (not settleable here): assert the page calling `requireSession()`
is **not** in `.next`'s prerender manifest.

### 8. `sessionLogin()` is retracted, not implemented

`e2e/login.ts:17-27` promises it. An env-level bypass authenticates **every** request in the run, so
a per-page helper would do nothing — worse than no helper. The docblock is corrected here.

### Out of scope

No call site converts. No `requireGatedPage` → `requireSession`, no proxy change, no Sign-out button,
no `@clerk/testing`, no CI secret, no lit smoke. Those are 1c-3b and a later row.

## File-by-file changes

| Path                                                    | Change | Why                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/env.ts`                                   | EDIT   | Declare `E2E_SESSION_BYPASS_USER_ID` with its regex (§1) **and** the boot refusal beside `assertDatabaseEnvironment(...)` (§3). This module is the one place allowed to read `process.env`.                                                                                 |
| `apps/web/lib/dal/session.ts`                           | EDIT   | The bypass itself: `if (bypassAllowed && id) return { userId: id }` ahead of `clerkIsConfigured()`. No production-only branch — §3 moved it to boot.                                                                                                                        |
| `apps/web/lib/dal/session.test.ts`                      | EDIT   | The three refusal cases + "var absent → `auth()` still called" + "var present → `auth()` never called". The file exists (~150 lines); no new test file.                                                                                                                     |
| `apps/web/test/bypass-is-contained.test.ts`             | NEW    | §4's single equality assertion on `appSources()` + `code()`, plus the re-export, dead-entry and non-vacuity checks, plus its own `.github/workflows` glob.                                                                                                                  |
| `apps/web/scripts/e2e-local.ts`                         | EDIT   | Inject the var; **blank** the Clerk/Upstash/Sentry vars (§6).                                                                                                                                                                                                               |
| `apps/web/scripts/screenshot-ephemeral.ts`              | EDIT   | Same, at the server-child env object (`:966-971`). ⚠️ Inject into `next start` only, not the build (§7).                                                                                                                                                                    |
| `apps/web/e2e/login.ts`                                 | EDIT   | Retract the `sessionLogin` promise (§8). 🔴 **Keep the other half of that docblock** — 1c-pre panel finding B8, _"never a combined `login()`"_, is what keeps `@clerk/testing` out of `capture.ts`'s module graph and is load-bearing for this plan's own offline property. |
| `.github/workflows/ci.yml`                              | EDIT   | **Step-level** env on the Playwright smoke step (§5). A workflow change, so `actions:check` runs with `--resolve`.                                                                                                                                                          |
| `apps/web/.env.example`                                 | EDIT   | Document it, mirroring the `ALLOW_LIVE_DB` block's _"must NEVER be set in a Vercel scope"_.                                                                                                                                                                                 |
| `.github/scripts/check-preview-isolation.mjs`           | EDIT   | Add to `FORBIDDEN_ANYWHERE` (`:72`). Out-of-band detection, **not** a substitute for §2/§3.                                                                                                                                                                                 |
| `docs/milestones/beta-1.md`                             | EDIT   | The canonical chart gains `1c-3a`/`1c-3b`, and the ordering row at `:118` splits — the `data-inventory.md` Upstash obligation and the `notYet` deletion stay with **3b**, which is what keeps 3a's "nothing a visitor sees changes" honest.                                 |
| `docs/roadmap.md`                                       | EDIT   | `:54` still says "split four ways … Now: `1c-3`".                                                                                                                                                                                                                           |
| `docs/status.md`                                        | EDIT   | `:29` still says "`1c-3` call sites + sign-out".                                                                                                                                                                                                                            |
| `docs/changelog/<date>-feat-auth-1c-3a-session-seam.md` | NEW    | `status:check`.                                                                                                                                                                                                                                                             |
| `docs/plan.md`                                          | EDIT   | Link this plan from the `AUTH-1` row.                                                                                                                                                                                                                                       |

**≈15 files, ≈350–450 insertions**, most of it prose. Over AGENTS.md's 400-line target and inside the
repo's actual practice (1c-1 = 599/8 files, 1c-2 = 566/19); the code surface is ~40 lines.

## Open questions

1. **Does `1c-3b` need `force-dynamic` on the four converted pages?** §7 raises it; it cannot be
   settled without that chunk's code. Carried as a named test obligation, not a decision.
2. **Where does the lit smoke live, if ever?** `@clerk/testing` stays deferred. The row that adopts it
   must solve the Google-only instance problem (a fixture user + an instance-wide session-minting
   key) and run **outside** the PR-triggered job, or `theme.spec.ts:211` dies.

## Alternatives considered and rejected

| Option                                                                                                                             | Rejected because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@clerk/testing` + a CI secret                                                                                                     | The two verified rows above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A **build-time flag**, dead-code-eliminated from the production artifact                                                           | Genuinely safer on blast radius — the bypass would not exist in the production bundle. **Rejected on artifact parity:** the harness builds the same `next build`, and `screenshot-ephemeral.ts:972` reuses `.next`, so the thing photographed would no longer be the thing shipped. Recorded rather than dismissed; revisit if §2's gate ever proves insufficient.                                                                                                                                                                                                                                    |
| A forged `__session` cookie the app trusts                                                                                         | Still a bypass, but spread across cookie parsing and verification — larger blast radius than one validated env read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Mock `lib/dal/session.ts` in Playwright                                                                                            | `playwright.config.ts:39` spawns a **built server process**; there is no module to substitute. This is why 1c-pre's first draft failed — it planned the minting and never the accepting.                                                                                                                                                                                                                                                                                                                                                                                                              |
| A test-only Route Handler                                                                                                          | **Strictly worse.** AGENTS.md makes every Route Handler a public endpoint, so it adds a surface _and_ still needs the same env gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **No env var at all:** `!clerkIsConfigured() && isLocalDbHost(DATABASE_URL)` → synthetic principal from a `lib/constants.ts` const | **The smallest possible path** — zero env vars, zero script injection, no `ci.yml` change, and the guard collapses to a constant. Rejected because it makes the bypass **implicitly armed**: it fires on any deployment that happens to have no Clerk keys and a local-looking DB, and nothing in the deployment's configuration records that an auth bypass is live. An explicitly-set variable is auditable from `vercel env ls` and from `preview:check`; an implicit one is only auditable by reading the source. Recorded because it is genuinely cheaper and a future reviewer will propose it. |
| Skip the gated specs until 1d                                                                                                      | Deletes the only automated a11y coverage of the picker and Today during the chunks that change them most.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Risks / rollback

| Risk                                                 | Mitigation                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 🔴 It is an authentication bypass in production code | Positive local-DB gate (§2), boot refusal (§3), validated shape (§1), two-layer guard (§4), fake-constant value (§5). |
| The gate's premise is wrong again                    | §2's premise is now an in-repo invariant OPS-1 already enforces, not a vendor behaviour read from docs.               |
| A reviewer softens the throw to `return null`        | A comment is not a guard: a **test** asserts the refusal, listed below.                                               |
| Rollback                                             | Revert; nothing depends on it until 1c-3b.                                                                            |

## Test plan

- `session.test.ts` / `env` boot tests, the three cases that matter — var set + `VERCEL_ENV=production` → **refuse**; var set + no `VERCEL*` + **non-local** `DATABASE_URL` → **refuse**; var set + local `DATABASE_URL` → bypass. Only the third may pass.
- Var absent → the `auth()` path is unchanged and `auth()` is still called.
- Var present → that principal, and `auth()` **never** called.
- The containment guard, with a probe proving RED for a second reader _and_ for a re-export.
- `pnpm e2e:local` green; `screenshot:ephemeral /p --state no-household` still captures.
- `pnpm preview:check` gains `E2E_SESSION_BYPASS_USER_ID` in `FORBIDDEN_ANYWHERE`
  (`check-preview-isolation.mjs:72`) — out-of-band detection, **not** a substitute for §2/§3.
- ⚠️ The seam's real proof only exists in 1c-3b, when a page actually calls `requireSession()`. This
  chunk says so rather than claiming coverage it cannot have.

## Review-response log

### Security panel (round 1) — 4 BLOCKING, 4 SHOULD

| #   | Critique                                                                                                                                                                                                    | Verdict      | Resolution                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| B1  | `process.env.VERCEL` is the _system-env-exposed_ indicator, gated on a dashboard toggle — the bypass was default-OPEN on a real Production deployment, and `db-environment.ts:24-29` already documents this | **accepted** | §2 rewritten to a positive `isLocalDbHost` proof; verified the citation in-repo before accepting |
| B2  | A request-time throw lets the bad deployment promote and serve a half-outage                                                                                                                                | **accepted** | §3: boot assertion in `lib/env.ts`, the `assertDatabaseEnvironment` pattern                      |
| B3  | The guard is evadable (re-export, `packages/`, `next.config.ts`, workflows) and weaker than both precedents                                                                                                 | **accepted** | §4 rebuilt on `scope.test.ts`'s two-layer form; `process.env[dynamicKey]` named as a limit       |
| B4  | CI is a fourth injector and `ci.yml`'s env block is job-level                                                                                                                                               | **accepted** | §5                                                                                               |
| S5  | Unvalidated `process.env` read breaks a 100%-held invariant; `' '` is truthy                                                                                                                                | **accepted** | §1                                                                                               |
| S6  | The _value_ is a control, not hygiene — a real Clerk id would be a P0                                                                                                                                       | **accepted** | §5                                                                                               |
| S7  | The harnesses inherit `...process.env`, so the "no Clerk keys" claim is false                                                                                                                               | **accepted** | §6                                                                                               |
| S8  | Injecting into `next build` suppresses the dynamic bailout                                                                                                                                                  | **accepted** | §7 + a named obligation for 1c-3b                                                                |
| —   | The `@clerk/testing` query-param row was unverified                                                                                                                                                         | **accepted** | Row dropped; the decision rests on two verified rows                                             |

### Scope panel (round 1) — 3 BLOCKING, 5 SHOULD

B1 (CI is an uninjected fourth site) and B2 (`VERCEL` is toggle-gated) were raised independently by
both panels and are resolved in §5 and §2. B3 (the boot assertion `auth-1c-pre-login-seam.md:114`
hand-delivered, which the first draft silently dropped) is §1 + §3.

| #   | Critique                                                                                                                                    | Verdict      | Resolution                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| S4  | "Why this is its own chunk" is a non-sequitur — `screenshot:ephemeral` runs from the working tree, so the split is a preference, not forced | **accepted** | Section rewritten to the size/one-concern argument, and the "acceptance cannot fail here" trade owned rather than footnoted |
| S5  | The template's File-by-file table and Open questions were missing — and the table is what would have caught B1                              | **accepted** | Both added                                                                                                                  |
| S6  | `roadmap.md:54`, `status.md:29` and `beta-1.md:86,100,118` all still say "four ways" and the plan moved none of them                        | **accepted** | All four in the file table; `beta-1.md`'s obligations row splits 3a/3b                                                      |
| S7  | The guard should reuse `apps/web/test/source-scan.ts` (1b-bis extracted it to stop a _sixth_ copy) and assert **once**                      | **accepted** | §4 rewritten; the redundant negative cut; `appSources()`'s `apps/web` root named as a limit                                 |
| N8  | The `sessionLogin` retraction must preserve the docblock's B8 half                                                                          | **accepted** | Called out in the file table                                                                                                |
| —   | Acceptance asserted "no network egress to Clerk" and proved it nowhere                                                                      | **accepted** | Clause now cites `theme.spec.ts:211` and says the proof lands in 1c-3b                                                      |
| —   | A cheaper no-env-var alternative was not considered                                                                                         | **accepted** | Added to Alternatives, with the auditability reason it loses on                                                             |

### ID-1's six keep-open items (`docs/plan.md:1163` binds every auth chunk from 1c on)

| #   | Item                                                                      | This chunk                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **The principal is a login, never a profile**                             | ✅ Held, and it is the reason §1 shapes the var as `user_…`: the synthetic principal is a **login-shaped id**. No column ties a profile to a login; nothing here touches `profiles`. |
| 2   | Every access decision still goes through `getHouseholdScope()`            | ✅ Untouched — this chunk supplies a principal and resolves no household.                                                                                                            |
| 3   | **State D (two memberships throws) is a Beta 0 invariant, not the model** | ✅ Held. The bypass returns one principal and asserts nothing about how many households it may reach; §2's gate is about _locality_, not cardinality.                                |
| 4   | Nothing pins an athlete to a household                                    | ✅ No key, index or cache key added.                                                                                                                                                 |
| 5   | No age-based permission logic                                             | ✅ None.                                                                                                                                                                             |
| 6   | Household roles stay a shared const + CHECK                               | ✅ Untouched.                                                                                                                                                                        |
