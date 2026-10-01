- **2026-09-30** — **V1-24 PR 1c: the duplicate weigh-ins have a correction that refuses to guess**
  ([plan](../plans/v1-24-form-is-the-day.md)). A read against prod found exactly one duplicate group —
  Liam, 2026-09-30, three live bodyweight rows — and Ray named the keeper (the 12:17 morning weigh-in;
  the 19:46 pair was six seconds apart, so time of day is all that distinguishes them). The correction
  soft-deletes the other two under a guard pinned on `public_id` + the `updated_at` token +
  `deleted_at IS NULL`, re-checks the keeper under a row lock, and asserts the day ends with **exactly
  one** live weight before committing. **No bodyweight value is committed anywhere:**
  `.github/SECURITY.md` classifies kid bodyweight as privileged and this repo is public, so the token
  does the guard's job instead — a deliberate deviation from the plan's Decision 3, recorded as
  Decision 20. `db:correct` now lands a refusal readably instead of as an unhandled rejection, and the
  corrections README grew an `Applied` column, because a table that said a row "marks one as done" had
  no way to say "merged, not yet run". **Applied to prod 2026-10-01**: 2 rows soft-deleted, the mandated
  re-run prints 0, and a direct query confirms 0 duplicate groups table-wide. **1d is unblocked, but
  re-run the duplicate query immediately before merging it** — procedure in
  [runbooks.md](../runbooks.md). The read also answered CSV-1's blocking question for free: prod has **zero `kg` rows**, so that P0 is now a pure app fix.
