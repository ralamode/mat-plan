- **2026-11-17** — **FAM-1 step 14a: a program workout exports one row per exercise, with the
  workout's name** ([plan](../plans/fam-1-14-export.md), [FAM-1](../plans/fam-1-family-program.md) §5
  step 14). The strength log now:
  - **writes one row per program item in a session**, not one per set. A ✓ on sets 1–3 of a bench
    reads `…,bench-press,3,8,25,…`, like any strength row of the same sets. The fold
    (`foldStrengthMonth`) now sits beside its query in `packages/db`, so `db:verify` proves the whole
    chain. It shares the day page's item key, which falls back to the movement once a prescription is
    purged.
  - **adds a ninth column, `workout_name`**: the name the workout had when the row was logged, never
    its id and never its later name.
  - **checks the session's owner**: the export's sessions join now requires the session to belong to
    the athlete and be live, so another athlete's session, or a hidden one, lends no name or session
    type. Before this, the export read `session_type` from a session it never checked (V1-13b).
  - **exports every tracking type in every unit it takes.** A Count logged in `count` writes its
    number in `reps`, with `load` empty, where until now it made the whole export throw. A bare number
    in `load` is still only pounds, and a set with both reps and a count is refused (no writer makes
    one).
  - **is quoted the RFC 4180 way throughout**: a field with a `,` or a `"` is quoted (inch marks
    included) instead of being written raw or refused.

  The privacy notice and data inventory now say the workout name is exported as typed. They also
  correct the inventory's claim that "how it felt" is exported, which it never was. Mutations 364–366.
