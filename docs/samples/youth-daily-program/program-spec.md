# Youth Daily Training Program — Reference Spec

Source of truth for the printed _Daily Training Log_ sheets, written so it can be used as sample/seed content for mat-plan. Two athletes are currently running this on paper.

---

## 1. Overview

A daily, home-based conditioning program for youth wrestlers. It runs every calendar day with no rest day; load is managed by rotating which movements appear rather than by taking days off.

The program has three parts:

1. **Core block** — four bodyweight movements performed every session
2. **Rotating block** — movements that appear on Day A or Day B only
3. **Every-day block** — fixed accessory and skill work performed on every session regardless of letter

Sessions are done after practice or at home. The paper sheet holds two day-blocks per page.

---

## 2. Rotation Logic

Sessions alternate **Day A → Day B → Day A → …**

This is the key design decision and the one most likely to be mis-modeled: the rotation is **session-indexed, not calendar-indexed.**

- Box jumps appear on A. KB swings appear on B. The athlete therefore does a jump _or_ a swing every single day, while each individual movement lands every other session.
- Inverted rows appear on A only, which is what makes them every-other-session.
- If a day is missed, the next completed session is still the next letter in sequence. The rotation does not skip to match the calendar.

**Implementation note:** derive the letter from the count of completed sessions, not from `date % 2`. A calendar-derived letter will silently double up box jumps after any missed day.

---

## 3. Day A

| Exercise       | Cadence       | Tracked                     | Weight field                            |
| -------------- | ------------- | --------------------------- | --------------------------------------- |
| Push-Ups       | every session | reps per set, up to 10 sets | optional (vest)                         |
| Pull-Ups       | every session | reps per set, up to 10 sets | optional (vest)                         |
| Leg Raises     | every session | reps per set, up to 10 sets | optional (ankle)                        |
| V-Sit Crunches | every session | reps per set, up to 10 sets | optional                                |
| Box Jumps      | Day A only    | reps per set, up to 10 sets | optional (vest); box height also useful |
| Inverted Rows  | Day A only    | reps per set, up to 10 sets | optional (vest)                         |

Six movements. No prescribed rep targets on the sheet — the athlete logs what they actually did, and the set count is variable. Ten set columns exist as headroom, not as a target.

---

## 4. Day B

| Exercise       | Cadence       | Tracked                     | Weight field                      |
| -------------- | ------------- | --------------------------- | --------------------------------- |
| Push-Ups       | every session | reps per set, up to 10 sets | optional (vest)                   |
| Pull-Ups       | every session | reps per set, up to 10 sets | optional (vest)                   |
| Leg Raises     | every session | reps per set, up to 10 sets | optional (ankle)                  |
| V-Sit Crunches | every session | reps per set, up to 10 sets | optional                          |
| KB Swings      | Day B only    | reps per set, up to 10 sets | **required** — bell weight in lbs |

Five movements. Day B is deliberately lighter on pulling, which is what gives the medial elbow and finger flexors a recovery window between Day A row sessions.

---

## 5. Every-Day Block

Performed on both A and B days.

### 5a. Stance in Motion

Wrestling stance movement work. Four captured fields:

| Field            | Type             | Notes               |
| ---------------- | ---------------- | ------------------- |
| duration_minutes | number           | how long they moved |
| vest_lbs         | number or `none` | weighted vest       |
| ankle_lbs        | number or `none` | ankle weights       |
| wrist_lbs        | number or `none` | wrist weights       |

The three load slots are independent — any combination may be used, including none.

### 5b. Rice Bucket

Grip, forearm, and extensor work. Boolean completion only, no reps.

### 5c. Ladder Drills

Footwork. Boolean completion **plus** a rounds count.

### 5d. Single-Leg Hip Thrusts

3 sets × 10 reps **per side**. Tracked as three completion checkboxes rather than a rep field, since the prescription is fixed. Posterior chain and single-leg stability work.

---

## 6. Logged Fields Per Session

```
session
  athlete_id
  date                  (athlete writes it in)
  day_letter            A | B
  streak_number         athlete writes it in; day one = 1, day two = 2, ...
  exercises[]
    exercise_id
    weight              number | "BW" | null
    sets[]              array of rep counts, length 0..10
  stance_in_motion
    duration_minutes
    vest_lbs | ankle_lbs | wrist_lbs
  rice_bucket           boolean
  ladder_drills         boolean
  ladder_rounds         integer
  hip_thrust_sets       [boolean, boolean, boolean]
```

**Streak semantics.** On paper the athlete writes the number themselves, which is intentional — the manual write is part of the motivation. In app form the streak should be derived but still displayed prominently. Define a "completed" session before deriving it; my recommendation is that the core block plus the every-day block counts as complete, and the rotating movement is optional for streak purposes, so a missing box doesn't punish a kid who did the work.

**Variable set counts.** The number of sets is genuinely variable day to day. Do not model this as a fixed 3- or 5-set structure. An empty set slot means "did not do that set," not zero reps.

---

## 7. Progression Rules

There are no prescribed loads on the sheet. Progression is by observation across sessions:

- **Bodyweight movements** — total daily reps trend upward; add sets before adding reps per set
- **Pull-ups** — when a set reaches 10 clean reps, add a harder variation rather than more reps
- **Box jumps** — progress box height, not rep count. High-rep jumping is fatigue work, not power work
- **KB swings** — progress bell weight once 3 sets of 15 are crisp
- **Inverted rows** — progress by lowering the bar toward horizontal before adding weight
- **Stance in motion** — progress duration first, then add one load slot at a time

**Youth-specific constraint worth encoding as a guardrail:** no forced eccentrics, no max-effort grip work, and no loaded jumping. The medial epicondyle in a growing athlete is an unfused apophysis, not a mature tendon attachment, and repeated maximal eccentric flexor load is the mechanism behind Little League elbow. Isometrics and submaximal work carry a very different risk profile. If mat-plan ever auto-generates progressions, these should be hard limits, not suggestions.

---

## 8. Notes for the Session Composer

Behaviors the paper sheet handles implicitly that an app has to decide explicitly:

- **Missed day** — rotation advances on completion, not on date. Streak resets, rotation does not.
- **Practice days** — mat time is real training load. If practice is logged, the composer should be able to drop the rotating movement and keep only the core plus every-day block.
- **Two athletes, different ages** — same structure, different absolute numbers. Nothing in the program needs to change per athlete except the loads and rep ranges, so athlete-level scaling can live entirely in targets rather than in session structure.
- **Partial sessions** — very common with kids. The data model should accept a session with three of six movements filled and still count it.
- **No target display on the sheet** — the paper version deliberately shows no goal numbers, only what was done. Worth A/B testing whether showing a target in-app increases or decreases adherence; on paper, the absence of a target reduced the "I failed today" effect.
