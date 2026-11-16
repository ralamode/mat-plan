# SCALE-3 — a statement timeout on the runtime pool

> Backlog: [plan.md](../plan.md#scale-3) row SCALE-3. Branch: `fix/scale-3-statement-timeout`.
> Roadmap: Platform, beside FAM-1 ([roadmap.md](../roadmap.md), "SCALE-1…4"). Migration queue: after
> FAM-1 lane A's step 5 migration, which is on the critical path.
>
> _Roadmap alignment (2026-11-16): advances `SCALE-3` only; gates nothing; checked against the private
> roadmap, nothing to add here._

## Goal

`packages/db/src/client.ts` gives the pool a connect timeout and nothing else, so one slow query can
hold a pooled connection indefinitely. Bound every runtime statement at **15 s**, the top of the row's
10–15 s range (the zip export builds on the request path, and the slowest legitimate read should not
sit near the limit).

## The probe that chose the mechanism

The row requires proving the mechanism on the seed-only preview's **pooled** string before choosing.
Run 2026-11-16 (Postgres 18.7, Neon pooler, transaction mode), with a 1.5 s limit against `pg_sleep(4)`:

| Mechanism                                                                          | Result                                                                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `statement_timeout` as a node-postgres startup parameter                           | Dropped by the pooler: `SHOW` reads `0`, the sleep completes                                               |
| `options=-c statement_timeout=…`                                                   | Refused: `08P01 unsupported startup parameter`                                                             |
| node-postgres `query_timeout` (row option 2)                                       | The client gives up at 1.5 s; **the server keeps running the query** (one `pg_sleep` backend still active) |
| `SET LOCAL` inside a transaction (row option 3)                                    | Works, but only inside a transaction, and most reads are not in one                                        |
| `ALTER ROLE CURRENT_USER SET statement_timeout` (row option 1), new direct backend | Cancelled at 1.5 s (`57014`)                                                                               |
| the same, then a session `SET statement_timeout = '60s'`                           | Overrides it: the sleep completes                                                                          |
| the same, new **pooled** connection, seconds after the change                      | `0`: the pooler handed back a backend opened before the change                                             |
| the same, 12 concurrent pooled sessions a few minutes later                        | All 12 on backends opened after the change, all `1500ms`; a sleep on one cancelled at 1.5 s (`57014`)      |

So the role default (option 1) is the only mechanism that reaches the server through the pooler, and a
session `SET` still beats it. On the preview the pooler had replaced every older backend within
minutes; production's pace is not measured. The preview role was reset after each run (`rolconfig` is
`NULL`).

## Files

| File                                                                        | Change                                                                                                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/migrations/NNNN_scale3_role_statement_timeout.sql` (+ `meta/`) | `ALTER ROLE CURRENT_USER SET statement_timeout = '15s'`, generated with `db:generate --custom`, with the usual `lock_timeout` / `statement_timeout` header |
| `packages/db/scripts/verify.ts`                                             | A "migration applied" check: the migrating role's `rolconfig` holds exactly one `statement_timeout=15s`                                                    |
| `docs/runbooks.md`                                                          | "The runtime statement timeout": the post-merge check, a long manual query, and the emergency lever                                                        |
| `docs/plan.md`, `docs/roadmap.md`, a changelog fragment                     | Link the plan; move the row                                                                                                                                |

`client.ts` does **not** change: nothing the pool can send survives the pooler.

## What else runs as that role (the row's ⚠️)

On the preview, the pooled and direct strings connect as the same role, and the maintainer confirms
production's do too _(maintainer, 2026-11-16)_. The runbook's step 1 runs on the **pooled** string, so
it reads the app's role rather than the migrator's; it is the post-merge check owed on this PR.

- **Migrations:** every file sets `statement_timeout = '60s'` for its session, which wins. drizzle's
  bookkeeping queries run before that `SET`, and are single-row reads.
- **Corrections:** two of the three set `SET LOCAL statement_timeout = '30s'` in their transaction
  (`corrections/registry.ts`), which wins; the third, and every read outside a transaction, is bounded
  at 15 s, which they fit.
- **`db:seed`:** no override, and **none is added.** Its statements are small reference-data upserts,
  each far below 15 s, and `migrate.yml` seeds on the unpooled string. One change in behaviour: a seed
  statement waiting on a lock now fails at 15 s, leaving a red job that is safe to re-run.
- **Console sessions as that role** (the Neon SQL editor, `psql`) are bounded at 15 s too. A long
  manual query lifts it inside a transaction (the runbook entry).
- **Local and CI databases** get the default on whichever role ran the migrations. The e2e and
  screenshot harnesses' statements are small.

## Caveats, stated plainly

1. **Pooled traffic is bounded as the pooler recycles backends, not at merge.** A backend opened
   before the migration keeps `0` until it closes. The runbook's step 2 counts them.
2. **It bounds the maintainer's own console sessions as that role.**
3. **`statement_timeout` counts time spent waiting on a lock.** An app query queued behind a migration's
   lock now fails at 15 s instead of waiting: a Server Action reaches `error.tsx` and Sentry, and the
   export route returns a bare 500.
4. **A Neon restore branch cut before this migration does not carry the default.** A restore from one
   silently removes the timeout; the runbook says to re-check after a restore.

## Rollback

Fix forward: a new migration with `ALTER ROLE CURRENT_USER RESET statement_timeout`. Nothing is locked
or rewritten; the change is one catalog row. In an emergency the runbook's lever resets it by hand
first (it, too, reaches only new backends), and the migration follows so `db:verify` and production
agree again.

## Deploy order

None. No code reads the setting. Caveat 3 is the one behaviour change at merge time.

## Review-response log

Reviewed by three lenses (db-safety, correctness, scope) on **Opus 5.5**, not Fable: the account's
Fable spend limit applies until 2026-11-19 _(maintainer, 2026-11-16)_. The FAM-1 board asked for this
to be built straight after the probe, so the panel reviewed the plan and the diff together, not the
plan first. No P0. Every finding was checked against the code or the preview before it was taken.

| Lens                         | Finding                                                                                                                                             | Response                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Correctness P1               | Nothing showed the role default reaching a **pooled** backend; the probe only measured a direct one                                                 | **Fixed:** probe 3 (12 pooled sessions on new backends, all bounded, one cancelled at 1.5 s); table row added     |
| Correctness P1, db-safety P2 | "App and migrator share a role" is inferred for production; every check offered would pass if they differ                                           | **Fixed:** stated as unread for production; runbook step 1 runs on the **pooled** string and reads `current_user` |
| Correctness P1, db-safety P2 | The runbook's "restart the compute, then all read 15s" was unmeasured, disruptive on prod, and its `SHOW` step could not fail                       | **Fixed:** replaced by a read-only count of backends older than the migration; the restart is gone                |
| Db-safety P2                 | The only rollback is a full PR cycle                                                                                                                | **Fixed:** an emergency `RESET` lever in the runbook, followed by a forward migration                             |
| Db-safety P2                 | `SET … = 0` "in the same session" in the SQL editor is unprobed                                                                                     | **Fixed:** the runbook prescribes `BEGIN; SET LOCAL …; COMMIT;` everywhere                                        |
| Db-safety P2                 | The seed's "pooled `SET` would leak" reason is wrong (`SET LOCAL` would not)                                                                        | **Fixed:** reason restated; the seed's new lock-wait failure is recorded                                          |
| Correctness P2               | Corrections: one of three sets no `SET LOCAL`                                                                                                       | **Fixed:** "two of the three"                                                                                     |
| Correctness P2               | "Every database of the project" is wrong on Neon (a role is per branch); a restore drops it                                                         | **Fixed:** migration header and caveat 4; runbook re-check after a restore                                        |
| Correctness P2               | Lock waits now fail at 15 s, undocumented                                                                                                           | **Fixed:** caveat 3                                                                                               |
| Correctness P2, scope P2     | The verify check proves the migration applied, not the runtime bound                                                                                | **Fixed:** its comment and the Files table say so                                                                 |
| Scope P1                     | Review-response log empty                                                                                                                           | **Fixed:** this table                                                                                             |
| Scope P2                     | The row says the seed needs an override; the plan decides none                                                                                      | **Fixed:** a clause in the row's plan pointer                                                                     |
| Scope P2                     | The roadmap's gate-1 cell still says `client.ts`                                                                                                    | **Fixed:** a dated note in the cell (the decision itself is kept as made)                                         |
| Scope P2                     | The number is 0027, but the board assigned 0028 after lane A's step 5                                                                               | **Done:** regenerated onto `0028` with the `db-migration` recipe after lane A's `0027` was applied                |
| Scope P2                     | The "why the role" explanation is repeated four times                                                                                               | **Fixed:** the changelog and runbook now point at the plan                                                        |
| Scope P2                     | Runbook steps 1–2 are a one-time check                                                                                                              | **Pushed back, partly:** trimmed, but kept, because a restore (caveat 4) makes the check recur                    |
| Scope P2                     | A pointer comment in `client.ts`                                                                                                                    | **Not done:** the file is under `write-path.md`'s seam, which this PR now avoids                                  |
| Db-safety, outside the diff  | drizzle `0.45.4` runs **all pending migrations in one transaction**, not one per file as AGENTS.md, `.squawk.toml` and the `db-migration` skill say | **Not this PR:** reported to the FAM-1 board for its own docs fix; harmless here                                  |
