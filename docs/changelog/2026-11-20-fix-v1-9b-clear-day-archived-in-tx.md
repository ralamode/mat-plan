# Clear this day cannot hide an athlete archived a moment earlier

`V1-9b` B2 follow-up (the maintainer, 2026-11-19: "fix both").

- `clearDay` now locks the athlete's profile row (`FOR SHARE`) before it locks any entry, and refuses
  an archived athlete with `{ closed: true }`, which `clearDayAction` answers as `closed_day`.
  Before, the action checked "archived" before the writer's transaction, so an archive landing in
  between let the clear hide an archived athlete's day, which Restore all then refused.
- `db:verify` proof 14 and mutations 425 (the check removed) and 426 (the lock weakened to
  `KEY SHARE`); a source pin holds the lock's mode and its place before the entries lock, since
  PGlite cannot show a wait. The clear's transaction now bounds its lock waits (`lock_timeout`).
- The clear's refusal names both causes: "only today can, and not for an archived athlete".
- `clearDayOpenFor`'s docblock no longer says the page "never" offers a clear the action refuses:
  a page rendered before midnight can submit after it, and the action checks again.
