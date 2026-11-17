# PRIV-3 RC — a guarded correction that creates a household

> Backlog: [plan.md](../plan.md) → `PRIV-3`; the work is chunk **RC** of the
> [CAT-3 spec](../specs/cat-3-movement-library.md) → "Chunks, in order". Branch:
> `docs/priv-3-rc-create-household` (this plan), then `db/priv-3-rc-create-household` (the code).

## Where this sits

- **Pillar:** privacy and operations (`PRIV-3`'s owner). **Milestone:** Beta 0, the fresh start
  before FAM-1's trial week ([CAT-3 spec](../specs/cat-3-movement-library.md) → "The fresh start,
  in order", step 7).
- **This PR:** the one tool that can make a household on purpose. The app cannot create one, and
  the production seed stops writing one at `OPS-2` PR 1. After the fresh start has erased the seeded
  household, this is how the household's adult accounts get a household to sign in to.
- **Next:** R0 (the one-shot erasure of the seeded household, after `PRIV-3` 2a), then R1 (the
  runbook section and step 5's correction), then R2, the fresh start itself, on the maintainer's go.
- **Gated on:** nothing to build. It **must be merged before R2**. It touches two seam files
  (`packages/db/scripts/corrections/registry.ts`, `packages/shared/src/seed-ids.ts`) and the
  `db:verify` seams, so **the FAM-1 board gives it its turn**.

_Roadmap alignment (2026-11-17): advances `PRIV-3` and `CAT-3` chunk RC; answers `ID-1`'s six
keep-open items below (it writes `household_members`); gates R1 and R2; checked against the private
roadmap, nothing else to add._

## Goal

A correction, `create-household-<date>`, that creates one new household with ordinary ids and binds
one or more sign-in accounts to it, in one run and one transaction. It takes **no household id**,
refuses when any account already has a live membership, and prints **counts only**. Two smaller
changes come with it, both owed by the spec: the set of seed ids (`SEED_PUBLIC_IDS`) is created here,
and the existing claim correction learns to refuse one.

## Acceptance

From the spec's RC row, verbatim:

> A guarded `create-household` correction built on `registry.ts` → `householdClaim`'s logic,
> factored out (the account from the environment, its shape check, `fixtureBindIsAllowed`): takes
> **no household id**, mints ordinary ids, binds one or more accounts to the one new household in
> one run, checks inside its transaction that none has a live membership, prints counts only. It
> creates `SEED_PUBLIC_IDS` in `packages/shared/src/seed-ids.ts` (moved here from `PRIV-3` 2b by
> R0), and `householdClaim` itself gains the refusal of any id in it.

Done when:

- `db:correct` lists `create-household-<date>`. Its dry run writes nothing and prints one line: how
  many households it would create (1) and how many accounts it would bind.
- `--apply` creates exactly one `households` row and one `household_members` row per account. Every
  `public_id` is freshly minted, none is in `SEED_PUBLIC_IDS`, and every member's role is `owner`
  (Q1).
- A second `--apply` with the same accounts changes nothing and says so.
- An account that is malformed, is the e2e fixture principal on a non-local database, is listed
  twice, or already has a live membership makes the run **refuse and write nothing**. The refusal
  names positions ("account 2 of 2"), never an id.
- No line of its output, **on any path including a database error**, contains an input account id.
- `household-claim-2026-10-25` refuses a household `public_id` in `SEED_PUBLIC_IDS` on a non-local
  database, while the e2e harness, CI's smoke step and a developer's local claim keep working (D6).
- `db:verify` proves that every household and profile the fixture seed writes is in
  `SEED_PUBLIC_IDS`.

## Design

**D1. Input: the environment only, read through a hidden prompt.** The accounts come from
`CREATE_HOUSEHOLD_CLERK_USER_IDS`, a space-separated list of `user_…` ids, which the runbook's step
fills with `read -rs` and `export`, then `unset`s afterwards. This is the channel `PRIV-3` Q1 settled
for erasure targets _(maintainer, 2026-11-17)_, and the reasoning behind `householdClaim` carries
over: a command line is visible through `ps`, a process's environment only to its owner, and a Clerk
id is a stable third-party account id for a named adult (`data-inventory.md` §1a). There is no flag
and no `--household`: **the correction has no household input at all**, so it cannot be pointed at
the wrong one.

**D2. The checks factored out of `householdClaim`, into a module of their own.** A NEW file,
`packages/db/scripts/corrections/accounts.ts`, holds three pure functions, each with a unit test:

- `parseAccountList(raw)` splits and trims the list. An empty list, or an id listed twice, is a
  refusal.
- `accountIssue(id, position)` returns the reason an id cannot be bound, or `null`: the `user_`
  shape check, then `fixtureBindIsAllowed` (imported from `target-url.ts`, unchanged). Its message
  names the position, never the id.
- `isSeedPublicId(id)` reads `SEED_PUBLIC_IDS`.

`householdClaim` calls `accountIssue` for its shape and fixture checks instead of its inline
`assert` and `if`. Its own messages and its full-id dry-run line stay as they are, because they are
its documented behaviour (rule 9's redaction note covers them), and it gains D6. The new correction
calls the same functions. That is the "factored out" the spec asks for, with one definition of what
a bindable account is.

**D3. One transaction, the check inside it, and a database backstop.** `run` opens one
`db.transaction` (README rule 7). Inside it:

1. It counts the live `household_members` rows whose `clerk_user_id` is in the list. If any exist,
   it branches as D4 says.
2. It inserts the household:
   `{ publicId: newId(), name: HOUSEHOLD_DEFAULT_NAME, synthetic: false }`.
3. It inserts one member per account through `insertHouseholdMember(tx, scope, …)`, the writer
   `householdClaim` uses, with `scope = householdScopeForScript(<the new id>)`.

Two concurrent runs could both pass step 1. The partial unique index on live
`household_members.clerk_user_id` (`schema.ts` → `householdMembers`) then fails the second run with
`23505`, and its transaction rolls back whole. So the check is the readable refusal, and the index
is what makes it true. `db:verify` proves the index refuses a second live membership (it does today,
for AUTH-1). This plan adds no lock.

**D4. A second run: done means "no change", anything partial means refuse.** README rule 2 asks for
re-runs to be no-ops, but this correction has no "value corrected from" to guard on, so the state of
the accounts is the guard:

| What the count finds                                                                                                                       | Result                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| No account has a live membership                                                                                                           | Create (dry run: "would create")                   |
| Every account is a live member of **one** household, that household's live members are exactly these accounts, and its id is not a seed id | `already done: 1 household, N accounts; no change` |
| Anything else (some bound, bound to two households, or a household with other members too)                                                 | Refuse, with counts                                |

Since every write happens in one transaction, the third row cannot come from a half-finished run of
this correction. It means an operator error or another writer, and that must not read like success.

**D5. Output: counts only, and errors stripped of their parameters.** Every line is a count or a
position. The spec requires it (R2: _"prints counts only (no account id, no household id)"_), and
unlike `householdClaim` the operator here has nothing to check an id against except the value they
just typed. ⚠️ **A database error would leak anyway:** drizzle's `DrizzleQueryError` carries the
bound parameters in its message, and `correct.ts` prints a thrown error's message. `PRIV-3` 2b
builds the runner-wide redacted catch for `kind: 'erasure'`, but RC lands before 2b. So `run` wraps
its transaction in a `try`/`catch` that rethrows
`new Error('create-household failed and rolled back: <SQLSTATE or the error class>')`, **without**
`cause`. A unit test throws a `DrizzleQueryError`-shaped error holding an id and asserts that the
rethrown message does not contain it.

**D6. `householdClaim` refuses a seed household id, on a non-local database only.** The spec says
"refusal of any id in it" with no exception, but read literally that **breaks three callers today**.
`linkFixtureMember` (`apps/web/scripts/embedded-pg.ts`), CI's smoke step (`ci.yml`) and the
runbook's developer step all claim `SEED_HOUSEHOLD_PUBLIC_ID` on a local database, on purpose. So the
refusal mirrors `fixtureBindIsAllowed`'s rule: a seed household id may be claimed only when
`isLocalDbHost(correctionTargetUrl())` is true. It is one more pure function in `accounts.ts`, with
its unit tests driving the same environments `target-url.test.ts` uses, the
local-`DATABASE_URL`-beside-production-unpooled case included. In production this means nobody can
bind an account to the seeded household again, before or after the fresh start. Rows that already
exist are unaffected. (Q2 asks the roadmap thread to confirm this reading.)

**D7. `SEED_PUBLIC_IDS`, and the proof that keeps it whole.** The set is added to
`packages/shared/src/seed-ids.ts`: the household and the three profiles, as
`ReadonlySet<string>`, the pattern of `MOVEMENT_SEED_PUBLIC_IDS`. Movement ids stay in their own
set. A `db:verify` case, in `packages/db/scripts/verify/erasure.ts` as a new section, seeds with
fixtures and asserts that every `households.public_id` and `profiles.public_id` the seed wrote is in
the set, so a fourth seeded athlete cannot slip past. A mutation proves it (D9). This is the
assertion `PRIV-3`'s plan put in 2b (2S9); R0 moves the set here, so its proof comes with it.

**D8. The household's name: a fixed, neutral constant.** `households.name` is `NOT NULL` and is read
nowhere in `apps/` or `packages/db/src` (checked: no reader). The seed writes the literal `'Home'`.
This PR makes that the second writer, so the literal becomes `HOUSEHOLD_DEFAULT_NAME = 'Home'` in
`packages/shared/src/seed-ids.ts`, and both writers import it. No name is asked for, so no personal
data is typed in.

**D9. Mutations, from `PRIV-3`'s block (271 onwards, after PR 1's 260–270):**

- 271 `create-skips-the-membership-check`: the count in D3 is removed. The second-run proof goes
  red: it creates a second household.
- 272 `create-binds-as-member`: the role is changed. The role assertion goes red.
- 273 `create-reuses-a-seed-id`: the household `publicId` is set to `SEED_HOUSEHOLD_PUBLIC_ID`. The
  proof that no new id is in the set goes red.
- 274 `seed-ids-forget-a-profile`: a profile is removed from `SEED_PUBLIC_IDS`. D7's proof goes red.
- 275 `create-prints-an-id`: one account id is added to the count line. The "no input id in the
  output" proof goes red.

Each `.expect` names the first assertion it fails, as PR 1's do. D2's, D5's and D6's guards are
unit-tested in vitest, which the mutation gate does not cover.

## File-by-file

| Path                                                     | Change | What & why                                                                                                                                                                          |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/accounts.ts`            | NEW    | `parseAccountList`, `accountIssue`, `isSeedPublicId`, `seedHouseholdClaimIsAllowed`, `redactedFailure` (D2, D5, D6)                                                                 |
| `packages/db/scripts/corrections/accounts.test.ts`       | NEW    | Unit tests for each, including the mixed-environment case and the redaction                                                                                                         |
| `packages/db/scripts/corrections/registry.ts` (**seam**) | EDIT   | `createHousehold` entry (D1, D3 to D5); `householdClaim` calls `accountIssue` and gains D6; both added to `CORRECTIONS`                                                             |
| `packages/shared/src/seed-ids.ts` (**seam**)             | EDIT   | `SEED_PUBLIC_IDS`, `HOUSEHOLD_DEFAULT_NAME` (D7, D8)                                                                                                                                |
| `packages/db/src/seed.ts` (**seam**)                     | EDIT   | `'Home'` becomes `HOUSEHOLD_DEFAULT_NAME`: one line                                                                                                                                 |
| `packages/db/scripts/verify/erasure.ts`                  | EDIT   | The RC section: dry run writes nothing; apply creates 1 and N; second run no change; bound elsewhere refuses and writes nothing; no input id in any line; D7's seed-set proof       |
| `packages/db/scripts/verify.ts` (**seam**)               | EDIT   | AUTH-1 1b's assertion text "the claim correction is the only writer" becomes "the two account corrections are the only writers" (its check is unchanged: the seed writes no member) |
| `packages/db/scripts/mutations/271…275`                  | NEW    | D9, plus the README rows                                                                                                                                                            |
| `packages/db/scripts/corrections/README.md`              | EDIT   | The Applied row (`pending`, with no target, like `household-claim`'s); a note that neither correction's targets are ever recorded                                                   |
| `docs/privacy/data-inventory.md`                         | EDIT   | §1a: a second path writes `household_members.clerk_user_id`, run by the operator, input from the environment, output counts only                                                    |
| `docs/features/erasure.md`                               | EDIT   | The guide that owns `verify/erasure.ts`: the RC section and why it lives there                                                                                                      |
| `docs/plan.md`                                           | EDIT   | `PRIV-3`'s row links this plan                                                                                                                                                      |
| `docs/changelog/<date>-db-priv-3-rc-create-household.md` | NEW    | The fragment                                                                                                                                                                        |

**Why the proofs live in `verify/erasure.ts` and not a sixth module.** The harness ruling for
`PRIV-3` PR 1 set five modules with erasure last, and a sixth needs lane A's agreement. The fresh
start is `PRIV-3`'s, and this correction exists only so that an erased household can be replaced.
The section is headed as such. (The alternative is a `verify/households.ts` module, if lane A would
rather keep `erasure.ts` to deletion.)

## Test plan

- **Unit (vitest):** `accounts.test.ts` covers each function: an empty list; a repeated id; a
  `user_` shape refusal; the fixture principal locally (allowed) and remotely (refused); a seed
  household id locally (allowed) and on production's unpooled URL beside a local `DATABASE_URL`
  (refused); a redacted failure that contains no id and has no `cause`.
- **`db:verify` (PGlite), in `erasure.ts`'s RC section, inside `rolledBack`:** a dry run leaves both
  table counts equal; apply with two fixture-shaped ids creates 1 household and 2 owner members with
  no seed id; a second apply returns "no change"; a third run with one of the two ids plus a new one
  refuses and writes nothing; the line set contains neither input id; D7's seed-set proof.
- **Mutations:** 271 to 275 RED under `pnpm db:mutations`.
- **The harness still claims:** `pnpm e2e:local`, because D6 touches the path `linkFixtureMember`
  takes. CI's smoke step is the second witness.
- `pnpm verify` and `pnpm status:check` before the PR.

## Risks / rollback

- **The correction runs against the wrong database.** It goes through `correctionTargetUrl`, like
  every correction, and its dry run prints the target host (the runner already does). The runbook
  (R1) has the operator read that line before `--apply`. The fixture principal cannot be bound
  remotely (D2).
- **An id leaks into a public log.** Production runs are by hand, never in CI. The output is counts
  only and errors are stripped (D5), and a mutation and a unit test pin both.
- **D6 breaks the e2e harness.** The local exception is the whole design, and `e2e:local` plus CI's
  smoke step prove it before merge.
- **Two runs at once.** The unique index rolls one back (D3).
- **Rollback:** it is a new correction. Revert the PR. A household it already created is deleted by
  `PRIV-3`'s erasure, not by hand.

## Out of scope

- Any app path that creates a household (no backlog row asks for one in Beta 0).
- Inviting or removing a member later, and any role other than `owner` (`COACH-1` gives `member`
  its first caller).
- The runbook section that runs this (R1) and the erasure that comes before it (R0).
- Converting `householdClaim` to flags (`PRIV-3` Q1 settled on the environment).

## Open questions

- **Q1 (the maintainer's, through the roadmap thread):** what role does each account get?
  **Recommended: `owner` for all.** The authority model is "anyone in the household records and
  corrects; the owner decides who belongs to it" (`ID-1`, item 5's note), the app never branches on
  role today, and `member` has no defined meaning until `COACH-1`. The alternative is the first
  account `owner` and the rest `member`, which would give `member` a meaning nobody has designed.
- **Q2 (the roadmap thread's, a reading of the spec):** is D6's local-only exception the intended
  meaning of "refusal of any id in it"? A literal reading breaks the e2e harness, CI's smoke and the
  developer's claim.

## ID-1's six keep-open items

| #   | Item                                                | This plan                                                                                                                                               |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The principal is a login, never a profile           | Binds logins to a household. Writes no profile and ties none to a login                                                                                 |
| 2   | Every access decision through `getHouseholdScope()` | No access decision here: an operator script. The app's resolver is unchanged                                                                            |
| 3   | Two memberships throwing is not the model           | It refuses an account with a live membership because the unique index would anyway. It assumes nothing about one household per person beyond that index |
| 4   | Nothing pins an athlete to a household              | Creates no profile and no `(household_id, profile)` key                                                                                                 |
| 5   | No age-based permission logic                       | None: roles only                                                                                                                                        |
| 6   | Roles stay a const plus a CHECK                     | Uses `HOUSEHOLD_ROLE.owner` and adds no role                                                                                                            |

## Review-response log (adversarial panel)

_Pending._
