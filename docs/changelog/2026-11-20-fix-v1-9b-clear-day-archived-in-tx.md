# Clear this day cannot hide an athlete archived a moment earlier

`V1-9b` B2 follow-up (the maintainer, 2026-11-19: "fix both").

- `clearDay` now locks the athlete's profile row (`FOR SHARE`) before it locks any entry, and refuses
  an archived athlete with `{ closed: true }`, which `clearDayAction` answers as `closed_day`.
  Before, the action checked "archived" before the writer's transaction, so an archive landing in
  between let the clear hide an archived athlete's day, which Restore all then refused.
- `db:verify` proof 14 and mutation 425; the DAL and action tests cover the new answer.
- `clearDayOpenFor`'s docblock no longer says the page "never" offers a clear the action refuses:
  a page rendered before midnight can submit after it, and the action checks again.
