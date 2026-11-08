- **2026-11-07** — **`PROF-1` a-0 is verified applied in production, so `a-r`'s migration gate is met**
  _(maintainer, against the Neon primary)_. The plan deliberately refuses to count a green
  `migrate.yml` — `runbooks.md` records that the migrate step exits 0 when its secret is absent — so
  this is the catalog read instead.
  🔴 **The reading that mattered:** `pg_indexes.indexdef` returns
  `CREATE UNIQUE INDEX uq_profiles_client_id ON public.profiles USING btree (client_id)` with **no
  `WHERE` clause**. That absence is the non-partial property the chunk exists for — every other
  `client_id` arbiter in this database is `WHERE deleted_at IS NULL`, and a partial one here would
  free an archived or deleted athlete's replay slot, so a retried "add" would mint a twin. A green
  workflow cannot show this; only the catalog can.
  **The ledger read mattered for a different reason.** `drizzle.__drizzle_migrations`' newest
  `created_at` is `1793984366840` — exactly `0020`'s journal `when`, checked against the file rather
  than from memory. So `0020` is the newest recorded migration and the next deploy will not re-run
  it. ⚠️ A re-run would have been a wedge: the index deliberately carries no `IF NOT EXISTS`, so it
  raises `42P07`, the transaction aborts and the seed is skipped with it.
  Columns confirmed as `uuid` and `timestamp with time zone`, both nullable, as `D1` specifies.
  **Recorded in the plan, not the runbook** — a one-time verification of one migration is not a
  reusable procedure; the reusable part is the shape of the check set, which the plan now carries
  after a review found the first version of it weaker than `0019`'s.
