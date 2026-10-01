---
feature: Default program — The Daily Five (new-user onboarding)
owns: []
---

# The Daily Five — the default program for newly onboarded users

> **Status: model-drafted definition, not yet confirmed** — Ray (or a qualified coach) signs off each
> dose before it is seeded; the seed PR cites the sign-off. Drafted by a model session on 2026-09-28
> rescued in #198 and corrected after review in #199. AGENTS.md: the model may draft _definitions_ a human confirms,
> never live prescriptions — and no dose here may reach a stranger's child until that sign-off exists.

The program a brand-new household gets seeded with, before they author anything
of their own. Neutral by construction: **no athlete names, no loads, no
household shorthand** — the three things that make Ray's routine unusable as a
stranger's first screen (see ONB-0).

- **name / slug:** "Daily Five" → `daily_five` (program-block slugs are `movementSlug(name)`)
- **day_role:** the same rows seeded under **both `strength_a` and `strength_b`** — the A/B stopgap
  _(Ray, 2026-09-30)_. No `daily` role exists yet; see _Scheduling_.
- **duration:** ~8–10 min
- **notes:** Bodyweight only; a pull-up bar is optional and every item has a
  fallback. **No `prescription_targets` are seeded** — see _Why it seeds clean_.

## The one rule that makes it daily

> **No set ever goes to failure.**

Load-bearing constraint, not a soft guideline. Standard guidance (the NSCA youth
resistance-training position stand) says 2–3 sessions/week — but that guidance
is about structured resistance sets taken _close to failure_. Submaximal,
high-frequency practice is a different stimulus with a different recovery cost.
"Grease the groove" is a **practitioner method** (frequent, easy sets of a skill)
rather than a well-controlled research finding; the case for it here is
practical: easy daily sets are hard to get wrong, cheap to recover from, and build
the habit. Avoiding failure also keeps reps clean, which matters more for a
child learning the movement than for the number.

If a user grinds the Daily Five, it stops being a daily program. **The app must
say this on first run** — that copy ships with ONB-2 in Beta 0. Nothing in Beta 0
_enforces_ it: the doses are fixed, and the feedback loop below (which would) is
deferred with the engine.

## The seeded program

| idx | movement           | sets | target_reps | load | How to do it                                                                                                                                                                                                                                                              |
| --- | ------------------ | ---- | ----------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `neck_isometric`   | 8    | 10s         | BW   | 8 holds = 4 directions × 2 rounds. Palm on forehead, push head into hand — no movement, just tension. Repeat behind head, then each side; then the round again. Head stays **neutral**, never cranked back.                                                               |
| 1   | `pull-up`          | 3    | 2           | BW   | Stop well short of a grind. Finish the last set with a 15s dead hang. **No pull-up yet:** 3 × 15s dead hang instead (negatives are optional, a few a week, not daily — they are near-maximal eccentric work for a child). **No bar:** 3 × 8 table rows (`inverted_rows`). |
| 2   | `push-ups`         | 2    | 8           | BW   | Hands under shoulders, ribs down, body one line, full lockout. Stop 5+ reps short of failure. **If form breaks:** hands on a couch or counter — incline before knees.                                                                                                     |
| 3   | `bodyweight_squat` | 1    | 15          | BW   | Slow, full depth, heels down. Flows straight into idx 4.                                                                                                                                                                                                                  |
| 4   | `deep-squat_hold`  | 1    | 45s         | BW   | Sit in the bottom of the squat and stay — elbows inside knees, chest tall. The ankle and hip block that feeds shot depth.                                                                                                                                                 |
| 5   | `cossack_squat`    | 1    | 5/side      | BW   | Feet wide, shift all the way onto one bent leg, other leg straight, heel down.                                                                                                                                                                                            |
| 6   | `hollow-body_hold` | 3    | 20s         | BW   | On back, low back **pressed flat** into the floor, arms and legs extended and lifted. If the back arches, tuck the knees until it doesn't.                                                                                                                                |
| 7   | `side_plank`       | 2    | 20s/side    | BW   | On the forearm, hips stacked and lifted. Brace, don't twist.                                                                                                                                                                                                              |

**Finisher — the skill, not more work:** 15 clean penetration steps.

Quality reps on fresh legs. Motor-learning research generally favours spaced,
shorter practice over massed practice for retention (the distributed-practice
effect), and skill reps only bank if they're clean. **It is logged as the
household routine's `shot` check-in, not as a prescription** — `shot` is a
check-in metric (`catalog-metrics.ts`), one row per day.

### Catalog additions this program needs

Each new movement's slug must equal `movementSlug(name)` (pinned by a test in
`packages/shared`), and timed holds get `unitDefault: 'sec'` so the form
**defaults** to seconds — the form asks "Measuring?" and the default only
preselects (`docs/features/strength-logging.md`). Rep movements use `null`, as
the existing ones do (`reps` is not a unit code). Every new row also needs `isBodyweight`
(the catalog schema requires it): **`true`** for the bodyweight squat and Cossack squat, so they
export `BW` without V1-26's loaded-movement note; for the timed holds it is a deliberate choice
— `true` lets a BW tap read `BW+20s`, `false` keeps `load` a pure duration. Decide it in the seed
PR; the existing `hollow-body_hold` is `true`.

| Name             | Slug               | Unit default | Note                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neck isometric   | `neck_isometric`   | `sec`        | new                                                                                                                                                                                                                                                                              |
| Bodyweight squat | `bodyweight_squat` | `null`       | new                                                                                                                                                                                                                                                                              |
| Deep-squat hold  | `deep-squat_hold`  | `sec`        | new                                                                                                                                                                                                                                                                              |
| Cossack squat    | `cossack_squat`    | `null`       | new                                                                                                                                                                                                                                                                              |
| Side plank       | `side_plank`       | `sec`        | new                                                                                                                                                                                                                                                                              |
| Dead hang        | `dead_hang`        | `sec`        | new — the "no pull-up yet" substitute, logged as its own movement                                                                                                                                                                                                                |
| Pull-up          | `pull-up`          | `null`       | **exists**                                                                                                                                                                                                                                                                       |
| Push-ups         | `push-ups`         | `null`       | **exists** — never add `push-up`; it would split the history                                                                                                                                                                                                                     |
| Hollow-body hold | `hollow-body_hold` | `sec`        | **exists, but CHANGE**: its catalog `unitDefault` is `null` today. The movement seed is `onConflictDoNothing` on `slug`, so editing the catalog never reaches a deployed DB — it needs a guarded correction or migration, and it changes the shared row for **every** household. |
| Inverted rows    | `inverted_rows`    | `null`       | **exists** — the "no bar" substitute                                                                                                                                                                                                                                             |

Fallbacks are logged **as the movement actually done** (a dead hang is a
`dead_hang` set, not a pull-up set with a note), so the history stays honest.
Incline push-ups are logged as `push-ups` with a note; the incline is a form
cue, not a different movement.

That is **six** additions (neck isometric, bodyweight squat, deep-squat hold,
Cossack squat, side plank, dead hang) and **one change** (hollow-body hold's
unit default).

## What was held back, and what it costs

**`sprawl-to-stance` (2 × 8, +3 pogo hops per rep) is deliberately NOT seeded**
for new users _(Ray, 2026-09-28)_. It is the sixth movement of the full program
(**The Daily Six**, kept in Ray's private notes — not in this repo) and the first
thing a user should graduate into.

Recording the cost honestly, because it is not zero:

- **Competency coverage drops from 8/8 to 6/8.** The seeded five cover
  lower-body bilateral (idx 3) and unilateral (idx 5), upper push (idx 2),
  upper pull (idx 1), core bracing / anti-rotation (idx 6–7), and grasping
  (the idx 1 dead hang). Dropping the sprawl loses **jump / land / rebound**
  (the pogo hops) and **acceleration / deceleration** (the sprawl-to-stance
  pop-up) from the youth-LTAD Athletic Motor Skill Competency set.
- **It was the only item that raises heart rate**, and the only one performed
  in a wrestling position. The finisher still carries skill, so the program is
  not un-wrestling — but the seeded five are, strictly, general physical
  preparation plus a shot rep.
- **It is also the most defensible cut without a coach**: it needs floor space,
  it is loud, and it is the one movement here that a user who has never wrestled
  is likely to perform badly without a coach watching.

**Where it comes back:** the first graduation prompt once the feedback loop
exists and has a week of data, or when the household authors its own program.
The full Daily Six stays in Ray's private notes, so the sixth movement can arrive
as an _unlock_, not a rediscovery.

## The feedback loop — deferred, not in Beta 0

> **Beta 0 ships fixed, signed-off doses only.** Everything in this section —
> the taps, the ramp and its ceilings — needs `packages/engine`, which the beta
> milestone puts after beta (v2). It is recorded here so the design isn't lost;
> it gets its own row when the engine starts.

A default program cannot reference "40% of your max" — a new user has no max,
and asking them to find one is precisely the behavior this program exists to
avoid. So: **conservative fixed doses + one tap per movement.**

**Too easy · Just right · Too hard**

| Tap        | Effect                                                    |
| ---------- | --------------------------------------------------------- |
| Too easy   | Next session: +10–15% (add reps to a set, then add a set) |
| Just right | Hold. Ramp on the next "too easy."                        |
| Too hard   | −20%, applied immediately to the rest of today and after  |

**The ramp is computed deterministically** — `packages/engine`, covered by
golden vectors — **never by an LLM.** A tap is an input; the dose is arithmetic.

**Ceilings the engine would enforce regardless of taps:** never ramp more than 15% in a
week. A second ceiling — "never prescribe past ~50% of the user's best logged
set" — only binds once the user has logged a set **above** the prescription
(logged reps are what they did, not what was asked); until then the weekly cap is
the only brake. A user tapping "too easy" every day is being allowed to grind —
cap the ramp and re-surface the never-to-failure message. _(Open: whether the
50% rule earns its complexity; decide in the engine PR.)_

**Ramp targets** (roughly week 4–6, not day 1): deep-squat hold 45s → 60s,
push-ups 2 × 8 → 2 × 12, pull-ups 3 × 2 → 3 × 3.

No questionnaire. No max testing. This is the same "no questionnaire" shape
ONB-0 and ONB-1 already committed to.

## Why it seeds clean (the implementation note that matters)

**The Daily Five is prescriptions with no `prescription_targets`.**

Per-athlete loads live in `prescription_targets` — `prescriptions` has **no load
column at all**. A neutral default has no targets to write, because it does not
know who the athlete is. The table's "load" column is descriptive: `BW` comes
from the movement (`movements.is_bodyweight`) and a duration is carried in
`target_reps` text with the movement's `unit_default: sec`. Both are properties
of the _movement_, not of the person.
That is what makes this seedable for a stranger where Ray's S&C block is not
(`kids-sc-foundation-archived.md` carries a per-athlete column for each child).

Consequence: a fresh household's first program renders entirely from
prescriptions, and every set row the user touches is an empty field they fill.
What makes that work is `programDayRows`' LEFT JOIN — a prescription with no
target yields a null load — and the scaffold row having no load field. (V1-23's
default of 3 set rows does **not** apply: it fires only when `prescriptions.sets`
is null, and every Daily Five row sets it.)

**This fills ONB-0's other half.** ONB-0 calls for "a **neutral** default
routine" — a `routine_config`, an ordered list of activity keys. The Daily Five
is the neutral default **program** — `program_blocks → prescriptions`. Different
shape, different table, same first-run problem. A stranger needs both, or their
first screen is still Ray's family's day.

## Safety stops

**A parent is present**, at least for under-10s — youth resistance-training
guidance (the same NSCA position stand) stresses qualified adult supervision.
The program is designed so a parent can run it without a coach, not so a child
runs it alone.

Surface these, do not bury them in a disclaimer:

- **Neck pain, tingling, anything radiating into an arm, or a headache,
  dizziness or vision change** → stop idx 0 and get it looked at. Isometrics
  should feel like nothing but muscle tension.
- **Elbow / shoulder / wrist / knee / heel niggle** → back off the related items
  for a few days. Overuse is the main risk in daily submaximal work, and in a
  growing athlete the vulnerable sites are the growth plates and the tendon
  attachments (apophyses), not the muscle.
- **Never substitute a loaded wrestler's bridge as the daily neck driver.**
  Axial compression on the cervical spine at end-range extension under
  bodyweight is the position with the least margin if form breaks. The bridge
  is a _pin-defense skill_ worth drilling at low volume; it is not the strength
  stimulus. There is some observational evidence that a stronger neck is
  associated with lower concussion risk (reviews call it inconclusive); there is
  none that it must come from bridging. **This holds at every age tier.**
- **Two rest days a week are expected, and a skip is never shamed.** The
  program is _available_ every day (under the A/B stopgap every day is an A or
  a B day), not owed every day. A streak (MOT-1) counting a rest day as rest
  needs SCHED-1's schedule, which is Beta 1. Youth
  overuse guidance is roughly _hours of organised sport per week ≤ age_, with 1–2
  days off; that counts **all** sport, so for a kid already practising daily
  this program adds to that total rather than fitting under it.

## Audience

Tuned for **youth wrestlers, roughly 8–14** — where mat-plan starts. In Beta 0 the doses are fixed;
once the ramp exists (deferred with the engine, above) an older athlete would simply arrive at
bigger numbers faster. The one place age genuinely matters is the neck, and the isometric
constraint above is written to hold regardless of tier.

## Scheduling — decided: the A/B stopgap _(Ray, 2026-09-30)_

The intent is one block, the same every day. The code has no way to say that
yet: `DAY_ROLES` and both CHECK constraints (`prescriptions_day_role_check`,
`sessions_day_role_check`) have **no `daily` role**, and Today asks
`programDayRows` for whatever `resolveDayRole(day)` returns — **global epoch-day
A/B parity**, not per household.

**Decision: seed the same Daily Five rows under both `strength_a` and
`strength_b`.** Whichever parity day it is, the household sees the Daily Five. No
new role, no CHECK migration, no SCHED-1 slice — so ONB-2 has **no SCHED-1
dependency** and stays in Beta 0. The consequences, accepted:

- **CSV `session_type` alternates `strength-a` / `strength-b` by day.** There is
  no `daily-five` value; the label is parity, not the program's name.
- **It truly runs every day.** Under parity there is no "rest day" for the
  program — every day is an A or a B day. Rest is the household's choice, not the
  schedule's.
- **The real per-household daily role is deferred to SCHED-1 (Beta 1),** which
  can migrate these rows to it later (and fix the CSV label then).

**Constraints the stopgap imposes** — `programDayRows` shows the household's
**newest block that programs the day's role**, so:

- **Never add the Daily Five to `PROGRAM_SEED` under Ray's household**
  (`SEED_HOUSEHOLD_PUBLIC_ID`, also the dev/e2e household). It would be newer than
  YDP on both roles and silently replace it on every A and B day.
- **The A and B copies can drift.** It is 16 rows, 8 per role; a V1-22 edit to one
  copy changes only that role. Until SCHED-1, an editor must edit both or treat them
  as one.
- **A later block on only one role alternates with it.** A household that authors a
  `strength_a`-only program sees that on A days and the Daily Five on B days.
- **Programs on any other role never reach Today**, because parity only ever
  returns `strength_a` or `strength_b`.

**Who writes the rows:** not `seed.ts` (that is Ray's household and the fixtures).
The Daily Five is written **when a household is created** — owned by the
household-creation path (TEN-1/AUTH-1's first sign-in, or ONB-0's first run,
whichever lands that write).

The rejected alternative — a new `daily_five` role plus a CHECK migration plus
per-household role resolution — is a slice of SCHED-1, and pulling it into Beta 0
would have made ONB-2 wait on it.

## CSV output — open design decisions

The four legacy CSVs and their byte-level contract are authoritative in
[csv-export-contract.md](../csv-export-contract.md). **Facts today:** the V1-13
export emits strength-log, bodyweight and checkins only (there is no calisthenics
export), and **checkins is header-only today** — `buildCheckins([])`, zero rows, per the
contract; `session_type` is `csvSessionType(dayRole, sessionType)` — the day role
(falling back to the session type) with `_` → `-`;
movements are `csvMovement(slug)`; and because prescriptions are movement-based,
every prescribed set — push-ups and pull-ups included — is a movement entry that
lands in **strength-log**.

1. **`session_type`** — decided by the stopgap: `strength-a` / `strength-b`,
   alternating by day. Revisit when SCHED-1 adds a real role.
2. **Push/pull routing** — open. Today they go to strength-log like every other
   movement. Routing them to `calisthenics-log` (the grease-the-groove columns)
   needs a calisthenics export and a per-program routing rule — Ray's own
   household already writes `pull-up` to strength-log, so it cannot be global.
   **Never both.**
3. **The finisher** — decided: it is the routine's `shot` check-in, stored as a check-in and
   nowhere else. **It reaches no CSV today**: the checkins export is header-only. It appears in
   `checkins` only once the exporter writes check-in rows, which no backlog row schedules yet.

Sample, for a `strength_a` day with push/pull left in strength-log (the
next day's rows read `strength-b`). Timed holds follow the
contract: **duration in `load`, `reps` = 1**; per-side lives in `prescribed`.
The neck block is prescribed as 8 sets of `10s` (2 rounds × 4 directions), so
`prescribed` is `8x10s`, exactly what the export builds from `sets` and `target_reps`.

`notes` is whatever the athlete typed on the entry, so a fresh user's rows have it empty; the
how-to cues live in the program, not the export.

```
date,session_type,movement,sets,reps,load,prescribed,notes
2026-09-28,strength-a,neck-isometric,8,1,10s,8x10s,
2026-09-28,strength-a,pull-up,3,2,BW,3x2,
2026-09-28,strength-a,push-ups,2,8,BW,2x8,
2026-09-28,strength-a,bodyweight-squat,1,15,BW,1x15,
2026-09-28,strength-a,deep-squat-hold,1,1,45s,1x45s,
2026-09-28,strength-a,cossack-squat,1,5,BW,1x5/side,
2026-09-28,strength-a,hollow-body-hold,3,1,20s,3x20s,
2026-09-28,strength-a,side-plank,2,1,20s,2x20s/side,
```

The `load` cells assume the athlete logs a hold's seconds without tapping BW. `hollow-body_hold`
is `isBodyweight: true` in the catalog, so a BW tap plus 20 s exports as `BW+20s`; the holds'
`isBodyweight` choice (below) decides which the form nudges toward.

The finisher's row, **as it would read once the exporter writes check-in rows** (not emitted
today):

```
date,stance,ladder,bridge,mobility,pressure,reaction,shot,notes
2026-09-28,,,,,,,15,
```

Empty cell for missing, never `0`.

## The 4-minute version

If a user has almost no time: **idx 0 → idx 1 → idx 3–5.** **Not in Beta 0** — as
an explicit "short on time?" control it is new UI, deferred with the feedback loop; until then
it is guidance in the first-run copy. A user who does the short version five days
beats a user who does the full version once, and the main way a default program
fails is people not finishing day one.
