# ADR 0007 — The scheduling model

**Status:** Proposed · **Date:** 2026-10-07 · **Scope:** Beta 1 and later ·
**Continues:** [ADR 0005](./0005-programming-model.md), whose "What this does not settle" is this
document's charter · **Relates:** [ADR 0002](./0002-calisthenics-ramp-targets.md) (the one
materialized-plan table this repo already has)

> **This is the second draft.** The first decided the same five questions and then **authorized five
> new tables and a `DROP COLUMN` on live data** on the strength of them. A five-lens panel found that
> three of those tables have no consumer in the backlog, that the destructive arc is **six PRs rather
> than three** and makes the one feature it claims to unblock unexecutable for the first two of them,
> that four of the draft's single-sourcing guarantees could not be delivered because the helpers they
> name live in the wrong package, and that its headline sequencing dividend contradicted the document
> twice. The review-response log at the bottom records what was accepted and what was pushed back.
>
> **The central correction: deciding a shape and authorizing a migration are different acts.** This
> ADR now does the first for all five questions and the second for **two additive tables only.**

> **Scope honesty, because it changes how this should be read.**
> [beta-1.md](../milestones/beta-1.md) §3b defers all of this to **after beta** — _"Deferred to a
> scheduling ADR, after beta: RRULE recurrence, rotation as data, `day_role` becoming rows, workout
> creation, and the planned-occurrence row."_ So this unblocks **Beta 1 and later** rows, not the
> Beta 0 critical path. It is wanted because `SCHED-1`, `MOT-1` and `V1-22 A4` cannot be planned
> without it, and because two of its questions close windows quietly if the first implementation
> answers them instead of this document.

## Context

The entire scheduling layer this app has is **43 lines with one exported function**:
`apps/web/lib/programming/day-role-schedule.ts`, whose `resolveDayRole(day)` (`:41-43`) is epoch-day
parity over the whole installation. It carries no household, no athlete and no program.
`docs/tech-debt.md:335-349` records it as debt and names its own promotion trigger.

Everything a schedule would hang off is missing or hardcoded:

- **`program_blocks` has no `profile_id`** (`packages/db/src/schema.ts:629-648`). The only per-athlete
  link is `prescription_targets.profile_id`, which carries loads. The model can say _"both kids do
  this block, at different loads"_ and cannot say _"Athlete One does S&C, Athlete Two doesn't."_
- **No date range anywhere.** Grepped: no `active_from`, `starts_at`, `season` or `effective` column.
  A block is active forever until soft-deleted.
- **Which block answers today is `id DESC LIMIT 1`** among blocks that program the requested
  `day_role` (`packages/db/src/queries/program-day.ts:19-27, 48-62`). That is why V1-22 hard-disables
  block creation, and the query's own docblock names the intended fix: _"An explicit active-block
  marker is the real fix when multi-block authoring lands"_ (`:26`).
- **`routine_config` has no schedule at all** — implicitly every day, so "mobility only on practice
  days" is unrepresentable (`docs/plan.md:1048-1049`).
- **Nothing records what was due.** `MOT-1` has no "due today" to read, and `docs/plan.md:1122-1130`
  states why recomputing it is unacceptable: a program edit re-judges history and the kid's number
  moves for reasons they cannot see.

Four measured facts bound every option below.

1. **There is no date library.** A grep for `date-fns|dayjs|luxon|rrule|temporal` across every
   `package.json` returns nothing. All date math is hand-rolled and dependency-free in
   `apps/web/lib/date.ts` — `localDayIso` (`:49`), `isoDayDiff` (`:108`), `addDays` (`:121`),
   `localWeekStartIso` (`:128`), `localWeekday` (`:143`) — and `isIanaTimeZone` (`:89`) says so out
   loud: _"Dependency-free: the Intl constructor throws."_
2. **⚠️ Every one of those helpers lives in `apps/web`, and no file under `packages/` imports any of
   them.** `grep -rn "T00:00:00Z\|getUTCDay\|86_400_000" packages/` returns zero hits. Dependency
   direction is app → packages, so **any pure resolver placed in `packages/` today can reach none of
   this** — which is decision 1 and 2's largest hidden cost, and the first draft missed it.
3. **There is no scheduled-job infrastructure.** `.github/workflows/` holds five workflows and the
   only `schedule:` trigger is CodeQL's weekly scan (`codeql.yml:23-27`). There is no `vercel.json`,
   so no Vercel cron. Anything that must "run nightly" is net-new infrastructure.
4. **`day_role` is a byte in a byte-faithful contract.** `csvSessionType` emits `sessions.day_role`
   into the CSV's `session_type` column with `_`→`-` and nothing else
   (`packages/shared/src/csv/columns.ts:40-42`); `session_type` is **not** in the quotable set
   (`QUOTABLE = {notes, prescribed}`, `packages/shared/src/csv/row.ts:21`), so a comma in it **throws
   and fails the whole export** (`row.ts:31-41`). `day_role` / `DayRole` appears in **41 files**
   across `apps/` and `packages/`, four of them migrations.

## Decisions

### 1. Recurrence is a weekday SET, as rows. Not RRULE, and `daily` is not a kind

A schedule says **which days of the week** a program is due, as rows on the assignment row of
decision 4. Dueness is `EXISTS (… WHERE weekday = localWeekday(day))`: a lookup, which is the
property `docs/plan.md:1081-1085` chose it for and the one that keeps `MOT-1` arithmetic-free.

**`daily` is seven rows, not a `schedule_kind` member.** That deletes a discriminant the V1-22 plan
proposed carrying, and makes the live Youth Daily Program and the archived Mon/Wed/Fri block the same
shape with different rows.

⚠️ **The weekday origin is `0 = Sunday … 6 = Saturday`, the `localWeekday` convention, and it must be
stated because this repo holds both.** `localWeekday` is `getUTCDay()` (`date.ts:143-145`), while
`localWeekStartIso` three lines above is Monday-first ISO-8601 to match `ramp_targets.week_start`
(`date.ts:128-131`). A seeder that writes ISO weekdays (`1 = Mon … 7 = Sun`) yields a **silently
one-day-shifted program**: values 1–6 all resolve to the wrong day and only `7` trips a range CHECK.
That is the same class as the bug `localWeekday`'s own docblock names — _"a Monday program would
render on Sunday"_ (`date.ts:134-141`). So the weekday is a **`packages/shared` const**
(`WEEKDAYS` + a zod enum + `z.infer`, the canonical enum home AGENTS.md names), anchored in its
docblock to `localWeekday`, with `CHECK (weekday BETWEEN 0 AND 6)` pinned by
`assertCheckCoversConst` the way both `day_role` CHECKs are (`packages/db/scripts/verify.ts:770`,
called at `:2392` and `:3416`). **Not** a reference table — seven universal values are the
"don't over-abstract" case.

**The assignment schedules a BLOCK, not a workout.** A per-workout schedule would let "Day A on
Mondays, Day B on Thursdays" be expressed with no rotation at all — a third shape that makes
decisions 1 and 2 overlap. Nothing in the backlog needs it. Settled here rather than left open,
because it is the parent FK of the one table SCHED-1 is told to build first, and reopening it after
that table has children is a second migration.

**RRULE (RFC 5545) is rejected, on three grounds, in increasing order of force.**

- **Cost.** It needs a library, and this repo has deliberately bought zero date dependencies. On a
  public repo whose `audit:check` gate landed _because_ four advisories reached `main` with CI green
  (`docs/roadmap.md:121-125`), a new runtime dependency on the scheduling path is a standing cost.
- **Model mismatch.** RRULE recurs over **instants** with a `DTSTART` and `TZID`. This app's
  scheduling unit is a bare local calendar date, by a correctness V1-6c already paid for; adopting
  RRULE means re-deriving it inside someone else's expansion logic.
- **It does not answer the live question.** The Youth Daily Program runs every day; "is it due
  today?" is always **yes**. The open question is _which variant_ — decision 2 — which no recurrence
  rule expresses. RRULE would buy a dependency, a timezone hazard and an expansion horizon, and leave
  the program on `main` needing the other mechanism anyway.

**Also rejected: a quota (`3×/week`, any days).** Already settled against
(`docs/plan.md:1081-1085`), tradeoff recorded and accepted at `:1794-1806`. Not reopened.

**Also rejected: a packed `smallint` bitmask.** One column, but dueness becomes `(mask >> weekday) & 1`
— bit arithmetic in SQL, unindexable, and a packed value, which is the shape AGENTS.md's "values stay
in fixed typed columns" refuses. Rows are also the repo's idiom for an enumerated set.

**What this cannot express, and why that is accepted:** "every other Tuesday", "the first Monday of
the month", and a one-week tournament exception. The first two have no case anywhere in
`docs/plan.md` or the samples. The third is answered by the assignment's date range — close one,
open another. **The door is not nailed shut:** an `rrule text` column beside the weekday rows is
purely additive if a case ever arrives, with the rows staying the fast path.

**The honest bill.** The weekday table implies a **recurrence editor**, which ADR 0005's deferral
list names as its own item and which `docs/tech-debt.md:338-342` prices as the real objection to this
exact table — _"a `block_schedule` table would ship a migration plus an authoring UI for data exactly
one household can author."_ That editor drags a **mandatory UX panel** with it (AGENTS.md → UI PR
rules). Both belong in SCHED-1's estimate.

### 2. Rotation becomes data as an ANCHOR plus an ORDERED LIST — on the BLOCK — and stays calendar-indexed

The A/B letter is computed today and stays computed. "Rotation as data" moves the **inputs** out of an
app const: a `rotation_anchor_date` and ordered rows `(block, idx, workout)`. The resolver stays pure:

```
slot = floorMod(isoDayDiff(day, anchor), slotCount)
```

**Written with `isoDayDiff`, not a new `epochDay`.** `epochDay(day) - epochDay(anchor)` _is_
`isoDayDiff(day, anchor)` (`date.ts:108`) spelled longhand; the live `epochDay` is module-private
(`day-role-schedule.ts:27`) and `floorMod` exists nowhere in the tree. The ordinal is **`idx`**, not
`position` — `prescriptions.idx` is "0-based order within the day (matches `entry_sets.idx` idiom)"
(`schema.ts:673`), and a second spelling for one concept is what the constants rule forbids.

**⚠️ The anchor belongs on `program_blocks`, not on the assignment.** The first draft put it on the
assignment; the panel was right that this is wrong. `resolveDayRole` is global today, so **both kids
always see the same letter** (feature guide invariant 3b) — and the YDP is one program the two
athletes run **together**. One anchor per assignment means N anchors for one program, and a coach
editing one kid's anchor puts siblings on different letters at the same practice, invisibly. The
citation the draft leaned on (`docs/plan.md:1103`) argues the **schedule** belongs on the assignment
because only the assignment can say one athlete runs this and a sibling does not — that is
**enrollment**, not rotation **phase**, which is a property of the program's calendar. So: weekday set
and date range on the assignment; anchor and rotation list on the block.

**The equivalence with today's behaviour is checkable, and the acceptance criterion is stronger than
the first draft's.** With anchor `2026-09-24` and list `[strength_b, strength_a]`:
`isoDayDiff('2026-09-24', epoch)` is **20720**, even, so the live `resolveDayRole` returns
`strength_b` and the generalized form returns slot 0, which is `strength_b` — confirmed by running it
over ±30,000 days with zero mismatches. ⚠️ **But that agreement partly survives on luck**: the live
test is `% 2 === 0` and `-0 === 0`, so `%` and `floorMod` only diverge **before the anchor** or at
`slotCount ≥ 3`. The migration's equivalence test must therefore span dates **before** the anchor and
include a three-slot case, or it proves the one arrangement that cannot fail.

⚠️ **Calendar-indexing is preserved as the deliberate override it is, and this ADR does not reopen
it.** The reasoning is already recorded in three places — `day-role-schedule.ts:10-20` with the
maintainer's 2026-09-24 quote, `docs/plan.md:1651-1662` (YDP-1), and invariant 3b of
[features/programming.md](../features/programming.md). This ADR points rather than writing a fourth
copy. **Session-indexed rotation stays YDP-1, deferred by the maintainer, blocked on decision 5's
recorded verdicts**, and nothing here is designed to make it the default later.

**List stability is load-bearing, and reordering has a known hazard.** ADR 0005 decision 7 named the
first half: _"a calendar index over an ordered list needs an anchor and a stable list, or editing
`[A,B]` to `[A,B,C]` silently changes which workout every past date had."_ The second half is
mechanical: a non-deferrable partial UNIQUE on `(block_id, idx)` rejects a 0↔1 swap mid-statement, so
a reorder needs the shifted-band writer ADR 0005 item 3 already parks for V1-22 A3. Decision 2
inherits that proof rather than inventing one.

**Rejected: materializing the letter per day.** It is a pure function of (anchor, list, date);
recomputing it is three operations. A row per athlete per day to store it is decision 5's mistake in a
smaller hat.

### 3. `day_role` splits in two: a ROW on the authored side, frozen TEXT on the logged side

"`day_role` becoming rows" means two different things, with different answers.

**(a) A global `day_roles` reference table — rejected.** A table plus two FKs plus two covering
indexes plus the removal of two CHECKs, buying nothing a household can use: a reference table is the
idiom for **global reference data** (`units`, `activity_type_categories`, `quantity_slots`), not for
authored content, and it would not let anyone add a day. Most of what it would hold is labels, which
`quantity_slots`' own docblock refuses on principle — _"labels are a rendering concern and live in
@mat-plan/shared"_ (`schema.ts:84-85`).

**(b) A household-authored `workouts` row — this is the shape, because ADR 0005 decision 1 already
decided it.** That decision says a workout becomes "a named, household-owned row" carrying "a stable
`slug` as well as a display name, and every machine consumer reads the slug". `prescriptions` is where
that identity is needed: the slot key `(block_id, day_role, idx)`
(`uq_prescriptions_block_day_role_idx`, `schema.ts:680-683`) becomes `(workout_id, idx)`.

**The owning parent is the BLOCK, and the slug is unique per block.** ADR 0005 said "household-owned";
the panel showed household-scoped uniqueness does not survive contact with the data. The archived Kids
S&C block also uses `strength_a`/`strength_b` and the feature guide says it _"can be re-seeded when it
returns"_ (invariant 3) — so `uq_workouts_household_slug` would **reject the second workout on
re-import**. `workouts(block_id, slug)` does not. Consequence, stated because it is the cost of the
choice: `sessions.day_role`'s frozen slug then identifies a **workout name**, not a workout row, and
is ambiguous across two concurrent blocks. That is acceptable only because the frozen text is
export-only and never read back as identity — the same boundary ADR 0005 decision 5 draws around
`prescribed_snapshot`. Anything that needs row identity on a logged session needs a separate column and
its own decision.

⚠️ **`sessions.day_role` must NOT become an FK. It stays frozen text, and the text is the slug.** An
FK to a household-editable row means **renaming a workout rewrites the CSV's `session_type` column for
every past session** — the identical defect `entries.prescribed_snapshot` exists to prevent one column
over (`schema.ts:185-198`). So the logged side keeps the verbatim-text treatment `raw_load` /
`raw_reps` / `prescribed_snapshot` already use.

⚠️ **The claim "the logged past is already safe" is true only for non-null sessions.**
`sessions.day_role` is nullable (`schema.ts:501`) and the CHECK's comment says NULL passes
(`:518-524`); the provenance docblock is explicitly conditional — _"a **non-null** value means A HUMAN
ASSERTED IT"_ (`:493-497`). `entries.session_id` is nullable too (`csv/columns.ts:36-39`), so a day can
hold logged work with no session row at all. For those days nothing records which workout was
fulfilled. **Therefore decision 5's verdict must key on occurrence existence, not on day-role
identity** — which is what makes it immune to this, and to the amend path.

**Five costs, named rather than discovered later:**

1. **The slug grammar is a new `packages/shared` const, and "the `movementSlug()` charset" is not it.**
   `movementSlug` is `name.trim().toLowerCase().replace(/\s+/g, '_')`
   (`packages/shared/src/movements.ts:34-36`) — it defines no charset and **strips no punctuation**,
   which ADR 0005 decision 1 already recorded (`movementSlug('Strength A, heavy')` →
   `'strength_a,_heavy'`). Writing that into `sessions.day_role` re-opens the comma-throws-the-export
   defect of context fact 4. So: a **`SLUG_PATTERN` / `slugSchema`** in `packages/shared` beside
   `movementSlug`, as the single source for the zod boundary on a workout name **and** the DB CHECK
   (SQL is the one place that cannot import a const, so without a named const the grammar is defined
   twice), plus ADR 0005's `hasCommaOrLineBreak` (`packages/shared/src/text.ts:38`) carried forward at
   the input boundary. Both halves, or the guarantee is two-thirds of one.
2. **Two exact-set CHECKs loosen, and both `db:verify` pins die.** `assertCheckCoversConst` ends in
   `assert.deepEqual(inlined, [...values].sort())` (`verify.ts:784-788`), and a regex CHECK's only
   quoted token is the pattern, so the assertion can never pass. `sessions_day_role_check`
   (`verify.ts:2392`) is **replaced**; `prescriptions_day_role_check` (`:3416`) **dies with the
   column**, and `assertCheckCoversConst`'s own `assert.equal(rows.length, 1, …)` (`:775`) then fails.
   This is a guard getting weaker and belongs in a PR description as one. A form that keeps a real
   guard: `CHECK (day_role IS NULL OR day_role ~ '<SLUG_PATTERN>')`, plus a retained **one-directional**
   assertion that all ten `DAY_ROLES` members still pass (the loop at `verify.ts:777-780` without the
   `deepEqual`), plus `expectRejectedBy` for each byte that breaks the export — `'strength a'`,
   `'Strength_A'`, `'a,b'`, `"a\nb"`, `''`.
3. **A workout must declare its `session_type`.** `logStrengthSessionSchema` refines
   `DAY_ROLE_TO_SESSION_TYPE[dayRole] === sessionType`
   (`packages/shared/src/strength-session.ts:131-139`) over an exhaustive `Record<DayRole, SessionType>`
   (`programming.ts:51-62`) with no entry for an authored slug. So `workouts` carries a `session_type`
   constrained to `SESSION_TYPES`, pinned by `assertCheckCoversConst`, and the hardcoded Record survives
   only as the fallback for the ten built-ins. The ten legacy codes are therefore **reserved** against
   household authoring, or the fallback silently claims an authored `push`.
4. **The export has a hard `DAY_ROLES` gate, and nobody has noticed.** `prescribedFor` begins
   `if (!(DAY_ROLES as readonly string[]).includes(role)) continue;`
   (`apps/web/lib/dal/export.ts:101`). An authored slug falls through it, so `prescribed` emits
   **empty** for every authored workout with no error. Decision 3 cannot ship without changing that
   line, and the first draft did not know it existed.
5. **Invariant 4 grows a fifth soft-delete level.** The feature guide's invariant 4 is "block,
   prescription, target, movement — `db:verify` proves each one independently". `workouts` adds one, so
   `programDayRows` needs `isNull(workouts.deletedAt)` and its own proof. And
   `docs/csv-export-contract.md`'s `session_type` section enumerates the legal values; it changes in the
   same PR as the CHECK, and that contract's seam owner is **Insight**, not Authoring
   (`docs/roadmap.md:112-116`).

**One thing this buys for free.** Invariant 3c calls `strength_a`/`strength_b`-as-Day-A/B _"temporary"_
and prices the fix as a migration altering two CHECKs. Under (b) the YDP's two days become authored
workouts **whose slugs are `strength_a` and `strength_b`** — not one CSV byte changes, and 3c resolves
by naming. The seed does the same mapping the backfill needs (`seed.ts:295-313` keys prescriptions on
`(blockId, dayRole, idx)`), so they share one source — unlike ADR 0005 finding D3's unreachable one.

### 4. A household can create a workout. The thing that unblocks it is the ASSIGNMENT row, not a marker

**In two steps, with different blockers.**

**Create a workout (a day) inside a block the household already has.** The shape is decision 3's
`workouts` table — but see "What this ADR does not authorize": it is **not** reachable at the start of
that arc, and there is a cheaper interim that needs no schema at all.

**Create a block** — blocked by the read path, not a missing column. `programDayRows` resolves one
block by `id DESC LIMIT 1`, and the feature guide pins that as deliberate (invariant 3). Creation is
safe only once Today renders the athlete's **set** of active assignments.

⚠️ **That read change is bigger than a Today card, and the first draft under-priced it.** The export
follows the same read: `prescribedFor` keys on `` `${dayRole}:${movementSlug}` `` and sets `null` —
emitting `''` — on any duplicate (`export.ts:98-116, 134-135`). Today a duplicate can only arise
_within_ one block (the documented warm-up/working case). Under N concurrent assignments, two blocks
prescribing the same movement on the same day collide, and cells that previously exported a non-empty
`prescribed` **export empty**. ADR 0005 records that the legacy `(day_role, movement)` match persists
**permanently** for pre-snapshot entries, so chunk 1's `prescribed_snapshot` does not cover them. So
the N-assignments change is a **byte-affecting** change to a contract owned by another pillar, and its
resolution — the legacy path reads one designated assignment, or the match key gains a discriminator —
must be decided before it ships.

⚠️ **This withdraws a column the Authoring spec promised**, and the correction has already landed in
this PR (`docs/specs/v1-22-authoring-program-editing.md` → Out of scope). The spec said _"That ADR also
needs an active-block marker on `program_blocks`."_ It does not. Once a block reaches an athlete through
an assignment carrying a schedule and a nullable `active_from`/`active_to` (`docs/plan.md:1115-1120`),
"which block answers today" is a query over live assignments and "is this block active" is its date
range. One row does dueness, seasonality and activeness; a boolean beside a date range is a second,
drifting answer to one question.

### 5. Dueness is DERIVED. The verdict is RECORDED, and it SNAPSHOTS what it judged

**A scheduled-but-not-yet-logged session gets no row.** Not today, not tomorrow, not for any future
date. The plan is a function of (assignment, schedule, date) and stays one.

**A day that has closed gets exactly one verdict row** per athlete, in its own table. **And the row
carries the dueness it was judged against, not only the judgement.** The first draft called the row "a
cache of a derivation"; all three of correctness, DB-safety and architecture showed independently that
this is false and that the draft contradicted itself. Nothing settles a day at the moment it closes —
there is no cron (context fact 3) — so a verdict written on the athlete's next visit is derived from
the schedule **as it then stands**, which is exactly the retroactive re-judging `docs/plan.md:1122-1130`
exists to forbid. A cache whose source has already changed is not a cache.

**So the verdict snapshots.** This is the `entries.prescribed_snapshot` idiom one table over, chosen for
the same reason: a reference resolved later reads today's values, and only the frozen fact survives an
edit. Concretely the row records **what was due and how much of it was done** alongside the verdict, so
"why did Tuesday not count" is answerable without recomputation — which also closes the first draft's
open question 2 rather than deferring it.

⚠️ **The snapshot's inputs must be facts no out-of-window writer can change.** Occurrence existence and
the occurrence-grain skip qualify; performed **values** do not. That matters because the draft's claim
_"nothing can be logged into a settled day"_ is **false against the tree**: the V1-24 amend path
deliberately has no day bound and says so — _"**No `resolveDeclaredDay`** — an amend never moves the
entry's date, so a ±1 day bound buys no integrity and would render a dead control on exactly the history
days a typo is found on"_ (`apps/web/app/p/[profileId]/actions.ts:504-509`) — and `/api/sync` and
`db:correct` write arbitrary past days by design. The narrower true claim is that **no new occurrence**
can be created in a settled day, and the invariant that makes it sufficient is that an amend changes a
performed value, never whether the day was done.

**Why not materialized ahead of time:**

- **Nothing could write the rows** (context fact 3), and a lazy expander writing _future_ rows must
  invalidate them on every schedule edit.
- **A machine-authored row must not reach `entries` or `sessions`.** ADR 0005 decision 6 settles it: the
  strength CSV derives `SKIPPED` from `entries.status` and a generated row would be indistinguishable
  from a human's.
- **The repo's one materialized-plan table has never been populated.** `ramp_targets` has a migration
  and a `db:verify` proof, and `CALISTHENICS_RAMP_SCHEDULE` ships **empty** — `ramp-schedule.ts:49` is a
  bare `[]`. Not an argument that ADR 0002 was wrong; a measured caution against a second one.

**When does a day close — and the boundary needs one more day than the first draft gave it.** A verdict
must never be written for a day that can still change. `WRITABLE_DAY_RADIUS = 1`
(`apps/web/lib/entries/declared-day.ts:37`) is the write window, enforced by `resolveDeclaredDay`
(`:20-30`) with `isWritableDay` as the UI half (`:40-42`). But "today" comes from `getActiveLocalDay()`,
which resolves the zone from the request's **`tz` cookie** with household timezone explicitly deferred
(`apps/web/lib/active-timezone.ts:9-25`) — so it is **per-device**. A device one day ahead settles `D-1`
while a device one day behind can still write to `D-1`: the overlap consumes the entire slack. The ±1
skew is the documented **in-scope** case (`declared-day.ts:16-18` puts only ≥2-day zones out of scope).

So the boundary is **strictly older than `addDays(today, -(WRITABLE_DAY_RADIUS + 1))`**, derived from
the constant and never a re-typed `2`, and the settle "today" must come from **one server-side notion of
the athlete's day** once `households.timezone` lands — not the requesting device's cookie. The same root
cause hits decision 1: two devices can disagree about whether today is Monday, so dueness differs per
device until that lands.

⚠️ **The constant has to move for that to be true.** `WRITABLE_DAY_RADIUS` sits in a module whose first
line is `import 'server-only'` (`declared-day.ts:1`), and a `packages/db` writer cannot import it — the
repo records exactly this (`packages/db/src/writers/bodyweight.ts:11`: _"the reason it cannot live in
`apps/web/lib/dal`: `verify.ts` imports only `../src/*`"_). So either the radius is promoted to
`packages/shared` with the verdict work, or the boundary is computed app-side and passed into the writer
as an argument. Unsaid is how the `2` lands.

**Idempotency, and the repair path.** The natural key is `(profile_id, verdict_date)`, partial UNIQUE on
`deleted_at IS NULL` — the `day_readiness` / `ramp_targets` shape (`schema.ts:564-584`). Two mechanics
are **not** optional: the upsert must **repeat the partial index's predicate**
(`targetWhere: isNull(t.deletedAt)`), which is a recorded trap (`docs/lessons.md` → _"A partial index
only arbitrates when the statement repeats its predicate"_); and it is `DO NOTHING`, never `DO UPDATE`,
because a second settle must not overwrite a frozen verdict. ⚠️ **That makes a wrong verdict
uncorrectable through the app**, which is deliberate and needs its named path: a guarded
`packages/db/scripts/corrections/` script, AGENTS.md's own answer for "wrong data in a live DB that the
app cannot fix". A growth of `WRITABLE_DAY_RADIUS` is such an event.

⚠️ **Two honest corrections to the first draft's precedent.** `day_readiness` has **no writer anywhere
in the tree** (`grep -rln dayReadiness apps packages` → `schema.ts`, `verify.ts`, `types.ts` only), so
"the `day_readiness` arbiter" is a docblock, not an exercised idiom — and its CHECK is proven only
**negatively** (`verify.ts:278` inserts `'purple'`), unlike the two `day_role` CHECKs. Copying the idiom
inherits the weaker guard, so the verdict's status CHECK is pinned with `assertCheckCoversConst`
instead. And **`SKIP_REASONS` does not exist yet** — it is proposed by ADR 0005 decision 6, not
available to import.

**The verdict's vocabulary is a `packages/shared` enum** (`as const` + zod + `z.infer`), placed beside
the four adjacent status lists already in `packages/shared/src/enums.ts` — `ENTRY_STATUSES` (`:34`),
`MOVEMENT_STATUSES` (`:53`), `SET_STATUSES` with its `satisfies readonly EntryStatus[]` subset proof
(`:75-79`) — and either built from `ENTRY_STATUS` members or explicitly distinguished from them, because
ADR 0005 decision 6 already warns this grain is a **fourth** `skipped` spelling.

**Who writes it, and the constraints that are not negotiable.** A verdict write is a mutation, so it
cannot ride a Server Component render. Two triggers, one helper:

- **settle-on-write**, inside the athlete's next mutation; and
- ⚠️ **settle-before-edit**, inside the authoring mutations, so no schedule change is applied over
  unsettled closed days. Without this second trigger the property fails silently for any athlete who
  stops logging, and the first draft shipped only the weaker half.

The constraints SCHED-1's plan must answer, named here because each has a rule behind it: **one shared
helper**, not six copies (the `resolveDeclaredDay` precedent — _"ONE seam shared by all three
writers"_, `declared-day.ts:12-18`); a **bounded** batch, because an athlete back after three weeks
otherwise pays ~21 inserts on a log tap; a failure that is **swallowed with Sentry context**, never a
typed field error and never a thrown `error.tsx`, because a failed verdict must not fail the athlete's
log; and `revalidatePath('/p')` **as well as** the per-profile path — MOT-1's streak renders in both
places (`docs/plan.md:1729-1740`) and all 13 existing `revalidatePath` calls target only
`` `/p/${profile.id}` ``.

**The CSV contract does not move.** The verdict table writes nothing to `entries` or `sessions`, so the
strength CSV's `session_type`, its `0,0,SKIPPED` byte — derived from `entries.status`, never a set's,
and pinned at `packages/shared/src/csv/aggregate.ts:30-52` and
`apps/web/lib/csv/strength-log.test.ts:96` — and `weeklyAdherenceRows`' shape
(`packages/db/src/queries/weekly-adherence.ts:42-67`) are untouched. ⚠️ The _"Gaps are normal … do not
backfill"_ line (`docs/csv-export-contract.md:160`) sits in the **bodyweight** section and governs
weigh-in gaps; ADR 0005's panel corrected a mis-cite of that exact line and it is not re-used here.

**One product question for the maintainer:** a day with **nothing due** — does it extend the streak, or
is it transparent? MOT-1's constraint 1 only requires that it not **break** the run
(`docs/plan.md:1742-1745`). Recommendation: **transparent** — neither breaks nor increments, so the
number counts training days rather than calendar days. Cheap to decide late, but it must be decided
before the first verdict row is written.

## What this ADR does not authorize

The first draft's Consequences read as a licence for five tables and a `DROP COLUMN`. It is not one.
**Shape decided ≠ migration authorized**, and each table below gets its authorizing row or stays
unbuilt — the `SEC-5c` idiom `docs/roadmap.md:92` already uses ("built on first need").

| Table                                                | Authorized by                | Status                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `program_assignments` (+ nullable `active_from/_to`) | **SCHED-1** — authorized now | Closes SCHED-1 requirements 1 and 2, and replaces the withdrawn active-block marker. Needs a stated idempotency arbiter — see below.                                                                                                                                                                                                                      |
| weekday rows                                         | **SCHED-1** — authorized now | `beta-1.md:242` scopes SCHED-1 as _"which days a program runs; a fixed-weekday first cut is fine"_. Nothing smaller is that.                                                                                                                                                                                                                              |
| day verdicts                                         | **MOT-1** — ships WITH it    | One table on an existing shape. **Not** deferred behind a derived-only era — see the pushback below.                                                                                                                                                                                                                                                      |
| rotation anchor + slots                              | **Nothing yet**              | Its only consumer is a household editing a rotation, which needs block creation, which decision 4 leaves blocked. Three gates deep. The shape is recorded; the tables are not authorized.                                                                                                                                                                 |
| `workouts` + the `prescriptions` contract arc        | **Nothing yet**              | No backlog row needs it, and it carries the only destructive step and the only weakened guard. **`DAY_ROLES` has ten members and `PROGRAM_SEED` uses two**, so a household can add up to **eight more days today** with zero schema change — at the cost of fixed labels. That is the interim; `workouts` waits for a household that needs a _named_ day. |

**All three new tables take the `program_blocks` / `day_readiness` shape**, not the `quantity_slots`
one the first draft copied: bigint identity PK, UUIDv7 `public_id`, a **partial**-UNIQUE natural key
`WHERE deleted_at IS NULL`, and **no `client_id`** ("config data", the phrase every comparable docblock
uses). `quantity_slots`' pair-as-PK has a table-specific reason — drizzle emits a `uniqueIndex` target
_after_ the FK referencing it (`docs/lessons.md` → Database, migration 0011) — and a natural PK on a
household-editable row also forecloses soft delete, which is what the partial UNIQUE is for.

⚠️ **`program_assignments` needs its arbiter named, or `db:seed` duplicates it on every merge.**
`migrate.yml:56-57` runs `db:migrate` then `db:seed` unconditionally on every push to `main`, justified
on the grounds that the seed "is idempotent" (`:11-12`). Since closing and reopening an assignment
requires two rows for one `(block_id, profile_id)`, that pair cannot be the key. `(profile_id,
block_id, active_from)` partial on `deleted_at IS NULL` works, with care because NULLs are distinct in
a unique index — default `active_from`, or coalesce it in the index expression. Add a second partial
UNIQUE `(profile_id, block_id) WHERE active_to IS NULL AND deleted_at IS NULL` — "at most one open
assignment" — which is the cheap non-overlap guard without reaching for `EXCLUDE USING gist`, a
construct this repo has never used and whose PGlite support is unverified.

**If the `workouts` arc is ever authorized, it is six PRs, not three**, and the first two of them must
land before a second authored day is possible at all. The binding reason: during the expand window
`prescriptions.day_role` is still `NOT NULL` with its exact-set CHECK, so an authored slug has no legal
value — and `uq_prescriptions_block_day_role_idx` still rejects two authored workouts that both borrow
`'strength_a'` at `idx = 0`, even though `(workout_id, idx)` is distinct. The arc: (1) expand —
`workouts`, nullable `workout_id`, guarded backfill, new partial UNIQUE, covering index, FK `NOT VALID`;
(2) `VALIDATE`, plus `DROP NOT NULL` on `day_role` (which trips Squawk's `ban-drop-not-null` and needs
`-- squawk-ignore` on the line **directly** above — any intervening comment, `--> statement-breakpoint`
included, silently voids it) and the CHECK replacement; (3) reader/writer switch, deployed and
**observed applied**; (4) `CHECK (workout_id IS NOT NULL) NOT VALID`; (5) `VALIDATE` → `SET NOT NULL`;
(6) contract — `DROP COLUMN day_role` and drop the old index.

**Its blockers, stated honestly.** ⚠️ Three readers of the dropped column are not optional:
`programDayRows` **inner-joins** `prescriptions.day_role` (`program-day.ts:57`), and `migrate.yml`
races the Vercel deploy, so a contract landing before the new bundle blanks every Today card; `db:seed`
arbitrates prescriptions on `(blockId, dayRole, idx)` (`seed.ts:309`) and a conflict target naming a
dropped index **fails the job and re-fails every later push**, taking `db:seed` with it
(`docs/runbooks.md:78-79, 95-112`); and `verify.ts:3416`. The `0013` precedent supplies the gate each
step owes — _"CHUNK 2 MERGES ONLY AFTER THIS IS OBSERVED APPLIED — the run being green is not enough"_,
with the check written out at `docs/runbooks.md:64-76`.

**And ADR 0005's finding D4, discharged more honestly than the first draft managed.** D4 said the empty
rollback runbook stubs _"[become] one for the scheduling ADR, and is recorded there."_ Recording it:
`docs/runbooks.md:196-199` ("Cut a Neon RESTORE branch before a destructive/backfill migration") is a
`TODO` stub, and AGENTS.md requires that branch before any **destructive _or backfill_** step — so it
gates the arc's **expand** PR, not merely its contract, and no PR in that arc escapes it. In the other
direction the first draft over-claimed: `runbooks.md:206-208` is a stub, but the generic wedge procedure
already exists as prose at `:95-112` and is explicitly generalized at `:78` (_"applies to ANY pending
migration"_), so promoting that prose into the stub is a cheap docs PR rather than new work. **Neither
blocks the two tables this ADR does authorize**, which carry no destructive step and no backfill over
existing rows.

## Backlog impact, and what each row can start on

| Row / doc                   | Impact, and what it can start on now                                                                                                                                                                                                                                                                                                                                                                                                                                     | What it must not do                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SCHED-1**                 | **This is it** for its three 2026-09-21 requirements, which survive intact. Start on the assignment row + weekday rows + the pure resolver. ⚠️ **It does not close the row**: `routine_config`'s schedule — the third of the three converging problems `docs/plan.md:1041-1053` justifies the row on — is deliberately deferred below.                                                                                                                                   | Materialize occurrences · add an `is_active` marker to `program_blocks` · change `sessions.day_role`'s type · land the rotation slot column before `workouts` exists, or it migrates twice · ship a weekday-row **editor** before the verdict table (see MOT-1). |
| **MOT-1**                   | Start now, **with the verdict table**. Dueness is derivable the moment the assignment + weekday rows exist, and the verdict is one table on an existing shape.                                                                                                                                                                                                                                                                                                           | Assume a rest day exists in the live program — `resolveDayRole` is TOTAL (invariant 3e), so the YDP has none; the rest-day case is the archived block's and a future household's.                                                                                |
| **V1-22 A4**                | **Split.** "Create a block" waits on the one-block→N read. "Create a day" has an interim that needs no schema: eight unused `DAY_ROLES` codes.                                                                                                                                                                                                                                                                                                                           | Ship the active-block marker its spec promised — withdrawn, and the spec is corrected in this PR.                                                                                                                                                                |
| **CAT-2**                   | Everything. **Nothing in this ADR gates it**; its own row gates it on _"the human approve/deny pass over the proposed movement library"_ (`docs/plan.md:125`), and the roadmap's claim otherwise is corrected in this PR.                                                                                                                                                                                                                                                | Wait for this.                                                                                                                                                                                                                                                   |
| **CAT-1**                   | Unaffected — it narrows the routine editor's **offer** list only, and `routine_config` is untouched here.                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                                                                                                                                                                                |
| **YDP-1**                   | Nothing. Still deferred by the maintainer; now blocked specifically on decision 5's verdicts.                                                                                                                                                                                                                                                                                                                                                                            | Be revived as a side effect of decision 2.                                                                                                                                                                                                                       |
| **ONB-2**                   | Its A/B stopgap stays correct and cheap — under decision 3 those become two authored workouts with those slugs, so nothing re-seeds.                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                |
| **ADR 0005**                | Continued, not superseded. Its decisions 1, 6 and 7 are consumed; D4's rollback gap is discharged above.                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                                                |
| **ADR 0002**                | Untouched, and cited as the precedent **for** materializing a plan — with the measured note that its table ships empty.                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                |
| **`docs/tech-debt.md:335`** | The hardcoded-schedule row is what decision 1 pays off. **Corrected in this PR**: its text still named `DAY_ROLE_BY_WEEKDAY`, deleted in #151. Promoting the resolver also retires its clause _"nothing in the DB or engine may depend on it."_                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                                |
| **`docs/tech-debt.md:457`** | The `routine_config` JSONB promotion trigger does **not** fire here; restated below so the next reader does not assume it did.                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                |
| **`docs/architecture.md`**  | §2d described `resolveDayRole` as the deleted weekday map, in prose and in its diagram. **Corrected in this PR**; §2d is the view each PR under this ADR must keep current.                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                                                                                                                |
| **`docs/roadmap.md`**       | **Updated in this PR** — Product & Spec's next item, and Authoring & Scheduling's _"waits on the scheduling ADR"_. ⚠️ **It also owes three new seam rows** (§Seams): the **dueness resolver** (Authoring owns, Insight consumes), the **verdict table** (defined by Authoring, written by a Logging action, read by Insight — three pillars), and **`sessions.day_role` → CSV `session_type`**, whose domain decision 3 opens while the contract's owner is **Insight**. | —                                                                                                                                                                                                                                                                |

## What this does not settle

- **Whether `routine_config` gets a schedule, and so whether it becomes `routine_items`.**
  `docs/tech-debt.md:468-473` names the trigger as _"the **first time V1-10 needs to query INTO the
  routine** — generate rows from a program schedule, JOIN routine to sessions/day, or filter by
  conditional/day."_ Decision 1 schedules **blocks**, so it does **not** fire — but it fires the moment
  anyone acts on SCHED-1's "mobility only on practice days" (`docs/plan.md:1048-1049`), and
  `routineItemSchema`'s `conditional` marker is the down-payment waiting for it
  (`packages/shared/src/routine.ts:43`). Left out because it is a JSONB→table expand→backfill→contract
  with its own trigger, and folding it in would make one ADR own two migrations on unrelated tables.
- **Session-indexed rotation** (YDP-1).
- **Multi-program rendering on Today**, and the export resolution decision 4 names. Both need a plan and
  a UX panel.
- **Time zones beyond the V1-6c window.** Dueness resolves on the athlete's local day; the ±1-day
  assumption is inherited unchanged, not widened — and decision 5 records what it costs.

## Consequences

- `program_assignments` becomes the join between a block and an athlete, and the home for the weekday
  set and the date range. Two tables are authorized now; three more have recorded shapes and no
  authorization.
- **No destructive migration is authorized by this ADR.** The one destructive arc it describes is
  unauthorized and gated; the first draft's "one destructive arc, and only one" also undercounted, since
  a block-owned `workouts` makes `prescriptions.block_id` and `idx_prescriptions_block` a second,
  drift-capable path to the block and they would have to go too.
- **The resolver moves to `packages/shared`, and the pure date primitives move with it.** The precedent
  is `packages/shared/src/aggregation.ts:7` — _"WHY IT LIVES IN `shared`, not `apps/web`: the same fold
  is computed in three places"_ — and **not** `packages/db/src/queries/*`, which is where the first draft
  pointed; `programDayRows` and `weeklyAdherenceRows` live there because they are drizzle SQL builders.
  Because no file under `packages/` can import `apps/web/lib/date.ts` (context fact 2), `isoDayDiff`,
  `addDays` and `localWeekday` move to `packages/shared` with their call sites updated — a cross-cutting
  move that belongs in SCHED-1's estimate. `getActiveLocalDay` is cookie-derived and app-only, so it
  **stays** in `apps/web` and today is **passed in**, the `buildDefaultRoutine` idiom ("the CALLER owns
  the ordered key list"). `packages/engine` was considered and rejected: it is reserved by ADR 0002 for
  performance-gated progression with golden vectors, dueness is a calendar lookup the DAL needs at read
  time, and the package ships at v2.
- ⚠️ **`docs/features/programming.md`'s `owns:` frontmatter must grow in the same PR as that move.** It
  owns `apps/web/lib/programming/`; a guide claiming a file that no longer exists fails
  `pnpm guides:check`, which is how a rename silently drops coverage.
- New `packages/shared` constants, each the single source for a zod boundary, a DB CHECK and the app:
  `WEEKDAYS`, `SLUG_PATTERN`/`slugSchema`, the verdict-status enum, and `WRITABLE_DAY_RADIUS` promoted
  out of `server-only` if the writer lands in `packages/db`.
- `docs/features/programming.md` is updated in the same PRs as the code: invariant 3 (one block by
  design) becomes conditional on assignments, 3b gains the anchor's data location, 3c resolves by
  naming, and invariant 4 gains a fifth soft-delete level if `workouts` ever lands.
- ⚠️ **Five stale `DAY_ROLE_BY_WEEKDAY` references survive elsewhere** and are not charged to this PR:
  `packages/db/src/schema.ts:494`, `apps/web/app/p/[profileId]/strength-form.tsx:591`,
  `apps/web/e2e/a11y.spec.ts:579`, `docs/plan.md:1048` and `docs/plan.md:1661` — the last being one of
  the three places this ADR says the calendar-index rationale is recorded. Listed so the next sweep is
  complete rather than partial.

## Proofs owed, so a plan does not have to re-derive them

Named here because AGENTS.md requires a `db:verify` section per DB chunk and the first draft named one.

| What                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `program_assignments`           | both FKs + covering indexes; the natural-key UNIQUE arbitrates (the harness already seeds twice → one row); the "at most one open assignment" partial UNIQUE rejects a second                                                                                                                                                                                                                                                                                                                                           |
| weekday rows                    | `CHECK (weekday BETWEEN 0 AND 6)` rejects `7` and `-1`; `assertCheckCoversConst` pins it to `WEEKDAYS`; **and the stored origin matches `localWeekday`'s `0 = Sunday`** — the proof that stops the one-day shift                                                                                                                                                                                                                                                                                                        |
| resolver equivalence            | the moved resolver vs the live `resolveDayRole` over a date span **including dates before the anchor** and a **three-slot** case (`%` vs `floorMod`)                                                                                                                                                                                                                                                                                                                                                                    |
| verdict row                     | natural-key UNIQUE partial on `deleted_at`; status CHECK pinned to its shared const; a second settle of the same `(profile, date)` is a **no-op**; a verdict for a day inside the boundary is **refused**, with the boundary derived from `WRITABLE_DAY_RADIUS`                                                                                                                                                                                                                                                         |
| verdict snapshot                | a schedule edit between day-close and settle does not change an already-settled day; an **amend** on a settled day leaves its verdict byte-identical                                                                                                                                                                                                                                                                                                                                                                    |
| `workouts` (if ever authorized) | columns (the `V1_10_COLUMNS` pattern, `verify.ts:3395-3412`); `session_type` CHECK pinned to `SESSION_TYPES`; slug pattern rejects space / uppercase / comma / newline / empty; `uq_workouts_block_slug` duplicate rejected and a soft-deleted row **frees** the slot; FK + covering index; **two authored workouts at `idx = 0` accepted** — the key change                                                                                                                                                            |
| the `workouts` backfill         | the migration-0002 replay idiom (`verify.ts:549-556`): `db:verify` runs migrations on an **empty** DB, so the backfill is a no-op there and its statements must be written guarded/idempotent to be replayed after fixtures. One `workouts` row per distinct `(block_id, day_role)`, slug byte-identical to the old `day_role`. ⚠️ And the ten-row role→type mapping the migration must inline needs its own `assertCheckCoversConst`-style pin, or decision 3 creates a **fourth** copy of `DAY_ROLE_TO_SESSION_TYPE`. |

⚠️ **One proof is not obtainable.** The concurrent double-settle cannot be proven on PGlite — it has a
single connection, and `verify.ts:3108` records the trap (_"a query on `db` inside `tx` waits
forever"_). A sequential double call demonstrates idempotency, not the race. Said out loud so a plan
does not assume otherwise.

## Open questions

1. **Does a nothing-due day extend the streak, or is it transparent?** Recommendation: transparent. The
   maintainer's call, before the first verdict row is written.
2. **Is the one-block→N read change's export resolution "one designated assignment" or "a discriminated
   match key"?** Decision 4 names the collision; the choice belongs to whoever owns the CSV seam
   (**Insight**), not to Authoring.
3. **Does the verdict's snapshot store counts, or the due set?** Counts are two columns and answer "why
   did Tuesday not count"; the due set answers more and costs a child table. Recommendation: counts,
   and they must be derived only from facts an amend cannot change (decision 5).

## Review-response log (adversarial panel, round 1 on the withdrawn first draft)

Five lenses — correctness, scope, architecture, reuse, DB-safety — run in parallel against the first
draft, before any implementation. **Fourteen blocking findings; every one accepted, four of them
reshaping a decision rather than its wording.** Every claim was re-verified against the tree before
being acted on.

| #   | Lens                                       | Critique                                                                                                                                                                                                                              | Verdict                                      | Resolution                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Scope                                      | Consequences authorized **five tables with no per-table trigger**, while the draft's own table scoped SCHED-1 and MOT-1 to two. A Consequences list in an ADR is read as a licence.                                                   | **accepted**                                 | New section "What this ADR does not authorize" — one row per table with its authorizing backlog row, the `SEC-5c` "built on first need" idiom. Three of five are now unauthorized.                                                                                                                                     |
| A2  | Scope                                      | Decision 3 buys the only destructive arc and the only weakened guard for a feature whose value is near zero today (11 of 13 live prescriptions render `''`).                                                                          | **accepted**                                 | The arc is **unauthorized**. And a smaller path the draft missed entirely: `DAY_ROLES` has ten members, `PROGRAM_SEED` uses two, so **eight unused day codes** give A4-small today with no DDL.                                                                                                                        |
| A3  | Scope · Correctness · Architecture (all 3) | **"MOT-1 is blocked on decision 1, not decision 5" is a trap** — it contradicted the draft twice, and the derived-only window does not exist because V1-22, SCHED-1 and MOT-1 are the same milestone bullet.                          | **accepted**                                 | The dividend claim is **deleted**. Verdicts ship **with** MOT-1; rotation and `workouts` are the deferrals. The sequencing is inverted from the draft.                                                                                                                                                                 |
| A4  | DB-safety                                  | The expand window makes decision 4's "create a workout" **unexecutable**: `day_role` is still NOT NULL with an exact-set CHECK, and the old slot key rejects two authored days borrowing `strength_a` at `idx = 0`.                   | **accepted**                                 | The arc is spelled out as **six PRs**, with the first two named as the gate, plus the Squawk `ban-drop-not-null` ignore-placement trap.                                                                                                                                                                                |
| A5  | DB-safety · Correctness · Architecture     | **Settle-on-next-mutation does not freeze the verdict at day close** — whatever the coach edits in the meantime is what gets frozen, which is the defect the row exists to prevent. "A cache of a derivation" understates it.         | **accepted**                                 | Decision 5 now **snapshots what it judged** (the `prescribed_snapshot` idiom), and adds a second trigger: **settle-before-edit** in the authoring mutations. Open question 2 closed, not deferred.                                                                                                                     |
| A6  | Correctness                                | The settle boundary gives exactly one day of slack and `getActiveLocalDay()` is **per-device** (cookie-derived, household tz deferred), so two devices consume it and a verdict reopens.                                              | **accepted**                                 | Boundary is now `-(WRITABLE_DAY_RADIUS + 1)`, with the single-server-notion-of-today requirement stated, and the same caveat applied to dueness in decision 1.                                                                                                                                                         |
| A7  | Correctness · Architecture                 | **"Nothing can be logged into a settled day" is false**: the V1-24 amend path deliberately has no day bound, and `/api/sync` and `db:correct` write arbitrary past days.                                                              | **accepted**                                 | Narrowed to "no new **occurrence**", with the sufficiency invariant stated — and it is why the verdict keys on occurrence existence, not day-role identity.                                                                                                                                                            |
| A8  | Architecture · Reuse · DB-safety (all 3)   | **"The `movementSlug()` charset" does not exist** — `movementSlug` strips no punctuation, so the replacement CHECK would admit a comma and make the whole month's export **throw**.                                                   | **accepted**                                 | A new `packages/shared` `SLUG_PATTERN`/`slugSchema` as the single source for the zod boundary and the CHECK, plus ADR 0005's `hasCommaOrLineBreak` carried forward, plus the rejection cases.                                                                                                                          |
| A9  | Architecture · DB-safety · Correctness     | **`workouts`' natural key and owning parent were unstated**, and the two readings diverge materially — household-scoped collides with the archived block on `strength_a`.                                                             | **accepted**                                 | Block-owned, `(block_id, slug)`, with the consequence for the frozen text stated rather than hidden.                                                                                                                                                                                                                   |
| A10 | Architecture                               | The one-block→N read change **silently blanks `prescribed`** in already-exported months via `prescribedFor`'s duplicate→`null` rule, and the draft priced it as a Today-card change while asserting "the CSV contract does not move". | **accepted**                                 | Decision 4 now names the export, the byte effect, the two candidate resolutions, and that the seam's owner is **Insight**. Promoted to open question 2.                                                                                                                                                                |
| A11 | Architecture                               | **The rotation anchor on the assignment desynchronizes co-training siblings** — one program gets N phases, and the cited justification is about enrollment, not phase.                                                                | **accepted**                                 | The anchor and slot list move to **`program_blocks`**; only the weekday set and date range stay on the assignment.                                                                                                                                                                                                     |
| A12 | Reuse · Architecture                       | **Every date helper lives in `apps/web`**, so a `packages/shared` resolver can import none of them, and the cited precedent (`programDayRows`) lives in `packages/db`.                                                                | **accepted**                                 | Context fact 2 added; the precedent re-cited to `aggregation.ts:7`; the primitive move named as a cost; the formula rewritten as `floorMod(isoDayDiff(…), slotCount)`; `engine` rejected with a reason.                                                                                                                |
| A13 | Reuse · Correctness · DB-safety            | **`weekday 0–6` pinned no origin**, against a repo holding both `0=Sun` (`localWeekday`) and Monday-first ISO — a silent one-day shift with no error.                                                                                 | **accepted**                                 | Origin stated, a `packages/shared` `WEEKDAYS` const required, the CHECK pinned, and a proof owed that the stored origin matches `localWeekday`.                                                                                                                                                                        |
| A14 | Reuse                                      | **`WRITABLE_DAY_RADIUS` is `server-only`**, so a `packages/db` writer cannot import it and the "never a re-typed `2`" guarantee is unreachable as written.                                                                            | **accepted**                                 | Decision 5 names the two ways out (promote the constant, or compute app-side and pass it in) and says that leaving it unsaid is how the `2` lands.                                                                                                                                                                     |
| A15 | DB-safety                                  | **`program_assignments` had no idempotency arbiter and no overlap guard**, while `db:seed` runs on every push to `main`.                                                                                                              | **accepted**                                 | The natural key, the NULL-`active_from` care, and the "at most one open assignment" partial UNIQUE are all named; `EXCLUDE USING gist` rejected as unprecedented here.                                                                                                                                                 |
| A16 | DB-safety · Reuse · Correctness            | The verdict row copied a **mutability** idiom and cited `day_readiness`, which **has no writer anywhere** and whose CHECK is only negatively proven; `DO NOTHING` + partial UNIQUE also makes a wrong verdict uncorrectable.          | **accepted**                                 | Both corrections recorded; the status CHECK is pinned with `assertCheckCoversConst`; `DO NOTHING` is kept **deliberately** with a guarded correction named as the repair path. `SKIP_REASONS` relabelled as proposed-by-0005, not existing.                                                                            |
| A17 | Correctness · DB-safety                    | The upsert omitted the **partial index's predicate** — a recorded `docs/lessons.md` trap.                                                                                                                                             | **accepted**                                 | `targetWhere: isNull(t.deletedAt)` written into the decision.                                                                                                                                                                                                                                                          |
| A18 | Architecture                               | Settle-on-write had **no error policy, no revalidation target, and fanned out across six writers**; MOT-1's streak renders on `/p` and nothing revalidates `/p`.                                                                      | **accepted**                                 | All four constraints named in decision 5, with the `resolveDeclaredDay` one-seam precedent and the measured "13 calls, none to `/p`".                                                                                                                                                                                  |
| A19 | Reuse · DB-safety                          | The three new tables adopted the **`quantity_slots` reference-table key idiom** instead of the household-authored one, and renamed an ordinal (`position`) that is already `idx`.                                                     | **accepted**                                 | One paragraph fixes all three tables to the `program_blocks`/`day_readiness` shape, with `quantity_slots`' table-specific reason cited, and the ordinal is `idx`.                                                                                                                                                      |
| A20 | Reuse                                      | The verdict's **status vocabulary was homeless**, beside four existing status lists in `packages/shared/src/enums.ts`.                                                                                                                | **accepted**                                 | Named as a `packages/shared` enum, built from or explicitly distinguished from `ENTRY_STATUS`, with ADR 0005's fourth-`skipped` warning cited.                                                                                                                                                                         |
| A21 | DB-safety                                  | The contract step races the **reader and the seed**, not just "writers" — and a seed whose `ON CONFLICT` names a dropped index **fails every later push**. No step had an observed-applied gate.                                      | **accepted**                                 | All three readers named, with the `0013` observed-applied gate and the runbook's re-fail consequence.                                                                                                                                                                                                                  |
| A22 | DB-safety                                  | `db:verify` runs migrations on an **empty** DB, so the backfill is a no-op there; and the role→type mapping the migration must inline would be a **fourth** copy.                                                                     | **accepted**                                 | Both in "Proofs owed", with the migration-0002 replay idiom as the pattern and a pin required on the inlined mapping.                                                                                                                                                                                                  |
| A23 | DB-safety · Scope                          | D4's discharge was wrong in both directions: the restore stub gates the **expand** PR (AGENTS.md says destructive _or backfill_), and `runbooks.md:206` is not as empty as claimed.                                                   | **accepted**                                 | Rewritten honestly, including that neither stub blocks the two tables actually authorized.                                                                                                                                                                                                                             |
| A24 | Scope                                      | The **changelog fragment claimed a panel that had not run** while the log was a placeholder.                                                                                                                                          | **accepted**                                 | The fragment now states the round count, and this log is filled.                                                                                                                                                                                                                                                       |
| A25 | Scope                                      | **Two tables covered the same six rows**, and three paragraphs announced they would not restate and then restated.                                                                                                                    | **accepted**                                 | Merged into one table keeping the "what it must not do" column; the Context block trimmed to the measured facts.                                                                                                                                                                                                       |
| A26 | Scope                                      | Open question 3 (block or workout) **decided the parent FK of the one table SCHED-1 is told to build now** while sitting in the open list.                                                                                            | **accepted**                                 | Promoted into decision 1 as a settled rejection and dropped from the open list.                                                                                                                                                                                                                                        |
| —   | Correctness · Reuse · Architecture (all 3) | **Every `docs/plan.md` citation was ~4 lines stale** — the branch's own edit to the SCHED-1 row shifted them — plus the `quantity_slots` quote was cited 600 lines off, and three claims described files this PR had already fixed.   | **accepted**                                 | Every cite re-measured against this worktree. The "already fixed" claims are reframed as corrected-in-this-PR.                                                                                                                                                                                                         |
| —   | Correctness · Reuse                        | `floorMod` vs `%` only agree here by luck of `slotCount = 2` and an even anchor.                                                                                                                                                      | **accepted**                                 | The equivalence proof must span pre-anchor dates and a three-slot case.                                                                                                                                                                                                                                                |
| —   | Architecture · Correctness                 | Decision 3's "the logged past is already safe" ignores the **nullable** `day_role` and the sessionless entry.                                                                                                                         | **accepted**                                 | Qualified, and it is the reason decision 5 keys on occurrence existence.                                                                                                                                                                                                                                               |
| —   | Scope                                      | Decision 1's **recurrence editor and its UX panel** were an invisible part of the bill.                                                                                                                                               | **accepted**                                 | Named in decision 1 as "the honest bill", with the `tech-debt.md:338` cost argument it answers.                                                                                                                                                                                                                        |
| —   | Architecture                               | `docs/roadmap.md` owes three new **seam** rows, none named.                                                                                                                                                                           | **accepted as a record, not a roadmap edit** | Listed in the backlog table. The seams table is edited by the PR that creates each seam, not by the ADR that predicts it — editing it now would claim seams that do not exist.                                                                                                                                         |
| —   | Scope                                      | Open question 4 (resolver package) is "a cheap move later", so it is a plan line, not ADR content.                                                                                                                                    | **accepted**                                 | Decided in Consequences against the corrected precedent, and dropped from the open list.                                                                                                                                                                                                                               |
| —   | Scope                                      | The `docs/plan.md` CAT-2 row gained a paragraph to explain a **non-interaction**; the roadmap correction was sufficient.                                                                                                              | **rejected**                                 | Kept, trimmed. The roadmap line was wrong for weeks and a reader starting from the backlog row would re-derive the question; one sentence there is cheaper than the second re-derivation. The ADR's own CAT-1/CAT-2 "unaffected" rows survive for the same reason — a row absent from the table reads as unconsidered. |
| —   | Scope                                      | Fold the whole document shorter; it is 394 lines.                                                                                                                                                                                     | **rejected in part**                         | Duplication cut (A25). But this draft is **longer**, not shorter, because the panel found fourteen blocking defects whose avoidance is exactly what an ADR is for, and because the "does not authorize" section is the one that stops the next plan over-reaching. ADR 0005 ran to 395 lines for the same reason.      |
| —   | Correctness                                | Five further stale `DAY_ROLE_BY_WEEKDAY` references exist; the draft flagged two.                                                                                                                                                     | **accepted, not fixed here**                 | All five listed in Consequences. They are in app code and tests, so a docs-only PR cannot fix them without reaching outside its concern — but a partial list is how a sweep stays partial.                                                                                                                             |

**No blocking concern survives in the text.** The single largest change is that this document no longer
authorizes what it decides: three of five tables, and the whole `DROP COLUMN` arc, now need a backlog
row and a plan of their own. The second largest is that decision 5 freezes what it judged instead of
trusting a derivation it had already argued was not reproducible.
