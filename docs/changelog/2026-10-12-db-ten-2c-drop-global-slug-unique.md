- **2026-10-12** — **TEN-2c: the cross-household DENIAL window is closed, and the READ leak's
  residual is not** ([plan](../plans/ten-2c-drop-global-slug-unique.md)). Migration `0017` drops the
  non-partial `movements_slug_unique` and adds the end-state CHECK
  `movements_global_row_has_pattern` (`NOT VALID`; the `VALIDATE` is `TEN-2d`'s, because Squawk
  requires the two be split across PRs). Two households now each hold their **own** row for one slug,
  so `findOrCreateMovement`'s `23505` fallback — the thing that handed the second typist the first's
  row — is **unreachable**; it survives one more PR for the deploy race and `TEN-2d` deletes it.
  🔴 **This PR's own title was the mis-attribution it retracts.** The plan's first draft read _"the
  leak closes here"_, which [`plan.md`](../plan.md)'s TEN-2 row and
  [TEN-2a's plan](../plans/ten-2a-household-movements.md) had already assigned to TEN-2c to retract —
  so the true statement has two halves and eleven prose sites now carry both: the **denial** window
  closes here, completely; the **read** leak's residual — the pre-`TEN-2b` rows still sitting at
  `household_id IS NULL`, which global-first serves to **every** household — closes at **`TEN-2c-1`**
  (the split backfill, moved out of this PR), and `0017` only stops the set **growing**, via the new
  CHECK. **The invite blocker is now `TEN-2d`**, the arc's only mechanical production-side gate, which
  also settles the count: **TEN-2 is FIVE rows** (`2a`, `2b`, `2c`, `2c-1`, `2d`), all filed.
  ✅ **The price `TEN-2b` measured is paid off, asserted rather than claimed:** `db:verify` proves
  [`runbooks.md`](../runbooks.md) pre-flight (d) reads **ZERO** across `entries` **and**
  `prescriptions`, and that step 11's `DELETE FROM movements` **completes** instead of aborting
  `23503` — both assertions **inverted rather than retired**, through **one** shared definition of
  _referenced_ (`packages/db/src/queries/movement-ownership.ts`), which is also what the pre-2c
  hand-written check missed: it covered `entries` and not `prescriptions`. `pnpm db:mutations` stays
  **6/6 RED**.
  ✅ **The seed's shadow guard is demoted to a report — and the demotion had to be BOTH halves.** The
  panel caught a half-fix: the guard was detect → **omit** → seed → **throw**, and the omission (a
  `seedableMovements` filter) ran **before** the arbiter was ever consulted, so demoting only the
  `throw` would have left the curated row never inserted, forever, with nothing complaining loudly —
  a loud confidentiality guard turned into a silent, permanent gap in reference data, strictly worse
  than the state it replaced. The filter is gone **and** the throw is a `console.warn`: the curated
  row **lands** and the message names the **seed slug only**, never the colliding row's `name`, which
  is uncontrolled household free text — `migrate.yml` publishes that message to a **world-readable**
  Actions log on a public repo, so `db:verify` keeps both halves of that proof against the captured
  warning. The runbook heading rewrites the procedure to match: nothing is wedged, nothing is missing,
  and nothing has to be done today.
  ✅ **A report-only `db:correct` correction, `movements-ownership-2026-10-11`**, counts what
  `TEN-2c-1` / `TEN-2b-2` / `TEN-2d` still owe against **production** — deliberately **unscoped**
  (the question is whether anything crosses a boundary, which a `HouseholdScope` can only answer for
  one side) and **aggregate counts only**, no `name`, `slug` or `public_id`, because the counts get
  pasted into a PR body on a public repo. It exists because the isolation argument rests on a
  **dated** zero: `ten-2a` measured zero app-authored `movements` rows on 2026-10-09, and a
  measurement taken after the verdict flips is not evidence for it.
  ⚠️ **One stale claim is knowingly left behind:** `.github/workflows/migrate.yml`'s header comment
  still describes `db:seed` as refusing and wedging the job, which stopped being true here. The
  runbook says so explicitly; the workflow edit is left to the next PR that touches that file, since
  changing a workflow re-triggers the action-pin resolve.
