- **2026-10-08** — **OSS-1 follow-up: the repository no longer carries the household's given names**
  ([inventory](../privacy/data-inventory.md) §9). PRIV-1 re-scoped this from three files to ~50 and
  raised it to a **Beta 0 blocker**; the real surface was **57 files / 309 occurrences**, and it is now
  **1** — a comment in an **applied** migration, which the forward-only guard allows nobody to edit and
  which is recorded as a residual rather than quietly fixed. The fixture identities are role names
  (`Athlete One` / `Athlete Two`) behind `SEED_PROFILE_NAME` / `SEED_PROFILE_2_NAME` in
  `packages/shared/src/seed-ids.ts`, so the next rename is two lines instead of another fifty-file
  sweep, and `db:verify` pins the literal **once** — on the assertion side, which is the one place
  AGENTS.md allows one — so a real name cannot come back unnoticed. **Three classes needed more than a
  rename.** The second profile's exported seeded routine — now
  `SEED_ATHLETE_TWO_ROUTINE` — took a **clean break, no deprecated alias**: all three consumers are in-workspace, `@mat-plan/db` is `private: true`
  and unpublished, and an alias would have left the name in the API surface — the thing being removed.
  The **per-athlete load/rep columns** in `docs/programs/kids-sc-foundation-archived.md` were
  **deleted, not renamed** — a rename de-labels a minor's prescribed programme but the numbers were the
  exposure, and that file's own note already said they must be re-derived from logged working sets, so
  there was no forward value to trade; the day split, order, movements and shared prescription stay,
  which is what a re-seed needs, and the shipped `PROGRAM_SEED` already seeds every per-athlete load as
  `null`. The **CSV contract's example rows** now quote `docs/samples/legacy-csv/` **verbatim** instead
  of a pre-scrub copy of it: checked first, because those vectors are load-bearing for the byte-faithful
  contract — but what they pin is the bare inch marks in an unquoted field, the unescaped comma,
  `SKIPPED`, `sub-failure` and slash-list arity, never the name or the date, so every tripwire survives
  byte-for-byte and the quoted rows became checkable against a committed file. **Two classes §9 had
  missed** are closed too: real **bodyweight values** (`71.4` and friends) quoted as contract examples —
  the one class SECURITY.md singles out as privileged — and **two minors' ages and bodyweights**, in a
  plan's frontmatter and restated in the `OSS-1` finding row that reported them. Correction `name`s now
  describe the **defect** rather than the person (safe: nothing persists a `name`; the **Applied** table
  is the record), and prose about the real logged incidents reads "an athlete", because the fixture is
  not the child. ⚠️ **A rename is not a removal, and nothing here claims otherwise:** `git log -S` finds
  every prior value and the commit author is in every commit. What it buys is the **forward** exposure —
  every future commit, preview and PR screenshot is clean **by construction**, which is the property that
  matters before another household is invited in (`TEN-1`). History rewriting was out of scope. **The
  production database was not touched and no correction was written:** those names are the household's
  own data, the seed is `onConflictDoNothing` on `public_id` so a re-seed cannot rename a live row, and
  this sweep was about the repository.
