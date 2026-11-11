---
feature: Programming (blocks, prescriptions, per-athlete targets)
owns:
  - packages/shared/src/programming.ts
  - packages/shared/src/routine.ts
  - apps/web/lib/routine/
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
    ROUTINE["shared/routine.ts<br/>resolveRoutine(raw, membership, fallback)<br/>NULL → the NEUTRAL first-run routine"]
  end

  SEED --> SEEDFN --> BLOCK
  BLOCK --> QUERY --> DALP --> CARD["program-reference.tsx<br/>Today's card"]
  PROFILE --> ROUTINE --> TODAY["Today's section order"]
  CARD -.->|"V1-19 scaffold:<br/>names + blank rows ONLY"| FORM["strength-form.tsx"]
```

## Files

| File                         | What it is for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/programming.ts`      | `PROGRAM_SEED` — the authored program as data, and its types. The only author of prescriptions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `shared/routine.ts`          | `RoutineConfig` + `resolveRoutine`. Every read zod-parses — the JSONB value is untrusted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/lib/routine/`      | `ROUTINE_CATALOG` (membership + order), `NEUTRAL_DEFAULT_KEYS` (first-run), `resolveProfileRoutine` (the one pairing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `queries/program-day.ts`     | `programDayRows`, shared so the DAL and `db:verify` run the identical query. Also feeds V1-13's `prescribed` column.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `lib/programming/`           | App-side contract + day tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `lib/dal/programming.ts`     | Ownership scoping and the DTO.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `program-reference.tsx`      | Today's "here's your day" card — a collapsible native `<details open>` (V1-23 PR 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `app/p/[profileId]/routine/` | The V1-18 routine editor. 🔴 **UNLINKED since PROF-1 a-r** (acceptance criterion 11, M30): nothing in `apps/web/app` or `apps/web/components` links to `/routine`, so **nobody should "restore" the link** — ACT-1 replaces this editor, and the day-page slot it used now holds "→ Edit {name}". The route stays in code and still renders, exactly as it did before V1-23 PR 2, and `e2e/a11y.spec.ts` deliberately keeps scanning it so an unlinked-but-reachable page is still audited. A routine already saved keeps rendering and logging; a profile with none keeps `NEUTRAL_DEFAULT_KEYS`. ⚠️ It was **linked** from Today between V1-23 and a-r, and its own docstring claimed otherwise until ONB-0 fixed it — a guide that was right while the code's comment was wrong. |

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

4b. **`programDayRows` is HOUSEHOLD-scoped since TEN-1 1c, and that is a strengthening, not a
refactor.** `isThisProfile` is now the single-sourced `isLiveProfile(publicId, scope)` from
`packages/db/src/writers/ownership.ts`, with a **required** `scope` on the query — so an unconverted
caller is a compile error, and both sub-selects (the household hop and the per-kid target scope) pick
up the household conjunct together, which invariant 4's "one named predicate" rule already demanded.

What changed is the _claim_, not the shape. The pre-TEN-1 chain authorized the **block** against the
**profile's own** `household_id`; nothing checked that the **requester** belonged to that household,
because there was no requester. Now the requester's household is asserted independently and the two
must agree — so a profile whose `household_id` were ever repointed (a household transfer, a
correction, an ONB-2 bug) can no longer read the new household's program unchecked. `lib/dal/programming.ts`
resolves the scope with `getHouseholdScope()` and returns `[]` on a null one, so the page signature
and the no-card-rendered behaviour are unchanged.

Two things not to tidy:

- **The `profiles` join inside the block subquery is now redundant — leave it.** Removing a join from
  a BOLA-load-bearing subquery for neatness is risk with no payoff.
- **The "a NULL `household_id` matches no block" note is unreachable** (`profiles_household_id_not_null`
  is a validated CHECK), and it still stays. Do **not** conclude from the nullable drizzle type that an
  orphan profile can exist and add an `OR household_id IS NULL` escape — that would be a hole in the one
  predicate the seam exists to create.

⚠️ **The V1-10 BOLA probes ask from each household's OWN scope on purpose.** They test day_role
disjointness and block selection; asking from the wrong scope would make them pass for a second reason
and stop proving their own messages. The scope's own four-way proof is the TEN-1 matrix at the end of
`verify.ts`, which seeds a day_role **both** households program — so a refusal there cannot be mistaken
for an unprogrammed day.

4c. ✅ **This invariant CHANGED at `TEN-2b`, and the mechanism is now in the writer, not the read.**
`programDayRows` is household-scoped end to end (4b) and still returns `movements.name`, `.slug`,
`.is_bodyweight` and `.unit_default` with **no household predicate of its own** — deliberately, because
adding one would make a card silently vanish rather than render. What changed is how the prescription's
`movement_id` is resolved: **`seedProgram` now reads the GLOBAL namespace only**
(`household_id IS NULL`), so a prescription can no longer attach to another household's movement row,
and the slug-keyed map's **last-row-wins** hazard is gone _structurally_ (the global namespace is unique
by slug) rather than by preference. A slug that exists only in some household's namespace now falls
through to `seedProgram`'s unknown-slug **throw** — loud, with nothing written, which `db:verify`
asserts. ⚠️ So the cross-household reference is **writer-enforced**, and `runbooks.md` pre-flight (d)
is what catches one that got in another way (`TEN-2b`'s `23505` fallback does create them — see
[write-path](./write-path.md)).

**What follows is the defect as it stood before `TEN-2b`**, kept because it is what the 1d proof
asserts. `TEN-2c` closed the **denial** half; the read leak's residual closes at `TEN-2c-1`. The
strength form writes `movements` from free text (`findOrCreateMovementId` →
`packages/db/src/writers/movement-catalog.ts`), and prescriptions resolved by **slug** against a
single global namespace — the same arbiter — so:

- whichever household types a movement name **first** pins that slug's row permanently, with its own
  free text as `name`, `is_bodyweight: false` and no `unit_default` (all this function can write);
- a prescription authored by **another** household on that slug then renders the first typist's
  string on its own Today card, and the log form seeds its unit from the first typist's declaration —
  which `ScaffoldRow` reads as _"the MOVEMENT's declaration, not the coach's"_.

**Proved, not suspected** (TEN-1 chunk 1d): `db:verify` → _"TEN-1 1d: the catalog verdict"_ does
exactly this, end to end, through the real `findOrCreateMovement` and this query. **`TEN-2` is the
fix** (a `household_id` column plus partial unique indexes; how they are built is TEN-2a's call)
and the recorded verdict is that it belongs in Beta 0. Until then: **do not "tidy" the movement columns by assuming
they are as scoped as the rest of the row**, and do not add a NEW read of `movements` metadata without
reading [the plan](../plans/ten-1-household-scope.md) → "1d as built" first. 4b's scoping is correct
and complete; this is the one thing it cannot reach.

5. **`routine_config` NULL means "the NEUTRAL FIRST-RUN routine", not "no routine" and not "everything".**
   It ships dark: a profile with no config renders a fallback order, which is how V1-18 landed without a
   backfill. **ONB-0 split what used to be one list into two, and the split is the invariant:**

   - **Membership** is `ROUTINE_CATALOG` — every key a stored config may legally name. It **never
     narrows.** Narrowing it would silently strip an authored item (a household's `brush_teeth` fields)
     on the next read, which is a data-visible regression rather than a fix.
   - **The fallback** is `NEUTRAL_DEFAULT_KEYS` = `['strength']`, which with the pinned weigh-in is
     "weigh-in + strength only". Before ONB-0 the fallback _was_ the membership set, so a brand-new
     household inherited the entire catalog — ~17 controls belonging to the maintainer's household,
     including seven wrestling-drill metrics grouped under the label "Brush teeth".
   - They are paired in **exactly one place**: `resolveProfileRoutine` in `apps/web/lib/routine/catalog.ts`,
     which is also the only module in `apps/web` that imports `resolveRoutine`. `resolveRoutine`'s third
     parameter is _defaulted_ to the membership set, so a two-arg call still means "inherit the whole
     catalog" — which is correct on the **write** side (`validateRoutineForWrite` pairs membership alone;
     a default is meaningless when authoring) and wrong on the read side, hence the wrapper.
   - **The neutral default is NEVER WRITTEN.** `routine_config = NULL` _is_ its representation, so a
     profile creator leaves it NULL. ⚠️ If PROF-1 / TEN-1 / ONB-2 ever needs to WRITE a starter routine
     from `packages/db`, `NEUTRAL_DEFAULT_KEYS` and the two registries it derives from have to move to
     `packages/shared` first — `packages/db` cannot import `apps/web`. The counter-precedent that makes
     this easy to break by accident is `SEED_FULL_ROUTINE` / `SEED_ATHLETE_TWO_ROUTINE`, which are routine
     literals living in `packages/db/src/seed.ts`.

6. **The seed resolves references and fails loudly, writing nothing on an unresolved ref.** A silent
   partial program is worse than a red deploy — `db:verify` pins this.

7. **JSONB is a knowing exception here.** `routine_config` is the one place this repo stores structured
   data in JSONB, because nothing queries _into_ it. It has a promotion trigger in
   [tech-debt.md](../tech-debt.md). Do not add a second without that conversation.

8. 🔴 **Only a CHILD reads the household's program, and `kind` is read at QUERY time (`PROF-1` a-g,
   Q15 stopgap).** `readsHouseholdProgram(kind)` and `PROGRAM_READ_KIND` live once in
   `packages/shared/src/programming.ts`; the enforcement is a `profiles.kind` conjunct inside
   `programDayRows`' block subquery, which `isLiveProfile` has already pinned to this profile's row.
   An adult resolves no `blockId` and the query returns `[]` — the same "nothing programmed" shape
   the DAL and page already handle.
   **Guarded in the QUERY, not the page or the DAL**, because that one query feeds FOUR consumers:
   the day card, the scaffold/prefill through `getProgramDay`, the export's live fallback, and —
   since V1-22 chunk 2 — `prescribedSnapshotsFor`, which **freezes** this query's answer onto the
   entry. 🔴 **Invariant 3's `id DESC LIMIT 1` rule and this kind conjunct are therefore write-path
   concerns now**: what they decide is recorded permanently, not merely displayed.
   Guarding the latter two separately would be two copies, and `db:verify` drives the query rather
   than the DAL, so the copies would go unproven.
   ⚠️ **THE CONSEQUENCE TO UNDERSTAND BEFORE `a-r` SHIPS: flipping a kid to adult empties
   `prescribed` in every PAST month of their export, and flipping back restores it.**
   🔴 **Half-retired by V1-22 chunk 2** _(2026-11-11)_: an entry logged with an asserted day role now
   carries a FROZEN `prescribed_snapshot`, so flipping `kind` cannot touch it — the reversible
   emptying above applies only to rows still reading the live program, i.e. logged before chunk 2 or
   with no day role. ⚠️ **Chunk 3's backfill makes the remaining ones permanent**, writing `''` for
   unmatched rows (spec R1, upheld 2026-11-11), so **the backfill must run before `kind` ever becomes
   editable** — after it, an athlete who was already adult has an empty history for good. That
   ordering, and the fact that chunk 3 is what satisfies the prerequisite named below, are the two
   things to carry forward. ⚠️ **The justification this invariant shipped with is half-false** _(2026-11-07)_: "a program a
   non-child should not have been reading is not retroactively theirs" holds for the household's
   adult and **not** for a kid who ages out, whose `prescribed` cells were legitimately theirs when
   logged — and ageing out is the realistic trigger. `kind` was therefore made **not editable** in
   `PROF-1` a-r, and the prerequisite for ever making it editable is that the export stop depending
   on today's `kind`. The behaviour below is unchanged and still proved; only the reasoning is
   corrected — and `a-r`'s edit form says so, because it is the screen that can perform
   the flip. Proved in both directions by a `db:verify` flip case, and by two `db:mutations` patches:
   one drops the conjunct (an adult then reads the kids' program), the other inverts
   `PROGRAM_READ_KIND` (kids read nothing), because a missing conjunct and a wrong constant are
   different defects and one patch cannot catch both.
   **The UI half** reads the same predicate on the day page: an adult gets no day-role label and a
   `null` form default ("Not a programmed day"). When the household _does_ program and the athlete is
   an adult, a muted line explains why the card is empty — `householdProgramsAnything()` exists only
   to tell that state apart from "this household programs nothing", which says nothing because there
   is nothing to explain.
   ⚠️ The shared predicate's docblock names **the adult in the household**, not a person — AGENTS.md's no-personal-names rule covers source comments too.
   ⚠️ **`ASSIGN-READ` DELETES this invariant and both halves**, replacing it with per-athlete
   assignments. It is a stopgap with a named end, not a rule of the domain.

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

- **`prescribed` is FROZEN at log time — V1-22 chunk 2 closed the trap this bullet used to
  describe.** `entries.prescribed_snapshot` carries the rendering, and the export falls back to the
  live program only where it `IS NULL`. ⚠️ **NULL means "logged before chunk 2, or logged with no day
  role"** — nothing else; everything logged with an asserted day role freezes, including a movement
  the day does not program (`''`), because a NULL row re-reads today's program at every export and
  chunk 4's first edit would rewrite it.
  **Still true, and now decided in one place:** the match key is **non-unique** — a movement may
  legitimately appear twice in a day, warm-up + working — and an ambiguous match renders **empty**,
  never an arbitrary pick. The rule lives once, in `packages/shared/src/csv/prescribed.ts`'s
  `liveMatchesByKey`, which the writer and the export both call; it keys on `movement_id` rather than
  the slug it used to, because a slug is only a proxy for the row the entry's `movement_id` names and
  `MOV-1`'s rename breaks the proxy.

- **V1-22 widened by GAP-3.** A movement's **load-slot set** (`vest`/`ankle`/`wrist`) is something a
  coach declares, and that authoring surface lands here — it is what keeps the child table invisible on
  a 360px log row, and what makes "no vest row" mean "no vest" rather than "not logged".

- **The routine editor's "Routine saved." is a snapshot, not a flag.** It records the saved payload on
  the render where the action turns `ok` (`useOnActionSuccess`, shared with the log forms since V1-24
  PR 1b), and shows only while the current order still equals it, so an un-submitted edit can never
  read as persisted. Don't replace it with an effect or a boolean.

- **Every page under `/p/` calls `requireSession()`, in-process** — and as of `AUTH-1` **1d** that is
  the whole rule. The routine editor is one of the four. ⚠️ **This said "calls `requireGatedPage()`
  AND THEN `requireSession()`" — both conjuncts — until `1d` deleted the gate.** What has NOT changed
  is why the call is in the page: the proxy is not the auth boundary (before SEC-1 a prefetch-flagged
  request skipped it; CVE-2025-29927 is the general case), and after `1d` these per-page calls are
  the ONLY thing standing there, because the gate bounce that used to back them up is gone.
  `app/pages-need-a-session.test.ts` reports by name any page missing the call — and 🔴 **narrowing it to
  one conjunct must never become an alternation**: a regex accepting either helper proves neither.
  The only exemptions are `isPublicPath`'s: the public landing and `/privacy` (`PUBLIC_PATHS`), and
  the whole `/sign-in` subtree (`PUBLIC_PATH_TREES`). ✅ **`1c-4` is what made this safe** — the
  household scope is membership-derived, so a session decides _whose_ data a request gets; before it,
  deleting the gate would have widened access. ⚠️ The
  routine editor's BOLA row closes **its authz half** here — `updateProfileRoutine` already writes
  through `isLiveProfile(publicId, scope)`, so membership-derivation turns that scoping into
  authorization for a caller outside the household. Inside one household any member still reaches any
  kid's routine, by design, and that row's other halves stay open ([tech-debt](../tech-debt.md)).

- **Fixture athletes are role-named, and the name is a const.** `SEED_PROFILE_NAME` /
  `SEED_PROFILE_2_NAME` (`packages/shared/src/seed-ids.ts`) hold `Athlete One` / `Athlete Two`. Never
  re-type the literal and never put a real first name in a fixture, a comment or a test — this repo is
  public and holds minors' data (AGENTS.md → "No personal names"; `OSS-1`). `db:verify` pins the
  literal **once**, on the assertion side, so a real name cannot come back unnoticed. Prose about a
  real logged incident says "an athlete", not a fixture name — the fixture is not the child.

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
- [ADR 0005](../decisions/0005-programming-model.md) — workouts become data; the prescription is
  snapshotted on the logged record, not versioned
- **[ADR 0007](../decisions/0007-scheduling-model.md) — the scheduling model.** Read it before touching
  invariants 3, 3b or 3c: it decides that the one-block-by-design rule (invariant 3) becomes conditional
  on an assignment row, that invariant 3b's calendar anchor moves into data **without** changing to
  session-indexing, and that invariant 3c's "temporary" `strength_a`/`strength_b` reuse resolves by
  **naming** (they become the authored workouts' slugs) rather than by a CHECK migration. Nothing in it
  has shipped — it is a decision, and `SCHED-1` implements it.
