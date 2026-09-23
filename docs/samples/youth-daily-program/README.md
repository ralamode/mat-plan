# Youth Daily Training Program — the sample, and what it breaks

**Provenance:** Ray's real daily S&C program, run on paper by two athletes. Supplied 2026-09-23 as
[`program-spec.md`](./program-spec.md) (the human-readable source of truth for the printed sheets) and
[`seed.json`](./seed.json) (the same thing structured, with four sample sessions). Both are **already
anonymised** — `athlete_1` / `athlete_2`, no names, no bodyweights — so unlike the legacy CSV samples
they needed no scrub.

**Why it is here:** it is the second real program the app has ever been asked to model, and the first
that is not Ray's weekday strength block. That makes it the best available test of whether "portable,
entity-based" is true or merely asserted. **It is not.** Four of its shapes are unrepresentable today,
and one of them contradicts a decision taken last week.

> **Not fixtures.** Nothing here is seed or test data. It is evidence, like
> [`../legacy-csv/`](../legacy-csv/README.md).

## Can mat-plan log this program today?

Verified against `packages/db/src/schema.ts` and the shipped write path, not inferred.

| What the program needs                         | Today                                                                                                    | Verdict |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------- |
| Reps-per-set on a named movement               | `entries` → `entry_sets`, the V1-8-2 path                                                                | ✅      |
| Variable set count, "empty ≠ 0 reps"           | Sets are rows; a blank field is not `0`. `prescriptions.sets` is nullable                                | ✅      |
| No prescribed reps (log what you did)          | `target_reps` is nullable                                                                                | ✅      |
| Partial sessions still count                   | **V1-19** just shipped exactly this (untouched cards drop)                                               | ✅      |
| Rice bucket — boolean                          | Already a seeded `activity_type`                                                                         | ✅      |
| Ladder drills — boolean **+ rounds**           | A `ladder` metric exists (V1-5); the count fits `value_num`                                              | ✅      |
| `BW` as a load                                 | GAP-1 P0-2's `weight_label` — though GAP-3 replaces it                                                   | ⚠️      |
| Per-movement "weight does not apply"           | `movements.is_bodyweight` exists but **nothing in the app reads it** (`catalog.ts:80` hardcodes `false`) | ⚠️      |
| Hip thrusts — 3 fixed checkboxes, per side     | Loggable as 3 sets × 10; the checkbox affordance and `per_side` are not modelled                         | ⚠️      |
| **Session-indexed A/B rotation**               | **No.** See below — the headline finding                                                                 | ❌      |
| **Stance in Motion — 3 load slots + duration** | **No.** One `weight_num` per set; `seconds` exists but has no writer outside strength                    | ❌      |
| **Box height as a tracked field**              | No length dimension exists at all (ADR 0004 §6)                                                          | ❌      |
| **Streak + its completion rule**               | MOT-1, unbuilt                                                                                           | ❌      |

## The four findings

### 1. The rotation is session-indexed, and that is a third schedule shape

The program runs **every day**, alternating `A → B → A`, and the letter comes from **the count of
completed sessions — never the calendar.** The spec is emphatic, and gives the failure mode:

> Derive the letter from the count of completed sessions, not from `date % 2`. A calendar-derived letter
> will silently double up box jumps after any missed day.

Sample session 4 is the proof: 9/17 was missed, so 9/18 is **A** — following B — rather than jumping to
whatever the calendar would have said.

**This contradicts a decision taken 2026-09-19.** [MOT-1.4b](../../plan.md) settled that _"the coach
selects the days a program is due — Monday, Wednesday, Friday — never 'three times a week'"_, and
SCHED-1 records **one** schedule shape: assigned days. That decision was correct for the weekday
strength block it was made about. It cannot express this program, which is the one Ray's kids actually
run daily.

So **SCHED-1 needs a third shape**, and it is not the quota shape that was already considered and
rejected:

| Shape                        | Example     | "Is it due today?"                                               |
| ---------------------------- | ----------- | ---------------------------------------------------------------- |
| Assigned days                | Mon/Wed/Fri | Lookup ✅ _(decided)_                                            |
| Quota                        | 3×/week     | Needs arithmetic ❌ _(rejected 2026-09-19)_                      |
| **Session-indexed rotation** | daily, A/B  | Always due; **which variant** depends on completed-session count |

Note it does **not** reopen the rejection. Quota was rejected because "is it due today?" had no answer;
here the answer is always **yes** — every day is a training day. The open question is _which_ variant,
which is a function of history rather than of the calendar. That is a genuinely different question, and
it needs the **recorded daily verdicts** SCHED-1 already requires for streaks (a rotation derived from
"completed sessions" needs to know which past days counted).

### 2. Stance in Motion needs three simultaneous loads plus a duration

`duration_minutes` with independent `vest_lbs` / `ankle_lbs` / `wrist_lbs`, any combination including
none. Today a set carries **one** `weight_num`, and `entry_sets.seconds` exists with no writer outside
the strength path.

**ADR 0004 did not anticipate this** — its mapping table handles one weight plus at most one other
dimension (`123 (50ft)`), not three load slots at once. It is the same class of surprise the legacy
CSVs produced with their per-set slash lists: a real program expressing something the column design
assumed away. **GAP-3's plan should see this file before its columns are fixed.**

The weighted-vest detail also corroborates a point already recorded in MOT-1.3: the 90-day-streak
athlete does loaded stance work daily, so "daily habits are unloaded, S&C is loaded" is not a real
distinction.

### 3. The spec answers an open MOT-1 question

MOT-1 left "what counts as a completed day" to its UX panel. The program already has a field-tested
answer:

> **core block + every-day block** counts as complete; the **rotating movement is optional** for streak
> purposes, so a missing box does not punish a kid who did the work.

Worth adopting as MOT-1's default rather than re-deriving it — it comes from a program two kids have
actually run, which is better evidence than a panel's judgement. It also matches the shape MOT-1
already chose: forgiving, and never punishing work that was done.

### 4. Youth guardrails belong in the engine, as limits

> no forced eccentrics · no max-effort grip work · no loaded jumping
>
> The medial epicondyle in a growing athlete is an unfused apophysis… If mat-plan ever auto-generates
> progressions, these should be **hard limits, not suggestions.**

This is the first domain-specific safety constraint the repo has been given, and it lands exactly where
**AI-1's S1** already draws its line: a load may be written only by a human or by _a readable rule_.
These are what such a rule has to respect. Recorded here so that whoever builds `packages/engine` (v2)
inherits them rather than rediscovering them — and note the spec's framing, that the reason is
anatomical rather than a matter of preference, which is why they are limits and not defaults.

## What this implies

1. **SCHED-1** gains a third schedule shape (finding 1) and inherits the streak completion rule
   (finding 3).
2. **GAP-3's column design should read finding 2 before it is fixed** — the same role the legacy CSVs
   played, for a shape they did not contain.
3. **The program editor** ([v1-22 plan](../../plans/v1-22-program-editor.md)) must be able to author
   this program, not just Ray's weekday block. It is the harder of the two and therefore the better
   design target.
4. **`movements.is_bodyweight` should start being read.** It exists, the app hardcodes `false`, and this
   program has four movements where a weight field is meaningless.
