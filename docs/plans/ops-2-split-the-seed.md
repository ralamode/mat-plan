# OPS-2 — split the seed: production gets reference data only

> Backlog: [plan.md](../plan.md) row OPS-2. Branches: `db/ops-2-1-production-seed-reference-only`,
> `fix/ops-2-2-fixture-athlete`. Milestone: [beta-1](../milestones/beta-1.md) § 1 (ops fit for other
> people's data), Beta 0 table row 7. Plan branch: `docs/ops-2-seed-split-plan`. Planning only: no
> implementation code is committed with this file.
>
> **Refreshed 2026-11-16** onto FAM-1 step 1 (#432), which landed after the first draft (2026-11-13)
> and did a third of it differently. Round 1's panel log is kept at the bottom; round 2 reviews this
> version.

## What changed since the first draft

[FAM-1 step 1 (#432)](../changelog/2026-11-16-chore-fam-1-1-program-seed-test-only.md) gave
`seed(db, { fixtures })` a **required** option. Production's `db:seed` passes `fixtures: false`.
`SEED_FIXTURES=1` turns it on, and `resolveSeedOptions` refuses the flag unless the connection
string is local or names the preview database (`packages/db/src/seed.ts:130-192`). The program
(`PROGRAM_SEED`, lane P's fixture programs) is written only with fixtures (`seed.ts:434-438`). CI's
smoke, the preview migration and every local harness set the flag. A test pins that no other
workflow names it (`apps/web/test/seed-fixtures-is-contained.test.ts`). #432's docblock says what it
left behind: _"It gates the PROGRAM fixtures only. The seed household and its three fixture profiles
are still written either way; moving those out of production is `OPS-2`'s"_ (`seed.ts:138-139`).

| First draft (2026-11-13)                                                                | Now                                                                                                                              |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| D2: a second entrypoint `db:seed:fixtures` + `assertFixtureTarget`; PR 1a moves callers | **Superseded by #432's flag.** Same safe default (absent = production), already on every caller. PR 1a is dropped.               |
| D1: delete `seed()`, two composites                                                     | **Dropped.** `fixtures` is required, so every caller already chooses; renaming ten call sites buys nothing.                      |
| D3: `seedProgram` tolerates a dead household or athlete in production                   | **Moot.** Production never calls `seedProgram` now.                                                                              |
| D5: `PROGRAM_SEED` keeps reaching prod; nobody owns stopping it (Q3)                    | **Resolved by #432** (FAM-1 plan D10). Q3 is closed.                                                                             |
| D6: an advisory lock for every writer of the seed household                             | **Withdrawn** if Q1 is accepted: production's seed then writes no household-scoped row at all, so there is nothing to serialise. |
| D7: preview gets fixtures (Q1)                                                          | **Done by #432.** Only `service-setup.md:36`'s stale line remains, fixed in PR 1.                                                |
| D9: SEC-6 is blocked on PR 1b **and** on `PROGRAM_SEED` leaving prod                    | Blocked on **PR 1 only**.                                                                                                        |
| D8 tombstones, D10 the test athlete, the lift check                                     | Kept, restated against today's code.                                                                                             |

## Goal

`migrate.yml` runs `db:migrate` then `db:seed` against **production** on every push to `main`. Today
that seed still writes, whatever the flag:

1. **The seed household and three fixture profiles under fixed, public UUIDs** (`seed.ts:226-328`;
   ids in `packages/shared/src/seed-ids.ts`). In production those ids are **not** fixtures: the
   maintainer's real household and two real children's profiles were created by this seed (`…010`
   even by migration `0001_loose_barracuda.sql`). Two consequences are live:
   - **A deleted seeded household comes back, or wedges the job** (`runbooks.md:1232` "⛔
     Precondition 2"). With no other live household, the next merge re-creates it after a hard
     delete. With one, the seed throws `refusing to seed into a household this seed does not own`
     and `migrate.yml` is red on every push. That blocks `PRIV-3`.
   - **A test athlete is in the live app.** PROF-1 b (#357) added `SEED_PROFILE_3` ("Athlete Three")
     for the archive specs, and the seed inserts it into the seed household wherever that household
     exists, production included.
2. **Ramp targets over every kid in the database** (`seed.ts:397-428`): no household and no
   `deleted_at` predicate. The schedule ships `[]`, so it writes nothing today; the day it is filled,
   every household's kids get one family's numbers.

**This plan makes production's seed write reference data and nothing else**, which is the Beta 0
exit criterion as written (`beta-1.md:426`). It moves the household, the profiles and the ramp
expansion under #432's `fixtures` branch, scopes the ramp expansion to the seed household, removes
the test athlete from production, and replaces Precondition 2 with a check run before each deletion.

## Acceptance

**From [plan.md](../plan.md) row OPS-2, verbatim except the personal name:**

> **OPS-2 — split the seed: reference data for prod, fixtures for dev/CI.** `migrate.yml` seeds prod on
> every push; the seed writes [the maintainer]'s family with public fixed UUIDs and re-creates them if
> deleted, and expands ramp targets over every kid in the database. Split into `seedReference` and
> `seedFixtures`; keep `PROGRAM_SEED` reaching prod until V1-22; scope ramp targets by household.
> _(Beta 0.)_

⚠️ "Keep `PROGRAM_SEED` reaching prod until V1-22" no longer holds: #432 stopped it, and the row
already says so (`plan.md` OPS-2, the 2026-11-16 note). PR 1 rewords the row.

**And the Beta 0 exit criteria it owns** (`beta-1.md:426`): _"The prod seed writes reference data only
and cannot re-create a deleted household (OPS-2)"_, plus the box this plan adds: **the live app holds
no test athletes.**

**Done when:**

- `db:seed` without the flag (what `migrate.yml` runs, unchanged) writes **zero** rows to
  `households`, `profiles`, `household_members`, `ramp_targets` and the program tables, on any
  database, and **never throws** because the seed household or a seed profile is absent,
  soft-deleted or tombstoned, with or without other live households. `db:verify` proves each case;
  `db:mutations` proves the proofs can fail.
- `db:seed` with `SEED_FIXTURES=1` produces exactly today's fixture world. Every e2e, screenshot and
  `db:verify` assumption holds **with no spec edits**.
- With fixtures, ramp targets are written only for live kids of the seed household.
- Production holds no live `SEED_PROFILE_3_PUBLIC_ID` row. Precondition 2 is replaced by the check in
  § "What lifts Precondition 2".

## Where this sits

Pillar **Platform** (`OPS-*`). Beta 0 table row 7 (`beta-1.md:484`), no dependency. **Two** PRs, not
the row's one. `PRIV-3` (row 8) waits on **PR 1**, not PR 2, and on `OPS-3`.

**Order with the parallel plans** (Gate 1 of `parallel-work.md` fails on shared files: `runbooks.md`
Precondition 2, `corrections/registry.ts`, `verify.ts`): **OPS-2 PR 1 → PRIV-3 PR 2 → OPS-2 PR 2.**
PRIV-3 lands second, so PRIV-3 reconciles its seed-household refusal against PR 1. OPS-2 PR 2 slots in
wherever `registry.ts` is free.

**Against FAM-1** (in build in six lanes): `seed.ts` is owned by `write-path.md`, FAM-1's busiest seam
(lanes A, E and S each owe it). PR 1 touches only `seed()`'s body above the `if (fixtures)` branch and
the ramp block, not `seedProgram` or `seedProgramFixtures` (lane P's). It enters the write-path queue
as a guest, ordered by the board, like `SCALE-3` (`roadmap.md` → "Sequencing decision (2026-11-16)").
`db:mutations` numbers come from the board's blocks.

_Roadmap alignment (2026-11-16): advances `OPS-2` (Beta 0 row 7); gates `PRIV-3` and `SEC-6`;
checked against the private roadmap, nothing to add here._

## What the code does today (verified 2026-11-16 against `origin/main` `db56b978`)

| Fact                                                                                                                                                                                                     | Where                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `seed(db, { fixtures })`: reference rows, then the 1c-4 household guard, the refusal, three profiles, the movement catalog, the ramp expansion, then `if (fixtures)` the program, then the shadow report | `seed.ts:194-470`                                                                             |
| `fixtures` comes only from `resolveSeedOptions(env, url)`; the flag is refused unless the URL is local or names the preview database                                                                     | `seed.ts:186-192`; `scripts/seed.ts:15`                                                       |
| The 1c-4 guard inserts `…010` only if no live household exists, then resolves `…010` by `public_id` **with no `deleted_at` filter** and throws if absent                                                 | `seed.ts:243-284`                                                                             |
| Profiles `onConflictDoNothing` on `public_id`; `profiles_public_id_unique` is **non-partial**, so a soft-deleted row is never re-created and a hard-deleted one is                                       | `seed.ts:292-328`; `schema.ts` `profiles_public_id_unique`                                    |
| The ramp expansion selects `kind = 'kid'` with no household and no `deleted_at` predicate                                                                                                                | `seed.ts:397-428`                                                                             |
| `seed()` callers: `scripts/seed.ts`, eight in `verify.ts` (all `fixtures: true`), two in `verify/schema.ts` (#432's proof, one each way)                                                                 | `verify.ts:214-215`, `:311`, `:417`, `:434`, `:7078`, `:7115`; `verify/schema.ts:980`, `:987` |
| `seed.test.ts` pins the script's call site by source: `await seed(createDb(pool), options);`                                                                                                             | `seed.test.ts:100-117`                                                                        |
| The only reader of `ramp_targets` is the weekly-adherence query, which is targets-driven (empty schedule → no rows)                                                                                      | `queries/weekly-adherence.ts:16-45`                                                           |
| A freshly migrated database already holds `…010` ("Home"), from migration 0001                                                                                                                           | `0001_loose_barracuda.sql`                                                                    |
| Five tables reference `profiles.id`: `entries`, `sessions`, `day_readiness`, `ramp_targets`, `prescription_targets`; FAM-1 step 5 (#487) added program assignments                                       | `schema.ts` (re-counted in PR 2, § D10)                                                       |
| Fixture membership is written by the claim correction, not the seed; a test pins that only `ci.yml` runs it                                                                                              | `apps/web/test/fixture-member-is-contained.test.ts`                                           |
| `service-setup.md:36` says the preview holds "two minors' first names". **Stale**: the fixtures carry role names since OSS-1 (#265)                                                                      | `docs/service-setup.md:36-42`                                                                 |
| `runbooks.md`'s "a soft-deleted fixture profile is re-created" claim is **false** (non-partial unique)                                                                                                   | fixed in PR 2                                                                                 |
| SEC-6 owns rotating the seed `public_id`s in prod                                                                                                                                                        | `plan.md:1097-1113`                                                                           |

## Decisions

### D1 · Two building blocks inside `seed()`, behind the flag #432 already added

`seed(db, { fixtures })` keeps its name, signature and every caller. Its body becomes:

```ts
export async function seed(db, { fixtures }: SeedOptions): Promise<void> {
  await seedReference(db); // units … movements, unchanged statements and arbiters
  if (fixtures) {
    const household = await seedFixtures(db); // the 1c-4 guard, the refusal, three profiles
    await seedRampTargets(db, householdScopeForScript(household.id), CALISTHENICS_RAMP_SCHEDULE);
    await seedProgram(db, PROGRAM_SEED);
    await seedProgramFixtures(db, householdScopeForScript(household.id));
  }
  await reportShadowedMovements(db); // the TEN-2c report, last, both modes (today's tail)
}
```

The row's two names are the building blocks. `seedReference` and `seedFixtures` are exported for
`db:verify` and nothing else. Moving the profile insert after the movement insert is safe: neither
table has an FK into the other.

**Why keep `seed`.** The first draft deleted it so that a function named `seed` could not write
fixtures from a production path. #432 made `fixtures` a required field with no default, and pinned the
one production call site by source. That is the same protection, already shipped.

### D2 · Ramp targets go with the fixtures, scoped to the seed household (Q1)

`seedRampTargets(db, scope, schedule)` selects `kind = 'kid'` ∧ `deleted_at IS NULL` ∧
`inHousehold(scope)` (the single-sourced conjunct, `writers/ownership.ts`). Archived kids keep their
targets: archive is a list filter, not liveness (PROF-1 b invariant 10). `schedule` is a parameter so
`db:verify` can drive a non-empty schedule through the real expansion.

**It runs only with fixtures.** That makes production's seed literally reference-only, and it is the
same call FAM-1 D10 made for the program: authored household config does not reach production
through a seed. The cost: a future "fill the schedule" data-only PR no longer reaches production on
its own, and has to arrive the way FAM-1's programs do (in the app) or through a correction. The
schedule is `[]` today and nothing reads targets the app did not write, so nothing is lost now.
**Maintainer decision Q1.** The alternative keeps the expansion in production for the seed household
only, which brings back a household resolve, a tolerance for a dead household, and the D6 lock.

### D3 · The production log line

`scripts/seed.ts` prints `✓ seed complete (reference data only)` without the flag and
`✓ seed complete (fixtures)` with it, replacing #432's `(no program fixtures)` / `(with program
fixtures)`. Fixed text, no ids: it lands in world-readable Actions logs. The `✓ seed complete` prefix
the runbooks look for is kept. The lift check (§ below) greps for the production line, so the text is
a constant exported beside `SEED_FIXTURES_ENV`, and the runbook quotes it.

### D4 · Seed-id deletions leave a tombstone (handed to PRIV-3; Q2)

**Old seed code is reachable after PR 1**, through a GitHub "Re-run jobs" on a pre-PR-1 `migrate.yml`
run (possible for 30 days) or a hand-run `pnpm db:seed` from a stale checkout (`deploy.md` documents
the command). Against a **hard**-deleted seed household with no other live household, today's code
re-creates `…010` and three fixture profiles. A runbook sentence cannot close that; the data can.

**Rule, handed to PRIV-3** (its household and athlete erasures; its draft already adopts it as its
D6): when the row being deleted has a `public_id` that is a committed seed constant (`…010`, `…001`,
`…002`, `…003`), it becomes a **tombstone** instead: soft-deleted, `name` scrubbed to a fixed
placeholder, `routine_config` NULL, every child row deleted as usual. Old code against tombstones,
both generations, verified against `seed.ts` and the non-partial unique keys:

| Old-code step                                         | Pre-#432 code (strict `seedProgram` in prod)    | #432 to PR 1 (today's `main`) |
| ----------------------------------------------------- | ----------------------------------------------- | ----------------------------- |
| household insert (only if no live household)          | conflicts on `public_id`, inserts nothing       | same                          |
| resolve `…010` by `public_id`, no `deleted_at` filter | finds the tombstone, does not throw             | same                          |
| profile insert                                        | conflicts on every seed id, inserts nothing     | same                          |
| ramp expansion (schedule `[]`)                        | 0 rows                                          | 0 rows                        |
| `seedProgram`                                         | household not live: **throws, nothing written** | not called                    |
| **Outcome**                                           | red run, nothing written                        | green run, nothing written    |

Either way, no resurrection. The tombstone holds no personal data; its `public_id` is SEC-6's concern.
**Maintainer decision Q2, jointly with PRIV-3.**

### D5 · The fixed public UUIDs (SEC-6, not OPS-2)

In prod the seed ids are the `public_id`s of a real household and two real minors' profiles. The repo
history ties them to the family (the pre-OSS-1 seed carried the given names beside them). The
"UUIDv7 public ids are non-enumerable" layer is void for exactly those rows; the session plus
household scope still holds. **That is SEC-6** (`plan.md:1097`). OPS-2 stops writing them and stops
re-creating them; it does not re-key them. PR 1 restates SEC-6's gate as _"blocked on OPS-2 PR 1"_,
since `PROGRAM_SEED` no longer reaches prod. The fixture namespace keeps the same ids in dev, CI and
preview.

### D6 · The test athlete: a guarded soft-delete correction (Q3)

PR 2 adds `fixture-athlete-in-production-2026-11-<dd>` to `corrections/registry.ts`. Its `run`:

1. resolves the seed household with `requireLiveHouseholdScope(db, SEED_HOUSEHOLD_PUBLIC_ID)`;
2. **inside one transaction**, `SELECT … FOR UPDATE` the live profile with `SEED_PROFILE_3_PUBLIC_ID`
   ∧ `name = SEED_PROFILE_3_NAME`. A renamed row may be a repurposed real athlete, so it **refuses**;
3. counts the profile's rows in **every** table that references `profiles.id`, re-counted from
   `schema.ts` at implementation (FAM-1 adds tables while this waits), **with no `deleted_at`
   filter**, and **refuses** if any is non-zero;
4. under `--apply`, sets `deleted_at = now(), updated_at = now()` in the same transaction.

Soft delete, because every reader goes through `isLiveProfile`, the row holds only a role name, it is
reversible, and no seed re-creates a soft-deleted row (non-partial unique). A hard delete would come
back under any old-code run (D4). An in-app archive leaves the athlete listed. PR 2 lands after PR 1
and corrects the runbook's false claim.

## The transition: the first push after PR 1

`migrate.yml` runs PR 1's seed unattended on its merge commit. Against today's production:

| Step                  | Prod state (confirmed by F1) | Behaviour                                                             |
| --------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `seedReference`       | catalogs present             | identical statements and arbiters (`units` rewrites identical values) |
| households / profiles | `…010`, `…001`–`…003` live   | **no statement issued**                                               |
| ramp, program         | —                            | not called                                                            |
| shadow report         | as today                     | unchanged                                                             |

Nothing is deleted or re-parented: removing inserts cannot orphan a row. PR 1 carries no migration,
and its production path has **fewer** throw sites than today's (the refusal moves under the flag). If
it threw anyway, later pushes would still migrate, each run would be red, and the recovery is a revert,
which is safe at that point (§ Rollback).

## What lifts Precondition 2: the check, run **before each deletion**

A one-off "lifted on <date>" note does not survive a revert. PR 1 rewrites `runbooks.md:1232`'s
Precondition 2 as a check the operator runs **immediately before every deletion of a household or
athlete whose `public_id` is a seed constant**, with merges frozen until that deletion commits:

```bash
git fetch origin
# 1. The split is on main now, not just once.
git grep -qF '<SEED_COMPLETE_REFERENCE_ONLY>' origin/main -- packages/db/src/seed.ts && echo code-live
# 2. The newest COMPLETED production run is green and ran the reference-only seed.
gh run list --workflow migrate.yml --branch main --status completed -L 1 --json databaseId,conclusion
gh run view <databaseId> --log | grep -F '✓ seed complete (reference data only)'
# 3. Old code cannot run: no migrate.yml run older than PR 1's merge is younger than 30 days
#    (GitHub's re-run window), or each such run has been deleted (`gh run delete <id>`),
#    or the row being deleted becomes a tombstone (D4).
```

Plus two standing rules the section states: **never "Re-run jobs" on a `migrate.yml` run from before
PR 1** (`workflow_dispatch` is safe, being pinned to `refs/heads/main`), and **hand-run seeds only from
a freshly fetched `origin/main`** (the "Manually re-seed" section gains this).

## File-by-file changes

### PR 1 · `db/ops-2-1-production-seed-reference-only` (~200 code, ~90 docs)

| Path                                                       | Change   | What & why                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/seed.ts`                                  | EDIT     | D1: extract `seedReference`, `seedFixtures` (returns the household), `seedRampTargets` (D2), the shadow-report tail; `seed()` composes them. The 1c-4 comments move with their code. `SEED_FIXTURES_ENV`'s docblock loses "gates the PROGRAM fixtures only". D3's two line constants.                                                          |
| `packages/db/scripts/seed.ts`                              | EDIT     | D3's lines, from the constants. The call site `seed.test.ts` pins is unchanged.                                                                                                                                                                                                                                                                |
| `packages/db/src/seed.test.ts`                             | EDIT     | The log-line constants differ and carry no UUID-shaped text.                                                                                                                                                                                                                                                                                   |
| `packages/db/scripts/verify.ts` / `verify/schema.ts`       | EDIT     | Proofs A and B (§ Test plan). #432's FAM-1 1 proof is unchanged and still passes.                                                                                                                                                                                                                                                              |
| `packages/db/scripts/mutations/<n>-*.patch` + `.expect` ×3 | NEW      | (a) `seedFixtures` called outside the branch → reddens A; (b) `seedRampTargets` drops `inHousehold(scope)` → reddens B's "household #2's kid has none"; (c) the refusal moved back above the branch → reddens B's tombstone step. Numbers from the board. Re-run `git apply --check` on the existing seed patches; regenerate whichever fails. |
| `.github/workflows/ci.yml`                                 | EDIT     | After `SEED_FIXTURES=1 … db:seed`, also run plain `db:seed` on the same service Postgres: production's CLI on real Postgres, in production's shape (seed rows live). ⚠️ e2e can be skipped and is not required; `db:verify` is the backstop. The containment test still passes (the flag's set of workflows is unchanged).                     |
| `packages/shared/src/seed-ids.ts`                          | EDIT     | One docblock line: fixture ids everywhere, **and** the seed-born real rows in production until SEC-6.                                                                                                                                                                                                                                          |
| `docs/runbooks.md`                                         | EDIT     | Precondition 2 → § "What lifts Precondition 2"; D4's tombstone rule as PRIV-3's; "Manually re-seed": fresh `origin/main` only, never re-run old runs; "Rename / correct a seeded profile": the production seed writes no profile.                                                                                                              |
| `docs/features/write-path.md`                              | EDIT     | A one-line trap: a new household-scoped seed write goes inside the `fixtures` branch; production's seed writes reference data only.                                                                                                                                                                                                            |
| `docs/features/programming.md`                             | EDIT     | Where it says the seed household is written in production, restate.                                                                                                                                                                                                                                                                            |
| `docs/architecture.md`                                     | EDIT     | The prod-seed edge reads "reference seed"; the 1c-4 creator note lives under the fixtures branch. The PR description embeds a flowchart: flag → branch → tables written, per estate.                                                                                                                                                           |
| `docs/service-setup.md`                                    | EDIT     | `:36-42`: the preview holds role-named fixtures plus whatever previews wrote.                                                                                                                                                                                                                                                                  |
| `docs/deploy.md`, `README.md`                              | EDIT     | A brand-new deployment gets `…010` from migration 0001, reference data from `db:seed`, and **no athletes and no member**.                                                                                                                                                                                                                      |
| `docs/plan.md`                                             | EDIT     | OPS-2 row: reword the personal name and the `PROGRAM_SEED` clause, PR states. SEC-6 row: its new gate (D5).                                                                                                                                                                                                                                    |
| `docs/milestones/beta-1.md`                                | EDIT     | The "no test athletes" box; row 7 → two PRs, row 8 waits on PR 1; the step chart; the row's name reworded.                                                                                                                                                                                                                                     |
| `docs/status.md`, `docs/roadmap.md`, changelog             | EDIT/NEW | "Status rides with the work".                                                                                                                                                                                                                                                                                                                  |

### PR 2 · `fix/ops-2-2-fixture-athlete` (~120 lines; after PR 1)

| Path                                                                     | Change   | What & why                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/registry.ts`                            | EDIT     | D6's correction. `issue: 'OPS-2'`.                                                                                                                                                                                                 |
| `packages/db/scripts/verify.ts`                                          | EDIT     | In a rolled-back sandbox: dry run reports; `--apply` soft-deletes; a second `--apply` is a no-op; a renamed fixture refuses; a fixture with a **soft-deleted** entry refuses; afterwards `seed()` in both modes leaves it deleted. |
| `packages/db/scripts/corrections/README.md`                              | EDIT     | Applied row, `pending`. The target is a public fixture const.                                                                                                                                                                      |
| `docs/runbooks.md`                                                       | EDIT     | A soft-deleted fixture profile is **not** re-created (non-partial unique).                                                                                                                                                         |
| `docs/milestones/beta-1.md`                                              | EDIT     | Tick "no test athletes" in the follow-up commit that dates the Applied row.                                                                                                                                                        |
| `docs/changelog/<date>-fix-ops-2-2-fixture-athlete.md`, `docs/status.md` | NEW/EDIT | Fragment and status line.                                                                                                                                                                                                          |

## Test plan

**Proof A, on the main PGlite, before the first fixture seed** (before `verify.ts:214`):
`seed(asPg, { fixtures: false })` twice. Reference tables equal their consts (`assertRefTableMatches`).
`profiles`, `household_members`, `ramp_targets` and the program tables are **0**; `households` is
exactly the migration's `…010`. This is a fork's first run. Mutation (a) reddens it.

**Proof B, a rolled-back sandbox** (the `rolledBack(tx)` shape #432's proof uses, `verify/schema.ts`):

1. Start from the fixture world (`seed(…, { fixtures: true })` has run).
2. Insert household #2 (an invited family) with one `kind = 'kid'` profile.
3. `seed({ fixtures: false })` → **no row count changes** in any household-scoped table.
4. `seedRampTargets(tx, <seed scope>, <two-week schedule>)` → rows for exactly the seed household's
   live kids × weeks × metric keys; **household #2's kid has none**; a soft-deleted seed kid has none.
   Run again: identical. (Mutation b.)
5. Tombstone the seed household and its three profiles (D4's shape, children deleted) →
   `seed({ fixtures: false })` **does not throw** and creates nothing. (Mutation c.)
6. Remove household #2 too (no live household left, Precondition 2's other branch) →
   `seed({ fixtures: false })` still creates no household or profile.
7. **Old-code proof (D4):** replay today's two insert statements (the conditional household insert and
   the profile insert, kept verbatim as an unexported fixture in `verify`) against the tombstones →
   **0 rows**, every table's count unchanged.

**Unit (Vitest):** the log-line constants; the existing `resolveSeedOptions` and call-site pins.
**CI:** `db:verify` and e2e, every spec, the screenshot harness and `global.setup.ts` passing
**unedited**: the proof the fixture world is identical.
**Local:** `pnpm verify`, `pnpm db:mutations` (pasted in PR 1), `pnpm e2e:local`.

## Manual production steps

Every query selects **no names and no household ids other than the seed's**. Paste only booleans and
counts.

| #   | When                         | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | before opening PR 1          | Neon SQL editor, production, read-only: `…010` live?; `count(*)` of live households; for `…001`–`…003`: `kind`, archived?, live? (full ids from `seed-ids.ts`).                                                                                                                                                                                                                                                                                                                   |
| R1  | before merging PR 1          | **Rehearsal on a Neon branch of production** (it holds every family's data: **delete it the same day**). Record counts for `households`, `profiles`, `household_members`, `ramp_targets` and the program tables; from PR 1's checkout run `EXPECTED_DB_ENV=production DATABASE_URL_UNPOOLED=<branch direct> pnpm --filter @mat-plan/db db:seed`; output ends with the production line; re-count: identical. Then PR 2's dry run and `--apply` on a fresh branch once PR 2 exists. |
| M1  | on PR 1's first prod run     | `gh run view <id> --log` contains `✓ seed complete (reference data only)`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| M2  | after PR 2 merges            | `db:correct fixture-athlete-in-production-…`: dry run, read, then `--apply`. Date the Applied row.                                                                                                                                                                                                                                                                                                                                                                                |
| M3  | before each seed-id deletion | § "What lifts Precondition 2", merges frozen.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Risks / rollback

| Risk                                                                                              | Mitigation                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The production seed throws in prod, turning `migrate.yml` red                                     | No migration; fewer throw sites; R1 against a copy of prod; CI runs the production CLI on real Postgres; proofs A and B.                                           |
| A harness silently loses its fixtures                                                             | Every harness already sets the flag (#432). If one is missed, it fails loudly at `global.setup.ts`'s picker assertion.                                             |
| Fixtures reach production through a hand-run command                                              | #432's allowlist refuses the flag against a URL that is neither local nor preview, before connecting. Named limit (shared with OPS-1): a localhost tunnel to prod. |
| Old seed code runs against prod after a seed-id deletion                                          | D4 tombstones; the 30-day window in the lift check; "fresh `origin/main` only".                                                                                    |
| Hot files (`seed.ts`, `verify.ts`, `registry.ts`, `runbooks.md`) shared with FAM-1, PRIV-3, OPS-3 | The board orders PR 1 into the write-path queue; § Where this sits; `seedProgram` and `seedProgramFixtures` untouched.                                             |

**Rollback.** PR 1: a revert is **safe until the first deletion, soft or hard, of a seed-id row**.
After one, today's code resolves the dead household without a `deleted_at` filter and, with a hard
delete and no tombstone, re-creates rows. So **after any seed-id deletion, PR 1 is fix-forward only**,
and the runbook says so beside the check. PR 2 is undone with one guarded `UPDATE … SET deleted_at =
NULL` by `public_id`.

## Downstream: what PRIV-3, OPS-3 and SEC-6 can rely on

- **PRIV-3** _(after PR 1)_: lifts its seed-household refusal behind M3's check, writes tombstones for
  seed ids (D4, Q2), and may call `seed({ fixtures: false })` in its proofs. No seed writes
  `household_members`. ⚠️ Its draft takes the first draft's `SEED_HOUSEHOLD_WRITE_LOCK`, which this
  version withdraws (Q1); it reconciles that.
- **OPS-3**: production's seed writes **nothing** household-scoped, so a restored household is never
  topped up or duplicated by the next push. Its draft's adoption of the lock is likewise withdrawn.
- **SEC-6**: re-gated on PR 1 (D5).
- **TEN-1's deferred cross-household e2e**: a second fixture household inside the branch no longer
  reaches prod. Not added here.

## Alternatives considered

| Alternative                                               | Why not                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A second entrypoint `db:seed:fixtures` (first draft's D2) | #432's required option and URL allowlist give the same safe default and are already on every caller.             |
| Keep the ramp expansion in production, household-scoped   | Q1's alternative: brings back a household resolve, a dead-household tolerance and a lock, for an empty schedule. |
| A `households.seeded` marker column                       | DDL for what the flag does without it.                                                                           |
| Rely on "never re-run" prose for old code                 | Stale checkouts are a second path. Tombstones make old code harmless.                                            |
| Hard delete or in-app archive of the test athlete         | D6.                                                                                                              |
| Re-key the seed ids in OPS-2                              | D5: SEC-6 owns it, and is unblocked by PR 1.                                                                     |

## Out-of-scope / deferred

- The re-key of seed-born production rows (SEC-6).
- PRIV-3's tombstone writer.
- Household creation for a fork or an invited family (the invite row).
- A real path for a non-empty ramp schedule to reach a household (if Q1 is accepted).

## Open questions (maintainer decisions)

- **Q1 (D2).** Ramp targets only with fixtures, so production's seed is reference-only
  (**recommended**)? Or keep the expansion in production for the seed household only?
- **Q2 (D4, with PRIV-3).** Deleting a seed-id row leaves a scrubbed, soft-deleted tombstone so that
  old code writes nothing (**recommended**)? Or rely on the 30-day window plus prose?
- **Q3 (D6).** Remove the test athlete with the guarded soft-delete correction (**recommended**), an
  in-app archive, or a hard delete?

## Review-response log (adversarial panel)

### Round 2 (2026-11-16, this version)

_Pending._

### Round 1 (2026-11-13, the first draft)

Four lenses (correctness, simplicity + reuse, architecture, DB-safety); five blocking findings, all
accepted. The findings that **still shape this version**: C1 (old code is reachable from a stale
checkout → D4 tombstones), D3a/D3c (the lift check runs per deletion and covers the 30-day re-run
window), D3b (a **soft** delete of a seed id also defeats a revert → § Rollback), C2/A4 (no ids in
production log lines → D3), A2 (the re-key is SEC-6's → D5), A3 (the order against PRIV-3), C5/D5 (a
soft-deleted fixture profile is not re-created; the runbook is wrong), D4 and C10 (the correction
re-checks under `FOR UPDATE` and counts children with no `deleted_at` filter), D6 (F1 selects only
seed ids and counts), D8 (the R1 rehearsal), C8 and S6 (CI runs the production CLI after the fixture
seed, on real Postgres). The findings **retired by #432**: A1 and Q3 (`PROGRAM_SEED` in prod), C3/A5,
S-B and S7 (`seedProgram` tolerance), C4 and S2 (the lock and the composite that held it), C11 and A11
(`assertFixtureTarget`), S3 and S10 (PR 1a's containment scaffolding and status churn), D7 (preview).
The round-1 table, as committed then (its `:line` cites are against `200a697`):

| #         | Lens                      | Critique                                                                                                                                                                         | Verdict      | Change                                                                                                                                   |
| --------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| C1        | correctness               | 🔴 "No older code can run" is false: a stale checkout's hand-run `db:seed` (`deploy.md:110-112`, no `EXPECTED_DB_ENV`) runs old `seed()` and re-creates a hard-deleted household | **accepted** | D8 tombstones (old code fails closed; proof B7); "fresh `origin/main`" rule; Q2                                                          |
| D3a       | DB-safety                 | 🔴 The lift check survives a revert (`merge-base` stays true), never fetches the log it relies on, and is recorded once                                                          | **accepted** | Per-deletion check: `git grep` on `origin/main`, `--status completed -L 1`, `gh run view --log \| grep`, the ci.yml check; merges frozen |
| D3b       | DB-safety                 | 🔴 Rollback was wrong: a **soft** delete of `…010`/`…001`/`…002` also wedges the old seed (`seed.ts:198-202` has no `deleted_at` filter)                                         | **accepted** | § Rollback restated: unsafe after any seed-id deletion, soft or hard                                                                     |
| D3c       | DB-safety                 | 🔴 Re-runs are possible for 30 days; "never re-run" is prose                                                                                                                     | **accepted** | Check 4 (30-day window or `gh run delete`)                                                                                               |
| A1        | architecture              | 🔴 No V1-22 document schedules removing `PROGRAM_SEED` from prod; A17 chose the guard so it keeps flowing; A4 derives slugs from it and adds a `seedProgram` throw               | **accepted** | D5 rewritten: no "one-line" claim, owner is Q3; D3 names exactly which throws tolerate, so A4's does not                                 |
| A2        | architecture              | 🔴 D8's re-key follow-up duplicates SEC-6 (`plan.md:1002-1018`)                                                                                                                  | **accepted** | Follow-up line withdrawn from the `plan.md` diff; D9 points to SEC-6 and re-gates it                                                     |
| A3        | architecture              | 🔴 The PRIV-3 account contradicted PRIV-3's plan (it refuses the seed household until OPS-2); Gate 1 fails on more files than named; no order written                            | **accepted** | § Where this sits order, written into `roadmap.md` here; § Downstream names the refusal and who lifts it                                 |
| C2/A4     | correctness, architecture | Skip warnings print seed ids, a public register of deletions about an identifiable family                                                                                        | **accepted** | Id-free lines; `db:verify` asserts no UUID                                                                                               |
| C3/A5     | correctness, architecture | Skipping the whole block on one dead athlete silently freezes the sibling's program                                                                                              | **accepted** | D3's three cases; mutation 43                                                                                                            |
| S-B       | simplicity                | Whole-household-only skip would throw on every fork's first run (`…010` from 0001, no profiles), so profile tolerance must stay                                                  | **accepted** | Kept, and became D3's third case (a fork gets no program at all)                                                                         |
| C4        | correctness               | The seed can interleave with a manual deletion (separate auto-commits)                                                                                                           | **accepted** | D6 advisory lock; replaces "freeze merges" for OPS-3                                                                                     |
| C5/D5     | correctness, DB-safety    | D7's claim (soft-delete not re-created) contradicts `runbooks.md:733-737`, and nothing proves it                                                                                 | **accepted** | PR 2's proof runs both composites after the soft-delete; the runbook is corrected                                                        |
| C6        | correctness               | PR 2's preferred sandbox arrives in 1b                                                                                                                                           | **accepted** | PR 2 lands after 1b                                                                                                                      |
| D4        | DB-safety                 | Correction checks then writes, with a gap                                                                                                                                        | **accepted** | `FOR UPDATE` re-check inside the transaction (`registry.ts:422-430` pattern)                                                             |
| C10       | correctness               | Child counts must not filter `deleted_at`                                                                                                                                        | **accepted** | D10 step 3; proof with a soft-deleted entry                                                                                              |
| D6        | DB-safety                 | F1 listed every household's id; F2 had no query                                                                                                                                  | **accepted** | F1 restricted to seed ids plus a count; F2 dropped (the dry run reports it)                                                              |
| D7        | DB-safety                 | The preview check sat on the wrong PR; `migrate-preview.yml` has no main guard                                                                                                   | **accepted** | M2 after 1b; noted in D7                                                                                                                 |
| D8        | DB-safety                 | Require a rehearsal on a Neon branch of prod                                                                                                                                     | **accepted** | R1, branch deleted the same day                                                                                                          |
| C8        | correctness               | CI running the production seed on an empty DB prints a skip line on every PR, training people to ignore it                                                                       | **accepted** | Order reversed: fixtures, then production (prod's shape, no skip line)                                                                   |
| S6        | simplicity                | Drop the CI production-seed run (duplicates OPS-2 A)                                                                                                                             | **rejected** | Its unique value is real Postgres plus the real CLI, which PGlite does not give; it costs ~2s. Caveat added that e2e can be skipped      |
| C11       | correctness               | `assertFixtureTarget` must see the resolved url                                                                                                                                  | **accepted** | D2; unit case                                                                                                                            |
| A11       | architecture              | D2 double-ran `assertMigrationTarget`                                                                                                                                            | **accepted** | It now adds only what `scripts/seed.ts:12` lacks                                                                                         |
| S1        | simplicity                | `seedRampTargets` needs no mode                                                                                                                                                  | **accepted** | D4: quiet no-op when the household is not live                                                                                           |
| S2        | simplicity                | `seedAuthoredConfig` is a pass-through; inline it                                                                                                                                | **rejected** | After C4 it is the transaction-and-lock boundary, which two composites would otherwise duplicate                                         |
| S3        | simplicity                | The new containment test is the third copy of workflow-scan scaffolding                                                                                                          | **accepted** | Extracted into `source-scan.ts`; the check becomes an `it` in the existing test; script name read from `package.json`                    |
| S4        | simplicity                | Sandbox step 7 is redundant; mutation 42 can redden A; don't copy `migrate(...)`                                                                                                 | **accepted** | Step dropped; 42 → A; `freshDb()`                                                                                                        |
| S5        | simplicity                | Docs list too long; `deploy.md` edited twice; cut the `plan.md:3306` ONB restatement                                                                                             | **accepted** | `deploy.md` once (1b); the ONB restatement cut (README carries the fact); `seed-ids` and write-path edits reduced to one line each       |
| S7        | simplicity                | String union → boolean                                                                                                                                                           | **accepted** | `tolerateMissingTargets`                                                                                                                 |
| S8        | simplicity                | Count three child tables, not five                                                                                                                                               | **rejected** | Correctness verified that exactly five reference `profiles.id`; counting all five is the PRIV-1 rule and future-proof at no cost         |
| S9        | simplicity                | "Patch 10 should apply at an offset" is a guess                                                                                                                                  | **accepted** | Restated as "run `git apply --check`; regenerate whichever fails"                                                                        |
| S10       | simplicity                | Three PRs justified; trim status churn on 1a                                                                                                                                     | **accepted** | 1a: fragment only                                                                                                                        |
| A6        | architecture              | Milestone row and step chart, `architecture.md:254-255`, `:50`, `:585`, `:595`, and a diagram are missing                                                                        | **accepted** | Added to 1b's table; flowchart in the PR description                                                                                     |
| A7        | architecture              | PR 2 would fail `status:check` (no fragment)                                                                                                                                     | **accepted** | Fragment and status line added                                                                                                           |
| A8        | architecture              | The verbatim row quote carries a personal name                                                                                                                                   | **accepted** | Bracketed in the quote; 1b rewords the row and `beta-1.md`                                                                               |
| A9        | architecture              | `plan.md` said "panelled" before the panel ran                                                                                                                                   | **accepted** | Kept: it is true as committed, because the panel ran before this commit                                                                  |
| A10       | architecture              | The stale-comment fix is V1-22 chunk 5's (`spec:256`)                                                                                                                            | **accepted** | 1b fixes it and discharges chunk 5's line on the V1-22 row                                                                               |
| C7        | correctness               | `seed()` has seven verify call sites (`:400`)                                                                                                                                    | **accepted** | Facts table and 1b row                                                                                                                   |
| C9/C11–13 | correctness               | `gh run list` cannot see logs; e2e can be skipped; "CI catches typos" overstated                                                                                                 | **accepted** | `gh run view --log`; `db:verify` named as the backstop; D3 reworded to "the ids cannot diverge"                                          |
| D9        | DB-safety                 | "0 rows" overstated (the `units` upsert; soft-deleted program rows are re-inserted)                                                                                              | **accepted** | Transition table restated                                                                                                                |
| D10       | DB-safety                 | The skip line also follows deleting one athlete                                                                                                                                  | **accepted** | Lift section names both lines                                                                                                            |
