- **2026-11-16** — **`SCALE-2`: server functions run in the database's region, and each vendor's
  region is recorded** ([plan.md → SCALE-2](../plan.md#scale-2)).
  - **`apps/web/vercel.json`** (new) pins Vercel functions to `iad1` (US East), beside the Neon
    production database in AWS `us-east-1`. Nothing in the tree pinned a region before. A Neon
    project's region cannot change after creation, so the functions follow the database.
  - **`docs/privacy/data-inventory.md` §7** gains **Region** and **Agreement / transfer** columns:
    - **Neon:** prod `us-east-1`. The seed-only preview is `us-east-2`, a recorded mismatch, to be
      recreated in `us-east-1` before the Pilot load test.
    - **Upstash:** `us-east-1`, prod and preview.
    - **Clerk:** US only (from Clerk's docs).
    - **Sentry:** a console read is still owed.
    - **Agreements:** not yet recorded for any vendor, marked ⏳ as a gap to close before the first
      outside family.

    No processor is added and nothing any processor receives changes.

  - **`docs/runbooks.md`:** the "Clerk's data region" item is answered from Clerk's docs, and
    three owed reads are added as boxes: Sentry's region, Vercel's function region and the vendors'
    agreements.
