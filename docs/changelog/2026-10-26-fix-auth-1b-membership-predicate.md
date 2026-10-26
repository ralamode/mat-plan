- **2026-10-26** — **`membershipHousehold` shipped without the conjunct the plan calls load-bearing,
  and the proofs passed anyway.** § Design 3.1 of the AUTH-1 plan writes the predicate out and names
  `h.deleted_at IS NULL` in bold as _"the conjunct the first draft lost"_. #308 lost it again — the
  query joined **no `households` table at all** — so a **live membership on a soft-deleted household**
  still resolved a working scope, and its holder could read that household's profiles. That is
  precisely what `TEN-1` extracted `liveHouseholdIds` to prevent; its docblock calls the same conjunct
  load-bearing.
  It also used `LIMIT 1` where the plan specifies **`LIMIT 2` as an ambiguity probe**. With no
  `ORDER BY`, `LIMIT 1` returns whichever row the planner reaches first — a cross-wire between two
  households with nothing in the logs. The function now returns the ids it found, capped at two, and
  the **caller** decides what more than one means.
  **No live impact:** the table is dark, nothing reads it, and the claim correction has not run. But
  `1c` is the chunk that makes it live, and `1c` is the one-way door — so this had to be found before
  that, not after.
  🔴 **Why the suite missed it, which is the more useful half.** `db:verify` covered the soft-deleted
  **membership** and never the soft-deleted **household**: the proofs asserted the behaviour that had
  been _written_ rather than the one the plan _specified_. Same shape as the vacuous scope assertion
  the mutation gate caught a day earlier, one level up — and this time nothing caught it but re-reading
  § Design 3.1 before building `1c` on top. The lesson is narrow and worth keeping: **implementing from
  a chunk table's one-line summary is not implementing from the spec.**
  Both missing proofs now exist — a soft-deleted household resolves to nothing, and the probe is capped
  — each with a mutation patch that goes **RED** when its conjunct is removed. 9/9 mutations RED.
