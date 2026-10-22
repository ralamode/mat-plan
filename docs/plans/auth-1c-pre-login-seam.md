# AUTH-1 1c-pre — the login seam, and where the rest of this chunk went

**Status:** Rewritten after a five-lens panel · **Date:** 2026-10-22 · **Chunk of:**
[auth-1-clerk-google.md](./auth-1-clerk-google.md) § Design 10 · **Branch:** `test/auth-1c-pre-login-seam`

> **This is the second draft, and it is a tenth of the size of the first.** The first proposed a
> test-only session bypass, `@clerk/testing` in CI, a membership row in the ephemeral fixture and a
> combined `login()` helper — eleven paths across three packages plus CI. **A five-lens panel found
> that none of it could be built or proved yet**, and that two parts of it would have done damage.
> What survives is the one piece that is genuinely pre-1c work: **a module name that is true in all
> three worlds.** Everything else is reassigned below, to the chunk that can prove it.

## Goal

`global.setup.ts` and `capture.ts` authenticate by driving the real gate form, through one shared
module. That shape is already right. The only thing wrong with it is the **name**: at 1c the module
also holds the session half, and at 1d the gate half is deleted, so `gate-login.ts` is a lie in two of
the three worlds. Renaming it now costs two import lines; renaming it inside 1c's one-way-door PR
costs attention there, and inside 1d costs a second rename.

## Acceptance

- `apps/web/e2e/gate-login.ts` → `apps/web/e2e/login.ts`; the export stays `gateLogin`, because that
  is what it drives.
- **Done when** `pnpm verify` is green — specifically `skills:check`, which **fails on this rename**
  unless the two files that cite the old path by name are updated in the same commit.
- **Done when** the module's docblock records the naming rule and the "two explicit halves, never a
  combined `login()`" decision, so 1c does not re-derive either.
- **No behaviour changes.** No new dependency, no new env var, no CI change.

## File-by-file changes

| Path                                                                                                     | Change | What & why                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/gate-login.ts` → `apps/web/e2e/login.ts`                                                   | RENAME | A name true in all three worlds. Docblock records why, and records 1c's shape.                                      |
| `apps/web/e2e/global.setup.ts`, `apps/web/scripts/capture.ts`                                            | EDIT   | The two code importers, one line each.                                                                              |
| `apps/web/e2e/contexts.ts`, `apps/web/scripts/screenshot.ts`, `apps/web/scripts/screenshot-ephemeral.ts` | EDIT   | Prose mentions in docblocks.                                                                                        |
| `.claude/skills/ui-screenshot/SKILL.md`                                                                  | EDIT   | 🔴 **Cites the path backticked, so `check-skills.mjs` fails the rename** — in `pnpm verify` **and** CI's `quality`. |
| `AGENTS.md`                                                                                              | EDIT   | Also cites it. Outside the guard's scan, so it would have gone stale **silently**, which is worse.                  |
| `docs/plans/auth-1-clerk-google.md`                                                                      | EDIT   | § Design 10 and the 1c-pre row, to record the reassignment below; and `0015` → `0019`.                              |

## 🔴 Where the rest of the chunk went, and why it could not stay

The panel's convergent finding: **the first draft planned the minting of a session and never the
accepting of one.** A fixture script can set any cookie; unless app code trusts it, `requireSession()`
rejects it. The trusting module lands in `apps/web/lib/` — and **does not exist until 1c creates it**.

| Obligation                                      | Blocked on                                                                          | Reassigned to                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| the session bypass, its env var, its guard      | **1c** — there is nothing to bypass before `requireSession()` exists                | **1c**                          |
| the membership row in the ephemeral fixture     | **1b** — neither `household_members` nor `insertHouseholdMember` exists in the tree | **1b**                          |
| `@clerk/testing`, the CI secret, `clerkSetup()` | a Clerk dev instance **and** a repo secret; dead code until 1c                      | **its own row, at or after 1c** |

### Four findings the reassigned work must carry with it

Recorded here because each was expensive to find and none is visible from the rows above.

1. 🔴 **`scope.test.ts` cannot prove an auth bypass.** The first draft cited `FIXTURE_DERIVES_SCOPE` and `WEB_REQUEST_TREE` as the bypass's containment proof. That file asserts only where `householdScopeForRequest` / `householdScopeForScript` / `makeHouseholdScope` appear — it is a **tenancy** guard. Its fence also excludes `apps/web/proxy.ts`, where `clerkMiddleware()` is composed. **1c owes the bypass its own guard**, on the comment-stripped source-scan idiom 1b-bis established.
2. 🔴 **Clerk keys in the `e2e` job would destroy the "1a ships dark" proof.** [`theme.spec.ts:211`](../../apps/web/e2e/theme.spec.ts) asserts **zero Clerk egress**, failing with _"1a ships dark is false"_. Its own docblock says this is **one-way**: once `connect-src` names the Frontend API, a live egress produces zero violations by construction, so the assertion can never catch it again. A lit smoke therefore belongs in a **separate job**, not in the PR-triggered one.
3. 🔴 **A lit `e2e` job would turn the public failure artifacts into a credential leak.** `ci.yml` uploads `test-results` with `trace: 'on-first-retry'` and 7-day retention, on a **public** repo; Clerk's testing token travels as a **query parameter**, which a trace records. Today the only credential a trace can hold is the placeholder gate password.
4. ⚠️ **`clerkSetup()` reads `apps/web/.env.local` by default** (`dotenv: true` at `@clerk/testing@2.2.49`), so an unguarded call from Playwright's global setup would authenticate against whatever instance that file names — defeating the env isolation `e2e:local` exists to provide. Whoever adds it passes `dotenv: false` and pins that with a test, because it is a vendor default.

⚠️ **And `@clerk/testing`'s programmatic sign-in has no OAuth strategy** — only `password | ticket | phone_code | email_code`. On a Google-only instance the only path needs a **pre-existing fixture user** plus a secret key able to mint a session for **any** user in the instance. That is a decision for the row that adopts it, not an implementation detail.

## Test plan

`pnpm verify`. The rename's only real gate is `skills:check`, which is **proved by the change itself**:
it goes red on the rename without the two citing edits, and green with them. Nothing else about the
suite changes, which is the point — a rename that altered behaviour would be a different PR.

## Risks / rollback

| Risk                             | Mitigation                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A rename that misses an importer | `tsc --noEmit` catches code; `skills:check` catches cited paths; a `gate-login` grep across `apps/web`, `.claude/` and `AGENTS.md` returns nothing. |
| The name is wrong again at 1d    | It is not: `login.ts` is accurate with the gate, with both, and with only the session. That is why this name and not `session-login.ts`.            |
| Rollback                         | Revert the PR. No behaviour, no dependency, no env.                                                                                                 |

## Out-of-scope / deferred

Everything in the reassignment table. Also: `capture.ts` still imports `isUngatedPath` from
`lib/access-gate`, which dies at 1d — swapping it for `isPublicPath` changes whether `/gate` captures
attempt a login first, so **1d decides it**, not this PR.

## Open questions

None. The three the first draft carried were all settled by the panel: the combined `login()` is
rejected on evidence (it would drag `@clerk/testing` into the offline screenshot path); `storageState`
is written immediately after login and before the warms, so the warm cannot corrupt it; and the
vendor-side fixture-user question moves to the row that adopts `@clerk/testing`.

## Review-response log (adversarial panel)

### Five lenses, round 1 (2026-10-22) — correctness · scope · architecture · reuse · security

**21 BLOCKING raised across five lenses; the draft was withdrawn rather than patched.** Every finding
below was re-verified against the code before being accepted.

| #   | Lens                                          | Critique                                                                                                                                                                                        | Verdict                       | Resolution                                                                                                                                                                                                |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | security · architecture · correctness · reuse | The file table has no row for the module that **accepts** the minted session; it necessarily lands inside `WEB_REQUEST_TREE`                                                                    | **accepted**                  | The whole bypass moved to 1c. It cannot be planned where it cannot be built.                                                                                                                              |
| B2  | all five                                      | Bar 2 cited a **tenancy** guard as an **auth** containment proof; all three bars would have passed vacuously                                                                                    | **accepted**                  | Recorded as finding 1 above; 1c owes the bypass its own guard.                                                                                                                                            |
| B3  | correctness · reuse · scope                   | `insertHouseholdMember` and `household_members` **do not exist**; 1b has not landed                                                                                                             | **accepted**                  | Membership row reassigned to 1b. Two of four acceptance bullets were unimplementable as written.                                                                                                          |
| B4  | scope                                         | Acceptance **could not fail**: pre-1c the gate authenticates in both arms, so a working session mint is indistinguishable from a no-op                                                          | **accepted**                  | The new acceptance is `skills:check`, which the change itself proves red-then-green.                                                                                                                      |
| B5  | security                                      | Clerk keys in the `e2e` job delete `theme.spec.ts`'s dark-egress proof, irreversibly                                                                                                            | **accepted**                  | Finding 2. The lit smoke needs its own job.                                                                                                                                                               |
| B6  | security                                      | The public artifact upload + `trace: 'on-first-retry'` makes the testing token a leak                                                                                                           | **accepted**                  | Finding 3.                                                                                                                                                                                                |
| B7  | security                                      | `clerkSetup()` defaults to reading `.env.local`; no OAuth sign-in strategy exists                                                                                                               | **accepted**                  | Finding 4, from the pinned source rather than the README.                                                                                                                                                 |
| B8  | architecture · correctness · reuse · security | A combined `login()` contradicts the split it was meant to serve and breaks the offline guarantee                                                                                               | **accepted**                  | Rejected in the module's own docblock, with the reason, so 1c does not revisit it.                                                                                                                        |
| B9  | architecture · reuse · correctness            | The rename reds `skills:check` via two files the table omitted                                                                                                                                  | **accepted**                  | Both are rows now, and the gate is the acceptance criterion.                                                                                                                                              |
| S1  | scope                                         | Split-by-consumer is two mechanisms where one would do; the keyed smoke buys **one** integration fact at the cost of a secret, a dependency and a network call in the flakiest file in the repo | **accepted**                  | The split decision is withdrawn with the rest. The row that adopts `@clerk/testing` re-argues it on its own merits.                                                                                       |
| S2  | scope · architecture                          | `1c-pre` as scoped may not be a chunk at all — one of its four obligations is pre-1c, and it is mechanical                                                                                      | **accepted, with a pushback** | Accepted in substance: this is now that one obligation. **Pushed back on dropping the document** — the value is the reassignment record and the four findings, which are what stop 1c rediscovering them. |
| S3  | reuse                                         | `migrateAndSeed` is the existing seam for fixture seeding; the draft would have added a parallel path and widened the `apps/web` → `packages/db` surface                                        | **accepted, deferred**        | Carried to 1b, which owns the writer.                                                                                                                                                                     |
| S4  | correctness                                   | Parent plan says migration `0015`; `0015_ten2a_movements_household.sql` is taken                                                                                                                | **accepted**                  | Corrected to `0019` in the parent, in this PR.                                                                                                                                                            |
| S5  | security · scope                              | Bar 1's `preview:check` is **not a gate** — it runs in neither CI nor `verify`, only its parser self-test does                                                                                  | **accepted**                  | Carried to 1c with the bypass; the real bar is an in-app boot assertion beside `assertDatabaseEnvironment`.                                                                                               |

**Not accepted:** the suggestion to delete this document and let the rename ship plan-exempt. The code
change is small enough to qualify, but the panel's own findings would then live nowhere, and 1c would
pay to rediscover four of them. The plan stays; it is short because the work is.
