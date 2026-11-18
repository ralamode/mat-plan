# OPS-2 — split the seed: production gets reference data only

> Backlog: [plan.md](../plan.md) row OPS-2. Branches: `db/ops-2-1-production-seed-reference-only`,
> `fix/ops-2-2-fixture-athlete`. Milestone: [beta-1](../milestones/beta-1.md) § 1 (ops fit for other
> people's data), Beta 0 table row 7. Plan branch: `docs/ops-2-seed-split-plan`. Planning only: no
> implementation code is committed with this file.
>
> **Refreshed 2026-11-16** onto FAM-1 step 1 (#432), which landed after the first draft (2026-11-13)
> and did a third of it differently. **Decision and question ids are the first draft's**, because
> merged docs and two sibling drafts cite them (`fam-1-family-program.md` D10 "answers OPS-2 Q3";
> `beta-1.md` § the remaining path; the PRIV-3 and OPS-3 drafts cite D6, D8 and M4). A withdrawn id
> stays withdrawn and is never reused. Two panels: round 1 on the first draft, round 2 on this one.

## What changed since the first draft

[FAM-1 step 1 (#432)](../changelog/2026-11-16-chore-fam-1-1-program-seed-test-only.md) gave
`seed(db, { fixtures })` a **required** option. Production's `db:seed` passes `fixtures: false`.
`SEED_FIXTURES=1` turns it on, and `resolveSeedOptions` refuses the flag unless the connection
string is local or names the preview database (`packages/db/src/seed.ts`). The program
(`PROGRAM_SEED`, lane P's fixture programs) is written only with fixtures. CI's smoke, the preview
migration and every local harness set the flag; a test pins that no other workflow names it
(`apps/web/test/seed-fixtures-is-contained.test.ts`). #432's docblock names what it left: _"It gates
the PROGRAM fixtures only. The seed household and its three fixture profiles are still written either
way; moving those out of production is `OPS-2`'s."_

| First draft (2026-11-13)                                                     | Now                                                                                                 |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| D1: delete `seed()`, two composites                                          | **Revised.** `fixtures` is required, so every caller already chooses; `seed` keeps its name (§ D1). |
| D2: a second entrypoint `db:seed:fixtures`; PR 1a moves every caller onto it | **Withdrawn, superseded by #432's flag**: the same safe default (absent = production).              |
| D3: `seedProgram` tolerates a dead household or athlete in production        | **Withdrawn.** Production never calls `seedProgram` now.                                            |
| D4: ramp targets scoped to the seed household, in production                 | **Revised** (§ D4, Q6): the expansion leaves production.                                            |
| D5: `PROGRAM_SEED` keeps reaching prod; nobody owns stopping it (Q3)         | **Closed by #432** (FAM-1 plan D10). Q3 is answered.                                                |
| D6: an advisory lock for every writer of the seed household                  | **Withdrawn** (§ D6).                                                                               |
| D7: preview gets fixtures (Q1)                                               | **Done by #432.** Q1 is answered. `service-setup.md`'s stale line is fixed in PR 1.                 |
| D8: seed-id deletions leave a tombstone (Q2)                                 | **Re-opened** (§ D8, Q2): a tombstone contradicts the published notice.                             |
| D9: SEC-6 owns the re-key                                                    | **Kept, restated** (§ D9).                                                                          |
| D10: the test athlete, a guarded soft-delete correction (Q4)                 | **Kept, hardened** (§ D10).                                                                         |
| Q5: three PRs or two                                                         | **Answered**: two.                                                                                  |
| —                                                                            | **New:** D11 (the production log line), Q6 (the ramp expansion).                                    |

## Refresh 2 (2026-11-17), before PR 1's code

**Approved** _(maintainer, orchestrator's chat, 2026-11-18)_: "Approve (Recommended)". Two decisions
made with it, both folded into PR 1:

- **D-S2, rename the secret `migrate.yml` reads: "Yes, rename it (Recommended)".** The workflow change is in PR 1; the maintainer sets the new secret in GitHub, and the PR body carries the guided steps and the order relative to the merge.
- **The seed's `units` lock (found outside the plan): "Fix it (Recommended)".** The upsert skips a row whose values are unchanged, so an unchanged unit is never row-locked, and the seed sets a `lock_timeout` and a `statement_timeout`.

Re-read against `main` at `cb588b71` by the PR's implementer (lane A), after `CAT-3` A1 (#577) and
`PRIV-3` RC (#546) merged, and with lane P's `6c-i` described by lane P. **The decisions stand except
where this table says otherwise**; ids are unchanged. The line cites in § "What the code does today"
are `db56b978`'s; the current ones are here.

| What moved                                                                                                                                                                                                                                                                                                                                                                                                           | What PR 1 does about it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#577** added `equipment` and `muscles` inserts at `seed.ts:228-240`, between the categories and the 1c-4 guard, saying they move to `seedReference`.                                                                                                                                                                                                                                                               | They go in `seedReference` (D1). Proof A's reference tables include both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **The reference rows are not contiguous.** `activity_types`, `metric_definitions`, the shadow detection and the movements insert run **after** the household and profiles (`seed.ts:343-405`).                                                                                                                                                                                                                       | D1 moves them all ahead of the household block. Safe: `movements.household_id` does reference `households`, but every row the seed writes there is global (NULL); no other reference table has an FK into either; the shadow detection reads only `movements` and still runs before its insert. One behaviour changes: with `fixtures: true` and a foreign live household, `activity_types`, `metric_definitions` and `movements` are written before the refusal throws (today the throw comes first); the 1c-4 proof counts only households, so it is unaffected. |
| **#546** added `HOUSEHOLD_DEFAULT_NAME` (`enums.ts`), whose docblock hands the seed's `'Home'` literal (`seed.ts:268`) to this PR; `data-inventory.md` already says the seed writes the constant. PRIV-3 RC's D10: `create-household` must not be applied in production before PR 1 is deployed.                                                                                                                     | `seedFixtures`' insert adopts the constant, which makes the inventory's sentence true; `enums.ts` drops its ⚠️ line. § Where this sits gains RC's gate.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`CAT-3`'s spec**: the catalog is written by `seedReference` (A2, gated on this PR); rule 7, the production seed never throws on catalog data and logs counts only; E1, the catalog seed takes its list as an argument. **K7 / K15**: the fresh start deletes the seeded household; R0 gives this plan's owner the rewrite of Q2, D8 and D9.                                                                        | PR 1's `seedReference(db)` takes **no** list: A2 adds the catalog seed and its argument inside it. Q2, D8 and D9 are restated below for the seeded household (the re-key is replaced by the fresh start). PR 2 is unnecessary if the fresh start's erase runs first (spec § Interactions).                                                                                                                                                                                                                                                                         |
| **Lane P's 6c-i** (not yet merged): `seed.ts` unchanged; `seedProgramFixtures` writes programs, workouts, a week and assignments (`putOn`) plus about 17 household items through `newItem`, all inside `if (fixtures)`, and needs the seed household's scope and `SEED_PROFILE` / `SEED_PROFILE_2` to exist first. Both top-level seed runs in `verify.ts` become named assertions.                                  | D1 keeps that order: `seedFixtures` (household, profiles) before `seedProgramFixtures`. **PR 1's code is cut after 6c-i is on `main`** (the board's order), and the shadow report keeps reading the detection taken before any household item exists.                                                                                                                                                                                                                                                                                                              |
| Mutations whose context D1 breaks: **`10`** (also on adopting the constant), **`45`**, **`321`** (its trailing context is the guard's banner).                                                                                                                                                                                                                                                                       | Regenerated in PR 1, same intent, each still RED on its unchanged `.expect`. PR 1's four new mutations are `326`–`329` (lane A's block).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Current cites: `seed()` `seed.ts:196-472`; guard and refusal `:242-300`; profiles `:302-337`; ramp `:407-444`; branch `:446-454`; callers `verify.ts:233, :234, :334, :440, :457, :7104, :7141`, `verify/schema.ts:982, :989`; the 1c-4 rename block `verify.ts:294-371`; the empty-schedule assertion `verify.ts:1154-1161`; runbook preconditions `runbooks.md:1344` and `:1864-1867`; notice `notice.md:272-276`. | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Goal

`migrate.yml` runs `db:migrate` then `db:seed` against **production** on every push to `main`. Today
that seed still writes, whatever the flag:

1. **The seed household and three fixture profiles under fixed, public UUIDs** (`seed()`'s 1c-4 block
   and profile insert; ids in `packages/shared/src/seed-ids.ts`). In production those ids are **not**
   fixtures: the maintainer's real household and two real children's profiles were created by this
   seed (`…010` even by migration `0001_loose_barracuda.sql`). Two consequences are live:
   - **A deleted seeded household comes back, or wedges the job** (`runbooks.md` "⛔ Precondition 2").
     With no other live household, the next merge re-creates it after a hard delete. With one, the
     seed throws `refusing to seed into a household this seed does not own` and `migrate.yml` is red
     on every push. That blocks `PRIV-3`.
   - **A test athlete is in the live app.** PROF-1 b (#357) added `SEED_PROFILE_3` ("Athlete Three")
     for the archive specs, and the seed inserts it into the seed household wherever that household
     exists, production included.
2. **Ramp targets over every kid in the database**: no household and no `deleted_at` predicate. The
   schedule ships `[]`, so it writes nothing today; the day it is filled, every household's kids get one
   family's numbers.

**This plan makes production's seed write reference data and nothing else**, which is the Beta 0
exit criterion as written. It moves the household and profiles under #432's `fixtures` branch, takes
the ramp expansion out of production, removes the test athlete, and replaces both runbook
preconditions that wait on OPS-2 with one check run before each deletion.

## Acceptance

**From [plan.md](../plan.md) row OPS-2, verbatim except the personal name:**

> **OPS-2 — split the seed: reference data for prod, fixtures for dev/CI.** `migrate.yml` seeds prod on
> every push; the seed writes [the maintainer]'s family with public fixed UUIDs and re-creates them if
> deleted, and expands ramp targets over every kid in the database. Split into `seedReference` and
> `seedFixtures`; keep `PROGRAM_SEED` reaching prod until V1-22; scope ramp targets by household.
> _(Beta 0.)_

⚠️ "Keep `PROGRAM_SEED` reaching prod until V1-22" no longer holds: #432 stopped it, and the row
already says so. PR 1 rewords the row.

**The Beta 0 exit criteria it owns:** _"The prod seed writes reference data only and cannot re-create a
deleted household (OPS-2)"_, plus the box this plan adds: **the live app holds no test athletes.**

**Done when:**

- `db:seed` without the flag (what `migrate.yml` runs, unchanged) writes **zero** rows to any
  household-scoped table on any database, and **never throws** because the seed household or a seed
  profile is absent, hard-deleted or soft-deleted, with or without other live households. `db:verify`
  proves each case; `db:mutations` proves each proof can fail.
- `db:seed` with `SEED_FIXTURES=1` produces exactly today's fixture world, minus the ramp expansion if
  Q6 deletes it. Every e2e, screenshot and `db:verify` assumption holds **with no spec edits**.
- Production holds no live `SEED_PROFILE_3_PUBLIC_ID` row.
- Neither runbook precondition that waits on OPS-2 remains; both point at § "What lifts the
  preconditions".

## Where this sits

Pillar **Platform** (`OPS-*`). Beta 0 table row 7, no dependency. **Two** PRs, not the row's one.

**One order across the three Beta 0 deletion tracks.** Gate 1 of `parallel-work.md` fails for OPS-2
PR 1 against both siblings: with the OPS-3 restore PR on `verify.ts`, `mutations/`, `runbooks.md`,
`service-setup.md`, `beta-1.md`, `plan.md` and `roadmap.md`; with PRIV-3 on `runbooks.md`, `verify.ts`,
`mutations/`, `corrections/registry.ts` and the privacy docs. PRIV-3's draft already sets the order
for itself and OPS-3; this plan takes its slot in it:

1. PRIV-3 PR 1 (the household graph and its proofs);
2. **OPS-2 PR 1**, then the OPS-3 restore PR (one at a time; OPS-2 first, as the smaller, and because
   PRIV-3 PR 2b needs it);
3. the OPS-3 drill;
4. PRIV-3 PR 2a, then PR 2b (the erasure);
5. **OPS-2 PR 2** whenever `registry.ts` is free after OPS-2 PR 1 (always after PRIV-3 PR 1, whose `ATHLETE_GRAPH` it imports). It gates nothing.

PR 1 writes this order into `roadmap.md` → "In flight".

**Refresh 2 (2026-11-17): three more things wait on PR 1 being deployed.** `CAT-3` A2 (the catalog
seed goes inside `seedReference`); `PRIV-3` RC's `create-household` correction, which must not be
applied in production before it (RC's D10, or the seed throws on every `migrate.yml` run); and the
`CAT-3` fresh start (spec § "The fresh start, in order", its first precondition). PR 1 itself waits
on lane P's `6c-i`, which edits `seed-fixtures.ts` behind the same branch.

**K15 changes the order above for the seeded household's run:** the fresh start needs no OPS-3 drill
ahead of `PRIV-3` 2a (spec R0), so PR 1's `roadmap.md` edit writes the order with that exception.

**Against FAM-1** (in build in six lanes): `seed.ts` and `verify/schema.ts` are under `write-path.md`,
and FAM-1's seam table makes that guide one queue. Lane A, which owned `seed.ts`, has merged its whole
chain (step 5, #487), so the collision is the guide's queue, not a lane's file. PR 1 enters it as a
**guest**, like `SCALE-3`, adds its row to FAM-1's seam table, and the board orders it. Proofs go in a
new `verify/seed.ts` module (FAM-1 0c's sharding). `db:mutations` numbers come from the board.

_Roadmap alignment (2026-11-17, refresh 2): advances `OPS-2` (Beta 0 row 7); gates `CAT-3` A2, `PRIV-3` RC's production apply and the fresh start (`CAT-3` chunk R); checked against the private roadmap, nothing to add here._
_Roadmap alignment (2026-11-16): advances `OPS-2` (Beta 0 row 7); gates `PRIV-3` PR 2b and re-gates
`SEC-6`; checked against `ID-1`'s six keep-open items (no profile-to-login link, no role or age logic,
nothing bypasses `getHouseholdScope`) and against the private roadmap; nothing to add here._

## What the code does today (verified 2026-11-16 against `origin/main` `db56b978`)

| Fact                                                                                                                                                                                                                                                                                                  | Where                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `seed(db, { fixtures })`: reference rows, the 1c-4 household guard, the refusal, three profiles, the movement catalog and the TEN-2c shadow detection, the ramp expansion, then `if (fixtures)` the program, then the shadow report                                                                   | `seed.ts:194-456`                                                                                 |
| `fixtures` comes only from `resolveSeedOptions(env, url)`; `seed.test.ts` pins the script's call site by source                                                                                                                                                                                       | `scripts/seed.ts:15-18`; `seed.test.ts:100-117`                                                   |
| The 1c-4 guard inserts `…010` only if no live household exists, then resolves `…010` by `public_id` **with no `deleted_at` filter** and throws only if **no row** has it                                                                                                                              | `seed.ts:243-282`                                                                                 |
| `households.public_id` and `profiles.public_id` are plain (non-partial) UNIQUE: a soft-deleted row is never re-created; a hard-deleted one is                                                                                                                                                         | `schema.ts` (`households`, `profiles`)                                                            |
| `profiles` columns that can hold personal data: `name`, `birthdate`, `avatar`, `pin_hash`, `routine_config`; plus `kind`, `archived_at` and timestamps                                                                                                                                                | `schema.ts` `profiles`                                                                            |
| The ramp expansion selects `kind = 'kid'` with no household and no `deleted_at` predicate; `CALISTHENICS_RAMP_SCHEDULE` is `[]` and this is its only consumer                                                                                                                                         | `seed.ts:397-428`; `shared/src/ramp-schedule.ts:49`                                               |
| `db:verify` asserts the empty schedule seeds zero `ramp_targets`, and builds its weekly-adherence rows by direct insert, not through the seed                                                                                                                                                         | `verify.ts:1126-1175`                                                                             |
| `seed()` callers: `scripts/seed.ts`; **seven** in `verify.ts` (all `fixtures: true`); two in `verify/schema.ts` (#432's proof, one each way)                                                                                                                                                          | `verify.ts:214`, `:215`, `:311`, `:417`, `:434`, `:7078`, `:7115`; `verify/schema.ts:980`, `:987` |
| The 1c-4 refusal proof swaps `…010` for a fresh id, so the resolve finds nothing                                                                                                                                                                                                                      | `verify.ts:283-330`                                                                               |
| Both TEN-2c `captureWarnings` proofs run with `fixtures: true`                                                                                                                                                                                                                                        | `verify.ts:7078`, `:7115`                                                                         |
| **Six** tables reference `profiles.id`. `ERASE_ATHLETE` (#487) lists every table reachable from a profile and `db:verify` proves it complete, but it is private to `verify/schema.ts`                                                                                                                 | `verify/schema.ts:2218-2250`, `:2419-2423`                                                        |
| A freshly migrated database already holds `…010` ("Home"), from migration 0001, which cannot be edited                                                                                                                                                                                                | `0001_loose_barracuda.sql`                                                                        |
| Two runbook preconditions wait on OPS-2: the household delete's Precondition 2 and the athlete erasure's precondition 2                                                                                                                                                                               | `runbooks.md:1232`, `:1710-1713`                                                                  |
| The notice says the three starting athletes "cannot yet" be erased "because setup would put them back", and that a deleted household is "permanently removed … not hidden"                                                                                                                            | `notice.md:261-266`                                                                               |
| Stale since #432 or once PR 1 lands: `migrate.yml`'s header ("a profile in seed.ts" reaches prod); `service-setup.md`'s "two minors' first names"; `beta-1.md`'s OPS-2 description and table note on `PROGRAM_SEED`; `FIXTURES_TARGET_REFUSED`'s "program fixtures"; `.env.example`'s local `db:seed` | as named                                                                                          |

## Decisions

### D1 · Two building blocks inside `seed()`, behind the flag #432 already added

`seed(db, { fixtures })` keeps its name, signature and every caller:

```ts
export async function seed(db, { fixtures }: SeedOptions): Promise<void> {
  // units, quantity slots, categories, equipment, muscles, activity types, metrics, the shadow
  // detection, movements: every reference insert, now all ahead of the household block (refresh 2)
  const shadowed = await seedReference(db);
  if (fixtures) {
    const household = await seedFixtures(db); // the 1c-4 guard (name: HOUSEHOLD_DEFAULT_NAME), the refusal, three profiles
    await seedProgram(db, PROGRAM_SEED);
    await seedProgramFixtures(db, householdScopeForScript(household.id));
  }
  reportShadowedMovements(shadowed); // the TEN-2c report, last, both modes, as today
}
```

`seedReference` and `seedFixtures` are the row's two names, exported for `db:verify` and nothing else.
The shadow **detection** stays where it is today, inside `seedReference` before the catalog insert, so
the report's meaning does not move once lane P writes household-owned movements. Moving the profile
insert after the movement insert is safe: neither table has an FK into the other.

**`MOVEMENT_SEED_ROWS` stays in `seedReference` in PR 1, temporarily** (refresh 2, round 3). The 35
legacy movements are global reference rows today, and every live entry points at them. **Proposed to the spec, not yet in it** (round 3 re-review, D-B1): `CAT-3` A2 stops writing them without
the flag, before the fresh start deletes them, and is the second cut-off in the never-re-run rule. The
spec's E4 does not say so today, so three sentences go to its owner (the roadmap thread): E4 or A2's row,
"without the flag the seed no longer writes `MOVEMENT_SEED_ROWS`"; the never-re-run paragraph, A2 as the
second cut-off; and "A2 deployed" as a fresh-start precondition.

**Why `seed` keeps its name.** The first draft deleted it so that a function named `seed` could not
write fixtures from a production path. #432 made `fixtures` a required field with no default and pinned
the one production call site by source: the same protection, already shipped.

### D4 · The ramp expansion leaves production (Q6)

**Decided: delete it** _(maintainer, 2026-11-16, Q6)_. The schedule has been `[]` since V1-6b-1, the seed is its only consumer,
and FAM-1 D10 already decided that authored household config does not reach production through a seed.
Kept only for fixture databases, it would be a household-scoped extraction, a test-only `schedule`
parameter, a sandbox step and two mutations, all for code that writes zero rows anywhere. PR 1 deletes
the block, `CALISTHENICS_RAMP_SCHEDULE` (its only consumer goes) and `verify.ts`'s "empty schedule seeds
zero rows" assertion. The weekly-adherence proof is untouched: it inserts its targets directly. The
row's "scope ramp targets by household" is met because no expansion runs. A real schedule, when one
exists, arrives the way FAM-1's programs do.

The alternatives, for Q6: (b) keep it under `fixtures`, scoped by `inHousehold` and `deleted_at IS
NULL`, with its own proof and mutations; (c) keep it in production for the seed household only, which
brings back a household resolve, a dead-household tolerance and D6's lock.

### D6 · The advisory lock: withdrawn

The first draft serialised every writer of the seed household behind one lock. It is not needed now:

- **Production's seed writes no household-scoped row** (D1, D4), so it races with nothing.
- **It never covered old code**, the one seed path that can still write a household (D8): code from
  before the lock never takes it.
- **PRIV-3's erasure against OPS-3's restore** is a question between those two tracks, not about the
  seed. Both drafts already run each in one transaction with merges frozen; if they want a lock between
  them, it is theirs to define. The drafts' citations of `SEED_HOUSEHOLD_WRITE_LOCK` are in
  § Downstream.

If Q6 picks (c), the lock comes back with it.

### D8 · What makes a seed-id deletion safe from old code (Q2, jointly with PRIV-3)

**Old seed code is reachable after PR 1**: through "Re-run jobs" on a pre-PR-1 `migrate.yml` run (for 30
days), or a hand-run `pnpm db:seed` from a stale checkout (`deploy.md` documents the command). Three
generations can run:

| Old code                       | Hard-deleted seed household, **no** other live household | … **another** live household         | Against a **tombstone**                                        |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| before 1c-4 (until 2026-11-04) | re-creates `…010` and three profiles                     | re-creates `…010` as a 2nd household | conflicts; strict `seedProgram` throws: red, nothing written   |
| 1c-4 to #432                   | re-creates `…010` and three profiles                     | throws: red, nothing written         | resolves it; strict `seedProgram` throws: red, nothing written |
| #432 to PR 1 (today)           | re-creates `…010` and three profiles                     | throws: red, nothing written         | resolves it; inserts conflict: green, nothing written          |

So without protection, old code can **resurrect** a deleted seed household. The first draft's answer
was a tombstone. **Round 2 found that a tombstone contradicts the published notice**: `notice.md`
promises a deleted household is "permanently removed from the database, not hidden", and the household
delete's step 5 proves profile counts are zero. A tombstone is a hidden row, and the first draft's
shape (scrub `name` and `routine_config`) also kept `birthdate`, `avatar`, `pin_hash`, `kind`, the
timestamps and `archived_at`. So Q2 has three options:

- **(a) SEC-6's production re-key runs before the first seed-id deletion — decided** _(maintainer, 2026-11-16)_. The family's
  rows then carry ordinary UUIDv7s and are hard-deleted like anyone's. Old code may re-create the seed
  rows under the seed ids, with whatever names that version carried (no live household), or throw
  (another live household); removable with D10's correction shape, and detected by the same check. No tombstone, no notice change, and
  SEC-6's exposure closes too. Cost: SEC-6 joins the deletion's critical path, and it must answer
  `ID-1`'s "the `public_id` stays the athlete's identity for life" (D9).
- **(b) A fully constant tombstone**: every column a fixed value (nullable columns NULL, timestamps a
  fixed epoch, `kind` fixed), its shape from PRIV-3's one exported writer (`isSeedTombstone`), and
  PRIV-3 edits the notice's "what remains afterwards", the inventory, and the household delete's step 5.
  The row still says "this committed id existed and was deleted".
- **(c) Hard delete, relying on the 30-day re-run window and "seed only from a fresh `origin/main`"**.
  Rejected in round 1 (C1): a stale checkout's hand-run is not bounded by the window.

The lift check works with (a) or (b). PR 1 implements neither: (a) is SEC-6's, (b) is PRIV-3's writer.

**Refresh 2 (2026-11-17): for the seeded household, (a) is replaced by `CAT-3`'s fresh start** (spec
K7 and K15, decided by the maintainer with the spec): the seeded household is erased in production,
the family signs in again under ordinary ids. Old seed code may re-create the seed household and profiles
with whatever names that version carried, and, before A2, the legacy movements; the fresh start's R4
second run detects both, and its remedy is the step-3 correction, kept. The re-key is no longer on the deletion's path for that household. The
argument above is kept, because it is why the fresh start is enough.

### D9 · The fixed public UUIDs (SEC-6, not OPS-2)

**Refresh 2 (2026-11-17):** for the seeded household, `CAT-3`'s fresh start (K7) replaces the
production re-key below: after it, no live production row carries a committed seed constant, which
is SEC-6's acceptance. SEC-6's row is restated accordingly by the fresh-start chunk (R0), not by PR 1.

In production the seed ids are the `public_id`s of a real household and two real minors' profiles, so
the "UUIDv7 public ids are non-enumerable" layer is void for exactly those rows; the session plus
household scope still holds. **That is SEC-6.** OPS-2 stops the seed writing them and re-creating
them. It cannot stop **migration 0001** writing `…010` into every new deployment. SEC-6's row is restated by
the fresh-start chunk (R0), not by PR 1 (refresh 2); the fix below is what it would be for a seed-id row
the fresh start does not reach:

- **Fix:** re-key the **production rows only**, by a guarded correction. The committed constants stay
  as the fixture namespace in dev, CI and preview; after OPS-2 nothing addresses production rows by
  them, so no `PROGRAM_SEED`, screenshot or e2e sweep is needed.
- **Acceptance:** _"no live production row in the maintainer's deployment carries a committed seed
  constant as its `public_id`"_ (a new deployment gets `…010` from 0001 by construction).
- **Gate:** OPS-2 PR 1. **Owes:** an answer to `ID-1`'s lifetime-identity item, because a profile's
  `public_id` is its URL handle.

### D10 · The test athlete: a guarded soft-delete correction (Q4)

**Refresh 2 (2026-11-17):** PR 2 is unnecessary once `CAT-3`'s fresh start has erased the seeded
household (spec § Interactions, `OPS-2`). It stays planned until then, in case the fresh start slips.

PR 2 adds `fixture-athlete-in-production-2026-11-<dd>` to `corrections/registry.ts`. Its `run`, in one
transaction with `set local lock_timeout` and `statement_timeout` (the `registry.ts` pattern):

1. resolves the seed household with `requireLiveHouseholdScope(db, SEED_HOUSEHOLD_PUBLIC_ID)`;
2. `SELECT … FOR UPDATE` the profile through `isLiveProfile(SEED_PROFILE_3_PUBLIC_ID)` ∧
   `inHousehold(scope)` ∧ `name = SEED_PROFILE_3_NAME`. A renamed row may be a repurposed real athlete,
   so it **refuses**;
3. **after** the lock, counts the profile's rows in every table of `ATHLETE_GRAPH`, which PRIV-3 PR 1
   exports from `packages/db/src/erasure/graph.ts` (the household graph filtered to the per-athlete
   tables, at athlete grain) and which lands before PR 2, so the correction counts over the list the
   athlete erasure deletes and `db:verify` proves complete. PR 2 imports it and moves nothing
   _(reconciled with PRIV-3's refresh, 2026-11-17)_. The count **skips the target's own `profiles` row**, which `ATHLETE_GRAPH` lists and the lock already holds: it counts only the rows that hang off it (PRIV-3 #513). **No `deleted_at` filter.** It **refuses** if any count is non-zero. The
   row lock conflicts with the key-share lock a child insert takes, so the counts hold until commit;
4. under `--apply`, sets `deleted_at = now(), updated_at = now()`.

Soft delete, because every reader goes through `isLiveProfile`, the row holds only a role name, it is
reversible, and no seed re-creates a soft-deleted row (non-partial unique). A hard delete would come
back under old code (D8). An in-app archive leaves the athlete listed. ⚠️ PGlite has one connection, so
the lock's contention cannot be proved there; the proof covers the refusals and the effect.

### D11 · The production log line

`scripts/seed.ts` prints `✓ seed complete (reference data only)` without the flag and
`✓ seed complete (fixtures)` with it, replacing #432's two lines (`(no program fixtures)` / `(with program fixtures)`). Fixed text, no ids: it lands in
world-readable Actions logs. The literals stay in `scripts/seed.ts` (one use each) and are pinned in
`seed.test.ts`'s existing source-pin block, so the runbook's grep cannot drift silently.

## The transition: the first push after PR 1

`migrate.yml` runs PR 1's seed unattended on its merge commit. Against today's production:

| Step                  | Prod state (F1)            | Behaviour                                                             |
| --------------------- | -------------------------- | --------------------------------------------------------------------- |
| `seedReference`       | catalogs present           | identical statements and arbiters (`units` rewrites identical values) |
| households / profiles | `…010`, `…001`–`…003` live | **no statement issued**                                               |
| ramp, program         | —                          | not run (ramp deleted, program under the flag)                        |
| shadow report         | as today                   | unchanged                                                             |

Nothing is deleted or re-parented: removing inserts cannot orphan a row. PR 1 carries no migration, and
its production path loses the 1c-4 throw site. If it threw anyway, later pushes would still migrate,
each run would be red, and a revert is safe at that point (§ Rollback).

## What lifts the preconditions: the check, run **before each deletion**

PR 1 replaces **both** OPS-2 preconditions (`runbooks.md` household delete, Precondition 2; athlete
erasure, precondition 2) with one section.

🔴 **A household or athlete whose `public_id` is in `SEED_PUBLIC_IDS` is still never removed by the
ordinary runbook deletion** (refresh 2, round 3 B1). It is removed only by `CAT-3`'s fresh start
(step 3, chunk R0's one-shot correction, which erases the seeded household with everything in it), or,
for a seed-id row the fresh start does not reach, after `SEC-6`'s re-key gives it an ordinary id. Old
seed code can re-create a seed-id row (D8), so an ordinary deletion of one would leave the notice's
"permanently removed" false. **The check below is a precondition of those two paths**, not a licence.

It also defines **"OPS-2 PR 1 is deployed"**, which `PRIV-3` RC's production `--apply` and the fresh
start's step 3 both wait on: run it immediately before each, with merges frozen until that step
commits. It checks behaviour, not strings:

```bash
git fetch origin
MAIN=$(git rev-parse origin/main)
# 1. Production's seed ran the current main, successfully, and nothing is queued or running —
#    including a re-run of an OLD run, which keeps its old creation time and so never shows as "newest".
gh run list --workflow migrate.yml --branch main -L 20 --json databaseId,headSha,status,conclusion,attempt,updatedAt
#    → the newest row: headSha == $MAIN, status completed, conclusion success; and NO row with
#      attempt > 1 whose updatedAt is later than that run's (a finished re-run of old code).
gh run list --workflow migrate.yml --status in_progress --json databaseId,headSha   # → []
gh run list --workflow migrate.yml --status queued --json databaseId,headSha        # → []
gh run list --workflow migrate.yml --status waiting --json databaseId,headSha       # → []
gh run list --workflow migrate.yml --status pending --json databaseId,headSha       # → [] (held by the concurrency group)
gh run list --workflow migrate.yml --status requested --json databaseId,headSha     # → []
gh run view <databaseId> --log | grep -F '✓ seed complete (reference data only)'
# 2. db:verify (which carries OPS-2's proofs) passed on that same commit.
gh run list --workflow ci.yml --commit "$MAIN" --json conclusion,status
```

Plus the rules the section states:

- **Old code is made harmless by the fresh start and SEC-6, not by the clock.** The 30-day re-run
  window is information. Production's `migrate.yml` runs are **never deleted**: they are the record of
  which DDL reached production and when.
- **Never "Re-run jobs" on an old `migrate.yml` run.** The cut-off is **two** commits: PR 1 (from it on,
  no household or profile is written) and **`CAT-3` A2** (from it on, the 35 legacy movements,
  `MOVEMENT_SEED_ROWS`, are written only with fixtures, spec E4). A re-run of anything before A2 would
  put legacy movements back after the fresh start's step 5 deletes them. `workflow_dispatch` is safe,
  being pinned to `refs/heads/main`.
- **Hand-run seeds only from a freshly fetched `origin/main`** (the "Manually re-seed" section).
- **From the fresh start's step 3 on, PR 1 is fixed forward only**: the seeded household is gone, and a
  reverted PR 1 would re-create it.

## File-by-file changes

### PR 1 · `db/ops-2-1-production-seed-reference-only` (~180 code, ~110 docs)

| Path                                                                     | Change     | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/seed.ts`                                                | EDIT       | D1: extract `seedReference`, `seedFixtures`; `seed()` composes them; the 1c-4 comments move with their code. D4: delete the ramp block. `SEED_FIXTURES_ENV`'s and `seedFixturesRequested`'s docblocks and `FIXTURES_TARGET_REFUSED` stop saying "program fixtures": the flag now gates every fixture.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/shared/src/enums.ts`                                           | EDIT       | Refresh 2: `HOUSEHOLD_DEFAULT_NAME`'s "⚠️ `seed.ts` still types the literal" line goes; the seed now writes the constant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/shared/src/ramp-schedule.ts`                                   | EDIT       | D4: `CALISTHENICS_RAMP_SCHEDULE` goes (no consumer).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/db/scripts/seed.ts`, `packages/db/src/seed.test.ts`            | EDIT       | D11's lines; the source pin gains both literals. The pinned call site is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/verify/seed.ts`                                     | NEW        | Proofs A and B (§ Test plan), called from `verify.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/db/scripts/verify.ts`                                          | EDIT       | Call the new module; drop the empty-schedule assertion (D4); proof C's one line in the 1c-4 rename block.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/scripts/verify/harness.ts`                                  | EDIT       | "What a proof module can rely on": Proof A is the second exception to "last", after A1's `verifyCatalogMigrationFacts` (round 3 re-review).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/db/scripts/mutations/326`–`329` + `.expect`; `10`, `45`, `321` | NEW / EDIT | `326` (a) `seedFixtures` outside the branch → A's first failure; `327` (c) the refusal above the branch → C; `328` (e) the guard and insert outside the branch → B2; `329` (f) the shadow report inside the branch → B4. **Regenerated:** `10` (also for `HOUSEHOLD_DEFAULT_NAME`) and `321`, each RED on its unchanged `.expect`; **`45`'s `.expect` moves to Proof A's wrapped-seed message** (round 3 C-B1): its hoisted `seedProgram` now runs, and fails, inside A, on a database with no profiles.                                                                                                                                                                                                               |
| `.github/workflows/migrate.yml`                                          | EDIT       | Header comment: production's seed writes reference data only; "a profile in seed.ts" no longer reaches prod.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/shared/src/seed-ids.ts`                                        | EDIT       | One docblock line: _"may equal live production `public_id`s until the fresh start (`CAT-3` K7) or SEC-6; never authorization"_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/runbooks.md`                                                       | EDIT       | Both preconditions → § "What lifts the preconditions", **keeping the seed-id refusal** (only the fresh start or SEC-6 removes such a row); a `0032`-style line is not needed (no migration); "Manually re-seed": fresh `origin/main` only, never re-run old runs; "Rename / correct a seeded profile": the production seed writes no profile.                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/privacy/notice.md`, `apps/web/lib/privacy/notice-content.ts`       | EDIT       | The sentence becomes, exactly: _"…the athletes the app started with cannot be erased one at a time yet, because an older copy of the setup could put them back; they are removed together, with the rest of the starting data, when the app is started fresh."_ True before and after PR 1; R0 replaces it. After the household-delete sentence (_"Ask, and your household is deleted …"_) it adds, exactly: _"The household the app started with is the one exception for now: it is removed with the rest of the starting data when the app is started fresh, not on its own."_ `pnpm privacy:generate` regenerates `notice-content.ts` (its byte-exact test fails on drift), and the "Last updated" date is bumped. |
| `docs/privacy/data-inventory.md`                                         | EDIT       | §1a's `profiles` note and §9's residual: restated for a production seed that writes no profile. **§5 gains:** a household or athlete whose `public_id` is in `SEED_PUBLIC_IDS` is removed by neither path; the fresh start (`CAT-3` K7) removes it (`runbooks.md` § What lifts the preconditions). The staleness command (§ header) gains `packages/db/src/seed.ts` and `packages/db/scripts/corrections/`, which §1a's `households` row names as writers.                                                                                                                                                                                                                                                             |
| `docs/features/write-path.md`                                            | EDIT       | A one-line trap: a household-scoped seed write goes inside the `fixtures` branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/features/programming.md`                                           | EDIT       | Only the personal name at `:32` and `:129` (pre-existing, found by round 2): the role instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/architecture.md`                                                   | EDIT       | The prod-seed edge reads "reference seed"; the 1c-4 creator note sits under the fixtures branch; the deletion diagram's "household is not in the seed … `OPS-2`" precondition points at the check. **A new flowchart here** (flag → branch → tables written, per estate), reused in the PR description.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/service-setup.md`                                                  | EDIT       | The preview holds role-named fixtures plus whatever previews wrote.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/deploy.md`, `README.md`, `apps/web/.env.example`                   | EDIT       | A new deployment gets `…010` from 0001, reference data from `db:seed`, and **no athletes and no member**. A local `db:seed` needs `SEED_FIXTURES=1` for the fixture athletes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/plans/fam-1-family-program.md`                                     | EDIT       | OPS-2 PR 1's guest row in the seam table (`write-path.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/plan.md`                                                           | EDIT       | OPS-2 row only: the personal name, the `PROGRAM_SEED` clause, PR states. SEC-6's row is R0's (refresh 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `docs/milestones/beta-1.md`                                              | EDIT       | The "no test athletes" box; row 7 → two PRs; the OPS-2 description (personal name, `PROGRAM_SEED`) and the table note on the first program write; the step chart.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/tech-debt.md`                                                      | EDIT       | Close "The seed's ramp-target expansion reads every household's kid profiles" (D4, Q6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/status.md`, `docs/roadmap.md`, changelog                           | EDIT/NEW   | "Status rides with the work"; the order in § Where this sits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### PR 2 · `fix/ops-2-2-fixture-athlete` (~120 lines; after PR 1 and PRIV-3 PR 1)

| Path                                                                     | Change   | What & why                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/registry.ts`                            | EDIT     | D10's correction, counting over PRIV-3's `ATHLETE_GRAPH`. `issue: 'OPS-2'`.                                                                                                                                                        |
| `packages/db/scripts/verify/seed.ts`                                     | EDIT     | In a rolled-back sandbox: dry run reports; `--apply` soft-deletes; a second `--apply` is a no-op; a renamed fixture refuses; a fixture with a **soft-deleted** entry refuses; afterwards `seed()` in both modes leaves it deleted. |
| `packages/db/scripts/corrections/README.md`                              | EDIT     | Applied row, `pending`. The target is a public fixture const.                                                                                                                                                                      |
| `docs/runbooks.md`                                                       | EDIT     | A soft-deleted fixture profile is **not** re-created (the existing claim is false: the unique is non-partial).                                                                                                                     |
| `docs/privacy/notice.md`                                                 | EDIT     | No edit: PR 1\'s sentence already gives no count, and a soft-deleted test athlete is still "removed together … when the app is started fresh".                                                                                     |
| `docs/milestones/beta-1.md`                                              | EDIT     | Tick "no test athletes" in the follow-up commit that dates the Applied row.                                                                                                                                                        |
| `docs/changelog/<date>-fix-ops-2-2-fixture-athlete.md`, `docs/status.md` | NEW/EDIT | Fragment and status line.                                                                                                                                                                                                          |

## Test plan

All in `verify/seed.ts` unless noted. **Every "does not throw" is `assert.doesNotReject(fn, '<named
message>')`**, never a bare `await`: a thrown `Error` is not an `AssertionError`, so the mutation gate
would report it as the wrong assertion (round 3 C-S2). Those messages are the `.expect`s.

**What "household-scoped" means here is `HOUSEHOLD_GRAPH`**, not "every table outside the reference
set" (round 3 D-S4, C-S4): `movements` and the two join tables hold both global and household rows, and
the graph scopes each per household (`src/erasure/graph.ts`; P2 holds it against `pg_constraint`). A
table FAM-1 adds is covered by P1's rule that every table is in the graph or `REFERENCE_TABLES`.

**Proof A, on the main PGlite, after A1's `verifyCatalogMigrationFacts()` and before the first fixture seed**
(so the TEN-2c block and A1's early entry point stay first; `harness.ts`'s exceptions docblock names this
as the second exception to "last"): `seed({ fixtures: false })` twice, each
wrapped. `REFERENCE_TABLES` equal their consts (`assertRefTableMatches`, `equipment` and `muscles`
included) and the global movements equal `MOVEMENT_SEED_ROWS`; for every `HOUSEHOLD_GRAPH` entry,
`householdRows(…010's scope)` counts **0**, except `households`, which holds exactly the migration's
`…010`. On the fresh database `…010` is the only household, so this covers every household row. This is
a fork's first run. Mutations `326` and `45`.

**Proof B, late (called beside the module calls at the end of `verify.ts`), each case in a rolled-back
sandbox on the fixture world, every `seed` call on the transaction's handle (`seed(asDb(tx), …)`): a
`seed(asPg, …)` inside `rolledBack` waits forever on PGlite's single connection.** "Removing `…010`" uses the 1c-4 block's construction: rename its
`public_id` and soft-delete households as each case says, which is what the seed sees after a hard
delete (`seedReference` never reads `households`; the guard filters on `deleted_at`; the insert's
conflict target is `public_id`) and cannot abort on another household's references (round 3 C-S5).

1. Add one more household with a kid. `seed({ fixtures: false })` → no `HOUSEHOLD_GRAPH` count changes
   for any household.
2. **`…010` removed, no live household left** (every other household soft-deleted, the live count
   asserted 0 first) → does not throw and **creates no household or profile**. Mutation `328`.
3. **`…010` removed, another household live** → does not throw; nothing created. (`327` reddens C
   first; B3 is kept for the state, not for a mutation of its own.)
4. In a shadowed-catalog state, `captureWarnings(seed({ fixtures: false }))` → the TEN-2c warning
   appears. Mutation `329`.
5. **`…010` and its profiles soft-deleted, every other household too** → does not throw; no count
   changes. It has no mutation (under `326` it stays green: the tombstoned `…010` makes every insert conflict,
   D8's row 3); it is kept to pin the tombstone state, as B3 is (round 3 C-S6, D-N6, re-review).

**Proof C, in the existing 1c-4 rename block** (`verify.ts:294-371`, where the resolve finds nothing):
one added, wrapped `seed(asPg, { fixtures: false })`. Mutation `327`.

`verify/schema.ts`'s step-1 `fixtures: false` half (lane P's) stays as a second check; Proof A is now
the first failure for `45`.

The old-code proof (a replay of old statements against tombstones) is **not here**: Q2 chose no
tombstones.

**Unit (Vitest):** D11's whole expression in the source pin (`options.fixtures ? '✓ seed complete (fixtures)' : '✓ seed complete (reference data only)'`), so a swapped ternary fails. **CI:** `db:verify`; e2e, every spec, the
screenshot harness and `global.setup.ts` passing **unedited**. **Local:** `pnpm verify`, `pnpm
db:mutations` (pasted in PR 1), `pnpm e2e:local`.

## Manual production steps

Results that describe real people stay **off the PR**: the operator records them privately and pastes
one line per step.

| #   | When                         | Step                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | before opening PR 1          | Neon SQL editor, production, inside `BEGIN READ ONLY; … ROLLBACK;`: `…010` live; `…001`–`…003` live; and, for `…003` only (a fixture), `name = SEED_PROFILE_3_NAME` and its child count, with no `deleted_at` filter, in every `ERASE_ATHLETE` table. **Paste one line:** _"F1 matches the transition table and D10's preconditions: yes/no"_. |
| M1  | on PR 1's first prod run     | `gh run view <id> --log` contains `✓ seed complete (reference data only)`.                                                                                                                                                                                                                                                                     |
| M2  | after PR 2 merges            | `db:correct fixture-athlete-in-production-…`: dry run, read, then `--apply`. Date the Applied row.                                                                                                                                                                                                                                             |
| M3  | before each seed-id deletion | § "What lifts the preconditions", merges frozen.                                                                                                                                                                                                                                                                                               |

**No rehearsal on a branch of production** (the first draft's R1, dropped in round 2).
`architecture.md` requires a prod-shaped rehearsal to branch the preview project or use an anonymised
snapshot, because a branch copies every family's data. PR 1's production path is the reference
statements production already runs on every push, minus the household block, and proofs A–C run it on
the shapes production can be in. PR 2's dry run against production is read-only and is its own
rehearsal.

## Risks / rollback

| Risk                                                          | Mitigation                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The production seed throws in prod, turning `migrate.yml` red | No migration; one fewer throw site; proofs A–C on every state production can reach.                                                                                |
| A harness or a local run silently loses its fixtures          | Every harness already sets the flag (#432); a missed one fails at `global.setup.ts`'s picker assertion. `.env.example` names the flag for a hand-run local seed.   |
| Fixtures reach production through a hand-run command          | #432's allowlist refuses the flag against a URL that is neither local nor preview, before connecting. Named limit (shared with OPS-1): a localhost tunnel to prod. |
| Old seed code runs against prod after a seed-id deletion      | D8's answer (Q2); "fresh `origin/main` only"; never re-run a pre-PR-1 run.                                                                                         |
| Hot files shared with FAM-1, PRIV-3 and OPS-3                 | § Where this sits: one order, a guest slot in FAM-1's queue, proofs in their own module; `seedProgram` and `seedProgramFixtures` untouched.                        |

**Rollback.** PR 1: a revert restores today's code, which (D8's table) is harmless against live,
soft-deleted or tombstoned seed rows. **It is unsafe only after a seed-id row was hard-deleted without
a tombstone** (Q2 (a) or (c)): then today's code re-creates seed rows (with whatever names that version carried) or wedges. So after such a
deletion PR 1 is fix-forward only, and the runbook says so beside the check. PR 2 is undone with one
guarded `UPDATE … SET deleted_at = NULL, updated_at = now()` by `public_id`.

## Downstream: what the sibling drafts must reconcile

| Draft  | Cites                                                                       | Becomes                                                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRIV-3 | waits on "OPS-2 PR 1b"                                                      | OPS-2 PR 1                                                                                                                                                                                                                 |
| PRIV-3 | takes `SEED_HOUSEHOLD_WRITE_LOCK` (`OPS-2` D6)                              | withdrawn (D6); a lock against OPS-3's restore, if wanted, is PRIV-3's and OPS-3's to define                                                                                                                               |
| PRIV-3 | the lift check as "M4"                                                      | M3, § "What lifts the preconditions"                                                                                                                                                                                       |
| PRIV-3 | D6 tombstones "agree with OPS-2 D8"; old code "throws with nothing written" | Q2 chose (a): no tombstones. PRIV-3's D6 and its tombstone writer go; the seeded household is removed by `CAT-3`'s fresh start (K7), other seed-id rows after SEC-6's re-key                                               |
| PRIV-3 | proof P8 calls `seedProductionDatabase` and asserts "OPS-2's skip line"     | `seed({ fixtures: false })`; there is no skip line (D11's production line instead)                                                                                                                                         |
| PRIV-3 | the seed-household row: "no refusal; a tombstone instead"                   | **a refusal**: the seeded household is removed by `CAT-3`'s fresh start (K7), any other seed-id row after SEC-6's re-key (Q2 (a)); no tombstone, no `isSeedTombstone`, no lock. Reconciled in PRIV-3's refresh, 2026-11-17 |
| PRIV-3 | `ERASE_ATHLETE` moved by OPS-2 PR 2 (D10)                                   | PRIV-3 PR 1 exports `ATHLETE_GRAPH` from `src/erasure/graph.ts`, before OPS-2 PR 2, which imports it and moves nothing (2026-11-17)                                                                                        |
| PRIV-3 | runbook precondition 2 (athlete erasure)                                    | OPS-2 PR 1 rewrites it first (§ "What lifts the preconditions"); PRIV-3 PR 2b then edits OPS-2's text, not the old one (2026-11-17)                                                                                        |
| OPS-3  | takes the lock (D6); relies on D8 tombstones                                | as for PRIV-3. Production's seed writes nothing household-scoped, so a restored household is never topped up by a push                                                                                                     |
| OPS-3  | A-S7: assert the reference table set                                        | taken up: proof A's derived set                                                                                                                                                                                            |
| SEC-6  | gated on `PROGRAM_SEED` leaving prod                                        | for the seeded household, replaced by the fresh start (K7, R0 restates the row); otherwise gated on OPS-2 PR 1 (D9), and must respect `ID-1`'s lifetime `public_id`                                                        |

## Alternatives considered

| Alternative                                                   | Why not                                                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A second entrypoint `db:seed:fixtures` (first draft's D2)     | #432's required option and URL allowlist give the same safe default, already on every caller.                                             |
| Keep the ramp expansion (Q6 (b), (c))                         | Code, proofs and mutations for a schedule that is `[]`; (c) also brings back a resolve, a tolerance and a lock.                           |
| A CI step running the production seed after the fixture seed  | Its reason (round 1, S6) was the 1c-4 throw site in the production path, which PR 1 removes; proofs A–C cover what is left at no CI cost. |
| A rehearsal on a Neon branch of production (first draft's R1) | Copies every family's data, against `architecture.md`'s rule, for a path proofs A–C already cover.                                        |
| A `households.seeded` marker column                           | DDL for what the flag does without it.                                                                                                    |
| Hard delete or in-app archive of the test athlete             | D10.                                                                                                                                      |
| Re-key the seed ids in OPS-2                                  | D9: SEC-6 owns it.                                                                                                                        |

## Out-of-scope / deferred

- SEC-6's re-key (D9), and PRIV-3's tombstone writer if Q2 picks (b).
- Household creation for a fork or an invited family (the invite row).
- A real path for a non-empty ramp schedule to reach a household (if Q6 picks (a)).

## Maintainer decisions

All answered; none is open.

- **Q1 (D7) — answered by #432:** preview gets fixtures.
- **Q2 (D8) — for the seeded household, superseded by `CAT-3`'s fresh start** _(K7, maintainer, 2026-11-17)_; **(a), re-key first, remains the path for any other seed-id row** _(maintainer, 2026-11-16)_. SEC-6's production-only re-key runs
  before the first seed-id deletion; the family's rows get ordinary ids and are hard-deleted like
  anyone's. **No tombstones.** SEC-6 joins the deletion path and must respect `ID-1`: a `public_id` is
  the athlete's for life. How a one-time re-key squares with that is SEC-6's to answer in its plan.
- **Q3 (D5) — answered by #432** (FAM-1 D10): `PROGRAM_SEED` no longer reaches production.
- **Q4 (D10) — the guarded soft-delete correction** _(maintainer, 2026-11-16)_.
- **Q5 — answered:** two PRs.
- **Q6 (D4) — (a), delete it** _(maintainer, 2026-11-16)_. It also closes `tech-debt.md`'s "The seed's
  ramp-target expansion reads every household's kid profiles", which PR 1 removes.

## Review-response log (adversarial panel)

### Round 3 (2026-11-17, refresh 2)

> Panel: correctness 159k · 8m, db-safety 135k · 7m, privacy 116k · 4.5m. Models: high-stakes production seed · every lens: opus (the Fable cap runs until 2026-11-19).

| #                      | Lens                   | Critique (short)                                                                                                                                  | Verdict                    | Resolution                                                                                                                                  |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P-B1                   | Privacy                | **BLOCKING.** PR 1 replaced the runbook's refusals with a check that licenses a seed-id deletion, while old code can re-create the row            | **accepted**               | § What lifts: the refusal stays; only the fresh start or SEC-6 removes a seed-id row; the check is their precondition                       |
| D-B1                   | DB-safety              | **BLOCKING.** `MOVEMENT_SEED_ROWS` keeps reaching production; the fresh start deletes them and any seed puts them back. Nobody owns removing them | **accepted**               | D1: temporary in PR 1; A2 moves them under `fixtures` (spec E4); A2 is the second never-re-run cut-off; fix-forward from fresh-start step 3 |
| C-B1                   | Correctness            | **BLOCKING.** Mutation `45` cannot fail on its old `.expect`: Proof A runs the hoisted `seedProgram` first, on a database with no profiles        | **accepted**               | `45`'s `.expect` moves to Proof A's message                                                                                                 |
| P-S1                   | Privacy                | Q2, D9, § Downstream, the `plan.md` row and the order still said "re-key first"; K15 missing                                                      | **accepted**               | Each restated; SEC-6's row is R0's; the K15 exception in the order                                                                          |
| P-S2                   | Privacy                | "Old code can at worst re-create role-named rows" is false for the oldest generation                                                              | **accepted**               | Restated without naming history; R4's second run is the control                                                                             |
| P-S3                   | Privacy                | The notice edit was not true in the window, and missed `notice-content.ts` and the date                                                           | **accepted**               | The exact sentence is in the file table                                                                                                     |
| P-S4                   | Privacy                | Inventory §5 had no row behind "cannot yet"; the staleness command missed the seed                                                                | **accepted**               | §5 line and both paths added                                                                                                                |
| D-S3                   | DB-safety              | Check 1 could not see a re-run of an old run                                                                                                      | **accepted**               | `--status in_progress / queued / waiting`, unlimited                                                                                        |
| D-S4, C-S4             | Both                   | Proof A's derived set misclassified `movements` and the join tables; the FK claim was wrong                                                       | **accepted**               | Proof A is built on `HOUSEHOLD_GRAPH`; the claim corrected                                                                                  |
| D-S5                   | DB-safety              | "PR 1 deployed" had no check                                                                                                                      | **accepted**               | § What lifts defines it, run before RC's apply and fresh-start step 3                                                                       |
| C-S2                   | Correctness            | Bare `await`s report as the wrong assertion                                                                                                       | **accepted**               | `assert.doesNotReject` with named messages                                                                                                  |
| C-S3, C-S5, C-S6, D-N6 | Correctness, DB-safety | B's placement, construction and the missing soft-deleted case                                                                                     | **accepted**               | B is late; the 1c-4 construction; B5 added, its mutation said honestly                                                                      |
| D-S2                   | DB-safety              | Enforce "never re-run" by renaming the database secret `migrate.yml` reads, so an old run's empty-secret guard makes it a green no-op             | **open: the maintainer's** | A change to production's GitHub secrets and an operator step, so it is the maintainer's decision, not this plan's. Recommended              |
| N                      | Several                | D1's behaviour change stated; D11's whole expression pinned; stale cites; `household-graph.ts`; seed-ids docblock; `RampWeek` loses its consumer  | **accepted**               | In the text; `RampWeek` goes with `CALISTHENICS_RAMP_SCHEDULE`                                                                              |

**Re-review (round 3):**

- **Privacy:** P-B1 resolved. Four leftovers fixed: the PRIV-3 row of § Downstream; D8 (a) and Rollback's "role-named" claim; PR 2's notice row; the household clause, now word for word.
- **DB-safety:** D-B1 is half resolved. The spec's owner must add A2's duty (routed through the board), and the plan says "proposed". Check 1 gains `attempt`/`updatedAt` and `pending`/`requested`.

- **Correctness:** no blocking finding. Every mutation reaches its own proof first. Fixed: Proof A's place, after A1's early function (`harness.ts` row added); B5 has no mutation; Proof B seeds on the transaction's handle.

**Found outside the plan (DB-safety), for the board's P2 list:** the `units` upsert sets `dimension`,
part of a key composite FKs reference, so it takes a full row lock on every push, with no
`lock_timeout` on the seed (from #137). Low impact; not this PR's.

### Round 2 (2026-11-16, the refresh)

> Panel cost: correctness 100k tokens · 4.2 min · DB-safety 104k · 4.6 min · architecture 119k ·
> 4.9 min · simplicity + reuse 85k · 2.5 min · privacy 85k · 2.5 min. All five on Opus. (Cost only: it
> cannot show what a cheaper lens missed.)

Five lenses. **Four blocking findings, all accepted**; three lenses found the first independently.

| #     | Lens                          | Critique                                                                                                                                                                                         | Verdict                   | Change                                                                                                                                               |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1  | correctness, DB-safety, scope | 🔴 No proof builds an **absent** seed household; the resolve has no `deleted_at` filter, so a tombstone is always found and mutation (c) cannot fail                                             | **accepted**              | Proof B2/B3 hard-delete `…010`; proof C reuses the 1c-4 rename block; mutations (c) and (e) aimed there                                              |
| R2-2  | privacy, DB-safety, arch      | 🔴 "The tombstone holds no personal data" is false (`birthdate`, `avatar`, `pin_hash`, `kind`, timestamps), and a tombstone contradicts the notice's "permanently removed, not hidden"           | **accepted**              | D8 re-opened: Q2 is (a) SEC-6 re-key first (recommended), (b) a fully constant tombstone plus notice edits, (c) prose                                |
| R2-3  | privacy                       | 🔴 F1 would paste facts about real minors' profiles (archived?, live?) and the household count into a public PR                                                                                  | **accepted**              | Results recorded privately; one yes/no line pasted                                                                                                   |
| R2-4  | architecture                  | 🔴 Renumbered D/Q ids broke citations in merged docs (`fam-1` D10 "OPS-2 Q3", `beta-1.md`) and both sibling drafts                                                                               | **accepted**              | First draft's ids kept; withdrawn ids marked, never reused; new ones are D11 and Q6                                                                  |
| R2-5  | correctness                   | B6's "no live household" is unreachable: the main PGlite holds several                                                                                                                           | **accepted**              | B2 soft-deletes every live household and asserts zero first                                                                                          |
| R2-6  | correctness                   | The old-code table misses the pre-1c-4 generation, still re-runnable                                                                                                                             | **accepted**              | Three rows in D8's table                                                                                                                             |
| R2-7  | correctness, DB-safety        | Rollback contradicts the old-code table: today's code is green against a tombstone                                                                                                               | **accepted**              | Revert is unsafe only after a hard delete without a tombstone                                                                                        |
| R2-8  | correctness, scope            | The ramp proofs cannot catch two of three rules; and if the expansion leaves production, extracting it is YAGNI                                                                                  | **accepted**              | Q6 recommends deleting it, which removes the proofs in question                                                                                      |
| R2-9  | correctness                   | The shadow report has no proof on the production path; moving its detection changes its meaning once lane P writes owned movements                                                               | **accepted**              | B4 + mutation (f); detection stays inside `seedReference`, where it is today                                                                         |
| R2-10 | DB-safety                     | The lift check proves strings, not behaviour: no `headSha`, no success filter, no queued-run check, nothing from `ci.yml`                                                                        | **accepted**              | Check 1 compares `headSha` to `origin/main`, success, nothing queued; check 2 is `ci.yml` on that commit                                             |
| R2-11 | DB-safety, scope              | Check 3 is vacuous under tombstones; `gh run delete` destroys production's migration record                                                                                                      | **accepted**              | Dropped; D8's answer is the control; runs are never deleted                                                                                          |
| R2-12 | DB-safety, arch               | The tombstone shape is defined twice, differently from PRIV-3's                                                                                                                                  | **accepted**              | OPS-2 defines no shape; (b) takes PRIV-3's writer                                                                                                    |
| R2-13 | DB-safety                     | The old-code replay covers inserts, not the resolve and refusal                                                                                                                                  | **accepted, moved**       | With R2-2 the replay proves PRIV-3's writer, and goes there if Q2 picks (b) (scope's finding agrees)                                                 |
| R2-14 | DB-safety, arch               | § Downstream lists only the lock; PRIV-3 and OPS-3 cite five renamed or removed contracts                                                                                                        | **accepted**              | § Downstream is a table, citation by citation, with the real reason the lock goes                                                                    |
| R2-15 | DB-safety                     | F1 does not collect what D10 refuses on                                                                                                                                                          | **accepted**              | F1 checks `…003`'s name and child counts                                                                                                             |
| R2-16 | DB-safety                     | D10 omits the correction pattern's timeouts; counts must follow the lock; use `isLiveProfile` + `inHousehold`                                                                                    | **accepted**              | D10 restated                                                                                                                                         |
| R2-17 | scope, correctness            | D10's "re-count from `schema.ts`" makes a second copy of `ERASE_ATHLETE`; and it is six tables, not five                                                                                         | **accepted**              | PR 2 moves `ERASE_ATHLETE` to an importable module; the correction counts over it. _Superseded 2026-11-17:_ it imports PRIV-3 PR 1's `ATHLETE_GRAPH` |
| R2-18 | privacy, scope, arch          | The athlete erasure's precondition 2 also waits on OPS-2; the notice, inventory, `migrate.yml`, `architecture.md`'s deletion diagram, `beta-1.md`, `seed.ts` strings and `.env.example` go stale | **accepted**              | All in PR 1's (or PR 2's) file table                                                                                                                 |
| R2-19 | architecture                  | The order omits OPS-3 and disagrees with PRIV-3's agreed order; gate 1 lists too few files                                                                                                       | **accepted**              | § Where this sits takes PRIV-3's five-step order and lists every shared file                                                                         |
| R2-20 | architecture                  | The write-path guest turn is not recorded; lane A has merged; proofs belong in a `verify/<area>.ts` module                                                                                       | **accepted**              | Guest row in FAM-1's seam table; `verify/seed.ts`                                                                                                    |
| R2-21 | architecture                  | D9 overstates OPS-2 (migration 0001 still writes `…010`); SEC-6's fix and acceptance are obsolete; re-keying meets `ID-1`'s lifetime identity                                                    | **accepted**              | D9 restates SEC-6's fix, acceptance, gate, and the `ID-1` item it owes                                                                               |
| R2-22 | privacy                       | R1 copies production twice with no close-out and no inventory row                                                                                                                                | **accepted, differently** | R1 dropped: `architecture.md` already forbids a prod-branch rehearsal, and proofs A–C cover the path                                                 |
| R2-23 | privacy                       | D5's pointer to where git history holds the names, and the `seed-ids.ts` wording, are new signposts                                                                                              | **accepted**              | Pointer removed; docblock reworded                                                                                                                   |
| R2-24 | scope                         | The CI production-seed run's reason (round 1 S6) is gone with the 1c-4 throw site                                                                                                                | **accepted**              | Dropped; round 1's S6 rejection no longer holds (§ Alternatives)                                                                                     |
| R2-25 | scope                         | The log-line constant has one use; the grep step is redundant                                                                                                                                    | **accepted**              | Literals pinned in `seed.test.ts`; the grep step dropped                                                                                             |
| R2-26 | scope                         | Drop the round-1 table; keep only its rejections                                                                                                                                                 | **rejected**              | Kept: this branch squashes, and the table exists nowhere else on `main`. Its cites are marked as against `200a697`                                   |
| R2-27 | scope                         | Drop the `programming.md` row                                                                                                                                                                    | **accepted, narrowed**    | Its seed restatement goes; the row stays only to replace the pre-existing personal name (architecture's outside-the-diff finding)                    |
| R2-28 | architecture                  | The flowchart belongs in `architecture.md`                                                                                                                                                       | **accepted**              | Added there, reused in the PR                                                                                                                        |
| R2-29 | correctness, arch             | Cites: seven `verify.ts` callers, `seed()` ends at `:456`, six tables, `seedRampTargets` export                                                                                                  | **accepted**              | Facts table corrected; `seedRampTargets` gone with D4                                                                                                |
| R2-30 | DB-safety                     | F1 should be `BEGIN READ ONLY`; derive "household-scoped tables" from the schema                                                                                                                 | **accepted**              | Both                                                                                                                                                 |
| R2-31 | correctness                   | Patches 10 and 45 will not apply after D1                                                                                                                                                        | **accepted**              | Named in the mutations row                                                                                                                           |
| R2-32 | correctness                   | PR 2's undo should set `updated_at`                                                                                                                                                              | **accepted**              | Rollback                                                                                                                                             |

**Open blocking items after reconciliation:** none. The maintainer answered Q2 (a), Q4 and Q6 (a) on
2026-11-16 (§ Maintainer decisions).

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
