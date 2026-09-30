---
feature: Programming (blocks, prescriptions, per-athlete targets)
owns:
  - packages/shared/src/programming.ts
  - packages/shared/src/routine.ts
  - packages/db/src/queries/program-day.ts
  - apps/web/lib/programming/
  - apps/web/app/p/[profileId]/program-reference.tsx
  - apps/web/app/p/[profileId]/routine/
---

# Programming

**Read this before changing what the coach authors, or what Today shows an athlete.**

## What this is

The **plan**: which movements an athlete is meant to do on a given day, in what order, at what
prescribed sets/reps/load. Distinct from the **log**, which is what actually happened
([strength-logging](./strength-logging.md)).

Two independent axes that are easy to confuse, and confusing them has already cost a session:

- **Program** — `program_blocks → prescriptions → prescription_targets`. A coach-authored block of
  work with per-athlete loads. Currently **seed-only**; there is no write path in `apps/web` at all,
  so changing a load means editing TypeScript and deploying. V1-22 is the editor.
- **Routine** — `profiles.routine_config`, a per-kid ordered list of activity keys (rice bucket, then
  strength, then a habit). This is the shape of a **day**, not a block of strength work. V1-18
  shipped its editor.

They **co-exist permanently**. Ray runs a daily A/B program _and_ a weekday S&C block at once.

## The map

```mermaid
flowchart TD
  subgraph authored["authored — TypeScript, no UI yet"]
    SEED["shared/programming.ts<br/>PROGRAM_SEED"]
    SEEDFN["db/seed.ts → seedProgram()<br/>resolves refs, fails LOUDLY"]
  end

  subgraph tables["postgres"]
    BLOCK[(program_blocks)] --> PRESC[(prescriptions)] --> TARGET[(prescription_targets)]
    PROFILE[(profiles.routine_config)]
  end

  subgraph read["read path"]
    QUERY["queries/program-day.ts<br/>programDayRows — ONE block by design"]
    DALP["lib/dal/programming.ts<br/>BOLA + day-aware scoping"]
    ROUTINE["shared/routine.ts<br/>resolveRoutine — NULL → the default"]
  end

  SEED --> SEEDFN --> BLOCK
  BLOCK --> QUERY --> DALP --> CARD["program-reference.tsx<br/>Today's card"]
  PROFILE --> ROUTINE --> TODAY["Today's section order"]
  CARD -.->|"V1-19 scaffold:<br/>names + blank rows ONLY"| FORM["strength-form.tsx"]
```

## Files

| File                         | What it is for                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `shared/programming.ts`      | `PROGRAM_SEED` — the authored program as data, and its types. The only author of prescriptions.                      |
| `shared/routine.ts`          | `RoutineConfig` + `resolveRoutine`. Every read zod-parses — the JSONB value is untrusted.                            |
| `queries/program-day.ts`     | `programDayRows`, shared so the DAL and `db:verify` run the identical query. Also feeds V1-13's `prescribed` column. |
| `lib/programming/`           | App-side contract + day tests.                                                                                       |
| `lib/dal/programming.ts`     | Ownership scoping and the DTO.                                                                                       |
| `program-reference.tsx`      | Today's "here's your day" card — a collapsible native `<details open>` (V1-23 PR 3).                                 |
| `app/p/[profileId]/routine/` | The V1-18 routine editor. **Linked from Today since V1-23** (below the logged entries) — it was URL-only before.     |

## Invariants

1. **The plan is never a performed value.** A prescription's load is the coach's _cue_, and it must
   not cross into the log as a logged number. V1-19's scaffold carries movement names and blank set
   rows **only** — `ScaffoldRow` has no `load` field, so the type enforces it. This is the product's
   one inviolable rule wearing a data-model hat.

1b. **Today's card collapses natively, and its `<h3 id=…>` MUST stay inside the `<summary>`.** V1-23
PR 3 made the card a `<details open>`. The wrapping `<section>` is labelled by that heading's id, so a
heading moved into the collapsible body is **gone from the accessibility tree when the card is closed** —
`aria-labelledby` dangles, axe raises `aria-valid-attr-value`, and `apps/web/e2e/a11y.spec.ts` (which now
scans the card in **both** states) **fails the build**. Two more things not to re-litigate:

- **Native, not React state, deliberately.** The rejected alternative was passing the card as `children`
  into `StrengthForm`; that form remounts on `key={gen}` after every logged session, so a state-based
  collapse would **re-expand on every log** — the exact complaint V1-23 exists to fix. `<details>` keeps
  the card a Server Component, ships zero client JS, and the athlete's collapse survives a log.
- ⚠️ **The "NOT a native `<details>`" note on the form's collapsed MOVEMENT cards does not generalise.**
  Its reason is `required`-INPUT-specific (a hidden-but-present `required` input deadlocks the native
  submit with an invisible error). This card has **no form controls at all**, and sits outside the
  `<form>` — so a `<summary>` cannot submit either (a `<button>` trigger would need `type="button"`).

2. **`prescriptions.target_reps` and `prescription_targets.load` are verbatim TEXT, deliberately.**
   They hold `AMRAP`, `~145-150`, `3 (top triple, then 2 back-offs)`. GAP-3 typed the **log**, not the
   plan — see [ADR 0004 §2](../decisions/0004-typed-measurements.md). Do not "fix" them into numbers.

3. **`programDayRows` returns ONE block by design.** It is not a bug that a second block does not
   appear. Anything wanting multiple concurrent programs is SCHED-1, a different model.

   ⚠️ **This is why only ONE block is seeded.** Since 2026-09-24 that is the **Youth Daily Program**
   — the A/B rotation the kids actually run. The Kids S&C Foundation block it replaced is archived
   verbatim at [docs/programs/kids-sc-foundation-archived.md](../programs/kids-sc-foundation-archived.md)
   and can be re-seeded when it returns. Seeding both would silently hijack one card with the other,
   because the newest block per day-role wins.

3b. **The day letter comes from the CALENDAR, and that is a decision.** `resolveDayRole` is
epoch-day parity — every calendar day is A or B, alternating, with no rest day. Date parity, not
a weekday map: seven is odd, so a weekday map repeats a letter across every Sat→Sun boundary.

The program spec says the letter must come from the count of COMPLETED SESSIONS and warns that a
calendar-derived letter doubles up box jumps after a missed day. **Ray accepted that deliberately**
— the motivation model is streak and consistency. **Do not "fix" it without asking**; session
indexing is YDP-1, blocked on SCHED-1. The tests pin the decision, so a "fix" turns them red.

3c. **`strength_a`/`strength_b` are REUSED as Day A / Day B** — temporary. Proper `ydp_a`/`ydp_b`
roles need a migration altering two `day_role` CHECKs; reusing them is what let the athletes log
the same evening instead of on paper.

3d. **The day letter appears TWICE on Today, and the two are different things.** Since V1-23 the date
line reads `Today · Fri, Sep 26 · Strength B` — that badge is **derived** page metadata, straight off
`resolveDayRole`, and nobody asserts it. The `dayRole` **select** in `strength-form.tsx` is the
athlete's **assertion**, the one that gets stored on the session (GAP-1 P0-1), and it stays where it
is: after every movement card, immediately before submit. **Do not "deduplicate" them by moving the
select into the header** — three V1-23 panels rejected exactly that. What makes the assertion real is
the select's **position** (unavoidable on the way to "Log strength"), not its visibility; pre-filled
in the header it is functionally the hidden input the P0-1 note forbids. `DAY_ROLE_LABELS` is the
single label source for both, so the badge also inherits 3c's "Strength B" wording for Day B.

3e. **`resolveDayRole` is TOTAL** — `(day: string) => DayRole`, never null, because the YDP has no rest
day. Guards of the form `dayRole ? … : []` are dead code left over from the Mon/Wed/Fri map; V1-23
removed the one in Today's `Promise.all`. Do not add new ones, and do not read a `null` branch as
evidence that an unprogrammed day exists.

4. **Every read is scoped by profile `public_id` and filters soft-deleted rows at every level** —
   block, prescription, target, movement. `db:verify` proves each one independently.

5. **`routine_config` NULL means "the default routine", not "no routine".** It ships dark: a profile
   with no config renders the default order, which is how V1-18 landed without a backfill.

6. **The seed resolves references and fails loudly, writing nothing on an unresolved ref.** A silent
   partial program is worse than a red deploy — `db:verify` pins this.

7. **JSONB is a knowing exception here.** `routine_config` is the one place this repo stores structured
   data in JSONB, because nothing queries _into_ it. It has a promotion trigger in
   [tech-debt.md](../tech-debt.md). Do not add a second without that conversation.

## Traps

- **"B is purely additive" is wrong.** `programDayRows` returns one block by design; an A/B program and
  a weekday S&C block do not merge into one card. Cost a session to rediscover.

- **Block _creation_ is hard-disabled in V1-22 scope A.** The day's block resolves by `id DESC LIMIT 1`,
  so creating one would silently hijack every athlete's Today card.

- **`.$type<RoutineConfig>()` is a compile-time cast only.** The stored JSONB is untrusted input; every
  read must `resolveRoutine` (which zod-parses). Treating the cast as validation is a hole.

- **`programDayRows` selects BOTH `movements.name` and `movements.slug`.** The Today card renders the
  name; the CSV export keys `prescribed` back to a logged movement by the **slug** (V1-13b), because
  `name` is a display string — `"Front Squat"` — and would never match. Both come from one query so
  neither side converts.

- **`programDayRows` also carries the MOVEMENT's declaration — and that is not the coach's
  prescription (V1-26 PR-A).** `movementIsBodyweight` / `movementUnitDefault` come off the
  already-joined `movements` row and ride `ProgramDayDTO` → `ScaffoldRow` → the log form's Unit select.

  ⚠️ **The line this query must never cross is `prescription_targets.load`.** The declaration says what
  KIND of number a movement is measured in; the prescription says WHICH number this athlete should
  lift. `ScaffoldRow` has no `load` field at all, so "no authored load reaches an input" — AGENTS.md's
  one inviolable product rule — is enforced by the **type**, not by care. `page.tsx` narrows
  `ProgramDayDTO` at the boundary for the same reason. Widening either is a product decision, not a
  plumbing one.

- **V1-13's `prescribed` reads TODAY's program, not the program as it was.** There is no
  `entries.prescription_id` (GAP-1 P1-2 unbuilt), so the export matches back by `(day_role, movement)`
  — a key `schema.ts` documents as **non-unique** ("a movement may legitimately appear twice in a day
  — warm-up + working"). An ambiguous match emits **empty**, never an arbitrary pick. ⚠️ **V1-22
  breaks this**: an edited load would retroactively rewrite exported history.

- **V1-22 widened by GAP-3.** A movement's **load-slot set** (`vest`/`ankle`/`wrist`) is something a
  coach declares, and that authoring surface lands here — it is what keeps the child table invisible on
  a 360px log row, and what makes "no vest row" mean "no vest" rather than "not logged".

## Changing it

| If you are…                      | Start here                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------- |
| changing the authored program    | `shared/programming.ts` `PROGRAM_SEED`, then re-run the seed (idempotent)     |
| changing what Today shows        | `queries/program-day.ts` → `lib/dal/programming.ts` → `program-reference.tsx` |
| changing the day's section order | `shared/routine.ts` — and remember NULL is meaningful                         |
| adding a write path              | V1-22. Both panels required; these are the first config-mutating endpoints.   |

Then `pnpm verify` — the programming proofs in `db:verify` are extensive and will catch a scoping
regression that tests will not.

## Background

- [plan.md](../plan.md) rows V1-10, V1-18, V1-19, V1-22, SCHED-1
- [V1-22 plan](../plans/v1-22-program-editor.md) — panelled, scope A/B split
- [ADR 0002](../decisions/) — `ramp_target` is a coach-authored calendar, not a progression engine
