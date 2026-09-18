---
last_updated: 2020-07-03
author: Ray Baker
tags: [data, bodyweight, csv, reference]
---

# Bodyweight Log — append-only CSVs

Per-athlete monthly CSVs recording each weigh-in. Feeds **relative-strength** tracking (load ÷ bodyweight) and daily load suggestions. Same discipline as the other data CSVs: append-only, **out-of-context unless asked**, summary lands in narrative (`progress-log.md`).

**Youth-safety note:** this is for **tracking growth and relative strength**, NOT weight management. These are **youth athletes in a growth phase — never cut weight.** A flat or dropping bodyweight during a growth phase is a flag to check fueling/sleep, not a goal.

## Where it lives

```
data/bodyweight/
  athlete-a/2020-07.csv
  athlete-b/2020-07.csv
  ...
```

## Header

```
date,weight_lb,context,notes
```

- **date** — `YYYY-MM-DD`
- **weight_lb** — number (e.g. `85.5`)
- **context** — when weighed: `morning` / `pre-practice` / `post-practice` / `random`
- **notes** — free-form (hydration, after a big meal, etc.)

## How to use

- Logged as part of the daily driver: when Ray reports weights in the `/daily-plan` prompt, append a row per kid.
- **Don't read wholesale into context.** Roll trends into `athletes/<name>/progress-log.md` at the weekly/monthly retro.
- Archive completed months alongside the routine/strength CSVs.
