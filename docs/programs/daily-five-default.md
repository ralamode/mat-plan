---
feature: Default program — The Daily Five (new-user onboarding)
owns: []
---

# The Daily Five — the default program for newly onboarded users

The program a brand-new household gets seeded with, before they author anything
of their own. Neutral by construction: **no athlete names, no loads, no
household shorthand** — the three things that make Ray's routine unusable as a
stranger's first screen (see ONB-0).

- **slug:** `daily_five_default`
- **day_role:** `daily` (runs every day, no A/B rotation, no weekday map)
- **duration:** ~8–10 min
- **notes:** Bodyweight only; a pull-up bar is optional and every item has a
  fallback. **No `prescription_targets` are seeded** — see _Why it seeds clean_.

## The one rule that makes it daily

> **No set ever goes to failure.**

Load-bearing constraint, not a soft guideline. Standard guidance (NSCA youth
position stand; minimum-effective-dose meta-analyses) says 2–3 sessions/week —
but that guidance is about sets taken _close to failure_. Submaximal
high-frequency work is a different stimulus with a different recovery cost:
grease-the-groove research shows it drives neural adaptation while minimizing
fatigue, and training to failure actively impairs motor learning.

If a user grinds the Daily Five, it stops being a daily program. **The app must
say this on first run**, and the feedback loop below exists to enforce it.

## The seeded program

| idx | movement           | sets | target_reps | load | How to do it                                                                                                                                                          |
| --- | ------------------ | ---- | ----------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `neck_isometric`   | 2    | 4 × 10s     | BW   | 4-way. Palm on forehead, push head into hand — no movement, just tension. Repeat behind head, then each side. Head stays **neutral**, never cranked back.             |
| 1   | `pull-up`          | 3    | 2           | BW   | Stop well short of a grind. Finish the last set with a 15s dead hang. **No pull-up yet:** 3 × 3 slow 5-second negatives. **No bar:** 3 × 8 table rows.                |
| 2   | `push-up`          | 2    | 8           | BW   | Hands under shoulders, ribs down, body one line, full lockout. Stop 5+ reps short of failure. **If form breaks:** hands on a couch or counter — incline before knees. |
| 3   | `bodyweight_squat` | 1    | 15          | BW   | Slow, full depth, heels down. Flows straight into idx 4.                                                                                                              |
| 4   | `deep-squat_hold`  | 1    | 45s         | BW   | Sit in the bottom of the squat and stay — elbows inside knees, chest tall. The ankle and hip block that feeds shot depth.                                             |
| 5   | `cossack_squat`    | 1    | 5/side      | BW   | Feet wide, shift all the way onto one bent leg, other leg straight, heel down.                                                                                        |
| 6   | `hollow-body_hold` | 3    | 20s         | BW   | On back, low back **pressed flat** into the floor, arms and legs extended and lifted. If the back arches, tuck the knees until it doesn't.                            |
| 7   | `side_plank`       | 2    | 20s/side    | BW   | On the forearm, hips stacked and lifted. Brace, don't twist.                                                                                                          |

**Finisher — the skill, not more work:** `penetration_step`, 1 × 15 clean reps.

Quality reps on fresh legs. This is the whole point of a program that doesn't
exhaust anyone: distributed-practice research finds spaced short sessions beat
massed ones by 30–50% on retention, and skill reps only bank if they're clean.

## What was held back, and what it costs

**`sprawl-to-stance` (2 × 8, +3 pogo hops per rep) is deliberately NOT seeded**
for new users _(Ray, 2026-09-28)_. It is the sixth movement of the full program
(**The Daily Six**, `tools/default-workout.md` in the wrestling-context repo)
and the first thing a user should graduate into.

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
- **It is also the most defensible cut for an unsupervised stranger**: it needs
  floor space, it is loud, and it is the one movement here that a user who has
  never wrestled is likely to perform badly without a coach watching.

**Where it comes back:** the first graduation prompt once the feedback loop has
a week of data, or when the household authors its own program. The full Daily
Six stays documented so the sixth movement is an _unlock_, not a rediscovery.

## The feedback loop (how it personalizes)

A default program cannot reference "40% of your max" — a new user has no max,
and asking them to find one is precisely the behavior this program exists to
avoid. So: **conservative fixed doses + one tap per movement.**

**Too easy · Just right · Too hard**

| Tap        | Next session                                       |
| ---------- | -------------------------------------------------- |
| Too easy   | +10–15% (add reps to a set, then add a set)        |
| Just right | Hold. Ramp on the next "too easy."                 |
| Too hard   | −20%, immediately — do not wait for a next session |

**Ceilings the app enforces regardless of taps:** never prescribe past ~50% of
the user's observed best single set, and never ramp more than 15% in a week. A
user tapping "too easy" every day is being allowed to grind — cap the ramp and
re-surface the never-to-failure message.

**Ramp targets** (roughly week 4–6, not day 1): deep-squat hold 45s → 60s,
push-ups 2 × 8 → 2 × 12, pull-ups 3 × 2 → 3 × 3.

No questionnaire. No max testing. This is the same "no questionnaire" shape
ONB-0 and ONB-1 already committed to.

## Why it seeds clean (the implementation note that matters)

**The Daily Five is prescriptions with no `prescription_targets`.**

Per-athlete loads live in `prescription_targets`; a neutral default has none to
write, because it does not know who the athlete is. Every load in the table
above is `BW` or a duration — properties of the _movement_, not of the person.
That is what makes this seedable for a stranger where Ray's S&C block is not
(`kids-sc-foundation-archived.md` carries a Liam column and a Scarlett column).

Consequence: a fresh household's first program renders entirely from
prescriptions, and every set row the user touches is an empty field they fill.
V1-23's "a null prescription scaffolds 3 set rows, not 1" is the behaviour this
depends on.

**This fills ONB-0's other half.** ONB-0 calls for "a **neutral** default
routine" — a `routine_config`, an ordered list of activity keys. The Daily Five
is the neutral default **program** — `program_blocks → prescriptions`. Different
shape, different table, same first-run problem. A stranger needs both, or their
first screen is still Ray's family's day.

## Safety stops

Surface these, do not bury them in a disclaimer:

- **Neck pain, tingling, or anything radiating into an arm** → stop idx 0 and
  get it looked at. Isometrics should feel like nothing but muscle tension.
- **Elbow / shoulder / wrist niggle** → back off idx 1–2 for a few days.
  Overuse is the only real injury vector in daily submaximal work, and in a
  growing athlete the tendon is the rate-limiter, not the muscle.
- **Never substitute a loaded wrestler's bridge as the daily neck driver.**
  Axial compression on the cervical spine at end-range extension under
  bodyweight is the position with the least margin if form breaks. The bridge
  is a _pin-defense skill_ worth drilling at low volume; it is not the strength
  stimulus. Neck strength reducing concussion risk is well supported; that it
  must come from bridging is not. **This holds at every age tier.**
- **Two rest days a week are available, and a skip is never shamed.** Youth
  overuse guidance is roughly _hours/week ≤ age_, with 1–2 days off.

## Audience

Tuned for **youth wrestlers, roughly 8–14** — where mat-plan starts. It scales
up through the ramp rule; an older athlete simply arrives at bigger numbers
faster. The one place age genuinely matters is the neck, and the isometric
constraint above is written to hold regardless of tier.

## CSV output

The four legacy CSVs and their byte-level contract are authoritative in
[csv-export-contract.md](../csv-export-contract.md). Two decisions specific to
this program:

1. **`session_type` for every strength row is `daily-five`** (kebab-case,
   consistent with the existing `strength-a`). The full six-movement version
   emits `daily-six`.
2. **Push-ups and pull-ups route to `calisthenics-log`, not `strength-log`** —
   idx 1 and 2 _are_ the grease-the-groove push/pull track, which is what those
   columns exist for. idx 0 and 3–7 go to `strength-log`. **Do not double-count.**
   The finisher writes `shot` in `checkins` and touches no other column.

Timed holds follow the established convention: **duration in `load`, `reps` = 1**;
per-side prescriptions live in `prescribed`, never in `reps`.

```
date,session_type,movement,sets,reps,load,prescribed,notes
2026-09-28,daily-five,neck-isometric,2,4,10s,2x4x10s,4-way: flex/ext/L/R; neutral head throughout
2026-09-28,daily-five,squat,1,15,BW,1x15,full depth; heels down
2026-09-28,daily-five,deep-squat-hold,1,1,45s,1x45s,chest tall; elbows inside knees
2026-09-28,daily-five,cossack-squat,1,10,BW,1x5/side,heel down on the straight leg
2026-09-28,daily-five,hollow-hold,3,1,20s,3x20s,low back flat; tucked variation
2026-09-28,daily-five,side-plank,2,1,20s,2x20s/side,hips stacked and lifted
```

```
date,pushups,pullups,vsit_crunch,vsit_skill_step,notes
2026-09-28,16,6,,,daily-five; 15s dead hang after last pull set
```

```
date,stance,ladder,bridge,mobility,pressure,reaction,shot,notes
2026-09-28,,,,,,,15,daily-five finisher
```

V-sit columns stay empty — the Daily Five has no v-sit work. Empty cell for
missing, never `0`.

## The 4-minute version

If a user has almost no time: **idx 0 → idx 1 → idx 3–5.** Ship it as an
explicit "short on time?" control. A user who does the short version five days
beats a user who does the full version once, and the main way a default program
fails is people not finishing day one.
