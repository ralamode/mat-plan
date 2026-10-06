# ADR 0005 — Workouts become data

**Status:** Proposed · **Date:** 2026-10-05 · **Scope:** the Authoring milestone ·
**Supersedes:** nothing yet (see "What this does not settle")

> **This is the second draft.** The first proposed fifteen decisions across two milestones and was
> withdrawn after a five-lens panel found roughly thirty blocking defects — including a milestone
> split that did not hold, a versioning subsystem the repo already had a one-column answer for, and
> three claims the code contradicts. The review-response log at the bottom records what was accepted
> and what was rejected. **The first draft's central mistake was not reading
> [docs/features/programming.md](../features/programming.md) or
> [plans/v1-22-program-editor.md](../plans/v1-22-program-editor.md) before designing.** Both are
> treated as binding here.

## Context

The maintainer opened "Edit routine" intending to raise every prescribed set count from 3 to 5, and found one
undifferentiated row labelled **Strength** with no way in. Then added "Pull-ups" from the same
screen and got a number stepper, nothing like how pull-ups work in the strength form.

The feature guide already explains the first half: **program and routine are two independent axes**,
and `routine_config` is "the shape of a **day**, not a block of strength work". `strength` is a
position marker in that list. The strength content lives in `program_blocks → prescriptions`, where a
workout is not a row either — it is implicit in `(block_id, day_role)`, and `day_role` is a frozen
CHECK (`prescriptions_day_role_check`, and a second one on `sessions`).

The second half is a catalog collision. `pull-up` is a movement prescribed in `strength_a`; `pullups`
is a metric logged as one count, and the routine editor's "Add activity" list offers the metric. Five
of the sixteen metrics are movement-shaped.

**There is no program write path at all** — the guide says so plainly: "changing a load means editing
TypeScript and deploying."

## Decisions

### 1. A workout becomes a row, and it needs a slug

The thing `(block_id, day_role)` stands for today becomes a named, household-owned row.

**It carries a stable `slug` as well as a display name, and every machine consumer reads the slug.**
This is not a nicety. `csvSessionType()` emits `day_role` into the strength CSV's `session_type`
column, and `csvRow`'s `QUOTABLE` set is `{notes, prescribed}` — so a comma in a user-typed workout
name does not corrupt the export, it **throws** and fails it. The repo already states the rule three
lines above that function: _"Source is the SLUG, never `movements.name`: `\"Front Squat\"` would be
catastrophic."_ A workout name is user input; `day_role` never was.

⚠️ **The slug is necessary but not sufficient, and the first version of this decision overstated it.**
Slugging lowercases and collapses whitespace; it does **not** strip punctuation — `movementSlug('Strength
A, heavy')` returns `'strength_a,_heavy'`, verified. So a comma survives into the slug and still throws.
The slug earns its place for the other two reasons `csv/columns.ts` gives (spaces and capitals in a
grouping key); the comma is guarded at the **input boundary** by the repo's existing
`hasCommaOrLineBreak`, which `csv/row.ts` already names as the input-side check with the export as
backstop. Both halves, or the guarantee is two-thirds of one.

The slug reuses the existing idiom — `movementSlug()` and the household-scoped `slug`-as-idempotency-key
rule `programBlockSeedRowSchema` already states — and its charset is pinned, so "machine consumers read
the slug" is a constraint rather than a hope.

**Rejected:** a lineage name plus a dated version label as the identifier (first draft). It put user
text into a byte-faithful CSV column with no machine key behind it.

### 2. Program and routine keep co-existing

The first draft said "routine stops being a separate concept." That contradicts a committed invariant
— the guide's _"They **co-exist permanently**. the maintainer runs a daily A/B program **and** a weekday S&C
block at once"_ — and its first recorded trap, _"'B is purely additive' is wrong … Cost a session to
rediscover."_

**Unifying them is a scheduling decision, not a model one**, and `SCHED-1` warns specifically to
_"unify the SCHEDULING layer, not the CONTENT shape."_ This ADR leaves `routine_config` alone.

### 3. The item's record shape reuses `ACTIVITY_INPUT_SHAPE`

A workout item is a movement plus a prescription, and the **item** declares how it is recorded, so
pull-ups can be `3 × max` in one workout and `50 total` in another.

That shape vocabulary already exists: `ACTIVITY_INPUT_SHAPES = ['set_list','single_metric','boolean',
'timing']`, described in `shared` as "the small taxonomy of value shapes an activity can take". It maps
onto every example this ADR needs. **No new enum.** Where an item's shape and its `activity_type`'s
`input_shape` could disagree, the activity type wins — it is the discriminant `entries` is keyed by.

### 4. What a movement declares is a DIMENSION, not a unit code

The first draft said `unit_default` becomes "reps, seconds, minutes, load, distance". Three of those
are category errors and one is impossible:

- `movements.unit_default` is an **FK to `units.code`**; the codes are `lb kg count sec min bool timing
in cm ft m yd`. "load" and "distance" are _dimensions_, not codes.
- "reps" would be `count`, which is **deliberately excluded** from `LOGGABLE_UNITS` — derived from the
  `primary` slot's dimensions, with the reason written out: _"a rep count is not a load."_ Reps live in
  `entry_sets.reps`, not in a unit.
- A backfill off `null` would also contradict a live `db:verify` proof asserting `push-ups` _"declares
  no unit"_, and the in-flight V1-30b plan builds on `null` meaning "no declaration".

**So the gap is narrower than the first draft claimed, and partly already closed.** `unit_default` +
`is_bodyweight` are already the form's lookup (V1-26 PR-A). What is genuinely missing is only the
**reps-versus-hold** distinction: `push-ups` and `hollow-body_hold` are stored identically
(`unitDefault: null, isBodyweight: true`), so nothing says one is reps and the other seconds.

**Decision:** express that as the movement's **dimension** (`count | mass | length | time`), leaving
`unit_default` as the optional default _within_ a dimension and `null` continuing to mean "no
declaration". Whether that is a new column or an addition to the `primary` slot's dimension list is a
plan question; **it is not a backfill of `unit_default` to new values.**

### 5. The prescription is snapshotted on the entry — there is no version subsystem

Editing a workout must not rewrite the past. The first draft answered with workout versions, freeze-on-
use, lineage names and a version picker. The repo already records the cheaper answer, in
`lib/dal/export.ts`:

> There is **no `entries.prescription_id`** (GAP-1 P1-2 is unbuilt), so the plan is matched back by
> `(day_role, movement)` at export time rather than stored at log time. … ⚠️ **It reads TODAY's
> program, not the program as it was.** Safe while prescriptions are seed-immutable; **V1-22 breaks
> it**, and that is recorded on the V1-22 row as a blocker it must solve.

**Decision: snapshot the RENDERED prescribed string onto the logged record at log time.**

It has to be the rendered text, not a reference and not the typed values, and the reason is specific.
The string is composed at export time from **two tables** — `sets`/`target_reps` from `prescriptions`,
and `reps`/`load` from the per-athlete `prescription_targets` — and **item 1 of this milestone makes all
four editable**. So an `entries.prescription_id` FK resolved at export time still reads today's values
and reproduces the exact defect quoted above. Snapshotting the typed quadruple fails differently: the
composer is five lines of app code, so any later change to it rewrites the bytes of every historical
month.

The repo already has the idiom and the name: `entries.raw_load` / `raw_reps`, commented _"verbatim legacy
strings → lossless CSV export."_

**It is not one column.** A rendered string cannot answer _which_ prescription a set fulfilled — two
warm-up/working prescriptions of the same movement render identical text — which is GAP-1 P1-2's actual
job. So either a second FK column for identity, or this ADR drops the claim to absorb P1-2. Plus a
`CHECK (snapshot IS NULL OR movement_id IS NOT NULL)`, because `entries` is a tagged union and a
prescription snapshot is meaningful only on the movement arm. An FK would also need a covering index —
the tenth on `entries`, against the ~5–10 budget, which is a second reason to prefer text.

**The writer is server-side, and the payload may not carry the load.** `ScaffoldRow` keeps the authored
load out of client state _by construction_; the snapshot embeds it. So the DAL resolves the string
server-side and the form payload carries at most a prescription public id — a `packages/shared` contract
change, not "a writer change".

⚠️ **Boundary, stated so the next reviewer need not ask:** the snapshot is export-only. It is never a
form default, never a progression input, never read back into an input. It is the un-reconciled plan,
which is what `prescribed` has always been.

**The ambiguity fix is not free.** Entries predating the column have a NULL snapshot forever, so the
legacy `(day_role, movement)` match must stay permanently — one byte-faithful column with two code
paths, and a test obligation that a NULL-snapshot row still takes the legacy path and still emits empty
on an ambiguous match.

**Versioning is not rejected, it is deferred.** It stays additive: today's row becomes v1 whenever a
diffable workout history actually earns a screen. The tell that it was premature is that the first
draft's own open question ("does a half-logged day follow the old version or the new one?") only
existed because of the design.

### 6. Missed is derived, skipped is recorded — at the occurrence grain

- **Skipped** is an affirmative act, recorded, with a `reason` from a reference table seeded from a
  `shared` const (`SKIP_REASONS`), following the `units` / `activity_type_categories` idiom.
- **Missed** is absence: scheduled, past, and **neither logged nor skipped at any grain**.

⚠️ **Three `skipped` spellings already exist** — `entries.status`, `entry_sets.status` and
`sessions.status`, all on one vocabulary, with a written criterion for which grain a status belongs to.
This ADR adds a fourth at the **occurrence** grain, and the rule is: the occurrence-level skip is the
only input to adherence; the existing statuses stay _performance_ facts. A day where every movement was
skipped has entries, so it is not "missed".

**Correcting the first draft's argument.** It cited the export contract's _"Gaps are normal … do not
backfill"_ as forbidding materialized missed days. That line sits inside the **`## bodyweight`**
section and governs weigh-in gaps; the strength CSV's rule is the inverse — `0,0,SKIPPED` is a
committed golden byte. The real argument is stronger and survives: **a machine-authored row must not
reach `entries`**, because the strength CSV derives `SKIPPED` from `entries.status` and a generated row
would be indistinguishable from a human's. The other reason also stands: schedules are editable, so
"was this day scheduled?" is a function of the schedule as it was then.

⚠️ **The prompt this enables does not work today.** _"You missed Tuesday — [Mark as skipped] [Enter
workout]"_ offers two actions the write path refuses: `WRITABLE_DAY_RADIUS = 1`, so on Thursday,
Tuesday is closed. Either the radius is relaxed for this path as an explicit decision, or the prompt is
scoped to yesterday. **It is not free, and the first draft implied it was.**

### 7. Calendar-indexed rotation stays — and is already documented

the maintainer's override of the spec's session-indexed rule is deliberate, and the reasoning is **already
recorded** in `day-role-schedule.ts` with his 2026-09-24 quote, in `programming.ts`, and as invariant 3b
of the feature guide. This ADR points at those rather than restating them a fourth time.

Two corrections to the first draft: the live mechanism is `resolveDayRole`, **epoch-day parity, not a
weekday map** — `DAY_ROLE_BY_WEEKDAY` was deleted in #151 and survives only in stale comments. And the
rationale was not "recorded for the first time."

Making rotation author-settable is **scheduling work**, deferred below. One constraint for whoever
takes it: a calendar index over an ordered list needs an anchor and a stable list, or editing `[A,B]`
to `[A,B,C]` silently changes which workout every past date had.

### 8. The Authoring milestone is "edit what exists"

**Creation is deferred, for a reason the guide already records:** the day's block resolves by
`id DESC LIMIT 1`, so _"creating one would silently hijack every athlete's Today card"_ — which is why
V1-22 hard-disables block creation in scope A. A workout created before the day is derived from
schedules has nowhere to land.

So the milestone is V1-22's own smallest slice, which its plan already identifies: _"The smallest thing
that fixes 'changing a load requires a deploy' is A2."_

**Ordered, because two of these close windows that do not reopen.**

0. 🔴 **Stop the seed fighting the editor.** `db:seed` runs on **every push to `main`**, and inserts
   prescriptions `onConflictDoNothing` on the partial slot key `(block_id, day_role, idx)
WHERE deleted_at IS NULL`. A human removal soft-deletes a row, which frees the slot, so **the next
   merge silently re-inserts it**; reorder-then-remove is worse, because the renumber compacts the
   indexes and the seed refills the freed top slot with a _different_ movement. `migrate.yml` justifies
   always seeding on the grounds that the seed "is idempotent" — idempotent against itself, never
   against a human writer, and nothing has ever written these tables before.
   (`PROGRAM_SEED` is **not** empty — 14 prescriptions. The comment in `seed.ts` claiming it ships empty
   is stale, and is exactly what someone would cite to wave this away.)
   **This is a schema change**, so "additive only" does not survive: a marker on `program_blocks`
   (authored/seeded), or `PROGRAM_SEED` moving behind OPS-2's `seedFixtures` split. **Nothing in items
   1–2 can ship before it.**

1. **The prescription snapshot** (decision 5), with a **one-time backfill of existing entries** from the
   current program. It must land before any edit ships: the snapshot only protects entries logged after
   it exists, and prescriptions have been seed-immutable, so the pre-edit program is exactly
   reconstructible **now and never again**. Ship an edit first and the first `3 → 5` silently rewrites
   the `prescribed` column of every past month.

2. **Edit values on existing prescriptions** — sets, target reps, per-athlete load. This is what removes
   the reported pain.

3. **Add / remove / reorder items** within an existing workout (V1-22 A3, where the
   renumber-versus-partial-UNIQUE proof lives). Cuttable if the milestone runs long; V1-22's plan draws
   its seam at exactly this point. Bounded by the schema: `prescriptions` holds only `sets` and free-text
   `target_reps`, so this can add **rep-shaped items only** — a hold or a distance has nowhere to go.

4. **The picker filter** — the collision fixed where it was seen. ⚠️ **Filter only the editor's _offer_
   list.** `ROUTINE_CATALOG` is documented as "the SINGLE source of both the default routine order AND
   `resolveRoutine`'s membership set", and `resolveRoutine` **silently drops** non-members. Narrowing it
   would delete the calisthenics block from a stored routine on next render, and the editor's
   unconditional `SET routine_config` would then persist the loss — no migration, no signal, and a
   contract test asserting "nothing dropped" goes red. Gated on nothing; ships on its own.

5. **The movement additions** — the wrestling drills as movements. Gated on the 72-entry list review
   (open question 3), which is why it is separate from item 4. Transitional consequence to write down:
   until the deferred metric retirement, the eight drills exist in **both** catalogs at once.

**One spec of TEST-1 lands first** — the routine editor's add/remove/reorder/persist, the only surface
in this milestone's blast radius. The other three TEST-1 specs and all of TEST-2 are sequenced
independently; letting TEST-1 grow TEST-2's fixture harness is how a one-spec precondition becomes a
month.

**The plans build at `/p/[profileId]/program`** — V1-22's panelled answer — unless the maintainer rules otherwise
on open question 1. A later household-level library is a route move with HH-1's cost.

## What this does not settle

Deferred to a **scheduling ADR**, filed with that milestone: RRULE storage and the recurrence editor,
rotation as author-set data, the planned-occurrence row, `day_role` becoming rows, and workout
creation.

Deferred outright, each needing its own row and plan:

- **The movement dimension declaration** (decision 4). Nothing in this milestone consumes it:
  `prescriptions` holds only `sets` and free-text `target_reps`, with no unit, dimension or time-capable
  target, so a reps-versus-hold distinction has nothing to change in the authoring surface. Its real
  consumer is the log form (V1-26 / the in-flight V1-30b), and **it must re-point V1-30b's
  `declaredDimension`**, which today derives the dimension _from_ `unit_default` — decision 4 inverts
  that authority, and two definitions of one fact is the thing the constants rule forbids.
- **Workout versioning** — additive whenever it earns a screen (decision 5).
- **Retiring the count metrics and rebuilding adherence on sets.** Two hard FKs point at
  `metric_definitions.key`; reference seeds are `ON CONFLICT DO NOTHING` so a catalog deletion is a
  no-op in prod; the tagged-union CHECK forbids dual-writing during an expand; `weeklyAdherenceRows`
  inner-joins the definition, so losing it returns **zero rows silently**; and `db:verify` asserts
  `pullup_max` is seeded. "Retire" can only mean **deprecate in place**. One correction in its favour:
  `CALISTHENICS_RAMP_SCHEDULE` ships **empty**, so there is no `ramp_targets` data to migrate — the
  window to do this cheaply is open now and closes when real numbers land.
- **Routes.** The first draft proposed `/home`, `/workouts`, `/movements`, `/calendar`. V1-22's panel
  moved authoring the other way — to `/p/[profileId]/program` — because _every BOLA guarantee derives
  from a profile public id_, and a top-level `/workouts/<id>` has no profile to scope by and, before
  TEN-1, no household scope either. **This is the maintainer's decision with the security consequence named**, and
  it belongs in the household-addressing ADR that owns the collision.
- **The `/home` landing rule.** OSS-2 §A **shipped** (#216): `/p`, `APP_HOME_PATH` and the
  `pages-are-gated` test all exist on `main`, so that half of the dependency is satisfied. What remains
  is TEN-1 — `listProfiles()` still returns every profile in the database, so no account has zero
  athletes and the "no athletes lands on `/home`" rule cannot be true yet.
- **The editor being open to athletes.** Recorded so AUTH-1 does not silently reverse it;
  `beta-1.md` currently says only a parent creates a household or an athlete.

## Consequences

- `prescriptions` gains a write path; the guide's "seed-only" statement and the V1-22 trap both change.
- The seed stops re-applying a human-edited block (item 0) — a schema change, and the reason this
  milestone is **not** additive-only.
- A nullable snapshot column on the logged record, a CHECK confining it to the movement arm, a
  server-side writer, a one-time backfill, and a `packages/shared` contract change if the payload
  carries a prescription id. The export keeps two code paths permanently.
- The movement catalog grows by the approved list; the metric catalog is untouched, and only the
  editor's **offer** list is filtered — `ROUTINE_CATALOG` itself is not narrowed.
- `docs/features/programming.md` is updated in the same PRs — the "seed-only" framing, the block-creation
  trap, and the export's `(day_role, movement)` match once the snapshot lands.
- `PROGRAM_SEED` stops being the only way the maintainer's program reaches production, which interacts with OPS-2.

## Backlog impact

| Row                      | Impact                                                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1-22**                | **This is it.** A2/A3 are the milestone; its plan's BOLA route reasoning and its A-slice split survive and are the strongest parts.                                                                                                                                                     |
| **V1-25 §1**             | The editor half lands here; the scaffold-time half waits on the form work.                                                                                                                                                                                                              |
| **GAP-1 P1-2**           | **Superseded in design, not implemented.** An `entries.prescription_id` does not freeze history — the per-athlete `load` and `reps` stay editable behind it — so the snapshot is the rendered string instead. An FK for _identity_ is a second, optional column with no read-path role. |
| **CSV-1 / V1-13**        | Resolved by decision 5 **for entries logged after the snapshot**, plus the one-time backfill in item 1. Entries predating it keep the legacy `(day_role, movement)` match permanently, so the export carries two code paths.                                                            |
| **SCHED-1**              | Untouched; its "unify scheduling, not content shape" warning is honoured by decision 2.                                                                                                                                                                                                 |
| **ONB-2, MOT-1, PROF-1** | Unchanged; they wait on scheduling and TEN-1 as before.                                                                                                                                                                                                                                 |
| **TEST-1**               | Precondition for this milestone.                                                                                                                                                                                                                                                        |
| **V1-26 / V1-30b**       | Must not regress; decision 4 is written to leave `null` semantics intact.                                                                                                                                                                                                               |
| **ADR 0002**             | Untouched, because the metric retirement is deferred.                                                                                                                                                                                                                                   |
| **OSS-2**                | A dependency of any route change, not independent of it.                                                                                                                                                                                                                                |

## Open questions

1. ✅ **DECIDED (maintainer, 2026-10-06) — profile-scoped `/p/<id>/program`; the household library
   waits for TEN-1.** This is V1-22's panelled answer, chosen for the reason that panel gave: **every
   BOLA guarantee derives from a profile public id.** A top-level `/workouts/<id>` has no profile to
   scope by, and before TEN-1 there is no `getHouseholdScope()` either, so its only authorization would
   be that the id exists — the shape `.github/SECURITY.md` lists first.

   The household-level library is not cancelled, only sequenced. Once TEN-1 provides a scope seam that
   can express ownership, lifting the library up is a route change against a working surface instead of
   a guess. Decision 13's deferred route table is where it lands.

2. ✅ **Closed by the repo, not by the maintainer.** The dimension is **a new nullable column** with a CHECK over a
   derived subset of `UNIT_DIMENSIONS`. Adding `count` to the `primary` quantity slot is **not
   available**: `LOGGABLE_DIMENSIONS` is derived from that slot, so it would make a `count` primary
   writable — and a committed tripwire test asserts the export **refuses** a `count` unit, so one such
   row would fail a whole month. (The first draft's "an expand→contract once rows exist" was also
   backwards: adding a slot pair is cheap; removing one is the expand→contract.)
3. The approved movement list, pending review of the 72 proposed entries.
4. Whether `WRITABLE_DAY_RADIUS` relaxes for the skip path, or the missed-day prompt is scoped to
   yesterday (decision 6).

## Review-response log (adversarial panel, round 1 on the withdrawn first draft)

Five lenses — architecture, correctness, scope, reuse, DB-safety — against the fifteen-decision draft.

| #   | Lens                            | Critique                                                                                                                        | Verdict                                       | Resolution                                                                                                                                 |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Architecture · Scope            | Milestone 1 either ships an unreachable feature or contains the scheduling migration it disclaims                               | **accepted**                                  | Milestone is now "edit what exists"; creation deferred, with the guide's `id DESC LIMIT 1` hijack trap as the reason.                      |
| A2  | Architecture                    | `session_type` in the CSV **is** `day_role`; a user-typed workout name in that column throws                                    | **accepted**                                  | Decision 1: workouts carry a slug; machine consumers read the slug.                                                                        |
| A3  | Architecture · Reuse            | The model omits `activity_type` / `input_shape`, the discriminant on every logged row                                           | **accepted**                                  | Decision 3 reuses `ACTIVITY_INPUT_SHAPE` and states the precedence.                                                                        |
| A4  | Architecture                    | The "`/p` not the proxy" conclusion is right but the CVE framing is the wrong rule                                              | **accepted**                                  | Routes deferred entirely; the reasoning is not carried forward.                                                                            |
| C1  | Correctness · Reuse · DB-safety | `unit_default` is an FK to `units.code`; "reps/load/distance" are not codes and `count` is deliberately non-loggable            | **accepted**                                  | Decision 4 rewritten as a dimension, with `null` semantics preserved for V1-26/V1-30b.                                                     |
| C2  | Correctness · Scope             | The occurrence snapshot only covers days someone **visited** — precisely not the missed days it exists to count                 | **accepted**                                  | Decision 10 cut; deferred to the scheduling ADR.                                                                                           |
| C3  | Correctness                     | The missed-day prompt offers buttons the write path refuses (`WRITABLE_DAY_RADIUS = 1`)                                         | **accepted**                                  | Stated as a cost in decision 6 and raised as open question 4.                                                                              |
| C4  | Correctness                     | Decision 9 reason 1 mis-cites the export contract: that line governs **bodyweight**, and the strength CSV's rule is the inverse | **accepted**                                  | Replaced with the entries-grain argument, which is stronger.                                                                               |
| C5  | Correctness · Reuse             | `CALISTHENICS_RAMP_SCHEDULE` is empty, so the metric retirement has no data migration today                                     | **accepted, and it argues the other way**     | Recorded in "What this does not settle" — the cheap window is open now.                                                                    |
| S1  | Scope                           | Versioning is an abstraction before its first use; the repo records a one-column answer                                         | **accepted**                                  | Decisions 4/5 of the first draft replaced by the prescription snapshot.                                                                    |
| S2  | Scope · DB-safety               | The metric retirement is under-counted by a milestone and is not the reported problem                                           | **accepted**                                  | Deferred; the milestone keeps only the additive half (new movements, filtered picker).                                                     |
| R1  | Reuse                           | `DAY_ROLE_BY_WEEKDAY` does not exist; the rationale is already recorded in three places                                         | **accepted**                                  | Decision 7 corrected and now points rather than restates.                                                                                  |
| R2  | Reuse · Architecture            | Decision 1 reversed the guide's "co-exist permanently" invariant without citing it                                              | **accepted**                                  | Decision 2 reverses the reversal.                                                                                                          |
| R3  | Reuse · Correctness             | The skip reason table needs the shared-const idiom, and collides with three existing `skipped` grains                           | **accepted**                                  | Decision 6 names `SKIP_REASONS` and states the grain precedence.                                                                           |
| D1  | DB-safety                       | Four of five schema changes could not be executed without data loss or a destructive step                                       | **accepted**                                  | Three of them are deferred; the survivor (one nullable column) is additive.                                                                |
| D2  | DB-safety                       | No deploy/migration ordering stated, and `migrate.yml` races the Vercel deploy                                                  | **accepted**                                  | The milestone is now additive-only, so the race is the benign case the workflow header already certifies. Restated per-chunk in the plans. |
| D3  | DB-safety                       | The `routine_config` migration is lossy and its backfill source is unreachable from `packages/db`                               | **accepted**                                  | Moot: decision 2 leaves `routine_config` alone.                                                                                            |
| D4  | DB-safety                       | Both rollback runbooks are empty stubs                                                                                          | **noted, not actioned here**                  | No destructive step survives in this milestone, so it is not a precondition. It becomes one for the scheduling ADR, and is recorded there. |
| —   | Reuse                           | Decision 4's naming should reuse the `slug`-as-idempotency-key idiom                                                            | **accepted**                                  | Folded into decision 1.                                                                                                                    |
| —   | Architecture                    | No ERD for a pivotal data-model change                                                                                          | **rejected for the ADR, accepted for the PR** | ADRs 0001–0004 carry no diagrams; the Mermaid belongs in the implementing PR and `docs/architecture.md`, per AGENTS.md.                    |
| —   | Correctness                     | `a11y.spec.ts`'s `PROGRAMMED_TZ` guard is unreachable (`resolveDayRole` never returns null)                                     | **accepted, filed separately**                | Found outside the diff; belongs to TEST-1, not here.                                                                                       |

### Round 2 — the same five lenses re-reviewing this revision

All five confirmed the round-1 set resolved rather than reworded, three of them by deletion. Seven new
findings, all accepted; every one was verified in the code before being acted on.

| #   | Lens                                                      | Critique                                                                                                                                                                                                                                                                                        | Resolution                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | DB-safety                                                 | **`db:seed` runs on every push to `main` and silently reverts an edit** — removal frees the partial slot key and the next merge re-inserts it; reorder-then-remove refills the freed slot with a different movement. `PROGRAM_SEED` is not empty (14 rows); the comment saying it is, is stale. | **Accepted.** New item 0, and the "additive only" claim withdrawn — this is a schema change and nothing in items 1–3 ships before it.                                                                                           |
| E2  | Scope · Architecture · Correctness · DB-safety (all four) | Decision 5 said "one nullable column" while the backlog table called it `entries.prescription_id`. An FK freezes nothing, because `load` and `reps` come from the per-athlete `prescription_targets` that item 2 makes editable.                                                                | **Accepted.** Decision 5 rewritten: the **rendered string** (the `raw_load`/`raw_reps` idiom), plus a CHECK, plus an optional FK for identity, plus the `shared` contract change. The GAP-1 P1-2 absorption claim is qualified. |
| E3  | Scope · Architecture                                      | The snapshot was third in a list whose first item breaks what it fixes, and the backfill window closes at the first edit — prescriptions are seed-immutable only until then.                                                                                                                    | **Accepted.** Snapshot + backfill is now item 1, before any edit.                                                                                                                                                               |
| E4  | Architecture · Reuse · DB-safety (all three)              | "Filter the picker" is not a filter: `ROUTINE_CATALOG` is also `resolveRoutine`'s membership set, which drops non-members **silently**, and the editor's unconditional write then persists the loss.                                                                                            | **Accepted.** Only the offer list is filtered; the membership set is untouched; the transitional both-catalogs state is written down.                                                                                           |
| E5  | Scope                                                     | Item 5 (the movement dimension) is consumed by nothing in this milestone.                                                                                                                                                                                                                       | **Accepted — deferred**, with the note that it must re-point V1-30b's `declaredDimension` rather than coexist with it.                                                                                                          |
| E6  | Correctness · DB-safety                                   | Open question 2's option B is unavailable: a committed tripwire test asserts the export refuses a `count` unit. The ADR's "expand→contract once rows exist" was also backwards.                                                                                                                 | **Accepted — question closed** by the repo rather than by the maintainer.                                                                                                                                                       |
| E7  | Scope                                                     | "TEST-1 lands first" was creep — only the routine editor is in the blast radius, and TEST-2 must not become a precondition.                                                                                                                                                                     | **Accepted.** Narrowed to one spec.                                                                                                                                                                                             |
| —   | Reuse                                                     | The slug does not strip punctuation, so it does not deliver the CSV guarantee alone.                                                                                                                                                                                                            | **Accepted.** Decision 1 now carries both halves: the slug for spaces and capitals, `hasCommaOrLineBreak` at the input boundary for the comma.                                                                                  |
| —   | Architecture                                              | Decision 3's precedence rule ("the activity type wins") nullifies its own Bridge example inside a `set_list` session.                                                                                                                                                                           | **Accepted as a text fix** — the example is replaced rather than the rule, which is the one that protects the discriminant.                                                                                                     |
| —   | Architecture                                              | Several decisions are decided-now-but-landing-later, and the plan author cannot tell which bind them.                                                                                                                                                                                           | **Accepted** — the deferral list now names each, and the milestone section is explicitly the only scoped work.                                                                                                                  |
| —   | Architecture                                              | Title describes the deferred half.                                                                                                                                                                                                                                                              | **Rejected.** "Workouts become data" is the decision the document settles; which milestone executes it is the milestone's business, and renaming per-slice is how an ADR stops being citable.                                   |
| —   | DB-safety                                                 | The deferred rollback runbooks are "recorded there", but there is no scheduling ADR yet to record them in.                                                                                                                                                                                      | **Accepted as a gap, not fixed here.** Noted against the first backfill in that milestone; the stubs at `docs/runbooks.md` remain open.                                                                                         |

### Round 3 — self-review before the PR

Two of round 2's accepted fixes were recorded in the log above but never applied to the text: the
backlog table still carried the `entries.prescription_id` framing that decision 5 contradicts twenty
lines earlier, and CSV-1 was still marked resolved without the backfill qualification. Both are fixed.

Recorded rather than quietly corrected, because a review-response log asserting a change that did not
land is worse than no log: it is the one artifact a later reader trusts without re-checking.

**No blocking concern survives round 2 in the text.** Item 0 is new work this ADR did not previously
know about, and the first plan written against this document is the one that proves it.
