# FAM-1: an e2e-only seed athlete for the Change e2e

Lane P's follow-up from #586 (the board, 2026-11-17 and 2026-11-18). The test seed gains **one
athlete owned by lane C's Change e2e** (`apps/web/e2e/day-page.spec.ts`, step 12d), on a program
that holds **both superset workouts, Heavy A and Heavy B, on every weekday**. That lets the e2e reach
each path (today and yesterday, both supersets) on any day the suite runs. Today Athlete Two has one
of them on four weekdays only.

- **Gates:** #592 (merged: the seed split into `seedReference` and `seedFixtures`).
- **Unblocks:** lane C's every-path Change e2e.
- Roadmap alignment (2026-11-19): checked against the private roadmap; nothing to add here; touches no `ID-1` item.

## What it does

1. **A fourth seed athlete**, `SEED_PROFILE_4_PUBLIC_ID` (`…000000000004`) and `SEED_PROFILE_4_NAME`
   ("Athlete Four", a role name), in `packages/shared/src/seed-ids.ts`. It is added to
   `SEED_PUBLIC_IDS`, so `db:verify`'s post-seed snapshot and the corrections' seed-id refusal cover
   it. Its docblock says what `SEED_PROFILE_3`'s does: **owned by one spec (the Change e2e); do not
   reach for it for anything else.**
2. **Its profile row**, in `seedFixtures` (`packages/db/src/seed.ts`), beside the other three:
   `kind: kid`, `onConflictDoNothing` on `public_id`, fixtures only. ⚠️ `seed.ts` is lane A's file,
   so this line is **a board-granted guest edit**, or a sentence sent to lane A.
3. **Its program**, in `seedProgramFixtures` (`packages/db/src/writers/program/seed-fixtures.ts`),
   after the fixture world. It is **not** part of the fixture world: a program `E2E supersets` with
   its own fixed `client_id`. It holds two workouts built from the world's `Heavy A` and `Heavy B`
   drafts (`workoutDraft`), and a week with both on every weekday. It is built with the same writers
   (`createProgram`, `saveWorkout`, `saveWeek`, `putOn`), so it is something a person could make.
   - **Athlete Four is put on it from the seed's yesterday** (`putOn`'s `today` = yesterday, as the
     world's past starts are), so yesterday's day page shows it as well as today's.
   - **Idempotent** as the world's programs are: a program the household already has by that
     `client_id` (live or removed) is left as it is; an archived or removed Athlete Four is put on
     nothing (a warning).
4. **It stays outside every deep-equal**:
   - `SEED_FIXTURE_COUNTS` and `SEED_FIXTURE_PROGRAM_CLIENT_IDS` stay the world's;
   - the seed proof counts the e2e program's rows separately;
   - no read fixture includes Athlete Four (the fixture world's athletes are `a1` to `a3`).

## Where else a fourth athlete shows

- **The athlete picker and Home** list every live athlete, so a fourth tile appears in the preview
  and the e2e app. Specs that count athletes or tiles (`athletes.spec.ts`, `a11y.spec.ts`) are
  checked: the counts there are by name or relative (`remaining - 1`), not a total. Any spec found
  to count a total is fixed in this PR.
- **The preview database** (`migrate-preview.yml`) gets Athlete Four and the program on its next
  seed. That is test data, by design (D10: only the test seed writes fixture programs).
- **Production** never: `seedReference` writes no athlete and no program. A proof asserts the
  production seed writes neither Athlete Four nor the program.
- **Erasure** (`erasure/graph.ts`): a seeded profile is erased like any other; nothing new.

## Files

- E `packages/shared/src/seed-ids.ts`: the id, the name, the set. (Lane A's or the contract owner's file: asked of the board.)
- E `packages/db/src/seed.ts`: the profile row (a board-granted guest edit).
- E `packages/db/src/writers/program/seed-fixtures.ts`: the e2e program and its put on; exported fixed `client_id` and counts for the proof.
- E `packages/db/scripts/verify/program.ts`: the seed proof (below).
- E mutation patches from lane P's block (580 onward).
- E `docs/features/program-writers.md`: the `seed-fixtures.ts` row and invariant 19's seed sentence; `docs/privacy/data-inventory.md` (a synthetic seed athlete, test databases only).
- N changelog fragment.

Lane C's spec uses the new consts in its own PR. This PR does not touch `day-page.spec.ts`.

## Tests (`db:verify`)

- After a fixture seed:
  - Athlete Four exists, live, in the seed household;
  - they're on `E2E supersets` from yesterday;
  - the program's week has Heavy A and Heavy B on all seven weekdays;
  - **both are due today and yesterday** (`assignmentDueOn`).
- A second seed run writes nothing (`ctid`).
- The world's deep-equals and counts are unchanged.
- The production seed (no fixtures) writes no Athlete Four and no `E2E supersets`.
- Mutations: the program left off a weekday; the put on dated today, so yesterday is not covered; the e2e program seeded without fixtures; Athlete Four missing from `SEED_PUBLIC_IDS`.

## Review-response log

_The panel has not run yet._
