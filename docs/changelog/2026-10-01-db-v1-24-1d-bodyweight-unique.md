- **2026-10-01** — **V1-24 PR 1d: one live weigh-in per day, enforced by the database**
  ([plan](../plans/v1-24-form-is-the-day.md)). Migration `0012` adds `uq_entries_profile_day_bodyweight`
  on `(profile, day, coalesce(context, 'morning'))` for live bodyweight rows: slot-ready for V1-32's
  several-a-day, and scoped so check-ins and calisthenics may still repeat. `coalesce` because no writer
  sets `context` until 1e, so NULL and `morning` must be the same slot. The migration takes a `SHARE`
  lock and refuses, naming the runbook, if a duplicate already exists. No app code: until 1e moves the
  arbiter, a same-day duplicate is a refused insert instead of a silent second row. `db:verify` proves
  each case and the pre-check; every proof was mutation-checked.
