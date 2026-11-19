# FAM-1: an e2e-only seed athlete for the Change e2e

- **Backlog:** a follow-up from #607 (FAM-1 12d). Its review left one P2 unfixed: only one day of
  the week's path through the Change e2e has run. The board assigned it to lane P on 2026-11-17
  and 2026-11-18.
- **Branch:** `feat/fam-1-e2e-change-athlete`. **Gates:** #592 (merged: the seed split into
  `seedReference` and `seedFixtures`) and #641 (lane P's open draft, which edits
  `seed-fixtures.ts`).
- **Unblocks:** lane C's Change e2e (`apps/web/e2e/day-page.spec.ts`) on every path: today and
  yesterday, in each of the two superset workouts (Heavy A and Heavy B), whatever day of the week
  the suite runs. Today Athlete Two has only one of those workouts, on four days of the week.
- Roadmap alignment (2026-11-19): checked against the private roadmap; nothing to add here; touches
  no `ID-1` item.

## Acceptance

After a fixture seed, the test database holds one more athlete, **Athlete Four**, on one test
program that has Heavy A and then Heavy B on every day of the week, from a fixed past day. On every
day from then on, Athlete Four's day page shows both workouts, today and yesterday. Production's
seed writes none of it.

## Alternatives considered

- **Change Athlete Two's fixture world:** that is the contract owner's (`world.ts`), and every read
  deep-equal, the a11y scan and the preview read it.
- **A second program on Athlete Two:** changes the page the check-in, a11y and switcher specs read.
- **Athlete Three:** owned by the archive specs (`seed-ids.ts`'s warning).
- **An athlete the spec adds itself:** cannot reach yesterday (`putOn` takes today or tomorrow), and
  no Put on control is wired yet.
- **Seeding logged rows:** does not change which day of the week a workout falls on.

So a dedicated athlete on a dedicated program is the smallest change.

## What it does

1. **The athlete.** In `packages/shared/src/seed-ids.ts`:
   - `SEED_PROFILE_4_PUBLIC_ID` (`…000000000004`) and `SEED_PROFILE_4_NAME` ("Athlete Four", a role
     name), added to `SEED_PUBLIC_IDS`;
   - its docblock says, as `SEED_PROFILE_3`'s does, **owned by the Change e2e; do not reach for it
     for anything else**, and that no seed ever wrote this id to production, so a row found there
     means a mis-targeted fixture seed.

   Its row is in `seedFixtures` (`packages/db/src/seed.ts`), fixtures only, beside the other three:
   `kind: kid`, `routineConfig` NULL (the neutral routine, the smallest page for the 360px axe
   scans), `onConflictDoNothing` on `public_id`. Re-exported from `seed.ts` and
   `packages/db/src/index.ts` as the others are.

2. **The program, as data**, in a new `packages/db/src/writers/program/seed-e2e.ts`. It is **not a
   contract fixture**, and `seed-fixtures.ts`'s header and consts stay the world's. The program:
   - is named `Test – Change e2e` (it reads as test data in the preview's Programs list);
   - has a fixed `client_id`, `SEED_E2E_PROGRAM_CLIENT_ID`, outside the fixture ids (proved: not in
     `SEED_FIXTURE_PROGRAM_CLIENT_IDS`);
   - holds two workouts, the world's Heavy A and Heavy B drafts (`w2`, `w3`);
   - has a week with **Heavy A then Heavy B on all seven days**;
   - puts Athlete Four on from **`FIXTURE_SWITCH_DAY`**, a fixed past day, passed as both `from` and
     `today`, as the world's starts are. **No clock is read**, so the program is on whatever day the
     suite runs, in any time zone. The e2e browser runs on Los Angeles time and CI's seed on UTC, so
     a "yesterday" taken from the seed's clock would miss the e2e's yesterday for eight hours a day.
3. **One per-program function.** `seedProgramFixtures`' loop becomes a function over a program spec
   (program, `client_id`, athletes and starts), run for each world program and then for the e2e one.
   So the e2e program gets every skip invariant 19 lists:
   - a program the household already has by that `client_id`;
   - an archived or removed athlete, who is put on nothing;
   - `name_taken`;
   - an item the household has under another type.

   It also gets the same idempotency, and mutations 411, 415 and 416 cover it. **The e2e program is
   made only when Athlete Four is live and active**, so a run before the profile exists never leaves
   it with nobody on it.
   - Skips print a fixture key, never a stored name (`skip`).
   - Found outside the diff and fixed here: `newItem`'s `limit_reached` becomes a skip, not a throw.
     It is state a person can make (500 items), and the preview database is lived in.

4. **Counts, kept apart.** `SEED_FIXTURE_COUNTS` and `SEED_FIXTURE_PROGRAM_CLIENT_IDS` stay the
   world's, and the read deep-equals keep using them. A new `SEED_PROGRAM_CLIENT_IDS` (world and e2e)
   and totals serve the two proofs that count every block of the seed household (below).

## Where else a fourth athlete shows

Each was checked with a grep; the counts there are relative or by name, so nothing breaks.

- The picker, Home, the athlete switcher and the app rail, on every page.
- Settings' athlete list.
- Every program page's Put on candidates.
- `screenshot-ephemeral.ts` captures.

`day-navigation.spec.ts` archives its own athletes for the same reason. Athlete Four counts toward
`MAX_HOUSEHOLD_ATHLETES` (25), which per-run specs draw on.

**Lane B is told:** once 7b-i lands, `/programs` lists one more program, so its real-data specs must
not count programs or compare the list with `programsList`.

## Production, privacy, erasure

- **Production:** no workflow seeds fixtures. `migrate.yml` never sets the flag, and
  `seed-fixtures-is-contained.test.ts` pins that. OPS-2's Proof A already asserts that the
  production seed writes zero rows in every household table (`verify/seed.ts`), and mutations 45 and
  326 cover it.
  - **The accepted limit:** a hand-run that slips past the seed's database allowlist (a production
    database named `*preview*`, or a tunnel on localhost) would write fixtures into the live
    household. `…0004` is the first seed profile not already there, so that run would now add a row.
    This widens an accepted risk by one row; it does not create a new one.
- **Erasure:** no new table. As a seed id, Athlete Four is refused by both removal procedures
  (`runbooks.md`) and leaves a test database only by the preview reset.
- **Inventory:** one dated note (§1a, §5, §9): the fixture seed writes a fourth synthetic profile
  and one test program; never production; in `SEED_PUBLIC_IDS`; no new column, processor, reader,
  export or retention. **The notice needs no change**: production never holds it.

## What the Change spec can rely on (lane C)

- **Athlete:** `SEED_PROFILE_4_PUBLIC_ID` and `SEED_PROFILE_4_NAME`, from `@mat-plan/db` as the
  others are; no other spec writes this athlete's rows.
- **Workouts:** Heavy A then Heavy B, on every day of the week since `FIXTURE_SWITCH_DAY`; names from
  the world, never re-typed.
- **Locators:** each workout has its own superset "A", so the page has two lists named "Superset A".
  A locator must be scoped to the workout's region, not `.first()`.

## Files

| File                                               | Change                                                                                                                                          | Owner / grant                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/shared/src/seed-ids.ts`                  | the id, the name, the set                                                                                                                       | **board guest edit, 2026-11-19**                           |
| `packages/db/src/seed.ts`                          | the profile row; the re-export; "three athletes" in four comments                                                                               | **board guest edit, 2026-11-19** (the row); the rest asked |
| `packages/db/src/index.ts`                         | re-export the new id and name                                                                                                                   | seam: asked of the board                                   |
| `packages/db/scripts/verify.ts`                    | the OSS-1 guard's name list gains "Athlete Four"; its comment                                                                                   | harness owner: asked                                       |
| `packages/db/scripts/verify/schema.ts`             | FAM-1 4a-i (every block outside the fixtures is legacy) and FAM-1 1 (the seed household's counts) read `SEED_PROGRAM_CLIENT_IDS` and the totals | lane A: asked                                              |
| `docs/features/write-path.md`                      | its `seed.ts` row                                                                                                                               | the write-path guide's queue: asked                        |
| `packages/db/src/writers/program/seed-fixtures.ts` | the per-program function; the `limit_reached` skip; `SEED_PROGRAM_CLIENT_IDS`                                                                   | lane P                                                     |
| N `packages/db/src/writers/program/seed-e2e.ts`    | the e2e program as data                                                                                                                         | lane P                                                     |
| `packages/db/scripts/verify/program.ts`            | the proofs below                                                                                                                                | lane P                                                     |
| `packages/db/scripts/mutations/`                   | 274 re-cut (its context is the set); 410, 411, 415, 416 re-cut if the function moves them; new patches from lane P's 581–589                    | lane P (274: its owner told)                               |
| `docs/features/program-writers.md`                 | a map row ("not a contract fixture"), invariant 1's exception list, invariant 19                                                                | lane P                                                     |
| `docs/privacy/data-inventory.md`                   | the dated note                                                                                                                                  | lane P                                                     |
| N changelog fragment                               |                                                                                                                                                 | lane P                                                     |

Lane C's spec uses the new consts in its own PR. This PR does not touch `day-page.spec.ts`.

## Tests (`db:verify`)

- **Through what the page renders** (`resolveDayPlan`), on literal days: for each of the seven days
  from `FIXTURE_SWITCH_DAY`, with `today` that day and the next:
  - Athlete Four's plan holds Heavy A then Heavy B, Heavy A's supersets a and b, Heavy B's a;
  - on the day before the start, nothing.
- `active_from` is `FIXTURE_SWITCH_DAY`.
- A second seed run writes nothing (`ctid`).
- **The lived-in preview:** the world's programs already exist and one of the e2e program's items is
  retyped, so the e2e program is skipped with a warning and the run succeeds.
- **No profile:** a household without a live, active Athlete Four gets no e2e program (household B; in the seed household the program already exists, so an archived case would only test the `client_id` skip).
- The world's deep-equals and counts are unchanged. These proofs come after the world's in
  `verifySeedFixtures`, so 410, 411, 415 and 416 still go red on their own lines.
- **Mutations** (new):
  - the e2e week left off one day;
  - the put on a day late;
  - the e2e program made without a live, active Athlete Four;
  - `limit_reached` thrown again.
- **Cited, not duplicated:** production writes none of it (OPS-2 Proof A, mutations 45 and 326); the
  set equals what the seed writes (mutation 274).

## Risks and rollback

Test data only. Revert the PR, and the next preview reset removes the rows. A stale athlete row on
the preview is harmless: nothing reads it but the Change e2e.

## Out of scope

Lane C's spec changes; any change to the fixture world; logged rows.

## Open questions

The four "asked" grants in Files: the board is asked in one message.

## Review-response log

The panel (correctness, privacy, architecture/scope; fable) on the first draft. Every finding is
agreed. The only decision was one PR or two; it is one, because a split lets the program land
before its athlete (correctness 5, privacy 5).

| Lens                                                        | Finding                                                                                | Verdict    | What changed                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| correctness P0, privacy P1, architecture P1                 | "the seed's yesterday" reads a clock in no named zone; the e2e is on Los Angeles time  | **agreed** | a fixed start, `FIXTURE_SWITCH_DAY`; no clock                 |
| architecture P0, correctness P1                             | owners undecided; `verify.ts`, `verify/schema.ts`, `write-path.md`, `index.ts` missing | **agreed** | the Files table, with owner and grant; four grants asked      |
| architecture P0 (split) vs correctness and privacy (one PR) | how to ship it                                                                         | **one PR** | the merge-order hazard; each guest edit named                 |
| architecture P1                                             | test-only data in the contract-fixture module                                          | **agreed** | `seed-e2e.ts`; `seed-fixtures.ts` stays the world's           |
| architecture P1, correctness P1, privacy P2                 | a second hand-written block misses two skips                                           | **agreed** | one per-program function; made only when Athlete Four is live |
| correctness P1                                              | the headline proof cannot fail (`assignmentDueOn` reads no workouts)                   | **agreed** | `resolveDayPlan` on seven literal days                        |
| correctness P1, architecture P1, privacy P2                 | duplicate mutations; 274 goes stale                                                    | **agreed** | dropped and cited; 274 re-cut                                 |
| privacy P2                                                  | erasure and corrections claims wrong                                                   | **agreed** | reworded                                                      |
| privacy P2                                                  | "production never" stated absolutely                                                   | **agreed** | the accepted limit stated                                     |
| privacy P2                                                  | inventory under-specified; notice not recorded                                         | **agreed** | the dated note; "notice: no change"                           |
| privacy P2, correctness                                     | skips must print fixture keys                                                          | **agreed** | stated                                                        |
| architecture P1                                             | surfaces not listed; lane B                                                            | **agreed** | listed; lane B told                                           |
| correctness P2, architecture P2                             | two "Superset A" lists; slot order                                                     | **agreed** | "What the Change spec can rely on"                            |
| correctness P2                                              | `routineConfig` unstated; stale "three athletes"                                       | **agreed** | NULL, with the reason; comments in Files                      |
| architecture P2                                             | wrong origin PR; "weekday"; missing template sections                                  | **fixed**  | #607; "every day of the week"; sections added                 |
| architecture                                                | a test program's name a non-engineer reads as test data                                | **agreed** | `Test – Change e2e`                                           |
| correctness (outside the diff)                              | `newItem`'s `limit_reached` throws in the seed                                         | **agreed** | a skip, here                                                  |
