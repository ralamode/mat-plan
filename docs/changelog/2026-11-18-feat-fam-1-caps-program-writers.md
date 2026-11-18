# A household, a program and a day of its week each stop at their limit

FAM-1, lane P: the program writers enforce the limits the maintainer approved on 2026-11-18 (contract
change C35). A write past one answers "limit reached" and saves nothing.

- A household can make at most 500 items of its own with "+ New item" (the old Strength form, until
  it is retired, still adds items without that limit). Choosing an item it already has, or one from
  the library, is never refused, and the library's items do not count.
- A program holds at most 50 workouts, whether saved new or copied in. A copy counts the program it
  goes into. Editing a workout, or a save that is retried, is never refused.
- A day of a program's week holds at most 30 workouts, whether set in the week editor or added by a
  copy onto that day.
- Ten new `db:mutations` patches (483–492) show the proofs fail when a limit is skipped, counted
  wrongly, or asked in the wrong order.
