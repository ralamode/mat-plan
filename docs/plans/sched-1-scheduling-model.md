# SCHED-1 — the scheduling model: assignment rows, a weekday set, and a pure resolver

> Backlog: [plan.md](../plan.md) row **SCHED-1**. Model: [ADR 0007](../decisions/0007-scheduling-model.md).
> Milestone: [beta-1.md](../milestones/beta-1.md) → Beta 1 ("which days a program runs").
> This plan ships on `docs/sched-1-scheduling-plan`; the implementing chunks get
> `refactor/sched-1a-shared-day-primitives`, `refactor/sched-1b-pure-resolver`,
> `db/sched-1c-program-assignments`, `db/sched-1d-seed-assignments`,
> `feat/sched-1e-today-reads-dueness`.
>
> **Plan only. No implementation code, no migration file, no schema edit in this PR.**
>
> **This plan implements ADR 0007's decisions; it does not relitigate them.** Where it departs from
> the ADR's _text_ it is because the text's measurement has drifted or its mechanism does not exist —
> each such departure is called out in "Corrections to the ADR's measurements", with what I measured.

## Goal

SCHED-1 replaces the one hardcoded app const that answers "what is this athlete supposed to do
today" with data. Today the entire scheduling layer is 43 lines with one exported function —
`resolveDayRole(day)` is epoch-day parity over the **whole installation**
(`apps/web/lib/programming/day-role-schedule.ts:41-43`), carrying no household, no athlete and no
program — and `program_blocks` has no `profile_id` at all
(`packages/db/src/schema.ts:753-772`), so the model can say _"both kids do this block, at different
loads"_ and cannot say _"Athlete One does S&C, Athlete Two doesn't"_. There is no date range
anywhere in the schema, so a block is active forever until soft-deleted.

This plan builds the **two tables ADR 0007 authorizes and nothing else** — `program_assignments`
(block ↔ athlete, with `active_from`/`active_to`) and its weekday rows — and promotes the resolver
to `packages/shared` as a **pure function of (anchor, ordered list, date)** so `db:verify` can run
the identical function the app runs. It is sized as **five independently shippable chunks**, because
one PR would be ~1,500 lines spanning a migration, a seed, 140 lines of DB proofs, a cross-package
helper move and an equivalence proof — four concerns, not one.

Now, because `MOT-1` (streaks) cannot start without dueness, `CLONE-1` and `RETIRE-1` both list
`program_assignments` as gate 2 (`docs/plan.md:1731-1733`, `:1756`), and the roadmap's Product & Spec
lane has "a SCHED-1 plan" as its next item (`docs/roadmap.md:89`).

⚠️ **Two things this plan does on purpose, stated up front because both have bitten this repo.**

1. **The A/B rotation stays CALENDAR-indexed.** The maintainer knowingly overrode the program spec's
   session-indexed rule on 2026-09-24, and the reasoning is recorded in three places —
   `day-role-schedule.ts:10-20` (with the quote), `docs/plan.md:1632-1639`, and invariant 3b of
   [features/programming.md](../features/programming.md). ADR 0007 decision 2 preserves it and
   declines to reopen it (`decisions/0007-scheduling-model.md:169-175`). Nothing in this plan makes
   session-indexing easier to switch on later; YDP-1 stays deferred and blocked on MOT-1's verdicts.
   Chunk 1b keeps every existing pinning assertion green — a "fix" must turn the tests red.
2. **Rotation becomes explicit, not tabular.** ADR 0007 records the rotation anchor + ordered-list
   _shape_ and **authorizes no table for it** (`:435`). So "rotation becomes explicit" here means the
   resolver stops hiding `% 2` and takes `(anchorDay, slots)` as a named `packages/shared` constant
   that the later table will seed from. No rotation DDL in SCHED-1.

## Acceptance

### Verbatim from the backlog row

⚠️ **The SCHED-1 row carries no labelled acceptance criterion.** It is a bullet in
`docs/plan.md` → "Backlog / ideas (post-MVP, to brainstorm)" (`:1584-1704`), not a table row with an
`Acceptance` column like the v0/v1 rows (`plan.md:79`, `:99`, `:154`). The nearest things the row and
its milestone state as the criterion, quoted verbatim and unedited:

> **1. A program is assigned to an ATHLETE, not just a household — and that assignment row is where
> everything lands.** (`plan.md:1663-1664`)

> **This answers the open question: the schedule belongs on a block↔athlete assignment row**, not on
> `program_blocks`. (`plan.md:1670-1671`)

> **2. Programs need a date range — nothing models seasonality.** (`plan.md:1675`)

> **3. The streak's daily result must be RECORDED, not recomputed — decide this before building, not
> after.** (`plan.md:1682-1683`)

> **One schedule shape: assigned days.** _(maintainer, 2026-09-19.)_ A schedule says **which days** a program
> is due — `daily`, or `Mon/Wed/Fri`. (`plan.md:1641-1643`)

> **SCHED-1** (which days a program runs; a fixed-weekday first cut is fine).
> (`milestones/beta-1.md:371-372`)

⚠️ **Requirement 3 is NOT this plan's.** ADR 0007 assigns the day-verdict table to **MOT-1**, shipping
with it (`:434`, `:492`), and SCHED-1 is told explicitly not to materialize occurrences (`:491`).
⚠️ **And SCHED-1 does not close its row:** the third of the three converging problems the row is
justified on — `routine_config` having no schedule (`plan.md:1608-1609`) — is deliberately deferred by
the ADR (`:491`, `:507-514`). Open question 1 asks the maintainer to write the one-line criterion and
say whether the row closes without it.

### Done when (observable)

- `packages/shared/src/day.ts` exports `isoDayDiff`, `addDays`, `localWeekday`, `floorMod`, `WEEKDAYS`,
  `weekdaySchema`, `Weekday`; **no file in `apps/web` re-declares any of them** and `apps/web/lib/date.ts`
  no longer defines the three it moved. `pnpm test` runs the moved tests (vitest's `include` already
  covers `../../packages/*/src/**/*.test.ts` — `apps/web/vitest.config.ts:22-25`).
- `resolveDayRole(day)` is a **three-line wrapper** over a pure `packages/shared` resolver, and
  `apps/web/lib/programming/day-role-schedule.test.ts`'s existing assertions are **unchanged and
  green** — including `resolveDayRole('2026-09-24') === 'strength_b'` and the two week-boundary
  assertions (`:15`, `:32`, `:47`, `:52-53`).
- A test proves the wrapper is **behaviour-identical** to the pre-move parity formula over a span that
  includes **dates before the anchor** and a **three-slot** list — the two cases where `%` and
  `floorMod` diverge and the one the ADR says a naive proof would miss (`:160-168`).
- `program_assignments` and `program_assignment_weekdays` exist in prod, applied by
  `migrate.yml`, with **no reader and no writer** at chunk 1c: `grep -rn "programAssignments" apps/`
  returns nothing.
- `db:verify` proves, per the ADR's "Proofs owed" table (`:562-563`): both FKs reject a non-existent
  parent; each FK has a covering index; the natural-key partial UNIQUE arbitrates (the harness seeds
  twice → one row); the "at most one open assignment" partial UNIQUE **rejects** a second open row;
  `weekday` rejects `7` and `-1`; the weekday CHECK's accepted set equals `WEEKDAYS` **exactly, in both
  directions**; and **the stored origin matches `localWeekday`'s `0 = Sunday`** — the proof that stops
  the silent one-day shift.
- After chunk 1d, the seeded household has one assignment per athlete for `youth_daily_program` with
  **seven** weekday rows, `active_from = '2026-09-24'`, `active_to = NULL`, and a second `db:seed` run
  changes nothing (proved, not asserted).
- After chunk 1e (cuttable), Today's program card renders **only** when the athlete has a live,
  in-range, due-today assignment — and **the CSV export's bytes are unchanged by construction**,
  because `packages/db/src/queries/program-day.ts` and `apps/web/lib/dal/export.ts` are not touched
  (see "The export finding" — this is the single most load-bearing design decision in this plan).
- `docs/features/programming.md` invariant 3b records **where the rotation inputs live**; invariant 3
  becomes conditional on assignments in 1e; `docs/tech-debt.md`'s hardcoded-schedule row
  (`:461-494`) loses the clause the ADR says promotion retires — _"nothing in the DB or engine may
  depend on it"_ (`tech-debt.md:478`).

## The export finding — why dueness must NOT go into `programDayRows`

This is the one thing I found by reading code that changes the plan's shape, and it is a trap the ADR
describes from one side only.

`apps/web/lib/dal/export.ts:121` calls `programDayRows(db, { profilePublicId, dayRole: role, scope })`
**once per day role**, and those roles come from the **stored** `sessions.day_role` of historical
sessions (`export.ts:155`), not from a calendar resolve. There is **no date argument anywhere in that
call**. So the CSV's `prescribed` column for a session logged in March is re-resolved, today, through
the same query Today's card uses.

Consequences, both load-bearing:

1. **Any dueness filter inside `programDayRows` silently rewrites history's CSV bytes.** Keyed on
   "now" it is wrong for every past row; keyed on a date it does not have, it cannot be written at
   all; and a bounded assignment would blank `prescribed` for sessions outside the range — the exact
   retroactive re-judging `docs/plan.md:1682-1688` exists to forbid, one column over.
2. **So chunk 1e puts dueness ABOVE the query**, in a Today-only read, and leaves `programDayRows`
   and `export.ts` untouched. That makes "the CSV contract does not move" a **structural** guarantee
   rather than a lucky property of the seeded data, and it keeps ADR open question 2 (which the ADR
   assigns to **Insight**, `:579-581`) genuinely out of SCHED-1.

This is also why the one-block→N-assignments read is **not** in this plan: ADR decision 4 prices it as
byte-affecting for a contract Insight owns (`:288-298`) and "What this does not settle" sends it to its
own plan and UX panel (`:516-517`).

## Chunks, in order — and why each boundary cannot move

| #      | Branch                                    | Ships                                                                                                               | Why it is its own PR                                                                                                                                                                                                                                                           |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1a** | `refactor/sched-1a-shared-day-primitives` | The pure day primitives + the weekday vocabulary move to `packages/shared`. No DB, no behaviour change.             | A mechanical cross-package move must not share a review with a migration or an equivalence proof. Nothing downstream can start without it: **no file under `packages/*/src` can import `apps/web/lib/date.ts`** (dependency direction is app → packages; measured: zero hits). |
| **1b** | `refactor/sched-1b-pure-resolver`         | The resolver becomes pure and parameterized; `YDP_ROTATION` is named data; calendar-indexing re-stated.             | This is the PR where a reviewer must actually check an equivalence proof over 60,000 dates. It carries the "do not fix the rotation" obligation and nothing else.                                                                                                              |
| **1c** | `db/sched-1c-program-assignments`         | The two tables + indexes + CHECKs + `db:verify`, **shipped dark**.                                                  | One migration per PR (AGENTS.md). The TEN-2a rhythm: DDL dark, proofs with the DDL, no writer.                                                                                                                                                                                 |
| **1d** | `db/sched-1d-seed-assignments`            | The seed writes the YDP's assignment + seven weekday rows; the arbiter and the origin are proved against real rows. | Separating it keeps 1c reviewable and gives the idempotency arbiter — the thing `migrate.yml:56-57` re-runs on **every** push to `main` — its own proof PR. It also touches `docs/features/write-path.md` (which owns `packages/db/src/seed.ts`), a different guide from 1c's. |
| **1e** | `feat/sched-1e-today-reads-dueness`       | Dueness reaches **Today only**. **Cuttable.**                                                                       | The first non-dark step and the only one that can change what a person sees. It touches `apps/web/lib/dal/`, which collides with the TEN-2 lanes — check [parallel-work.md](../parallel-work.md) before starting.                                                              |

**1a+1b may be merged** if the implementer measures 1a's diff under ~150 lines; the file list below is
exact enough to decide that before writing code. **1c+1d may not** — AGENTS.md's one-migration-per-PR
rule plus the different owning guides.

⚠️ **1c will land near ~450 lines against a <400 target**, of which ~90 are the migration's comment
header (the 0015 house style) and ~140 are `db:verify` assertions. That is one concern with its proofs
attached, not two concerns; said out loud rather than discovered in review.

## File-by-file changes

### Chunk 1a — the pure day primitives and the weekday vocabulary

| Path                                                                                                              | Change | What & why                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/day.ts`                                                                                      | NEW    | `isoDayDiff`, `addDays`, `localWeekday` moved **verbatim with their docblocks** (they carry the V1-6c `…T00:00:00Z` trap and the "a Monday program would render on Sunday" warning — `apps/web/lib/date.ts:100-150`), plus `floorMod`, `WEEKDAYS`, `weekdaySchema`, `Weekday`.                                                                                                 |
| `packages/shared/src/day.test.ts`                                                                                 | NEW    | The `addDays` / `isoDayDiff` / `localWeekday` describes moved out of `apps/web/lib/date.test.ts:105-135`, plus `floorMod` and a `WEEKDAYS`↔`localWeekday` origin test.                                                                                                                                                                                                         |
| `packages/shared/src/index.ts`                                                                                    | EDIT   | Export the module.                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/lib/date.ts`                                                                                            | EDIT   | Delete the three moved functions. `localWeekStartIso` (`:128-131`) now **calls `localWeekday`** instead of re-inlining `getUTCDay()` three lines above it — a live instance of the constants rule inside one file. `localDayIso`, `isIanaTimeZone`, `localMinutesSinceMidnight`, `minutesToClock`, `isoDaySchema` and the formatters **stay** (cookie/`Intl`-bound, app-only). |
| `apps/web/lib/date.test.ts`                                                                                       | EDIT   | Drop the moved describes.                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/lib/entries/declared-day.ts`                                                                            | EDIT   | Import `addDays`/`isoDayDiff` from `@mat-plan/shared`. **Keep `WRITABLE_DAY_RADIUS` here** — promoting it is MOT-1's problem (ADR `:362-368`), not SCHED-1's.                                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/day-nav.tsx`                                                                          | EDIT   | Import switch (9 references).                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/app/p/[profileId]/actions.test.ts`, `apps/web/e2e/steps.ts`, `apps/web/scripts/screenshot-ephemeral.ts` | EDIT   | Import switch (2 / 3 / 3 references). ⚠️ Verify `e2e/steps.ts` resolves `@mat-plan/shared` under the Playwright tsconfig before committing.                                                                                                                                                                                                                                    |

**Measured scope:** exactly **7 files** reference the three helpers (`grep -rc` over `apps` + `packages`,
`.ts`/`.tsx`). `localWeekday` has **no production call site at all** today — only its own test — so
SCHED-1 is the first consumer of a helper V1-10 added for precisely this.

Shape of the new vocabulary, so implementation is mechanical:

```ts
/**
 * The weekdays a schedule can name, as `localWeekday`'s origin: 0 = Sunday … 6 = Saturday.
 *
 * ⚠️ THE ORIGIN IS LOAD-BEARING AND THIS REPO HOLDS BOTH. `localWeekday` is `getUTCDay()`
 * (0 = Sunday); `localWeekStartIso` is Monday-first ISO-8601 to match `ramp_targets.week_start`.
 * A seeder writing ISO weekdays (1 = Mon … 7 = Sun) yields a SILENTLY one-day-shifted program:
 * 1–6 all resolve to the wrong day and only 7 trips the CHECK. db:verify proves the stored origin
 * against `localWeekday` for exactly this reason (ADR 0007 decision 1).
 *
 * NOT a reference table: seven universal integers are AGENTS.md's "don't over-abstract" case.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const weekdaySchema = z.literal(WEEKDAYS); // zod 4 accepts a literal ARRAY — verified in
export type Weekday = z.infer<typeof weekdaySchema>; // zod@4.6.5 .d.cts:628, so the const is the
// single source and nothing is re-typed.

/** Euclidean modulo — `-1 % 2` is `-1` in JS, which is the pre-anchor rotation bug. */
export function floorMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
```

### Chunk 1b — the resolver moves to `packages/shared`, and rotation becomes named data

| Path                                                 | Change | What & why                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/schedule.ts`                    | NEW    | `isDueOnWeekday(weekdays, day)`, `resolveRotationSlot(rotation, day)`, `resolveRotationDayRole(rotation, day)`. Pure, no IO, no `Intl`.                                                                                                                                                                    |
| `packages/shared/src/schedule.test.ts`               | NEW    | `floorMod` period properties: a **three-slot** list, dates **before** the anchor, and `slotCount = 1` (the shape ONB-2's collapse will need).                                                                                                                                                              |
| `packages/shared/src/programming.ts`                 | EDIT   | `YDP_ROTATION` beside `PROGRAM_SEED` — the authored program's rotation inputs, in the file that already owns the authored program.                                                                                                                                                                         |
| `apps/web/lib/programming/day-role-schedule.ts`      | EDIT   | `resolveDayRole` becomes `resolveRotationDayRole(YDP_ROTATION, day)`. The module-private `epochDay` (`:27`) **goes** — `epochDay(day) - epochDay(anchor)` _is_ `isoDayDiff(day, anchor)` spelled longhand (ADR `:144-149`). **The 2026-09-24 quote and the whole "do not fix it" docblock stay verbatim.** |
| `apps/web/lib/programming/day-role-schedule.test.ts` | EDIT   | **Every existing assertion stays.** Add the equivalence test (below).                                                                                                                                                                                                                                      |
| `docs/features/programming.md`                       | EDIT   | **Required by `guides:check`** (it owns `apps/web/lib/programming/` and `packages/shared/src/programming.ts`). Invariant 3b gains where the rotation inputs live and that they are now data-shaped; `owns:` gains `packages/shared/src/schedule.ts`.                                                       |
| `docs/tech-debt.md`                                  | EDIT   | The hardcoded-schedule row (`:461-494`): the resolver is no longer app-only policy, so _"nothing in the DB or engine may depend on it"_ (`:478`) is retired — the clause the ADR names (`:463-466`).                                                                                                       |

```ts
/** The Youth Daily Program's rotation inputs — the data the app const used to hide.
 *
 * CALENDAR-INDEXED, DELIBERATELY (2026-09-24). Three existing records, not a fourth copy:
 * `day-role-schedule.ts`'s docblock (the maintainer's quote), docs/plan.md YDP-1, and
 * features/programming.md invariant 3b. Session-indexing is YDP-1, deferred.
 *
 * Anchor = the day the kids moved off paper, which the live resolver's phase already pins to a B
 * day. `slots[0]` is therefore `strength_b`. When ADR 0007's rotation tables are ever authorized,
 * these two values become the seeded row — one source for the seed and the backfill, which is the
 * property ADR 0005 finding D3 lacked.
 */
export const YDP_ROTATION = {
  anchorDay: '2026-09-24',
  slots: ['strength_b', 'strength_a'],
} as const satisfies { anchorDay: string; slots: readonly DayRole[] };
```

```ts
// packages/shared/src/schedule.ts
export function resolveRotationSlot(
  rotation: { anchorDay: string; slots: readonly unknown[] },
  day: string,
): number {
  return floorMod(isoDayDiff(day, rotation.anchorDay), rotation.slots.length);
}
```

**The equivalence proof, and where it has to live.** A test in `packages/shared` cannot import
`apps/web`, so the behaviour-identity proof belongs in
`apps/web/lib/programming/day-role-schedule.test.ts`, where both the wrapper and the oracle are
reachable. The oracle is the pre-move formula written once, on the assertion side — the same
exception AGENTS.md:109-111 allows for a contract test that pins a value:

```ts
const parityOracle = (d: string) =>
  Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000) % 2 === 0 ? 'strength_b' : 'strength_a';
// ±30,000 days around the anchor — the span the ADR says agreement was measured over, and it must
// include PRE-ANCHOR dates: the live test is `% 2 === 0` and `-0 === 0`, so `%` and `floorMod`
// diverge only before the anchor or at slotCount >= 3. A post-anchor-only span proves the one
// arrangement that cannot fail (ADR 0007 :160-168).
```

⚠️ **State the limit honestly in the test's docblock:** the three-slot case has **no live counterpart**,
so it is a property test on `floorMod` (period, and negative-offset wraparound), not an equivalence
test. The ADR asks for "a three-slot case" in the equivalence proof; that is not obtainable, and
pretending otherwise would be a green test that proves nothing.

### Chunk 1c — the two tables, shipped dark

| Path                                                               | Change   | What & why                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db/src/schema.ts`                                        | EDIT     | `programAssignments` + `programAssignmentWeekdays`, placed after `prescriptionTargets` (`:827-851`). Shape below.                                                                                                                                                                                                                                                              |
| `packages/db/migrations/0017_sched1_program_assignments.sql`       | NEW      | `drizzle-kit generate`'d, then hand-hardened in the 0015 house style: `SET lock_timeout = '5s'` and `SET statement_timeout = '60s'` first, a header stating WHY / locks / re-run safety / what `db:verify` does not prove / what happens if it fails, and **no production numbers** (0015's standing rule: migrations are forward-only, so a fact written there is permanent). |
| `packages/db/migrations/meta/_journal.json` + `0017_snapshot.json` | EDIT/NEW | Generated. The drift guard diffs `schema.ts` against the snapshot, so `generate` must leave a clean tree.                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/verify.ts`                                    | EDIT     | The proofs (below). Add `assertCheckCoversIntConst` beside `assertCheckCoversConst` (`:948-967`) — see the correction.                                                                                                                                                                                                                                                         |
| `docs/features/programming.md`                                     | EDIT     | `guides:check`: the tables are the programming model's. Invariant 3's "ONE block by design" gains "until assignments light up in 1e".                                                                                                                                                                                                                                          |
| `docs/changelog/<date>-db-sched-1c-program-assignments.md`         | NEW      | Per `docs/changelog/README.md`; a `db/` branch **must** add one (`status:check`).                                                                                                                                                                                                                                                                                              |
| `docs/plan.md` / `docs/roadmap.md`                                 | EDIT     | One line each, the SCHED-1 rows only.                                                                                                                                                                                                                                                                                                                                          |

```ts
/**
 * program_assignment — THE row that says "this athlete runs this block, on these days, between
 * these dates" (SCHED-1; ADR 0007 decision 1). The join `program_blocks` never had: the only
 * per-athlete link today is `prescription_targets.profile_id`, which carries loads, so the model
 * could say "both kids do this block at different loads" and not "one sibling does S&C".
 *
 * Config data → NO client_id (the program_blocks / ramp_targets / day_readiness idiom, NOT
 * quantity_slots' pair-as-PK, whose composite key has a table-specific reason — drizzle emits the
 * uniqueIndex target AFTER the FK referencing it, docs/lessons.md migration 0011 — and which would
 * also foreclose soft delete).
 *
 * `active_from` is NOT NULL, `active_to` nullable = still open. Deliberate: NULLs are DISTINCT in a
 * unique index, so a nullable start would let the arbiter below pass two identical open
 * assignments through `db:seed`, which migrate.yml runs against prod on EVERY push to main. ADR 0007
 * authorizes either this or a coalesce() in the index expression (:445-453); NOT NULL removes the
 * trap instead of hiding it, and gives HIST-1 / CLONE-1 a real start date.
 *
 * ⚠️ WRITER-ENFORCED, NOT SCHEMA-ENFORCED (the prescription_targets / supersets family): nothing
 * here stops a profile of household H being assigned a block of ¬H. The seed resolves profiles
 * within the block's household (seed.ts), and db:verify asserts it.
 *
 * ⚠️ NO rotation anchor and NO rotation slot column. ADR 0007 records that shape on
 * `program_blocks` and authorizes no table for it (:435); landing it here would also put N phases
 * on one program and desynchronize co-training siblings (:150-159).
 */
export const programAssignments = pgTable(
  'program_assignments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(), // UUIDv7, app-generated (anti-IDOR)
    blockId: bigint('block_id', { mode: 'number' })
      .notNull()
      .references(() => programBlocks.id),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    activeFrom: date('active_from').notNull(),
    activeTo: date('active_to'),
    ...timestamps,
  },
  (t) => [
    index('idx_program_assignments_block').on(t.blockId), // covering index for the block FK
    index('idx_program_assignments_profile').on(t.profileId), // covering index for the profile FK
    // THE idempotency arbiter. Closing and reopening an assignment needs two rows for one
    // (block, profile), so that pair cannot be the key — the start date is what distinguishes them.
    uniqueIndex('uq_program_assignments_profile_block_from')
      .on(t.profileId, t.blockId, t.activeFrom)
      .where(sql`${t.deletedAt} is null`),
    // "At most one OPEN assignment" — the cheap non-overlap guard. NOT `EXCLUDE USING gist`: a
    // construct this repo has never used and whose PGlite support is unverified (ADR 0007 :452).
    // Full overlap prevention is writer-enforced and stated as such.
    uniqueIndex('uq_program_assignments_profile_block_open')
      .on(t.profileId, t.blockId)
      .where(sql`${t.activeTo} is null and ${t.deletedAt} is null`),
    check(
      'program_assignments_active_range_check',
      sql`${t.activeTo} is null or ${t.activeTo} >= ${t.activeFrom}`,
    ),
  ],
);

/**
 * program_assignment_weekday — WHICH DAYS the assignment is due, as rows (ADR 0007 decision 1).
 * Dueness is `EXISTS (… WHERE weekday = localWeekday(day))`: a lookup, which is what keeps MOT-1's
 * streak arithmetic-free. `daily` is SEVEN ROWS, not a `schedule_kind` member — so the live Youth
 * Daily Program and the archived Mon/Wed/Fri block are the same shape with different rows.
 *
 * `weekday` is `0 = Sunday … 6 = Saturday`, the `localWeekday` convention — see WEEKDAYS' docblock
 * for why the origin is written down. int4 not bigint: an ordinal, the class `.squawk.toml` excludes
 * `prefer-bigint-over-int` for. The CHECK inlines WEEKDAYS' members (SQL cannot import a const) and
 * db:verify pins the accepted set to it in BOTH directions.
 *
 * ⚠️ THE FK IS NAMED EXPLICITLY, and that is not stylistic: drizzle's generated name
 * `program_assignment_weekdays_assignment_id_program_assignments_id_fk` is 67 bytes and Postgres
 * truncates identifiers at 63 — so the generated name and every db:verify assertion naming it would
 * silently disagree. The `entry_set_quantities_*_fkey` precedent (schema.ts:371-380) is the form.
 */
export const programAssignmentWeekdays = pgTable(
  'program_assignment_weekdays',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').notNull().unique(),
    assignmentId: bigint('assignment_id', { mode: 'number' }).notNull(),
    weekday: integer('weekday').notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'program_assignment_weekdays_assignment_fk', // 41 bytes — see the docblock
      columns: [t.assignmentId],
      foreignColumns: [programAssignments.id],
    }),
    index('idx_program_assignment_weekdays_assignment').on(t.assignmentId),
    uniqueIndex('uq_program_assignment_weekdays_assignment_weekday')
      .on(t.assignmentId, t.weekday)
      .where(sql`${t.deletedAt} is null`),
    check('program_assignment_weekdays_weekday_check', sql`${t.weekday} in (0, 1, 2, 3, 4, 5, 6)`),
  ],
);
```

**FKs are added VALIDATED, inline, and that is argued rather than assumed.** AGENTS.md's
"New FK/UNIQUE as `NOT VALID` → `VALIDATE`, split across PRs" (`AGENTS.md:523-525`, `:534`) exists to
avoid a validating **scan** and a long lock on a table **with rows**. Both tables are created in this
same file and are **empty**, so `NOT VALID` skips a scan of zero rows and a follow-up `VALIDATE` would
prove nothing — the honest version of TEN-2a's own argument, which used `NOT VALID` precisely because
`movements` already held 35 rows (`0015_ten2a_movements_household.sql`). Precedent in-tree: `0011`
created two brand-new tables with **three validated FKs** and is on `main`. **Implementation gate:**
run `npx squawk-cli@2.66.0 -c .squawk.toml` on the generated file (the exact invocation CI uses,
`ci.yml:215`) and paste the output in the PR body. If `adding-foreign-key-constraint` fires, the fix is
a `-- squawk-ignore adding-foreign-key-constraint` on the line **directly** above the statement —
_any_ comment in between, `--> statement-breakpoint` included, silently voids it — with "the table is
created empty in this same transaction" as the justification. Flagged for the DB-safety panel.

**`db:verify` section (new, modelled on the V1-10 block at `verify.ts:3610-3649`):**

- `columnsOf` shape assertions for both tables, in the `V1_10_COLUMNS` style (`:3615-3645`), including
  `active_from` NOT NULL and `weekday` = `integer`.
- `expectRejectedBy('program_assignments_block_id_program_blocks_id_fk', …)` and the profile FK —
  non-existent parent → `23503`. Same for `program_assignment_weekdays_assignment_fk`.
- `expectRejectedBy('uq_program_assignments_profile_block_from', …)` — the duplicate.
- `expectRejectedBy('uq_program_assignments_profile_block_open', …)` — **a second open assignment for
  the same (profile, block) with a different `active_from`**. This is the one that proves the
  non-overlap guard rather than the natural key.
- A soft-deleted assignment **frees** the natural key (the partial predicate is the point).
- `expectRejectedBy('program_assignment_weekdays_weekday_check', …)` for `7` and for `-1`.
- `assertCheckCoversIntConst('program_assignment_weekdays_weekday_check', WEEKDAYS)` — both
  directions, so an eighth inlined literal or a missing `0` fails the build.
- **The origin proof.** Insert weekday `localWeekday('2026-10-12')` (a Monday) for a fixture
  assignment, then assert the dueness predicate is true for `2026-10-12` and false for
  `2026-10-13`, using the **`packages/shared` `localWeekday`** 1a moved — `verify.ts` can now import
  it. This is the assertion that stops the silent one-day shift, and it is only writable _because_ the
  helper left `apps/web`.

### Chunk 1d — the seed writes the YDP's assignment

| Path                                 | Change | What & why                                                                                                                                                                                                                                 |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/programming.ts` | EDIT   | `PROGRAM_SEED`'s block row gains `assignments: [{ profilePublicId, activeFrom, activeTo, weekdays }]`, with `weekdays: [...WEEKDAYS]` for the YDP — **"daily is seven rows"**, spelled from the const, never a re-typed `[0,1,2,3,4,5,6]`. |
| `packages/db/src/seed.ts`            | EDIT   | `seedProgram` grows an assignment pass, following its own select-then-insert idiom (`:401-425`).                                                                                                                                           |
| `packages/db/scripts/verify.ts`      | EDIT   | Idempotency across the harness's two seed runs; the profile-in-block's-household assertion; seven weekday rows; `active_from = '2026-09-24'`.                                                                                              |
| `docs/features/write-path.md`        | EDIT   | **Required by `guides:check`** — it owns `packages/db/src/seed.ts` ("TEN-1 1c made `seedProgram` household-scoped, and it runs against prod on every merge").                                                                              |
| `docs/features/programming.md`       | EDIT   | It owns `packages/shared/src/programming.ts`.                                                                                                                                                                                              |

⚠️ **The upsert arbiter needs care, and the obvious form can raise `23505`.** `program_assignments`
carries **two overlapping partial unique indexes**, and a row the seed re-inserts violates _both_.
`ON CONFLICT (profile_id, block_id, active_from) WHERE deleted_at IS NULL DO NOTHING` handles only the
inferred index; a conflict detected on the _other_ one raises `23505` and, because `migrate.yml:56-57`
runs `db:seed` unconditionally on every push to `main`, **it would re-fail every later push** and take
`db:seed` with it (`docs/runbooks.md:78`, `:121`). So:

- the pass follows `seedProgram`'s existing **select-then-insert** shape (`seed.ts:415-425`), and
- the insert uses a **targetless `ON CONFLICT DO NOTHING`**, which is arbiter-agnostic and is what
  AGENTS.md's "seed reference data `ON CONFLICT DO NOTHING`" literally says; the child weekday rows
  keep a named arbiter with its predicate repeated (`where: isNull(deletedAt)`) — the recorded
  `docs/lessons.md:21-22` trap, _"a partial index only arbitrates when the statement repeats its
  predicate"_, since they have only one.
- **The proof decides**: the harness already seeds twice, so `db:verify` asserting exactly one
  assignment row and exactly seven weekday rows is what pins this rather than this paragraph.

**`active_from = '2026-09-24'`** — the day the kids moved off paper and the rotation anchor
(`day-role-schedule.ts:34-36`), i.e. a documented fact, not an invented one. See open question 3: it
means a 1e-era day-nav view of a day before 2026-09-24 would render no program card.

### Chunk 1e — dueness reaches Today, and only Today (cuttable)

| Path                                                          | Change | What & why                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/program-assignments.ts`              | NEW    | `dueAssignmentRows(db, { profilePublicId, day, scope })` — `isLiveProfile` for the BOLA conjunct (`program-day.ts:66`, the single-sourced predicate), the date-range test, and `EXISTS` over the weekday rows. Single-sourced here so the DAL and `db:verify` run the **identical SQL** (the `programDayRows` / `weeklyAdherenceRows` precedent, `program-day.ts:10-13`). |
| `apps/web/lib/dal/schedule.ts`                                | NEW    | `getDueProgram(profilePublicId, day)` — `getHouseholdScope()`, uuid guard, minimal DTO. The `lib/dal/programming.ts:29-41` shape exactly.                                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/page.tsx`                         | EDIT   | One added await in the existing `Promise.all` (`:85-89`) and one condition on the card. `resolveDayRole(day)` (`:81`) **stays** — it answers _which workout_, which is rotation, not dueness.                                                                                                                                                                             |
| `packages/db/src/queries/program-day.ts`                      | —      | **UNTOUCHED. Load-bearing.** See "The export finding".                                                                                                                                                                                                                                                                                                                    |
| `apps/web/lib/dal/export.ts`                                  | —      | **UNTOUCHED. Load-bearing.** Not one CSV byte moves, structurally.                                                                                                                                                                                                                                                                                                        |
| `packages/db/scripts/verify.ts`                               | EDIT   | Dueness true on a listed weekday / false on an unlisted one / false outside the date range / false for a soft-deleted assignment; **and the fallback branch** below.                                                                                                                                                                                                      |
| `docs/features/programming.md`, `docs/features/write-path.md` | EDIT   | Invariant 3 becomes conditional on assignments; write-path owns `apps/web/lib/dal/`.                                                                                                                                                                                                                                                                                      |

⚠️ **The transitional fallback, and its price.** A household whose blocks have no assignment rows
(any household created by the app before this lands) must keep rendering as it does today, or 1e is a
silent blanking bug. So: **no live assignment rows for this profile's household → behave exactly as
today.** TEN-2b's lesson is that a fallback is paid for, not free, so: it gets a `db:verify` proof of
_both_ branches, a one-line docblock naming its removal trigger (the ONB-2 household-creation writer
landing, below), and a line in `docs/tech-debt.md` if it is still there a milestone later.

⚠️ **No new visible surface.** 1e adds no empty state and no copy — it only gates an existing card on
data that is always due for the seeded household. **So chunks 1a–1e owe no UX panel.** If the
implementer adds any visible element (a "nothing due today" state), it becomes UI work and owes the
panel under AGENTS.md → UI PR rules. The **recurrence editor** the weekday table implies — which ADR
0007 calls "the honest bill" (`:129-134`) — is out of scope here and owes that panel when it comes;
the ADR also forbids shipping it before MOT-1's verdict table (`:491`).

## The ONB-2 inheritance — which rows, and how they migrate

**The obligation.** `docs/plan.md:1112-1117`: ONB-2's Daily Five is seeded under **both** `strength_a`
and `strength_b` because no `daily` role exists and Today's role is global A/B parity — _"the real
per-household daily role is deferred to SCHED-1 (Beta 1), **which can migrate these rows later**."_

**The rows.** Per household: one `program_blocks` row (`daily_five`) and **sixteen** `prescriptions`
rows where eight are meant — the same eight movements twice, once per letter — plus the constraint
that _"the rows are written at household creation (TEN-1/AUTH-1 or ONB-0's first run), not by
`seed.ts`"_ (`plan.md:1120-1121`).

⚠️ **Measured: ONB-2 is not implemented yet.** `grep -rni "daily.five\|daily_five"` over `apps` +
`packages` returns exactly one hit, a comment in `apps/web/lib/routine/catalog.ts:48`. So at planning
time **zero** such rows exist; ONB-2 is Beta 0 and SCHED-1 is Beta 1, so by the time these chunks ship
they will exist in every household created after ONB-2. The plan therefore handles both worlds.

**How they migrate — three populations, three mechanisms, none of them a migration backfill:**

| Population                                        | Mechanism                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The seeded household (`youth_daily_program`)      | **Chunk 1d's seed.** Idempotent by natural key, re-runnable, reviewable, and already executed against prod on every merge.                                                                                                                                                                                                                                                        |
| Households created **after** ONB-2 lands          | **ONB-2's own household-creation writer** writes the assignment + seven weekday rows in the **same transaction** as the block. SCHED-1 owns the shape and states this contract; ONB-2 (or whichever of ONB-0/TEN-1/AUTH-1 owns that write) executes it. Without it a new household gets a block no assignment points at, and 1e's fallback is the only thing keeping Today alive. |
| Households created **between** 1c and that writer | A guarded, dry-run-first `packages/db/scripts/corrections/` script — AGENTS.md's named answer for data a live DB holds that the app cannot fix.                                                                                                                                                                                                                                   |

**Why not a migration backfill.** AGENTS.md:540-541 requires a Neon RESTORE branch before any
**destructive _or backfill_** step, and that runbook entry is still a `TODO` stub
(`docs/runbooks.md:654-657`). ADR 0007 discharges ADR 0005's finding D4 by noting the stub gates the
**expand** PR of any backfilling arc, and then states that the two tables it authorizes _"carry no
destructive step and **no backfill over existing rows**"_ (`:476-485`). A migration backfill here would
contradict the authorization this plan is executing. The seed + writer + correction split keeps that
true, and each mechanism matches who authored the rows.

**What SCHED-1 deliberately does NOT do to those rows.** Collapsing the sixteen prescriptions to eight
needs either a one-slot rotation list (**unauthorized**, ADR `:435`) or a named `workouts` row
(**unauthorized**, ADR `:436`, and six PRs with the only destructive step and the only weakened guard
in the whole model, `:455-465`). And deleting the `strength_b` copies **first** blanks Today on every
even epoch-day: `page.tsx:81` resolves a role for every calendar date and the resolver is TOTAL. So the
duplication stays, harmless, and the collapse gets a named home — **a new backlog row**, gated on the
rotation tables being authorized, whose content is already known: seed a one-slot rotation
(`YDP_ROTATION` with `slots.length === 1` is already a tested case in 1b) and delete the duplicate
copies via a guarded correction, because the app has no delete path. One more thing SCHED-1 must get
right for that row to be cheap: **the assignment is per-profile**, so ONB-2's "default is per
household" (`plan.md:1101-1102`) becomes one assignment per athlete, not one per household.

## Test plan

**Unit (`pnpm test`, vitest, node env; `packages/*/src/**/*.test.ts` is in the include list).**

- 1a: the moved describes, unchanged, now in `packages/shared/src/day.test.ts`; `floorMod` across
  negative/zero/positive and `m = 1`; `WEEKDAYS` × `localWeekday` — every member is reachable and
  `localWeekday('2026-10-11')` (a Sunday) is `0`, which is the origin assertion in test form.
- 1b: the **behaviour-identity** test in `apps/web/lib/programming/day-role-schedule.test.ts` —
  ±30,000 days around the anchor against the inline parity oracle, **including the pre-anchor half**;
  plus `packages/shared/src/schedule.test.ts` for three-slot and one-slot periodicity and
  `isDueOnWeekday` over a Mon/Wed/Fri set across a Sat→Sun boundary (seven is odd — the thing
  `day-role-schedule.ts:7-9` says a weekday map cannot do, now that both shapes coexist).
- Existing suites that must stay green untouched: `day-role-schedule.test.ts`'s four decision-pinning
  assertions, `apps/web/lib/date.test.ts`'s survivors, and `apps/web/app/p/[profileId]/actions.test.ts`.

**DB proofs (`pnpm db:verify`, PGlite, migrations applied to an EMPTY database).** Listed per chunk
above. Three limits stated rather than discovered:

- PGlite is **single-connection**, so `lock_timeout` is never exercised and **no concurrency is
  modelled**: the lock ordering in the migration header is review-enforced only (0015's own
  disclosure). A sequential double-seed demonstrates idempotency, not a race (ADR `:570-573`).
- `db:verify` runs migrations on an **empty** DB, so no "existing rows acquire a constraint" path is
  exercised. Here that is harmless — both tables are new — which is itself part of why no backfill is
  authorized.
- Every non-seed fixture lives inside a **rolled-back transaction**, the TEN-2a dark-gate idiom, so
  chunk 1c can prove the constraints without leaving a single assignment row behind.

**E2E (`pnpm e2e:local`).** Only 1e needs it: `apps/web/e2e/a11y.spec.ts` already computes a timezone
whose local day yields a programmed role (`:653-659`) and scans the program card in both
`<details>` states, so the existing spec is the regression test for "the card still renders". No new
spec. ⚠️ `a11y.spec.ts:579` and `strength-form.tsx:591` still mention the deleted
`DAY_ROLE_BY_WEEKDAY`; ADR Consequences lists five such stale references and explicitly does **not**
charge them to one PR (`:550-554`). 1b fixes the two that sit in files it already edits and leaves the
rest listed, so the sweep is recorded rather than silently partial.

**CI.** `quality` runs `format:check`, `lint`, `typecheck` (both projects since #244), `test`,
`db:verify`, `audit:check`, `guides:check`, `status:check`; new migrations additionally get
`drizzle-kit check`, the clean-tree drift guard, and Squawk (`ci.yml:215`). Local pre-flight per chunk:
`pnpm verify && pnpm guides:check` — and for 1c/1d `pnpm db:generate` must leave the tree clean.

## Risks / rollback

| Risk                                                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The silent one-day shift.** A seeder writing ISO weekdays (1 = Mon … 7 = Sun) puts every program one day off; values 1–6 all pass the CHECK and only `7` trips it.                                                                  | One `WEEKDAYS` const anchored to `localWeekday` in its docblock, the CHECK pinned to it in both directions, and the **origin proof** in `db:verify` (not a comment). The seed spells `[...WEEKDAYS]`, never a literal.                             |
| **`db:seed` wedges prod.** It runs unconditionally on every push to `main` (`migrate.yml:56-57`); a `23505` from the two overlapping partial indexes re-fails every later push and takes the seed with it (`runbooks.md:78`, `:121`). | Targetless `ON CONFLICT DO NOTHING` + select-then-insert, and the two-seed-run proof. Recovery, if it still happens: `workflow_dispatch` re-run after a fix-forward commit — the documented wedge procedure (`runbooks.md:95-121`).                |
| **A dueness filter rewrites historical CSV bytes** via `export.ts:121`.                                                                                                                                                               | Structural: `programDayRows` and `export.ts` are untouched; dueness lives one level up. Asserted as a non-change, and the DoD line for 1e is "the export files are not in the diff".                                                               |
| **1e blanks Today** for a household with no assignment rows.                                                                                                                                                                          | The explicit data-presence fallback, both branches proved, with a named removal trigger. And 1e is **cuttable** — SCHED-1 delivers the model without it.                                                                                           |
| **A 67-byte FK name is truncated by Postgres at 63**, so the migration and the proofs disagree about what to assert.                                                                                                                  | The FK is named explicitly (41 bytes) in `schema.ts`, the `entry_set_quantities_*_fkey` precedent. All seven new identifiers were length-checked: 41, 41, 41, 42, 49, 49, 41.                                                                      |
| **Someone "fixes" the calendar rotation** while it is being refactored — the exact window in which it is most tempting.                                                                                                               | Every pinning assertion kept, the maintainer's quote kept verbatim, the "do not fix" block carried into the new file, three existing records cited rather than re-argued, and a one-slot case tested so the _collapse_ path is obviously separate. |
| **ADR 0007 is `Proposed`, not Accepted** (`decisions/0007-scheduling-model.md:3`).                                                                                                                                                    | Chunks 1a/1b are reversible refactors with no DDL and are safe either way. **1c must not merge before the ADR is signed** — a migration is forward-only. Open question 2.                                                                          |
| **Lane collision.** 1c/1d touch `packages/db/**`; 1e touches `apps/web/lib/dal/**` — the TEN-2 lanes' files.                                                                                                                          | Sequence against [parallel-work.md](../parallel-work.md) before starting; TEN-2c lands first.                                                                                                                                                      |

**Rollback.** 1a/1b: revert the commit; no data, no deploy ordering. 1c: the migration is
**additive and reversible by omission** — two unreferenced empty tables; fix-forward is the default,
and nothing reads them, so a revert of the _code_ needs no DB action. No Neon RESTORE branch is
required by AGENTS.md here because there is no destructive step and no backfill (the ADR's own
reading, `:484-485`) — and the restore runbook is a stub (`runbooks.md:654-657`), so a chunk that
needed it would be blocked on writing that first. 1d: a wrong assignment row is repaired by a guarded
`db:correct` correction, not by an app path. 1e: one revert restores the pre-assignment read.

## Alternatives considered and rejected

Plan-level alternatives. ADR 0007's own rejections (RRULE, quota, bitmask, a `day_roles` reference
table, materializing the letter, materializing occurrences, `EXCLUDE USING gist`, the anchor on the
assignment, `packages/engine`) are **settled there** and not reopened; the two I had to re-decide
because the ADR's mechanism does not exist are in the next section.

1. **One PR for all of SCHED-1.** Rejected: ~1,500 lines over a migration, a seed that runs against
   prod on every merge, ~140 lines of DB proofs, a 7-file cross-package helper move and a 60,000-case
   equivalence proof. Four concerns. It also puts the one irreversible artifact (a migration) in the
   same review as the most mechanical one.
2. **Dueness inside `programDayRows`** (the obvious place — one query, one filter). Rejected,
   measured: `export.ts:121` re-resolves `prescribed` for **historical** sessions through that query
   with no date argument, and the roles come from stored `sessions.day_role` (`:155`). Any filter
   there either uses "now" for a March row or cannot be written. Dueness goes above the query; the
   CSV's immobility becomes structural instead of incidental.
3. **Nullable `active_from` + `coalesce(active_from, '-infinity')` in the unique-index expression** —
   the ADR's other explicitly-offered option (`:450`). Rejected: a SQL expression inside a drizzle
   `uniqueIndex` is drift-guard and snapshot risk for no benefit, and it leaves the NULL-distinctness
   trap latent behind a clever index. NOT NULL removes the trap and hands HIST-1/CLONE-1 a real start
   date. **Cost named:** an assignment must now state when it started, and a day-nav view before
   `active_from` renders no card (open question 3).
4. **The weekday as text (`'sun'…'sat'`) in a text+CHECK column.** Genuinely tempting: it is the
   repo's dominant enum idiom, `assertCheckCoversConst` would work **unmodified**, and the
   0=Sun-vs-1=Mon origin hazard — the one the ADR spends a whole warning block on — simply vanishes,
   because `'mon'` has no origin. Rejected because the only producer and the only consumer is
   `localWeekday`, which returns a **number**: text would add a conversion at every boundary and a
   second spelling of one concept, which is what the constants rule forbids. ADR decision 1 also
   decided numeric. The hazard is paid for instead with the pinned CHECK plus the origin proof. ⚠️
   **Panel: this is the trade I am least certain about** — if the integer-CHECK pin (next section)
   turns out uglier than expected, text is the cheaper correctness story.
5. **A `weekdays` reference table, FK'd.** Rejected: AGENTS.md's reference-table idiom is for global
   reference data a seed owns and the app validates against (`units`, `quantity_slots`); seven
   universal integers are its explicit "don't over-abstract" case (`AGENTS.md:112-113`). The ADR
   rejects it too (`:95-96`).
6. **Collapsing ONB-2's duplicated A/B prescriptions in SCHED-1.** Rejected: needs an unauthorized
   table, and deleting the `strength_b` copies first blanks Today on every even epoch-day. Named as
   its own gated row instead.
7. **A migration-embedded backfill of assignments for existing blocks** (one `INSERT … SELECT`,
   guarded, idempotent — it would cover all three populations at once). Rejected: AGENTS.md gates any
   backfill behind a Neon RESTORE branch whose runbook is a `TODO` stub, and the ADR authorizes these
   tables precisely on the basis that they carry no backfill. The seed/writer/correction split matches
   the three populations' actual authors and keeps SCHED-1 inside its authorization.
8. **Leaving the resolver in `apps/web` and re-implementing dueness in `packages/db`.** Rejected: two
   copies of a calendar rule, and `db:verify` could not run the function the app runs — the exact
   property `programDayRows` exists to give (`program-day.ts:10-13`).
9. **Re-exporting the moved helpers from `apps/web/lib/date.ts`** so no call site churns. Rejected:
   two import paths for one helper is the drift the constants rule names, and the churn is **7 files,
   measured** — cheap enough that the clean version wins.
10. **Promoting `WRITABLE_DAY_RADIUS` out of `server-only` while 1a is moving things anyway.**
    Rejected as scope creep: it is MOT-1's verdict boundary that needs it (ADR `:362-368`), nothing in
    SCHED-1 reads it, and moving a constant whose only consumer is a PR that does not exist is how a
    plan grows a chunk nobody asked for.

## Corrections to the ADR's measurements (and what I did instead)

Named because this plan executes the ADR and a plan that silently papers over a broken mechanism is
worse than one that argues with it. **No decision is reopened; two mechanisms are replaced.**

1. ⚠️ **`assertCheckCoversConst` cannot pin a numeric CHECK, and the ADR asks it to.** The ADR says
   `CHECK (weekday BETWEEN 0 AND 6)` is _"pinned by `assertCheckCoversConst` the way both `day_role`
   CHECKs are"_ (`:91-94`). It cannot be: the helper ends in
   `assert.deepEqual(inlined, [...values].sort())` where `inlined` is every **single-quoted** token of
   `pg_get_constraintdef` (`verify.ts:961-966`), and a numeric CHECK has none — the assertion can
   never pass. **Resolution:** the CHECK is written as `weekday in (0,1,2,3,4,5,6)` (so the constraint
   def renders the exact set as `= ANY (ARRAY[0, 1, …, 6])`, not a `>=`/`<=` pair that mentions only
   the endpoints), and chunk 1c adds a sibling `assertCheckCoversIntConst` beside the existing helper
   — same both-directions contract, integer tokens. The decision (numeric weekday, pinned CHECK) is
   unchanged; only the mechanism is real now.
2. ⚠️ **ADR context fact 2's zero-hits claim has drifted.** _"`grep -rn "T00:00:00Z\|getUTCDay\|86_400_000" packages/`
   returns zero hits"_ (`:49-54`) is true for `packages/*/src` and **false for `packages/`**:
   `packages/db/scripts/verify.ts:3031` and `:4361` hand-roll `… + n * 86_400_000` day arithmetic. That
   is not a problem for the ADR's argument — the dependency-direction point stands — and it is a
   **third consumer** for the moved `addDays`, strengthening 1a. Noted so the next reader does not
   re-measure and conclude the ADR was wrong about something load-bearing.
3. **Every `packages/db/src/schema.ts` line cite in the ADR is ~124 lines stale** (TEN-2a/2b landed
   after it): `program_blocks` is `:753-772`, not `:629-648`; `prescriptions` `:784-816`; the
   prescriptions slot key `:804-806`; `sessions.day_role` `:625`, not `:501`; its CHECK `:644-647`.
   Likewise `verify.ts`: `assertCheckCoversConst` is `:948`, called at `:2596` and `:3649` (not
   `:770`/`:2392`/`:3416`); `V1_10_COLUMNS` is `:3615-3645`. And the runbooks restore stub is
   `:654-657`, not `:196-199`. Every cite **in this plan** was measured against this worktree at
   `9ab6d7f`. (This is the `docs/changelog/2026-10-06-chore-dx-line-citation-trap.md` trap, and the
   ADR's own panel caught the same class of drift in its last log row.)
4. **ONB-2 is unimplemented**, so the ADR's _"its A/B stopgap stays correct and cheap … so nothing
   re-seeds"_ (`:497`) describes rows that do not exist yet. Handled in both directions above.

## Out-of-scope / deferred

- **The day-verdict table and MOT-1's streak.** ADR 0007 ships them **with MOT-1** (`:434`, `:492`),
  including the settle boundary derived from `WRITABLE_DAY_RADIUS`, the `packages/shared` verdict-status
  enum, settle-on-write **and** settle-before-edit, and the `revalidatePath('/p')` requirement. None of
  it here. SCHED-1 therefore does **not** satisfy the row's requirement 3.
- **Rotation anchor + slot tables.** Shape recorded, authorization absent (`:435`). 1b makes the
  inputs named data so the table is a later data move, not a logic change.
- **`workouts` and the `prescriptions` contract arc.** Unauthorized (`:436`); six PRs, the only
  destructive step, the only weakened guard, and the `DAY_ROLES` export gate at `export.ts:120` that
  nobody had noticed. The interim remains the eight unused `DAY_ROLES` codes.
- **The one-block→N-assignments read, and Today rendering several programs.** Byte-affecting for a
  contract **Insight** owns; needs its own plan and a UX panel (`:288-298`, `:516-517`).
- **A recurrence / weekday editor.** The ADR's "honest bill" (`:129-134`), and explicitly forbidden
  before the verdict table (`:491`). It owes the mandatory UX panel.
- **`routine_config` gaining a schedule** (`routine_items`). Deferred by the ADR (`:507-514`); its
  trigger is the first time anyone acts on "mobility only on practice days". **This is why SCHED-1 does
  not close its backlog row.**
- **`sessions.day_role`'s type, and any CSV contract change.** Untouched by construction.
- **Session-indexed rotation (YDP-1).** Still deferred by the maintainer, blocked on the verdicts.
- **Promoting `WRITABLE_DAY_RADIUS`**, and household timezone replacing the per-device `tz` cookie
  (`apps/web/lib/active-timezone.ts`) — the root cause of two devices disagreeing about whether today is
  Monday. Inherited unchanged, not widened (`:518-519`).

## Open questions

1. **Write SCHED-1's one-line acceptance criterion.** The row (`plan.md:1588-1704`) is a brainstorm
   bullet with no `Acceptance` field; this plan quotes the five nearest statements verbatim. Related and
   needed with it: **does SCHED-1 close without `routine_config`'s schedule**, which the ADR defers? If
   not, the row stays open after these five chunks and should say so.
2. **ADR 0007 is `Proposed` (`:3`), not Accepted.** ADR 0006 needed _"a signature, not a session"_
   (`roadmap.md:89`). 1a/1b can proceed either way; **1c's migration must not merge before the
   signature.**
3. **`active_from` for the seeded YDP assignment:** `'2026-09-24'` (the documented start, proposed) or
   the household's earliest logged day? It decides whether a V1-15 day-nav view of a date before
   2026-09-24 shows a program card. My recommendation: `'2026-09-24'` and accept the change, with a test
   that pins it.
4. **Does the ONB-2 collapse get its own backlog row (recommended) or ride a future rotation row?**
   Either way the ONB-2 household-creation writer must write assignment rows in the same transaction as
   the block — that contract needs to land in ONB-2's row, which this plan cannot edit.
5. **Is 1e in or out of SCHED-1?** It is the only chunk that makes the data mean anything and the only
   one that can change what a person sees. Marked cuttable; the maintainer's call.

## Review-response log (adversarial panel)
