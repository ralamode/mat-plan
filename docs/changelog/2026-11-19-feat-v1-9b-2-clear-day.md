# Clear this day: the server action, on today only

`V1-9b` B2-i ([plan](../plans/v1-9b-delete-and-restore.md) § B2 as amended).

- **`clearDayAction`** hides every live entry of one athlete's day as one event, through `clearDay`.
  It takes the athlete, the day and a typed confirm word (`delete`, case and spaces ignored). It
  answers the clear's count, and 0 when nothing was left to clear.
- **Today only, and not for an archived athlete** (maintainer, 2026-11-19). Restore all keeps today and
  yesterday, now through the shared `dayOpenFor`, so every clear has at least a day to be restored.
- **Any member** may clear or restore; no role is read.
- One refusal list for both day actions: `RESTORE_CLEAR_REFUSALS` is renamed `DAY_CLEAR_REFUSALS`.
- `.github/SECURITY.md` records an accepted residual: a write's day window takes "today" from the
  client's `tz` cookie.
- No screen yet: B2-ii adds the dialog and the banner.
