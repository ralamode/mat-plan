---
last_updated: 2020-06-02
author: Ray Baker
tags: [data, strength-log, csv, reference]
---

# Strength Log — append-only CSVs

Per-athlete monthly CSVs that record **what got moved** in S&C sessions (trainer days, home days, anything that puts weight on the bar / sled / DB). Mirrors the routine-checkin pattern: append-only, **out-of-context unless asked**, summary lands in narrative.

## Where it lives

```
data/strength-log/
  athlete-a/
    2020-06.csv
    2020-07.csv
    ...
  athlete-b/
    2020-06.csv
    ...
```

## Header

```
date,session_type,movement,sets,reps,load,prescribed,notes
```

- **date** — `YYYY-MM-DD`
- **session_type** — `trainer` / `home-strength` / `home-pull` / `home-push` / `private`
- **movement** — kebab-case (`back-squat`, `front-squat`, `db-rdl`, `sled-push`, `box-jump`, `bulgarian-split-squat`, `pull-ups`, `hollow-hold`, `broad-jump`, `lateral-jump`, `db-step-back-lunge`, …)
- **sets / reps** — integers; for completed-sets-less-than-prescribed, log the **completed** count (note the gap in `notes`)
- **load** — free-form string to handle the real shapes of strength data:
  - **per-set** when it varies: `"55/60/60"`
  - **single value** when flat: `"65"` or `"40 (2× 20 DB)"`
  - **measure** when relevant: `"30in"` (box jump height), `"50ft"` (sled distance)
  - **bodyweight or qualitative**: `"BW"`, `"sub-failure"`, `"banded"`
- **prescribed** — what the program called for (`"5×3 progressive"`, `"3×8 @ 25"`, etc.) — captures the gap between plan and reality
- **notes** — free-form. Bar speed feel, form notes, why skipped, etc.

## How to use

- **Don't read these wholesale into context** for normal work — they're data.
- **Append-only.** When a session runs, add rows (one per movement per athlete).
- **Summary lives in narrative:** weekly/monthly read-up of trends → `athletes/<name>/progress-log.md`.
- **Skips count too:** log a row with `sets=0, load="SKIPPED"` so the gap is visible.
- **One row per movement per athlete.** If Athlete A and Athlete B moved different loads on the same lift, that's **two rows**.

## Why this exists

The training-log files (`shared/training-log/<year>/<month>/<date>.md`) are the day's plan-and-execute narrative — checkboxes, gate, cues, prose. They don't roll up cleanly for progressive-overload analysis ("what did Athlete A back-squat across the last 4 Tuesdays?"). The CSV is the structured layer underneath: one row per movement, query-able, plottable later.
