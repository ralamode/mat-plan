- **2026-11-19** — **The fresh start's erasure of the seeded household is built** (`PRIV-3` · `CAT-3`
  R0; [plan](../plans/priv-3-fresh-start-prep.md), D1). A dated one-shot correction,
  `erase-seeded-household-2026-11-19`, finds the seeded household itself (live or hidden) and erases it
  through the erasure core, with the core's pre-flights, locks and order. It refuses every target it
  can recognise as not production: an unset direct string, a local database, the preview, a URL that
  names no database or carries a host override, and then, on the connection that writes, a
  `current_database()` that is the preview or not the URL's. `--apply` needs `EXPECT_ERASED_ROWS`,
  the total this sitting's dry run printed, and a different total rolls everything back. Once the
  household is gone a dry run says so and `--apply` refuses. It prints counts only, never an account
  id or a `public_id`, and keeps every sign-in account (K15). `create-household-…` now also refuses a
  URL with no database name. Not yet run: it runs at the fresh start's step 3. `OPS-2`'s plan and
  `SEC-6`'s row record what the fresh start makes unnecessary.
