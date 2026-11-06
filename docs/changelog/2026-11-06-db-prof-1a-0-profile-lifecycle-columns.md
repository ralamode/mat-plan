- **2026-11-06** — **An athlete gets a replay key whose slot is never freed, and an archive that is not
  a deletion** (`PROF-1` a-0, [plan](../plans/prof-1-athletes.md), migration `0020`). Two columns on
  `profiles` — `client_id` and `archived_at` — shipped **dark**: nothing reads either. `a-1`'s
  `createProfile` is the first reader of one and `b`'s archive/restore of the other.
  🔴 **`uq_profiles_client_id` is NON-PARTIAL, and that is the whole point of the PR.** Every other
  `client_id` arbiter in this database is `WHERE deleted_at IS NULL`, so a soft-deleted row stops
  being an `ON CONFLICT` target and a replay of the same client key inserts a **twin** rather than
  resolving to the original — [ADR 0008](../decisions/0008-deletion.md) decision 3.4 states it, and
  `V1-9b`'s B0 exists to re-predicate five of them. This column is born after that finding, so it is
  born without the predicate: an archived **or later deleted** athlete keeps its slot, and a retried
  "add" resolves to the same athlete. ⚠️ The price, recorded so nobody "fixes" it: a `client_id` can
  never be reused for a different athlete, even once the first is gone.
  **The property under test is an ABSENCE, which is why the proofs are inserts and not a catalog
  read.** A `WHERE` that is present but wrong reads the same as absent to a naive check, so each
  `db:verify` case makes the database refuse a real insert with the holder in a state that _would_
  have freed the slot had the index been partial: `archived_at` set, then `deleted_at` set. Both were
  **probed RED** — the predicate added back as `deleted_at IS NULL`, then as `archived_at IS NULL`
  (the plausible mistake of treating archive as a delete) — and each produced
  `expected rejection by constraint 'uq_profiles_client_id', got '(none)'`. Two further cases: two
  `NULL` keys coexist, and a fresh row's `archived_at` is `NULL` from the column default.
  **`client_id` is NULLABLE here, unlike every other one**, because the seed and `db:correct` create
  profiles server-side with no client to mint a key. `NOT NULL` would need a backfill plus the
  `NOT VALID` → `VALIDATE` split — two more migrations — to store a fabricated UUID that means
  nothing. NULLs are distinct in a unique index, so seeded rows coexist. `addAthleteSchema` requires
  the key for every row the app creates, so the nullability is a server-side-creator allowance rather
  than a hole in the write path.
  ⚠️ **`archived_at` is not a second soft delete and not a security boundary.** `deleted_at` is the
  soft delete; this means "not currently training". An archived athlete keeps every row, still
  exports, and is still reachable by anyone who opens their link — only the picker drops them. It
  **must never enter `isLiveProfile`'s predicate**: that is the ownership seam, and folding a UX
  filter into it would turn "archived" into a 404 and make archive silently irreversible from the
  athlete's own page. The column docblock, the migration header and `write-path.md` all say so,
  because this is the mistake the next person makes.
  **No `IF NOT EXISTS` on the index**, on `0012`'s reason — it "would silently skip a same-named index
  with a different predicate", i.e. exactly a `uq_profiles_client_id` someone recreated **with** a
  `WHERE`. The two `ADD COLUMN`s keep their guards: a column cannot differ by predicate, and the drift
  snapshot pins its type. Not `CONCURRENTLY`, deliberately: drizzle's stock migrator wraps each file in
  a transaction, `CONCURRENTLY` cannot run inside one, and the transaction-stripping runner AGENTS.md
  describes **does not exist** — so `.squawk.toml` excludes the rule and
  [tech-debt.md](../tech-debt.md) carries the gap. `profiles` holds a handful of rows, so the SHARE
  lock is held for microseconds and `lock_timeout` bounds the wait, not the hold.
  **Two documents were saying the wrong thing and now say this one.** AGENTS.md's convention line read
  "`client_id = UUIDv7, NOT NULL, UNIQUE (partial: WHERE deleted_at IS NULL)`" and the `db-migration`
  skill repeated it; both now read non-partial for anything new, with the reasoning left in ADR 0008
  rather than copied (+14 words net in AGENTS.md, which is **already over DX-10's 4,000-word budget** —
  the growth is only because the old line was actively wrong).
  ⚠️ **`data-inventory.md`'s "fourteen are partial" paragraph had an exception as of this PR** and now
  names it: for `profiles` alone a soft delete does **not** free the natural key, so the "un-deleting
  can fail" hazard does not apply there. **The privacy consequence is retention:** a `client_id` is
  never reclaimed, so it is retained for the row's whole life, like `public_id`, not until deletion.
  Both columns are recorded with **no writer yet** and their owning chunks named.
