# PRIV-3 RC — a guarded correction that creates a household

> Backlog: [plan.md](../plan.md) → `PRIV-3`; the work is chunk **RC** of the
> [CAT-3 spec](../specs/cat-3-movement-library.md) → "Chunks, in order". Branch:
> `docs/priv-3-rc-create-household` (this plan), then `db/priv-3-rc-create-household` (the code).

## Where this sits

- **Pillar:** privacy and operations (`PRIV-3`'s owner). **Milestone:**
  [Beta 0](../milestones/beta-1.md), the fresh start before FAM-1's trial week
  ([CAT-3 spec](../specs/cat-3-movement-library.md) → "The fresh start, in order", step 7).
- **This PR:** the one tool that can make a household on purpose. The app cannot create one, and
  the production seed stops writing one at `OPS-2` PR 1. After the fresh start has erased the
  seeded household, this is how the household's adult accounts get a household to sign in to.
- **Next:** R0 (the one-shot erasure of the seeded household, after `PRIV-3` 2a), then R1 (the
  runbook section and step 5's correction), then R2, the fresh start itself, on the maintainer's go.
- **Gated on:** nothing to build. It **must be merged before R2**, and **must not be applied in
  production before `OPS-2` PR 1 is deployed** (D10). It edits seam files
  (`packages/db/scripts/corrections/registry.ts`, `packages/shared/src/seed-ids.ts`,
  `packages/db/scripts/verify.ts`, `packages/db/scripts/mutations/`), so **the FAM-1 board gives it
  its turn**.

_Roadmap alignment (2026-11-17): advances `PRIV-3` and `CAT-3` chunk RC; answers `ID-1`'s six
keep-open items below (it writes `household_members`); an app path that creates a household belongs
to the invite row in [beta-1.md](../milestones/beta-1.md) ("A new user gets a new, empty household"),
not here; gates R1 and R2; checked against the private roadmap, nothing else to add._

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
  many households it would create (1), and how many accounts it would bind.
- `--apply` creates exactly one `households` row and one `household_members` row per account. Every
  `public_id` is freshly minted and none is in `SEED_PUBLIC_IDS`. Every member's role is `owner`
  (Q1).
- The run refuses and writes nothing when any account:
  - is malformed;
  - is listed twice;
  - is the e2e fixture principal on a non-local database;
  - already has a live membership (D4).

  It also refuses when the target is the preview database (D5). A refusal names positions and
  counts ("account 2 of 2"), never an id.

- No line of its output, **on any path, a database error included**, contains an input account id.
  That covers the message, the `cause` and the stack.
- `household-claim-2026-10-25` refuses a household `public_id` that is in `SEED_PUBLIC_IDS` unless
  the target is local or the preview database (D6). The e2e harness, CI's smoke step, a developer's
  local claim and a preview claim keep working, and so does every `db:verify` case.
- Each new refusal is proven **wired into its correction** in `db:verify`, not only unit-tested (D9).
- `db:verify` holds the seed to `SEED_PUBLIC_IDS` in both directions.

## Design

**D1. Input: the environment only, never exported.** The accounts come from one variable, named by an
exported constant `CREATE_HOUSEHOLD_ACCOUNTS_ENV = 'CREATE_HOUSEHOLD_CLERK_USER_IDS'`. Its value is a
list of `user_…` ids separated by whitespace. The runbook step (R1) reads it with
`read -rs ids`, then passes it **on the one command**,
`CREATE_HOUSEHOLD_CLERK_USER_IDS="$ids" pnpm --filter @mat-plan/db db:correct …`, then runs
`unset ids`. This is `PRIV-3` D1's channel: the value is passed inline, never `export`ed, so later
child processes of the shell never see it. A command line is visible through `ps`; a process's
environment is readable only by its owner. A Clerk id is a stable third-party account id for a named
adult (`data-inventory.md` §1a). There is no flag and **no household input at all**, so the
correction cannot be pointed at the wrong household.

**D2. What is factored out of `householdClaim`, and where it goes.** Everything is grouped by job,
so that `PRIV-3` 2b reuses it rather than writing a second copy:

- **`packages/shared/src/clerk.ts` (NEW)** holds one bounded pattern,
  `CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]{1,64}$/`. Both `householdClaim`'s shape check (today
  `startsWith('user_')`) and the correction use it, and so does `apps/web/lib/env.ts`'s
  `BYPASS_ID_RE`. That makes one rule out of three. The length bound is the one `env.ts`'s own note
  asks for, and a comma-pasted `user_a,user_b` or a zero-width character now fails the pattern.
- **`packages/db/scripts/corrections/target-url.ts` (EDIT)** gains:
  - `correctionTargetIsLocal()`, which is `isLocalDbHost(correctionTargetUrl() ?? '')`;
  - `correctionTargetIsPreview()`, which is `namesPreviewDatabase(databaseNameOf(url))`;
  - `seedHouseholdClaimIsAllowed(publicId)` (D6).

  `fixtureBindIsAllowed` now calls `correctionTargetIsLocal()`. Their tests go in
  `target-url.test.ts`, which already holds the local-`DATABASE_URL`-beside-production-unpooled
  case.

- **`packages/db/scripts/corrections/accounts.ts` (NEW)** holds three things:
  - `parseAccountList(raw)` splits on `/\s+/`. It refuses an empty list and a repeated id.
  - `accountIssue(id)` returns a **reason code**, `'shape' | 'fixture-remote' | null`. It checks the
    pattern, then `fixtureBindIsAllowed`.
  - `liveMembershipsOf(exec, ids)` is the membership read `householdClaim` hand-writes, for a list.
    Its predicate repeats the partial index's own (`clerk_user_id IN … AND deleted_at IS NULL`).
    It deliberately does **not** use `membershipHousehold`
    (`packages/db/src/queries/household-membership.ts`): that query also requires the household to
    be live and stops at two rows, so a member of a soft-deleted household would pass the check and
    then fail on the index.

  Each correction renders the reason code in its own words. `createHousehold` gives positions only.
  `householdClaim` keeps its current fixture text (`verify.ts` (6f) matches it). Its shape message
  drops the echoed value, since that is most likely a pasted email, and keeps the "should look like"
  wording that (6b) matches. It also keeps its current order, fixture check first.

- **`packages/db/scripts/corrections/redact.ts` (NEW)** holds two things:
  - `CorrectionRefusal`, an `Error` subclass whose message is built only from counts and positions.
  - `redactedFailure(name, err)`. It returns `CorrectionRefusal`s unchanged. Every other error
    becomes `new Error(`${name} failed and rolled back: ${code} ${constraint}`)`, with no `cause`.
    `code` and `constraint` are read from `err.cause`, because `DrizzleQueryError` has no `code` of
    its own. Neither field holds a bound parameter, and the constraint name is what distinguishes a
    lost race (`uq_household_members_clerk_user`) from anything else. Nothing else is read:
    `cause.detail` carries `Key (clerk_user_id)=(user_…)`. This is the shape `PRIV-3` 2b's
    redacted catch planned (code plus constraint). **2b adopts this module and does not write its
    own**, and R0 records that in `PRIV-3`'s plan.

`SEED_PUBLIC_IDS` is read as `SEED_PUBLIC_IDS.has(id)`, with no wrapper, as every
`MOVEMENT_SEED_PUBLIC_IDS` reader does.

**D3. One transaction, the check inside it, and the index behind it.** The whole body of `run`, the
dry run's reads included, sits in one `try` whose `catch` is `redactedFailure` (D2). Inside it, one
`db.transaction` (README rule 7) does three things:

1. `liveMembershipsOf(tx, ids)`. If it finds any, the run refuses (D4).
2. It inserts the household, `{ publicId: newId(), name: HOUSEHOLD_DEFAULT_NAME }`.
   ⚠️ **`synthetic` is not named**: the column defaults to `false`, and
   `apps/web/lib/household-synthetic-is-dark.test.ts` fails any script that names it.
3. It inserts one member per account through `insertHouseholdMember(tx, scope, …)`, the writer
   `householdClaim` uses, with `scope = householdScopeForScript(<the new id>)`.

The dry run runs step 1 and stops. If two runs overlap on an account, both pass step 1. The second
then blocks on the first's uncommitted entry in the partial unique index
`uq_household_members_clerk_user`, fails `23505` when the first commits, and rolls back whole,
household row included. Its redacted message names the constraint. **PGlite has one connection**, so
`db:verify` proves the index's serial refusal (as it does today for AUTH-1), not the race itself. No
lock is added.

**D4. Any live membership means refuse, and a second run is a refusal that writes nothing.** This
correction has nothing it corrects _from_, so the accounts are the guard. If any listed account has
a live membership, the run throws a `CorrectionRefusal`, for example: _"2 of 2 accounts already have
a live membership; nothing written. If an earlier `--apply` of this correction succeeded, this step
is done."_ That meets README rule 2's purpose: a re-run can make no second write. It needs no extra
query to recognise a finished run, so no state can be reported as success by mistake (a
soft-deleted household, a household with other members, the seed household). The runner prints a
thrown refusal as a refusal, so it never shows "✓ applied 1 change(s)".

**D5. The target is checked as well as printed.** The runner already prints `target: <host>`. The
correction also refuses on two targets: the preview database (`correctionTargetIsPreview()`), since
that estate is seed-only and must never hold a **production** account (a preview is signed in to with
development-instance accounts, which D6's claim binds there on purpose), and the fixture principal on any
non-local target (D2). The production database is named `mat_plan` like a local one, so it cannot
be recognised positively. The operator reading the host line is the remaining check, and R1's
runbook step says so.

**D6. `householdClaim` refuses a seed household id, except where the seed's fixtures may live.** The
spec says "refusal of any id in it". Read literally, that breaks callers that claim
`SEED_HOUSEHOLD_PUBLIC_ID` on purpose:

- `linkFixtureMember` (`apps/web/scripts/embedded-pg.ts`);
- CI's smoke step (`ci.yml`);
- a developer's local claim (runbooks);
- a claim on the preview database, the only way anyone gets a membership there since AUTH-1 1c-4;
- `db:verify` (6e), which claims the seeded household and, in CI, runs with **no** database URL
  set.

So `seedHouseholdClaimIsAllowed(publicId)` is true unless the id is in `SEED_PUBLIC_IDS` **and** the
target is neither local nor the preview. That mirrors the rule `seed.ts` already applies to fixtures
(`namesPreviewDatabase`). It runs first, beside the fixture check and before the membership read. Its
message names no id. (6e) is pointed at a second, non-seed household, so its "bound elsewhere"
assertion no longer depends on the environment. The result: no account can be bound to the seeded
household in production again, before or after the fresh start. Existing rows are unaffected. Q2
asks the roadmap thread to confirm this reading.

**D7. `SEED_PUBLIC_IDS`, built from the existing constants, held equal to what the seed writes.**
`seed-ids.ts` gains
`SEED_PUBLIC_IDS: ReadonlySet<string> = new Set([SEED_HOUSEHOLD_PUBLIC_ID, SEED_PROFILE_PUBLIC_ID, SEED_PROFILE_2_PUBLIC_ID, SEED_PROFILE_3_PUBLIC_ID])`.
No UUID is re-typed. Movement ids keep their own set. The proof goes where the seed-only state still
exists: `verify.ts`'s post-seed snapshot (`households`, `profiles`, about line 240). Its hand-written
list of three becomes "the household and profile `public_id`s, as a set, equal `SEED_PUBLIC_IDS`",
checked in both directions. That is one statement of what the seed writes, not three, and an extra
seeded athlete fails it. (`verify/erasure.ts` runs on a database that is no longer pristine, so a
proof there could only be vacuous or false.)

**D8. The household's name: a fixed, neutral constant.** `households.name` is `NOT NULL` and is read
nowhere in `apps/` or `packages/db/src`. `HOUSEHOLD_DEFAULT_NAME = 'Home'` goes in
`packages/shared/src/enums.ts`, beside `HOUSEHOLD_ROLE`, because it names real households, not seed
rows. The correction imports it. **`seed.ts` is not edited**: `OPS-2` PR 1 rewrites that insert,
and it adopts the constant then. That is a pass-back to `OPS-2`. No name is asked for, so no
personal data is typed in.

**D9. Proofs of the wiring, and five mutations.** These are `db:verify` cases beside the AUTH-1 1b
block in `verify.ts`, where the claim correction's composition proofs (6a–6f) already live. Each
pins the environment in a `try`/`finally`, through a local `withEnv(vars, fn)` (its third use in
that file). A run expected to succeed, (6h), goes through the harness's `orFail`. A run expected
to refuse, (6g), (6i) and (6j), goes through `assert.rejects` with a message regex and a message
argument. Either way a thrown error fails a named assertion, and the `.expect` files for 271 to 273
quote those messages:

- (6g) `householdClaim` on `SEED_HOUSEHOLD_PUBLIC_ID`, with both database URLs removed, refuses with
  D6's message.
- (6h) `createHousehold`: the dry run writes nothing, and apply then creates 1 household and 2 owner
  members, none with a seed id.
- (6i) A second apply with the same accounts refuses with D4's counts.
- (6j) `[a fixture-shaped real id, E2E_SESSION_BYPASS_USER]` with both URLs removed refuses at
  position 2 and writes nothing.
- (6k) No line, message, `cause` or stack from (6h)–(6j) contains either input id.

Mutations, `PRIV-3`'s block from 271 (after PR 1's 260–270). Each `.expect` names the first
assertion it fails:

- 271 `create-skips-the-membership-check`: the second apply now hits `23505` and throws the redacted
  error instead of D4's refusal. **(6i) goes red.**
- 272 `create-skips-the-account-check`: the `accountIssue` call is removed from `createHousehold`.
  **(6j) goes red.**
- 273 `claim-allows-a-seed-household`: the D6 call is removed from `householdClaim`. **(6g) goes
  red.**
- 274 `seed-ids-forget-a-profile`: a profile is removed from `SEED_PUBLIC_IDS`. **D7's equality goes
  red.**
- 275 `create-prints-an-id`: one input id is appended to the count line. **(6k) goes red.**

The catch's wiring is proven in vitest, because `db:verify` cannot force a database error past the
count. `accounts.test.ts` calls `createHousehold.run` with a stub whose `transaction` rejects with a
real `DrizzleQueryError` (from `drizzle-orm`) wrapping a pg-shaped `23505` that carries `detail`. It
asserts the message, `cause` and stack contain no input id. Deleting the `try` turns it red.

**D10. Not before `OPS-2` PR 1.** Until `OPS-2` PR 1 is deployed, `seed.ts` skips its household
insert whenever a live household exists, then throws _"refusing to seed into a household this seed
does not own"_. After the erasure and this correction, every `migrate.yml` run would therefore fail
its seed, before the movement catalog is written. So the correction's docblock and R1's runbook step
both say that `--apply` in production comes only after `OPS-2` PR 1 is deployed. The spec's
preconditions already require it; this repeats it where the operator reads.

## File-by-file

| Path                                                               | Change | What & why                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/clerk.ts` (+ `index.ts` export)               | NEW    | `CLERK_USER_ID_PATTERN` (D2)                                                                                                                                                                                                                                                                              |
| `packages/shared/src/clerk.test.ts`                                | NEW    | Pattern cases: a comma, a tab, a zero-width character, 65 characters, a good id                                                                                                                                                                                                                           |
| `packages/shared/src/enums.ts`                                     | EDIT   | `HOUSEHOLD_DEFAULT_NAME` (D8). Its "first caller at COACH-1" note is untouched                                                                                                                                                                                                                            |
| `packages/shared/src/seed-ids.ts` (**seam**)                       | EDIT   | `SEED_PUBLIC_IDS` (D7). The `("Home")` prose names the constant                                                                                                                                                                                                                                           |
| `apps/web/lib/env.ts`                                              | EDIT   | `BYPASS_ID_RE` becomes the shared pattern: one line                                                                                                                                                                                                                                                       |
| `packages/db/scripts/corrections/accounts.ts` + `.test.ts`         | NEW    | D2's three functions, `CREATE_HOUSEHOLD_ACCOUNTS_ENV`, and the vitest catch-wiring case (D9)                                                                                                                                                                                                              |
| `packages/db/scripts/corrections/redact.ts` + `.test.ts`           | NEW    | `CorrectionRefusal`, `redactedFailure` (D2)                                                                                                                                                                                                                                                               |
| `packages/db/scripts/corrections/target-url.ts` + `.test.ts`       | EDIT   | `correctionTargetIsLocal`, `correctionTargetIsPreview`, `seedHouseholdClaimIsAllowed`; `fixtureBindIsAllowed` reuses the first                                                                                                                                                                            |
| `packages/db/scripts/corrections/registry.ts` (**seam**)           | EDIT   | `createHousehold` (D1, D3–D5, D10; its docblock shows the inline `read -rs` form). `householdClaim` uses the pattern, `accountIssue` and D6. "This is the only writer of `household_members`" and the "PRIV-3 converts this entry to flags" promise are corrected                                         |
| `packages/db/scripts/correct.ts`                                   | EDIT   | One comment: "no correction binds one" has been false since `householdClaim`                                                                                                                                                                                                                              |
| `packages/db/scripts/verify.ts` (**seam**)                         | EDIT   | D7's equality; (6e) on a non-seed household; (6g)–(6k); `withEnv`; AUTH-1 1b's "the claim correction is the only writer" comment and message become "the two account corrections"                                                                                                                         |
| `packages/db/scripts/mutations/271…275` + README rows (**seam**)   | NEW    | D9                                                                                                                                                                                                                                                                                                        |
| `packages/db/src/schema.ts` (**seam**), `householdMembers` comment | EDIT   | Comment only: "only writer" prose, and the ID-1 pointer (item 3, below)                                                                                                                                                                                                                                   |
| `apps/web/scripts/embedded-pg.ts`                                  | EDIT   | Docblock: the "a second writer would make … false" argument is restated now that a second writer exists                                                                                                                                                                                                   |
| `apps/web/test/fixture-member-is-contained.test.ts`                | EDIT   | Docblock, and a new `it`: no workflow names `db:correct create-household-` or `CREATE_HOUSEHOLD_CLERK_USER_IDS`, the name derived from the registry                                                                                                                                                       |
| `packages/db/scripts/corrections/README.md`                        | EDIT   | The Applied row (`pending`). The note becomes "neither target nor count is recorded, and nothing goes to the deletion ledger". Lines 80–83's flags promise becomes a dated amendment: the environment is the settled channel (`PRIV-3` Q1), which moves this amendment out of 2b                          |
| `docs/privacy/data-inventory.md`                                   | EDIT   | §1a: a second writer of `household_members.clerk_user_id` (operator-run, environment input, counts-only output); the `households` row becomes "a fixed `'Home'` from every writer; no app writer or reader", and `households.name` joins re-review trigger 3's unused columns; the dated §1a re-read line |
| `docs/plan.md`                                                     | EDIT   | `PRIV-3`'s row links this plan and says it now hosts the household-creating correction too                                                                                                                                                                                                                |
| `docs/changelog/<date>-db-priv-3-rc-create-household.md`           | NEW    | The fragment                                                                                                                                                                                                                                                                                              |

**Size:** about 370 lines.

- Code, about 230: the three modules with their tests about 140, the `createHousehold` entry with
  its docblock about 70, and the `verify.ts` cases about 70, less the lines they replace.
- Five mutations, about 80.
- Docs, about 60.

## What R1 must carry (the runbook step this correction runs in)

- The ids come from **the production instance's Clerk dashboard, read at step 7**. Not from a query
  before R0 (the result would land in `~/.psql_history` or a note), and not from a development
  instance, whose ids are a separate user pool.
- They are entered only through `read -rs`, then passed inline on the one command, then `unset`.
  Never the `VAR=… cmd` form with the value typed in (it lands in `~/.zsh_history`), and never a file.
  ⚠️ The existing claim recipe (`runbooks.md`, the AUTH-1 checklist) types the id inline; R1 does not
  copy it.
- Before the dry run, the operator says how many accounts they meant, and checks that the dry run's
  count matches. The output is counts only, so it is safe to paste once the `target:` line is
  trimmed.
- `OPS-2` PR 1 is deployed (D10). The `target:` host is production's.

## Test plan

- **Unit (vitest):**
  - `clerk.test.ts`: the pattern.
  - `accounts.test.ts`: the list parsing (empty, repeated id, whitespace kinds); `accountIssue`'s
    codes; the catch-wiring case (D9).
  - `redact.test.ts`: a refusal passes through; a foreign error loses every id and its `cause`.
  - `target-url.test.ts`: the three predicates, the mixed-environment case and a preview URL.
  - `fixture-member-is-contained.test.ts`: the workflow pin.

  Fixture account literals are visibly synthetic (`user_rcfixture000a`, `user_rcfixture000b`), never
  copied from any dashboard.

- **`db:verify` (PGlite):** D7's equality; (6e) re-pointed; (6g)–(6k).
- **Mutations:** 271–275 RED under `pnpm db:mutations`.
- **The harness still claims:** `pnpm e2e:local`, because D6 touches the path `linkFixtureMember`
  takes. CI's smoke step is the second witness.
- `pnpm verify` and `pnpm status:check` before the PR.

## Risks / rollback

- **The wrong target:** the correction refuses the preview (D5). The fixture principal cannot be
  bound remotely (D2). The operator reads `target:` before `--apply`. Production cannot be
  recognised by its database name, so that last check is a person's.
- **An id in a public log:**
  - Production runs are by hand, and the workflow pin stops a CI step from running this correction.
  - The output is counts only, and errors are redacted (D2, D3), with (6k), mutation 275 and the
    vitest wiring case behind both.
- **D6 breaks a caller:** the exception covers local and preview; (6e) no longer depends on the
  environment; `e2e:local` and CI's smoke prove the harness.
- **The seed throws after the fresh start:** D10.
- **Two runs at once:** the index rolls one back (D3).
- **Rollback:** this is a new correction, so revert the PR. A household it already created is
  removed by `PRIV-3`'s erasure, not by hand.

## Out of scope

- An app path that creates a household: the invite row in [beta-1.md](../milestones/beta-1.md).
- Inviting or removing a member later, and any role but `owner` (`COACH-1` gives `member` its first
  caller).
- The runbook section (R1) and the erasure before it (R0).
- `householdClaim`'s own read-then-insert outside a transaction. Under a concurrent claim its
  `23505` prints parameters, and that is for `PRIV-3` 2b's runner-wide catch, which adopts
  `redact.ts`.

## Open questions

- **Q1 (the maintainer's, through the roadmap thread):** what role does each account get?
  **Recommended: `owner` for all.** The authority model is "anyone in the household records and
  corrects; the owner decides who belongs to it" (`ID-1`, item 5's note). The app never branches on
  role today, and `member` has no defined meaning until `COACH-1`. The alternative, the first account
  `owner` and the rest `member`, would give `member` a meaning nobody has designed.
- **Q2 (the roadmap thread's, a reading of the spec):** is D6, which refuses a seed household id
  except on a local or preview target, the meaning of "refusal of any id in it"? A literal reading
  breaks the e2e harness, CI's smoke, the developer's claim, the preview's claim and a `db:verify`
  case.

## ID-1's six keep-open items

| #   | Item                                                | This plan                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The principal is a login, never a profile           | Binds logins to a household. It writes no profile and ties none to a login                                                                                                                                                                                                                                          |
| 2   | Every access decision through `getHouseholdScope()` | No access decision here: an operator script. The app's resolver is unchanged                                                                                                                                                                                                                                        |
| 3   | Two memberships throwing is not the model           | The refusal is **policy**: an operator script never gives a bound account a second household. Only D3's race backstop relies on the partial unique index. If ID-1 relaxes that index (guardians, coaches), this correction is revisited, and a one-line pointer in `schema.ts`'s `householdMembers` comment says so |
| 4   | Nothing pins an athlete to a household              | It creates no profile and no `(household_id, profile)` key                                                                                                                                                                                                                                                          |
| 5   | No age-based permission logic                       | None: roles only                                                                                                                                                                                                                                                                                                    |
| 6   | Roles stay a const plus a CHECK                     | It uses `HOUSEHOLD_ROLE.owner` and adds no role                                                                                                                                                                                                                                                                     |

## Review-response log (adversarial panel)

> Panel cost: correctness 120k · 5m58s, scope 77k · 3m09s, architecture 112k · 4m53s, reuse 110k ·
> 4m45s, security 102k · 5m02s, privacy 89k · 4m14s, DB-safety 115k · 5m15s.
> Models: high-stakes (it writes sign-in accounts in production) · every lens: opus, under the Fable
> spend cap until 2026-11-19 03:00 ET.

Lenses: C correctness, S scope, A architecture, R reuse, X security, P privacy, D DB-safety.

| #   | Lens          | Critique (short)                                                                                                                                                  | Verdict                | Resolution                                                                                                                                                                                      |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | A, D          | `synthetic: false` fails `household-synthetic-is-dark.test.ts`                                                                                                    | **accepted**           | D3: the field is omitted; the column defaults to `false`                                                                                                                                        |
| B2  | X, A, D, C    | Both new refusals were unit-tested only; deleting a call leaves everything green ((6f)'s lesson)                                                                  | **accepted**           | D9: (6g) and (6j) in `db:verify`, mutations 272 and 273; the catch's wiring in vitest                                                                                                           |
| B3  | C, X, D       | D6 breaks `db:verify` (6e) in CI (no URL set, so non-local) and shuts off preview claims                                                                          | **accepted**           | D6: allowed on local or preview, run first; (6e) re-pointed at a non-seed household; Q2 names every caller                                                                                      |
| 1   | C, X, A, D, P | D5's catch rewrites the correction's own refusals; SQLSTATE is on `cause`; `detail` carries the id                                                                | **accepted**           | D2: `CorrectionRefusal` passes through; code and constraint only, read from `cause`; no `detail`, no `cause`                                                                                    |
| 2   | C             | The catch must cover the dry run's reads too                                                                                                                      | **accepted**           | D3: one `try` around the whole body                                                                                                                                                             |
| 3   | P, R, D       | The redacted message drops what makes a failure diagnosable; use 2b's shape                                                                                       | **accepted**           | D2: code plus constraint, 2b's planned shape                                                                                                                                                    |
| 4   | C, X, D, S    | Mutations 271 and 273 would fail on a thrown error, not on the named assertion                                                                                    | **accepted**           | D9: `orFail` throughout; 271 re-described; 273 replaced (a seed id as the household's id is a change nobody makes by accident)                                                                  |
| 5   | S             | Five mutations is more than the safety needs; cut the role and seed-id-reuse ones                                                                                 | **accepted, re-spent** | The two cut. Their slots now prove the two wiring refusals, which the panel found unproven (B2). Still five                                                                                     |
| 6   | S, C, D       | D4's "already done" branch: extra query, untested conditions, a soft-deleted household reads as done; the runner prints "applied 1 change"                        | **accepted**           | D4: any live membership refuses, with a message that says a finished run looks like this                                                                                                        |
| 7   | C, R, A, D    | D7's proof cannot see the seed's writes on a non-pristine database; it duplicates `verify.ts`'s snapshot list                                                     | **accepted**           | D7: `verify.ts`'s snapshot list becomes equality with the set, built from the existing constants                                                                                                |
| 8   | R, A, S       | `accounts.ts` mixed three jobs, two of them 2b's; `isSeedPublicId` wraps `.has`                                                                                   | **accepted**           | D2: `redact.ts`, `target-url.ts` and `accounts.ts` by job; 2b adopts `redact.ts`; no wrapper                                                                                                    |
| 9   | R, S, A, P    | `accountIssue`'s positional messages contradicted "householdClaim's messages stay"; the order differs                                                             | **accepted**           | D2: a reason code each caller renders; the claim keeps its order and the text (6b) and (6f) match; its echoed value is dropped                                                                  |
| 10  | R             | The membership read is the part to factor out; don't use `membershipHousehold`                                                                                    | **accepted**           | D2: `liveMembershipsOf`, with why `membershipHousehold` is wrong here                                                                                                                           |
| 11  | X, C          | `startsWith('user_')` lets a comma-pasted pair through; `env.ts` has a stricter rule                                                                              | **accepted**           | D2: one bounded shared pattern, used in three places; split on `/\s+/`                                                                                                                          |
| 12  | X             | A wrong-target run puts real ids into the preview estate                                                                                                          | **accepted, narrowed** | D5: the preview is refused by name. `EXPECTED_DB_ENV` was not added: production cannot be confirmed positively by name either, so a second variable would add an input without a positive check |
| 13  | X             | "Never in CI" was written but not checked                                                                                                                         | **accepted**           | The workflow pin in `fixture-member-is-contained.test.ts`                                                                                                                                       |
| 14  | S, A          | Editing `seed.ts` collides with `OPS-2` PR 1 and breaks mutation 10's patch                                                                                       | **accepted**           | D8: `seed.ts` untouched; the constant goes in `enums.ts`; pass-back to `OPS-2`                                                                                                                  |
| 15  | D             | Applied in production before `OPS-2` PR 1, the seed throws on every `migrate.yml` run                                                                             | **accepted**           | D10, Risks, R1's list                                                                                                                                                                           |
| 16  | A, X          | D1 said `export`; `PRIV-3` D1 says never exported                                                                                                                 | **accepted**           | D1: inline on the one command, then `unset`; the variable name is a const                                                                                                                       |
| 17  | P             | The inventory's `households.name` row describes free text nobody can enter                                                                                        | **accepted**           | The inventory row and re-review trigger 3. `notice.md` unchanged: it over-discloses, which is the safe direction                                                                                |
| 18  | P             | R1 is handed the runbook without the obligations that keep ids out of history                                                                                     | **accepted**           | "What R1 must carry"                                                                                                                                                                            |
| 19  | P             | The Applied row must not record how many accounts were bound                                                                                                      | **accepted**           | README note                                                                                                                                                                                     |
| 20  | R, A, P, C, S | "Only writer" prose and the flags promise go stale in files not listed                                                                                            | **accepted**           | The file table: `registry.ts`, `schema.ts`, `verify.ts`, `embedded-pg.ts`, the test docblock, the inventory, README 80–83                                                                       |
| 21  | A             | ID-1 item 3's reasoning leaned on the index item 3 says not to rely on                                                                                            | **accepted**           | The table, and a pointer in `schema.ts`                                                                                                                                                         |
| 22  | A             | The proofs belong next to the claim's, not in `erasure.ts`                                                                                                        | **accepted**           | D9: beside (6a)–(6f) in `verify.ts`; no sixth module and no change to `erasure.md`                                                                                                              |
| 23  | S             | No size estimate                                                                                                                                                  | **accepted**           | About 370 lines                                                                                                                                                                                 |
| 24  | X             | `correct.ts`'s "no correction binds one" comment is false                                                                                                         | **accepted**           | One-line comment fix                                                                                                                                                                            |
| N   | various       | Fixture literals visibly synthetic (P); "out of scope" should cite the invite row (A); link the milestone (A); PGlite proves the index serially, not the race (D) | **accepted**           | Test plan; Out of scope; Where this sits; D3                                                                                                                                                    |

### Re-review (C, A, X, D; one light pass each)

No blocker survived. Four follow-ups: three taken, one rejected.

- **D, `orFail`:** it fits a run expected to succeed. A refusal case under `orFail` would turn the
  baseline red, so D9 now names `assert.rejects` for (6g), (6i) and (6j).
- **C, the preview:** D5 said the preview "must hold no real account id", while D6 binds
  development-instance accounts there. D5 now says no **production** account.
- **X, a `?database=` override:** probed on the pinned `pg-connection-string` 2.14.1.
  `parse('postgres://u@h/mat_plan_preview?database=mat_plan').database` returns
  `mat_plan_preview`: the path wins, so `databaseNameOf` and the connection agree. Nothing to
  change.
- **A, a note:** `liveMembershipsOf` is a read and could sit in `packages/db/src/queries/`.
  **Rejected:** its only callers are the two corrections, and keeping it in `scripts/` keeps it out
  of the app's reach. It moves at a third caller.
